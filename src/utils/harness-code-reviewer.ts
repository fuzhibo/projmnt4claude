/**
 * HarnessCodeReviewer - 代码审核阶段处理器
 *
 * 负责执行代码审核检查点：
 * - 检查代码质量
 * - 运行 lint
 * - 验证代码规范
 * - 生成代码审核报告
 */

import * as path from 'path';
import type {
  HarnessConfig,
  DevReport,
  CodeReviewVerdict,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import {
  saveReport,
  filterCheckpoints,
  parseVerdictResult,
  getReportPath,
  REVIEW_TIMEOUT_RATIO,
} from './harness-helpers.js';
import { getAgent } from './headless-agent.js';
import { getCodeReviewRoleTemplate } from './role-prompts.js';
import { detectContradiction } from './contradiction-detector.js';

export class HarnessCodeReviewer {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 执行代码审核
   */
  async review(task: TaskMeta, devReport: DevReport): Promise<CodeReviewVerdict> {
    console.log(`\n🔍 代码审核阶段...`);
    console.log(`   任务: ${task.title}`);

    const verdict: CodeReviewVerdict = {
      taskId: task.id,
      result: 'PASS',
      reason: '',
      codeQualityIssues: [],
      failedCheckpoints: [],
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'code_reviewer',
    };

    // 如果开发阶段失败，直接返回 NOPASS
    if (devReport.status !== 'success') {
      verdict.result = 'NOPASS';
      verdict.reason = `开发阶段未成功完成: ${devReport.status}`;
      if (devReport.error) {
        verdict.reason += ` - ${devReport.error}`;
      }
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    try {
      // 1. 获取代码审核类检查点
      const codeReviewCheckpoints = this.getCodeReviewCheckpoints(task);
      console.log(`   📋 代码审核检查点: ${codeReviewCheckpoints.length} 个`);

      if (codeReviewCheckpoints.length === 0) {
        verdict.result = 'PASS';
        verdict.reason = '无代码审核检查点，自动通过';
        console.log('   ✅ 无代码审核检查点，自动通过');
      } else {
        // 2. 运行代码审核
        const reviewResult = await this.runCodeReview(task, devReport, codeReviewCheckpoints);

        verdict.result = reviewResult.passed ? 'PASS' : 'NOPASS';
        verdict.reason = reviewResult.reason;
        verdict.codeQualityIssues = reviewResult.issues;
        verdict.failedCheckpoints = reviewResult.failedCheckpoints;
        verdict.details = reviewResult.details;

        // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
        const contradiction = detectContradiction(verdict.result, verdict.reason || '');
        if (contradiction.hasContradiction && contradiction.correctedResult) {
          console.log(`   ⚠️  矛盾检测: ${contradiction.reason}`);
          verdict.result = contradiction.correctedResult;
          verdict.reason += ` [矛盾修正: ${contradiction.reason}]`;
        }

        if (verdict.result === 'PASS') {
          console.log('\n   ✅ 代码审核通过');
        } else {
          console.log(`\n   ❌ 代码审核未通过: ${verdict.reason}`);
        }
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `代码审核过程出错: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ 代码审核出错: ${verdict.reason}`);
    }

    await this.saveReport(task.id, verdict);
    return verdict;
  }

  /**
   * 获取代码审核类检查点
   */
  private getCodeReviewCheckpoints(task: TaskMeta): CheckpointMetadata[] {
    return filterCheckpoints(task, cp =>
      cp.category === 'code_review' ||
      cp.verification?.method === 'code_review' ||
      cp.verification?.method === 'lint' ||
      cp.verification?.method === 'architect_review'
    );
  }

  /**
   * 运行代码审核
   */
  private async runCodeReview(
    task: TaskMeta,
    devReport: DevReport,
    checkpoints: CheckpointMetadata[]
  ): Promise<{
    passed: boolean;
    reason: string;
    issues: string[];
    failedCheckpoints: string[];
    details?: string;
  }> {
    const prompt = this.buildCodeReviewPrompt(task, devReport, checkpoints);
    console.log('\n   📝 代码审核提示词已生成');

    console.log('\n   🤖 启动代码审核会话...');
    const agent = getAgent(this.config.cwd);
    const claudeResult = await agent.invoke(prompt, {
      allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
      timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
      cwd: this.config.cwd,
      maxRetries: this.config.apiRetryAttempts,
      outputFormat: 'text',
    });

    if (!claudeResult.success) {
      return {
        passed: false,
        reason: `代码审核会话失败: ${claudeResult.error || '未知错误'}`,
        issues: [],
        failedCheckpoints: [],
      };
    }

    return this.parseCodeReviewResult(claudeResult.output);
  }

  /**
   * 构建代码审核提示词
   */
  private buildCodeReviewPrompt(
    task: TaskMeta,
    devReport: DevReport,
    checkpoints: CheckpointMetadata[]
  ): string {
    const parts: string[] = [];

    const roleTemplate = getCodeReviewRoleTemplate(task.recommendedRole);

    parts.push('# 代码审核任务');
    parts.push('');
    parts.push(`${roleTemplate.roleDeclaration}你需要审核一个任务的代码实现，确保代码质量符合标准。`);
    parts.push('');
    parts.push('**重要**: 你必须严格审核，发现所有代码质量问题。');
    parts.push('');

    parts.push('## 任务信息');
    parts.push(`- ID: ${task.id}`);
    parts.push(`- 标题: ${task.title}`);
    parts.push('');

    if (task.description) {
      parts.push('## 任务描述');
      parts.push(task.description);
      parts.push('');
    }

    parts.push('## 代码审核检查点');
    checkpoints.forEach((cp, i) => {
      parts.push(`${i + 1}. [${cp.id}] ${cp.description}`);
      if (cp.verification?.commands) {
        parts.push(`   验证命令: ${cp.verification.commands.join(', ')}`);
      }
    });
    parts.push('');

    if (devReport.changes.length > 0) {
      parts.push('## 开发者声明的变更');
      devReport.changes.forEach(change => {
        parts.push(`- ${change}`);
      });
      parts.push('');
    }

    if (devReport.evidence.length > 0) {
      parts.push('## 提交的证据');
      devReport.evidence.forEach(evidence => {
        parts.push(`- ${evidence}`);
      });
      parts.push('');
    }

    parts.push('## 审核要求');
    roleTemplate.reviewFocus.forEach((focus, i) => {
      parts.push(`${i + 1}. ${focus}`);
    });
    parts.push('');

    parts.push('## 输出格式');
    parts.push('请按以下格式输出审核结果:');
    parts.push('```');
    parts.push('VERDICT: PASS 或 VERDICT: NOPASS');
    parts.push('## 审核结果: PASS 或 NOPASS');
    parts.push('## 原因: [简要说明为什么通过或不通过]');
    parts.push('## 代码质量问题: [列出发现的问题，如果没有则为空]');
    parts.push('## 未通过的检查点: [列出未通过的检查点ID，如果没有则为空]');
    parts.push('## 详细反馈: [可选的详细反馈]');
    parts.push('```');
    parts.push('');
    parts.push('**重要**: 必须输出 VERDICT: PASS 或 VERDICT: NOPASS，不得使用"通过"、"不通过"等中文词语。');
    parts.push('');
    parts.push('现在开始审核。');

    return parts.join('\n');
  }

  /**
   * 解析代码审核结果
   */
  private parseCodeReviewResult(output: string): {
    passed: boolean;
    reason: string;
    issues: string[];
    failedCheckpoints: string[];
    details?: string;
  } {
    const parsed = parseVerdictResult(output, {
      resultField: '审核结果',
      reasonField: '原因',
      listField: '代码质量问题',
      checkpointField: '未通过的检查点',
      detailsField: '详细反馈',
    });

    return {
      passed: parsed.passed,
      reason: parsed.reason,
      issues: parsed.items,
      failedCheckpoints: parsed.failedCheckpoints,
      details: parsed.details,
    };
  }

  /**
   * 保存代码审核报告
   */
  private async saveReport(taskId: string, verdict: CodeReviewVerdict): Promise<void> {
    const reportPath = getReportPath(taskId, 'code-review', this.config.cwd);
    const content = this.formatReport(verdict);
    await saveReport(reportPath, content);
  }

  /**
   * 格式化报告
   */
  private formatReport(verdict: CodeReviewVerdict): string {
    const lines: string[] = [
      `# 代码审核报告 - ${verdict.taskId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**审核时间**: ${verdict.reviewedAt}`,
      `**审核者**: ${verdict.reviewedBy}`,
      '',
      '## 原因',
      verdict.reason,
      '',
    ];

    if (verdict.codeQualityIssues.length > 0) {
      lines.push('## 代码质量问题');
      verdict.codeQualityIssues.forEach(issue => {
        lines.push(`- ${issue}`);
      });
      lines.push('');
    }

    if (verdict.failedCheckpoints.length > 0) {
      lines.push('## 未通过的检查点');
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

    return lines.join('\n');
  }
}
