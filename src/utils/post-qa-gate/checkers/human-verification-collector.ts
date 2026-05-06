/**
 * Human Verification Collector
 * 人工验证状态收集器
 *
 * 职责:
 * - HumanVerificationPendingCollector: 收集 requiresHuman 且未完成的检查点 (R-QA-POST-005)
 * - PipelineExitHumanVerificationNotifier: 流水线退出前统一通知待人工验证检查点 (R-QA-POST-005a)
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate/checkers/human-verification-collector
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckpointMetadata } from '../../../types/task.js';
import type { QAReport, PendingHumanVerification } from '../runner.js';

/**
 * 人工验证检查结果
 */
export interface HumanVerificationCheckResult {
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
 * 人工验证收集器配置
 */
export interface HumanVerificationCollectorConfig {
  /** QA报告路径模板 */
  reportPath: string;
}

/**
 * 默认配置
 */
export const DEFAULT_HUMAN_VERIFICATION_CONFIG: HumanVerificationCollectorConfig = {
  reportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
};

/**
 * 人工验证状态收集器
 * R-QA-POST-005 (INFO级)
 *
 * 收集 requiresHuman 且 status !== 'completed' 的检查点。
 * 不阻断任务执行，只收集到待验证列表。
 */
export class HumanVerificationPendingCollector {
  private cwd: string;
  private config: HumanVerificationCollectorConfig;

  constructor(cwd: string, config?: Partial<HumanVerificationCollectorConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_HUMAN_VERIFICATION_CONFIG, ...config };
  }

  /**
   * 收集待人工验证检查点
   *
   * @param taskId 任务ID
   * @param checkpoints 任务检查点列表
   * @returns 检查结果
   */
  async check(taskId: string, checkpoints: CheckpointMetadata[]): Promise<HumanVerificationCheckResult> {
    // 读取QA报告获取已验证的人工检查点
    const verifiedIds = this.getVerifiedHumanCheckpointIds(taskId);

    // 收集需要人工验证但未完成的检查点
    const pendingHuman: PendingHumanVerification[] = [];

    for (const cp of checkpoints) {
      if (cp.requiresHuman && cp.status !== 'completed') {
        // 检查是否已在QA报告中被标记为已验证
        if (!verifiedIds.has(cp.id)) {
          pendingHuman.push({
            id: cp.id,
            description: cp.description,
            taskId,
          });
        }
      }
    }

    return {
      passed: true, // INFO级别，不阻断
      check: 'human_verification_collect',
      message: pendingHuman.length === 0
        ? '无待人工验证检查点'
        : `已收集 ${pendingHuman.length} 个待人工验证检查点`,
      details: {
        pendingHumanVerifications: pendingHuman,
        willNotifyAtPipelineExit: pendingHuman.length > 0,
        totalCheckpoints: checkpoints.length,
        requiresHumanCount: checkpoints.filter(cp => cp.requiresHuman).length,
        verifiedCount: verifiedIds.size,
      },
    };
  }

  /**
   * 获取待人工验证检查点列表
   *
   * @param taskId 任务ID
   * @param checkpoints 任务检查点列表
   * @returns 待验证列表
   */
  getPendingVerifications(taskId: string, checkpoints: CheckpointMetadata[]): PendingHumanVerification[] {
    const verifiedIds = this.getVerifiedHumanCheckpointIds(taskId);
    const pending: PendingHumanVerification[] = [];

    for (const cp of checkpoints) {
      if (cp.requiresHuman && cp.status !== 'completed' && !verifiedIds.has(cp.id)) {
        pending.push({
          id: cp.id,
          description: cp.description,
          taskId,
        });
      }
    }

    return pending;
  }

  /**
   * 从QA报告获取已验证的人工检查点ID集合
   */
  private getVerifiedHumanCheckpointIds(taskId: string): Set<string> {
    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (!fs.existsSync(fullPath)) {
      return new Set();
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;
      return new Set(report.humanVerificationCheckpoints ?? []);
    } catch {
      return new Set();
    }
  }
}

/**
 * 通知格式化结果
 */
export interface FormattedNotification {
  /** 格式化的通知文本 */
  text: string;
  /** 按任务分组的待验证项 */
  groupedByTask: Map<string, PendingHumanVerification[]>;
  /** 总待验证数 */
  totalCount: number;
}

/**
 * 流水线退出人工验证通知器
 * R-QA-POST-005a (INFO级)
 *
 * 在流水线退出前统一汇总所有待人工验证的检查点，生成用户友好的通知报告。
 */
