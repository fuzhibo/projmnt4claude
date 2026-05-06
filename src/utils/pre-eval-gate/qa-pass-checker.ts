/**
 * QA验证通过检查器
 *
 * R-EVAL-PRE-001: QA结果为 PASS
 *
 * 检查任务的QA报告是否存在且验证结果为 PASS，
 * 确保任务在进入评估阶段前已通过QA验证。
 *
 * @module pre-eval-gate/qa-pass-checker
 */

import type {
  PreEvalCheckContext,
  PreEvalCheckResult,
  IPreEvalChecker,
} from './types.js';

/**
 * QA验证通过检查器
 *
 * 验证任务的QA报告是否存在且结果为 PASS。
 * 这是进入评估阶段的核心前置条件。
 *
 * 规则ID: R-EVAL-PRE-001
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - qaReport 存在
 * - qaReport.verdict === 'PASS'
 *
 * 失败场景:
 * - qaReport 不存在（QA报告未生成）
 * - qaReport.verdict 为 'NOPASS'（QA验证未通过）
 */
export class QAPassChecker implements IPreEvalChecker {
  /**
   * 执行QA验证通过检查
   *
   * @param ctx 检查上下文，包含QA报告数据
   * @returns 检查结果
   */
  async check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult> {
    const { qaReport } = ctx;
    const passed = qaReport?.verdict === 'PASS';

    return {
      ruleId: 'R-EVAL-PRE-001',
      passed,
      severity: 'ERROR',
      message: passed
        ? 'QA验证已通过'
        : `QA验证未通过: ${qaReport?.verdict ?? '报告不存在'}`,
      details: {
        qaVerdict: qaReport?.verdict,
        qaVerifiedAt: qaReport?.verifiedAt,
      },
    };
  }
}
