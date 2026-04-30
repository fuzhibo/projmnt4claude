/**
 * Code Review Report Checker
 * 代码审核报告检查器
 *
 * 职责:
 * - 检查代码审核报告的存在性
 * - 验证报告格式是否正确
 * - 验证审核结果的有效性
 * - 检查审核原因的完整性
 * - 检查问题项的详情
 *
 * @module post-cr-gate/checkers/report-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta } from '../../../types/task.js';

/**
 * 代码审核问题项
 */
export interface CodeReviewIssue {
  /** 问题ID */
  id: string;
  /** 问题类型 */
  type: 'error' | 'warning' | 'suggestion';
  /** 问题描述 */
  description: string;
  /** 相关文件 */
  file?: string;
  /** 行号 */
  line?: number;
  /** 严重程度 */
  severity: 'high' | 'medium' | 'low';
}

/**
 * 代码审核报告结构
 */
export interface CodeReviewReport {
  /** 报告版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 审核结果 */
  verdict: 'PASS' | 'NOPASS';
  /** 审核时间戳 */
  reviewedAt: string;
  /** 审核人 */
  reviewer: string;
  /** 审核总结 */
  summary: string;
  /** 问题列表 */
  issues?: CodeReviewIssue[];
  /** 建议列表 */
  recommendations?: string[];
}

/**
 * 报告检查结果
 */
export interface ReportCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 检查项 */
  check: string;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * 代码审核报告检查器配置
 */
export interface CodeReviewReportCheckerConfig {
  /** 代码审核报告路径模板 */
  reportPath: string;
  /** 是否要求 issues 字段 */
  requireIssues: boolean;
  /** 是否要求 recommendations 字段 */
  requireRecommendations: boolean;
  /** 审核总结最小长度 */
  minSummaryLength: number;
}

/**
 * 默认配置
 */
export const DEFAULT_REPORT_CHECKER_CONFIG: CodeReviewReportCheckerConfig = {
  reportPath: '.projmnt4claude/outputs/{taskId}/code-review-report.json',
  requireIssues: false,
  requireRecommendations: false,
  minSummaryLength: 10,
};

/**
 * 代码审核报告检查器
 */
export class CodeReviewReportChecker {
  private config: CodeReviewReportCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<CodeReviewReportCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_REPORT_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行所有报告检查
   *
   * @param taskId 任务ID
   * @returns 检查结果列表
   */
  async check(taskId: string): Promise<ReportCheckResult[]> {
    const results: ReportCheckResult[] = [];

    results.push(await this.checkReportExistence(taskId));
    results.push(await this.checkReportFormat(taskId));
    results.push(await this.checkVerdictValidity(taskId));
    results.push(await this.checkSummaryCompleteness(taskId));
    results.push(await this.checkIssuesDetails(taskId));
    results.push(await this.checkTimestampValidity(taskId));

    return results;
  }

  /**
   * R-CR-POST-001: 检查审核报告存在性
   */
  async checkReportExistence(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);
    const exists = fs.existsSync(fullPath);

