/**
 * HarnessEvaluator - 审查阶段评估器
 *
 * 关键特性：上下文隔离
 * - 在独立的 Claude 会话中执行
 * - 无法访问开发阶段的上下文
 * - 只通过文件系统获取信息
 * - 独立判断开发结果是否满足验收标准
 */
import * as fs from 'fs';
import * as path from 'path';
import { getProjectDir } from './path.js';
import { readTaskMeta, getAllTaskIds } from './task.js';
import { archiveReportIfExists, parseStructuredResult } from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { verdictResultMarker, verdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { getLatestSnapshot } from './harness-snapshot.js';
export class HarnessEvaluator {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * 评估开发结果
     *
     * 关键：此方法在独立上下文中运行，不共享开发阶段的任何状态
     */
    async evaluate(task, devReport, contract, retryContext) {
        console.log(`   评估任务: ${task.title}`);
        console.log(`   开发状态: ${devReport.status}`);
        const verdict = {
            taskId: task.id,
            result: 'NOPASS',
            reason: '',
            failedCriteria: [],
            failedCheckpoints: [],
            reviewedAt: new Date().toISOString(),
            reviewedBy: 'architect',
        };
        // 如果开发阶段失败，直接返回 NOPASS
        if (devReport.status !== 'success') {
            verdict.result = 'NOPASS';
            verdict.reason = `开发阶段未成功完成: ${devReport.status}`;
            verdict.inferenceType = 'explicit_match'; // 开发阶段直接判定，非解析推断
            if (devReport.error) {
                verdict.reason += ` - ${devReport.error}`;
            }
            await this.saveReviewReport(task.id, verdict, devReport);
            return verdict;
        }
        try {
            // 1. 加载 Sprint Contract（从文件系统，确保隔离）
            // BUG-013-1: 安全合并，仅覆盖已验证的字段
            const loadedContract = this.loadContract(task.id);
            if (loadedContract) {
                // 仅在加载值非空时覆盖，防止用 undefined 覆盖默认值
                contract.taskId = loadedContract.taskId;
                contract.acceptanceCriteria = loadedContract.acceptanceCriteria.length > 0
                    ? loadedContract.acceptanceCriteria : contract.acceptanceCriteria;
                contract.verificationCommands = loadedContract.verificationCommands.length > 0
                    ? loadedContract.verificationCommands : contract.verificationCommands;
                contract.checkpoints = loadedContract.checkpoints.length > 0
                    ? loadedContract.checkpoints : contract.checkpoints;
                contract.createdAt = loadedContract.createdAt;
                contract.updatedAt = loadedContract.updatedAt;
            }
            // 2. 检测幽灵任务（开发者在执行期间创建的额外任务）
            const phantomTasks = this.detectPhantomTasks(task.id, devReport);
            // 幽灵任务为严重违规，自动 NOPASS（无需运行评估会话）
            if (phantomTasks.length > 0) {
                verdict.result = 'NOPASS';
                verdict.reason = `严重违规：开发者在执行期间创建了 ${phantomTasks.length} 个额外任务 (${phantomTasks.join(', ')}). 开发者被严格禁止创建新任务。`;
                verdict.failedCriteria = ['禁止创建新任务'];
                verdict.failedCheckpoints = phantomTasks.map(tid => `幽灵任务: ${tid}`);
                verdict.details = `检测到开发者创建了不属于原始计划的额外任务。这违反了开发者职责范围——开发者只应实现被分配任务的代码变更，而非创建新任务。`;
                verdict.inferenceType = 'explicit_match'; // 幽灵任务是确定性检测，非解析推断
                console.log(`\n   ❌ 检测到幽灵任务，自动 NOPASS`);
                await this.saveReviewReport(task.id, verdict, devReport);
                return verdict;
            }
            // 3. 构建评估提示词
            const prompt = this.buildEvaluationPrompt(task, devReport, contract, phantomTasks, retryContext);
            console.log('\n   📝 评估提示词已生成');
            // 4. 运行评估会话（使用 FeedbackConstraintEngine 带格式重试，最多 2 次）
            const agent = getAgent(this.config.cwd);
            const effectiveTools = buildEffectiveTools('evaluation', this.config.cwd, task);
            const invokeOptions = {
                allowedTools: effectiveTools.tools,
                timeout: Math.floor(this.config.timeout / 2), // 审查时间较短
                outputFormat: 'text',
                maxRetries: this.config.apiRetryAttempts,
                cwd: this.config.cwd,
                dangerouslySkipPermissions: effectiveTools.skipPermissions,
            };
            console.log('\n   🔍 启动独立评估会话...');
            const engine = createSessionAwareEngine('markdown', [verdictResultMarker, verdictHasReason], 2);
            const engineResult = await engine.runWithFeedback(agent.invoke.bind(agent), prompt, invokeOptions);
            if (engineResult.retries > 0) {
                console.log(`   🔄 评估结果格式不匹配，已重试 ${engineResult.retries} 次`);
            }
            const lastRawOutput = engineResult.result.output ?? '';
            // 4.5 保存原始评估输出（用于事后诊断）
            this.saveRawEvaluationOutput(task.id, engineResult.result.output, engineResult.result.stderr || '', engineResult.result.success);
            // 4.6 检测空输出（Claude 进程异常退出）
            if (!engineResult.result.output || engineResult.result.output.trim().length === 0) {
                verdict.result = 'NOPASS';
                verdict.reason = `评估会话输出为空：Claude 进程可能异常退出${engineResult.result.stderr ? ` (stderr: ${engineResult.result.stderr.substring(0, 200)})` : ''}`;
                verdict.inferenceType = 'empty_output';
                console.log('\n   ❌ 评估输出为空，Claude 进程可能异常退出');
                if (engineResult.result.stderr) {
                    console.log(`   📝 stderr: ${engineResult.result.stderr.substring(0, 300)}`);
                }
                await this.saveReviewReport(task.id, verdict, devReport);
                return verdict;
            }
            // 5. 解析评估结果
            let evaluation = this.parseEvaluationResult(engineResult.result.output);
            // CP-16: 重试后仍无法解析时，默认 PASS（保守策略）
            if (evaluation.inferenceType === 'parse_failure_default') {
                console.log('   ⚠️ 重试后仍无法解析评估结果，默认 PASS（保守策略）');
                evaluation = {
                    ...evaluation,
                    passed: true,
                    reason: `重试 ${engineResult.retries} 次后仍无法解析评估结果，采用保守策略默认通过`,
                };
            }
            verdict.result = evaluation.passed ? 'PASS' : 'NOPASS';
            verdict.reason = evaluation.reason;
            verdict.failedCriteria = evaluation.failedCriteria;
            verdict.failedCheckpoints = evaluation.failedCheckpoints;
            verdict.details = evaluation.details;
            verdict.action = evaluation.action;
            verdict.failureCategory = evaluation.failureCategory;
            verdict.inferenceType = evaluation.inferenceType;
            // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
            const contradiction = detectContradiction(verdict.result, lastRawOutput || verdict.reason || '');
            if (contradiction.hasContradiction && contradiction.correctedResult) {
                console.log(`   ⚠️  矛盾检测: ${contradiction.reason}`);
                verdict.result = contradiction.correctedResult;
                verdict.reason += ` [矛盾修正: ${contradiction.reason}]`;
            }
            if (verdict.result === 'PASS') {
                console.log(`\n   ✅ 审查通过 [推断类型: ${verdict.inferenceType || 'unknown'}]`);
            }
            else {
                console.log(`\n   ❌ 审查未通过 [推断类型: ${verdict.inferenceType || 'unknown'}]: ${verdict.reason}`);
            }
        }
        catch (error) {
            verdict.result = 'NOPASS';
            verdict.reason = `评估过程出错: ${error instanceof Error ? error.message : String(error)}`;
            verdict.inferenceType = 'parse_failure_default';
            console.log(`\n   ❌ 评估出错: ${verdict.reason}`);
        }
        // 保存审查报告
        await this.saveReviewReport(task.id, verdict, devReport);
        return verdict;
    }
    /**
     * 构建评估提示词
     */
    buildEvaluationPrompt(task, devReport, contract, phantomTasks = [], retryContext) {
        // BUG-014-2A: 过滤掉 requiresHuman 检查点，仅评估自动化检查点
        // BUG-013-1: 防御性处理，确保数组字段始终为有效数组
        const contractCheckpoints = Array.isArray(contract.checkpoints) ? contract.checkpoints : [];
        const contractCriteria = Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria : [];
        const contractCommands = Array.isArray(contract.verificationCommands) ? contract.verificationCommands : [];
        const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];
        const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];
        const humanCheckpointIds = new Set();
        const humanCheckpointDescs = new Set();
        if (task.checkpoints) {
            for (const cp of task.checkpoints) {
                if (cp.requiresHuman === true) {
                    humanCheckpointIds.add(cp.id);
                    humanCheckpointDescs.add(cp.description);
                }
            }
        }
        const isHumanCheckpoint = (cp) => humanCheckpointIds.has(cp) || humanCheckpointDescs.has(cp);
        const filteredContractCheckpoints = contractCheckpoints.filter(cp => !isHumanCheckpoint(cp));
        const filteredDevCheckpoints = devCheckpointsCompleted.filter(cp => !isHumanCheckpoint(cp));
        // Build section variables (each non-empty section ends with \n for blank-line separation)
        const descriptionSection = task.description
            ? `## 任务描述\n${task.description}\n`
            : '';
        const acceptanceCriteriaList = contractCriteria.length > 0
            ? `${contractCriteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}\n`
            : '（未定义具体验收标准，请根据任务描述判断）\n';
        const verificationCommandsSection = contractCommands.length > 0
            ? `## 验证命令\n请运行以下命令验证实现:\n\`\`\`bash\n${contractCommands.join('\n')}\n\`\`\`\n`
            : '';
        const checkpointsSection = filteredContractCheckpoints.length > 0
            ? `## 检查点\n请确认以下检查点是否完成:\n${filteredContractCheckpoints.map((cp, i) => `${i + 1}. ${cp}`).join('\n')}\n`
            : '';
        const humanCheckpointsSection = humanCheckpointIds.size > 0
            ? `## 关于人工验证检查点\n本任务有 ${humanCheckpointIds.size} 个需要人工验证的检查点（如 ${Array.from(humanCheckpointIds).slice(0, 3).join(', ')}）。\n这些检查点由后处理流程单独管理，不在本评估范围内。请仅基于上方的自动化检查点进行判断。\n`
            : '';
        const evidenceSection = devEvidence.length > 0
            ? `## 提交的证据\n开发者提交了以下证据:\n${devEvidence.map(e => `- ${e}`).join('\n')}\n`
            : '';
        const completedCheckpointsSection = filteredDevCheckpoints.length > 0
            ? `## 开发者声明的完成检查点\n${filteredDevCheckpoints.map(cp => `- ${cp}`).join('\n')}\n`
            : '';
        const phantomTasksSection = phantomTasks.length > 0
            ? `## ⚠️ 幽灵任务检测\n**严重违规**: 开发者在执行任务期间创建了 ${phantomTasks.length} 个额外任务:\n${phantomTasks.map(tid => `- ${tid}`).join('\n')}\n\n开发者被严格禁止创建新任务。这是一个自动 NOPASS 的严重违规。\n请在评估结果中明确标注此违规，并将结果设为 NOPASS。\n`
            : '';
        const template = loadPromptTemplate('evaluation', this.config.cwd);
        // Build retry context section if present
        let retryContextSection = '';
        if (retryContext?.previousFailureReason) {
            const phaseLabel = {
                development: '开发',
                code_review: '代码审核',
                qa: 'QA 验证',
                evaluation: '评估',
            };
            const lines = [
                `## 重试上下文（前次评估失败信息）`,
                ``,
                `这是第 ${retryContext.attemptNumber} 次评估尝试。上一次在 **${phaseLabel[retryContext.previousPhase || ''] || retryContext.previousPhase}** 阶段失败。`,
                ``,
                `**前次失败原因:**`,
                `> ${retryContext.previousFailureReason}`,
                ``,
                `请参考前次失败原因，确保本次评估覆盖所有问题。`,
                ``,
            ];
            retryContextSection = lines.join('\n');
        }
        const result = resolveTemplate(template, {
            taskId: task.id,
            title: task.title,
            type: task.type,
            descriptionSection,
            acceptanceCriteriaList,
            verificationCommandsSection,
            checkpointsSection,
            humanCheckpointsSection,
            evidenceSection,
            completedCheckpointsSection,
            phantomTasksSection,
            retryContextSection,
        });
        // Normalize: collapse 3+ consecutive newlines into 2 (handles empty section placeholders)
        return result.replace(/\n{3,}/g, '\n\n');
    }
    /**
     * 解析评估结果
     */
    parseEvaluationResult(output) {
        const result = {
            passed: false,
            reason: '',
            failedCriteria: [],
            failedCheckpoints: [],
            details: '',
            action: undefined,
            failureCategory: undefined,
            inferenceType: 'parse_failure_default',
        };
        // 空输出早期返回：Claude 进程异常退出导致 stdout 为空
        if (!output || output.trim().length === 0) {
            result.reason = '评估输出为空，无法解析评估结果';
            result.inferenceType = 'empty_output';
            return result;
        }
        // 使用结构化关键词匹配（替代多模式匹配和中文情感判断）
        const structured = parseStructuredResult(output);
        if (structured.passed !== null) {
            result.passed = structured.passed;
            result.inferenceType = structured.matchLevel === 1 ? 'structured_match' : 'explicit_match';
        }
        // 提取原因 - 多种格式
        const reasonPatterns = [
            /##\s*原因\s*[:：]\s*(.+?)(?=##|$)/si,
            /(?:原因|Reason)[:：]?\s*(.+?)(?=##|##|$)/si,
            /\*\*原因\*\*[:：]?\s*(.+?)(?=\*\*|##|$)/si,
        ];
        for (const pattern of reasonPatterns) {
            const match = output.match(pattern);
            if (match) {
                result.reason = match[1].trim();
                break;
            }
        }
        // 提取未满足的标准
        const criteriaPatterns = [
            /##\s*未满足的标准\s*[:：]\s*(.+?)(?=##|$)/si,
            /(?:未满足的标准|Failed Criteria)[:：]?\s*(.+?)(?=##|$)/si,
        ];
        for (const pattern of criteriaPatterns) {
            const match = output.match(pattern);
            if (match) {
                const criteriaText = match[1].trim();
                if (criteriaText && criteriaText !== '无' && criteriaText !== 'N/A' && criteriaText !== 'None') {
                    result.failedCriteria = criteriaText.split('\n')
                        .map(line => line.replace(/^[-*]\s*/, '').trim())
                        .filter(line => line.length > 0);
                }
                break;
            }
        }
        // 提取未完成的检查点
        const checkpointsPatterns = [
            /##\s*未完成的检查点\s*[:：]\s*(.+?)(?=##|$)/si,
            /(?:未完成的检查点|Failed Checkpoints)[:：]?\s*(.+?)(?=##|$)/si,
        ];
        for (const pattern of checkpointsPatterns) {
            const match = output.match(pattern);
            if (match) {
                const checkpointsText = match[1].trim();
                if (checkpointsText && checkpointsText !== '无' && checkpointsText !== 'N/A' && checkpointsText !== 'None') {
                    result.failedCheckpoints = checkpointsText.split('\n')
                        .map(line => line.replace(/^[-*]\s*/, '').trim())
                        .filter(line => line.length > 0);
                }
                break;
            }
        }
        // 提取详细反馈
        const detailsPatterns = [
            /##\s*详细反馈\s*[:：]\s*(.+?)(?=##|$)/si,
            /(?:详细反馈|Details|Feedback)[:：]?\s*(.+?)(?=##|$)/si,
        ];
        for (const pattern of detailsPatterns) {
            const match = output.match(pattern);
            if (match) {
                result.details = match[1].trim();
                break;
            }
        }
        // 提取后续动作（action）
        const actionPatterns = [
            /##\s*后续动作\s*[:：]\s*(resolve|redevelop|retest|reevaluate|escalate_human)/i,
            /(?:后续动作|Action|Verdict Action|Next Action)[:：]?\s*(resolve|redevelop|retest|reevaluate|escalate_human)/i,
        ];
        for (const pattern of actionPatterns) {
            const match = output.match(pattern);
            if (match) {
                result.action = match[1].toLowerCase();
                break;
            }
        }
        // 提取失败分类（failureCategory）
        const categoryPatterns = [
            /##\s*失败分类\s*[:：]\s*(acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other)/i,
            /(?:失败分类|Failure Category|Category)[:：]?\s*(acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other)/i,
        ];
        for (const pattern of categoryPatterns) {
            const match = output.match(pattern);
            if (match) {
                result.failureCategory = match[1].toLowerCase();
                break;
            }
        }
        // 如果没有提取到原因，设置默认值
        if (!result.reason) {
            if (result.passed) {
                result.reason = '基于结构化关键词匹配：评估通过';
            }
            else if (structured.passed !== null) {
                result.reason = '基于结构化关键词匹配：评估未通过';
            }
            else {
                result.reason = '无法解析评估结果';
                result.inferenceType = 'parse_failure_default';
                console.log('   ⚠️  解析失败，原始输出前500字符:');
                console.log(output.substring(0, 500));
            }
        }
        return result;
    }
    /**
     * 检测幽灵任务：开发者在执行期间创建的、不属于原始任务计划的额外任务
     *
     * 检测逻辑（基于计划快照）：
     * 1. 加载流水线计划快照，获取计划内任务 ID 列表
     * 2. 排除计划内的任务（这些任务即使创建时间在开发窗口内也是合法的）
     * 3. 只检测不在计划中的任务，且在开发时间窗口内创建
     *
     * 快照不可用时回退到时间窗口检测（向后兼容）
     *
     * @regression BUG-012-2 (2026-04-01)
     * 回归测试案例：2026-04-01 Harness 运行中，BUG-011-1 开发者为演示 auto-split 功能
     * 创建了 ModeRegistry 和 Channel 两个子任务；BUG-011-3 开发者创建了 6 个认证系统测试任务。
     * 这些"幽灵任务"引用不存在的文件，导致后续重试浪费 3600s 执行时间和 API 配额。
     *
     * @fix P-2 (2026-04-13)
     * 修复幽灵任务误判：基于计划快照排除计划内任务，避免用户在流水线运行期间创建的
     * 合法任务被误判为幽灵任务（如 schema-checkpoint-validation 案例中 11 个钩子清理任务）。
     */
    detectPhantomTasks(currentTaskId, devReport) {
        const phantomTasks = [];
        // 1. 从 Claude 输出中检测 task create / init-requirement 命令
        const output = devReport.claudeOutput || '';
        const taskCreatePatterns = [
            /task\s+create/i,
            /init-requirement/i,
            /创建.*任务/,
            /projmnt4claude\s+(task\s+create|init-requirement)/i,
        ];
        const hasCreateCommand = taskCreatePatterns.some(p => p.test(output));
        // 2. 加载计划快照获取计划内任务列表
        let plannedTaskIds = new Set();
        let usingSnapshot = false;
        let snapshotTaskCount = 0;
        try {
            const snapshot = getLatestSnapshot(this.config.cwd);
            if (snapshot && snapshot.tasks) {
                plannedTaskIds = new Set(snapshot.tasks);
                snapshotTaskCount = snapshot.tasks.length;
                usingSnapshot = true;
                console.log(`   📋 幽灵任务检测使用计划快照: ${snapshot.snapshotId} (${snapshotTaskCount} 个计划任务)`);
            }
            else {
                console.log(`   📋 幽灵任务检测: 未找到计划快照，使用时间窗口回退模式`);
            }
        }
        catch (error) {
            console.log(`   ⚠️ 加载计划快照失败: ${error instanceof Error ? error.message : String(error)}，使用时间窗口回退模式`);
        }
        // 3. 检查文件系统中是否存在由开发者创建的额外任务
        //    基于计划快照排除计划内任务，只检测计划外且在开发窗口内创建的任务
        try {
            const allTaskIds = getAllTaskIds(this.config.cwd);
            let excludedCount = 0;
            for (const tid of allTaskIds) {
                // 跳过当前任务
                if (tid === currentTaskId)
                    continue;
                // 使用快照时：排除计划内的任务
                if (usingSnapshot && plannedTaskIds.has(tid)) {
                    excludedCount++;
                    continue;
                }
                const task = readTaskMeta(tid, this.config.cwd);
                if (!task)
                    continue;
                // 检查任务是否在开发时间窗口内创建
                const taskCreatedAt = task.createdAt;
                const devStartTime = devReport.startTime;
                const devEndTime = devReport.endTime;
                if (taskCreatedAt && devStartTime && devEndTime) {
                    const created = new Date(taskCreatedAt).getTime();
                    const start = new Date(devStartTime).getTime();
                    const end = new Date(devEndTime).getTime();
                    // 任务在开发窗口内创建（允许 60 秒误差）
                    if (created >= start - 60000 && created <= end + 60000) {
                        phantomTasks.push(tid);
                    }
                }
            }
            if (usingSnapshot) {
                console.log(`   📊 幽灵任务检测统计: 总任务 ${allTaskIds.length}, 计划内排除 ${excludedCount}, 计划外检测中 ${allTaskIds.length - excludedCount - 1}`);
            }
        }
        catch (error) {
            console.log(`   ⚠️ 幽灵任务检测出错: ${error instanceof Error ? error.message : String(error)}`);
        }
        // 4. 如果 Claude 输出中包含创建命令但文件系统中未检测到，也记录警告
        if (hasCreateCommand && phantomTasks.length === 0) {
            console.log('   ⚠️ 开发者输出中包含 task create / init-requirement 命令，但未在文件系统中检测到新任务');
            console.log('   ⚠️ 这可能意味着创建操作失败，但意图已存在');
        }
        if (phantomTasks.length > 0) {
            console.log(`   ⚠️ 检测到 ${phantomTasks.length} 个幽灵任务: ${phantomTasks.join(', ')}`);
            if (usingSnapshot) {
                console.log(`   ℹ️  检测模式: 基于计划快照（已排除 ${snapshotTaskCount} 个计划内任务）`);
            }
            else {
                console.log(`   ℹ️  检测模式: 时间窗口回退（建议启用计划快照以提高准确性）`);
            }
        }
        else {
            console.log(`   ✅ 未检测到幽灵任务`);
            if (usingSnapshot) {
                console.log(`   ℹ️  已基于计划快照排除 ${snapshotTaskCount} 个计划内任务`);
            }
        }
        return phantomTasks;
    }
    /**
     * 验证并规范化 SprintContract 数据
     * BUG-013-1: 防止 contract.json 字段缺失导致下游 TypeError
     */
    validateSprintContract(raw, taskId) {
        if (raw === null || raw === undefined || typeof raw !== 'object') {
            return null;
        }
        const obj = raw;
        // taskId 必须匹配或至少存在
        if (obj.taskId !== undefined && typeof obj.taskId !== 'string') {
            return null;
        }
        // 确保数组字段为数组类型，否则使用默认空数组
        const normalizeStringArray = (field) => {
            const val = obj[field];
            return Array.isArray(val) ? val.filter(v => typeof v === 'string') : [];
        };
        // 时间字段必须是字符串
        const normalizeTimestamp = (field, fallback) => {
            const val = obj[field];
            return typeof val === 'string' ? val : fallback;
        };
        const now = new Date().toISOString();
        return {
            taskId: typeof obj.taskId === 'string' ? obj.taskId : taskId,
            acceptanceCriteria: normalizeStringArray('acceptanceCriteria'),
            verificationCommands: normalizeStringArray('verificationCommands'),
            checkpoints: normalizeStringArray('checkpoints'),
            createdAt: normalizeTimestamp('createdAt', now),
            updatedAt: normalizeTimestamp('updatedAt', now),
        };
    }
    /**
     * 加载 Contract
     */
    loadContract(taskId) {
        const contractPath = this.getContractPath(taskId);
        if (!fs.existsSync(contractPath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(contractPath, 'utf-8');
            const parsed = JSON.parse(content);
            const validated = this.validateSprintContract(parsed, taskId);
            if (!validated) {
                console.warn(`   ⚠️ contract.json 存在但数据无效，使用默认 Contract`);
            }
            return validated;
        }
        catch (error) {
            console.warn(`   ⚠️ contract.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /**
     * 获取 Contract 文件路径
     */
    getContractPath(taskId) {
        const projectDir = getProjectDir(this.config.cwd);
        return path.join(projectDir, 'tasks', taskId, 'contract.json');
    }
    /**
     * 获取审查报告路径
     */
    getReviewReportPath(taskId) {
        const projectDir = getProjectDir(this.config.cwd);
        return path.join(projectDir, 'reports', 'harness', taskId, 'review-report.md');
    }
    /**
     * 保存审查报告
     */
    async saveReviewReport(taskId, verdict, devReport) {
        const reportPath = this.getReviewReportPath(taskId);
        const dir = path.dirname(reportPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        archiveReportIfExists(reportPath);
        const content = this.formatReviewReport(verdict, devReport);
        fs.writeFileSync(reportPath, content, 'utf-8');
    }
    /**
     * 保存原始评估输出（用于事后诊断）
     *
     * 当评估会话输出为空或解析失败时，原始输出和 stderr 可用于排查：
     * - Claude 进程是否异常退出（SIGKILL/OOM）
     * - API 限流/认证错误信息
     * - 网络超时细节
     */
    saveRawEvaluationOutput(taskId, output, stderr, success) {
        try {
            const projectDir = getProjectDir(this.config.cwd);
            const dir = path.join(projectDir, 'reports', 'harness', taskId);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rawPath = path.join(dir, `evaluation-raw-${timestamp}.log`);
            const lines = [
                `# 评估会话原始输出`,
                `Task: ${taskId}`,
                `Time: ${new Date().toISOString()}`,
                `Success: ${success}`,
                `Output length: ${output.length}`,
                `Stderr length: ${stderr.length}`,
                '',
                '--- STDOUT ---',
                output || '(empty)',
                '',
                '--- STDERR ---',
                stderr || '(empty)',
            ];
            fs.writeFileSync(rawPath, lines.join('\n'), 'utf-8');
            console.log(`   📄 原始评估输出已保存: evaluation-raw-${timestamp}.log`);
        }
        catch (error) {
            // 日志保存失败不中断主流程
            console.warn(`   ⚠️ 保存原始评估输出失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 格式化审查报告
     */
    formatReviewReport(verdict, devReport) {
        const INFERENCE_TYPE_LABELS = {
            structured_match: '结构化匹配',
            explicit_match: '明确匹配',
            content_inference: '内容推断',
            prior_stage_inference: '前置阶段推断',
            parse_failure_default: '解析失败默认',
            empty_output: '空输出',
        };
        const lines = [
            `# 审查报告 - ${verdict.taskId}`,
            '',
            `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
            `**审查时间**: ${verdict.reviewedAt}`,
            `**审查者**: ${verdict.reviewedBy}`,
        ];
        if (verdict.inferenceType) {
            lines.push(`**推断类型**: ${INFERENCE_TYPE_LABELS[verdict.inferenceType] || verdict.inferenceType} (${verdict.inferenceType})`);
        }
        lines.push('');
        lines.push('## 原因');
        lines.push(verdict.reason);
        lines.push('');
        if (verdict.failedCriteria.length > 0) {
            lines.push('## 未满足的验收标准');
            verdict.failedCriteria.forEach(criteria => {
                lines.push(`- ${criteria}`);
            });
            lines.push('');
        }
        if (verdict.failedCheckpoints.length > 0) {
            lines.push('## 未完成的检查点');
            verdict.failedCheckpoints.forEach(checkpoint => {
                lines.push(`- ${checkpoint}`);
            });
            lines.push('');
        }
        if (verdict.details) {
            lines.push('## 详细反馈');
            lines.push(verdict.details);
            lines.push('');
        }
        // BUG-013-1: 防御性处理，确保数组字段存在
        const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];
        const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];
        lines.push('## 开发阶段信息');
        lines.push(`- 状态: ${devReport.status}`);
        lines.push(`- 耗时: ${(devReport.duration / 1000).toFixed(1)}s`);
        lines.push(`- 证据数量: ${devEvidence.length}`);
        lines.push(`- 完成检查点: ${devCheckpointsCompleted.length}`);
        return lines.join('\n');
    }
}
