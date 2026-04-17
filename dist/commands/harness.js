/**
 * headless-harness-design 命令
 *
 * 基于 Anthropic Harness Design 模式的任务执行命令
 *
 * 核心流程：
 * 1. Planner: 解析计划文件，生成任务执行列表
 * 2. Generator: 开发阶段 - 执行任务实现
 * 3. Evaluator: 审查阶段 - 独立验证结果
 *
 * 质量门禁（BUG-011-5）：
 * - --require-quality N: 质量分低于N时自动提示完善
 * - 方案验证检查点：任务开始前要求确认理解解决方案
 * - 影响文件清单：任务必须关联受影响文件列表
 * - 变更范围预估：标记 small/medium/large 变更
 *
 * 计划快照机制（CP-snapshot）：
 * - 流水线启动时创建计划快照（PlanSnapshot）
 * - 全流程读取快照而非 current-plan.json
 * - 正常退出时清理快照，异常时保留供诊断
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_HARNESS_CONFIG, createDefaultRuntimeState, } from '../types/harness.js';
import { isInitialized, getProjectDir } from '../utils/path.js';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { HarnessReporter } from '../utils/harness-reporter.js';
import { readPlan } from '../utils/plan.js';
import { readTaskMeta } from '../utils/task.js';
import { normalizeStatus } from '../types/task.js';
import { SEPARATOR_WIDTH } from '../utils/format';
import { recommendPlan } from './plan.js';
import { batchCheckQualityGate, formatBatchQualityGateResult, showQualityImprovementGuide, DEFAULT_QUALITY_GATE_CONFIG, } from '../utils/quality-gate.js';
import { createPlanSnapshot, readPlanSnapshot, cleanupSnapshot, getCurrentProcessSnapshot, getLatestSnapshot, rebuildExecutionPlanFromSnapshot, validateSnapshot, detectActiveSnapshot, listSnapshots, isSnapshotActive, } from '../utils/harness-snapshot.js';
/** 当前流水线计划快照ID（用于清理） */
let currentSnapshotId = null;
/**
 * 从 ExecutionPlan 的 batches 数据构建 BatchAwareQueue
 *
 * 将 plan.batches（string[][]，按优先级分桶的任务ID二维数组）
 * 转换为基于索引的 batchBoundaries + batchLabels，供流水线消费
 */
export function buildBatchAwareQueue(taskQueue, batches) {
    if (!batches || batches.length === 0) {
        return {
            taskQueue,
            batchBoundaries: [],
            batchLabels: [],
            batchParallelizable: [],
        };
    }
    const batchBoundaries = [];
    const batchLabels = [];
    const batchParallelizable = [];
    let offset = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        batchBoundaries.push(offset);
        batchLabels.push(`批次 ${i + 1}`);
        // 多个任务且超过1条链时标记为可并行
        batchParallelizable.push(batch.length > 1);
        offset += batch.length;
    }
    return { taskQueue, batchBoundaries, batchLabels, batchParallelizable };
}
/**
 * 从 batchBoundaries 重建 batches 数组
 *
 * 反向操作：将 batchBoundaries + taskQueue 转换回 batches 二维数组
 * 例如：boundaries=[0,3,7], taskQueue=[a,b,c,d,e,f,g,h] -> [[a,b,c],[d,e,f,g],[h]]
 */
function rebuildBatchesFromBoundaries(batchQueue) {
    const { taskQueue, batchBoundaries } = batchQueue;
    if (batchBoundaries.length === 0) {
        return [taskQueue];
    }
    const batches = [];
    for (let i = 0; i < batchBoundaries.length; i++) {
        const start = batchBoundaries[i];
        const end = i + 1 < batchBoundaries.length ? batchBoundaries[i + 1] : taskQueue.length;
        batches.push(taskQueue.slice(start, end));
    }
    return batches;
}
/**
 * 清理 Harness 快照
 *
 * @param options - 清理选项
 * @param cwd - 工作目录
 * @returns 清理的快照数量
 */
