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
import type {
  HarnessConfig,
  SprintContract,
  DevReport,
  ReviewVerdict,
  EvaluationInferenceType,
  RetryContext,
} from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';
import { getProjectDir } from './path.js';
import { readTaskMeta, getAllTaskIds } from './task.js';
import { archiveReportIfExists, parseStructuredResult } from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { verdictResultMarker, verdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { getLatestSnapshot } from './harness-snapshot.js';
import { t } from '../i18n/index.js';

export class HarnessEvaluator {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 评估开发结果
   *
   * 关键：此方法在独立上下文中运行，不共享开发阶段的任何状态
   */
  async evaluate(
    task: TaskMeta,
    devReport: DevReport,
    contract: SprintContract,
    retryContext?: RetryContext
  ): Promise<ReviewVerdict> {
    const texts = t(this.config.cwd);
    console.log(`   ${texts.harness.logs.evalTaskLabel}: ${task.title}`);
    console.log(`   ${texts.harness.logs.devStatusLabel}: ${devReport.status}`);

    const verdict: ReviewVerdict = {
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
      verdict.reason = `${texts.harness.logs.devPhaseNotComplete}: ${devReport.status}`;
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
        verdict.reason = `${texts.harness.logs.phantomTaskViolation.replace('{count}', String(phantomTasks.length)).replace('{tasks}', phantomTasks.join(', '))}`;
        verdict.failedCriteria = [texts.harness.logs.phantomTaskCriteria];
        verdict.failedCheckpoints = phantomTasks.map(tid => `${texts.harness.logs.phantomTaskPrefix}: ${tid}`);
        verdict.details = texts.harness.logs.phantomTaskDetails;
        verdict.inferenceType = 'explicit_match'; // 幽灵任务是确定性检测，非解析推断
        console.log(`\n   ❌ ${texts.harness.logs.phantomTaskAutoNopass}`);

        await this.saveReviewReport(task.id, verdict, devReport);
        return verdict;
      }

      // 3. 构建评估提示词
      const prompt = this.buildEvaluationPrompt(task, devReport, contract, phantomTasks, retryContext);
      console.log(`\n   📝 ${texts.harness.logs.evalPromptGenerated}`);

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

      console.log(`\n   🔍 ${texts.harness.logs.startingEvalSession}`);

      const engine = createSessionAwareEngine(
        'markdown',
        [verdictResultMarker, verdictHasReason],
        2, // maxRetriesOnError, equivalent to MAX_PARSE_RETRIES
      );
      const engineResult = await engine.runWithFeedback(
        agent.invoke.bind(agent),
        prompt,
        invokeOptions,
      );

      if (engineResult.retries > 0) {
        console.log(`   🔄 ${texts.harness.logs.evalFormatRetry.replace('{retries}', String(engineResult.retries))}`);
      }

      const lastRawOutput = engineResult.result.output ?? '';

      // 4.5 保存原始评估输出（用于事后诊断）
      this.saveRawEvaluationOutput(task.id, engineResult.result.output, engineResult.result.stderr || '', engineResult.result.success);

      // 4.6 检测空输出（Claude 进程异常退出）
      if (!engineResult.result.output || engineResult.result.output.trim().length === 0) {
        verdict.result = 'NOPASS';
        verdict.reason = `${texts.harness.logs.emptyOutputError}${engineResult.result.stderr ? ` (stderr: ${engineResult.result.stderr.substring(0, 200)})` : ''}`;
        verdict.inferenceType = 'empty_output';
        console.log(`\n   ❌ ${texts.harness.logs.evalEmptyOutput}`);
        if (engineResult.result.stderr) {
          console.log(`   📝 ${texts.harness.logs.evalStderrPrefix}: ${engineResult.result.stderr.substring(0, 300)}`);
        }
        await this.saveReviewReport(task.id, verdict, devReport);
        return verdict;
      }

      // 5. 解析评估结果
      let evaluation = this.parseEvaluationResult(engineResult.result.output);

      // CP-16: 重试后仍无法解析时，默认 PASS（保守策略）
      if (evaluation.inferenceType === 'parse_failure_default') {
        console.log(`   ⚠️ ${texts.harness.logs.evalParseFailureDefault}`);
        evaluation = {
          ...evaluation,
          passed: true,
          reason: texts.harness.logs.evalParseFailureDefaultReason.replace('{retries}', String(engineResult.retries)),
        };
      }

      verdict.result = evaluation!.passed ? 'PASS' : 'NOPASS';
      verdict.reason = evaluation!.reason;
      verdict.failedCriteria = evaluation!.failedCriteria;
      verdict.failedCheckpoints = evaluation!.failedCheckpoints;
      verdict.details = evaluation!.details;
      verdict.action = evaluation!.action as any;
      verdict.failureCategory = evaluation!.failureCategory as any;
      verdict.inferenceType = evaluation!.inferenceType;

      // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
      const contradiction = detectContradiction(verdict.result, lastRawOutput || verdict.reason || '');
      if (contradiction.hasContradiction && contradiction.correctedResult) {
        console.log(`   ⚠️  ${texts.harness.logs.contradictionDetected}: ${contradiction.reason}`);
        verdict.result = contradiction.correctedResult;
        verdict.reason += ` [${texts.harness.logs.contradictionFix}: ${contradiction.reason}]`;
      }

      if (verdict.result === 'PASS') {
        console.log(`\n   ✅ ${texts.harness.logs.evalPassed} [${texts.harness.reports.inferenceTypeLabel}: ${verdict.inferenceType || 'unknown'}]`);
      } else {
        console.log(`\n   ❌ ${texts.harness.logs.evalFailed} [${texts.harness.reports.inferenceTypeLabel}: ${verdict.inferenceType || 'unknown'}]: ${verdict.reason}`);
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.evalProcessError}: ${error instanceof Error ? error.message : String(error)}`;
      verdict.inferenceType = 'parse_failure_default';
      console.log(`\n   ❌ ${texts.harness.logs.evalError}: ${verdict.reason}`);
    }

    // 保存审查报告
    await this.saveReviewReport(task.id, verdict, devReport);

    return verdict;
  }

  /**
   * 构建评估提示词
   */
  private buildEvaluationPrompt(
    task: TaskMeta,
    devReport: DevReport,
    contract: SprintContract,
    phantomTasks: string[] = [],
    retryContext?: RetryContext
  ): string {
    const texts = t(this.config.cwd);
    // BUG-014-2A: 过滤掉 requiresHuman 检查点，仅评估自动化检查点
    // BUG-013-1: 防御性处理，确保数组字段始终为有效数组
    const contractCheckpoints = Array.isArray(contract.checkpoints) ? contract.checkpoints : [];
    const contractCriteria = Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria : [];
    const contractCommands = Array.isArray(contract.verificationCommands) ? contract.verificationCommands : [];
    const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];
    const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];

    const humanCheckpointIds = new Set<string>();
    const humanCheckpointDescs = new Set<string>();
    if (task.checkpoints) {
      for (const cp of task.checkpoints) {
        if (cp.requiresHuman === true) {
          humanCheckpointIds.add(cp.id);
          humanCheckpointDescs.add(cp.description);
        }
      }
    }
    const isHumanCheckpoint = (cp: string) =>
      humanCheckpointIds.has(cp) || humanCheckpointDescs.has(cp);
    const filteredContractCheckpoints = contractCheckpoints.filter(cp => !isHumanCheckpoint(cp));
    const filteredDevCheckpoints = devCheckpointsCompleted.filter(cp => !isHumanCheckpoint(cp));

    // Build section variables (each non-empty section ends with \n for blank-line separation)
    const descriptionSection = task.description
      ? `## ${texts.harness.logs.taskDescriptionSection}\n${task.description}\n`
      : `## ${texts.harness.logs.taskDescriptionSection}\n${texts.harness.logs.taskDescriptionEmpty}\n`;

    const acceptanceCriteriaList = contractCriteria.length > 0
      ? `${contractCriteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}\n`
      : `${texts.harness.logs.acceptanceCriteriaEmpty}\n`;

    const verificationCommandsSection = contractCommands.length > 0
      ? `## 验证命令\n请运行以下命令验证实现:\n\`\`\`bash\n${contractCommands.join('\n')}\n\`\`\`\n`
      : '';

    const checkpointsSection = filteredContractCheckpoints.length > 0
      ? `## ${texts.harness.logs.checkpointSectionTitle}\n${texts.harness.logs.checkpointSectionConfirm}${filteredContractCheckpoints.map((cp, i) => `${i + 1}. ${cp}`).join('\n')}\n`
      : '';

    const humanCheckpointsSection = humanCheckpointIds.size > 0
      ? `## ${texts.harness.logs.aboutHumanVerification}\n${texts.harness.logs.humanVerificationNote.replace('{count}', String(humanCheckpointIds.size)).replace('{examples}', Array.from(humanCheckpointIds).slice(0, 3).join(', '))}\n${texts.harness.logs.humanVerificationExcluded}\n`
      : '';

    const evidenceSection = devEvidence.length > 0
      ? `## 提交的证据\n开发者提交了以下证据:\n${devEvidence.map(e => `- ${e}`).join('\n')}\n`
      : '';

    const completedCheckpointsSection = filteredDevCheckpoints.length > 0
      ? `## 开发者声明的完成检查点\n${filteredDevCheckpoints.map(cp => `- ${cp}`).join('\n')}\n`
      : '';

    const phantomTasksSection = phantomTasks.length > 0
      ? `## ${texts.harness.logs.phantomTaskDetectedTitle}\n${texts.harness.logs.phantomTaskViolation.replace('{count}', String(phantomTasks.length))}\n${phantomTasks.map(tid => `- ${tid}`).join('\n')}\n\n${texts.harness.logs.phantomTaskProhibited}\n${texts.harness.logs.phantomTaskNopassRequirement}\n`
      : '';

    const template = loadPromptTemplate('evaluation', this.config.cwd);

    // Build retry context section if present
    let retryContextSection = '';
    if (retryContext?.previousFailureReason) {
      const phaseLabel: Record<string, string> = {
        development: '开发',
        code_review: '代码审核',
        qa: 'QA 验证',
        evaluation: '评估',
      };
      const lines: string[] = [
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
  private parseEvaluationResult(output: string): {
    passed: boolean;
    reason: string;
    failedCriteria: string[];
    failedCheckpoints: string[];
    details?: string;
    action?: string;
    failureCategory?: string;
    inferenceType: EvaluationInferenceType;
  } {
    const result = {
      passed: false,
      reason: '',
      failedCriteria: [] as string[],
      failedCheckpoints: [] as string[],
      details: '',
      action: undefined as string | undefined,
      failureCategory: undefined as string | undefined,
      inferenceType: 'parse_failure_default' as EvaluationInferenceType,
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
        result.reason = match[1]!.trim();
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
        const criteriaText = match[1]!.trim();
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
        const checkpointsText = match[1]!.trim();
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
        result.details = match[1]!.trim();
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
        result.action = match[1]!.toLowerCase();
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
        result.failureCategory = match[1]!.toLowerCase();
        break;
      }
    }

    // 如果没有提取到原因，设置默认值
    const texts = t(this.config.cwd);
    if (!result.reason) {
      if (result.passed) {
        result.reason = texts.harness.logs.structuredMatchPassed;
      } else if (structured.passed !== null) {
        result.reason = texts.harness.logs.structuredMatchFailed;
      } else {
        result.reason = texts.harness.logs.cannotParseResult;
        result.inferenceType = 'parse_failure_default';
        console.log(`   ⚠️  ${texts.harness.logs.parseErrorWarning.replace('{limit}', '500')}:`);
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
  private detectPhantomTasks(currentTaskId: string, devReport: DevReport): string[] {
    const texts = t(this.config.cwd);
    const phantomTasks: string[] = [];

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
    let plannedTaskIds: Set<string> = new Set();
    let usingSnapshot = false;
    let snapshotTaskCount = 0;

    try {
      const snapshot = getLatestSnapshot(this.config.cwd);
      if (snapshot && snapshot.tasks) {
        plannedTaskIds = new Set(snapshot.tasks);
        snapshotTaskCount = snapshot.tasks.length;
        usingSnapshot = true;
        console.log(`   📋 ${texts.harness.logs.snapshotMode}: ${snapshot.snapshotId} (${snapshotTaskCount})`);
      } else {
        console.log(`   📋 ${texts.harness.logs.fallbackMode}`);
      }
    } catch (error) {
      console.log(`   ⚠️ ${texts.harness.logs.fallbackMode}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. 检查文件系统中是否存在由开发者创建的额外任务
    //    基于计划快照排除计划内任务，只检测计划外且在开发窗口内创建的任务
    try {
      const allTaskIds = getAllTaskIds(this.config.cwd);
      let excludedCount = 0;

      for (const tid of allTaskIds) {
        // 跳过当前任务
        if (tid === currentTaskId) continue;

        // 使用快照时：排除计划内的任务
        if (usingSnapshot && plannedTaskIds.has(tid)) {
          excludedCount++;
          continue;
        }

        const task = readTaskMeta(tid, this.config.cwd);
        if (!task) continue;

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
        console.log(`   📊 ${texts.harness.logs.snapshotStats.replace('{total}', String(allTaskIds.length)).replace('{excluded}', String(excludedCount)).replace('{checking}', String(allTaskIds.length - excludedCount - 1))}`);
      }
    } catch (error) {
      console.log(`   ⚠️ ${texts.harness.logs.snapshotError}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 4. 如果 Claude 输出中包含创建命令但文件系统中未检测到，也记录警告
    if (hasCreateCommand && phantomTasks.length === 0) {
      console.log(`   ⚠️  ${texts.harness.logs.creatingCommandWarning}`);
      console.log(`   ⚠️  ${texts.harness.logs.creatingCommandIntent}`);
    }

    if (phantomTasks.length > 0) {
      console.log(`   ⚠️  ${texts.harness.logs.phantomTaskDetected.replace('{count}', String(phantomTasks.length))}: ${phantomTasks.join(', ')}`);
      if (usingSnapshot) {
        console.log(`   ℹ️  ${texts.harness.logs.snapshotMode} ${texts.harness.logs.snapshotExcludedInfo?.replace('{count}', String(snapshotTaskCount)) || `(excluded ${snapshotTaskCount} planned tasks)`}`);
      } else {
        console.log(`   ℹ️  ${texts.harness.logs.fallbackMode}`);
      }
    } else {
      console.log(`   ✅ ${texts.harness.logs.noPhantomTask}`);
      if (usingSnapshot) {
        console.log(`   ℹ️  ${texts.harness.logs.snapshotBasedOnInfo?.replace('{count}', String(snapshotTaskCount)) || `excluded ${snapshotTaskCount} planned tasks based on snapshot`}`);
      }
    }

    return phantomTasks;
  }

  /**
   * 验证并规范化 SprintContract 数据
   * BUG-013-1: 防止 contract.json 字段缺失导致下游 TypeError
   */
  private validateSprintContract(raw: unknown, taskId: string): SprintContract | null {
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return null;
    }

    const obj = raw as Record<string, unknown>;

    // taskId 必须匹配或至少存在
    if (obj.taskId !== undefined && typeof obj.taskId !== 'string') {
      return null;
    }

    // 确保数组字段为数组类型，否则使用默认空数组
    const normalizeStringArray = (field: string): string[] => {
      const val = obj[field];
      return Array.isArray(val) ? val.filter(v => typeof v === 'string') : [];
    };

    // 时间字段必须是字符串
    const normalizeTimestamp = (field: string, fallback: string): string => {
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
  private loadContract(taskId: string): SprintContract | null {
    const texts = t(this.config.cwd);
    const contractPath = this.getContractPath(taskId);

    if (!fs.existsSync(contractPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(contractPath, 'utf-8');
      const parsed = JSON.parse(content);
      const validated = this.validateSprintContract(parsed, taskId);
      if (!validated) {
        console.warn(`   ⚠️  ${texts.harness.logs.contractDataInvalid}`);
      }
      return validated;
    } catch (error) {
      console.warn(`   ⚠️  ${texts.harness.logs.contractParseFailed}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 获取 Contract 文件路径
   */
  private getContractPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'tasks', taskId, 'contract.json');
  }

  /**
   * 获取审查报告路径
   */
  private getReviewReportPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'reports', 'harness', taskId, 'review-report.md');
  }

  /**
   * 保存审查报告
   */
  private async saveReviewReport(
    taskId: string,
    verdict: ReviewVerdict,
    devReport: DevReport
  ): Promise<void> {
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
  private saveRawEvaluationOutput(
    taskId: string,
    output: string,
    stderr: string,
    success: boolean
  ): void {
    const texts = t(this.config.cwd);
    try {
      const projectDir = getProjectDir(this.config.cwd);
      const dir = path.join(projectDir, 'reports', 'harness', taskId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rawPath = path.join(dir, `evaluation-raw-${timestamp}.log`);

      const lines = [
        `# ${texts.harness.logs.rawEvaluationOutputTitle || 'Raw Evaluation Output'}`,
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
      console.log(`   📄 ${texts.harness.logs.rawOutputSaved.replace('{filename}', `evaluation-raw-${timestamp}.log`)}`);
    } catch (error) {
      // 日志保存失败不中断主流程
      console.warn(`   ⚠️ ${texts.harness.logs.saveRawOutputFailed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 格式化审查报告
   */
  private formatReviewReport(verdict: ReviewVerdict, devReport: DevReport): string {
    const texts = t(this.config.cwd);

    const lines: string[] = [
      `# ${texts.harness.reports.reviewReportTitle} - ${verdict.taskId}`,
      '',
      `**${texts.harness.reports.resultLabel}**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**${texts.harness.reports.reviewedAtLabel}**: ${verdict.reviewedAt}`,
      `**${texts.harness.reports.reviewedByLabel}**: ${verdict.reviewedBy}`,
    ];

    if (verdict.inferenceType) {
      const inferenceTypeLabel = texts.harness.reports.inferenceTypes[verdict.inferenceType as keyof typeof texts.harness.reports.inferenceTypes] || verdict.inferenceType;
      lines.push(`**${texts.harness.reports.inferenceTypeLabel}**: ${inferenceTypeLabel} (${verdict.inferenceType})`);
    }

    lines.push('');
    lines.push(`## ${texts.harness.reports.reasonSection}`);
    lines.push(verdict.reason);
    lines.push('');

    if (verdict.failedCriteria.length > 0) {
      lines.push(`## ${texts.harness.reports.failedCriteriaSection}`);
      verdict.failedCriteria.forEach(criteria => {
        lines.push(`- ${criteria}`);
      });
      lines.push('');
    }

    if (verdict.failedCheckpoints.length > 0) {
      lines.push(`## ${texts.harness.reports.failedCheckpointsSection}`);
      verdict.failedCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint}`);
      });
      lines.push('');
    }

    if (verdict.details) {
      lines.push(`## ${texts.harness.reports.detailsSection}`);
      lines.push(verdict.details);
      lines.push('');
    }

    // BUG-013-1: 防御性处理，确保数组字段存在
    const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];
    const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];

    lines.push(`## ${texts.harness.reports.devPhaseInfoSection}`);
    lines.push(`- ${texts.harness.reports.statusLabel}: ${devReport.status}`);
    lines.push(`- ${texts.harness.reports.durationLabel}: ${(devReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- ${texts.harness.reports.evidenceCountLabel}: ${devEvidence.length}`);
    lines.push(`- ${texts.harness.reports.checkpointsCountLabel}: ${devCheckpointsCompleted.length}`);

    return lines.join('\n');
  }
}
