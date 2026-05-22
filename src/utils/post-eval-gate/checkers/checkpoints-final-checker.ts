/**
 * 检查点最终完成检查器
 *
 * R-EVAL-POST-006: 所有检查点完成 (ERROR级)
 *
 * 评估通过时检查所有检查点是否已完成。
 * 检查点状态为 completed 或 skipped 视为完成。
 * 评估未通过时跳过检查（返回通过）。
 *
 * @module post-eval-gate/checkers/checkpoints-final-checker
 */

import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
} from '../types.js';

/**
 * 检查点最终完成检查器
 *
 * 验证评估通过时所有检查点是否已完成:
 * 1. 评估未通过时跳过检查 (返回通过)
 * 2. 评估通过时检查所有检查点状态
 * 3. completed 或 skipped 视为已完成
 *
 * 规则ID: R-EVAL-POST-006
 * 严重级别: ERROR (阻塞)
 *
 * 通过条件:
 * - 评估未通过 (跳过检查)
 * - 评估通过且所有检查点为 completed 或 skipped
 *
 * 失败场景:
 * - 评估通过但存在未完成的检查点 (ERROR)
 */
export class AllCheckpointsFinalChecker implements IPostEvalChecker {
  /**
   * 失败类型: A (中断流水线)
   * 检查点状态是前置数据，缺失应中断
   */
  readonly failureType = 'A' as const;

  /**
   * 执行检查点最终完成检查
   *
   * @param ctx 检查上下文，包含任务元数据和评估报告
   * @returns 检查结果
   */
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { task, evalReport } = ctx;

    // 评估未通过时跳过检查点完成检查
    if (evalReport?.result !== 'PASS') {
      return {
        ruleId: 'R-EVAL-POST-006',
        passed: true,
        severity: 'ERROR',
        message: '评估未通过，跳过检查点完成检查',
      };
    }

    const incomplete = (task.checkpoints || [])
      .filter(cp => cp.status !== 'completed' && cp.status !== 'skipped');

    return {
      ruleId: 'R-EVAL-POST-006',
      passed: incomplete.length === 0,
      severity: 'ERROR',
      message: incomplete.length === 0
        ? '所有检查点已完成'
        : `${incomplete.length} 个检查点未完成`,
      details: {
        incompleteCheckpoints: incomplete.map(cp => ({ id: cp.id, status: cp.status })),
        failureType: this.failureType,
      },
    };
  }
}
