/**
 * Report Validity Checker
 * 报告有效性检查器 - 验证开发报告的完整性和有效性
 *
 * 职责:
 * - 验证开发报告是否存在且非空
 * - 验证报告内容结构是否完整
 * - 验证报告中的关键信息是否存在
 * - 验证报告与任务元数据的一致性
 *
 * @module pre-cr-gate/checkers/report-validity-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 报告有效性检查项结果
 */
export interface ReportValidityCheckResult {
  /** 检查项ID */
  checkId: string;
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 报告有效性检查结果
 */
export interface ReportValidityCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: ReportValidityCheckResult[];
  /** 通过的检查项数 */
  passedCount: number;
  /** 失败的检查项数 */
  failedCount: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 报告类型
 */
export type ReportType = 'dev' | 'code-review' | 'qa' | 'test' | 'review';

/**
 * 报告信息
 */
export interface ReportInfo {
  /** 报告类型 */
  type: ReportType;
  /** 报告文件名 */
  filename: string;
  /** 是否必需 */
  required: boolean;
  /** 报告显示名称 */
  displayName: string;
}

/**
 * 报告有效性检查器配置
 */
export interface ReportValidityCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 报告目录路径 */
  reportsDir: string;
  /** 最小报告内容长度 */
  minContentLength: number;
  /** 是否要求特定章节 */
  requireSections: boolean;
  /** 必需章节列表 */
  requiredSections: string[];
  /** 是否验证报告与任务一致性 */
  validateTaskConsistency: boolean;
  /** 报告类型配置 */
  reportTypes: ReportType[];
}

/**
 * 默认报告类型列表
 */
export const DEFAULT_REPORT_TYPES: ReportInfo[] = [
  { type: 'dev', filename: 'dev-report.md', required: true, displayName: '开发报告' },
  { type: 'code-review', filename: 'code-review-report.md', required: false, displayName: '代码审查报告' },
  { type: 'qa', filename: 'qa-report.md', required: false, displayName: 'QA报告' },
  { type: 'test', filename: 'test-report.md', required: false, displayName: '测试报告' },
  { type: 'review', filename: 'review-report.md', required: false, displayName: '审查报告' },
];

/**
 * 默认配置
 */
export const DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG: ReportValidityCheckerConfig = {
  enabled: true,
  reportsDir: '.projmnt4claude/reports/harness',
  minContentLength: 100,
  requireSections: true,
  requiredSections: ['## 总结', '## 变更', '## 测试'],
  validateTaskConsistency: true,
  reportTypes: ['dev', 'code-review'],
};

// ============== ReportValidityChecker 类 ==============

/**
 * 报告有效性检查器
 *
 * 专门用于验证开发报告的完整性和有效性，确保报告内容
 * 满足质量要求并与任务元数据保持一致。
 */
export class ReportValidityChecker {
  private config: ReportValidityCheckerConfig;
  private cwd: string;

