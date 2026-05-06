/**
 * QA报告存在性检查器
 *
 * R-EVAL-PRE-004: qa-report.json 存在
 *
 * 检查任务的QA报告文件是否存在，确保评估阶段有QA验证结果可读。
 * 这是进入评估阶段的前置条件之一。
 *
 * @module pre-eval-gate/checkers/qa-report-existence-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreEvalCheckContext,
  PreEvalCheckResult,
  IPreEvalChecker,
} from '../types.js';

/**
 * QA报告存在性检查器
 *
 * 验证任务的 qa-report.json 文件是否存在。
 * 文件路径: {cwd}/.projmnt4claude/outputs/{taskId}/qa-report.json
 *
 * 规则ID: R-EVAL-PRE-004
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - qa-report.json 文件存在
 *
 * 失败场景:
 * - qa-report.json 文件不存在（QA阶段未生成报告）
 */
export class QAReportExistenceChecker implements IPreEvalChecker {
  /**
   * 执行QA报告存在性检查
   *
   * @param ctx 检查上下文，包含任务ID和工作目录
   * @returns 检查结果
   */
  async check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult> {
    const { taskId, cwd } = ctx;
    const reportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
    const exists = fs.existsSync(reportPath);

    return {
      ruleId: 'R-EVAL-PRE-004',
      passed: exists,
      severity: 'ERROR',
      message: exists
        ? 'qa-report.json 存在'
        : 'qa-report.json 不存在: QA阶段未生成报告',
      details: {
        reportName: 'qa-report.json',
        reportPath,
        exists,
      },
    };
  }
}
