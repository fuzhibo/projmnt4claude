/**
 * Code Review Pass Checker
 * 代码审核通过检查器 - 验证代码审核是否已通过
 *
 * 职责:
 * - 验证任务状态是否标记为审核通过
 * - 检查 requirementHistory 中是否有审核通过记录
 * - 检查 qualityGate 中是否有代码审核通过标记
 * - 验证审核报告是否存在
 *
 * @module pre-qa-gate/checkers/code-review-pass-checker
 */

import type { TaskMeta } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 代码审核通过检查项结果
 */
export interface CodeReviewPassCheckResult {
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
 * 代码审核通过检查结果
 */
export interface CodeReviewPassCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否审核通过 */
  passed: boolean;
  /** 检查项结果列表 */
  checks: CodeReviewPassCheckResult[];
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
 * 代码审核通过检查器配置
 */
export interface CodeReviewPassCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 是否要求任务状态标记 */
  requireStatusMarker: boolean;
  /** 是否要求历史记录 */
  requireHistoryRecord: boolean;
  /** 是否要求质量门禁标记 */
  requireQualityGateMarker: boolean;
  /** 是否要求审核报告 */
  requireReviewReport: boolean;
  /** 审核通过的合法状态列表 */
  passedStatuses: string[];
}

/**
 * 默认配置
 */
export const DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG: CodeReviewPassCheckerConfig = {
  enabled: true,
  requireStatusMarker: true,
  requireHistoryRecord: false,
  requireQualityGateMarker: false,
  requireReviewReport: false,
  passedStatuses: ['cr_passed', 'wait_qa', 'qa', 'qa_passed', 'completed'],
};

// ============== CodeReviewPassChecker 类 ==============

/**
 * 代码审核通过检查器
 *
 * 验证代码审核是否已完成并通过，检查多个维度确保审核质量。
 */
export class CodeReviewPassChecker {
  private config: CodeReviewPassCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<CodeReviewPassCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行代码审核通过检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<CodeReviewPassCheckerResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        passed: false,
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

