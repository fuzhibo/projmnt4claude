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
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';

export class HarnessExecutor {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
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

    console.log(`   任务: ${task.title}`);
    console.log(`   类型: ${task.type}`);
    console.log(`   优先级: ${task.priority}`);
    console.log(`   超时: ${timeoutMinutes} 分钟 (${effectiveTimeout} 秒)`);

    try {
      // 1. 构建或加载 Sprint Contract
      const sprintContract = await this.buildOrLoadContract(task);
      Object.assign(contract, sprintContract);

      // 2. 构建开发提示词（注入超时信息）
      const prompt = this.buildDevPrompt(task, sprintContract, timeoutMinutes, retryContext);
      console.log('\n   📝 开发提示词已生成');

      // 3. 执行 headless Claude（通过 headless-agent 抽象层）
      console.log('\n   🤖 启动 Headless Claude...');
      const agent = getAgent(this.config.cwd);
      const effectiveTools = buildEffectiveTools('development', this.config.cwd, task);
      const agentResult = await agent.invoke(prompt, {
        timeout: effectiveTimeout,
        allowedTools: effectiveTools.tools,
        outputFormat: 'text',
        maxRetries: this.config.apiRetryAttempts,
        cwd: this.config.cwd,
        dangerouslySkipPermissions: effectiveTools.skipPermissions,
      });

      report.claudeOutput = agentResult.output;
      report.duration = agentResult.durationMs;

      if (agentResult.success) {
        report.status = 'success';
        console.log('\n   ✅ 开发阶段完成');

        // 4. 收集证据
        report.evidence = await this.collectEvidence(task.id);
        console.log(`   📎 收集证据: ${report.evidence.length} 个文件`);

        // 5. 检查完成的检查点
        report.checkpointsCompleted = await this.checkCompletedCheckpoints(task, sprintContract);
        console.log(`   ✓ 完成检查点: ${report.checkpointsCompleted.length}/${sprintContract.checkpoints.length}`);

      } else {
        report.status = agentResult.exitCode === 124 ? 'timeout' : 'failed';
        report.error = agentResult.error || `退出码: ${agentResult.exitCode}`;
        console.log(`\n   ❌ 开发阶段失败: ${report.error}`);
      }

    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : String(error);
      console.log(`\n   ❌ 开发阶段出错: ${report.error}`);
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
    if (task.checkpoints && task.checkpoints.length > 0) {
      contract.checkpoints = task.checkpoints.map(cp => cp.id);
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
   * 构建开发提示词
   * @param task - 任务元数据
   * @param contract - Sprint Contract
   * @param timeoutMinutes - 超时时间（分钟），注入到提示词中提醒开发者
   */
  private buildDevPrompt(task: TaskMeta, contract: SprintContract, timeoutMinutes?: number, retryContext?: RetryContext): string {
    // 角色感知提示词
    const roleTemplate = getDevRoleTemplate(task.recommendedRole);

    // Build section variables (each non-empty section ends with \n for blank-line separation)
    const timeoutHeader = timeoutMinutes
      ? `## 超时限制: ${timeoutMinutes} 分钟\n`
      : '';

    const descriptionSection = task.description
      ? `## 任务描述\n${task.description}\n`
      : '';

    const dependenciesSection = (task.dependencies && task.dependencies.length > 0)
      ? `## 依赖任务\n${task.dependencies.map(dep => `- ${dep}`).join('\n')}\n`
      : '';

    const acceptanceCriteriaSection = contract.acceptanceCriteria.length > 0
      ? `## 验收标准\n请确保满足以下所有标准:\n${contract.acceptanceCriteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}\n`
      : '';

    const checkpointsSection = contract.checkpoints.length > 0
      ? `## 检查点\n请完成以下检查点:\n${contract.checkpoints.map((cp, i) => `${i + 1}. ${cp}`).join('\n')}\n`
      : '';

    const timeoutInstruction = timeoutMinutes
      ? `你需要在 ${timeoutMinutes} 分钟内完成此任务。请合理分配时间，优先完成核心功能。\n`
      : '';

    const extraInstructionsSection = roleTemplate.extraInstructions.length > 0
      ? `## 角色专项要求\n${roleTemplate.extraInstructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}\n`
      : '';

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
   */
  private buildRetryContextSection(retryContext: RetryContext): string {
    const parts: string[] = [];
    const phaseLabel: Record<string, string> = {
      development: '开发',
      code_review: '代码审核',
      qa: 'QA 验证',
      evaluation: '评估',
    };

    parts.push('## 重试上下文（前次失败信息）');
    parts.push('');
    parts.push(`这是第 ${retryContext.attemptNumber} 次尝试。上一次在 **${phaseLabel[retryContext.previousPhase || ''] || retryContext.previousPhase}** 阶段失败。`);
    parts.push('');
    parts.push('**前次失败原因:**');
    parts.push(`> ${retryContext.previousFailureReason}`);
    parts.push('');

    if (retryContext.partialProgress?.completedCheckpoints?.length) {
      parts.push('**已完成的部分进度:**');
      for (const cp of retryContext.partialProgress.completedCheckpoints) {
        parts.push(`- ✅ ${cp}`);
      }
      parts.push('');
    }

    if (retryContext.upstreamFailureInfo) {
      parts.push('**上游失败信息:**');
      parts.push(`- 上游任务: ${retryContext.upstreamFailureInfo.taskId}`);
      parts.push(`- 失败原因: ${retryContext.upstreamFailureInfo.reason}`);
      parts.push(`- 失败时间: ${retryContext.upstreamFailureInfo.failedAt}`);
      parts.push('');
    }

    parts.push('请参考前次失败原因，避免重复相同的问题。');
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
   */
  private async checkCompletedCheckpoints(
    task: TaskMeta,
    contract: SprintContract
  ): Promise<string[]> {
    const completed: string[] = [];

    if (!task.checkpoints) {
      return completed;
    }

    for (const checkpointId of contract.checkpoints) {
      const checkpoint = task.checkpoints.find(cp => cp.id === checkpointId);
      if (checkpoint && checkpoint.status === 'completed') {
        completed.push(checkpointId);
      }
    }

    return completed;
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
    const lines: string[] = [
      `# 开发报告 - ${report.taskId}`,
      '',
      `**状态**: ${report.status}`,
      `**开始时间**: ${report.startTime}`,
      `**结束时间**: ${report.endTime}`,
      `**耗时**: ${(report.duration / 1000).toFixed(1)}s`,
      '',
    ];

    if (report.error) {
      lines.push('## 错误信息');
      lines.push('```');
      lines.push(report.error);
      lines.push('```');
      lines.push('');
    }

    if (report.changes.length > 0) {
      lines.push('## 代码变更');
      report.changes.forEach(change => {
        lines.push(`- ${change}`);
      });
      lines.push('');
    }

    if (report.evidence.length > 0) {
      lines.push('## 证据文件');
      report.evidence.forEach(evidence => {
        lines.push(`- ${evidence}`);
      });
      lines.push('');
    }

    if (report.checkpointsCompleted.length > 0) {
      lines.push('## 完成的检查点');
      report.checkpointsCompleted.forEach(cp => {
        lines.push(`- ${cp}`);
      });
      lines.push('');
    }

    if (report.claudeOutput) {
      lines.push('## Claude 输出');
      lines.push('```');
      lines.push(report.claudeOutput.substring(0, 5000)); // 限制长度
      lines.push('```');
    }

    return lines.join('\n');
  }
}
