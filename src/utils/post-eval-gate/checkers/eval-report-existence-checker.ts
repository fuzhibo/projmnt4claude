/**
 * 评估报告存在性检查器
 *
 * R-EVAL-POST-001: evaluation-report.json 存在
 *
 * 检查任务的评估报告文件是否存在，确保评估阶段生成了报告。
 * 这是评估后门禁的第一条规则，报告不存在将阻断后续检查。
 *
 * @module post-eval-gate/checkers/eval-report-existence-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
} from '../types.js';

/**
 * 评估报告存在性检查器
 *
 * 验证任务的 evaluation-report.json 文件是否存在。
 * 文件路径: {cwd}/.projmnt4claude/outputs/{taskId}/evaluation-report.json
 *
 * 规则ID: R-EVAL-POST-001
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - evaluation-report.json 文件存在
 *
 * 失败场景:
 * - evaluation-report.json 文件不存在（评估阶段未生成报告）
 */
export class EvalReportExistsChecker implements IPostEvalChecker {
  /**
   * 执行评估报告存在性检查
   *
   * @param ctx 检查上下文，包含任务ID和工作目录
   * @returns 检查结果
   */
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { taskId, cwd } = ctx;
    const reportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'evaluation-report.json');
    const exists = fs.existsSync(reportPath);

    return {
      ruleId: 'R-EVAL-POST-001',
      passed: exists,
      severity: 'ERROR',
      message: exists
        ? '评估报告存在'
        : '评估报告不存在',
      details: {
        reportName: 'evaluation-report.json',
        reportPath,
        exists,
      },
    };
  }
}
