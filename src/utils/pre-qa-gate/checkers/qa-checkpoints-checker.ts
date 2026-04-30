/**
 * QA Checkpoints Checker
 * QA检查点定义检查器 - 验证是否已定义QA相关检查点
 *
 * 职责:
 * - 验证检查点是否存在
 * - 验证QA相关检查点是否已定义
 * - 检查QA检查点状态
 * - 验证检查点完成度
 *
 * @module pre-qa-gate/checkers/qa-checkpoints-checker
 */

import type { TaskMeta, Checkpoint } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * QA检查点检查结果项
 */
export interface QACheckpointCheckResult {
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
 * QA检查点定义检查结果
 */
export interface QACheckpointsCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: QACheckpointCheckResult[];
  /** 通过的检查项数 */
  passedCount: number;
  /** 失败的检查项数 */
  failedCount: number;
  /** QA检查点列表 */
  qaCheckpoints: Checkpoint[];
  /** QA检查点数量 */
  qaCheckpointCount: number;
  /** 总检查点数量 */
  totalCheckpointCount: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * QA检查点定义检查器配置
 */
export interface QACheckpointsCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 是否要求至少一个QA检查点 */
  requireQACheckpoints: boolean;
  /** 最小QA检查点数量 */
  minQACheckpointCount: number;
  /** QA关键词列表 (用于识别QA相关检查点) */
  qaKeywords: string[];
  /** 是否允许使用通用测试检查点 */
  allowGenericTestCheckpoints: boolean;
  /** 是否要求检查点处于正确状态 */
  requireCorrectStatus: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG: QACheckpointsCheckerConfig = {
  enabled: true,
  requireQACheckpoints: true,
  minQACheckpointCount: 1,
  qaKeywords: ['qa', 'test', '验证', '质量', 'quality', 'verify', 'validation', '验收'],
  allowGenericTestCheckpoints: true,
  requireCorrectStatus: false,
};

// ============== QACheckpointsChecker 类 ==============

/**
 * QA检查点定义检查器
 *
 * 验证任务是否已定义QA相关检查点，确保QA验证工作有明确的检查项。
 */
export class QACheckpointsChecker {
  private config: QACheckpointsCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<QACheckpointsCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行QA检查点定义检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<QACheckpointsCheckerResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

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
        qaCheckpoints: [],
        qaCheckpointCount: 0,
        totalCheckpointCount: 0,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    return this.checkTask(task, taskId, startTime, timestamp);
  }

