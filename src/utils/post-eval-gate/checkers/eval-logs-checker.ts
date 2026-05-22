/**
 * 评估日志检查器
 *
 * R-EVAL-POST-004: evaluationLogs 非空 (WARNING级)
 *
 * 检查评估报告中的 evaluationLogs 字段是否为非空数组，
 * 并验证每条日志条目的有效性。
 * 日志为空时返回警告结果（非阻塞）。
 *
 * @module post-eval-gate/checkers/eval-logs-checker
 */

import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
} from '../types.js';

/**
 * 日志条目必要字段
 */
const LOG_ENTRY_REQUIRED_FIELDS = ['timestamp', 'message'] as const;

/**
 * 评估日志检查器
 *
 * 验证评估报告中的 evaluationLogs 字段:
 * 1. evaluationLogs 是否为非空数组
 * 2. 每条日志是否包含必要字段 (timestamp, message)
 *
 * 规则ID: R-EVAL-POST-004
 * 严重级别: WARNING (非阻塞)
 *
 * 通过条件:
 * - evaluationLogs 为非空数组
 * - 每条日志包含必要字段
 *
 * 失败场景:
 * - evaluationLogs 为空或不存在 (WARNING)
 * - 日志条目缺少必要字段 (WARNING)
 */
export class EvalLogsChecker implements IPostEvalChecker {
  /**
   * 失败类型: B (回退到评估阶段重试)
   * 评估日志问题是评估阶段执行问题，属于 B 类
   */
  readonly failureType = 'B' as const;

  /**
   * 执行评估日志检查
   *
   * @param ctx 检查上下文，包含已解析的评估报告
   * @returns 检查结果
   */
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { evalReport } = ctx;

    if (!evalReport) {
      return {
        ruleId: 'R-EVAL-POST-004',
        passed: false,
        severity: 'WARNING',
        message: '无法检查评估日志: 评估报告未加载',
        details: { logCount: 0, invalidEntries: [] },
      };
    }

    const logs = evalReport.evaluationLogs;

    // 检查是否为非空数组
    if (!Array.isArray(logs) || logs.length === 0) {
      return {
        ruleId: 'R-EVAL-POST-004',
        passed: false,
        severity: 'WARNING',
        message: '评估日志为空',
        details: { logCount: 0, invalidEntries: [] },
      };
    }

    // 验证每条日志条目的有效性
    const invalidEntries: Array<{ index: number; missingFields: string[] }> = [];

    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      // 仅对对象类型条目进行字段验证，字符串等原始类型视为有效
      if (typeof entry === 'object' && entry !== null) {
        const missingFields = LOG_ENTRY_REQUIRED_FIELDS.filter(
          field => !(field in (entry as Record<string, unknown>))
        );
        if (missingFields.length > 0) {
          invalidEntries.push({ index: i, missingFields });
        }
      }
    }

    if (invalidEntries.length > 0) {
      return {
        ruleId: 'R-EVAL-POST-004',
        passed: false,
        severity: 'WARNING',
        message: `评估日志存在 ${invalidEntries.length} 条无效条目`,
        details: { logCount: logs.length, invalidEntries },
      };
    }

    return {
      ruleId: 'R-EVAL-POST-004',
      passed: true,
      severity: 'WARNING',
      message: `评估日志完整 (${logs.length} 条)`,
      details: { logCount: logs.length, invalidEntries: [] },
    };
  }
}