export class PipelineExitHumanVerificationNotifier {
  /**
   * 生成通知报告
   *
   * @param pendingList 所有待人工验证检查点列表
   * @returns 格式化的通知结果
   */
  formatNotification(pendingList: PendingHumanVerification[]): FormattedNotification {
    if (pendingList.length === 0) {
      return {
        text: '',
        groupedByTask: new Map(),
        totalCount: 0,
      };
    }

    // 按任务分组
    const groupedByTask = this.groupByTask(pendingList);

    // 生成通知文本
    const text = this.formatText(groupedByTask);

    return {
      text,
      groupedByTask,
      totalCount: pendingList.length,
    };
  }

  /**
   * 生成通知报告并输出到控制台
   *
   * @param pendingList 所有待人工验证检查点列表
   * @returns 通知结果
   */
  notify(pendingList: PendingHumanVerification[]): FormattedNotification {
    const result = this.formatNotification(pendingList);

    if (result.totalCount > 0) {
      console.log(result.text);
    }

    return result;
  }

  /**
   * 生成通知报告并写入文件
   *
   * @param pendingList 所有待人工验证检查点列表
   * @param outputPath 输出文件路径
   * @returns 通知结果
   */
  async notifyToFile(pendingList: PendingHumanVerification[], outputPath: string): Promise<FormattedNotification> {
    const result = this.formatNotification(pendingList);

    if (result.totalCount > 0) {
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const data = {
        generatedAt: new Date().toISOString(),
        totalTasks: result.groupedByTask.size,
        totalCheckpoints: result.totalCount,
        tasks: Object.fromEntries(result.groupedByTask),
      };

      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    }

    return result;
  }

  /**
   * 按任务分组
   */
  private groupByTask(pendingList: PendingHumanVerification[]): Map<string, PendingHumanVerification[]> {
    const grouped = new Map<string, PendingHumanVerification[]>();
    for (const item of pendingList) {
      const existing = grouped.get(item.taskId) || [];
      existing.push(item);
      grouped.set(item.taskId, existing);
    }
    return grouped;
  }

  /**
   * 格式化通知文本
   */
  private formatText(groupedByTask: Map<string, PendingHumanVerification[]>): string {
    const lines: string[] = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '         待人工验证检查点汇总',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ];

    for (const [taskId, items] of groupedByTask) {
      lines.push(`任务: ${taskId}`);
      lines.push('');
      for (const item of items) {
        lines.push(`  - ${item.id}`);
        lines.push(`    ${item.description}`);
        lines.push('');
      }
    }

    const totalCount = Array.from(groupedByTask.values()).flat().length;
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`总计: ${totalCount} 个检查点待人工验证`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return lines.join('\n');
  }
}

/**
 * 人工验证检查器 (聚合)
 *
 * 聚合收集器和通知器，提供统一的检查接口
 */
export class HumanVerificationChecker {
  private collector: HumanVerificationPendingCollector;
  private notifier: PipelineExitHumanVerificationNotifier;

  constructor(cwd: string, config?: Partial<HumanVerificationCollectorConfig>) {
    this.collector = new HumanVerificationPendingCollector(cwd, config);
    this.notifier = new PipelineExitHumanVerificationNotifier();
  }

  /**
   * 执行人工验证收集检查
   *
   * @param taskId 任务ID
   * @param checkpoints 任务检查点列表
   * @returns 检查结果
   */
  async check(taskId: string, checkpoints: CheckpointMetadata[]): Promise<HumanVerificationCheckResult> {
    return this.collector.check(taskId, checkpoints);
  }

  /**
   * 获取待人工验证列表
   *
   * @param taskId 任务ID
   * @param checkpoints 任务检查点列表
   * @returns 待验证列表
   */
  getPendingVerifications(taskId: string, checkpoints: CheckpointMetadata[]): PendingHumanVerification[] {
    return this.collector.getPendingVerifications(taskId, checkpoints);
  }

  /**
   * 生成流水线退出通知
   *
   * @param pendingList 待验证列表
   * @returns 通知结果
   */
  formatExitNotification(pendingList: PendingHumanVerification[]): FormattedNotification {
    return this.notifier.formatNotification(pendingList);
  }

  /**
   * 获取单独的检查器
   */
  getCheckers() {
    return {
      collector: this.collector,
      notifier: this.notifier,
    };
  }
}

/**
 * 创建人工验证检查器实例
 */
export function createHumanVerificationChecker(
  cwd: string,
  config?: Partial<HumanVerificationCollectorConfig>
): HumanVerificationChecker {
  return new HumanVerificationChecker(cwd, config);
}

/**
 * 快速检查人工验证状态
 */
export async function quickHumanVerificationCheck(
  taskId: string,
  checkpoints: CheckpointMetadata[],
  cwd: string = process.cwd(),
  config?: Partial<HumanVerificationCollectorConfig>
): Promise<HumanVerificationCheckResult> {
  const checker = new HumanVerificationChecker(cwd, config);
  return checker.check(taskId, checkpoints);
}

export default HumanVerificationChecker;
