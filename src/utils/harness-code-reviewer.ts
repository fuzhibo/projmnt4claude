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
  RetryContext,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import {
  saveReport,
  filterCheckpoints,
  parseVerdictResult,
  getReportPath,
  REVIEW_TIMEOUT_RATIO,
} from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { getCodeReviewRoleTemplate } from './role-prompts.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { verdictResultMarker, verdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { t } from '../i18n/index.js';

export class HarnessCodeReviewer {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 执行代码审核
   */
  async review(task: TaskMeta, devReport: DevReport, retryContext?: RetryContext): Promise<CodeReviewVerdict> {
    const texts = t(this.config.cwd);
    console.log(`\n🔍 ${texts.harness.logs.codeReviewPhase}`);
    console.log(`   ${texts.harness.logs.taskLabel}: ${task.title}`);

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
      verdict.reason = `${texts.harness.logs.devPhaseNotComplete}: ${devReport.status}`;
      if (devReport.error) {
        verdict.reason += ` - ${devReport.error}`;
      }
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    try {
      // 1. 获取代码审核类检查点
      const codeReviewCheckpoints = this.getCodeReviewCheckpoints(task);
      console.log(`   📋 ${texts.harness.logs.codeReviewCheckpoints}: ${codeReviewCheckpoints.length}`);

      if (codeReviewCheckpoints.length === 0) {
        verdict.result = 'PASS';
        verdict.reason = texts.harness.logs.noCodeReviewCheckpoints;
        console.log(`   ✅ ${texts.harness.logs.noCodeReviewCheckpoints}`);
      } else {
        // 2. 运行代码审核
        const reviewResult = await this.runCodeReview(task, devReport, codeReviewCheckpoints, retryContext);

        verdict.result = reviewResult.passed ? 'PASS' : 'NOPASS';
        verdict.reason = reviewResult.reason;
        verdict.codeQualityIssues = reviewResult.issues;
        verdict.failedCheckpoints = reviewResult.failedCheckpoints;
        verdict.details = reviewResult.details;

        // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
        const contradiction = detectContradiction(verdict.result, verdict.reason || '');
        if (contradiction.hasContradiction && contradiction.correctedResult) {
          console.log(`   ⚠️  ${texts.harness.logs.contradictionDetected}: ${contradiction.reason}`);
          verdict.result = contradiction.correctedResult;
          verdict.reason += ` [${texts.harness.logs.contradictionDetected}: ${contradiction.reason}]`;
        }

        if (verdict.result === 'PASS') {
          console.log(`\n   ✅ ${texts.harness.logs.codeReviewPassed}`);
        } else {
          console.log(`\n   ❌ ${texts.harness.logs.codeReviewFailed}: ${verdict.reason}`);
        }
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.codeReviewError}: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ ${texts.harness.logs.codeReviewError}: ${verdict.reason}`);
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
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): Promise<{
    passed: boolean;
    reason: string;
    issues: string[];
    failedCheckpoints: string[];
    details?: string;
  }> {
    const texts = t(this.config.cwd);
    const prompt = this.buildCodeReviewPrompt(task, devReport, checkpoints, retryContext);
    console.log(`\n   📝 ${texts.harness.logs.codeReviewPromptGenerated}`);

    console.log(`\n   🤖 ${texts.harness.logs.startingCodeReviewSession}`);
    const agent = getAgent(this.config.cwd);
    const effectiveTools = buildEffectiveTools('codeReview', this.config.cwd, task);
    const invokeOptions = {
      allowedTools: effectiveTools.tools,
      timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
      cwd: this.config.cwd,
      maxRetries: this.config.apiRetryAttempts,
      outputFormat: 'text',
      dangerouslySkipPermissions: effectiveTools.skipPermissions,
    };

    const engine = createSessionAwareEngine(
      'markdown',
      [verdictResultMarker, verdictHasReason],
      1, // maxRetriesOnError (code review: 1 retry)
    );
    const engineResult = await engine.runWithFeedback(
      agent.invoke.bind(agent),
      prompt,
      invokeOptions,
    );

    if (engineResult.retries > 0) {
      console.log(`   🔄 ${texts.harness.logs.codeReviewRetry.replace('{retries}', String(engineResult.retries))}`);
    }

    if (!engineResult.result.success) {
      return {
        passed: false,
        reason: `${texts.harness.logs.codeReviewSessionFailed}: ${engineResult.result.error || 'unknown error'}`,
        issues: [],
        failedCheckpoints: [],
      };
    }

    return this.parseCodeReviewResult(engineResult.result.output || '');
  }

  /**
   * 构建代码审核提示词
   */
  private buildCodeReviewPrompt(
    task: TaskMeta,
    devReport: DevReport,
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): string {
    const roleTemplate = getCodeReviewRoleTemplate(task.recommendedRole);

    // Build conditional sections
    const retryContextSection = retryContext?.previousFailureReason
      ? `## ${texts.harness.logs.previousReviewFailureReason}\n\n${texts.harness.logs.previousCodeReviewFailed}:\n\n> ${retryContext.previousFailureReason}\n\n${texts.harness.logs.ensureFixesCover}.`
      : '';

    const descriptionSection = task.description
      ? `## ${texts.harness.taskDescription}\n${task.description}`
      : '';

    const checkpointsList = checkpoints.map((cp, i) => {
      let line = `${i + 1}. [${cp.id}] ${cp.description}`;
      if (cp.verification?.commands) {
        line += `\n   ${texts.harness.logs.verificationCommands}: ${cp.verification.commands.join(', ')}`;
      }
      return line;
    }).join('\n');

    const changesSection = devReport.changes.length > 0
      ? `## ${texts.harness.logs.developerDeclaredChanges}\n${devReport.changes.map(change => `- ${change}`).join('\n')}`
      : '';

    const evidenceSection = devReport.evidence.length > 0
      ? `## ${texts.harness.logs.submittedEvidence}\n${devReport.evidence.map(evidence => `- ${evidence}`).join('\n')}`
      : '';

    const reviewFocus = roleTemplate.reviewFocus.map((focus, i) => `${i + 1}. ${focus}`).join('\n');

    const template = loadPromptTemplate('codeReview', this.config.cwd);
    return resolveTemplate(template, {
      roleDeclaration: roleTemplate.roleDeclaration,
      taskId: task.id,
      title: task.title,
      descriptionSection,
      checkpointsList,
      changesSection,
      evidenceSection,
      reviewFocus,
      retryContextSection,
    }).replace(/\n{3,}/g, '\n\n');
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
    const texts = t(this.config.cwd);

    const lines: string[] = [
      `# ${texts.harness.reports.codeReviewReportTitle} - ${verdict.taskId}`,
      '',
      `**${texts.harness.reports.resultLabel}**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**${texts.harness.reports.reviewedAtLabel}**: ${verdict.reviewedAt}`,
      `**${texts.harness.reports.reviewedByLabel}**: ${verdict.reviewedBy}`,
      '',
      `## ${texts.harness.reports.reasonSection}`,
      verdict.reason,
      '',
    ];

    if (verdict.codeQualityIssues.length > 0) {
      lines.push(`## ${texts.harness.reports.codeQualityIssuesSection}`);
      verdict.codeQualityIssues.forEach(issue => {
        lines.push(`- ${issue}`);
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

    return lines.join('\n');
  }
}