export async function cleanupHarnessSnapshots(options = {}, cwd = process.cwd()) {
    if (!isInitialized(cwd)) {
        console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
        process.exit(1);
    }
    const snapshots = listSnapshots(cwd);
    if (snapshots.length === 0) {
        console.log('✅ 没有找到任何快照');
        return 0;
    }
    let cleaned = 0;
    const activeSnapshots = [];
    const orphanSnapshots = [];
    // 分类快照
    for (const snapshot of snapshots) {
        if (isSnapshotActive(snapshot, cwd)) {
            activeSnapshots.push(snapshot);
        }
        else {
            orphanSnapshots.push(snapshot);
        }
    }
    // 清理孤儿快照
    for (const snapshot of orphanSnapshots) {
        if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
            cleaned++;
            console.log(`  🧹 已清理孤儿快照: ${snapshot.snapshotId} (PID: ${snapshot.pid})`);
        }
    }
    // 如果需要强制清理，也清理活跃快照
    if (options.force && !options.orphansOnly) {
        for (const snapshot of activeSnapshots) {
            if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
                cleaned++;
                console.log(`  ⚠️  已强制清理活跃快照: ${snapshot.snapshotId} (PID: ${snapshot.pid})`);
            }
        }
    }
    // 输出活跃流水线信息
    if (activeSnapshots.length > 0 && !options.force) {
        console.log(`\n⚠️  发现 ${activeSnapshots.length} 个活跃流水线快照（进程仍在运行）:`);
        for (const snapshot of activeSnapshots) {
            console.log(`   - ${snapshot.snapshotId} (PID: ${snapshot.pid}, 创建于 ${snapshot.timestamp})`);
        }
        console.log('\n💡 使用 --force 选项强制清理所有快照，或等待活跃流水线完成');
    }
    console.log(`\n✅ 共清理 ${cleaned} 个快照`);
    return cleaned;
}
/**
 * 检查并发并报告
 *
 * @param cwd - 工作目录
 * @returns 是否存在活跃流水线
 */
function checkConcurrency(cwd) {
    const detection = detectActiveSnapshot(cwd);
    if (detection.hasActive && detection.activeSnapshot) {
        console.error('');
        console.error('❌ 错误: 检测到另一个 Harness 流水线正在运行');
        console.error('');
        console.error('活跃流水线信息:');
        console.error(`   快照ID: ${detection.activeSnapshot.snapshotId}`);
        console.error(`   进程ID: ${detection.activeSnapshot.pid}`);
        console.error(`   创建时间: ${detection.activeSnapshot.timestamp}`);
        console.error(`   任务数量: ${detection.activeSnapshot.tasks.length}`);
        console.error('');
        console.error('可能的原因:');
        console.error('   1. 另一个 Harness 流水线正在运行');
        console.error('   2. 之前的流水线异常退出，残留了快照');
        console.error('');
        console.error('解决方案:');
        console.error('   - 如果确定没有其他流水线在运行，使用以下命令清理:');
        console.error('     projmnt4claude headless-harness-design cleanup');
        console.error('   - 或强制清理所有残留快照:');
        console.error('     projmnt4claude headless-harness-design cleanup --force');
        console.error('');
        return true;
    }
    return false;
}
/**
 * 主命令入口
 */
