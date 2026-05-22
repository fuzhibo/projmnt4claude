/**
 * Pre-CR Gate Runner
 * 代码审核前门禁协调器 - 统一管理和执行代码审核前置条件检查
 *
 * 职责:
 * - 编排审核前检查器的执行顺序
 * - 聚合各检查器的结果
 * - 根据规则决定是否允许进入代码审核阶段
 * - 生成门禁报告
 *
 * @module pre-cr-gate/runner
 */

import type { TaskMeta, FailureType } from '../../types/task.js';
import { normalizeStatus } from '../../types/task.js';
import { readTaskMeta } from '../task.js';

// ============== 门禁规则类型定义 ==============

/**
 * 审核前门禁规则类型
 */
export type PreCRGateRuleType =
  | 'task_status'          // 任务状态检查
  | 'checkpoints_complete' // 检查点完成检查
  | 'artifacts_exist'      // 开发产物存在性检查
  | 'quality_score'        // 质量分数检查
  | 'custom';              // 自定义规则

/**
 * 审核前门禁规则配置
 */
export interface PreCRGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PreCRGateRuleType;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 规则优先级 (数字越小优先级越高) */
  priority: number;
  /** 是否为阻塞规则 (失败则整体失败) */
  blocking: boolean;
  /**
   * 失败类型分类
   * - 'A': Task Foundation - 任务数据有效性检查，失败需中断流水线
   * - 'B': Phase Artifact - 阶段输出质量检查，失败需回退到阶段起点重试
   * Pre-CR Gate 默认为 'A' 类（检查任务数据本身有效性）
   */
  failureType?: FailureType;
  /** 规则配置参数 */
  config?: Record<string, unknown>;
}

/**
 * 审核前门禁规则执行结果
 */
export interface PreCRGateRuleResult {
  /** 规则ID */
  ruleId: string;
  /** 是否通过 */
  passed: boolean;
  /** 规则名称 */
  ruleName: string;
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
 * 审核前门禁决策结果
 */
export type PreCRGateDecision = 'PRE_CR_PASS' | 'PRE_CR_FAIL' | 'PRE_CR_WARN';

/**
 * 审核前门禁运行结果
 */
export interface PreCRGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PreCRGateDecision;
  /** 是否允许进入代码审核阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PreCRGateRuleResult[];
  /** 通过的规则数 */
  passedRules: number;
  /** 失败的规则数 */
  failedRules: number;
  /** 警告数 */
  warningCount: number;
  /** 阻塞失败数 */
  blockingFailures: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 审核前门禁报告
 */
export interface PreCRGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PreCRGateRunResult;
  /** 建议 */
  recommendations: string[];
  /** 元数据 */
  metadata: {
    version: string;
    runnerVersion: string;
    rulesExecuted: number;
  };
}

/**
 * 审核前门禁运行器配置
 */
export interface PreCRGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 最低质量分数 (0-100) */
  minQualityScore: number;
  /** 规则列表 */
  rules: PreCRGateRule[];
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 是否要求所有检查点完成 */
  requireAllCheckpoints: boolean;
  /** 是否要求开发产物 */
  requireArtifacts: boolean;
  /** 自定义规则处理器 */
  customRuleHandlers?: Map<string, PreCRGateRuleHandler>;
}

/**
 * 审核前门禁规则处理器函数类型
 */
export type PreCRGateRuleHandler = (
  task: TaskMeta,
  rule: PreCRGateRule,
  context: PreCRGateContext
) => Promise<PreCRGateRuleResult>;

/**
 * 审核前门禁上下文
 */
export interface PreCRGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
}

// ============== 默认配置 ==============

/**
 * 默认审核前门禁规则
 */
export const DEFAULT_PRE_CR_GATE_RULES: PreCRGateRule[] = [
  {
    id: 'rule-task-status',
    type: 'task_status',
    name: '任务状态检查',
    description: '检查任务是否处于开发完成状态',
    enabled: true,
    priority: 1,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'rule-checkpoints-complete',
    type: 'checkpoints_complete',
    name: '检查点完成检查',
    description: '检查所有检查点是否已完成',
    enabled: true,
    priority: 2,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'rule-artifacts-exist',
    type: 'artifacts_exist',
    name: '开发产物存在性检查',
    description: '检查相关文件是否存在',
    enabled: true,
    priority: 3,
    blocking: false,
    failureType: 'A',
  },
  {
    id: 'rule-quality-score',
    type: 'quality_score',
    name: '质量分数检查',
    description: '检查任务质量分数是否达标',
    enabled: true,
    priority: 4,
    blocking: false,
    failureType: 'A',
    config: {
      minScore: 70,
    },
  },
];

