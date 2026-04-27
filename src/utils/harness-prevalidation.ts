/**
 * Harness Pre-Validation Module
 *
 * 实现 Harness Design 流水线的预检测循环（第一轮循环）
 *
 * 职责:
 * - 遍历所有任务进行预检测
 * - 管理 readyTasks 数组（依赖已满足的任务）
 * - 将依赖未满足的任务延后处理
 * - 开发前质量门禁检测
 *
 * @module harness-prevalidation
 */

import type { TaskMeta, TaskStatus } from '../types/task.js';
import { normalizeStatus } from '../types/task.js';
import type { HarnessRuntimeState } from '../types/harness.js';
import { readTaskMeta } from './task.js';
import { validateBasicFields, validateCheckpoints } from './quality-gate.js';

/**
 * 预检测结果
 */
export interface PreCheckResult {
  /** 是否通过预检测 */
  passed: boolean;
  /** 失败原因 */
  reason?: string;
  /** 详细错误列表 */
  errors: string[];
  /** 任务ID */
  taskId: string;
  /** 检测时间戳 */
  checkedAt: string;
}

/**
 * 依赖检查结果
 */
export interface DependencyCheckResult {
  /** 所有依赖是否满足 */
  satisfied: boolean;
  /** 未满足的依赖列表 */
  unsatisfiedDeps: string[];
  /** 失败的依赖列表 */
  failedDeps: string[];
  /** 进行中的依赖列表 */
  inProgressDeps: string[];
}

/**
 * 预检测统计
 */
export interface PreCheckStats {
  /** 总任务数 */
  total: number;
  /** 通过预检测的任务数 */
  passed: number;
  /** 失败的任务数 */
  failed: number;
  /** 依赖未满足的任务数 */
  pendingDeps: number;
  /** 检测时间戳 */
  checkedAt: string;
}

/**
 * 预检测器类
 *
 * 负责第一轮预检测循环的实现
 */
export class HarnessPreValidator {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * 执行完整的预检测循环
   *
   * 遍历所有任务，检查:
   * 1. 基础字段有效性
   * 2. 检查点结构有效性
   * 3. 依赖关系是否满足
   *
   * @param taskIds 任务ID列表
   * @returns 预检测结果列表
   */
  async runPreCheckLoop(taskIds: string[]): Promise<{
    results: PreCheckResult[];
    readyTasks: string[];
    pendingTasks: string[];
    failedTasks: string[];
    stats: PreCheckStats;
  }> {
    const startTime = new Date().toISOString();
    console.log('\n🔍 开始预检测循环...\n');

    const results: PreCheckResult[] = [];
    const readyTasks: string[] = [];
    const pendingTasks: string[] = [];
    const failedTasks: string[] = [];

    // 第一轮循环：遍历所有任务进行预检测
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      console.log(`  [${i + 1}/${taskIds.length}] 预检测: ${taskId}`);

      const result = await this.preCheckTask(taskId);
      results.push(result);

      if (result.passed) {
        readyTasks.push(taskId);
        console.log(`    ✅ 通过`);
      } else {
        // 区分是依赖未满足还是验证失败
        const task = readTaskMeta(taskId, this.cwd);
        if (task?.dependencies && task.dependencies.length > 0) {
          const depCheck = this.checkDependencies(task);
          if (!depCheck.satisfied) {
            pendingTasks.push(taskId);
            console.log(`    ⏳ 依赖未满足 (${depCheck.unsatisfiedDeps.length}个)`);
            continue;
          }
        }
        failedTasks.push(taskId);
        console.log(`    ❌ 失败: ${result.reason}`);
      }
    }

    const stats: PreCheckStats = {
      total: taskIds.length,
      passed: readyTasks.length,
      failed: failedTasks.length,
      pendingDeps: pendingTasks.length,
      checkedAt: startTime,
    };

    console.log(`\n📊 预检测完成: ${stats.passed} 通过, ${stats.pendingDeps} 依赖未满足, ${stats.failed} 失败`);

