/**
 * 最终状态一致性检查器
 *
 * R-EVAL-POST-005: 各阶段结果与评估一致 (ERROR级)
 *
 * 评估通过时验证各阶段报告结果是否与评估结果一致:
 * - 开发报告 (dev-report.json): status 应为 'success'
 * - 代码审核报告 (code-review-report.json): result 应为 'PASS'
 * - QA报告 (qa-report.json): verdict 应为 'PASS'
 *
 * 评估未通过时跳过检查（返回通过），因为不需要验证一致性。
 *
 * @module post-eval-gate/checkers/state-consistency-checker
 */

import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
} from '../types.js';

/**
 * 最终状态一致性检查器
 *
 * 验证各阶段结果与评估结果是否一致:
 * 1. 评估未通过时跳过检查 (返回通过)
 * 2. 评估通过时检查各阶段报告结果
 * 3. 生成详细的不一致错误列表
 *
 * 规则ID: R-EVAL-POST-005
 * 严重级别: ERROR (阻塞)
 *
 * 通过条件:
 * - 评估未通过 (跳过检查)
 * - 评估通过且各阶段报告结果一致
 *
 * 失败场景:
 * - 评估通过但开发状态不为 success (ERROR)
 * - 评估通过但代码审核未通过 (ERROR)
 * - 评估通过但QA未通过 (ERROR)
 */
export class FinalStateConsistencyChecker implements IPostEvalChecker {
  /**
   * 失败类型: A (中断流水线)
   * 状态不一致是数据问题，应中断流水线
   */
  readonly failureType = 'A' as const;

  /**
   * 执行最终状态一致性检查
   *
   * @param ctx 检查上下文，包含各阶段报告
   * @returns 检查结果
   */
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { evalReport, devReport, codeReviewReport, qaReport } = ctx;

    // 评估未通过时跳过一致性检查
    if (evalReport?.result !== 'PASS') {
      return {
        ruleId: 'R-EVAL-POST-005',
        passed: true,
        severity: 'ERROR',
        message: '评估未通过，跳过状态一致性检查',
      };
    }

    const inconsistencies: string[] = [];

    // 检查开发报告状态
    if (devReport && devReport.status !== 'success') {
      inconsistencies.push('评估通过但开发状态不为 success');
    }

    // 检查代码审核报告结果
    if (codeReviewReport && codeReviewReport.result !== 'PASS') {
      inconsistencies.push('评估通过但代码审核未通过');
    }

    // 检查QA报告结果
    if (qaReport && qaReport.verdict !== 'PASS') {
      inconsistencies.push('评估通过但QA未通过');
    }

    return {
      ruleId: 'R-EVAL-POST-005',
      passed: inconsistencies.length === 0,
      severity: 'ERROR',
      message: inconsistencies.length === 0
        ? '最终状态一致'
        : `状态不一致: ${inconsistencies.join('; ')}`,
      details: { inconsistencies, failureType: this.failureType },
    };
  }
}
