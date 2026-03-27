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
import { spawn } from 'child_process';
import {
  HarnessConfig,
  SprintContract,
  DevReport,
  HeadlessClaudeOptions,
  HeadlessClaudeResult,
  createDefaultDevReport,
  createDefaultSprintContract,
} from '../types/harness.js';
import { TaskMeta } from '../types/task.js';
import { getProjectDir } from './path.js';
import { readTaskMeta } from './task.js';

export class HarnessExecutor {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 执行开发阶段
   */
  async execute(task: TaskMeta, contract: SprintContract): Promise<DevReport> {
    const startTime = new Date();
    const report = createDefaultDevReport(task.id);
    report.startTime = startTime.toISOString();
    report.status = 'running';

    console.log(`   任务: ${task.title}`);
    console.log(`   类型: ${task.type}`);
    console.log(`   优先级: ${task.priority}`);

    try {
      // 1. 构建或加载 Sprint Contract
      const sprintContract = await this.buildOrLoadContract(task);
      Object.assign(contract, sprintContract);

      // 2. 构建开发提示词
      const prompt = this.buildDevPrompt(task, sprintContract);
      console.log('\n   📝 开发提示词已生成');

      // 3. 执行 headless Claude
      console.log('\n   🤖 启动 Headless Claude...');
      const result = await this.runHeadlessClaude({
        prompt,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        timeout: this.config.timeout,
        cwd: this.config.cwd,
        outputFormat: 'text',
      });

      report.claudeOutput = result.output;
      report.duration = result.duration;

      if (result.success) {
        report.status = 'success';
        console.log('\n   ✅ 开发阶段完成');

        // 4. 收集证据
        report.evidence = await this.collectEvidence(task.id);
        console.log(`   📎 收集证据: ${report.evidence.length} 个文件`);

        // 5. 检查完成的检查点
        report.checkpointsCompleted = await this.checkCompletedCheckpoints(task, sprintContract);
        console.log(`   ✓ 完成检查点: ${report.checkpointsCompleted.length}/${sprintContract.checkpoints.length}`);

      } else {
        report.status = result.exitCode === 124 ? 'timeout' : 'failed';
        report.error = result.error || `退出码: ${result.exitCode}`;
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
   */
  private buildDevPrompt(task: TaskMeta, contract: SprintContract): string {
    const parts: string[] = [];

    parts.push(`# 任务: ${task.title}`);
    parts.push('');
    parts.push(`## 任务ID: ${task.id}`);
    parts.push(`## 类型: ${task.type}`);
    parts.push(`## 优先级: ${task.priority}`);
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

    parts.push('## 指示');
    parts.push('1. 仔细阅读任务描述和验收标准');
    parts.push('2. 实现所需的功能或修复');
    parts.push('3. 确保代码符合项目规范');
    parts.push('4. 运行必要的测试验证实现');
    parts.push('5. 完成后简要总结所做的更改');

    return parts.join('\n');
  }

  /**
   * 运行 Headless Claude
   */
  private async runHeadlessClaude(options: HeadlessClaudeOptions): Promise<HeadlessClaudeResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // 构建命令参数
      const args = [
        '--print',  // 非交互模式
        '--dangerously-skip-permissions',  // 跳过权限确认（自动化模式必需）
        `--allowedTools=${options.allowedTools.join(',')}`,  // 用 = 连接
        options.prompt,
      ];

      // 使用 timeout 命令包装（如果可用）
      let command = 'claude';
      let commandArgs = args;

      // 检查是否有 timeout 命令
      try {
        // 使用 spawn 执行（不使用 spawn 的 timeout，因为它会发送 SIGTERM）
        const child = spawn(command, commandArgs, {
          cwd: options.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // 自己实现超时逻辑
        const timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeout * 1000);

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
          // 实时输出进度
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              console.log(`   [Claude] ${line.trim().substring(0, 100)}${line.length > 100 ? '...' : ''}`);
            }
          }
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          resolve({
            success: code === 0 && !timedOut,
            output: stdout,
            exitCode: timedOut ? 124 : (code ?? 1),  // 124 是 timeout 命令的标准退出码
            duration,
            error: timedOut ? `执行超时 (${options.timeout}s)` : (code !== 0 ? stderr || `进程退出码: ${code}` : undefined),
          });
        });

        child.on('error', (error) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          resolve({
            success: false,
            output: '',
            exitCode: 1,
            duration,
            error: error.message,
          });
        });

      } catch (error) {
        resolve({
          success: false,
          output: '',
          exitCode: 1,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
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