  /**
   * 直接检查任务对象
   */
  private checkTask(
    task: TaskMeta,
    taskId: string,
    startTime: number,
    timestamp: string
  ): QACheckpointsCheckerResult {
    const checks: QACheckpointCheckResult[] = [];

    // 检查检查点是否存在
    checks.push(this.checkCheckpointsExist(task));

    // 检查QA检查点定义
    checks.push(this.checkQACheckpointsDefined(task));

    // 检查QA检查点状态
    if (this.config.requireCorrectStatus) {
      checks.push(this.checkQACheckpointStatus(task));
    }

    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const allPassed = failedCount === 0;

    // 识别QA检查点
    const qaCheckpoints = this.identifyQACheckpoints(task.checkpoints || []);

    return {
      taskId,
      allPassed,
      checks,
      passedCount,
      failedCount,
      qaCheckpoints,
      qaCheckpointCount: qaCheckpoints.length,
      totalCheckpointCount: task.checkpoints?.length || 0,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查检查点是否存在
   */
  private checkCheckpointsExist(task: TaskMeta): QACheckpointCheckResult {
    const startTime = Date.now();
    const hasCheckpoints = task.checkpoints && task.checkpoints.length > 0;

    return {
      checkId: 'checkpoints-exist',
      name: '检查点存在性检查',
      passed: hasCheckpoints,
      message: hasCheckpoints
        ? `任务定义了 ${task.checkpoints!.length} 个检查点`
        : '任务未定义任何检查点',
      details: {
        hasCheckpoints,
        checkpointCount: task.checkpoints?.length || 0,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查QA检查点定义
   */
  private checkQACheckpointsDefined(task: TaskMeta): QACheckpointCheckResult {
    const startTime = Date.now();

    if (!task.checkpoints || task.checkpoints.length === 0) {
      return {
        checkId: 'qa-checkpoints-defined',
        name: 'QA检查点定义检查',
        passed: !this.config.requireQACheckpoints,
        message: '未定义任何检查点，无法检查QA检查点',
        details: {
          hasCheckpoints: false,
          qaCheckpointCount: 0,
          minRequired: this.config.minQACheckpointCount,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 识别QA检查点
    const qaCheckpoints = this.identifyQACheckpoints(task.checkpoints);
    const hasEnoughQACheckpoints = qaCheckpoints.length >= this.config.minQACheckpointCount;

    const passed = !this.config.requireQACheckpoints || hasEnoughQACheckpoints;

    return {
      checkId: 'qa-checkpoints-defined',
      name: 'QA检查点定义检查',
      passed,
      message: passed
        ? `找到 ${qaCheckpoints.length} 个QA相关检查点 (要求至少 ${this.config.minQACheckpointCount} 个)`
        : `QA检查点不足: 找到 ${qaCheckpoints.length} 个，要求至少 ${this.config.minQACheckpointCount} 个`,
      details: {
        hasCheckpoints: true,
        totalCheckpoints: task.checkpoints.length,
        qaCheckpointCount: qaCheckpoints.length,
        minRequired: this.config.minQACheckpointCount,
        qaCheckpoints: qaCheckpoints.map(cp => ({ id: cp.id, name: cp.name, status: cp.status })),
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查QA检查点状态
   */
  private checkQACheckpointStatus(task: TaskMeta): QACheckpointCheckResult {
    const startTime = Date.now();

    if (!task.checkpoints || task.checkpoints.length === 0) {
      return {
        checkId: 'qa-checkpoint-status',
        name: 'QA检查点状态检查',
        passed: true,
        message: '未定义检查点，跳过状态检查',
        details: { hasCheckpoints: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const qaCheckpoints = this.identifyQACheckpoints(task.checkpoints);

    if (qaCheckpoints.length === 0) {
      return {
        checkId: 'qa-checkpoint-status',
        name: 'QA检查点状态检查',
        passed: true,
        message: '未找到QA检查点，跳过状态检查',
        details: {
          hasCheckpoints: true,
          hasQACheckpoints: false,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查QA检查点状态
    const failedCheckpoints = qaCheckpoints.filter(cp => cp.status === 'failed');
    const blockedCheckpoints = qaCheckpoints.filter(cp => cp.status === 'blocked');
    const completedCheckpoints = qaCheckpoints.filter(cp => cp.status === 'completed');

    const hasIssues = failedCheckpoints.length > 0 || blockedCheckpoints.length > 0;

    return {
      checkId: 'qa-checkpoint-status',
      name: 'QA检查点状态检查',
      passed: !hasIssues,
      message: hasIssues
        ? `QA检查点存在问题: ${failedCheckpoints.length} 个失败, ${blockedCheckpoints.length} 个阻塞`
        : `QA检查点状态正常: ${completedCheckpoints.length} 个已完成, ${qaCheckpoints.length - completedCheckpoints.length} 个待处理`,
      details: {
        hasCheckpoints: true,
        hasQACheckpoints: true,
        totalQACheckpoints: qaCheckpoints.length,
        completed: completedCheckpoints.length,
        failed: failedCheckpoints.length,
        blocked: blockedCheckpoints.length,
        pending: qaCheckpoints.filter(cp => cp.status === 'pending').length,
        issues: [...failedCheckpoints, ...blockedCheckpoints].map(cp => ({
          id: cp.id,
          name: cp.name,
          status: cp.status,
        })),
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 识别QA检查点
   */
  private identifyQACheckpoints(checkpoints: Checkpoint[]): Checkpoint[] {
    return checkpoints.filter(cp =>
      this.config.qaKeywords.some(keyword =>
        cp.name.toLowerCase().includes(keyword.toLowerCase())
      )
    );
  }

  /**
   * 更新配置
   *
   * @param config 部分配置
   */
  updateConfig(config: Partial<QACheckpointsCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): QACheckpointsCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建QA检查点定义检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns QACheckpointsChecker 实例
 */
export function createQACheckpointsChecker(
  cwd: string,
  config?: Partial<QACheckpointsCheckerConfig>
): QACheckpointsChecker {
  return new QACheckpointsChecker(cwd, config);
}

/**
 * 快速执行QA检查点定义检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickQACheckpointsCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<QACheckpointsCheckerConfig>
): Promise<QACheckpointsCheckerResult> {
  const checker = new QACheckpointsChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行QA检查点定义检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchQACheckpointsCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<QACheckpointsCheckerConfig>
): Promise<QACheckpointsCheckerResult[]> {
  const checker = new QACheckpointsChecker(cwd, config);
  const results: QACheckpointsCheckerResult[] = [];

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
export function formatQACheckpointsResult(result: QACheckpointsCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  const decisionIcon = result.allPassed ? '✅' : '❌';

  lines.push('');
  lines.push(separator);
  lines.push(`${decisionIcon} QA检查点定义检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  lines.push(`📊 检查结果: ${result.allPassed ? '通过' : '未通过'}`);
  lines.push(`   QA检查点: ${result.qaCheckpointCount} / ${result.totalCheckpointCount}`);
  lines.push(`   通过: ${result.passedCount} / ${result.checks.length}`);
  if (result.failedCount > 0) {
    lines.push(`   失败: ${result.failedCount}`);
  }
  lines.push('');

  if (result.qaCheckpoints.length > 0) {
    lines.push('📝 QA相关检查点:');
    for (const cp of result.qaCheckpoints) {
      const statusIcon = cp.status === 'completed' ? '✅' :
                        cp.status === 'failed' ? '❌' :
                        cp.status === 'blocked' ? '🚫' : '⏳';
      lines.push(`   ${statusIcon} ${cp.name} (${cp.status})`);
    }
    lines.push('');
  }

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

export default QACheckpointsChecker;
