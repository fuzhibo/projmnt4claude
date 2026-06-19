/**
 * HarnessExecutor - 开发阶段执行器
 *
 * 负责启动 headless Claude 会话执行开发工作：
 * - 加载任务上下文
 * - 构建 Sprint Contract
 * - 执行 headless Claude
 * - 收集证据
 * - 生成开发报告
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarnessConfig,
  SprintContract,
  DevReport,
  RetryContext,
} from '../types/harness.js';
import {
  createDefaultDevReport,
  createDefaultSprintContract,
} from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';
import { getProjectDir } from './path.js';
import { getDevRoleTemplate } from './role-prompts.js';
import { archiveReportIfExists } from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { loadPromptTemplate, resolveTemplate, loadCustomRequirements } from './prompt-templates.js';
import { checkCompletedCheckpoints as checkCompletedCheckpointsWithVerification } from './checkpoint-verification.js';
import { t, getI18n } from '../i18n/index.js';
import { sleep, killAllActiveChildren, activeChildProcesses } from './harness-helpers.js';
import type { HarnessPhaseOptions } from '../types/config.js';
import { randomUUID } from 'crypto';
import { sessionIdMapper } from './session-id-mapper.js';
import { DebugLogger } from './debug-logger.js';

export class HarnessExecutor {
  private config: HarnessConfig;
  private debugLogger: DebugLogger;
  /** 当前活动的子进程 PID 快照（由全局 activeChildProcesses 派生） */
  private activeChildPid?: number;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.debugLogger = new DebugLogger({
      cwd: config.cwd,
      enabled: config.debug,
    });
  }

  /**
   * 获取当前活动的子进程 PID（最佳努力）。
   *
   * 说明：子进程由 runHeadlessClaude 统一注册到全局 activeChildProcesses，
   * 此处返回最近一次观察到的 PID，用于日志与诊断。
   */
  getActiveChildPid(): number | undefined {
    if (this.activeChildPid && activeChildProcesses.has(this.activeChildPid)) {
      return this.activeChildPid;
    }
    // 回退：从全局集合中取第一个（适用于当前阶段仅有一个子进程的场景）
    const first = activeChildProcesses.values().next().value;
    this.activeChildPid = first;
    return first;
  }

  /**
   * 终止当前活动的子进程。
   *
   * @param signal POSIX 信号，默认 SIGTERM
   * @returns 是否找到并尝试终止了子进程
   */
  killActiveChild(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const pid = this.getActiveChildPid();
    if (pid === undefined) {
      return false;
    }
    try {
      process.kill(pid, signal);
      console.log(`   🛑 Terminated active child process ${pid} (${signal})`);
      return true;
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'ESRCH') {
        // 进程已退出，清理本地快照
        this.activeChildPid = undefined;
        return false;
      }
      console.warn(`   ⚠️  Failed to kill child ${pid}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * 终止所有活跃的子进程（委托给全局 killAllActiveChildren）。
   *
   * 供 AssemblyLine / gracefulShutdown 在流水线中断时统一清理。
   * 方法名与 AssemblyLine.killAllChildren 保持一致，避免与全局函数同名 shadowing。
   */
  killAllChildren(signal: NodeJS.Signals = 'SIGTERM'): number {
    const killed = killAllActiveChildren(signal);
    this.activeChildPid = undefined;
    return killed;
  }

  /**
   * 执行开发阶段
   * @param task - 任务元数据
   * @param contract - Sprint Contract
   * @param timeoutOverride - 可选的每任务超时覆盖（秒），优先于 config.timeout
   */
  async execute(task: TaskMeta, contract: SprintContract, timeoutOverride?: number, retryContext?: RetryContext): Promise<DevReport> {
    const startTime = new Date();
    const report = createDefaultDevReport(task.id);
    report.startTime = startTime.toISOString();
    report.status = 'running';

    const effectiveTimeout = timeoutOverride ?? this.config.timeout;
    const timeoutMinutes = Math.round(effectiveTimeout / 60);

    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      texts = getI18n('zh');
    }
    console.log(`   ${texts.harness.logs.taskLabel}: ${task.title}`);
    console.log(`   ${texts.harness.logs.typeLabel}: ${task.type}`);
    console.log(`   ${texts.harness.logs.priorityLabel}: ${task.priority}`);
    console.log(`   ${texts.harness.logs.timeoutLabel}: ${timeoutMinutes} ${texts.harness.logs.minutes} (${effectiveTimeout} ${texts.harness.logs.seconds})`);

    try {
      // 1. 构建或加载 Sprint Contract
      const sprintContract = await this.buildOrLoadContract(task);
      Object.assign(contract, sprintContract);

      // 2. 构建开发提示词（注入超时信息）
      const prompt = this.buildDevPrompt(task, sprintContract, timeoutMinutes, retryContext);
      console.log(`\n   📝 ${texts.harness.logs.devPromptGenerated}`);

      // [DEBUG] 记录开发阶段提示词
      this.debugLogger.logPrompt(task.id, 'development', prompt);

      // 3. 执行 headless Claude（通过 FeedbackConstraintEngine 进行输出格式验证和反馈重试）
      console.log(`\n   🤖 ${texts.harness.logs.startingHeadlessClaude}`);
      const agent = getAgent(this.config.cwd);
      const effectiveTools = buildEffectiveTools('development', this.config.cwd, task);
      const phaseOptions = this.config.perPhaseOptions?.['development'];

      // 生成阶段级 session ID，用于阶段内重试时的上下文连续性
      // 使用双层 ID：内部可读 ID 用于日志，CLI UUID 用于 Claude Code
      const internalId = `dev-${task.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const sessionId = sessionIdMapper.generate(internalId, task.id, 'development');

      const invokeOptions = {
        timeout: effectiveTimeout,
        allowedTools: effectiveTools.tools,
        outputFormat: 'text' as const,
        cwd: this.config.cwd,
        dangerouslySkipPermissions: effectiveTools.skipPermissions,
        sessionId,
        bare: phaseOptions?.bare,
        noSessionPersistence: phaseOptions?.noSessionPersistence,
        mcpConfig: phaseOptions?.mcpConfig,
        strictMcpConfig: phaseOptions?.strictMcpConfig,
        pluginDir: phaseOptions?.pluginDir,
        pluginUrl: phaseOptions?.pluginUrl,
        disableSlashCommands: phaseOptions?.disableSlashCommands,
        effort: phaseOptions?.effort,
        maxBudgetUsd: phaseOptions?.maxBudgetUsd,
        debug: phaseOptions?.debug,
      };

      const engine = createSessionAwareEngine(
        'markdown',
        [], // 开发阶段仅需非空输出验证，不需要 verdict 标记
        1,  // maxRetriesOnError: 最多重试 1 次
      );
      const engineResult = await engine.runWithFeedback(
        agent.invoke.bind(agent),
        prompt,
        invokeOptions,
      );

      // [DEBUG] 记录 AI 响应
      this.debugLogger.logAIResponse(task.id, 'development', engineResult.result.output || '', {
        retries: engineResult.retries,
        success: engineResult.result.success,
        exitCode: engineResult.result.exitCode,
        durationMs: engineResult.result.durationMs,
      });

      if (engineResult.retries > 0) {
        console.log(`   🔄 ${texts.harness.logs.devOutputFormatRetry.replace('{retries}', String(engineResult.retries))}`);
      }

      report.claudeOutput = engineResult.result.output;
      report.duration = engineResult.result.durationMs;

      if (!engineResult.result.success) {
        // Agent 调用本身失败（超时、进程异常等）
        report.status = engineResult.result.exitCode === 124 ? 'timeout' : 'failed';
        report.error = engineResult.result.error || `${texts.harness.logs.exitCode}: ${engineResult.result.exitCode}`;
        console.log(`\n   ❌ ${texts.harness.logs.devPhaseFailed}: ${report.error}`);
      } else if (!engineResult.passed) {
        // 输出格式验证未通过（如空输出）
        const violationMessages = engineResult.violations
          .map(v => `${v.ruleId}: ${v.message}`)
          .join('; ');
        report.status = 'failed';
        report.error = `${texts.harness.logs.devOutputValidationFailedError}: ${violationMessages}`;
        console.log(`\n   ❌ ${texts.harness.logs.devOutputValidationFailed}: ${violationMessages}`);
      } else {
        report.status = 'success';
        console.log(`\n   ✅ ${texts.harness.logs.devPhaseCompleted}`);

        // 4. 收集证据
        report.evidence = await this.collectEvidence(task.id);
        console.log(`   📎 ${texts.harness.logs.evidenceCollected}: ${report.evidence.length}`);

        // 5. 检查完成的检查点
        report.checkpointsCompleted = await this.checkCompletedCheckpoints(task, sprintContract);
        const totalCheckpoints = task.checkpoints?.length || 0;
        console.log(`   ✓ ${texts.harness.logs.checkpointsCompleted}: ${report.checkpointsCompleted.length}/${totalCheckpoints}`);
      }

    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : String(error);
      console.log(`\n   ❌ ${texts.harness.logs.devPhaseError}: ${report.error}`);

      // [DEBUG] 记录开发阶段错误
      this.debugLogger.logError(task.id, 'development', error instanceof Error ? error : new Error(String(error)), {
        prompt: this.buildDevPrompt(task, contract, timeoutMinutes, retryContext),
        retryContext,
      });
    }

    const endTime = new Date();
    report.endTime = endTime.toISOString();
    report.duration = endTime.getTime() - startTime.getTime();

    // 保存开发报告
    await this.saveDevReport(task.id, report);

    return report;
  }

  /**
   * 构建或加载 Sprint Contract
   */
  private async buildOrLoadContract(task: TaskMeta): Promise<SprintContract> {
    const contractPath = this.getContractPath(task.id);

    // 尝试加载现有 contract
    if (fs.existsSync(contractPath)) {
      try {
        const content = fs.readFileSync(contractPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // 解析失败，创建新的
      }
    }

    // 创建新的 Sprint Contract
    const contract = createDefaultSprintContract(task.id);

    // 从任务描述提取验收标准
    if (task.description) {
      contract.acceptanceCriteria = this.extractAcceptanceCriteria(task.description);
    }

    // 从检查点提取验证命令
    // Note: checkpoints are now accessed directly from task.checkpoints via filterCheckpoints()
    // This eliminates ID-only references and preserves full checkpoint metadata.
    if (task.checkpoints && task.checkpoints.length > 0) {
      contract.verificationCommands = task.checkpoints
        .filter(cp => cp.verification?.commands)
        .flatMap(cp => cp.verification!.commands!);
    }

    // 保存 contract
    this.saveContract(task.id, contract);

    return contract;
  }

  /**
   * 从任务描述提取验收标准
   */
  private extractAcceptanceCriteria(description: string): string[] {
    const criteria: string[] = [];

    // 尝试提取列表项
    const lines = description.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 "- [ ] xxx" 或 "- xxx" 或 "1. xxx" 格式
      if (/^[-*]\s*(?:\[[ x]\])?\s*(.+)/.test(trimmed) || /^\d+\.\s*(.+)/.test(trimmed)) {
        const match = trimmed.match(/^(?:[-*]|\d+\.)\s*(?:\[[ x]\])?\s*(.+)/);
        if (match && match[1]) {
          criteria.push(match[1].trim());
        }
      }
    }

    // 如果没有提取到，将整个描述作为一条标准
    if (criteria.length === 0 && description.trim()) {
      criteria.push(description.trim());
    }

    return criteria;
  }

  /**
   * 按阶段分组检查点
   * 开发阶段需要看到所有检查点作为约束，但按类别分组有助于理解
   *
   * @param checkpoints - 检查点列表
   * @returns 按阶段分组的检查点
   */
  private groupCheckpointsByPhase(checkpoints: TaskMeta['checkpoints']): {
    codeReview: typeof checkpoints;
    qa: typeof checkpoints;
    evaluation: typeof checkpoints;
    general: typeof checkpoints;
  } {
    const result = {
      codeReview: [] as typeof checkpoints,
      qa: [] as typeof checkpoints,
      evaluation: [] as typeof checkpoints,
      general: [] as typeof checkpoints,
    };

    if (!checkpoints || checkpoints.length === 0) {
      return result;
    }

    for (const cp of checkpoints) {
      // 根据描述前缀判断阶段
      const desc = cp.description.toLowerCase();

      if (cp.category === 'code_review' || desc.includes('[ai review]') || desc.includes('代码审查') || desc.includes('code review')) {
        result.codeReview.push(cp);
      } else if (cp.category === 'qa_verification' || desc.includes('[ai qa]') || desc.includes('qa验证') || desc.includes('测试验证')) {
        result.qa.push(cp);
      } else if (desc.includes('[script]')) {
        // [script] 仅用于验证脚本，不再匹配'脚本'或'自动化'关键词
        result.evaluation.push(cp);
      } else {
        result.general.push(cp);
      }
    }

    return result;
  }

  /**
   * 构建检查点约束章节
   * 输出完整检查点描述 + 验证命令/步骤
   *
   * @param checkpoints - 检查点列表
   * @param texts - 国际化文本
   * @returns 格式化的检查点约束章节
   */
  private buildCheckpointConstraintsSection(
    checkpoints: TaskMeta['checkpoints'],
    texts: ReturnType<typeof t>
  ): string {
    if (!checkpoints || checkpoints.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`## ${texts.harness.checkpoints}`);
    lines.push('');
    lines.push(texts.harness.checkpointsInstruction);
    lines.push('');

    // 按阶段分组展示
    const grouped = this.groupCheckpointsByPhase(checkpoints);

    // 通用检查点（开发阶段主要关注）
    if (grouped.general.length > 0) {
      lines.push(`### ${texts.harness.checkpointCategoryGeneral || '开发检查点'}`);
      for (const cp of grouped.general) {
        lines.push(`- [${cp.id}] ${cp.description}`);
        if (cp.verification?.commands?.length) {
          lines.push(`  - 验证命令: \`${cp.verification.commands.join(' && ')}\``);
        }
        if (cp.verification?.expected) {
          lines.push(`  - 预期结果: ${cp.verification.expected}`);
        }
      }
      lines.push('');
    }

    // 代码审查检查点
    if (grouped.codeReview.length > 0) {
      lines.push(`### ${texts.harness.checkpointCategoryCodeReview || '代码审查检查点'}`);
      for (const cp of grouped.codeReview) {
        lines.push(`- [${cp.id}] ${cp.description}`);
        if (cp.verification?.commands?.length) {
          lines.push(`  - 验证命令: \`${cp.verification.commands.join(' && ')}\``);
        }
        if (cp.verification?.expected) {
          lines.push(`  - 预期结果: ${cp.verification.expected}`);
        }
      }
      lines.push('');
    }

    // QA 验证检查点
    if (grouped.qa.length > 0) {
      lines.push(`### ${texts.harness.checkpointCategoryQA || 'QA 验证检查点'}`);
      for (const cp of grouped.qa) {
        lines.push(`- [${cp.id}] ${cp.description}`);
        if (cp.verification?.commands?.length) {
          lines.push(`  - 验证命令: \`${cp.verification.commands.join(' && ')}\``);
        }
        if (cp.verification?.expected) {
          lines.push(`  - 预期结果: ${cp.verification.expected}`);
        }
      }
      lines.push('');
    }

    // 自动化验证检查点
    if (grouped.evaluation.length > 0) {
      lines.push(`### ${texts.harness.checkpointCategoryEvaluation || '自动化验证检查点'}`);
      for (const cp of grouped.evaluation) {
        lines.push(`- [${cp.id}] ${cp.description}`);
        if (cp.verification?.commands?.length) {
          lines.push(`  - 验证命令: \`${cp.verification.commands.join(' && ')}\``);
        }
        if (cp.verification?.expected) {
          lines.push(`  - 预期结果: ${cp.verification.expected}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 构建开发提示词
   * @param task - 任务元数据
   * @param contract - Sprint Contract
   * @param timeoutMinutes - 超时时间（分钟），注入到提示词中提醒开发者
   */
  private buildDevPrompt(task: TaskMeta, contract: SprintContract, timeoutMinutes?: number, retryContext?: RetryContext): string {
    // 获取国际化文本
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      texts = getI18n('zh');
    }

    // 角色感知提示词
    const roleTemplate = getDevRoleTemplate(task.recommendedRole);

    // Build section variables (each non-empty section ends with \n for blank-line separation)
    const timeoutHeader = timeoutMinutes
      ? `## ${texts.harness.timeoutHeader}: ${timeoutMinutes} 分钟\n`
      : '';

    const descriptionSection = task.description
      ? `## ${texts.harness.taskDescription}\n${task.description}\n`
      : '';

    const dependenciesSection = (task.dependencies && task.dependencies.length > 0)
      ? `## ${texts.harness.dependencies}\n${task.dependencies.map(dep => `- ${dep}`).join('\n')}\n`
      : '';

    const acceptanceCriteriaSection = contract.acceptanceCriteria.length > 0
      ? `## ${texts.harness.acceptanceCriteria}\n${texts.harness.acceptanceCriteriaInstruction}\n${contract.acceptanceCriteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}\n`
      : '';

    // Build checkpoints section with full checkpoint descriptions and verification commands
    // This fixes the issue where AI only saw checkpoint IDs without descriptions
    // Group checkpoints by phase for better understanding
    const checkpointsSection = this.buildCheckpointConstraintsSection(task.checkpoints, texts);

    const timeoutInstruction = timeoutMinutes
      ? texts.harness.timeoutInstruction.replace('{timeout}', String(timeoutMinutes)) + '\n'
      : '';

    const extraInstructionsSection = roleTemplate.extraInstructions.length > 0
      ? `## ${texts.harness.roleSpecificRequirements}\n${roleTemplate.extraInstructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}\n`
      : '';

    const customRequirements = loadCustomRequirements('dev', this.config.cwd);

    const template = loadPromptTemplate('dev', this.config.cwd);
    let result = resolveTemplate(template, {
      title: task.title,
      taskId: task.id,
      type: task.type,
      priority: task.priority,
      timeoutHeader,
      descriptionSection,
      dependenciesSection,
      acceptanceCriteriaSection,
      checkpointsSection,
      timeoutInstruction,
      extraInstructionsSection,
      customRequirements,
      roleDeclaration: roleTemplate.roleDeclaration,
    });

    // Inject retry context if present (previous failure info)
    if (retryContext?.previousFailureReason) {
      const retrySection = this.buildRetryContextSection(retryContext);
      result = retrySection + '\n\n' + result;
    }

    // Normalize: collapse 3+ consecutive newlines into 2 (handles empty section placeholders)
    return result.replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 构建重试上下文章节（注入到开发提示词中）
   *
   * P6 Enhanced: 展示完整的重试上下文，包括失败历史、洞察和建议
   */
  private buildRetryContextSection(retryContext: RetryContext): string {
    const parts: string[] = [];
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      texts = getI18n('zh');
    }
    const phaseLabel: Record<string, string> = {
      development: texts.harness.phaseLabels.development,
      code_review: texts.harness.phaseLabels.codeReview,
      qa: texts.harness.phaseLabels.qa,
      evaluation: texts.harness.phaseLabels.evaluation,
    };

    parts.push(`## ${texts.harness.retryContext}`);
    parts.push('');
    const phaseName = phaseLabel[retryContext.previousPhase || ''] || retryContext.previousPhase;
    parts.push(texts.harness.retryAttemptInfo
      .replace('{attempt}', String(retryContext.attemptNumber))
      .replace('{phase}', phaseName));
    parts.push('');

    // CP-P6-1: 显示失败历史
    if (retryContext.previousErrors?.length) {
      parts.push('**📋 之前失败的错误 (Previous Errors):**');
      retryContext.previousErrors.forEach((error, index) => {
        parts.push(`${index + 1}. ${error.substring(0, 200)}${error.length > 200 ? '...' : ''}`);
      });
      parts.push('');
    } else if (retryContext.previousFailureReason) {
      // 向后兼容：如果没有 previousErrors，显示之前的单个错误
      parts.push(`**${texts.harness.previousFailureReason}:**`);
      parts.push(`> ${retryContext.previousFailureReason}`);
      parts.push('');
    }

    // CP-P6-2: 显示累积洞察
    if (retryContext.accumulatedInsights?.length) {
      parts.push('**💡 洞察 (Insights):**');
      retryContext.accumulatedInsights.forEach(insight => {
        parts.push(`- ${insight}`);
      });
      parts.push('');
    }

    // CP-P6-3: 显示修复建议
    if (retryContext.suggestedFixes?.length) {
      parts.push('**🔧 建议修复方案 (Suggested Fixes):**');
      retryContext.suggestedFixes.forEach(fix => {
        parts.push(`- ${fix}`);
      });
      parts.push('');
    }

    if (retryContext.partialProgress?.completedCheckpoints?.length) {
      parts.push(`**${texts.harness.partialProgress}:**`);
      for (const cp of retryContext.partialProgress.completedCheckpoints) {
        parts.push(`- ✅ ${cp}`);
      }
      parts.push('');
    }

    if (retryContext.upstreamFailureInfo) {
      parts.push(`**${texts.harness.upstreamFailureInfo}:**`);
      parts.push(`- ${texts.harness.logs.upstreamTask}: ${retryContext.upstreamFailureInfo.taskId}`);
      parts.push(`- ${texts.harness.previousFailureReason}: ${retryContext.upstreamFailureInfo.reason}`);
      parts.push(`- ${texts.harness.logs.failureTime}: ${retryContext.upstreamFailureInfo.failedAt}`);
      parts.push('');
    }

    // 添加重试策略提示
    if ((retryContext.attemptNumber ?? 1) >= 2) {
      parts.push('**🔄 重试策略提示:**');
      parts.push('- 这是第 ' + retryContext.attemptNumber + ' 次尝试，请特别注意之前失败的错误');
      if (retryContext.maxRetries) {
        parts.push(`- 剩余重试次数: ${retryContext.maxRetries - (retryContext.attemptNumber ?? 1)}`);
      }
      parts.push('- 参考上面的洞察和建议，避免重复同样的错误');
      parts.push('');
    }

    parts.push(texts.harness.logs.retryReferenceNote);
    parts.push('');

    return parts.join('\n');
  }

  /**
   * 收集证据
   */
  private async collectEvidence(taskId: string): Promise<string[]> {
    const evidenceDir = this.getEvidenceDir(taskId);
    const evidence: string[] = [];

    if (!fs.existsSync(evidenceDir)) {
      return evidence;
    }

    const files = fs.readdirSync(evidenceDir);
    for (const file of files) {
      const filePath = path.join(evidenceDir, file);
      if (fs.statSync(filePath).isFile()) {
        evidence.push(path.relative(this.config.cwd, filePath));
      }
    }

    return evidence;
  }

  /**
   * 检查完成的检查点
   * CP-007: 检测假成功并输出警告日志
   */
  private async checkCompletedCheckpoints(
    task: TaskMeta,
    _contract: SprintContract
  ): Promise<string[]> {
    if (!task.checkpoints || task.checkpoints.length === 0) {
      return [];
    }

    // 使用兜底验证机制检查已完成的检查点
    const checkpointIds = task.checkpoints.map(cp => cp.id);
    const result = await checkCompletedCheckpointsWithVerification(task, checkpointIds, this.config.cwd);

    return result.completed;
  }

  /**
   * 获取 Contract 文件路径
   */
  private getContractPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'tasks', taskId, 'contract.json');
  }

  /**
   * 保存 Contract
   */
  private saveContract(taskId: string, contract: SprintContract): void {
    const contractPath = this.getContractPath(taskId);
    const dir = path.dirname(contractPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    contract.updatedAt = new Date().toISOString();
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf-8');
  }

  /**
   * 获取证据目录
   */
  private getEvidenceDir(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'evidence', taskId);
  }

  /**
   * 获取开发报告路径
   */
  private getDevReportPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'reports', 'harness', taskId, 'dev-report.md');
  }

  /**
   * 保存开发报告
   */
  private async saveDevReport(taskId: string, report: DevReport): Promise<void> {
    const reportPath = this.getDevReportPath(taskId);
    const dir = path.dirname(reportPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    archiveReportIfExists(reportPath);
    const content = this.formatDevReport(report);
    fs.writeFileSync(reportPath, content, 'utf-8');
  }

  /**
   * 格式化开发报告
   */
  private formatDevReport(report: DevReport): string {
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      texts = getI18n('zh');
    }
    const lines: string[] = [
      `# ${texts.harness.reports.devReportTitle} - ${report.taskId}`,
      '',
      `**${texts.harness.reports.statusLabel}**: ${report.status}`,
      `**${texts.harness.reports.startTimeLabel}**: ${report.startTime}`,
      `**${texts.harness.reports.endTimeLabel}**: ${report.endTime}`,
      `**${texts.harness.reports.durationLabel}**: ${(report.duration / 1000).toFixed(1)}s`,
      '',
    ];

    if (report.error) {
      lines.push(`## ${texts.harness.reports.errorInfoSection}`);
      lines.push('```');
      lines.push(report.error);
      lines.push('```');
      lines.push('');
    }

    if (report.changes.length > 0) {
      lines.push(`## ${texts.harness.reports.codeChangesSection}`);
      report.changes.forEach(change => {
        lines.push(`- ${change}`);
      });
      lines.push('');
    }

    if (report.evidence.length > 0) {
      lines.push(`## ${texts.harness.reports.evidenceFilesSection}`);
      report.evidence.forEach(evidence => {
        lines.push(`- ${evidence}`);
      });
      lines.push('');
    }

    if (report.checkpointsCompleted.length > 0) {
      lines.push(`## ${texts.harness.reports.completedCheckpointsSection}`);
      report.checkpointsCompleted.forEach(cp => {
        lines.push(`- ${cp}`);
      });
      lines.push('');
    }

    if (report.claudeOutput) {
      lines.push(`## ${texts.harness.reports.claudeOutputSection}`);
      lines.push('```');
      lines.push(report.claudeOutput.substring(0, 5000)); // 限制长度
      lines.push('```');
    }

    return lines.join('\n');
  }
}