    return {
      results,
      readyTasks,
      pendingTasks,
      failedTasks,
      stats,
    };
  }

  /**
   * 预检测单个任务
   *
   * @param taskId 任务ID
   * @returns 预检测结果
   */
  async preCheckTask(taskId: string): Promise<PreCheckResult> {
    const errors: string[] = [];
    const checkedAt = new Date().toISOString();

    // 1. 检查任务是否存在
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        passed: false,
        reason: '任务不存在',
        errors: [`Task ${taskId} not found`],
        taskId,
        checkedAt,
      };
    }

    // 2. 基础字段验证（质量门禁）
    const basicValidation = validateBasicFields(task);
    if (!basicValidation.valid) {
      errors.push(...basicValidation.errors);
    }

    // 3. 检查点结构验证
    const checkpointViolations = validateCheckpoints(task);
    if (checkpointViolations.length > 0) {
      for (const violation of checkpointViolations) {
        errors.push(`[${violation.severity}] ${violation.message}`);
      }
    }

    // 4. 依赖检查
    if (task.dependencies && task.dependencies.length > 0) {
      const depCheck = this.checkDependencies(task);
      if (!depCheck.satisfied) {
        if (depCheck.failedDeps.length > 0) {
          errors.push(`依赖任务失败: ${depCheck.failedDeps.join(', ')}`);
        }
        if (depCheck.unsatisfiedDeps.length > 0) {
          errors.push(`依赖未完成: ${depCheck.unsatisfiedDeps.join(', ')}`);
        }
      }
    }

    // 5. 检查任务状态
    const normalizedStatus = normalizeStatus(task.status);
    if (normalizedStatus === 'failed' || normalizedStatus === 'abandoned') {
      errors.push(`任务状态为 ${task.status}，无法执行`);
    }

    if (errors.length > 0) {
      return {
        passed: false,
        reason: errors[0],
        errors,
        taskId,
        checkedAt,
      };
    }

    return {
      passed: true,
      errors: [],
      taskId,
      checkedAt,
    };
  }

  /**
   * 检查任务依赖关系
   *
   * @param task 任务元数据
   * @returns 依赖检查结果
   */
  checkDependencies(task: TaskMeta): DependencyCheckResult {
    const result: DependencyCheckResult = {
      satisfied: true,
      unsatisfiedDeps: [],
      failedDeps: [],
      inProgressDeps: [],
    };

    if (!task.dependencies || task.dependencies.length === 0) {
      return result;
    }

    for (const depId of task.dependencies) {
      const depTask = readTaskMeta(depId, this.cwd);

      if (!depTask) {
        result.unsatisfiedDeps.push(depId);
        result.satisfied = false;
        continue;
      }

      const normalizedStatus = normalizeStatus(depTask.status);

      // 检查依赖是否已完成
      if (normalizedStatus === 'resolved' || normalizedStatus === 'closed') {
        continue;
      }

      // 检查依赖是否已失败
      if (normalizedStatus === 'failed' || normalizedStatus === 'abandoned') {
        result.failedDeps.push(depId);
        result.satisfied = false;
        continue;
      }

      // 依赖仍在进行中
      result.inProgressDeps.push(depId);
      result.unsatisfiedDeps.push(depId);
      result.satisfied = false;
    }

    return result;
  }

  /**
   * 检查任务是否依赖其他未就绪的任务
   *
   * 用于第二轮执行前的依赖验证
   *
   * @param taskId 任务ID
   * @param readyTaskIds 已就绪的任务ID列表
   * @returns 是否所有依赖都已就绪
   */
  isTaskReady(taskId: string, readyTaskIds: Set<string>): boolean {
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) return false;

    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    return task.dependencies.every(depId => readyTaskIds.has(depId));
  }

  /**
   * 批量检查任务依赖
   *
   * @param taskIds 任务ID列表
   * @returns 每个任务的依赖状态
   */
  checkBatchDependencies(taskIds: string[]): Map<string, DependencyCheckResult> {
    const results = new Map<string, DependencyCheckResult>();

    for (const taskId of taskIds) {
      const task = readTaskMeta(taskId, this.cwd);
      if (!task) {
        results.set(taskId, {
          satisfied: false,
          unsatisfiedDeps: [],
          failedDeps: [taskId],
          inProgressDeps: [],
        });
        continue;
      }

      results.set(taskId, this.checkDependencies(task));
    }

    return results;
  }
}

/**
 * 创建预检测器实例
 *
 * @param cwd 工作目录
 * @returns HarnessPreValidator 实例
 */
export function createPreValidator(cwd: string): HarnessPreValidator {
  return new HarnessPreValidator(cwd);
}

/**
 * 快速预检测函数
 *
 * 用于简单的单次预检测场景
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @returns 预检测结果
 */
export async function quickPreCheck(taskId: string, cwd: string): Promise<PreCheckResult> {
  const validator = new HarnessPreValidator(cwd);
  return validator.preCheckTask(taskId);
}
