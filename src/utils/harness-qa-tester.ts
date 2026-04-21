/**
 * HarnessQATester - QA 验证阶段处理器
 *
 * 负责执行 QA 验证检查点：
 * - 运行单元测试
 * - 运行功能测试
 * - 运行集成测试
 * - 判断是否需要人工验证
 */

import * as path from 'path';
import type {
  HarnessConfig,
  CodeReviewVerdict,
  QAVerdict,
  RetryContext,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { validateCheckpointVerification } from '../types/task.js';
import {
  saveReport,
  filterCheckpoints,
  parseVerdictResult,
  getReportPath,
  REVIEW_TIMEOUT_RATIO,
} from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { getQARoleTemplate } from './role-prompts.js';
import { generateFallbackVerification } from './checkpoint.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { qaVerdictResultMarker, qaVerdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { t, getI18n } from '../i18n/index.js';

/**
 * 验证检查点的验证信息完整性
 * 用于 QA 提示词中显示警告
 */
function checkCheckpointVerification(cp: CheckpointMetadata): { valid: boolean; warning?: string } {
  return validateCheckpointVerification(cp);
}

export class HarnessQATester {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 执行 QA 验证
   */
  async verify(task: TaskMeta, codeReviewVerdict: CodeReviewVerdict, retryContext?: RetryContext): Promise<QAVerdict> {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }
    console.log(`\n🧪 ${texts.harness.logs.qaPhase}`);
    console.log(`   ${texts.harness.logs.taskLabel}: ${task.title}`);

    const verdict: QAVerdict = {
      taskId: task.id,
      result: 'PASS',
      reason: '',
      testFailures: [],
      failedCheckpoints: [],
      requiresHuman: false,
      humanVerificationCheckpoints: [],
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'qa_tester',
    };

    // 如果代码审核未通过，直接返回 NOPASS
    if (codeReviewVerdict.result !== 'PASS') {
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.qaSkippedDueToCodeReview}: ${codeReviewVerdict.reason}`;
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    try {
      // 1. 获取 QA 验证类检查点
      const qaCheckpoints = this.getQACheckpoints(task);
      console.log(`   📋 ${texts.harness.logs.qaCheckpoints}: ${qaCheckpoints.length}`);

      if (qaCheckpoints.length === 0) {
        // 没有 QA 检查点，直接通过
        verdict.result = 'PASS';
        verdict.reason = texts.harness.logs.noQACheckpoints;
        console.log(`   ✅ ${texts.harness.logs.noQACheckpoints}`);
      } else {
        // 2. 检查是否有人工验证检查点
        const humanCheckpoints = qaCheckpoints.filter(cp => cp.requiresHuman === true);
        verdict.humanVerificationCheckpoints = humanCheckpoints.map(cp => cp.id);

        // 3. 运行自动化 QA 验证
        const qaResult = await this.runQAVerification(task, codeReviewVerdict, qaCheckpoints, retryContext);

        verdict.result = qaResult.passed ? 'PASS' : 'NOPASS';
        verdict.reason = qaResult.reason;
        verdict.testFailures = qaResult.failures;
        verdict.failedCheckpoints = qaResult.failedCheckpoints;
        verdict.details = qaResult.details;

        // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
        const contradiction = detectContradiction(verdict.result, verdict.reason || '');
        if (contradiction.hasContradiction && contradiction.correctedResult) {
          console.log(`   ⚠️  ${texts.harness.logs.contradictionDetected}: ${contradiction.reason}`);
          verdict.result = contradiction.correctedResult;
          verdict.reason += ` [${texts.harness.logs.contradictionDetected}: ${contradiction.reason}]`;
        }

        // 4. 标记需要人工验证的检查点（仅信息标记，不影响 PASS/NOPASS 判定）
        if (humanCheckpoints.length > 0) {
          verdict.requiresHuman = true;
          // 注意: requiresHuman 仅作为信息标记，reason 不附加人工检查点信息
          // 人工检查点信息通过 requiresHuman + humanVerificationCheckpoints 字段传递
          const deferredInfo = `${texts.harness.logs.deferredCheckpointsInfo.replace('{count}', String(humanCheckpoints.length))}: ${humanCheckpoints.map(cp => cp.id).join(', ')}`;
          verdict.details = verdict.details ? `${verdict.details}\n${deferredInfo}` : deferredInfo;
          console.log(`\n   ⏳ ${deferredInfo}`);
        }

        if (verdict.result === 'PASS' && !verdict.requiresHuman) {
          console.log(`\n   ✅ ${texts.harness.logs.qaPassed}`);
        } else if (verdict.result === 'PASS' && verdict.requiresHuman) {
          console.log(`\n   ⏳ ${texts.harness.logs.qaPassedWithHuman}`);
        } else {
          console.log(`\n   ❌ ${texts.harness.logs.qaFailed}: ${verdict.reason}`);
        }
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.qaError}: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ ${texts.harness.logs.qaError}: ${verdict.reason}`);
    }

    // 保存 QA 报告
    await this.saveReport(task.id, verdict);

    return verdict;
  }

  /**
   * 获取 QA 验证类检查点
   */
  private getQACheckpoints(task: TaskMeta): CheckpointMetadata[] {
    return filterCheckpoints(task, cp =>
      cp.category === 'qa_verification' ||
      cp.verification?.method === 'unit_test' ||
      cp.verification?.method === 'functional_test' ||
      cp.verification?.method === 'integration_test' ||
      cp.verification?.method === 'e2e_test' ||
      cp.verification?.method === 'automated' ||
      cp.requiresHuman === true
    );
  }

  /**
   * 运行 QA 验证
   */
  private async runQAVerification(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): Promise<{
    passed: boolean;
    reason: string;
    failures: string[];
    failedCheckpoints: string[];
    details?: string;
  }> {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }
    // 分离自动化检查点和人工验证检查点
    const automatedCheckpoints = checkpoints.filter(cp => !cp.requiresHuman);
    const humanCheckpoints = checkpoints.filter(cp => cp.requiresHuman === true);

    // BUG-013-2: 检查自动化检查点中是否有缺少验证命令的情况
    const checkpointsWithoutCommands = automatedCheckpoints.filter(cp => {
      const result = validateCheckpointVerification(cp);
      return !result.valid;
    });
    if (checkpointsWithoutCommands.length > 0) {
      console.log(`\n   ⚠️  ${texts.harness.logs.checkpointWarning.replace('{count}', String(checkpointsWithoutCommands.length))}:`);
      for (const cp of checkpointsWithoutCommands) {
        const result = validateCheckpointVerification(cp);
        console.log(`      - [${cp.id}] ${result.warning || texts.harness.logs.checkpointWarningDetail}`);
      }
      console.log(`      ${texts.harness.logs.checkpointWarningFallback}`);
    }

    if (automatedCheckpoints.length === 0) {
      // 只有需要人工验证的检查点，自动化 QA 自动通过
      // BUG-014-2B: reason 不包含"需要人工验证"字样，避免误导下游评估者
      return {
        passed: true,
        reason: texts.harness.logs.noAutomatedQACheckpoints,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 构建验证提示词
    const prompt = this.buildQAPrompt(task, codeReviewVerdict, automatedCheckpoints, retryContext);
    console.log(`\n   📝 ${texts.harness.logs.qaPromptGenerated}`);

    // 运行独立验证会话
    console.log(`\n   🤖 ${texts.harness.logs.startingQASession}`);
    const agent = getAgent(this.config.cwd);
    const effectiveTools = buildEffectiveTools('qaVerification', this.config.cwd, task);
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
      [qaVerdictResultMarker, qaVerdictHasReason],
      1, // maxRetriesOnError (QA: 1 retry)
    );
    const engineResult = await engine.runWithFeedback(
      agent.invoke.bind(agent),
      prompt,
      invokeOptions,
    );

    if (engineResult.retries > 0) {
      console.log(`   🔄 ${texts.harness.logs.qaRetry.replace('{retries}', String(engineResult.retries))}`);
    }

    if (!engineResult.result.success) {
      return {
        passed: false,
        reason: `${texts.harness.logs.qaSessionFailed}: ${engineResult.result.error || 'unknown error'}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 验证规则未通过（如缺少 VERDICT 标记），直接返回 NOPASS 避免解析失败
    if (!engineResult.passed) {
      const violationMessages = engineResult.violations
        .map((v: { ruleId: string; message: string }) => `${v.ruleId}: ${v.message}`)
        .join('; ');
      console.log(`   ⚠️  ${texts.harness.logs.qaOutputValidationFailed}: ${violationMessages}`);

      // 尝试从原始输出中提取可用信息
      const rawOutput = engineResult.result.output || '';
      const parsed = this.parseQAResult(rawOutput);
      // 如果解析到了有效结果（非默认原因），使用解析结果
      if (parsed.reason && parsed.reason !== texts.harness.logs.cannotParseVerdict) {
        return parsed;
      }

      return {
        passed: false,
        reason: `${texts.harness.logs.qaOutputValidationFailed}: ${violationMessages}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 解析验证结果
    return this.parseQAResult(engineResult.result.output || '');
  }

  /**
   * 构建 QA 验证提示词
   */
  private buildQAPrompt(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): string {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }
    const roleTemplate = getQARoleTemplate(task.recommendedRole);

    // Build retry context section
    let retryContextSection = '';
    if (retryContext?.previousFailureReason) {
      retryContextSection = [
        `## ${texts.harness.logs.previousQAFailureReason}`,
        '',
        `${texts.harness.logs.previousQAVerificationFailed}:`,
        '',
        `> ${retryContext.previousFailureReason}`,
        '',
        `${texts.harness.logs.pleaseNote}:`,
        `- ${texts.harness.logs.reviewPreviousFailure}`,
        `- ${texts.harness.logs.formalRequirementFix}`,
        `- ${texts.harness.logs.realIssuePersist}`,
        '',
      ].join('\n');
    }

    const descriptionSection = task.description
      ? `## ${texts.harness.taskDescription}\n${task.description}`
      : '';

    // Build checkpoints list with verification details
    const checkpointsList = checkpoints.map((cp, i) => {
      const lines: string[] = [`${i + 1}. [${cp.id}] ${cp.description}`];
      if (cp.verification?.commands && cp.verification.commands.length > 0) {
        lines.push(`   ${texts.harness.logs.verificationCommands}: ${cp.verification.commands.join(', ')}`);
      } else if (cp.verification?.steps && cp.verification.steps.length > 0) {
        lines.push(`   ${texts.harness.logs.verificationSteps}: ${cp.verification.steps.join('；')}`);
      } else {
        const fallback = generateFallbackVerification(cp.description, task);
        if (fallback.steps && fallback.steps.length > 0) {
          lines.push(`   ${texts.harness.logs.suggestedVerificationSteps}: ${fallback.steps.join('；')}`);
        }
        if (fallback.commands && fallback.commands.length > 0) {
          lines.push(`   ${texts.harness.logs.fallbackVerificationCommands}: ${fallback.commands.join(', ')}`);
        }
      }
      if (cp.verification?.expected) {
        lines.push(`   ${texts.harness.logs.expectedResult}: ${cp.verification.expected}`);
      }
      const cpValidation = validateCheckpointVerification(cp);
      if (!cpValidation.valid && cpValidation.warning) {
        lines.push(`   ⚠️ ${cpValidation.warning}`);
      }
      return lines.join('\n');
    }).join('\n');

    const testStrategy = roleTemplate.testStrategy.map((strategy, i) => `${i + 1}. ${strategy}`).join('\n');

    const template = loadPromptTemplate('qa', this.config.cwd);
    return resolveTemplate(template, {
      roleDeclaration: roleTemplate.roleDeclaration,
      taskId: task.id,
      title: task.title,
      descriptionSection,
      checkpointsList,
      codeReviewResult: codeReviewVerdict.result,
      codeReviewReason: codeReviewVerdict.reason,
      testStrategy,
      retryContextSection,
    }).replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 解析 QA 验证结果
   */
  private parseQAResult(output: string): {
    passed: boolean;
    reason: string;
    failures: string[];
    failedCheckpoints: string[];
    details?: string;
  } {
    const parsed = parseVerdictResult(output, {
      resultField: '验证结果',
      reasonField: '原因',
      listField: '测试失败',
      checkpointField: '未通过的检查点',
      detailsField: '详细反馈',
    });

    return {
      passed: parsed.passed,
      reason: parsed.reason,
      failures: parsed.items,
      failedCheckpoints: parsed.failedCheckpoints,
      details: parsed.details,
    };
  }

  /**
   * 保存 QA 报告
   */
  private async saveReport(taskId: string, verdict: QAVerdict): Promise<void> {
    const reportPath = getReportPath(taskId, 'qa', this.config.cwd);
    const content = this.formatReport(verdict);
    await saveReport(reportPath, content);
  }

  /**
   * 格式化 QA 报告
   */
  private formatReport(verdict: QAVerdict): string {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }

    const lines: string[] = [
      `# ${texts.harness.reports.qaReportTitle} - ${verdict.taskId}`,
      '',
      `**${texts.harness.reports.resultLabel}**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**${texts.harness.reports.reviewedAtLabel}**: ${verdict.verifiedAt}`,
      `**${texts.harness.reports.reviewedByLabel}**: ${verdict.verifiedBy}`,
      `**${texts.harness.reports.requiresHumanLabel}**: ${verdict.requiresHuman ? texts.harness.reports.yes : texts.harness.reports.no}`,
      '',
      `## ${texts.harness.reports.reasonSection}`,
      verdict.reason,
      '',
    ];

    if (verdict.testFailures.length > 0) {
      lines.push(`## ${texts.harness.reports.testFailuresSection}`);
      verdict.testFailures.forEach(failure => {
        lines.push(`- ${failure}`);
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

    if (verdict.humanVerificationCheckpoints.length > 0) {
      lines.push(`## ${texts.harness.reports.humanVerificationSection}`);
      lines.push(`*${texts.harness.reports.humanVerificationNote}*`);
      verdict.humanVerificationCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint} [deferred]`);
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
