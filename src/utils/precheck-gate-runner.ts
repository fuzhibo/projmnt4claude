/**
 * PreCheck Gate Runner
 * 预检测门禁协调器 - 统一管理和执行开发前质量门禁
 *
 * 职责:
 * - 编排多个检查器的执行顺序
 * - 聚合各检查器的结果
 * - 根据规则决定是否允许进入开发阶段
 * - 生成门禁报告
 *
 * @module precheck-gate-runner
 */

import type {
  PrecheckConfig,
  PrecheckResult,
} from '../types/precheck.js';
import { PrecheckOrchestrator } from './precheck-orchestrator.js';
import type { TaskMeta } from '../types/task.js';
import { readTaskMeta } from './task.js';

// ============== 门禁规则类型定义 ==============

/**
 * 门禁规则类型
 */
export type GateRuleType =
  | 'metadata_complete'      // 元数据完整性
  | 'checkpoints_valid'      // 检查点有效性
  | 'dependencies_ready'     // 依赖就绪
  | 'quality_score'          // 质量分数
  | 'custom';                // 自定义规则

/**
 * 门禁规则配置
 */
export interface GateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: GateRuleType;
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
  /** 规则配置参数 */
  config?: Record<string, unknown>;
}

/**
 * 门禁规则执行结果
 */
export interface GateRuleResult {
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
 * 门禁决策结果
 */
export type GateDecision = 'PASS' | 'FAIL' | 'WARN';

/**
 * 门禁运行结果
 */
export interface GateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: GateDecision;
  /** 是否允许进入开发阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: GateRuleResult[];
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
  /** 预检查结果 (如果使用PrecheckOrchestrator) */
  precheckResult?: PrecheckResult;
}

/**
 * 门禁报告
 */
export interface GateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: GateRunResult;
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
 * 门禁运行器配置
 */
export interface GateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 最低质量分数 (0-100) */
  minQualityScore: number;
  /** 规则列表 */
  rules: GateRule[];
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 是否使用PrecheckOrchestrator */
  usePrecheckOrchestrator: boolean;
  /** Precheck配置 */
  precheckConfig?: Partial<PrecheckConfig>;
  /** 自定义规则处理器 */
  customRuleHandlers?: Map<string, GateRuleHandler>;
}

/**
 * 门禁规则处理器函数类型
 */
export type GateRuleHandler = (
  task: TaskMeta,
  rule: GateRule,
  context: GateContext
) => Promise<GateRuleResult>;

/**
 * 门禁上下文
 */
export interface GateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
  /** 预检查结果 */
  precheckResult?: PrecheckResult;
}

// ============== 默认配置 ==============

/**
 * 默认门禁规则
 */
export const DEFAULT_GATE_RULES: GateRule[] = [
  {
    id: 'rule-metadata-complete',
    type: 'metadata_complete',
    name: '元数据完整性检查',
    description: '检查任务元数据是否完整',
    enabled: true,
    priority: 1,
    blocking: true,
  },
  {
    id: 'rule-checkpoints-valid',
    type: 'checkpoints_valid',
    name: '检查点有效性检查',
    description: '检查检查点配置是否有效',
    enabled: true,
    priority: 2,
    blocking: true,
  },
  {
    id: 'rule-dependencies-ready',
    type: 'dependencies_ready',
    name: '依赖任务就绪检查',
    description: '检查依赖任务是否已完成',
    enabled: true,
    priority: 3,
    blocking: true,
  },
  {
    id: 'rule-quality-score',
    type: 'quality_score',
    name: '质量分数检查',
    description: '检查任务质量分数是否达标',
    enabled: true,
    priority: 4,
    blocking: false,
    config: {
      minScore: 60,
    },
  },
];

/**
 * 默认门禁运行器配置
 */
export const DEFAULT_GATE_RUNNER_CONFIG: GateRunnerConfig = {
  enabled: true,
  minQualityScore: 60,
  rules: DEFAULT_GATE_RULES,
  stopOnFailure: false,
  generateReport: true,
  usePrecheckOrchestrator: true,
};

// ============== PreCheckGateRunner 类 ==============

/**
 * 预检测门禁协调器
 *
 * 统一管理和执行开发前质量门禁，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入开发阶段。
 */
export class PreCheckGateRunner {
  private config: GateRunnerConfig;
  private orchestrator?: PrecheckOrchestrator;
  private customHandlers: Map<string, GateRuleHandler>;
  private cwd: string;

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<GateRunnerConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map(config?.customRuleHandlers || []);

