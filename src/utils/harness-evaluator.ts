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
import { spawn } from 'child_process';
import {
  HarnessConfig,
  SprintContract,
  DevReport,
  ReviewVerdict,
  HeadlessClaudeOptions,
} from '../types/harness.js';
import { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { getProjectDir } from './path.js';
import { readTaskMeta } from './task.js';
import { classifyExitResult } from './harness-helpers.js';

/**
 * 检测是否为可重试的 API 错误
 */
function isRetryableError(output: string, stderr: string): { retryable: boolean; waitSeconds?: number; reason?: string } {
  const combinedOutput = `${output} ${stderr}`;

  // 429 Rate Limit
  const rateLimitMatch = combinedOutput.match(/API Error:\s*429.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (rateLimitMatch) {
    const resetTime = new Date(rateLimitMatch[1]);
    const now = new Date();
    const waitSeconds = Math.max(60, Math.ceil((resetTime.getTime() - now.getTime()) / 1000));
    return { retryable: true, waitSeconds, reason: 'API 速率限制 (429)' };
  }

  // 500 Server Error
  if (combinedOutput.includes('API Error: 500') || combinedOutput.includes('"code":"500"')) {
    return { retryable: true, waitSeconds: 30, reason: 'API 服务器错误 (500)' };
  }

  // Network/Connection errors
  if (combinedOutput.includes('ECONNRESET') ||
      combinedOutput.includes('ETIMEDOUT') ||
      combinedOutput.includes('ENOTFOUND') ||
      combinedOutput.includes('network error')) {
    return { retryable: true, waitSeconds: 10, reason: '网络连接错误' };
  }

  return { retryable: false };
}

/**
 * 延迟函数
 */
function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

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
    contract: SprintContract
  ): Promise<ReviewVerdict> {
    console.log(`   评估任务: ${task.title}`);
    console.log(`   开发状态: ${devReport.status}`);

    const verdict: ReviewVerdict = {
      taskId: task.id,
      result: 'NOPASS',
      reason: '',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'harness-evaluator',
    };

    // 如果开发阶段失败，直接返回 NOPASS
    if (devReport.status !== 'success') {
      verdict.result = 'NOPASS';
      verdict.reason = `开发阶段未成功完成: ${devReport.status}`;
      if (devReport.error) {
        verdict.reason += ` - ${devReport.error}`;
      }
      await this.saveReviewReport(task.id, verdict, devReport);
      return verdict;
    }

    try {
      // 1. 加载 Sprint Contract（从文件系统，确保隔离）
      const loadedContract = this.loadContract(task.id);
      if (loadedContract) {
        Object.assign(contract, loadedContract);
      }

      // 2. 构建评估提示词
      const prompt = this.buildEvaluationPrompt(task, devReport, contract);
      console.log('\n   📝 评估提示词已生成');

      // 3. 运行独立评估会话
      console.log('\n   🔍 启动独立评估会话...');
      const result = await this.runEvaluationSession({
        prompt,
        allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
        timeout: Math.floor(this.config.timeout / 2), // 审查时间较短
        cwd: this.config.cwd,
        outputFormat: 'text',
      });

      // 4. 解析评估结果
      const evaluation = this.parseEvaluationResult(result.output);

      verdict.result = evaluation.passed ? 'PASS' : 'NOPASS';
      verdict.reason = evaluation.reason;
      verdict.failedCriteria = evaluation.failedCriteria;
      verdict.failedCheckpoints = evaluation.failedCheckpoints;
      verdict.details = evaluation.details;

      if (verdict.result === 'PASS') {
        console.log('\n   ✅ 审查通过');
      } else {
        console.log(`\n   ❌ 审查未通过: ${verdict.reason}`);
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `评估过程出错: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ 评估出错: ${verdict.reason}`);
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
    contract: SprintContract
  ): string {
    const parts: string[] = [];

    parts.push('# 代码审查任务');
    parts.push('');
    parts.push('你是一个独立的代码审查员。你需要评估一个任务的完成情况，判断是否满足验收标准。');
    parts.push('');
    parts.push('**重要**: 你必须独立判断，不要因为这是 AI 完成的工作就给予优待。');
    parts.push('');

    parts.push('## 任务信息');
    parts.push(`- ID: ${task.id}`);
    parts.push(`- 标题: ${task.title}`);
    parts.push(`- 类型: ${task.type}`);
    parts.push('');

    if (task.description) {
      parts.push('## 任务描述');
      parts.push(task.description);
      parts.push('');
    }

    parts.push('## 验收标准');
    if (contract.acceptanceCriteria.length > 0) {
      contract.acceptanceCriteria.forEach((criteria, i) => {
        parts.push(`${i + 1}. ${criteria}`);
      });
    } else {
      parts.push('（未定义具体验收标准，请根据任务描述判断）');
    }
    parts.push('');

    if (contract.verificationCommands.length > 0) {
      parts.push('## 验证命令');
      parts.push('请运行以下命令验证实现:');
      parts.push('```bash');
      contract.verificationCommands.forEach(cmd => {
        parts.push(cmd);
      });
      parts.push('```');
      parts.push('');
    }

    if (contract.checkpoints.length > 0) {
      parts.push('## 检查点');
      parts.push('请确认以下检查点是否完成:');
      contract.checkpoints.forEach((cp, i) => {
        parts.push(`${i + 1}. ${cp}`);
      });
      parts.push('');
    }

    if (devReport.evidence.length > 0) {
      parts.push('## 提交的证据');
      parts.push('开发者提交了以下证据:');
      devReport.evidence.forEach(evidence => {
        parts.push(`- ${evidence}`);
      });
      parts.push('');
    }

    if (devReport.checkpointsCompleted.length > 0) {
      parts.push('## 开发者声明的完成检查点');
      devReport.checkpointsCompleted.forEach(cp => {
        parts.push(`- ${cp}`);
      });
      parts.push('');
    }

    parts.push('## 评估要求');
    parts.push('1. 阅读任务描述和验收标准');
    parts.push('2. 检查相关代码文件');
    parts.push('3. 运行验证命令（如有）');
    parts.push('4. 验证每个验收标准是否满足');
    parts.push('5. 检查代码质量（可读性、可维护性）');
    parts.push('');

    parts.push('## 输出格式');
    parts.push('请按以下格式输出评估结果:');
    parts.push('```');
    parts.push('## 评估结果: PASS 或 NOPASS');
    parts.push('## 原因: [简要说明为什么通过或不通过]');
    parts.push('## 未满足的标准: [列出未满足的验收标准，如果没有则为空]');
    parts.push('## 未完成的检查点: [列出未完成的检查点，如果没有则为空]');
    parts.push('## 详细反馈: [可选的详细反馈]');
    parts.push('```');
    parts.push('');
    parts.push('现在开始评估。');

    return parts.join('\n');
  }

  /**
   * 运行评估会话（带重试机制）
   */
  private async runEvaluationSession(options: HeadlessClaudeOptions): Promise<{ output: string; success: boolean }> {
    const maxAttempts = this.config.apiRetryAttempts + 1;
    const baseDelay = this.config.apiRetryDelay;
    let lastOutput = '';
    let lastStderr = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`   🔄 评估会话重试 (${attempt - 1}/${this.config.apiRetryAttempts})...`);
      }

      const result = await this.executeEvaluationSession(options);
      lastOutput = result.output;
      lastStderr = result.stderr;

      if (result.success) {
        return { output: result.output, success: true };
      }

      // 检查是否为可重试错误
      const errorInfo = isRetryableError(result.output, result.stderr);

      if (!errorInfo.retryable || attempt >= maxAttempts) {
        return { output: result.output, success: false };
      }

      // 计算退避延迟
      const delay = Math.min(errorInfo.waitSeconds || baseDelay, baseDelay * Math.pow(2, attempt - 1));
      console.log(`   ⏳ ${errorInfo.reason}，${delay} 秒后重试...`);

      await sleep(delay);
    }

    return { output: lastOutput, success: false };
  }

  /**
   * 执行单次评估会话
   */
  private executeEvaluationSession(options: HeadlessClaudeOptions): Promise<{ output: string; stderr: string; success: boolean }> {
    return new Promise((resolve) => {
      // 注意：--allowedTools 必须在 --print 之前，否则 Claude CLI 会报错
      // "Input must be provided either through stdin or as a prompt argument when using --print"
      // 注意：prompt 通过 stdin 传递，而不是命令行参数
      // 这样可以避免多行文本作为命令行参数时的解析问题
      const args = [
        '--allowedTools', options.allowedTools.join(','),
        '--print',
        '--dangerously-skip-permissions',
      ];

      try {
        const child = spawn('claude', args, {
          cwd: options.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],  // stdin 改为 pipe 以支持写入
        });

        // 通过 stdin 传递 prompt
        if (child.stdin) {
          child.stdin.write(options.prompt);
          child.stdin.end();
        }

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // 自定义超时逻辑
        const timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeout * 1000);

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);

          // 超时场景直接失败
          if (timedOut) {
            resolve({
              output: stdout,
              stderr,
              success: false,
            });
            return;
          }

          // 使用共享函数智能判断区分 hook 失败和任务失败
          const classified = classifyExitResult(code, stderr, stdout);
          resolve({
            output: stdout,
            stderr,
            success: classified.success,
          });
        });

        child.on('error', (error) => {
          clearTimeout(timeoutId);
          resolve({
            output: '',
            stderr: error.message,
            success: false,
          });
        });

      } catch (error) {
        resolve({
          output: '',
          stderr: error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
    });
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
  } {
    const result = {
      passed: false,
      reason: '',
      failedCriteria: [] as string[],
      failedCheckpoints: [] as string[],
      details: '',
    };

    // 多模式匹配评估结果
    const resultPatterns = [
      // 标准格式: ## 评估结果: PASS/NOPASS
      /##\s*评估结果\s*[:：]?\s*(PASS|NOPASS)/i,
      // 宽松格式: 评估结果 PASS/NOPASS
      /(?:评估结果|Evaluation Result|Result)[:：]?\s*(PASS|NOPASS)/i,
      // 简单匹配: PASS 或 NOPASS 单独出现
      /\b(PASS|NOPASS)\b/i,
      // JSON 格式: "result": "PASS"
      /"result"\s*[:：]\s*"(PASS|NOPASS)"/i,
    ];

    let resultMatch: RegExpMatchArray | null = null;
    for (const pattern of resultPatterns) {
      resultMatch = output.match(pattern);
      if (resultMatch) {
        result.passed = resultMatch[1].toUpperCase() === 'PASS';
        break;
      }
    }

    // 如果没有匹配到，尝试中文判断
    if (!resultMatch) {
      const hasPositive = /(?:通过|✅|成功|符合要求|满足标准)/.test(output);
      const hasNegative = /(?:不通过|未通过|❌|失败|不符合|不满足)/.test(output);
      if (hasPositive && !hasNegative) {
        result.passed = true;
        resultMatch = ['通过', '通过'] as RegExpMatchArray;
      } else if (hasNegative) {
        result.passed = false;
        resultMatch = ['不通过', 'NOPASS'] as RegExpMatchArray;
      }
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

    // 如果没有提取到原因，设置默认值
    if (!result.reason) {
      if (result.passed) {
        result.reason = '基于输出内容的判断：评估通过';
      } else if (resultMatch) {
        result.reason = '基于输出内容的判断：评估未通过';
      } else {
        // 最后尝试：检查是否包含明确的通过/不通过词汇
        const lowerOutput = output.toLowerCase();
        if (lowerOutput.includes('pass') && !lowerOutput.includes('nopass') && !lowerOutput.includes('not pass')) {
          result.passed = true;
          result.reason = '基于输出内容的简单判断：包含 PASS';
        } else if (lowerOutput.includes('审查通过') || lowerOutput.includes('审核通过') || lowerOutput.includes('评估通过')) {
          result.passed = true;
          result.reason = '基于输出内容的简单判断：包含"通过"关键词';
        } else {
          result.reason = '无法解析评估结果';
          // 添加调试信息
          console.log('   ⚠️  解析失败，原始输出前500字符:');
          console.log(output.substring(0, 500));
        }
      }
    }

    return result;
  }

  /**
   * 加载 Contract
   */
  private loadContract(taskId: string): SprintContract | null {
    const contractPath = this.getContractPath(taskId);

    if (!fs.existsSync(contractPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(contractPath, 'utf-8');
      return JSON.parse(content);
    } catch {
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

    const content = this.formatReviewReport(verdict, devReport);
    fs.writeFileSync(reportPath, content, 'utf-8');
  }

  /**
   * 格式化审查报告
   */
  private formatReviewReport(verdict: ReviewVerdict, devReport: DevReport): string {
    const lines: string[] = [
      `# 审查报告 - ${verdict.taskId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**审查时间**: ${verdict.reviewedAt}`,
      `**审查者**: ${verdict.reviewedBy}`,
      '',
      '## 原因',
      verdict.reason,
      '',
    ];

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

    lines.push('## 开发阶段信息');
    lines.push(`- 状态: ${devReport.status}`);
    lines.push(`- 耗时: ${(devReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- 证据数量: ${devReport.evidence.length}`);
    lines.push(`- 完成检查点: ${devReport.checkpointsCompleted.length}`);

    return lines.join('\n');
  }
}