    return this.checkTask(task, taskId, startTime, timestamp);
  }

  /**
   * 直接检查任务对象
   *
   * @param task 任务元数据
   * @param taskId 任务ID
   * @param startTime 开始时间
   * @param timestamp 时间戳
   * @returns 检查结果
   */
  private checkTask(
    task: TaskMeta,
    taskId: string,
    startTime: number,
    timestamp: string
  ): CodeReviewPassCheckerResult {
    const checks: CodeReviewPassCheckResult[] = [];

    // 检查任务状态标记
    if (this.config.requireStatusMarker) {
      checks.push(this.checkStatusMarker(task));
    }

    // 检查历史记录
    if (this.config.requireHistoryRecord) {
      checks.push(this.checkHistoryRecord(task));
    }

    // 检查质量门禁标记
    if (this.config.requireQualityGateMarker) {
      checks.push(this.checkQualityGateMarker(task));
    }

    // 检查审核报告
    if (this.config.requireReviewReport) {
      checks.push(this.checkReviewReport(task));
    }

    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const allPassed = failedCount === 0;

    return {
      taskId,
      passed: allPassed,
      checks,
      passedCount,
      failedCount,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查任务状态标记
   */
  private checkStatusMarker(task: TaskMeta): CodeReviewPassCheckResult {
    const startTime = Date.now();
    // 使用原始状态进行比较，支持自定义审核通过状态
    const passed = this.config.passedStatuses.includes(task.status);

    return {
      checkId: 'status-marker',
      name: '任务状态标记检查',
      passed,
      message: passed
        ? `任务状态已标记为审核通过 (${task.status})`
        : `任务状态未标记为审核通过 (当前: ${task.status}，期望: ${this.config.passedStatuses.join(', ')})`,
      details: {
        currentStatus: task.status,
        passedStatuses: this.config.passedStatuses,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查历史记录
   */
  private checkHistoryRecord(task: TaskMeta): CodeReviewPassCheckResult {
    const startTime = Date.now();

    if (!task.requirementHistory || task.requirementHistory.length === 0) {
      return {
        checkId: 'history-record',
        name: '审核历史记录检查',
        passed: false,
        message: '任务没有 requirementHistory 记录',
        details: { hasHistory: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 查找审核通过记录 (使用原始状态值进行比较)
    const passRecords = task.requirementHistory.filter(h =>
      h.field === 'status' &&
      this.config.passedStatuses.includes(h.newValue)
    );

    const passed = passRecords.length > 0;

    return {
      checkId: 'history-record',
      name: '审核历史记录检查',
      passed,
      message: passed
        ? `找到 ${passRecords.length} 条审核通过历史记录`
        : '未在 requirementHistory 中找到审核通过记录',
      details: {
        hasHistory: true,
        passRecordCount: passRecords.length,
        latestRecord: passRecords[0] || null,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查质量门禁标记
   */
  private checkQualityGateMarker(task: TaskMeta): CodeReviewPassCheckResult {
    const startTime = Date.now();

    if (!task.qualityGate) {
      return {
        checkId: 'quality-gate-marker',
        name: '质量门禁标记检查',
        passed: false,
        message: '任务没有 qualityGate 配置',
        details: { hasQualityGate: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const codeReviewPass = task.qualityGate.codeReviewPass === true;
    const crPhasePass = task.qualityGate.crPhasePass === true;
    const passed = codeReviewPass || crPhasePass;

    return {
      checkId: 'quality-gate-marker',
      name: '质量门禁标记检查',
      passed,
      message: passed
        ? '质量门禁已标记代码审核通过'
        : '质量门禁未标记代码审核通过 (codeReviewPass 或 crPhasePass 不为 true)',
      details: {
        hasQualityGate: true,
        codeReviewPass,
        crPhasePass,
        qualityGate: task.qualityGate,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查审核报告
   */
  private checkReviewReport(task: TaskMeta): CodeReviewPassCheckResult {
    const startTime = Date.now();

    if (!task.reports || task.reports.length === 0) {
      return {
        checkId: 'review-report',
        name: '审核报告存在性检查',
        passed: false,
        message: '任务没有配置 reports',
        details: { hasReports: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const reviewReports = task.reports.filter(r =>
      r.type === 'code_review' ||
      r.type === 'review' ||
      r.name.toLowerCase().includes('review')
    );

    const passed = reviewReports.length > 0;

    return {
      checkId: 'review-report',
      name: '审核报告存在性检查',
      passed,
      message: passed
        ? `找到 ${reviewReports.length} 个审核报告`
        : '未找到类型为 code_review 或 review 的报告',
      details: {
        hasReports: true,
        totalReports: task.reports.length,
        reviewReportCount: reviewReports.length,
        reviewReports: reviewReports.map(r => ({ name: r.name, type: r.type })),
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 更新配置
   *
   * @param config 部分配置
   */
  updateConfig(config: Partial<CodeReviewPassCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CodeReviewPassCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建代码审核通过检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns CodeReviewPassChecker 实例
 */
export function createCodeReviewPassChecker(
  cwd: string,
  config?: Partial<CodeReviewPassCheckerConfig>
): CodeReviewPassChecker {
  return new CodeReviewPassChecker(cwd, config);
}

/**
 * 快速执行代码审核通过检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickCodeReviewPassCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CodeReviewPassCheckerConfig>
): Promise<CodeReviewPassCheckerResult> {
  const checker = new CodeReviewPassChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行代码审核通过检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchCodeReviewPassCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<CodeReviewPassCheckerConfig>
): Promise<CodeReviewPassCheckerResult[]> {
  const checker = new CodeReviewPassChecker(cwd, config);
  const results: CodeReviewPassCheckerResult[] = [];

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
export function formatCodeReviewPassResult(result: CodeReviewPassCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  const decisionIcon = result.passed ? '✅' : '❌';

  lines.push('');
  lines.push(separator);
  lines.push(`${decisionIcon} 代码审核通过检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  lines.push(`📊 检查结果: ${result.passed ? '通过' : '未通过'}`);
  lines.push(`   通过: ${result.passedCount} / ${result.checks.length}`);
  if (result.failedCount > 0) {
    lines.push(`   失败: ${result.failedCount}`);
  }
  lines.push('');

  if (result.checks.length > 0) {
    lines.push('🔍 详细结果:');
    lines.push('');

    for (const check of result.checks) {
      const icon = check.passed ? '✅' : '❌';
      lines.push(`   ${icon} ${check.name}`);
      lines.push(`      ${check.message}`);
      lines.push('');
    }
  }

  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

export default CodeReviewPassChecker;
