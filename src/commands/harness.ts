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
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarnessConfig,
  ExecutionSummary,
  HarnessRuntimeState,
} from '../types/harness.js';
import {
  DEFAULT_HARNESS_CONFIG,
  createDefaultRuntimeState,
} from '../types/harness.js';
import { isInitialized, getProjectDir } from '../utils/path.js';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { HarnessReporter } from '../utils/harness-reporter.js';
import { readPlan } from '../utils/plan.js';
import { readTaskMeta } from '../utils/task.js';
import { SEPARATOR_WIDTH } from '../utils/format';
import { recommendPlan } from './plan.js';
import {
  batchCheckQualityGate,
  formatBatchQualityGateResult,
  showQualityImprovementGuide,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
} from '../utils/quality-gate.js';

/**
 * 命令选项
 */
export interface HarnessCommandOptions {
  plan?: string;
  maxRetries?: string;
  timeout?: string;
  parallel?: string;
  dryRun?: boolean;
  continue?: boolean;
  json?: boolean;
  apiRetryAttempts?: string;
  apiRetryDelay?: string;
  /** 最低质量分阈值 (0-100) */
  requireQuality?: string;
  /** 跳过质量门禁检查 */
  skipQualityGate?: boolean;
}

/**
 * 主命令入口
 */
