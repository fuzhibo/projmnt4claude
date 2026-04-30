/**
 * Prerequisites Checker
 * 审核前置条件检查器 - 验证任务是否满足代码审核的前置条件
 *
 * 职责:
 * - 验证任务状态是否符合要求
 * - 验证检查点完成情况
 * - 验证开发产物完整性
 * - 验证依赖任务状态
 *
 * @module pre-cr-gate/checkers/prerequisites-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta, TaskStatus, CheckpointMetadata } from '../../../types/task.js';
import { normalizeStatus, type TaskRole } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 前置条件检查项结果
 */
export interface PrerequisiteCheckResult {
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
 * 前置条件检查结果
 */
export interface PrerequisitesCheckResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: PrerequisiteCheckResult[];
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
 * 代码审核前置条件配置
 */
export interface PrerequisitesCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 要求的任务状态 */
  requiredStatus: TaskStatus[];
  /** 是否要求所有检查点完成 */
  requireAllCheckpoints: boolean;
  /** 是否要求所有检查点通过 (completed) */
  requireAllCheckpointsPassed: boolean;
  /** 是否允许有失败的检查点 */
  allowFailedCheckpoints: boolean;
  /** 是否检查依赖任务状态 */
  checkDependencies: boolean;
  /** 依赖任务要求的状态 */
  requiredDependencyStatus: TaskStatus[];
  /** 是否检查开发产物 */
  checkArtifacts: boolean;
  /** 是否检查测试覆盖率 */
  checkTestCoverage: boolean;
  /** 最低测试覆盖率 */
  minTestCoverage: number;
  /** 是否检查代码风格 */
  checkCodeStyle: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_PREREQUISITES_CHECKER_CONFIG: PrerequisitesCheckerConfig = {
  enabled: true,
  requiredStatus: ['in_progress', 'wait_review'],
  requireAllCheckpoints: true,
  requireAllCheckpointsPassed: true,
  allowFailedCheckpoints: false,
  checkDependencies: true,
  requiredDependencyStatus: ['resolved', 'closed'],
  checkArtifacts: true,
  checkTestCoverage: false,
  minTestCoverage: 0,
  checkCodeStyle: false,
};

// ============== PrerequisitesChecker 类 ==============

/**
 * 审核前置条件检查器
 *
 * 专门用于验证代码审核前置条件，确保任务在提交审核前
 * 已满足所有必要条件。
 */
export class PrerequisitesChecker {
  private config: PrerequisitesCheckerConfig;
  private cwd: string;