    // 如果使用PrecheckOrchestrator，创建实例
    if (this.config.usePrecheckOrchestrator) {
      this.orchestrator = new PrecheckOrchestrator(this.config.precheckConfig);
    }

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<GateRunnerConfig>): GateRunnerConfig {
    return {
      ...DEFAULT_GATE_RUNNER_CONFIG,
      ...config,
      rules: config?.rules ?? DEFAULT_GATE_RULES,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('metadata_complete', this.handleMetadataCompleteRule.bind(this));
    this.customHandlers.set('checkpoints_valid', this.handleCheckpointsValidRule.bind(this));
    this.customHandlers.set('dependencies_ready', this.handleDependenciesReadyRule.bind(this));
    this.customHandlers.set('quality_score', this.handleQualityScoreRule.bind(this));
  }

  /**
   * 执行门禁检查
   *
   * @param taskId 任务ID
   * @returns 门禁运行结果
   */
  async run(taskId: string): Promise<GateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'PASS',
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
        decision: 'FAIL',
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

    // 执行预检查（如果使用PrecheckOrchestrator）
    let precheckResult: PrecheckResult | undefined;
    if (this.orchestrator) {
      try {
        precheckResult = await this.orchestrator.run({
          taskId,
          cwd: this.cwd,
          config: this.config.precheckConfig,
        });
      } catch (error) {
        console.warn(`预检查执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 创建上下文
    const context: GateContext = {
      taskId,
      cwd: this.cwd,
      sharedData: new Map(),
      precheckResult,
    };

    // 按优先级排序规则
    const sortedRules = [...this.config.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    // 执行所有规则
    const ruleResults: GateRuleResult[] = [];
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
    const allowed = decision === 'PASS' || (decision === 'WARN' && blockingFailures === 0);

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
      precheckResult,
    };
  }

  /**
   * 执行单个规则
   */
  private async executeRule(
    task: TaskMeta,
    rule: GateRule,
    context: GateContext
  ): Promise<GateRuleResult> {
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
  private calculateDecision(results: GateRuleResult[], blockingFailures: number): GateDecision {
    if (blockingFailures > 0) {
      return 'FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'PASS';
    }

    // 有非阻塞失败，返回警告
    return 'WARN';
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
   * 元数据完整性规则处理器
   */
  private async handleMetadataCompleteRule(
    task: TaskMeta,
    rule: GateRule,
    _context: GateContext
  ): Promise<GateRuleResult> {
    const errors: string[] = [];

    // 检查必填字段
    if (!task.id || task.id.trim().length === 0) {
      errors.push('任务ID不能为空');
    }

    if (!task.title || task.title.trim().length === 0) {
      errors.push('任务标题不能为空');
    }

    if (!task.description || task.description.trim().length < 10) {
      errors.push('任务描述不足10个字符');
    }

    if (!task.type) {
      errors.push('任务类型未指定');
    }

    if (!task.priority) {
      errors.push('任务优先级未指定');
    }

    const passed = errors.length === 0;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed ? '元数据完整性检查通过' : `元数据不完整: ${errors.join('; ')}`,
      details: { errors },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查点有效性规则处理器
   */
  private async handleCheckpointsValidRule(
    task: TaskMeta,
    rule: GateRule,
    _context: GateContext
  ): Promise<GateRuleResult> {
    const errors: string[] = [];

    // 获取检查点策略
    const checkpointPolicy = task.checkpointPolicy ??
      (task.type === 'bug' || task.priority === 'P0' || task.priority === 'P1' ? 'required' : 'optional');

    if (checkpointPolicy === 'required') {
      if (!task.checkpoints || task.checkpoints.length === 0) {
        errors.push('required策略要求至少配置一个检查点');
      } else if (task.checkpoints.length < 2) {
        errors.push('required策略要求至少配置2个检查点');
      }
    }

    // 检查检查点结构
    if (task.checkpoints && task.checkpoints.length > 0) {
      for (let i = 0; i < task.checkpoints.length; i++) {
        const cp = task.checkpoints[i];
        if (!cp) continue;

        if (!cp.id) {
          errors.push(`检查点[${i}]缺少ID`);
        }
        if (!cp.description || cp.description.trim().length === 0) {
          errors.push(`检查点[${i}]缺少描述`);
        }
      }
    }

    const passed = errors.length === 0;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed ? '检查点有效性检查通过' : `检查点配置无效: ${errors.join('; ')}`,
      details: {
        errors,
        checkpointCount: task.checkpoints?.length ?? 0,
        checkpointPolicy,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 依赖就绪规则处理器
   */
  private async handleDependenciesReadyRule(
    task: TaskMeta,
    rule: GateRule,
    context: GateContext
  ): Promise<GateRuleResult> {
    const errors: string[] = [];
    const details: Record<string, unknown> = {
      dependencies: task.dependencies ?? [],
    };

    // 如果有预检查结果，使用其结果
    if (context.precheckResult) {
      const phaseResults = context.precheckResult.phases;
      const dependencyPhase = phaseResults.find(p => p.phase === 'dependency');

      if (dependencyPhase) {
        const failedChecks = dependencyPhase.checks.filter(c => !c.passed);
        if (failedChecks.length > 0) {
          errors.push(...failedChecks.map(c => c.message));
        }

        details.precheckPhase = dependencyPhase;
      }
    } else {
      // 直接检查依赖
      if (task.dependencies && task.dependencies.length > 0) {
        const { readTaskMeta } = await import('./task.js');
        const { normalizeStatus } = await import('../types/task.js');

        for (const depId of task.dependencies) {
          const depTask = readTaskMeta(depId, this.cwd);

          if (!depTask) {
            errors.push(`依赖任务 ${depId} 不存在`);
            continue;
          }

          const normalizedStatus = normalizeStatus(depTask.status);

          if (normalizedStatus === 'failed' || normalizedStatus === 'abandoned') {
            errors.push(`依赖任务 ${depId} 已失败`);
          } else if (normalizedStatus !== 'resolved' && normalizedStatus !== 'closed') {
            errors.push(`依赖任务 ${depId} 未完成 (当前状态: ${depTask.status})`);
          }
        }
      }
    }

    const passed = errors.length === 0;

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? '依赖任务就绪检查通过'
        : `依赖任务未就绪: ${errors.join('; ')}`,
      details,
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 质量分数规则处理器
   */
  private async handleQualityScoreRule(
    task: TaskMeta,
    rule: GateRule,
    _context: GateContext
  ): Promise<GateRuleResult> {
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
   * 生成门禁报告
   *
   * @param result 门禁运行结果
   * @returns 门禁报告
   */
  generateReport(result: GateRunResult): GateReport {
    const recommendations: string[] = [];

    // 根据失败规则生成建议
    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'rule-metadata-complete':
            recommendations.push('完善任务元数据: 确保标题、描述、类型和优先级都已填写');
            break;
          case 'rule-checkpoints-valid':
            recommendations.push('完善检查点配置: 添加至少2个结构化的检查点');
            break;
          case 'rule-dependencies-ready':
            recommendations.push('等待依赖任务完成后再执行');
            break;
          case 'rule-quality-score':
            recommendations.push('提升任务质量: 添加详细描述、解决方案和相关文件');
            break;
        }
      }
    }

    // 如果全部通过，给出正面反馈
    if (result.decision === 'PASS') {
      recommendations.push('✅ 任务质量良好，可以进入开发阶段');
    }

    return {
      reportId: `gate-report-${result.taskId}-${Date.now()}`,
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
  formatResult(result: GateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    // 决策图标
    const decisionIcon = result.decision === 'PASS' ? '✅' :
                        result.decision === 'WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 预检测门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    // 决策结果
    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入开发阶段: ${result.allowed ? '是' : '否'}`);
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
  updateConfig(config: Partial<GateRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): GateRunnerConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义规则处理器
   *
   * @param ruleType 规则类型
   * @param handler 处理器函数
   */
  registerRuleHandler(ruleType: string, handler: GateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加规则
   *
   * @param rule 规则配置
   */
  addRule(rule: GateRule): void {
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
 * 创建门禁运行器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PreCheckGateRunner 实例
 */
export function createGateRunner(
  cwd: string,
  config?: Partial<GateRunnerConfig>
): PreCheckGateRunner {
  return new PreCheckGateRunner(cwd, config);
}

/**
 * 快速执行门禁检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果
 */
export async function quickGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<GateRunnerConfig>
): Promise<GateRunResult> {
  const runner = new PreCheckGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行门禁检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果列表
 */
export async function batchGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<GateRunnerConfig>
): Promise<GateRunResult[]> {
  const runner = new PreCheckGateRunner(cwd, config);
  const results: GateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PreCheckGateRunner;