  /**
   * 创建报告有效性检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<ReportValidityCheckerConfig>) {
    this.cwd = cwd;
    this.config = {
      ...DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG,
      ...config,
    };
  }

  /**
   * 执行报告有效性检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<ReportValidityCheckerResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了检查，直接返回通过
    if (!this.config.enabled) {
      return {
        taskId,
        allPassed: true,
        checks: [{
          checkId: 'disabled',
          name: '检查已禁用',
          passed: true,
          message: '报告有效性检查已禁用',
          duration: 0,
          timestamp,
        }],
        passedCount: 1,
        failedCount: 0,
        duration: 0,
        timestamp,
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        allPassed: false,
        checks: [{
          checkId: 'task-existence',
          name: '任务存在性检查',
          passed: false,
          message: `任务 ${taskId} 不存在`,
          duration: 0,
          timestamp,
        }],
        passedCount: 0,
        failedCount: 1,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 执行各项检查
    const checks: ReportValidityCheckResult[] = [];

    // 1. 检查每种报告类型
    for (const reportType of this.config.reportTypes) {
      checks.push(await this.checkReportExists(taskId, reportType));
    }

    // 2. 验证报告内容完整性（针对存在的报告）
    for (const reportType of this.config.reportTypes) {
      const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
      const reportInfo = this.getReportInfo(reportType);
      const reportPath = path.join(reportDir, reportInfo.filename);

      if (fs.existsSync(reportPath)) {
        checks.push(await this.checkReportContent(reportPath, reportType));

        if (this.config.requireSections) {
          checks.push(await this.checkReportSections(reportPath, reportType));
        }

        if (this.config.validateTaskConsistency) {
          checks.push(await this.checkReportTaskConsistency(reportPath, task, reportType));
        }
      }
    }

    // 计算结果
    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const allPassed = failedCount === 0;

    return {
      taskId,
      allPassed,
      checks,
      passedCount,
      failedCount,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查报告是否存在
   */
  private async checkReportExists(
    taskId: string,
    reportType: ReportType
  ): Promise<ReportValidityCheckResult> {
    const startTime = Date.now();

    const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
    const reportInfo = this.getReportInfo(reportType);
    const reportPath = path.join(reportDir, reportInfo.filename);

    const exists = fs.existsSync(reportPath);
    const isRequired = reportInfo.required;

    // 如果是必需的报告，必须存在；否则，存在与否都通过
    const passed = isRequired ? exists : true;

    return {
      checkId: `report-exists-${reportType}`,
      name: `${reportInfo.displayName}存在性检查`,
      passed,
      message: exists
        ? `${reportInfo.displayName}已存在`
        : isRequired
          ? `${reportInfo.displayName}不存在（必需）: ${reportPath}`
          : `${reportInfo.displayName}不存在（可选）`,
      details: {
        reportType,
        reportPath,
        exists,
        required: isRequired,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查报告内容完整性
   */
  private async checkReportContent(
    reportPath: string,
    reportType: ReportType
  ): Promise<ReportValidityCheckResult> {
    const startTime = Date.now();

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const contentLength = content.length;
      const hasContent = contentLength >= this.config.minContentLength;
      const isNotEmpty = content.trim().length > 0;

      const passed = hasContent && isNotEmpty;
      const reportInfo = this.getReportInfo(reportType);

      return {
        checkId: `report-content-${reportType}`,
        name: `${reportInfo.displayName}内容完整性检查`,
        passed,
        message: passed
          ? `${reportInfo.displayName}内容完整 (${contentLength} 字符)`
          : !isNotEmpty
            ? `${reportInfo.displayName}内容为空`
            : `${reportInfo.displayName}内容过短 (${contentLength} < ${this.config.minContentLength} 字符)`,
        details: {
          reportType,
          reportPath,
          contentLength,
          minContentLength: this.config.minContentLength,
          hasContent,
          isNotEmpty,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const reportInfo = this.getReportInfo(reportType);
      return {
        checkId: `report-content-${reportType}`,
        name: `${reportInfo.displayName}内容完整性检查`,
        passed: false,
        message: `读取${reportInfo.displayName}失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          reportType,
          reportPath,
          error: error instanceof Error ? error.message : String(error),
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查报告章节结构
   */
  private async checkReportSections(
    reportPath: string,
    reportType: ReportType
  ): Promise<ReportValidityCheckResult> {
    const startTime = Date.now();

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const reportInfo = this.getReportInfo(reportType);

      const missingSections: string[] = [];
      const foundSections: string[] = [];

      for (const section of this.config.requiredSections) {
        // 支持章节标题的不同格式 (## 总结 或 ## 总结(Summary))
        const sectionPattern = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 使用多行匹配，支持章节标题后有内容或换行
        const regex = new RegExp(`^${sectionPattern}(?:\\s|\\(|$)`, 'im');

        if (regex.test(content)) {
          foundSections.push(section);
        } else {
          missingSections.push(section);
        }
      }

      const passed = missingSections.length === 0;

      return {
        checkId: `report-sections-${reportType}`,
        name: `${reportInfo.displayName}章节结构检查`,
        passed,
        message: passed
          ? `${reportInfo.displayName}包含所有必需章节 (${foundSections.length}/${this.config.requiredSections.length})`
          : `${reportInfo.displayName}缺少章节: ${missingSections.join(', ')}`,
        details: {
          reportType,
          reportPath,
          foundSections,
          missingSections,
          requiredSections: this.config.requiredSections,
          completionRate: foundSections.length / this.config.requiredSections.length,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const reportInfo = this.getReportInfo(reportType);
      return {
        checkId: `report-sections-${reportType}`,
        name: `${reportInfo.displayName}章节结构检查`,
        passed: false,
        message: `检查${reportInfo.displayName}章节失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          reportType,
          reportPath,
          error: error instanceof Error ? error.message : String(error),
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查报告与任务一致性
   */
  private async checkReportTaskConsistency(
    reportPath: string,
    task: TaskMeta,
    reportType: ReportType
  ): Promise<ReportValidityCheckResult> {
    const startTime = Date.now();

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const reportInfo = this.getReportInfo(reportType);

      const inconsistencies: string[] = [];

      // 检查任务ID是否一致
      if (!content.includes(task.id)) {
        inconsistencies.push('报告未提及任务ID');
      }

      // 检查任务标题是否一致（简化检查，只检查部分内容）
      // 对于中文标题，提取2-4个字的词组；对于英文标题，按空格分割
      const title = task.title;
      let titleKeywords: string[] = [];

      // 检测是否包含中文字符
      if (/[\u4e00-\u9fa5]/.test(title)) {
        // 中文标题：提取连续的中文字符作为关键词
        const chineseMatches = title.match(/[\u4e00-\u9fa5]{2,4}/g);
        if (chineseMatches) {
          titleKeywords = chineseMatches.slice(0, 3);
        }
      }

      // 如果没有提取到中文关键词或标题是英文，使用传统的分词方式
      if (titleKeywords.length === 0) {
        titleKeywords = title
          .split(/\s+|_/)
          .filter(k => k.length > 2)
          .slice(0, 3);
      }

      let titleMatchCount = 0;
      for (const keyword of titleKeywords) {
        if (content.toLowerCase().includes(keyword.toLowerCase())) {
          titleMatchCount++;
        }
      }

      // 对于中文标题，如果任务ID已匹配，放宽标题匹配要求
      const hasTaskIdMatch = content.includes(task.id);
      const requireTitleMatch = !hasTaskIdMatch || titleKeywords.length === 0;

      if (titleMatchCount === 0 && titleKeywords.length > 0 && requireTitleMatch) {
        inconsistencies.push('报告内容与任务标题不匹配');
      }

      const passed = inconsistencies.length === 0;

      return {
        checkId: `report-consistency-${reportType}`,
        name: `${reportInfo.displayName}与任务一致性检查`,
        passed,
        message: passed
          ? `${reportInfo.displayName}与任务信息一致`
          : `${reportInfo.displayName}与任务不一致: ${inconsistencies.join(', ')}`,
        details: {
          reportType,
          reportPath,
          taskId: task.id,
          taskTitle: task.title,
          inconsistencies,
          titleMatchCount,
          titleKeywordsChecked: titleKeywords.length,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const reportInfo = this.getReportInfo(reportType);
      return {
        checkId: `report-consistency-${reportType}`,
        name: `${reportInfo.displayName}与任务一致性检查`,
        passed: false,
        message: `检查${reportInfo.displayName}一致性失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          reportType,
          reportPath,
          error: error instanceof Error ? error.message : String(error),
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 获取报告信息
   */
  private getReportInfo(reportType: ReportType): ReportInfo {
    const reportInfo = DEFAULT_REPORT_TYPES.find(r => r.type === reportType);
    if (!reportInfo) {
      throw new Error(`未知的报告类型: ${reportType}`);
    }
    return reportInfo;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ReportValidityCheckerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ReportValidityCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建报告有效性检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns ReportValidityChecker 实例
 */
export function createReportValidityChecker(
  cwd: string,
  config?: Partial<ReportValidityCheckerConfig>
): ReportValidityChecker {
  return new ReportValidityChecker(cwd, config);
}

/**
 * 快速执行报告有效性检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickReportValidityCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<ReportValidityCheckerConfig>
): Promise<ReportValidityCheckerResult> {
  const checker = new ReportValidityChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行报告有效性检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchReportValidityCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<ReportValidityCheckerConfig>
): Promise<ReportValidityCheckerResult[]> {
  const checker = new ReportValidityChecker(cwd, config);
  const results: ReportValidityCheckerResult[] = [];

  for (const taskId of taskIds) {
    const result = await checker.check(taskId);
    results.push(result);
  }

  return results;
}

/**
 * 格式化检查结果为终端输出
 *
 * @param result 检查结果
 * @returns 格式化字符串
 */
export function formatReportValidityResult(result: ReportValidityCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push('');
  lines.push(separator);
  lines.push(`${result.allPassed ? '✅' : '❌'} 报告有效性检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  // 总体结果
  lines.push(`📊 总体结果: ${result.allPassed ? '通过' : '失败'}`);
  lines.push(`   通过: ${result.passedCount}/${result.checks.length}`);
  lines.push(`   失败: ${result.failedCount}/${result.checks.length}`);
  lines.push('');

  // 按报告类型分组显示结果
  const checksByReport = new Map<string, ReportValidityCheckResult[]>();

  for (const check of result.checks) {
    const reportType = check.details?.reportType as string || 'general';
    if (!checksByReport.has(reportType)) {
      checksByReport.set(reportType, []);
    }
    checksByReport.get(reportType)!.push(check);
  }

  // 详细结果
  if (result.checks.length > 0) {
    lines.push('🔍 详细结果:');
    lines.push('');

    for (const [reportType, checks] of checksByReport) {
      if (reportType !== 'general') {
        lines.push(`  📄 ${reportType}:`);
        for (const check of checks) {
          const icon = check.passed ? '✅' : '❌';
          lines.push(`     ${icon} ${check.name}`);
          lines.push(`        ${check.message}`);
        }
        lines.push('');
      } else {
        for (const check of checks) {
          const icon = check.passed ? '✅' : '❌';
          lines.push(`   ${icon} ${check.name}`);
          lines.push(`      ${check.message}`);
          lines.push('');
        }
      }
    }
  }

  // 执行时长
  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

export default ReportValidityChecker;