    return {
      passed: exists,
      check: 'report_existence',
      message: exists
        ? `代码审核报告存在: ${reportPath}`
        : `代码审核报告不存在: ${reportPath}`,
      details: {
        reportPath,
        fullPath,
        exists,
      },
    };
  }

  /**
   * R-CR-POST-002: 检查报告格式有效性
   */
  async checkReportFormat(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'report_format',
        message: '无法检查报告格式: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const requiredFields = ['version', 'taskId', 'verdict', 'reviewedAt', 'reviewer', 'summary'];
      const missingFields = requiredFields.filter(field => !(field in report));

      const passed = missingFields.length === 0;

      return {
        passed,
        check: 'report_format',
        message: passed
          ? '代码审核报告格式有效'
          : `代码审核报告格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          reportPath,
          requiredFields,
          missingFields,
          hasIssues: !!report.issues && Array.isArray(report.issues),
          hasRecommendations: !!report.recommendations && Array.isArray(report.recommendations),
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'report_format',
        message: `报告格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }

  /**
   * R-CR-POST-003: 检查审核结果有效性
   */
  async checkVerdictValidity(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'verdict_validity',
        message: '无法检查审核结果: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const validVerdicts = ['PASS', 'NOPASS'];
      const isValid = validVerdicts.includes(report.verdict);

      return {
        passed: isValid,
        check: 'verdict_validity',
        message: isValid
          ? `审核结果有效: ${report.verdict}`
          : `审核结果无效: ${report.verdict} (应为 PASS 或 NOPASS)`,
        details: {
          verdict: report.verdict,
          validVerdicts,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'verdict_validity',
        message: `审核结果检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }

  /**
   * R-CR-POST-004: 检查审核原因完整性
   */
  async checkSummaryCompleteness(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'summary_completeness',
        message: '无法检查审核原因: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const hasSummary = !!report.summary && report.summary.trim().length > 0;
      const isComplete = hasSummary && report.summary.trim().length >= this.config.minSummaryLength;

      return {
        passed: isComplete,
        check: 'summary_completeness',
        message: isComplete
          ? `审核原因完整 (${report.summary.length} 字符)`
          : `审核原因不完整: ${hasSummary ? '内容过短' : '缺少总结'}`,
        details: {
          hasSummary,
          summaryLength: report.summary?.length ?? 0,
          minLength: this.config.minSummaryLength,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'summary_completeness',
        message: `审核原因检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }

  /**
   * R-CR-POST-005: 检查问题项详情
   */
  async checkIssuesDetails(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'issues_details',
        message: '无法检查问题项: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const hasIssues = !!report.issues && Array.isArray(report.issues);

      // 如果没有 issues 字段，根据配置决定是否通过
      if (!hasIssues) {
        return {
          passed: !this.config.requireIssues,
          check: 'issues_details',
          message: this.config.requireIssues
            ? '缺少 issues 字段'
            : '无 issues 字段，检查通过',
          details: {
            hasIssues: false,
            requireIssues: this.config.requireIssues,
          },
        };
      }

      // 如果有 issues，检查每个 issue 的详情
      const issuesWithDetails = report.issues!.filter(issue =>
        issue.id && issue.type && issue.description && issue.severity
      );

      const passed = report.issues!.length === 0 ||
        (issuesWithDetails.length === report.issues!.length);

      return {
        passed,
        check: 'issues_details',
        message: passed
          ? `问题项详情完整 (${issuesWithDetails.length}/${report.issues!.length})`
          : `问题项详情不完整: ${report.issues!.length - issuesWithDetails.length} 个问题缺少详情`,
        details: {
          totalIssues: report.issues!.length,
          issuesWithDetails: issuesWithDetails.length,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'issues_details',
        message: `问题项检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }

  /**
   * R-CR-POST-007: 检查审核时间戳有效性
   */
  async checkTimestampValidity(taskId: string): Promise<ReportCheckResult> {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'timestamp_validity',
        message: '无法检查时间戳: 报告文件不存在',
        details: { reportPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const reviewedAt = report.reviewedAt;
      const reviewDate = new Date(reviewedAt);
      const now = new Date();
      const isValidDate = !isNaN(reviewDate.getTime());
      const isNotFuture = reviewDate <= now;

      const passed = isValidDate && isNotFuture;

      return {
        passed,
        check: 'timestamp_validity',
        message: passed
          ? `审核时间戳有效: ${reviewedAt}`
          : `审核时间戳无效: ${!isValidDate ? '无效日期格式' : '未来日期'}`,
        details: {
          reviewedAt,
          isValidDate,
          isNotFuture,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'timestamp_validity',
        message: `时间戳检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath },
      };
    }
  }

  /**
   * 读取代码审核报告
   *
   * @param taskId 任务ID
   * @returns 报告内容或 null
   */
  readReport(taskId: string): CodeReviewReport | null {
    const reportPath = this.getReportPath(taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as CodeReviewReport;
    } catch {
      return null;
    }
  }

  /**
   * 获取报告路径
   */
  private getReportPath(taskId: string): string {
    return this.config.reportPath.replace('{taskId}', taskId);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CodeReviewReportCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 创建报告检查器实例
 */
export function createCodeReviewReportChecker(
  cwd: string,
  config?: Partial<CodeReviewReportCheckerConfig>
): CodeReviewReportChecker {
  return new CodeReviewReportChecker(cwd, config);
}

/**
 * 快速检查代码审核报告
 */
export async function quickReportCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CodeReviewReportCheckerConfig>
): Promise<ReportCheckResult[]> {
  const checker = new CodeReviewReportChecker(cwd, config);
  return checker.check(taskId);
}

export default CodeReviewReportChecker;
