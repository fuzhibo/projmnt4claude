/**
 * Checkpoint Sync Checker
 * 检查点同步检查器 - 验证检查点状态与实际开发进度的一致性
 *
 * 职责:
 * - 验证检查点状态与任务状态的一致性
 * - 验证检查点与开发报告的一致性
 * - 检测检查点状态不同步的情况
 * - 提供检查点同步建议
 *
 * @module pre-cr-gate/checkers/checkpoint-sync-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta, CheckpointMetadata, TaskStatus } from '../../../types/task.js';
import { normalizeStatus, TERMINAL_STATUSES } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 检查点同步检查项结果
 */
export interface CheckpointSyncCheckResult {
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
 * 检查点同步检查结果
 */
export interface CheckpointSyncCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: CheckpointSyncCheckResult[];
  /** 通过的检查项数 */
  passedCount: number;
  /** 失败的检查项数 */
  failedCount: number;
  /** 同步问题列表 */
  syncIssues: SyncIssue[];
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 同步问题
 */
export interface SyncIssue {
  /** 问题类型 */
  type: 'status_mismatch' | 'missing_checkpoint' | 'orphaned_checkpoint' | 'stale_checkpoint';
  /** 问题描述 */
  description: string;
  /** 涉及的检查点ID */
  checkpointId?: string;
  /** 建议的修复操作 */
  suggestedFix?: string;
  /** 严重程度 */
  severity: 'error' | 'warning' | 'info';
}

/**
 * 检查点同步检查器配置
 */
export interface CheckpointSyncCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 是否检查状态一致性 */
  checkStatusConsistency: boolean;
  /** 是否检查检查点与任务状态匹配 */
  checkTaskStatusMatch: boolean;
  /** 是否检查检查点与报告一致性 */
  checkReportConsistency: boolean;
  /** 是否检测过期检查点 */
  detectStaleCheckpoints: boolean;
  /** 检查点过期时间（毫秒） */
  staleThresholdMs: number;
  /** 是否允许跳过的检查点 */
  allowSkippedCheckpoints: boolean;
  /** 报告目录路径 */
  reportsDir: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG: CheckpointSyncCheckerConfig = {
  enabled: true,
  checkStatusConsistency: true,
  checkTaskStatusMatch: true,
  checkReportConsistency: true,
  detectStaleCheckpoints: true,
  staleThresholdMs: 7 * 24 * 60 * 60 * 1000, // 7天
  allowSkippedCheckpoints: true,
  reportsDir: '.projmnt4claude/reports/harness',
};

// ============== CheckpointSyncChecker 类 ==============

/**
 * 检查点同步检查器
 *
 * 专门用于验证检查点状态与实际开发进度的一致性，
 * 检测并报告不同步的情况。
 */
export class CheckpointSyncChecker {
  private config: CheckpointSyncCheckerConfig;
  private cwd: string;