  /**
   * 创建前置条件检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PrerequisitesCheckerConfig>) {
    this.cwd = cwd;
    this.config = {
      ...DEFAULT_PREREQUISITES_CHECKER_CONFIG,
      ...config,
    };
  }

  /**
   * 执行前置条件检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<PrerequisitesCheckResult> {
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
          message: '前置条件检查已禁用',
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
    const checks: PrerequisiteCheckResult[] = [];

    // 1. 任务状态检查
    checks.push(await this.checkTaskStatus(task));

    // 2. 检查点完成检查
    checks.push(await this.checkCheckpoints(task));

    // 3. 依赖任务状态检查
    if (this.config.checkDependencies) {
      checks.push(await this.checkDependencies(task));
    }

    // 4. 开发产物检查
    if (this.config.checkArtifacts) {
      checks.push(await this.checkArtifacts(task));
    }

    // 5. 测试覆盖率检查（如果启用）
    if (this.config.checkTestCoverage) {
      checks.push(await this.checkTestCoverage(task));
    }

    // 6. 代码风格检查（如果启用）
    if (this.config.checkCodeStyle) {
      checks.push(await this.checkCodeStyle(task));
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
  private async checkTaskStatus(task: TaskMeta): Promise<PrerequisiteCheckResult> {
    const startTime = Date.now();
    const normalizedStatus = normalizeStatus(task.status);

    const passed = this.config.requiredStatus.includes(normalizedStatus as TaskStatus);

    return {
      checkId: 'task-status',
      name: '任务状态检查',
      passed,
      message: passed
        ? `任务状态符合要求 (当前: ${task.status})`
        : `任务状态不符合要求 (当前: ${task.status})，需要状态为: ${this.config.requiredStatus.join(' 或 ')}`,
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
   * 检查检查点完成情况
   */
  private async checkCheckpoints(task: TaskMeta): Promise<PrerequisiteCheckResult> {
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

    if (this.config.requireAllCheckpointsPassed) {
      const nonPassedCount = pendingCheckpoints + failedCheckpoints;
      if (nonPassedCount > 0) {
        passed = false;
        errors.push(`${nonPassedCount} 个检查点未通过`);
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
   * 检查依赖任务状态
   */
  private async checkDependencies(task: TaskMeta): Promise<PrerequisiteCheckResult> {
    const startTime = Date.now();

    // 如果没有依赖，直接通过
    if (!task.dependencies || task.dependencies.length === 0) {
      return {
        checkId: 'dependencies',
        name: '依赖任务状态检查',
        passed: true,
        message: '任务无依赖',
        details: {
          dependencyCount: 0,
          readyCount: 0,
          notReadyCount: 0,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const dependencyResults: Array<{
      taskId: string;
      status: string;
      ready: boolean;
      exists: boolean;
    }> = [];

    let readyCount = 0;
    let notReadyCount = 0;
    const errors: string[] = [];

    for (const depId of task.dependencies) {
      const depTask = readTaskMeta(depId, this.cwd);

      if (!depTask) {
        dependencyResults.push({
          taskId: depId,
          status: 'not_found',
          ready: false,
          exists: false,
        });
        notReadyCount++;
        errors.push(`依赖任务 ${depId} 不存在`);
        continue;
      }

      const normalizedStatus = normalizeStatus(depTask.status);
      const isReady = this.config.requiredDependencyStatus.includes(normalizedStatus as TaskStatus);

      dependencyResults.push({
        taskId: depId,
        status: depTask.status,
        ready: isReady,
        exists: true,
      });

      if (isReady) {
        readyCount++;
      } else {
        notReadyCount++;
        errors.push(`依赖任务 ${depId} 状态不满足要求 (当前: ${depTask.status})`);
      }
    }

    const passed = notReadyCount === 0;

    return {
      checkId: 'dependencies',
      name: '依赖任务状态检查',
      passed,
      message: passed
        ? `所有依赖任务已就绪 (${readyCount}/${task.dependencies.length})`
        : `依赖任务未就绪: ${errors.join('; ')}`,
      details: {
        dependencyCount: task.dependencies.length,
        readyCount,
        notReadyCount,
        requiredStatus: this.config.requiredDependencyStatus,
        dependencies: dependencyResults,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查开发产物
   */
  private async checkArtifacts(task: TaskMeta): Promise<PrerequisiteCheckResult> {
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
        name: '开发产物检查',
        passed: true,
        message: '未配置相关文件，跳过产物检查',
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
      name: '开发产物检查',
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
   * 检查测试覆盖率
   */
  private async checkTestCoverage(task: TaskMeta): Promise<PrerequisiteCheckResult> {
    const startTime = Date.now();

    // 注意：这是一个占位实现
    // 实际实现应该读取测试覆盖率报告文件
    // 例如：coverage/lcov.info 或 coverage/coverage-summary.json

    const coverageFile = path.join(this.cwd, 'coverage', 'coverage-summary.json');

    if (!fs.existsSync(coverageFile)) {
      return {
        checkId: 'test-coverage',
        name: '测试覆盖率检查',
        passed: false,
        message: '未找到测试覆盖率报告',
        details: {
          coverageFile,
          coverage: null,
          minCoverage: this.config.minTestCoverage,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const coverageData = JSON.parse(fs.readFileSync(coverageFile, 'utf-8'));
      const coverage = coverageData.total?.lines?.pct ?? 0;
      const passed = coverage >= this.config.minTestCoverage;

      return {
        checkId: 'test-coverage',
        name: '测试覆盖率检查',
        passed,
        message: passed
          ? `测试覆盖率满足要求 (${coverage.toFixed(2)}% >= ${this.config.minTestCoverage}%)`
          : `测试覆盖率不足 (${coverage.toFixed(2)}% < ${this.config.minTestCoverage}%)`,
        details: {
          coverageFile,
          coverage,
          minCoverage: this.config.minTestCoverage,
          coverageData: coverageData.total,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'test-coverage',
        name: '测试覆盖率检查',
        passed: false,
        message: `读取测试覆盖率报告失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          coverageFile,
          error: error instanceof Error ? error.message : String(error),
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查代码风格
   */
  private async checkCodeStyle(task: TaskMeta): Promise<PrerequisiteCheckResult> {
    const startTime = Date.now();

    // 注意：这是一个占位实现
    // 实际实现应该执行 lint 检查命令
    // 例如：eslint, prettier, 或其他代码风格检查工具

    return {
      checkId: 'code-style',
      name: '代码风格检查',
      passed: true,
      message: '代码风格检查已跳过（需要配置 lint 工具）',
      details: {
        note: '代码风格检查需要项目配置相应的 lint 工具',
        suggestedTools: ['eslint', 'prettier', 'biome'],
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取检查点统计信息
   */
  getCheckpointStats(checkpoints: CheckpointMetadata[]): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    skipped: number;
    completionRate: number;
  } {
    const total = checkpoints.length;
    const completed = checkpoints.filter(cp => cp.status === 'completed').length;
    const failed = checkpoints.filter(cp => cp.status === 'failed').length;
    const pending = checkpoints.filter(cp => cp.status === 'pending').length;
    const skipped = checkpoints.filter(cp => cp.status === 'skipped').length;
    const completionRate = total > 0 ? completed / total : 1;

    return {
      total,
      completed,
      failed,
      pending,
      skipped,
      completionRate,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PrerequisitesCheckerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PrerequisitesCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建前置条件检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PrerequisitesChecker 实例
 */
export function createPrerequisitesChecker(
  cwd: string,
  config?: Partial<PrerequisitesCheckerConfig>
): PrerequisitesChecker {
  return new PrerequisitesChecker(cwd, config);
}

/**
 * 快速执行前置条件检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickPrerequisitesCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PrerequisitesCheckerConfig>
): Promise<PrerequisitesCheckResult> {
  const checker = new PrerequisitesChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行前置条件检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchPrerequisitesCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PrerequisitesCheckerConfig>
): Promise<PrerequisitesCheckResult[]> {
  const checker = new PrerequisitesChecker(cwd, config);
  const results: PrerequisitesCheckResult[] = [];

  for (const taskId of taskIds) {
    const result = await checker.check(taskId);
    results.push(result);
  }

  return results;
}

/**
 * 验证单个检查点是否可提交审核
 *
 * @param checkpoint 检查点元数据
 * @returns 验证结果
 */
export function validateCheckpointForReview(
  checkpoint: CheckpointMetadata
): { valid: boolean; reason?: string } {
  // 检查点必须是完成状态
  if (checkpoint.status !== 'completed') {
    return {
      valid: false,
      reason: `检查点 "${checkpoint.description}" 未完成 (当前状态: ${checkpoint.status})`,
    };
  }

  // 检查点必须有所需角色信息
  if (!checkpoint.requiredRole) {
    return {
      valid: false,
      reason: `检查点 "${checkpoint.description}" 未配置所需角色`,
    };
  }

  return { valid: true };
}

/**
 * 格式化检查结果为终端输出
 *
 * @param result 检查结果
 * @returns 格式化字符串
 */
export function formatPrerequisitesResult(result: PrerequisitesCheckResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push('');
  lines.push(separator);
  lines.push(`${result.allPassed ? '✅' : '❌'} 审核前置条件检查: ${result.taskId}`);
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

export default PrerequisitesChecker;
