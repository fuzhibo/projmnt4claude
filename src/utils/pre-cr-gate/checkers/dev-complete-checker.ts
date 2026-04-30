/**
 * Dev Complete Checker
 * 开发完成检查器 - 验证开发阶段是否真正完成
 *
 * 职责:
 * - 验证开发阶段的状态是否完整
 * - 验证开发产物是否已生成
 * - 验证开发报告是否存在
 * - 验证检查点是否已完成
 *
 * @module pre-cr-gate/checkers/dev-complete-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta, TaskStatus } from '../../../types/task.js';
import { normalizeStatus } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 开发完成检查项结果
 */
export interface DevCompleteCheckResult {
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
 * 开发完成检查结果
 */
export interface DevCompleteCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: DevCompleteCheckResult[];
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
 * 开发完成检查器配置
 */
export interface DevCompleteCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 要求的任务状态 */
  requiredStatus: TaskStatus[];
  /** 是否要求开发报告 */
  requireDevReport: boolean;
  /** 是否要求代码审查报告 */
  requireCodeReviewReport: boolean;
  /** 是否要求测试报告 */
  requireTestReport: boolean;
  /** 是否要求所有检查点完成 */
  requireAllCheckpoints: boolean;
  /** 是否允许失败的检查点 */
  allowFailedCheckpoints: boolean;
  /** 是否验证开发产物 */
  validateArtifacts: boolean;
  /** 报告目录路径 */
  reportsDir: string;
}

/**
 * 默认配置
 */
export const DEFAULT_DEV_COMPLETE_CHECKER_CONFIG: DevCompleteCheckerConfig = {
  enabled: true,
  requiredStatus: ['in_progress', 'wait_review'],
  requireDevReport: true,
  requireCodeReviewReport: false,
  requireTestReport: false,
  requireAllCheckpoints: true,
  allowFailedCheckpoints: false,
  validateArtifacts: true,
  reportsDir: '.projmnt4claude/reports/harness',
};

// ============== DevCompleteChecker 类 ==============

/**
 * 开发完成检查器
 *
 * 专门用于验证开发阶段是否真正完成，确保任务满足
 * 进入代码审核阶段的所有条件。
 */
export class DevCompleteChecker {
  private config: DevCompleteCheckerConfig;
  private cwd: string;

  /**
   * 创建开发完成检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<DevCompleteCheckerConfig>) {
    this.cwd = cwd;
    this.config = {
      ...DEFAULT_DEV_COMPLETE_CHECKER_CONFIG,
      ...config,
    };
  }

  /**
   * 执行开发完成检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<DevCompleteCheckerResult> {
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
          message: '开发完成检查已禁用',
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
    const checks: DevCompleteCheckResult[] = [];

    // 1. 任务状态检查
    checks.push(await this.checkTaskStatus(task));

    // 2. 开发报告检查
    if (this.config.requireDevReport) {
      checks.push(await this.checkDevReport(taskId));
    }

    // 3. 代码审查报告检查
    if (this.config.requireCodeReviewReport) {
      checks.push(await this.checkCodeReviewReport(taskId));
    }

    // 4. 测试报告检查
    if (this.config.requireTestReport) {
      checks.push(await this.checkTestReport(taskId));
    }

    // 5. 检查点完成检查
    checks.push(await this.checkCheckpoints(task));

    // 6. 开发产物验证
    if (this.config.validateArtifacts) {
      checks.push(await this.validateArtifacts(task));
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
   * 检查任务状态
   */
  private async checkTaskStatus(task: TaskMeta): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();
    const normalizedStatus = normalizeStatus(task.status);

    const passed = this.config.requiredStatus.includes(normalizedStatus as TaskStatus);

