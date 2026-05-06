/**
 * Checkpoint Sync Checker
 * 检查点状态同步检查器
 *
 * 职责:
 * - QACheckpointSyncChecker: 检查QA结果与检查点状态一致性 (R-QA-POST-006)
 *
 * 设计逻辑:
 * - 筛选 category === 'qa_verification' 的检查点
 * - 当 qaReport.verdict === 'PASS' 时，检查QA检查点是否已完成
 * - requiresHuman 的检查点允许未完成（等待人工验证）
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate/checkers/checkpoint-sync-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckpointMetadata } from '../../../types/task.js';
import type { QAReport } from '../runner.js';

/**
 * 检查点同步检查结果
 */
export interface CheckpointSyncCheckResult {
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
 * 检查点同步检查器配置
 */
export interface CheckpointSyncCheckerConfig {
  /** QA报告路径模板 */
  reportPath: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CHECKPOINT_SYNC_CONFIG: CheckpointSyncCheckerConfig = {
  reportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
};

/**
 * 不同步检查点信息
 */
export interface MismatchedCheckpoint {
  /** 检查点ID */
  id: string;
  /** 检查点描述 */
  description: string;
  /** 当前状态 */
  status: string;
  /** 预期状态 */
  expectedStatus: string;
  /** 是否需要人工验证 */
  requiresHuman: boolean;
}

/**
 * QA检查点状态同步检查器
 * R-QA-POST-006 (ERROR级)
 *
 * 检查QA验证结果与检查点状态的一致性。
 * 当QA报告结果为PASS时，验证QA相关检查点是否已完成。
 * requiresHuman 的检查点允许未完成状态（等待人工验证）。
 */
export class QACheckpointSyncChecker {
  private cwd: string;
  private config: CheckpointSyncCheckerConfig;

  constructor(cwd: string, config?: Partial<CheckpointSyncCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_CHECKPOINT_SYNC_CONFIG, ...config };
  }

  /**
   * 执行检查点同步检查
   *
   * @param taskId 任务ID
   * @param checkpoints 任务检查点列表
   * @returns 检查结果
   */
  async check(taskId: string, checkpoints: CheckpointMetadata[]): Promise<CheckpointSyncCheckResult> {
    // 筛选QA验证相关检查点
    const qaCheckpoints = this.getQACheckpoints(checkpoints);

    // 没有QA检查点时，跳过同步检查
    if (qaCheckpoints.length === 0) {
      return {
        passed: true,
        check: 'checkpoint_sync',
        message: '任务没有QA相关检查点，跳过同步检查',
        details: {
          totalCheckpoints: checkpoints.length,
          qaCheckpoints: 0,
        },
      };
    }

    // 读取QA报告获取验证结果
    const reportVerdict = this.readReportVerdict(taskId);

    // QA报告不存在时，无法判断同步状态，视为通过
    if (!reportVerdict) {
      return {
        passed: true,
        check: 'checkpoint_sync',
        message: 'QA报告不存在，跳过同步检查',
        details: {
          totalCheckpoints: checkpoints.length,
          qaCheckpoints: qaCheckpoints.length,
          reportVerdict: null,
        },
      };
    }

    // 当QA结果为PASS时，检查QA检查点是否已完成
    const mismatched: MismatchedCheckpoint[] = [];

    if (reportVerdict === 'PASS') {
      for (const cp of qaCheckpoints) {
        // requiresHuman 的检查点允许未完成
        if (cp.status !== 'completed' && !cp.requiresHuman) {
          mismatched.push({
            id: cp.id,
            description: cp.description,
            status: cp.status,
            expectedStatus: 'completed',
            requiresHuman: cp.requiresHuman ?? false,
          });
        }
      }
    }

    const passed = mismatched.length === 0;

    return {
      passed,
      check: 'checkpoint_sync',
      message: passed
        ? `检查点状态同步 (${this.countCompleted(qaCheckpoints)}/${qaCheckpoints.length} QA检查点完成)`
        : `检查点状态不同步: ${mismatched.length} 个QA检查点未完成`,
      details: {
        reportVerdict,
        totalCheckpoints: checkpoints.length,
        qaCheckpoints: qaCheckpoints.length,
        completedQACheckpoints: this.countCompleted(qaCheckpoints),
        mismatched,
        checkpoints: qaCheckpoints.map(cp => ({
          id: cp.id,
          description: cp.description,
          status: cp.status,
          requiresHuman: cp.requiresHuman ?? false,
        })),
      },
    };
  }

  /**
   * 获取QA验证相关检查点
   *
   * 筛选 category === 'qa_verification' 的检查点
   */
  private getQACheckpoints(checkpoints: CheckpointMetadata[]): CheckpointMetadata[] {
    return checkpoints.filter(cp => cp.category === 'qa_verification');
  }

  /**
   * 统计已完成的检查点数量
   */
  private countCompleted(checkpoints: CheckpointMetadata[]): number {
    return checkpoints.filter(cp => cp.status === 'completed').length;
  }

  /**
   * 从QA报告读取验证结果
   */
  private readReportVerdict(taskId: string): 'PASS' | 'NOPASS' | null {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;
      return report.verdict ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * 创建检查点同步检查器实例
 */
export function createCheckpointSyncChecker(
  cwd: string,
  config?: Partial<CheckpointSyncCheckerConfig>
): QACheckpointSyncChecker {
  return new QACheckpointSyncChecker(cwd, config);
}

/**
 * 快速检查检查点同步状态
 */
export async function quickCheckpointSyncCheck(
  taskId: string,
  checkpoints: CheckpointMetadata[],
  cwd: string = process.cwd(),
  config?: Partial<CheckpointSyncCheckerConfig>
): Promise<CheckpointSyncCheckResult> {
  const checker = new QACheckpointSyncChecker(cwd, config);
  return checker.check(taskId, checkpoints);
}

export default QACheckpointSyncChecker;
