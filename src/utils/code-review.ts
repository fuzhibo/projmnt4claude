/**
 * CodeReview - Code Review phase handler for chain fallback
 *
 * CP-1: CodeReview class for chain fallback mechanism
 * Used when QA phase fails to determine problem attribution
 *
 * @module code-review
 */

import type { QAFailureAnalysis, QAFailureCategory } from '../types/task.js';

/**
 * CodeReview class
 *
 * Handles code review analysis for QA failures during chain fallback.
 * Determines whether QA failures are due to code issues or test issues.
 */
export class CodeReview {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Analyze QA failure to determine problem attribution
   *
   * CP-6: Used during chain fallback to decide rollback target
   *
   * @param qaError - QA error message
   * @param testFailures - List of test failures
   * @returns QAFailureAnalysis with attribution and suggested rollback target
   */
  analyzeQAFailure(
    qaError: string,
    testFailures?: Array<{ testName: string; reason: string; file?: string }>
  ): QAFailureAnalysis {
    const errorLower = qaError.toLowerCase();

    // Logic errors, functionality issues → code issue
    if (
      errorLower.includes('logic') ||
      errorLower.includes('功能') ||
      errorLower.includes('断言失败') ||
      errorLower.includes('assertion') ||
      errorLower.includes('expected') ||
      errorLower.includes('逻辑')
    ) {
      return {
        attribution: 'code_issue',
        reasoning: '测试断言失败，表明代码逻辑存在问题',
        suggestedRollbackTarget: 'development',
      };
    }

    // Test config missing, environment issues → test issue
    if (
      errorLower.includes('config') ||
      errorLower.includes('环境') ||
      errorLower.includes('setup') ||
      errorLower.includes('fixture') ||
      errorLower.includes('timeout') ||
      errorLower.includes('配置')
    ) {
      return {
        attribution: 'environment_issue',
        reasoning: '测试配置或环境问题，非代码逻辑错误',
        suggestedRollbackTarget: 'qa',
      };
    }

    // Check test failures for assertion patterns
    if (testFailures && testFailures.length > 0) {
      const hasAssertionFailure = testFailures.some(
        (f) =>
          f.reason.toLowerCase().includes('assertion') ||
          f.reason.toLowerCase().includes('expected') ||
          f.reason.toLowerCase().includes('断言')
      );
      if (hasAssertionFailure) {
        return {
          attribution: 'code_issue',
          reasoning: '测试断言失败，表明代码逻辑存在问题',
          suggestedRollbackTarget: 'development',
        };
      }
    }

    // Default to code issue
    return {
      attribution: 'code_issue',
      reasoning: '无法明确归类，默认视为代码问题',
      suggestedRollbackTarget: 'development',
    };
  }

  /**
   * Classify QA failure category
   *
   * CP-4: Determine if failure requires coverage retry or chain rollback
   *
   * @param category - QAFailureCategory from PostQAGateRunner
   * @returns Classification result with retry recommendation
   */
  classifyFailure(category: QAFailureCategory): {
    needsQARetry: boolean;
    needsChainRollback: boolean;
  } {
    switch (category) {
      case 'coverage_retry':
        return { needsQARetry: true, needsChainRollback: false };
      case 'chain_rollback':
        return { needsQARetry: false, needsChainRollback: true };
      case 'none':
      default:
        return { needsQARetry: false, needsChainRollback: false };
    }
  }
}

/**
 * Create a CodeReview instance
 */
export function createCodeReview(cwd: string): CodeReview {
  return new CodeReview(cwd);
}

export default CodeReview;
