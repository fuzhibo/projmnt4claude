/**
 * 任务可关闭检查器
 *
 * R-EVAL-POST-007: 任务可关闭检查 (ERROR级)
 *
 * 综合判断任务是否满足关闭条件:
 * 1. 评估报告结果为 PASS
 * 2. 所有检查点状态为 completed 或 skipped
 *
 * 两个条件必须同时满足才允许关闭任务。
 *
 * @module post-eval-gate/checkers/task-closable-checker
 */

import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
} from '../types.js';

/**
 * 任务可关闭检查器
 *
 * 综合判断任务是否满足关闭条件:
 * 1. 评估通过 (evalReport.result === 'PASS')
 * 2. 所有检查点完成 (status 为 completed 或 skipped)
 *
 * 规则ID: R-EVAL-POST-007
 * 严重级别: ERROR (阻塞)
 *
 * 通过条件:
 * - 评估通过且所有检查点为 completed 或 skipped
 *
 * 失败场景:
 * - 评估未通过 (ERROR)
 * - 存在未完成的检查点 (ERROR)
 * - 两者同时不满足 (ERROR，同时报告两个原因)
 */
export class TaskClosableChecker implements IPostEvalChecker {
  /**
   * 执行任务可关闭检查
   *
   * @param ctx 检查上下文，包含任务元数据和评估报告
   * @returns 检查结果
   */
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { task, evalReport } = ctx;

    const evalPassed = evalReport?.result === 'PASS';
    const allCheckpointsDone = (task.checkpoints || []).every(
      cp => cp.status === 'completed' || cp.status === 'skipped'
    );
    const closable = evalPassed && allCheckpointsDone;

    const reasons: string[] = [];
    if (!evalPassed) reasons.push('评估未通过');
    if (!allCheckpointsDone) reasons.push('存在未完成的检查点');

    return {
      ruleId: 'R-EVAL-POST-007',
      passed: closable,
      severity: 'ERROR',
      message: closable
        ? '任务可标记为完成'
        : `任务不满足关闭条件: ${reasons.join('; ')}`,
      details: { closable, evalPassed, allCheckpointsDone },
    };
  }
}
