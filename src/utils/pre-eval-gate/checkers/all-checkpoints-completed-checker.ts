/**
 * AllCheckpointsCompletedChecker
 * 所有检查点完成检查器
 *
 * R-EVAL-PRE-005: 无 pending 状态检查点（人工验证检查点除外，在流水线外确认）
 *
 * 检查逻辑:
 * 1. 遍历任务所有检查点
 * 2. 排除已完成 (completed)、已跳过 (skipped)、需人工验证 (requiresHuman) 的检查点
 * 3. 剩余检查点为未完成，阻塞评估阶段进入
 *
 * 设计文档: docs/investigation/hd-p14-evaluation-pre-gate-design.md
 * 规则: R-EVAL-PRE-005 (ERROR level)
 *
 * @module pre-eval-gate/checkers/all-checkpoints-completed-checker
 */

import type { PreEvalCheckContext, PreEvalCheckResult, IPreEvalChecker } from '../types.js';

/**
 * 所有检查点完成检查器
 *
 * 验证所有检查点是否已完成，排除需人工验证的检查点。
 * 人工验证在流水线之外进行，不在评估阶段前质量门禁中判断。
 */
export class AllCheckpointsCompletedChecker implements IPreEvalChecker {
  /**
   * 执行检查
   *
   * @param ctx 检查上下文
   * @returns 检查结果，包含未完成检查点列表
   */
  async check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult> {
    const { task } = ctx;
    const allCheckpoints = task.checkpoints || [];

    // 过滤出未完成的检查点: 排除 completed、skipped、requiresHuman
    const incomplete = allCheckpoints.filter(
      cp => cp.status !== 'completed' && cp.status !== 'skipped' && !cp.requiresHuman
    );

    const humanCheckpoints = allCheckpoints.filter(cp => cp.requiresHuman);

    return {
      ruleId: 'R-EVAL-PRE-005',
      passed: incomplete.length === 0,
      severity: 'ERROR',
      message: incomplete.length === 0
        ? '所有检查点已完成'
        : `${incomplete.length} 个检查点未完成: ${incomplete.map(c => c.id).join(', ')}`,
      details: {
        totalCheckpoints: allCheckpoints.length,
        completedCount: allCheckpoints.filter(cp => cp.status === 'completed').length,
        skippedCount: allCheckpoints.filter(cp => cp.status === 'skipped').length,
        humanVerificationCount: humanCheckpoints.length,
        incompleteCount: incomplete.length,
        incompleteIds: incomplete.map(c => c.id),
        humanVerificationIds: humanCheckpoints.map(c => c.id),
      },
    };
  }
}