export async function harnessCommand(options, cwd = process.cwd()) {
    // 检查项目初始化
    if (!isInitialized(cwd)) {
        console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
        process.exit(1);
    }
    // CP-concurrency: 启动前检查并发
    // 注意: --continue 模式下允许并发（恢复执行）
    if (!options.continue && checkConcurrency(cwd)) {
        process.exit(1);
    }
    // 构建质量门禁配置
    const qualityGateConfig = {
        ...DEFAULT_QUALITY_GATE_CONFIG,
        minQualityScore: options.requireQuality
            ? parseInt(options.requireQuality, 10)
            : DEFAULT_QUALITY_GATE_CONFIG.minQualityScore,
        enabled: !(options.skipHarnessGate || options.skipQualityGate),
    };
    // 验证质量分阈值
    if (qualityGateConfig.minQualityScore < 0 || qualityGateConfig.minQualityScore > 100) {
        console.error('错误: --require-quality 必须在 0-100 之间');
        process.exit(1);
    }
    // 构建配置
    const config = {
        ...DEFAULT_HARNESS_CONFIG,
        maxRetries: options.maxRetries ? parseInt(options.maxRetries, 10) : DEFAULT_HARNESS_CONFIG.maxRetries,
        timeout: options.timeout ? parseInt(options.timeout, 10) : DEFAULT_HARNESS_CONFIG.timeout,
        parallel: options.parallel ? parseInt(options.parallel, 10) : DEFAULT_HARNESS_CONFIG.parallel,
        dryRun: options.dryRun ?? DEFAULT_HARNESS_CONFIG.dryRun,
        continue: options.continue ?? DEFAULT_HARNESS_CONFIG.continue,
        jsonOutput: options.json ?? DEFAULT_HARNESS_CONFIG.jsonOutput,
        apiRetryAttempts: options.apiRetryAttempts ? parseInt(options.apiRetryAttempts, 10) : DEFAULT_HARNESS_CONFIG.apiRetryAttempts,
        apiRetryDelay: options.apiRetryDelay ? parseInt(options.apiRetryDelay, 10) : DEFAULT_HARNESS_CONFIG.apiRetryDelay,
        batchGitCommit: options.batchGitCommit ?? DEFAULT_HARNESS_CONFIG.batchGitCommit,
        forceContinue: options.forceContinue ?? DEFAULT_HARNESS_CONFIG.forceContinue,
        cwd,
    };
    // 验证配置
    if (config.maxRetries < 0) {
        console.error('错误: --max-retries 必须大于等于 0');
        process.exit(1);
    }
    if (config.timeout < 10) {
        console.error('错误: --timeout 必须大于等于 10 秒');
        process.exit(1);
    }
    if (config.parallel < 1) {
        console.error('错误: --parallel 必须大于等于 1');
        process.exit(1);
    }
    // 加载任务列表 - 3级优先级
    const batchQueue = await loadTaskQueue(options, cwd);
    if (batchQueue.taskQueue.length === 0) {
        console.error('错误: 没有可执行的任务');
        process.exit(1);
    }
    const hasBatches = batchQueue.batchBoundaries.length > 0;
    // 输出配置信息
    if (!config.jsonOutput) {
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log('🚀 Harness Design 执行模式');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log(`📋 计划文件: ${options.plan}`);
        console.log(`📊 任务数量: ${batchQueue.taskQueue.length}`);
        if (hasBatches) {
            console.log(`📦 批次数: ${batchQueue.batchBoundaries.length}`);
        }
        console.log(`🔄 最大重试: ${config.maxRetries}`);
        console.log(`⏱️  超时时间: ${config.timeout}s`);
        console.log(`🔀 并行数: ${config.parallel}`);
        console.log(`🧪 试运行: ${config.dryRun ? '是' : '否'}`);
        console.log(`▶️  继续执行: ${config.continue ? '是' : '否'}`);
        console.log('');
    }
    // 试运行模式
    if (config.dryRun) {
        console.log('📝 试运行模式 - 以下是将执行的任务顺序:');
        if (hasBatches) {
            // 按批次分组展示
            for (let b = 0; b < batchQueue.batchBoundaries.length; b++) {
                const start = batchQueue.batchBoundaries[b];
                const end = b + 1 < batchQueue.batchBoundaries.length
                    ? batchQueue.batchBoundaries[b + 1]
                    : batchQueue.taskQueue.length;
                const label = batchQueue.batchLabels[b];
                const parallelTag = batchQueue.batchParallelizable[b] ? ' [可并行]' : '';
                console.log(`\n   📦 ${label}${parallelTag} (${end - start} 个任务):`);
                for (let i = start; i < end; i++) {
                    console.log(`      ${i + 1}. ${batchQueue.taskQueue[i]}`);
                }
            }
        }
        else {
            batchQueue.taskQueue.forEach((taskId, index) => {
                console.log(`   ${index + 1}. ${taskId}`);
            });
        }
        console.log('');
        console.log('✅ 试运行完成（未实际执行）');
        return;
    }
    // 质量门禁检查（BUG-011-5）
    if (qualityGateConfig.enabled) {
        console.log('');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log('🚦 质量门禁检查');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log(`📊 最低质量分阈值: ${qualityGateConfig.minQualityScore}`);
        console.log('');
        const batchResult = await batchCheckQualityGate(batchQueue.taskQueue, qualityGateConfig, cwd);
        // 输出检查结果
        console.log(formatBatchQualityGateResult(batchResult, { compact: false, showDetails: true }));
        if (!batchResult.allPassed) {
            console.log('');
            console.log('❌ 质量门禁检查未通过，以下任务需要完善:');
            console.log('');
            for (const taskId of batchResult.blockedTasks) {
                const result = batchResult.results.get(taskId);
                if (result) {
                    showQualityImprovementGuide(result);
                }
            }
            console.log('');
            console.log('💡 提示:');
            console.log('   1. 完善任务描述，添加 "## 问题描述"、"## 根因分析"、"## 解决方案" 部分');
            console.log('   2. 在 "## 相关文件" 部分列出受影响的源文件');
            console.log('   3. 使用更具体的检查点描述，避免泛化描述如 "核心功能实现"');
            console.log('   4. 使用 --skip-harness-gate 跳过质量检查（不推荐）');
            console.log('   5. 使用 --require-quality N 调整质量分阈值（默认 60）');
            console.log('');
            process.exit(1);
        }
        console.log('✅ 所有任务通过质量门禁检查');
        console.log('');
    }
    // CP-3: 流水线启动时创建计划快照
    const executionPlan = {
        tasks: batchQueue.taskQueue,
        batches: batchQueue.batchBoundaries.length > 0 ? rebuildBatchesFromBoundaries(batchQueue) : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    const snapshot = createPlanSnapshot(executionPlan, cwd, {
        batchBoundaries: batchQueue.batchBoundaries,
        batchLabels: batchQueue.batchLabels,
        batchParallelizable: batchQueue.batchParallelizable,
    });
    currentSnapshotId = snapshot.snapshotId;
    console.log(`   💾 计划快照已创建: ${snapshot.snapshotId} (${snapshot.tasks.length} 个任务)`);
    // 创建 AssemblyLine 并执行
    const assemblyLine = new AssemblyLine(config);
    const reporter = new HarnessReporter(config);
    // BUG-014-2: 流水线完成标志 & 信号防重入
    let pipelineCompleted = false;
    let shutdownInProgress = false;
    const gracefulShutdown = (signal) => {
        if (shutdownInProgress)
            return;
        shutdownInProgress = true;
        console.log(`\n⚠️ 收到 ${signal}，正在优雅关闭...`);
        assemblyLine.forceFailStatus(new Error(`收到 ${signal}，流水线被中断`));
        process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    try {
        // 加载或创建运行时状态
        let state;
        if (config.continue) {
            state = loadRuntimeState(cwd);
            if (state) {
                // CP-4: 尝试从快照恢复计划（确保使用创建时的计划版本）
                const latestSnapshot = getLatestSnapshot(cwd);
                if (latestSnapshot) {
                    console.log(`📦 从中断处继续 (任务 ${state.currentIndex + 1}/${state.taskQueue.length})`);
                    console.log(`   💾 使用计划快照: ${latestSnapshot.snapshotId}`);
                    // 从快照恢复计划数据（如果状态中的计划数据不完整）
                    if (latestSnapshot.tasks.length > 0 && state.taskQueue.length === 0) {
                        state.taskQueue = latestSnapshot.tasks;
                        state.batchBoundaries = latestSnapshot.batchBoundaries || [];
                        state.batchLabels = latestSnapshot.batchLabels || [];
                        state.batchParallelizable = latestSnapshot.batchParallelizable || [];
                    }
                }
                else {
                    console.log(`📦 从中断处继续 (任务 ${state.currentIndex + 1}/${state.taskQueue.length})`);
                }
            }
            else {
                console.log('📦 没有找到之前的执行状态，从头开始');
                state = createDefaultRuntimeState(config);
                state.taskQueue = batchQueue.taskQueue;
                state.batchBoundaries = batchQueue.batchBoundaries;
                state.batchLabels = batchQueue.batchLabels;
                state.batchParallelizable = batchQueue.batchParallelizable;
            }
        }
        else {
            state = createDefaultRuntimeState(config);
            state.taskQueue = batchQueue.taskQueue;
            state.batchBoundaries = batchQueue.batchBoundaries;
            state.batchLabels = batchQueue.batchLabels;
            state.batchParallelizable = batchQueue.batchParallelizable;
        }
        // 执行流水线
        const summary = await assemblyLine.run(state);
        pipelineCompleted = true;
        // 生成报告
        await reporter.generateSummaryReport(summary);
        // 输出结果
        if (config.jsonOutput) {
            console.log(JSON.stringify(summaryToJSON(summary), null, 2));
        }
        else {
            printSummary(summary);
        }
    }
    catch (error) {
        assemblyLine.forceFailStatus(error);
        console.error('❌ 执行失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
    finally {
        // 仅在流水线正常完成时清理运行时状态（保留 --continue 恢复能力）
        if (pipelineCompleted) {
            clearRuntimeState(cwd);
        }
        // CP-5: 流水线退出时清理快照（正常清理，异常保留供诊断）
        if (currentSnapshotId && pipelineCompleted) {
            if (cleanupSnapshot(currentSnapshotId, cwd)) {
                console.log(`   🧹 计划快照已清理: ${currentSnapshotId}`);
            }
            currentSnapshotId = null;
        }
        else if (currentSnapshotId) {
            // 异常退出时保留快照，但输出路径供诊断
            console.log(`   💾 计划快照保留供诊断: .projmnt4claude/runs/${currentSnapshotId}`);
        }
        // 移除信号处理
        process.removeListener('SIGINT', gracefulShutdown);
        process.removeListener('SIGTERM', gracefulShutdown);
    }
}
/**
 * 运行时状态文件路径
 */
function getRuntimeStatePath(cwd) {
    return path.join(getProjectDir(cwd), 'harness-state.json');
}
/**
 * 加载运行时状态
 */
export function loadRuntimeState(cwd) {
    const statePath = getRuntimeStatePath(cwd);
    if (!fs.existsSync(statePath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(statePath, 'utf-8');
        const data = JSON.parse(content);
        // 版本检查与自动迁移
        // v1 → v2: wait_evaluation 状态支持（新增 evaluation 阶段）
        const version = data.stateFormatVersion ?? 0;
        if (version < 1 || version > 2) {
            console.warn(`状态文件版本不匹配 (v${version})，重置运行时状态`);
            return null;
        }
        // v1 → v2 自动迁移
        if (version === 1) {
            // v1 不含 evaluation 阶段的重试计数，补空
            // resumeFrom 中可能缺少 evaluation 相关键值，无需特殊处理
            // （Map 反序列化时 evaluation 键不存在即视为未设置，等同于从头开始）
            data.stateFormatVersion = 2;
            console.log('📦 状态文件从 v1 自动迁移到 v2');
        }
        // 防御性编程：确保所有Map字段都被正确初始化
        // 恢复 Map（修复：添加 phaseRetryCounters 恢复）
        data.retryCounter = new Map(Object.entries(data.retryCounter || {}));
        data.taskResults = new Map(Object.entries(data.taskResults || {}));
        data.resumeFrom = new Map(Object.entries(data.resumeFrom || {}));
        data.reevaluateCounter = new Map(Object.entries(data.reevaluateCounter || {}));
        data.phaseRetryCounters = new Map(Object.entries(data.phaseRetryCounters || {}));
        // v1/v2 兼容：旧版不含 taskPhaseCheckpoints，补空 Map
        data.taskPhaseCheckpoints = new Map(Object.entries(data.taskPhaseCheckpoints || {}));
        return data;
    }
    catch (error) {
        // 降级处理：日志记录错误但返回null而非抛出异常
        console.warn('加载运行时状态失败，重置状态:', error);
        return null;
    }
}
/**
 * 保存运行时状态
 */
export function saveRuntimeState(state, cwd) {
    const statePath = getRuntimeStatePath(cwd);
    const data = {
        ...state,
        // 版本标记：便于未来版本演进时识别状态文件格式
        // v2: wait_evaluation 状态支持
        stateFormatVersion: 2,
        retryCounter: Object.fromEntries(state.retryCounter),
        resumeFrom: Object.fromEntries(state.resumeFrom || []),
        reevaluateCounter: Object.fromEntries(state.reevaluateCounter || []),
        // 修复：添加 phaseRetryCounters 保存
        phaseRetryCounters: Object.fromEntries(state.phaseRetryCounters || []),
        taskPhaseCheckpoints: Object.fromEntries(state.taskPhaseCheckpoints || []),
    };
    fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
}
/**
 * 清理运行时状态
 */
function clearRuntimeState(cwd) {
    const statePath = getRuntimeStatePath(cwd);
    if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
    }
}
/**
 * 将摘要转换为 JSON 可序列化格式
 */
function summaryToJSON(summary) {
    return {
        totalTasks: summary.totalTasks,
        passed: summary.passed,
        failed: summary.failed,
        totalRetries: summary.totalRetries,
        duration: summary.duration,
        startTime: summary.startTime,
        endTime: summary.endTime,
        config: summary.config,
        taskResults: Object.fromEntries(Array.from(summary.taskResults.entries()).map(([taskId, record]) => [
            taskId,
            {
                taskId: record.taskId,
                retryCount: record.retryCount,
                finalStatus: record.finalStatus,
                devStatus: record.devReport.status,
                reviewResult: record.reviewVerdict?.result,
            },
        ])),
    };
}
/**
 * 加载任务队列 - 3级优先级（批次感知版）
 *
 * 优先级1: 显式指定的文件（--plan）
 * 优先级2: 读取项目计划（.projmnt4claude/current-plan.json）
 * 优先级3: 自动生成计划
 */
async function loadTaskQueue(options, cwd) {
    // 优先级1: 显式指定的文件
    if (options.plan) {
        const planFile = path.resolve(cwd, options.plan);
        if (!fs.existsSync(planFile)) {
            console.error(`错误: 计划文件不存在: ${planFile}`);
            process.exit(1);
        }
        try {
            const planContent = fs.readFileSync(planFile, 'utf-8');
            const planData = JSON.parse(planContent);
            let taskQueue = planData.recommendation?.suggestedOrder || [];
            const batches = planData.batchOrder || planData.batches;
            if (taskQueue.length === 0) {
                console.error('错误: 计划文件中没有任务');
                process.exit(1);
            }
            // CP-19: 仅过滤终态任务，信任计划排序处理依赖关系
            const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'abandoned', 'failed']);
            const originalCount = taskQueue.length;
            taskQueue = taskQueue.filter((id) => {
                const task = readTaskMeta(id, cwd);
                if (!task)
                    return false;
                return !TERMINAL_STATUSES.has(normalizeStatus(task.status));
            });
            if (originalCount - taskQueue.length > 0) {
                console.log(`📋 使用计划文件: ${options.plan} (已过滤 ${originalCount - taskQueue.length} 个终态任务)`);
            }
            else {
                console.log(`📋 使用计划文件: ${options.plan}`);
            }
            return buildBatchAwareQueue(taskQueue, batches);
        }
        catch (error) {
            console.error(`错误: 无法解析计划文件: ${planFile}`);
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    }
    // 优先级2: 读取项目计划
    const executionPlan = readPlan(cwd);
    if (executionPlan && executionPlan.tasks.length > 0) {
        const queue = filterExecutableFromPlan(executionPlan, cwd, '📋 使用项目执行计划');
        if (queue.taskQueue.length > 0) {
            return queue;
        }
        console.log('⚠️  执行计划中所有任务均已处于终态');
    }
    // 优先级3: 自动生成
    console.log('🔍 未找到执行计划，正在自动生成...');
    try {
        await recommendPlan({ nonInteractive: true, json: false }, cwd);
        const newPlan = readPlan(cwd);
        if (newPlan && newPlan.tasks.length > 0) {
            const queue = filterExecutableFromPlan(newPlan, cwd, '✅ 已自动生成执行计划');
            if (queue.taskQueue.length > 0) {
                return queue;
            }
        }
    }
    catch (error) {
        console.error('警告: 自动生成计划失败:', error instanceof Error ? error.message : String(error));
    }
    console.error('错误: 无法获取任务列表');
    console.error('提示: 请先运行 `projmnt4claude plan recommend` 生成执行计划');
    process.exit(1);
}
/**
 * 从执行计划中过滤可执行任务并构建批次感知队列
 *
 * 批次感知过滤策略（CP-19 修复）：
 * - 信任计划批次排序，不过滤依赖未满足的后续批次任务
 * - 仅排除终态任务（resolved/closed/abandoned/failed），避免重复执行
 * - 依赖完成检查由 AssemblyLine.checkDependencies() 在运行时逐任务执行
 * - 这确保后续批次任务在前序批次完成后仍可执行
 */
function filterExecutableFromPlan(plan, cwd, logPrefix) {
    // 终态集合：已完成/失败/放弃的任务不再执行
    const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'abandoned', 'failed']);
    // 仅过滤终态任务，信任计划排序处理依赖关系
    // CP-9: 使用 normalizeStatus 确保状态比较标准化
    const filteredTasks = plan.tasks.filter(taskId => {
        const task = readTaskMeta(taskId, cwd);
        if (!task)
            return false;
        return !TERMINAL_STATUSES.has(normalizeStatus(task.status));
    });
    const filteredCount = plan.tasks.length - filteredTasks.length;
    if (filteredCount > 0) {
        console.log(`${logPrefix} (已过滤 ${filteredCount} 个终态任务)`);
    }
    else {
        console.log(logPrefix);
    }
    // 重建 batches：过滤已移除的任务，移除空批次，确保与 filteredTasks 一致
    const filteredSet = new Set(filteredTasks);
    const rebuiltBatches = (plan.batches || [])
        .map(batch => batch.filter(taskId => filteredSet.has(taskId)))
        .filter(batch => batch.length > 0);
    return buildBatchAwareQueue(filteredTasks, rebuiltBatches);
}
/**
 * 打印执行摘要
 */
function printSummary(summary) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('📊 执行摘要');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`   总任务数: ${summary.totalTasks}`);
    console.log(`   ✅ 通过: ${summary.passed}`);
    console.log(`   ❌ 失败: ${summary.failed}`);
    console.log(`   🔄 重试: ${summary.totalRetries}`);
    console.log(`   ⏱️  耗时: ${(summary.duration / 1000).toFixed(1)}s`);
    console.log('');
    if (summary.failed > 0) {
        console.log('❌ 失败的任务:');
        for (const [taskId, record] of summary.taskResults) {
            if (record.reviewVerdict?.result === 'NOPASS' || record.devReport.status === 'failed') {
                console.log(`   - ${taskId}: ${record.reviewVerdict?.reason || record.devReport.error || '未知错误'}`);
            }
        }
        console.log('');
    }
    console.log('━'.repeat(SEPARATOR_WIDTH));
    if (summary.failed === 0) {
        console.log('✅ 所有任务执行成功！');
    }
    else {
        console.log(`⚠️  部分任务失败，请检查报告获取详情`);
    }
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('📊 流水线状态已保存到: .projmnt4claude/harness-status.json');
    console.log('💡 查询进度: cat .projmnt4claude/harness-status.json');
    console.log('━'.repeat(SEPARATOR_WIDTH));
}