    return {
      checkId: 'task-status',
      name: '任务状态检查',
      passed,
      message: passed
        ? `任务状态符合开发完成要求 (当前: ${task.status})`
        : `任务状态不符合开发完成要求 (当前: ${task.status})，需要状态为: ${this.config.requiredStatus.join(' 或 ')}`,
      details: {
        currentStatus: task.status,
        normalizedStatus,
        requiredStatus: this.config.requiredStatus,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查开发报告
   */
  private async checkDevReport(taskId: string): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();

    const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
    const devReportPath = path.join(reportDir, 'dev-report.md');

    const exists = fs.existsSync(devReportPath);

    return {
      checkId: 'dev-report',
      name: '开发报告检查',
      passed: exists,
      message: exists
        ? '开发报告已生成'
        : `开发报告不存在: ${devReportPath}`,
      details: {
        reportPath: devReportPath,
        exists,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查代码审查报告
   */
  private async checkCodeReviewReport(taskId: string): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();

    const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
    const codeReviewReportPath = path.join(reportDir, 'code-review-report.md');

    const exists = fs.existsSync(codeReviewReportPath);

    return {
      checkId: 'code-review-report',
      name: '代码审查报告检查',
      passed: exists,
      message: exists
        ? '代码审查报告已生成'
        : `代码审查报告不存在: ${codeReviewReportPath}`,
      details: {
        reportPath: codeReviewReportPath,
        exists,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查测试报告
   */
  private async checkTestReport(taskId: string): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();

    const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
    const testReportPath = path.join(reportDir, 'test-report.md');
    const qaReportPath = path.join(reportDir, 'qa-report.md');

    const testExists = fs.existsSync(testReportPath);
    const qaExists = fs.existsSync(qaReportPath);
    const exists = testExists || qaExists;

    return {
      checkId: 'test-report',
      name: '测试报告检查',
      passed: exists,
      message: exists
        ? `测试报告已生成 (${testExists ? 'test-report' : ''}${testExists && qaExists ? ', ' : ''}${qaExists ? 'qa-report' : ''})`
        : `测试报告不存在: ${testReportPath} 或 ${qaReportPath}`,
      details: {
        testReportPath,
        qaReportPath,
        testExists,
        qaExists,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点完成情况
   */
  private async checkCheckpoints(task: TaskMeta): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();

    // 获取检查点策略
    const checkpointPolicy = task.checkpointPolicy ??
      (task.type === 'bug' || task.priority === 'P0' || task.priority === 'P1' ? 'required' : 'optional');

    // 如果检查点为 none，直接通过
    if (checkpointPolicy === 'none') {
      return {
        checkId: 'checkpoints',
        name: '检查点完成检查',
        passed: true,
        message: '检查点策略为 none，跳过检查',
        details: {
          checkpointPolicy,
          totalCheckpoints: 0,
          completedCheckpoints: 0,
          failedCheckpoints: 0,
          pendingCheckpoints: 0,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 如果没有检查点配置
    if (!task.checkpoints || task.checkpoints.length === 0) {
      const passed = checkpointPolicy !== 'required';
      return {
        checkId: 'checkpoints',
        name: '检查点完成检查',
        passed,
        message: passed
          ? '未配置检查点，但策略允许'
          : '任务配置了 required 检查点策略，但未定义任何检查点',
        details: {
          checkpointPolicy,
          totalCheckpoints: 0,
          completedCheckpoints: 0,
          failedCheckpoints: 0,
          pendingCheckpoints: 0,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 统计检查点状态
    const checkpoints = task.checkpoints;
    const totalCheckpoints = checkpoints.length;
    const completedCheckpoints = checkpoints.filter(cp => cp.status === 'completed').length;
    const failedCheckpoints = checkpoints.filter(cp => cp.status === 'failed').length;
    const pendingCheckpoints = checkpoints.filter(cp => cp.status === 'pending').length;
    const skippedCheckpoints = checkpoints.filter(cp => cp.status === 'skipped').length;

    // 计算通过条件
    let passed = true;
    const errors: string[] = [];

    if (this.config.requireAllCheckpoints) {
      const incompleteCount = pendingCheckpoints;
      if (incompleteCount > 0) {
        passed = false;
        errors.push(`${incompleteCount} 个检查点未完成`);
      }
    }

    if (!this.config.allowFailedCheckpoints && failedCheckpoints > 0) {
      passed = false;
      errors.push(`${failedCheckpoints} 个检查点失败`);
    }

    const completionRate = totalCheckpoints > 0 ? (completedCheckpoints / totalCheckpoints) : 1;

    return {
      checkId: 'checkpoints',
      name: '检查点完成检查',
      passed,
      message: passed
        ? `检查点完成检查通过 (${completedCheckpoints}/${totalCheckpoints})`
        : `检查点未完成: ${errors.join(', ')}`,
      details: {
        checkpointPolicy,
        totalCheckpoints,
        completedCheckpoints,
        failedCheckpoints,
        pendingCheckpoints,
        skippedCheckpoints,
        completionRate,
        checkpoints: checkpoints.map(cp => ({
          id: cp.id,
          status: cp.status,
          description: cp.description,
        })),
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 验证开发产物
   */
  private async validateArtifacts(task: TaskMeta): Promise<DevCompleteCheckResult> {
    const startTime = Date.now();

    const filesToCheck: string[] = [];

    // 收集需要检查的文件
    if (task.affected_files) {
      filesToCheck.push(...task.affected_files);
    }

    if (task.files) {
      filesToCheck.push(...task.files);
    }

    // 如果没有配置任何文件
    if (filesToCheck.length === 0) {
      return {
        checkId: 'artifacts',
        name: '开发产物验证',
        passed: true,
        message: '未配置相关文件，跳过产物验证',
        details: {
          totalFiles: 0,
          existingFiles: [],
          missingFiles: [],
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查文件存在性
    const existingFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const filePath of filesToCheck) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.cwd, filePath);

      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      } else {
        missingFiles.push(filePath);
      }
    }

    const passed = missingFiles.length === 0;

    return {
      checkId: 'artifacts',
      name: '开发产物验证',
      passed,
      message: passed
        ? `所有开发产物已存在 (${existingFiles.length}/${filesToCheck.length})`
        : `缺少开发产物: ${missingFiles.join(', ')}`,
      details: {
        totalFiles: filesToCheck.length,
        existingFiles,
        missingFiles,
        affectedFiles: task.affected_files ?? [],
        files: task.files ?? [],
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DevCompleteCheckerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): DevCompleteCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建开发完成检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns DevCompleteChecker 实例
 */
export function createDevCompleteChecker(
  cwd: string,
  config?: Partial<DevCompleteCheckerConfig>
): DevCompleteChecker {
  return new DevCompleteChecker(cwd, config);
}

/**
 * 快速执行开发完成检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickDevCompleteCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<DevCompleteCheckerConfig>
): Promise<DevCompleteCheckerResult> {
  const checker = new DevCompleteChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行开发完成检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchDevCompleteCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<DevCompleteCheckerConfig>
): Promise<DevCompleteCheckerResult[]> {
  const checker = new DevCompleteChecker(cwd, config);
  const results: DevCompleteCheckerResult[] = [];

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
export function formatDevCompleteResult(result: DevCompleteCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push('');
  lines.push(separator);
  lines.push(`${result.allPassed ? '✅' : '❌'} 开发完成检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  // 总体结果
  lines.push(`📊 总体结果: ${result.allPassed ? '通过' : '失败'}`);
  lines.push(`   通过: ${result.passedCount}/${result.checks.length}`);
  lines.push(`   失败: ${result.failedCount}/${result.checks.length}`);
  lines.push('');

  // 详细结果
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

  // 执行时长
  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

export default DevCompleteChecker;
