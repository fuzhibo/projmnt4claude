/**
 * Checkpoint Sync Checker
 * 检查点状态同步检查器
 *
 * 职责:
 * - 检查代码审核结果与检查点状态的一致性
 * - 检测审核结果与检查点状态的不同步问题
 * - 提供同步修复建议
 *
 * @module post-cr-gate/checkers/checkpoint-sync-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta, CheckpointMetadata } from '../../../types/task.js';
import { readTaskMeta, writeTaskMeta } from '../../task.js';

/**
 * 代码审核报告结构
 */
export interface CodeReviewReport {
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
}

/**
 * 同步问题类型
 */
export type SyncIssueType =
  | 'verdict_mismatch'      // 审核结果与检查点状态不匹配
  | 'missing_checkpoint'    // 缺少代码审核检查点
  | 'checkpoint_not_completed' // 检查点未完成
  | 'report_not_found';     // 报告不存在

/**
 * 同步问题
 */
export interface SyncIssue {
  /** 问题类型 */
  type: SyncIssueType;
  /** 问题描述 */
  description: string;
  /** 相关检查点ID */
  checkpointId?: string;
  /** 预期状态 */
  expected?: string;
  /** 实际状态 */
  actual?: string;
  /** 严重程度 */
  severity: 'error' | 'warning';
  /** 修复建议 */
  fixSuggestion: string;
}

/**
 * 同步检查结果
 */
export interface CheckpointSyncCheckResult {
  /** 是否同步 */
  inSync: boolean;
  /** 问题列表 */
  issues: SyncIssue[];
  /** 代码审核相关检查点 */
  codeReviewCheckpoints: CheckpointMetadata[];
  /** 审核结果 */
  reportVerdict?: 'PASS' | 'NOPASS';
  /** 检查结果消息 */
  message: string;
}

/**
 * 检查点状态同步检查器配置
 */
export interface CheckpointSyncCheckerConfig {
  /** 代码审核报告路径模板 */
  reportPath: string;
  /** 是否自动修复不同步问题 */
  autoFix: boolean;
  /** 是否要求代码审核检查点 */
  requireCodeReviewCheckpoint: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG: CheckpointSyncCheckerConfig = {
  reportPath: '.projmnt4claude/outputs/{taskId}/code-review-report.json',
  autoFix: false,
  requireCodeReviewCheckpoint: false,
};

/**
 * 检查点状态同步检查器
 */
export class CheckpointSyncChecker {
  private config: CheckpointSyncCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<CheckpointSyncCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行检查点状态同步检查
   *
   * @param taskId 任务ID
   * @returns 同步检查结果
   */
  async check(taskId: string): Promise<CheckpointSyncCheckResult> {
    const task = readTaskMeta(taskId, this.cwd);

    if (!task) {
      return {
        inSync: false,
        issues: [{
          type: 'report_not_found',
          description: '任务不存在',
          severity: 'error',
          fixSuggestion: '请检查任务ID是否正确',
        }],
        codeReviewCheckpoints: [],
        message: '检查失败: 任务不存在',
      };
    }

    const issues: SyncIssue[] = [];

    // 1. 读取审核报告
    const report = this.readReport(taskId);
    const reportVerdict = report?.verdict;

    // 2. 获取代码审核相关检查点
    const codeReviewCheckpoints = this.getCodeReviewCheckpoints(task);

    // 3. 检查报告存在性
    if (!report) {
      issues.push({
        type: 'report_not_found',
        description: '代码审核报告不存在',
        severity: 'error',
        fixSuggestion: '请在代码审核阶段生成审核报告',
      });
    }

    // 4. 检查审核结果与检查点状态的匹配性
    if (reportVerdict) {
      // 如果审核通过，应该有完成的代码审核检查点
      if (reportVerdict === 'PASS') {
        const completedCheckpoints = codeReviewCheckpoints.filter(cp =>
          cp.status === 'completed'
        );

        if (codeReviewCheckpoints.length === 0 && this.config.requireCodeReviewCheckpoint) {
          issues.push({
            type: 'missing_checkpoint',
            description: '审核通过但缺少代码审核检查点',
            severity: 'warning',
            fixSuggestion: '添加代码审核相关的检查点',
          });
        } else if (completedCheckpoints.length === 0 && codeReviewCheckpoints.length > 0) {
          issues.push({
            type: 'checkpoint_not_completed',
            description: `审核通过但代码审核检查点未完成 (${completedCheckpoints.length}/${codeReviewCheckpoints.length})`,
            severity: 'warning',
            fixSuggestion: '更新检查点状态为 completed',
          });
        }
      }

      // 检查状态一致性
      for (const cp of codeReviewCheckpoints) {
        const expectedStatus = reportVerdict === 'PASS' ? 'completed' : 'failed';
        if (cp.status !== expectedStatus && cp.status !== 'skipped') {
          issues.push({
            type: 'verdict_mismatch',
            description: `检查点状态与审核结果不一致`,
            checkpointId: cp.id,
            expected: expectedStatus,
            actual: cp.status,
            severity: 'warning',
            fixSuggestion: `将检查点 ${cp.id} 状态更新为 ${expectedStatus}`,
          });
        }
      }
    }

    const inSync = issues.length === 0;

    // 4. 尝试自动修复
    if (!inSync && this.config.autoFix) {
      const fixedIssues = await this.tryAutoFix(task, issues);
      // 移除已修复的问题
      for (const fixed of fixedIssues) {
        const index = issues.findIndex(i =>
          i.type === fixed.type && i.checkpointId === fixed.checkpointId
        );
        if (index !== -1) {
          issues.splice(index, 1);
        }
      }
    }

    return {
      inSync: issues.length === 0,
      issues,
      codeReviewCheckpoints,
      reportVerdict,
      message: issues.length === 0
        ? '检查点状态与审核结果同步'
        : `发现 ${issues.length} 个同步问题`,
    };
  }

