/**
 * Evaluation - Evaluation phase handler for smart routing
 *
 * CP-2: Evaluation class for smart routing mechanism
 * Used when Evaluation phase fails to determine appropriate rollback target
 *
 * @module evaluation
 */

import type { RoutingDecision } from '../types/task.js';
import type { FlowTarget } from '../types/harness.js';

/**
 * Evaluation class
 *
 * Handles evaluation failure analysis for smart routing.
 * Determines the appropriate target phase based on failure patterns.
 */
export class Evaluation {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Analyze evaluation result to determine routing target
   *
   * CP-6: Used during smart routing to decide rollback target
   *
   * @param evaluationResult - Evaluation result message
   * @param evaluationLogs - Optional evaluation logs for deeper analysis
   * @returns RoutingDecision with target phase and reasoning
   */
  analyzeEvaluationResult(
    evaluationResult: string,
    evaluationLogs?: string
  ): RoutingDecision {
    const resultLower = evaluationResult.toLowerCase();

    // Code quality issues → development
    if (
      resultLower.includes('代码质量') ||
      resultLower.includes('code quality') ||
      resultLower.includes('代码风格') ||
      resultLower.includes('style') ||
      resultLower.includes('lint') ||
      resultLower.includes('格式化') ||
      resultLower.includes('formatting')
    ) {
      return {
        problemSource: 'development',
        targetPhase: 'development',
        reason: '代码质量问题需要在开发阶段修复',
        specificIssues: this.extractSpecificIssues(evaluationResult, [
          '代码质量',
          'code quality',
          '风格',
          'style',
          'lint',
          '格式化',
        ]),
      };
    }

    // Test failures → QA
    if (
      resultLower.includes('测试失败') ||
      resultLower.includes('test failure') ||
      resultLower.includes('测试用例') ||
      resultLower.includes('test case') ||
      resultLower.includes('断言') ||
      resultLower.includes('assertion')
    ) {
      return {
        problemSource: 'qa',
        targetPhase: 'qa',
        reason: '测试失败需要在QA阶段重新验证',
        specificIssues: this.extractSpecificIssues(evaluationResult, [
          '测试失败',
          'test failure',
          '测试用例',
          'test case',
          '断言',
          'assertion',
        ]),
      };
    }

    // Code review issues → code_review
    if (
      resultLower.includes('代码审查') ||
      resultLower.includes('code review') ||
      resultLower.includes('审查意见') ||
      resultLower.includes('review comment') ||
      resultLower.includes('cr问题') ||
      resultLower.includes('cr issue')
    ) {
      return {
        problemSource: 'code_review',
        targetPhase: 'code_review',
        reason: '代码审查问题需要重新审查',
        specificIssues: this.extractSpecificIssues(evaluationResult, [
          '代码审查',
          'code review',
          '审查意见',
          'review comment',
        ]),
      };
    }

    // Check evaluation logs if provided
    if (evaluationLogs) {
      const logsLower = evaluationLogs.toLowerCase();

      if (
        logsLower.includes('coverage') ||
        logsLower.includes('覆盖率') ||
        logsLower.includes('测试覆盖')
      ) {
        return {
          problemSource: 'qa',
          targetPhase: 'qa',
          reason: '覆盖率问题需要在QA阶段处理',
          specificIssues: ['覆盖率不足'],
        };
      }

      if (
        logsLower.includes('build') ||
        logsLower.includes('编译') ||
        logsLower.includes('typescript') ||
        logsLower.includes('type error')
      ) {
        return {
          problemSource: 'development',
          targetPhase: 'development',
          reason: '构建/编译问题需要在开发阶段修复',
          specificIssues: ['构建失败', '类型错误'],
        };
      }
    }

    // Default to development
    return {
      problemSource: 'evaluation',
      targetPhase: 'development',
      reason: '无法明确归类，默认回退到开发阶段',
      specificIssues: [],
    };
  }

  /**
   * Determine routing target from evaluation failure
   *
   * CP-6: Provides routing decision for chain fallback
   *
   * @param targetPhase - Target phase to route to (FlowTarget-based)
   * @param evaluationResult - Evaluation result message
   * @returns RoutingDecision with target phase
   */
  determineRoutingTarget(
    targetPhase: FlowTarget,
    evaluationResult: string
  ): RoutingDecision {
    const analysis = this.analyzeEvaluationResult(evaluationResult);

    // Use analysis target phase, with fallback to provided targetPhase
    const routeTarget = analysis.targetPhase;
    return {
      ...analysis,
      reason: `路由到 ${targetPhase} (分析建议: ${routeTarget}): ${analysis.reason}`,
    };
  }

  /**
   * Extract specific issues from result text
   *
   * @param text - Result text
   * @param keywords - Keywords to search for
   * @returns Array of specific issues found
   */
  private extractSpecificIssues(text: string, keywords: string[]): string[] {
    const issues: string[] = [];
    const textLower = text.toLowerCase();

    for (const keyword of keywords) {
      if (textLower.includes(keyword.toLowerCase())) {
        // Extract surrounding context for the keyword
        const index = textLower.indexOf(keyword.toLowerCase());
        const start = Math.max(0, index - 20);
        const end = Math.min(text.length, index + keyword.length + 30);
        const context = text.slice(start, end).trim();
        if (context && !issues.includes(context)) {
          issues.push(context);
        }
      }
    }

    return issues.slice(0, 5); // Limit to 5 issues
  }
}

/**
 * Create an Evaluation instance
 */
export function createEvaluation(cwd: string): Evaluation {
  return new Evaluation(cwd);
}

export default Evaluation;
