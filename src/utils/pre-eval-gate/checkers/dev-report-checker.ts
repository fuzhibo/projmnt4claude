/**
 * 开发报告检查器
 *
 * R-EVAL-PRE-002: dev-report.json 存在
 *
 * 检查任务的开发报告文件是否存在，确保评估阶段有开发阶段结果可读。
 * 这是进入评估阶段的前置条件之一。
 *
 * @module pre-eval-gate/checkers/dev-report-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreEvalCheckContext,
  PreEvalCheckResult,
  IPreEvalChecker,
} from '../types.js';

/**
 * 开发报告检查器
 *
 * 验证任务的 dev-report.json 文件是否存在。
 * 文件路径: {cwd}/.projmnt4claude/outputs/{taskId}/dev-report.json
 *
 * 规则ID: R-EVAL-PRE-002
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - dev-report.json 文件存在
 *
 * 失败场景:
 * - dev-report.json 文件不存在（开发阶段未生成报告）
 */
export class DevReportChecker implements IPreEvalChecker {
  /**
   * 失败类型: A (中断流水线)
   * Pre-Eval Gate 所有检查器均为 A 类
   */
  readonly failureType = 'A' as const;

  /**
   * 执行开发报告存在性检查
   *
   * @param ctx 检查上下文，包含任务ID和工作目录
   * @returns 检查结果
   */
  async check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult> {
    const { taskId, cwd } = ctx;
    const reportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
    const exists = fs.existsSync(reportPath);

    return {
      ruleId: 'R-EVAL-PRE-002',
      passed: exists,
      severity: 'ERROR',
      message: exists
        ? 'dev-report.json 存在'
        : 'dev-report.json 不存在: 开发阶段未生成报告',
      details: {
        reportName: 'dev-report.json',
        reportPath,
        exists,
        failureType: this.failureType,
      },
    };
  }
}
