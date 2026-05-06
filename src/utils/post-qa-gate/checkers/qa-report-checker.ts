/**
 * QA Report Checker
 * QA报告检查器
 *
 * 职责:
 * - QAReportExistsChecker: 检查 qa-report.json 文件是否存在 (R-QA-POST-001)
 * - QAReportJsonChecker: 验证 JSON 格式可解析性 (R-QA-POST-002)
 * - QAResultValidChecker: 验证 result ∈ {PASS, NOPASS} (R-QA-POST-003)
 * - QAFailuresDetailChecker: NOPASS 时验证 testFailures 字段存在 (R-QA-POST-004)
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate/checkers/qa-report-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { QAReport } from '../runner.js';

/**
 * QA报告检查结果
 */
export interface QACheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 检查项标识 */
  check: string;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * QA报告检查器配置
 */
export interface QAReportCheckerConfig {
  /** QA报告路径模板 */
  reportPath: string;
}

/**
 * 默认配置
 */
export const DEFAULT_QA_REPORT_CHECKER_CONFIG: QAReportCheckerConfig = {
  reportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
};

/**
 * QA报告存在性检查器
 * R-QA-POST-001 (ERROR级)
 *
 * 检查 qa-report.json 文件是否存在
 */
export class QAReportExistsChecker {
  private cwd: string;
  private config: QAReportCheckerConfig;

  constructor(cwd: string, config?: Partial<QAReportCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QA_REPORT_CHECKER_CONFIG, ...config };
  }

  async check(taskId: string): Promise<QACheckResult> {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);
    const exists = fs.existsSync(fullPath);

    return {
      passed: exists,
      check: 'qa_report_existence',
      message: exists
        ? `QA报告存在: ${reportPath}`
        : `QA报告不存在: ${reportPath}`,
      details: {
        reportPath,
        fullPath,
        exists,
      },
    };
  }
}

/**
 * QA报告JSON格式检查器
 * R-QA-POST-002 (ERROR级)
 *
 * 验证 qa-report.json 是否可解析为有效JSON，且包含必要字段
 */
export class QAReportJsonChecker {
  private cwd: string;
  private config: QAReportCheckerConfig;

  constructor(cwd: string, config?: Partial<QAReportCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QA_REPORT_CHECKER_CONFIG, ...config };
  }

  async check(taskId: string): Promise<QACheckResult> {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'qa_report_format',
        message: '无法检查QA报告格式: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      const requiredFields = ['version', 'taskId', 'verdict', 'verifiedAt', 'verifier', 'summary'];
      const missingFields = requiredFields.filter(field => !(field in report));

      const passed = missingFields.length === 0;

      return {
        passed,
        check: 'qa_report_format',
        message: passed
          ? 'QA报告格式有效'
          : `QA报告格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          reportPath,
          requiredFields,
          missingFields,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'qa_report_format',
        message: `QA报告格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }
}

/**
 * QA测试结果有效性检查器
 * R-QA-POST-003 (ERROR级)
 *
 * 验证 result ∈ {PASS, NOPASS}
 */
export class QAResultValidChecker {
  private cwd: string;
  private config: QAReportCheckerConfig;

  constructor(cwd: string, config?: Partial<QAReportCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QA_REPORT_CHECKER_CONFIG, ...config };
  }

  async check(taskId: string): Promise<QACheckResult> {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'qa_verdict_validity',
        message: '无法检查QA验证结果: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      const validVerdicts = ['PASS', 'NOPASS'];
      const isValid = validVerdicts.includes(report.verdict);

      return {
        passed: isValid,
        check: 'qa_verdict_validity',
        message: isValid
          ? `QA验证结果有效: ${report.verdict}`
          : `QA验证结果无效: ${report.verdict} (应为 PASS 或 NOPASS)`,
        details: {
          verdict: report.verdict,
          validVerdicts,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'qa_verdict_validity',
        message: `QA验证结果检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }
}

/**
 * QA测试失败详情检查器
 * R-QA-POST-004 (WARNING级)
 *
 * NOPASS 时验证 testFailures 字段存在且有详细记录
 */
export class QAFailuresDetailChecker {
  private cwd: string;
  private config: QAReportCheckerConfig;

  constructor(cwd: string, config?: Partial<QAReportCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QA_REPORT_CHECKER_CONFIG, ...config };
  }

  async check(taskId: string): Promise<QACheckResult> {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'qa_failures_detail',
        message: '无法检查测试失败详情: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      // PASS 时无需检查测试失败详情
      if (report.verdict === 'PASS') {
        return {
          passed: true,
          check: 'qa_failures_detail',
          message: 'QA结果为PASS，无需检查测试失败详情',
          details: { verdict: report.verdict },
        };
      }

      // NOPASS 时检查 testFailures 是否存在且有详细信息
      const hasTestFailures = !!report.testFailures && Array.isArray(report.testFailures);

      if (!hasTestFailures || report.testFailures!.length === 0) {
        return {
          passed: false,
          check: 'qa_failures_detail',
          message: 'QA结果为NOPASS但缺少测试失败详情',
          details: { verdict: report.verdict, hasTestFailures },
        };
      }

      // 检查每个失败项是否有详细信息
      const failuresWithDetails = report.testFailures!.filter(f =>
        f.testName && f.reason && f.severity
      );

      const passed = failuresWithDetails.length === report.testFailures!.length;

      return {
        passed,
        check: 'qa_failures_detail',
        message: passed
          ? `测试失败文档完整 (${failuresWithDetails.length}/${report.testFailures!.length})`
          : `测试失败文档不完整: ${report.testFailures!.length - failuresWithDetails.length} 个失败项缺少详情`,
        details: {
          totalFailures: report.testFailures!.length,
          failuresWithDetails: failuresWithDetails.length,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'qa_failures_detail',
        message: `测试失败详情检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }
}

/**
 * QA报告检查器 (聚合)
 *
 * 聚合所有4个QA报告检查器，提供统一的检查接口
 */
export class QAReportChecker {
  private existsChecker: QAReportExistsChecker;
  private jsonChecker: QAReportJsonChecker;
  private resultChecker: QAResultValidChecker;
  private failuresChecker: QAFailuresDetailChecker;

  constructor(cwd: string, config?: Partial<QAReportCheckerConfig>) {
    this.existsChecker = new QAReportExistsChecker(cwd, config);
    this.jsonChecker = new QAReportJsonChecker(cwd, config);
    this.resultChecker = new QAResultValidChecker(cwd, config);
    this.failuresChecker = new QAFailuresDetailChecker(cwd, config);
  }

  /**
   * 执行所有QA报告检查
   */
  async check(taskId: string): Promise<QACheckResult[]> {
    return [
      await this.existsChecker.check(taskId),
      await this.jsonChecker.check(taskId),
      await this.resultChecker.check(taskId),
      await this.failuresChecker.check(taskId),
    ];
  }

  /**
   * 获取单独的检查器
   */
  getCheckers() {
    return {
      exists: this.existsChecker,
      json: this.jsonChecker,
      result: this.resultChecker,
      failures: this.failuresChecker,
    };
  }
}

/**
 * 创建QA报告检查器实例
 */
export function createQAReportChecker(
  cwd: string,
  config?: Partial<QAReportCheckerConfig>
): QAReportChecker {
  return new QAReportChecker(cwd, config);
}

/**
 * 快速检查QA报告
 */
export async function quickQAReportCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<QAReportCheckerConfig>
): Promise<QACheckResult[]> {
  const checker = new QAReportChecker(cwd, config);
  return checker.check(taskId);
}

export default QAReportChecker;