  /**
   * 同步检查点状态与审核结果
   *
   * @param taskId 任务ID
   * @returns 同步结果
   */
  async syncCheckpoints(taskId: string): Promise<{
    success: boolean;
    message: string;
    updatedCheckpoints: string[];
  }> {
    const task = readTaskMeta(taskId, this.cwd);

    if (!task) {
      return {
        success: false,
        message: '任务不存在',
        updatedCheckpoints: [],
      };
    }

    const report = this.readReport(taskId);

    if (!report) {
      return {
        success: false,
        message: '代码审核报告不存在，无法同步',
        updatedCheckpoints: [],
      };
    }

    const codeReviewCheckpoints = this.getCodeReviewCheckpoints(task);
    const updatedCheckpoints: string[] = [];

    const expectedStatus = report.verdict === 'PASS' ? 'completed' : 'failed';

    for (const cp of codeReviewCheckpoints) {
      if (cp.status !== expectedStatus && cp.status !== 'skipped') {
        cp.status = expectedStatus;
        cp.updatedAt = new Date().toISOString();
        updatedCheckpoints.push(cp.id);
      }
    }

    // 保存更新后的任务元数据
    if (updatedCheckpoints.length > 0) {
      task.updatedAt = new Date().toISOString();
      writeTaskMeta(task, this.cwd);
    }

    return {
      success: true,
      message: `已同步 ${updatedCheckpoints.length} 个检查点状态为 ${expectedStatus}`,
      updatedCheckpoints,
    };
  }

  /**
   * 尝试自动修复同步问题
   */
  private async tryAutoFix(
    task: TaskMeta,
    issues: SyncIssue[]
  ): Promise<SyncIssue[]> {
    const fixed: SyncIssue[] = [];

    for (const issue of issues) {
      switch (issue.type) {
        case 'verdict_mismatch':
          if (issue.checkpointId) {
            const cp = task.checkpoints?.find(c => c.id === issue.checkpointId);
            if (cp && issue.expected) {
              cp.status = issue.expected as 'completed' | 'failed';
              cp.updatedAt = new Date().toISOString();
              fixed.push(issue);
            }
          }
          break;
      }
    }

    // 保存更新
    if (fixed.length > 0) {
      task.updatedAt = new Date().toISOString();
      writeTaskMeta(task, this.cwd);
    }

    return fixed;
  }

  /**
   * 获取代码审核相关检查点
   */
  private getCodeReviewCheckpoints(task: TaskMeta): CheckpointMetadata[] {
    return task.checkpoints?.filter(cp =>
      cp.description.toLowerCase().includes('review') ||
      cp.description.toLowerCase().includes('审核') ||
      cp.description.toLowerCase().includes('code') ||
      cp.description.toLowerCase().includes('代码')
    ) ?? [];
  }

  /**
   * 读取代码审核报告
   */
  private readReport(taskId: string): CodeReviewReport | null {
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
  updateConfig(config: Partial<CheckpointSyncCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 创建检查点同步检查器实例
 */
export function createCheckpointSyncChecker(
  cwd: string,
  config?: Partial<CheckpointSyncCheckerConfig>
): CheckpointSyncChecker {
  return new CheckpointSyncChecker(cwd, config);
}

/**
 * 快速检查检查点同步
 */
export async function quickCheckpointSyncCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CheckpointSyncCheckerConfig>
): Promise<CheckpointSyncCheckResult> {
  const checker = new CheckpointSyncChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 同步检查点状态（便捷函数）
 */
export async function syncCheckpoints(
  taskId: string,
  cwd: string = process.cwd()
): Promise<{
  success: boolean;
  message: string;
  updatedCheckpoints: string[];
}> {
  const checker = new CheckpointSyncChecker(cwd);
  return checker.syncCheckpoints(taskId);
}

export default CheckpointSyncChecker;