  /**
   * 创建检查点同步检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<CheckpointSyncCheckerConfig>) {
    this.cwd = cwd;
    this.config = {
      ...DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG,
      ...config,
    };
  }

  /**
   * 执行检查点同步检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<CheckpointSyncCheckerResult> {
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
          message: '检查点同步检查已禁用',
          duration: 0,
          timestamp,
        }],
        passedCount: 1,
        failedCount: 0,
        syncIssues: [],
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
        syncIssues: [],
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 执行各项检查
    const checks: CheckpointSyncCheckResult[] = [];
    const syncIssues: SyncIssue[] = [];

    // 1. 检查点存在性检查
    checks.push(await this.checkCheckpointsExistence(task));

    // 2. 检查点状态一致性检查
    if (this.config.checkStatusConsistency && task.checkpoints && task.checkpoints.length > 0) {
      const statusResult = await this.checkStatusConsistency(task);
      checks.push(statusResult);

      // 收集同步问题
      if (!statusResult.passed && statusResult.details?.issues) {
        syncIssues.push(...(statusResult.details.issues as SyncIssue[]));
      }
    }

    // 3. 检查点与任务状态匹配检查
    if (this.config.checkTaskStatusMatch && task.checkpoints && task.checkpoints.length > 0) {
      const matchResult = await this.checkTaskStatusMatch(task);
      checks.push(matchResult);

      if (!matchResult.passed && matchResult.details?.issues) {
        syncIssues.push(...(matchResult.details.issues as SyncIssue[]));
      }
    }

    // 4. 检查点与报告一致性检查
    if (this.config.checkReportConsistency && task.checkpoints && task.checkpoints.length > 0) {
      checks.push(await this.checkReportConsistency(taskId, task));
    }

    // 5. 过期检查点检测
    if (this.config.detectStaleCheckpoints && task.checkpoints && task.checkpoints.length > 0) {
      const staleResult = await this.detectStaleCheckpoints(task);
      checks.push(staleResult);

      if (!staleResult.passed && staleResult.details?.issues) {
        syncIssues.push(...(staleResult.details.issues as SyncIssue[]));
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
      syncIssues,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点存在性
   */
  private async checkCheckpointsExistence(task: TaskMeta): Promise<CheckpointSyncCheckResult> {
    const startTime = Date.now();

    const checkpointPolicy = task.checkpointPolicy ??
      (task.type === 'bug' || task.priority === 'P0' || task.priority === 'P1' ? 'required' : 'optional');

    // 如果策略为 none，跳过检查
    if (checkpointPolicy === 'none') {
      return {
        checkId: 'checkpoints-existence',
        name: '检查点存在性检查',
        passed: true,
        message: '检查点策略为 none，跳过检查',
        details: {
          checkpointPolicy,
          checkpointCount: 0,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const hasCheckpoints = task.checkpoints && task.checkpoints.length > 0;

    // 如果策略为 required，必须有检查点
    const passed = checkpointPolicy !== 'required' || hasCheckpoints;

    return {
      checkId: 'checkpoints-existence',
      name: '检查点存在性检查',
      passed,
      message: hasCheckpoints
        ? `任务包含 ${task.checkpoints!.length} 个检查点`
        : checkpointPolicy === 'required'
          ? '任务配置了 required 检查点策略，但未定义任何检查点'
          : '任务未配置检查点（策略允许）',
      details: {
        checkpointPolicy,
        hasCheckpoints,
        checkpointCount: task.checkpoints?.length ?? 0,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点状态一致性
   */
  private async checkStatusConsistency(task: TaskMeta): Promise<CheckpointSyncCheckResult> {
    const startTime = Date.now();

    const checkpoints = task.checkpoints!;
    const issues: SyncIssue[] = [];

    // 检查每个检查点的状态是否合法
    const validStatuses = ['pending', 'completed', 'failed', 'skipped'];
    const invalidStatusCheckpoints: string[] = [];

    for (const cp of checkpoints) {
      if (!validStatuses.includes(cp.status)) {
        invalidStatusCheckpoints.push(`${cp.id} (${cp.status})`);
        issues.push({
          type: 'status_mismatch',
          description: `检查点 "${cp.description}" 状态 "${cp.status}" 无效`,
          checkpointId: cp.id,
          severity: 'error',
          suggestedFix: `将状态更新为以下之一: ${validStatuses.join(', ')}`,
        });
      }
    }

    // 检查完成状态的检查点是否有完成时间
    const completedWithoutTimestamp = checkpoints.filter(
      cp => cp.status === 'completed' && !cp.updatedAt
    );

    for (const cp of completedWithoutTimestamp) {
      issues.push({
        type: 'stale_checkpoint',
        description: `检查点 "${cp.description}" 已完成但缺少更新时间戳`,
        checkpointId: cp.id,
        severity: 'warning',
        suggestedFix: '更新检查点元数据，添加完成时间戳',
      });
    }

    const passed = issues.filter(i => i.severity === 'error').length === 0;

    return {
      checkId: 'status-consistency',
      name: '检查点状态一致性检查',
      passed,
      message: passed
        ? `所有检查点状态一致 (${checkpoints.length} 个检查点)`
        : `发现 ${issues.filter(i => i.severity === 'error').length} 个状态不一致的检查点`,
      details: {
        checkpointCount: checkpoints.length,
        invalidStatusCheckpoints,
        completedWithoutTimestamp: completedWithoutTimestamp.map(cp => cp.id),
        issues,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点与任务状态匹配
   */
  private async checkTaskStatusMatch(task: TaskMeta): Promise<CheckpointSyncCheckResult> {
    const startTime = Date.now();

    const checkpoints = task.checkpoints!;
    const normalizedStatus = normalizeStatus(task.status);
    const issues: SyncIssue[] = [];

    // 如果任务已完成，所有非跳过的检查点应该也已完成
    if (TERMINAL_STATUSES.includes(normalizedStatus as TaskStatus)) {
      const incompleteCheckpoints = checkpoints.filter(
        cp => cp.status !== 'completed' && cp.status !== 'skipped'
      );

      for (const cp of incompleteCheckpoints) {
        issues.push({
          type: 'status_mismatch',
          description: `任务已${normalizedStatus}，但检查点 "${cp.description}" 状态为 "${cp.status}"`,
          checkpointId: cp.id,
          severity: 'error',
          suggestedFix: `将检查点状态更新为 completed 或 skipped`,
        });
      }
    }

    // 如果任务在开发中，至少应该有一个检查点在进行中或已完成
    if (normalizedStatus === 'in_progress') {
      const activeOrCompletedCheckpoints = checkpoints.filter(
        cp => cp.status === 'completed' || cp.status === 'pending'
      );

      if (activeOrCompletedCheckpoints.length === 0) {
        issues.push({
          type: 'stale_checkpoint',
          description: '任务在开发中，但所有检查点都不是 pending 或 completed 状态',
          severity: 'warning',
          suggestedFix: '更新检查点状态以反映实际开发进度',
        });
      }
    }

    // 检查跳过的检查点是否合理
    if (!this.config.allowSkippedCheckpoints) {
      const skippedCheckpoints = checkpoints.filter(cp => cp.status === 'skipped');

      for (const cp of skippedCheckpoints) {
        issues.push({
          type: 'status_mismatch',
          description: `检查点 "${cp.description}" 被跳过，但配置不允许跳过检查点`,
          checkpointId: cp.id,
          severity: 'warning',
          suggestedFix: '完成检查点或启用 allowSkippedCheckpoints 配置',
        });
      }
    }

    const passed = issues.filter(i => i.severity === 'error').length === 0;

    return {
      checkId: 'task-status-match',
      name: '检查点与任务状态匹配检查',
      passed,
      message: passed
        ? '检查点状态与任务状态匹配'
        : `发现 ${issues.filter(i => i.severity === 'error').length} 个不匹配的检查点`,
      details: {
        taskStatus: task.status,
        normalizedStatus,
        checkpointCount: checkpoints.length,
        issues,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点与报告一致性
   */
  private async checkReportConsistency(
    taskId: string,
    task: TaskMeta
  ): Promise<CheckpointSyncCheckResult> {
    const startTime = Date.now();

    const reportDir = path.join(this.cwd, this.config.reportsDir, taskId);
    const devReportPath = path.join(reportDir, 'dev-report.md');

    // 如果开发报告不存在，跳过检查
    if (!fs.existsSync(devReportPath)) {
      return {
        checkId: 'report-consistency',
        name: '检查点与报告一致性检查',
        passed: true,
        message: '开发报告不存在，跳过一致性检查',
        details: {
          reportPath: devReportPath,
          reportExists: false,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const reportContent = fs.readFileSync(devReportPath, 'utf-8');
      const checkpoints = task.checkpoints!;
      const issues: SyncIssue[] = [];

      // 检查报告是否提及检查点
      const mentionedCheckpoints: string[] = [];
      const notMentionedCheckpoints: string[] = [];

      for (const cp of checkpoints) {
        // 检查检查点ID是否在报告中提及
        if (reportContent.includes(cp.id)) {
          mentionedCheckpoints.push(cp.id);
        } else {
          notMentionedCheckpoints.push(cp.id);
          // 只有已完成的检查点才需要在报告中提及
          if (cp.status === 'completed') {
            issues.push({
              type: 'orphaned_checkpoint',
              description: `已完成的检查点 "${cp.description}" 在开发报告中未提及`,
              checkpointId: cp.id,
              severity: 'warning',
              suggestedFix: '在开发报告中添加对此检查点的描述',
            });
          }
        }
      }

      const passed = issues.filter(i => i.severity === 'error').length === 0;

      return {
        checkId: 'report-consistency',
        name: '检查点与报告一致性检查',
        passed,
        message: passed
          ? `检查点与报告一致 (${mentionedCheckpoints.length}/${checkpoints.length} 个检查点在报告中被提及)`
          : `发现 ${issues.filter(i => i.severity === 'error').length} 个不一致的检查点`,
        details: {
          reportPath: devReportPath,
          reportExists: true,
          mentionedCheckpoints,
          notMentionedCheckpoints,
          issues,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'report-consistency',
        name: '检查点与报告一致性检查',
        passed: false,
        message: `读取开发报告失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          reportPath: devReportPath,
          error: error instanceof Error ? error.message : String(error),
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检测过期检查点
   */
  private async detectStaleCheckpoints(task: TaskMeta): Promise<CheckpointSyncCheckResult> {
    const startTime = Date.now();

    const checkpoints = task.checkpoints!;
    const now = Date.now();
    const issues: SyncIssue[] = [];

    const staleCheckpoints: Array<{
      id: string;
      description: string;
      status: string;
      lastUpdated: string;
      ageMs: number;
    }> = [];

    for (const cp of checkpoints) {
      // 只检查 pending 状态的检查点
      if (cp.status !== 'pending') {
        continue;
      }

      const lastUpdated = cp.updatedAt || task.createdAt;
      const lastUpdatedTime = new Date(lastUpdated).getTime();
      const ageMs = now - lastUpdatedTime;

      if (ageMs > this.config.staleThresholdMs) {
        staleCheckpoints.push({
          id: cp.id,
          description: cp.description,
          status: cp.status,
          lastUpdated,
          ageMs,
        });

        const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

        issues.push({
          type: 'stale_checkpoint',
          description: `检查点 "${cp.description}" 已 pending ${daysOld} 天未更新`,
          checkpointId: cp.id,
          severity: 'warning',
          suggestedFix: '更新检查点状态或移除不再需要的检查点',
        });
      }
    }

    const passed = issues.filter(i => i.severity === 'error').length === 0;

    return {
      checkId: 'stale-checkpoints',
      name: '过期检查点检测',
      passed,
      message: passed
        ? staleCheckpoints.length > 0
          ? `发现 ${staleCheckpoints.length} 个过期检查点（警告）`
          : '未发现过期检查点'
        : `发现 ${issues.filter(i => i.severity === 'error').length} 个问题`,
      details: {
        staleThresholdMs: this.config.staleThresholdMs,
        staleCheckpointCount: staleCheckpoints.length,
        staleCheckpoints,
        issues,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CheckpointSyncCheckerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CheckpointSyncCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建检查点同步检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns CheckpointSyncChecker 实例
 */
export function createCheckpointSyncChecker(
  cwd: string,
  config?: Partial<CheckpointSyncCheckerConfig>
): CheckpointSyncChecker {
  return new CheckpointSyncChecker(cwd, config);
}

/**
 * 快速执行检查点同步检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickCheckpointSyncCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CheckpointSyncCheckerConfig>
): Promise<CheckpointSyncCheckerResult> {
  const checker = new CheckpointSyncChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行检查点同步检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchCheckpointSyncCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<CheckpointSyncCheckerConfig>
): Promise<CheckpointSyncCheckerResult[]> {
  const checker = new CheckpointSyncChecker(cwd, config);
  const results: CheckpointSyncCheckerResult[] = [];

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
export function formatCheckpointSyncResult(result: CheckpointSyncCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push('');
  lines.push(separator);
  lines.push(`${result.allPassed ? '✅' : '❌'} 检查点同步检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  // 总体结果
  lines.push(`📊 总体结果: ${result.allPassed ? '通过' : '失败'}`);
  lines.push(`   通过: ${result.passedCount}/${result.checks.length}`);
  lines.push(`   失败: ${result.failedCount}/${result.checks.length}`);
  lines.push('');

  // 同步问题汇总
  if (result.syncIssues.length > 0) {
    lines.push('⚠️  同步问题:');
    lines.push('');

    const errorIssues = result.syncIssues.filter(i => i.severity === 'error');
    const warningIssues = result.syncIssues.filter(i => i.severity === 'warning');
    const infoIssues = result.syncIssues.filter(i => i.severity === 'info');

    if (errorIssues.length > 0) {
      lines.push(`   ❌ 错误 (${errorIssues.length}):`);
      for (const issue of errorIssues) {
        lines.push(`      - ${issue.description}`);
        if (issue.suggestedFix) {
          lines.push(`        💡 ${issue.suggestedFix}`);
        }
      }
      lines.push('');
    }

    if (warningIssues.length > 0) {
      lines.push(`   ⚠️  警告 (${warningIssues.length}):`);
      for (const issue of warningIssues) {
        lines.push(`      - ${issue.description}`);
        if (issue.suggestedFix) {
          lines.push(`        💡 ${issue.suggestedFix}`);
        }
      }
      lines.push('');
    }

    if (infoIssues.length > 0) {
      lines.push(`   ℹ️  信息 (${infoIssues.length}):`);
      for (const issue of infoIssues) {
        lines.push(`      - ${issue.description}`);
      }
      lines.push('');
    }
  }

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

export default CheckpointSyncChecker;
