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
} from '../types/harness.js';
import {
  createDefaultDevReport,
  createDefaultSprintContract,
} from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';
import { getProjectDir } from './path.js';
import { getDevRoleTemplate } from './role-prompts.js';
import { archiveReportIfExists } from './harness-helpers.js';
import { getAgent } from './headless-agent.js';

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
  async execute(task: TaskMeta, contract: SprintContract, timeoutOverride?: number): Promise<DevReport> {
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
      const prompt = this.buildDevPrompt(task, sprintContract, timeoutMinutes);
      console.log('\n   📝 开发提示词已生成');

      // 3. 执行 headless Claude（通过 headless-agent 抽象层）
      console.log('\n   🤖 启动 Headless Claude...');
      const agent = getAgent(this.config.cwd);
      const agentResult = await agent.invoke(prompt, {
        timeout: effectiveTimeout,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        outputFormat: 'text',
        maxRetries: this.config.apiRetryAttempts,
        cwd: this.config.cwd,
        dangerouslySkipPermissions: true,
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
  private buildDevPrompt(task: TaskMeta, contract: SprintContract, timeoutMinutes?: number): string {
    const parts: string[] = [];

    parts.push(`# 任务: ${task.title}`);
    parts.push('');
    parts.push(`## 任务ID: ${task.id}`);
    parts.push(`## 类型: ${task.type}`);
    parts.push(`## 优先级: ${task.priority}`);
    if (timeoutMinutes) {
      parts.push(`## 超时限制: ${timeoutMinutes} 分钟`);
    }
    parts.push('');

    if (task.description) {
      parts.push('## 任务描述');
      parts.push(task.description);
      parts.push('');
    }

    if (task.dependencies && task.dependencies.length > 0) {
      parts.push('## 依赖任务');
      task.dependencies.forEach(dep => {
        parts.push(`- ${dep}`);
      });
      parts.push('');
    }

    if (contract.acceptanceCriteria.length > 0) {
      parts.push('## 验收标准');
      parts.push('请确保满足以下所有标准:');
      contract.acceptanceCriteria.forEach((criteria, i) => {
        parts.push(`${i + 1}. ${criteria}`);
      });
      parts.push('');
    }

    if (contract.checkpoints.length > 0) {
      parts.push('## 检查点');
      parts.push('请完成以下检查点:');
      contract.checkpoints.forEach((cp, i) => {
        parts.push(`${i + 1}. ${cp}`);
      });
      parts.push('');
    }

    // 角色感知提示词
    const roleTemplate = getDevRoleTemplate(task.recommendedRole);

    parts.push('## 指示');
    if (timeoutMinutes) {
      parts.push(`你需要在 ${timeoutMinutes} 分钟内完成此任务。请合理分配时间，优先完成核心功能。`);
      parts.push('');
    }
    parts.push('1. 仔细阅读任务描述和验收标准');
    parts.push('2. 实现所需的功能或修复');
    parts.push('3. 确保代码符合项目规范');
    parts.push('4. 运行必要的测试验证实现');
    parts.push('5. 完成后简要总结所做的更改');
    parts.push('');

    if (roleTemplate.extraInstructions.length > 0) {
      parts.push('## 角色专项要求');
      roleTemplate.extraInstructions.forEach((inst, i) => {
        parts.push(`${i + 1}. ${inst}`);
      });
      parts.push('');
    }

    parts.push('## ⛔ 禁止操作（严格遵守）');
    parts.push(`${roleTemplate.roleDeclaration}以下操作被严格禁止：`);
    parts.push('');
    parts.push('1. **禁止创建新任务** - 不要运行 `task create`、`init-requirement` 或任何创建任务的命令');
    parts.push('2. **禁止修改任务元数据** - 不要修改 `.projmnt4claude/tasks/` 下的 meta.json 文件');
    parts.push('3. **禁止创建子任务** - 不要将当前任务拆分为多个子任务并尝试创建它们');
    parts.push('');
    parts.push('如果任务确实需要拆分，请在开发报告中 **建议** 拆分方案，由人工决定是否创建新任务。');
    parts.push('违反以上任何禁令将导致评估不通过。');

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