export async function harnessCommand(
  options: HarnessCommandOptions,
  cwd: string = process.cwd()
): Promise<void> {
  // 检查项目初始化
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 构建质量门禁配置
  const qualityGateConfig: QualityGateConfig = {
    ...DEFAULT_QUALITY_GATE_CONFIG,
    minQualityScore: options.requireQuality
      ? parseInt(options.requireQuality, 10)
      : DEFAULT_QUALITY_GATE_CONFIG.minQualityScore,
    enabled: !options.skipQualityGate,
  };

  // 验证质量分阈值
  if (qualityGateConfig.minQualityScore < 0 || qualityGateConfig.minQualityScore > 100) {
    console.error('错误: --require-quality 必须在 0-100 之间');
    process.exit(1);
  }

  // 构建配置
  const config: HarnessConfig = {
    ...DEFAULT_HARNESS_CONFIG,
    maxRetries: options.maxRetries ? parseInt(options.maxRetries, 10) : DEFAULT_HARNESS_CONFIG.maxRetries,
    timeout: options.timeout ? parseInt(options.timeout, 10) : DEFAULT_HARNESS_CONFIG.timeout,
    parallel: options.parallel ? parseInt(options.parallel, 10) : DEFAULT_HARNESS_CONFIG.parallel,
    dryRun: options.dryRun ?? DEFAULT_HARNESS_CONFIG.dryRun,
    continue: options.continue ?? DEFAULT_HARNESS_CONFIG.continue,
    jsonOutput: options.json ?? DEFAULT_HARNESS_CONFIG.jsonOutput,
    apiRetryAttempts: options.apiRetryAttempts ? parseInt(options.apiRetryAttempts, 10) : DEFAULT_HARNESS_CONFIG.apiRetryAttempts,
    apiRetryDelay: options.apiRetryDelay ? parseInt(options.apiRetryDelay, 10) : DEFAULT_HARNESS_CONFIG.apiRetryDelay,
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
  const taskQueue = await loadTaskQueue(options, cwd);

  if (taskQueue.length === 0) {
    console.error('错误: 没有可执行的任务');
    process.exit(1);
  }

  // 输出配置信息
  if (!config.jsonOutput) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🚀 Harness Design 执行模式');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`📋 计划文件: ${options.plan}`);
    console.log(`📊 任务数量: ${taskQueue.length}`);
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
    taskQueue.forEach((taskId, index) => {
      console.log(`   ${index + 1}. ${taskId}`);
    });
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

    const batchResult = batchCheckQualityGate(taskQueue, qualityGateConfig, cwd);

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
      console.log('   4. 使用 --skip-quality-gate 跳过质量检查（不推荐）');
      console.log('   5. 使用 --require-quality N 调整质量分阈值（默认 60）');
      console.log('');
      process.exit(1);
    }

    console.log('✅ 所有任务通过质量门禁检查');
    console.log('');
  }

  // 创建 AssemblyLine 并执行
  const assemblyLine = new AssemblyLine(config);
  const reporter = new HarnessReporter(config);

  try {
    // 加载或创建运行时状态
    let state: HarnessRuntimeState | null;
    if (config.continue) {
      state = loadRuntimeState(cwd);
      if (state) {
        console.log(`📦 从中断处继续 (任务 ${state.currentIndex + 1}/${state.taskQueue.length})`);
      } else {
        console.log('📦 没有找到之前的执行状态，从头开始');
        state = createDefaultRuntimeState(config);
        state.taskQueue = taskQueue;
      }
    } else {
      state = createDefaultRuntimeState(config);
      state.taskQueue = taskQueue;
    }

    // 执行流水线
    const summary = await assemblyLine.run(state);

    // 生成报告
    await reporter.generateSummaryReport(summary);

    // 清理运行时状态
    clearRuntimeState(cwd);

    // 输出结果
    if (config.jsonOutput) {
      console.log(JSON.stringify(summaryToJSON(summary), null, 2));
    } else {
      printSummary(summary);
    }

  } catch (error) {
    console.error('❌ 执行失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 运行时状态文件路径
 */
function getRuntimeStatePath(cwd: string): string {
  return path.join(getProjectDir(cwd), 'harness-state.json');
}

/**
 * 加载运行时状态
 */
function loadRuntimeState(cwd: string): HarnessRuntimeState | null {
  const statePath = getRuntimeStatePath(cwd);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const data = JSON.parse(content);
    // 恢复 Map
    data.retryCounter = new Map(Object.entries(data.retryCounter || {}));
    data.taskResults = new Map(Object.entries(data.taskResults || {}));
    return data;
  } catch {
    return null;
  }
}

/**
 * 保存运行时状态
 */
export function saveRuntimeState(state: HarnessRuntimeState, cwd: string): void {
  const statePath = getRuntimeStatePath(cwd);
  const data = {
    ...state,
    retryCounter: Object.fromEntries(state.retryCounter),
  };
  fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 清理运行时状态
 */
function clearRuntimeState(cwd: string): void {
  const statePath = getRuntimeStatePath(cwd);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

/**
 * 将摘要转换为 JSON 可序列化格式
 */
function summaryToJSON(summary: ExecutionSummary): Record<string, unknown> {
  return {
    totalTasks: summary.totalTasks,
    passed: summary.passed,
    failed: summary.failed,
    totalRetries: summary.totalRetries,
    duration: summary.duration,
    startTime: summary.startTime,
    endTime: summary.endTime,
    config: summary.config,
    taskResults: Object.fromEntries(
      Array.from(summary.taskResults.entries()).map(([taskId, record]) => [
        taskId,
        {
          taskId: record.taskId,
          retryCount: record.retryCount,
          finalStatus: record.finalStatus,
          devStatus: record.devReport.status,
          reviewResult: record.reviewVerdict?.result,
        },
      ])
    ),
  };
}

/**
 * 加载任务队列 - 3级优先级
 *
 * 优先级1: 显式指定的文件（--plan）
 * 优先级2: 读取项目计划（.projmnt4claude/current-plan.json）
 * 优先级3: 自动生成计划
 */
async function loadTaskQueue(options: HarnessCommandOptions, cwd: string): Promise<string[]> {
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
      const taskQueue = planData.recommendation?.suggestedOrder || [];

      if (taskQueue.length === 0) {
        console.error('错误: 计划文件中没有任务');
        process.exit(1);
      }

      console.log(`📋 使用计划文件: ${options.plan}`);
      return taskQueue;
    } catch (error) {
      console.error(`错误: 无法解析计划文件: ${planFile}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // 优先级2: 读取项目计划
  const executionPlan = readPlan(cwd);
  if (executionPlan && executionPlan.tasks.length > 0) {
    const terminalStatuses = new Set(['resolved', 'closed', 'abandoned']);
    const filteredTasks = executionPlan.tasks.filter(taskId => {
      const meta = readTaskMeta(taskId, cwd);
      if (!meta) return false; // 任务不存在则跳过
      return !terminalStatuses.has(meta.status);
    });

    const filteredCount = executionPlan.tasks.length - filteredTasks.length;
    if (filteredCount > 0) {
      console.log(`📋 使用项目执行计划 (已过滤 ${filteredCount} 个终态任务)`);
    } else {
      console.log('📋 使用项目执行计划');
    }

    if (filteredTasks.length > 0) {
      return filteredTasks;
    }
    console.log('⚠️  执行计划中所有任务均已处于终态');
  }

  // 优先级3: 自动生成
  console.log('🔍 未找到执行计划，正在自动生成...');

  try {
    await recommendPlan({ nonInteractive: true, json: false }, cwd);

    const newPlan = readPlan(cwd);
    if (newPlan && newPlan.tasks.length > 0) {
      const terminalStatuses = new Set(['resolved', 'closed', 'abandoned']);
      const filteredTasks = newPlan.tasks.filter(taskId => {
        const meta = readTaskMeta(taskId, cwd);
        if (!meta) return false;
        return !terminalStatuses.has(meta.status);
      });

      const filteredCount = newPlan.tasks.length - filteredTasks.length;
      if (filteredCount > 0) {
        console.log(`✅ 已自动生成执行计划 (已过滤 ${filteredCount} 个终态任务)`);
      } else {
        console.log('✅ 已自动生成执行计划');
      }

      if (filteredTasks.length > 0) {
        return filteredTasks;
      }
    }
  } catch (error) {
    console.error('警告: 自动生成计划失败:', error instanceof Error ? error.message : String(error));
  }

  console.error('错误: 无法获取任务列表');
  console.error('提示: 请先运行 `projmnt4claude plan recommend` 生成执行计划');
  process.exit(1);
}

/**
 * 打印执行摘要
 */
function printSummary(summary: ExecutionSummary): void {
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
  } else {
    console.log(`⚠️  部分任务失败，请检查报告获取详情`);
  }
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 流水线状态已保存到: .projmnt4claude/harness-status.json');
  console.log('💡 查询进度: cat .projmnt4claude/harness-status.json');
  console.log('━'.repeat(SEPARATOR_WIDTH));
}
