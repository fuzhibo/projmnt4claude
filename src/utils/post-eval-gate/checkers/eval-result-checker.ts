/**
 * 评估结果检查器
 *
 * R-EVAL-POST-002: 评估报告JSON格式有效 (ERROR级)
 * R-EVAL-POST-003: 评估结果有效 (PASS|NOPASS) (ERROR级)
 *
 * @module post-eval-gate/checkers/eval-result-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  IPostEvalChecker,
  EvalReport,
} from '../types.js';

/**
 * 有效的评估结果值
 */
const VALID_RESULTS = new Set(['PASS', 'NOPASS']);

/**
 * 评估报告必要字段
 */
const REPORT_REQUIRED_FIELDS = [
  'version',
  'taskId',
  'result',
  'evaluatedAt',
  'evaluator',
  'summary',
] as const;

/**
 * 评估报告JSON格式检查器
 *
 * 验证 evaluation-report.json 是否为合法JSON且包含必要字段。
 *
 * 规则ID: R-EVAL-POST-002
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - 文件内容可解析为JSON
 * - 包含所有必要字段 (version, taskId, result, evaluatedAt, evaluator, summary)
 *
 * 失败场景:
 * - 文件不存在或读取失败
 * - JSON解析失败
 * - 缺少必要字段
 */
export class EvalReportJsonChecker implements IPostEvalChecker {
  /**
   * 失败类型: B (回退到评估阶段重试)
   * 报告格式问题是评估阶段执行问题
   */
  readonly failureType = 'B' as const;

  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { taskId, cwd } = ctx;
    const reportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'evaluation-report.json');

    // 检查文件是否存在
    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: '评估报告文件不存在，无法验证JSON格式',
        details: { reportPath, parseError: 'FILE_NOT_FOUND' },
      };
    }

    // 读取并解析JSON
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(reportPath, 'utf-8');
    } catch (err) {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: '评估报告文件读取失败',
        details: { reportPath, parseError: 'READ_ERROR' },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: '评估报告JSON格式无效，无法解析',
        details: { reportPath, parseError: 'INVALID_JSON' },
      };
    }

    // 验证是否为对象
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: '评估报告JSON结构无效，期望为对象',
        details: { reportPath, parseError: 'NOT_OBJECT' },
      };
    }

    // 检查必要字段
    const report = parsed as Record<string, unknown>;
    const missingFields = REPORT_REQUIRED_FIELDS.filter(field => !(field in report));

    if (missingFields.length > 0) {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: `评估报告缺少必要字段: ${missingFields.join(', ')}`,
        details: { reportPath, missingFields },
      };
    }

    return {
      ruleId: 'R-EVAL-POST-002',
      passed: true,
      severity: 'ERROR',
      message: '评估报告JSON格式有效',
      details: { reportPath },
    };
  }
}

/**
 * 评估结果有效性检查器
 *
 * 验证评估报告中的 result 字段是否为有效值 (PASS | NOPASS)。
 *
 * 规则ID: R-EVAL-POST-003
 * 严重级别: ERROR (阻塞性)
 *
 * 通过条件:
 * - result 字段值为 'PASS' 或 'NOPASS'
 *
 * 失败场景:
 * - 评估报告未加载 (依赖 R-EVAL-POST-001/002)
 * - result 字段不存在
 * - result 字段值不在 {PASS, NOPASS} 中
 */
export class EvalResultValidChecker implements IPostEvalChecker {
  /**
   * 失败类型: B (回退到评估阶段重试)
   * 评估结果无效是评估阶段执行问题
   */
  readonly failureType = 'B' as const;

  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { evalReport } = ctx;

    if (!evalReport) {
      return {
        ruleId: 'R-EVAL-POST-003',
        passed: false,
        severity: 'ERROR',
        message: '无法检查评估结果: 评估报告未加载',
        details: { result: undefined, validResults: [...VALID_RESULTS] },
      };
    }

    const result = (evalReport as EvalReport).result;

    if (result === undefined || result === null) {
      return {
        ruleId: 'R-EVAL-POST-003',
        passed: false,
        severity: 'ERROR',
        message: '评估报告缺少 result 字段',
        details: { result, validResults: [...VALID_RESULTS] },
      };
    }

    if (!VALID_RESULTS.has(result)) {
      return {
        ruleId: 'R-EVAL-POST-003',
        passed: false,
        severity: 'ERROR',
        message: `评估结果无效: "${result}"，期望为 PASS 或 NOPASS`,
        details: { result, validResults: [...VALID_RESULTS] },
      };
    }

    return {
      ruleId: 'R-EVAL-POST-003',
      passed: true,
      severity: 'ERROR',
      message: `评估结果有效: ${result}`,
      details: { result },
    };
  }
}