/**
 * 默认审核前门禁运行器配置
 */
export const DEFAULT_PRE_CR_GATE_RUNNER_CONFIG: PreCRGateRunnerConfig = {
  enabled: true,
  minQualityScore: 70,
  rules: DEFAULT_PRE_CR_GATE_RULES,
  stopOnFailure: false,
  generateReport: true,
  requireAllCheckpoints: true,
  requireArtifacts: true,
};

// ============== PreCRGateRunner 类 ==============

/**
 * 代码审核前门禁协调器
 *
 * 统一管理和执行代码审核前置条件检查，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入代码审核阶段。
 */
export class PreCRGateRunner {
  private config: PreCRGateRunnerConfig;
  private customHandlers: Map<string, PreCRGateRuleHandler>;
  private cwd: string;

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PreCRGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map(config?.customRuleHandlers || []);

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PreCRGateRunnerConfig>): PreCRGateRunnerConfig {
    return {
      ...DEFAULT_PRE_CR_GATE_RUNNER_CONFIG,
      ...config,
      rules: config?.rules ?? DEFAULT_PRE_CR_GATE_RULES,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('task_status', this.handleTaskStatusRule.bind(this));
    this.customHandlers.set('checkpoints_complete', this.handleCheckpointsCompleteRule.bind(this));
    this.customHandlers.set('artifacts_exist', this.handleArtifactsExistRule.bind(this));
    this.customHandlers.set('quality_score', this.handleQualityScoreRule.bind(this));
  }

  /**
   * 执行审核前门禁检查
   *
   * @param taskId 任务ID
   * @returns 门禁运行结果
   */
  async run(taskId: string): Promise<PreCRGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'PRE_CR_PASS',
        allowed: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        warningCount: 0,
        blockingFailures: 0,
        duration: 0,
        timestamp,
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        decision: 'PRE_CR_FAIL',
        allowed: false,
        ruleResults: [{
          ruleId: 'task-existence',
          passed: false,
          ruleName: '任务存在性检查',
          message: `任务 ${taskId} 不存在`,
          duration: 0,
          timestamp,
        }],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 创建上下文
    const context: PreCRGateContext = {
      taskId,
      cwd: this.cwd,
      sharedData: new Map(),
    };

    // 按优先级排序规则
    const sortedRules = [...this.config.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    // 执行所有规则
    const ruleResults: PreCRGateRuleResult[] = [];
    let blockingFailures = 0;
    let failedRules = 0;

    for (const rule of sortedRules) {
      const result = await this.executeRule(task, rule, context);
      ruleResults.push(result);

      if (!result.passed) {
        failedRules++;
        if (rule.blocking) {
          blockingFailures++;
          if (this.config.stopOnFailure) {
            break;
          }
        }
      }
    }

    // 计算决策
    const decision = this.calculateDecision(ruleResults, blockingFailures);
    const allowed = decision === 'PRE_CR_PASS' || (decision === 'PRE_CR_WARN' && blockingFailures === 0);

    const duration = Date.now() - startTime;
    const passedRules = ruleResults.filter(r => r.passed).length;
    const warningCount = ruleResults.filter(r => !r.passed && !this.isBlockingRule(r.ruleId)).length;

    return {
      taskId,
      decision,
      allowed,
      ruleResults,
      passedRules,
      failedRules,
      warningCount,
      blockingFailures,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 执行单个规则
   */
  private async executeRule(
    task: TaskMeta,
    rule: PreCRGateRule,
    context: PreCRGateContext
  ): Promise<PreCRGateRuleResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // 获取规则处理器
      const handler = this.customHandlers.get(rule.type);

      if (!handler) {
        return {
          ruleId: rule.id,
          passed: false,
          ruleName: rule.name,
          message: `未找到规则类型 ${rule.type} 的处理器`,
          duration: Date.now() - startTime,
          timestamp,
        };
      }

      // 执行规则处理器
      const result = await handler(task, rule, context);
      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `规则执行失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp,
      };
    }
  }

  /**
   * 计算门禁决策
   */
  private calculateDecision(results: PreCRGateRuleResult[], blockingFailures: number): PreCRGateDecision {
    if (blockingFailures > 0) {
      return 'PRE_CR_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'PRE_CR_PASS';
    }

    // 有非阻塞失败，返回警告
    return 'PRE_CR_WARN';
  }

  /**
   * 判断是否为阻塞规则
   */
  private isBlockingRule(ruleId: string): boolean {
    const rule = this.config.rules.find(r => r.id === ruleId);
    return rule?.blocking ?? false;
  }

  // ============== 内置规则处理器 ==============

  /**
   * 任务状态规则处理器
   */
  private async handleTaskStatusRule(
    task: TaskMeta,
    rule: PreCRGateRule,
    _context: PreCRGateContext
  ): Promise<PreCRGateRuleResult> {
    const normalizedStatus = normalizeStatus(task.status);

    // 允许进入代码审核的状态：in_progress 或 wait_review
    const allowedStatuses = ['in_progress', 'wait_review'];
    const passed = allowedStatuses.includes(normalizedStatus);

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? `任务状态检查通过 (当前状态: ${task.status})`
        : `任务状态不满足代码审核条件 (当前状态: ${task.status})，需要状态为 in_progress 或 wait_review`,
      details: {
        currentStatus: task.status,
        normalizedStatus,
        allowedStatuses,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查点完成规则处理器
   */
  private async handleCheckpointsCompleteRule(
    task: TaskMeta,
    rule: PreCRGateRule,
    _context: PreCRGateContext
  ): Promise<PreCRGateRuleResult> {
    const errors: string[] = [];

    // 获取检查点策略
    const checkpointPolicy = task.checkpointPolicy ??
      (task.type === 'bug' || task.priority === 'P0' || task.priority === 'P1' ? 'required' : 'optional');

    // 如果检查点是可选的，直接通过
    if (checkpointPolicy === 'none') {
      return {
        ruleId: rule.id,
        passed: true,
        ruleName: rule.name,
        message: '检查点策略为 none，跳过检查点完成检查',
        details: {
          checkpointPolicy,
          totalCheckpoints: 0,
          completedCheckpoints: 0,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查检查点是否存在
    if (!task.checkpoints || task.checkpoints.length === 0) {
      if (checkpointPolicy === 'required') {
        errors.push('任务配置了 required 检查点策略，但未定义任何检查点');
      }
    } else {
      // 统计检查点状态
      const totalCheckpoints = task.checkpoints.length;
      const completedCheckpoints = task.checkpoints.filter(cp => cp.status === 'completed').length;
      const failedCheckpoints = task.checkpoints.filter(cp => cp.status === 'failed').length;
      const pendingCheckpoints = task.checkpoints.filter(cp => cp.status === 'pending').length;

      if (checkpointPolicy === 'required' && completedCheckpoints < totalCheckpoints) {
        errors.push(`检查点未完成: ${completedCheckpoints}/${totalCheckpoints} (待处理: ${pendingCheckpoints}, 失败: ${failedCheckpoints})`);
      }

      if (failedCheckpoints > 0) {
        errors.push(`存在 ${failedCheckpoints} 个失败的检查点`);
      }

      const passed = errors.length === 0;

      return {
        ruleId: rule.id,
        passed,
        ruleName: rule.name,
        message: passed
          ? `检查点完成检查通过 (${completedCheckpoints}/${totalCheckpoints})`
          : `检查点未全部完成: ${errors.join('; ')}`,
        details: {
          checkpointPolicy,
          totalCheckpoints,
          completedCheckpoints,
          failedCheckpoints,
          pendingCheckpoints,
          completionRate: totalCheckpoints > 0 ? (completedCheckpoints / totalCheckpoints) : 1,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const passed = errors.length === 0;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? '检查点完成检查通过'
        : `检查点未完成: ${errors.join('; ')}`,
      details: {
        checkpointPolicy,
        totalCheckpoints: task.checkpoints?.length ?? 0,
        completedCheckpoints: task.checkpoints?.filter(cp => cp.status === 'completed').length ?? 0,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 开发产物存在性规则处理器
   */
  private async handleArtifactsExistRule(
    task: TaskMeta,
    rule: PreCRGateRule,
    _context: PreCRGateContext
  ): Promise<PreCRGateRuleResult> {
    const errors: string[] = [];
    const missingFiles: string[] = [];
    const existingFiles: string[] = [];

    // 检查 affected_files
    if (task.affected_files && task.affected_files.length > 0) {
      const fs = await import('fs');
      const path = await import('path');

      for (const filePath of task.affected_files) {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(this.cwd, filePath);

        if (!fs.existsSync(fullPath)) {
          missingFiles.push(filePath);
        } else {
          existingFiles.push(filePath);
        }
      }

      if (missingFiles.length > 0) {
        errors.push(`以下文件不存在: ${missingFiles.join(', ')}`);
      }
    }

    // 检查 files 字段
    if (task.files && task.files.length > 0) {
      const fs = await import('fs');
      const path = await import('path');

      for (const filePath of task.files) {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(this.cwd, filePath);

        if (!fs.existsSync(fullPath)) {
          missingFiles.push(filePath);
        } else if (!existingFiles.includes(filePath)) {
          existingFiles.push(filePath);
        }
      }

      if (missingFiles.length > 0) {
        errors.push(`以下文件不存在: ${missingFiles.join(', ')}`);
      }
    }

    // 如果没有配置任何文件检查，且配置要求产物，给出警告
    if (this.config.requireArtifacts &&
        (!task.affected_files || task.affected_files.length === 0) &&
        (!task.files || task.files.length === 0)) {
      errors.push('未配置相关文件 (affected_files 或 files)，无法验证开发产物');
    }

    const passed = errors.length === 0 || !this.config.requireArtifacts;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? `开发产物检查通过 (存在 ${existingFiles.length} 个文件)`
        : `开发产物检查失败: ${errors.join('; ')}`,
      details: {
        totalFiles: (task.affected_files?.length ?? 0) + (task.files?.length ?? 0),
        existingFiles,
        missingFiles,
        requireArtifacts: this.config.requireArtifacts,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 质量分数规则处理器
   */
  private async handleQualityScoreRule(
    task: TaskMeta,
    rule: PreCRGateRule,
    _context: PreCRGateContext
  ): Promise<PreCRGateRuleResult> {
    const minScore = (rule.config?.minScore as number) ?? this.config.minQualityScore;
    const initScore = task.initQualityScore;

    // 如果没有初始质量分数，根据任务内容评估
    let score = initScore;
    if (score === undefined) {
      score = this.estimateQualityScore(task);
    }

    const passed = score >= minScore;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? `质量分数检查通过 (${score}/${minScore})`
        : `质量分数不足: ${score}/${minScore}`,
      details: {
        score,
        minScore,
        initScore,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 估算任务质量分数
   */
  private estimateQualityScore(task: TaskMeta): number {
    let score = 100;

    // 描述长度评分
    const descLength = task.description?.length ?? 0;
    if (descLength < 50) {
      score -= 30;
    } else if (descLength < 100) {
      score -= 15;
    }

    // 检查点评分
    const checkpointCount = task.checkpoints?.length ?? 0;
    if (checkpointCount === 0) {
      score -= 20;
    } else if (checkpointCount < 2) {
      score -= 10;
    }

    // 相关文件评分
    const hasAffectedFiles = task.affected_files && task.affected_files.length > 0;
    if (!hasAffectedFiles) {
      score -= 15;
    }

    // 结构化内容评分
    const hasSolutionSection = /##\s*解决方案|##\s*方案/i.test(task.description ?? '');
    if (!hasSolutionSection) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  // ============== 报告生成 ==============

  /**
   * 生成审核前门禁报告
   *
   * @param result 门禁运行结果
   * @returns 门禁报告
   */
  generateReport(result: PreCRGateRunResult): PreCRGateReport {
    const recommendations: string[] = [];

    // 根据失败规则生成建议
    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'rule-task-status':
            recommendations.push('任务状态不正确: 确保任务状态为 in_progress 或 wait_review');
            break;
          case 'rule-checkpoints-complete':
            recommendations.push('检查点未完成: 完成所有检查点后再次尝试');
            break;
          case 'rule-artifacts-exist':
            recommendations.push('开发产物缺失: 确保所有相关文件已创建');
            break;
          case 'rule-quality-score':
            recommendations.push('提升任务质量: 添加详细描述、解决方案和相关文件');
            break;
        }
      }
    }

    // 如果全部通过，给出正面反馈
    if (result.decision === 'PRE_CR_PASS') {
      recommendations.push('✅ 任务满足代码审核条件，可以进入审核阶段');
    }

    return {
      reportId: `pre-cr-gate-report-${result.taskId}-${Date.now()}`,
      taskId: result.taskId,
      generatedAt: new Date().toISOString(),
      result,
      recommendations,
      metadata: {
        version: '1.0.0',
        runnerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
      },
    };
  }

  /**
   * 格式化门禁结果为终端输出
   *
   * @param result 门禁运行结果
   * @returns 格式化字符串
   */
  formatResult(result: PreCRGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    // 决策图标
    const decisionIcon = result.decision === 'PRE_CR_PASS' ? '✅' :
                        result.decision === 'PRE_CR_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 代码审核前门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    // 决策结果
    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入代码审核阶段: ${result.allowed ? '是' : '否'}`);
    lines.push('');

    // 规则统计
    lines.push(`📋 规则统计:`);
    lines.push(`   通过: ${result.passedRules}`);
    lines.push(`   失败: ${result.failedRules}`);
    if (result.warningCount > 0) {
      lines.push(`   警告: ${result.warningCount}`);
    }
    if (result.blockingFailures > 0) {
      lines.push(`   阻塞失败: ${result.blockingFailures}`);
    }
    lines.push('');

    // 详细规则结果
    if (result.ruleResults.length > 0) {
      lines.push('🔍 详细结果:');
      lines.push('');

      for (const ruleResult of result.ruleResults) {
        const icon = ruleResult.passed ? '✅' : this.isBlockingRule(ruleResult.ruleId) ? '❌' : '⚠️ ';
        lines.push(`   ${icon} ${ruleResult.ruleName}`);
        lines.push(`      ${ruleResult.message}`);
        lines.push('');
      }
    }

    // 执行时长
    lines.push(`⏱️  执行时长: ${result.duration}ms`);
    lines.push('');
    lines.push(separator);

    return lines.join('\n');
  }

  // ============== 配置管理 ==============

  /**
   * 更新配置
   *
   * @param config 部分配置
   */
  updateConfig(config: Partial<PreCRGateRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PreCRGateRunnerConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义规则处理器
   *
   * @param ruleType 规则类型
   * @param handler 处理器函数
   */
  registerRuleHandler(ruleType: string, handler: PreCRGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加规则
   *
   * @param rule 规则配置
   */
  addRule(rule: PreCRGateRule): void {
    // 移除同ID的现有规则
    this.config.rules = this.config.rules.filter(r => r.id !== rule.id);
    this.config.rules.push(rule);
  }

  /**
   * 移除规则
   *
   * @param ruleId 规则ID
   */
  removeRule(ruleId: string): void {
    this.config.rules = this.config.rules.filter(r => r.id !== ruleId);
  }
}

// ============== 便捷函数 ==============

/**
 * 创建审核前门禁运行器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PreCRGateRunner 实例
 */
export function createPreCRGateRunner(
  cwd: string,
  config?: Partial<PreCRGateRunnerConfig>
): PreCRGateRunner {
  return new PreCRGateRunner(cwd, config);
}

/**
 * 快速执行审核前门禁检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果
 */
export async function quickPreCRGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PreCRGateRunnerConfig>
): Promise<PreCRGateRunResult> {
  const runner = new PreCRGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行审核前门禁检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果列表
 */
export async function batchPreCRGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PreCRGateRunnerConfig>
): Promise<PreCRGateRunResult[]> {
  const runner = new PreCRGateRunner(cwd, config);
  const results: PreCRGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PreCRGateRunner;
