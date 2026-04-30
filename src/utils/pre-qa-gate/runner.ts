/**
 * Pre-QA Gate Runner
 * QA验证阶段前门禁协调器 - 统一管理和执行QA验证前置条件检查
 *
 * 职责:
 * - 编排QA前置检查器的执行顺序
 * - 聚合各检查器的结果
 * - 根据规则决定是否允许进入QA验证阶段
 * - 生成门禁报告
 *
 * @module pre-qa-gate/runner
 */

import type { TaskMeta } from '../../types/task.js';
import { normalizeStatus } from '../../types/task.js';
import { readTaskMeta } from '../task.js';

// ============== 门禁规则类型定义 ==============

/**
 * QA前置门禁规则类型
 */
export type PreQAGateRuleType =
  | 'code_review_pass'     // 代码审核通过检查
  | 'qa_checkpoints_defined' // QA检查点定义检查
  | 'test_config_ready'    // 测试配置就绪检查
  | 'review_report_exist'  // 审核报告存在性检查
  | 'task_status'          // 任务状态检查
  | 'custom';              // 自定义规则

/**
 * QA前置门禁规则配置
 */
export interface PreQAGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PreQAGateRuleType;
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
 * QA前置门禁规则执行结果
 */
export interface PreQAGateRuleResult {
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
 * QA前置门禁决策结果
 */
export type PreQAGateDecision = 'PRE_QA_PASS' | 'PRE_QA_FAIL' | 'PRE_QA_WARN';

/**
 * QA前置门禁运行结果
 */
export interface PreQAGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PreQAGateDecision;
  /** 是否允许进入QA验证阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PreQAGateRuleResult[];
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
 * QA前置门禁报告
 */
export interface PreQAGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PreQAGateRunResult;
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
 * QA前置门禁运行器配置
 */
export interface PreQAGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 规则列表 */
  rules: PreQAGateRule[];
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 是否要求代码审核通过 */
  requireCodeReviewPass: boolean;
  /** 是否要求QA检查点定义 */
  requireQACheckpoints: boolean;
  /** 是否要求测试配置就绪 */
  requireTestConfig: boolean;
  /** 是否要求审核报告 */
  requireReviewReport: boolean;
  /** 自定义规则处理器 */
  customRuleHandlers?: Map<string, PreQAGateRuleHandler>;
}

/**
 * QA前置门禁规则处理器函数类型
 */
export type PreQAGateRuleHandler = (
  task: TaskMeta,
  rule: PreQAGateRule,
  context: PreQAGateContext
) => Promise<PreQAGateRuleResult>;

/**
 * QA前置门禁上下文
 */
export interface PreQAGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
}

// ============== 默认配置 ==============

/**
 * 默认QA前置门禁规则
 */
export const DEFAULT_PRE_QA_GATE_RULES: PreQAGateRule[] = [
  {
    id: 'rule-task-status',
    type: 'task_status',
    name: '任务状态检查',
    description: '检查任务是否处于等待QA或审核通过状态',
    enabled: true,
    priority: 1,
    blocking: true,
  },
  {
    id: 'rule-code-review-pass',
    type: 'code_review_pass',
    name: '代码审核通过检查',
    description: '检查代码审核是否已通过',
    enabled: true,
    priority: 2,
    blocking: true,
  },
  {
    id: 'rule-qa-checkpoints-defined',
    type: 'qa_checkpoints_defined',
    name: 'QA检查点定义检查',
    description: '检查是否已定义QA相关检查点',
    enabled: true,
    priority: 3,
    blocking: true,
  },
  {
    id: 'rule-test-config-ready',
    type: 'test_config_ready',
    name: '测试配置就绪检查',
    description: '检查测试环境配置是否就绪',
    enabled: true,
    priority: 4,
    blocking: false,
  },
  {
    id: 'rule-review-report-exist',
    type: 'review_report_exist',
    name: '审核报告存在性检查',
    description: '检查代码审核报告是否存在',
    enabled: true,
    priority: 5,
    blocking: false,
  },
];

/**
 * 默认QA前置门禁运行器配置
 */
export const DEFAULT_PRE_QA_GATE_RUNNER_CONFIG: PreQAGateRunnerConfig = {
  enabled: true,
  rules: DEFAULT_PRE_QA_GATE_RULES,
  stopOnFailure: false,
  generateReport: true,
  requireCodeReviewPass: true,
  requireQACheckpoints: true,
  requireTestConfig: true,
  requireReviewReport: true,
};

// ============== PreQAGateRunner 类 ==============

/**
 * QA验证阶段前门禁协调器
 *
 * 统一管理和执行QA验证前置条件检查，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入QA验证阶段。
 */
export class PreQAGateRunner {
  private config: PreQAGateRunnerConfig;
  private customHandlers: Map<string, PreQAGateRuleHandler>;
  private cwd: string;

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PreQAGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map(config?.customRuleHandlers || []);

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PreQAGateRunnerConfig>): PreQAGateRunnerConfig {
    return {
      ...DEFAULT_PRE_QA_GATE_RUNNER_CONFIG,
      ...config,
      rules: config?.rules ?? DEFAULT_PRE_QA_GATE_RULES,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('task_status', this.handleTaskStatusRule.bind(this));
    this.customHandlers.set('code_review_pass', this.handleCodeReviewPassRule.bind(this));
    this.customHandlers.set('qa_checkpoints_defined', this.handleQACheckpointsDefinedRule.bind(this));
    this.customHandlers.set('test_config_ready', this.handleTestConfigReadyRule.bind(this));
    this.customHandlers.set('review_report_exist', this.handleReviewReportExistRule.bind(this));
  }

  /**
   * 执行QA前置门禁检查
   *
   * @param taskId 任务ID
   * @returns 门禁运行结果
   */
  async run(taskId: string): Promise<PreQAGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'PRE_QA_PASS',
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
        decision: 'PRE_QA_FAIL',
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
    const context: PreQAGateContext = {
      taskId,
      cwd: this.cwd,
      sharedData: new Map(),
    };

    // 按优先级排序规则
    const sortedRules = [...this.config.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    // 执行所有规则
    const ruleResults: PreQAGateRuleResult[] = [];
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
    const allowed = decision === 'PRE_QA_PASS' || (decision === 'PRE_QA_WARN' && blockingFailures === 0);

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
    rule: PreQAGateRule,
    context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
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
  private calculateDecision(results: PreQAGateRuleResult[], blockingFailures: number): PreQAGateDecision {
    if (blockingFailures > 0) {
      return 'PRE_QA_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'PRE_QA_PASS';
    }

    // 有非阻塞失败，返回警告
    return 'PRE_QA_WARN';
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
    rule: PreQAGateRule,
    _context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
    // 允许进入QA的状态：wait_qa, cr_passed, in_progress(兼容)
    const allowedStatuses = ['wait_qa', 'cr_passed', 'in_progress', 'wait_review'];
    const passed = allowedStatuses.includes(task.status);

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? `任务状态检查通过 (当前状态: ${task.status})`
        : `任务状态不满足QA验证条件 (当前状态: ${task.status})，需要状态为 wait_qa 或 cr_passed`,
      details: {
        currentStatus: task.status,
        allowedStatuses,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 代码审核通过规则处理器
   */
  private async handleCodeReviewPassRule(
    task: TaskMeta,
    rule: PreQAGateRule,
    _context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
    const errors: string[] = [];

    // 检查任务状态中是否有代码审核通过标记
    const normalizedStatus = normalizeStatus(task.status);
    const crPassedStatuses = ['cr_passed', 'wait_qa', 'qa', 'completed'];
    const statusIndicatesPass = crPassedStatuses.includes(normalizedStatus);

    // 检查 requirementHistory 中是否有审核通过记录
    let hasReviewPassRecord = false;
    if (task.requirementHistory && task.requirementHistory.length > 0) {
      hasReviewPassRecord = task.requirementHistory.some(
        h => h.field === 'status' &&
        (h.newValue === 'cr_passed' || h.newValue === 'wait_qa')
      );
    }

    // 检查 qualityGate 中是否有代码审核通过标记
    let hasQualityGatePass = false;
    if (task.qualityGate) {
      hasQualityGatePass = task.qualityGate.codeReviewPass === true ||
                           task.qualityGate.crPhasePass === true;
    }

    const passed = statusIndicatesPass || hasReviewPassRecord || hasQualityGatePass;

    if (!passed) {
      if (!statusIndicatesPass) {
        errors.push(`任务状态未标记为审核通过 (当前状态: ${task.status})`);
      }
      if (!hasReviewPassRecord && task.requirementHistory) {
        errors.push('未在需求历史中找到审核通过记录');
      }
      if (!hasQualityGatePass && task.qualityGate) {
        errors.push('质量门禁未标记代码审核通过');
      }
    }

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? '代码审核通过检查通过'
        : `代码审核未通过: ${errors.join('; ')}`,
      details: {
        currentStatus: task.status,
        statusIndicatesPass,
        hasReviewPassRecord,
        hasQualityGatePass,
        requireCodeReviewPass: this.config.requireCodeReviewPass,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * QA检查点定义规则处理器
   */
  private async handleQACheckpointsDefinedRule(
    task: TaskMeta,
    rule: PreQAGateRule,
    _context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
    const errors: string[] = [];

    // 检查是否有检查点定义
    if (!task.checkpoints || task.checkpoints.length === 0) {
      errors.push('任务未定义任何检查点');
    } else {
      // 查找QA相关检查点
      const qaCheckpoints = task.checkpoints.filter(cp =>
        cp.name.toLowerCase().includes('qa') ||
        cp.name.toLowerCase().includes('test') ||
        cp.name.toLowerCase().includes('验证')
      );

      if (qaCheckpoints.length === 0) {
        errors.push('未找到QA相关检查点 (请包含"qa", "test"或"验证"关键词)');
      }

      // 检查是否有未完成的检查点
      const incompleteCheckpoints = task.checkpoints.filter(
        cp => cp.status !== 'completed' && cp.status !== 'not_required'
      );

      // 检查是否有失败的检查点
      const failedCheckpoints = task.checkpoints.filter(cp => cp.status === 'failed');
      if (failedCheckpoints.length > 0) {
        errors.push(`存在 ${failedCheckpoints.length} 个失败的检查点`);
      }

      return {
        ruleId: rule.id,
        passed: errors.length === 0,
        ruleName: rule.name,
        message: errors.length === 0
          ? `QA检查点定义检查通过 (共 ${task.checkpoints.length} 个检查点, ${qaCheckpoints.length} 个QA相关)`
          : `QA检查点定义检查失败: ${errors.join('; ')}`,
        details: {
          totalCheckpoints: task.checkpoints.length,
          qaCheckpointCount: qaCheckpoints.length,
          incompleteCount: incompleteCheckpoints.length,
          failedCount: failedCheckpoints.length,
          requireQACheckpoints: this.config.requireQACheckpoints,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      ruleId: rule.id,
      passed: errors.length === 0 && !this.config.requireQACheckpoints,
      ruleName: rule.name,
      message: errors.length === 0
        ? 'QA检查点定义检查通过'
        : `QA检查点定义检查失败: ${errors.join('; ')}`,
      details: {
        totalCheckpoints: 0,
        requireQACheckpoints: this.config.requireQACheckpoints,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 测试配置就绪规则处理器
   */
  private async handleTestConfigReadyRule(
    task: TaskMeta,
    rule: PreQAGateRule,
    _context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
    const errors: string[] = [];
    const details: Record<string, unknown> = {};

    // 检查 testConfig 字段
    if (task.testConfig) {
      details.hasTestConfig = true;

      if (!task.testConfig.type) {
        errors.push('testConfig 缺少 type 字段');
      }

      if (task.testConfig.coverage && task.testConfig.coverage.minLines !== undefined) {
        details.minCoverage = task.testConfig.coverage.minLines;
      }
    } else {
      details.hasTestConfig = false;
    }

    // 检查 harness 配置
    if (task.harness) {
      details.hasHarnessConfig = true;
      details.harnessConfig = {
        runner: task.harness.runner,
        testCommand: task.harness.testCommand,
      };
    } else {
      details.hasHarnessConfig = false;
    }

    // 如果没有配置测试相关设置
    const hasTestConfig = details.hasTestConfig || details.hasHarnessConfig;
    details.hasTestConfig = hasTestConfig;

    const passed = hasTestConfig || !this.config.requireTestConfig;

    if (!passed) {
      errors.push('未配置测试环境 (缺少 testConfig 或 harness 配置)');
    }

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? hasTestConfig
          ? '测试配置就绪检查通过'
          : '测试配置检查跳过 (未要求)'
        : `测试配置未就绪: ${errors.join('; ')}`,
      details: {
        ...details,
        requireTestConfig: this.config.requireTestConfig,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 审核报告存在性规则处理器
   */
  private async handleReviewReportExistRule(
    task: TaskMeta,
    rule: PreQAGateRule,
    _context: PreQAGateContext
  ): Promise<PreQAGateRuleResult> {
    const errors: string[] = [];
    const details: Record<string, unknown> = {};

    // 检查 report 字段
    if (task.reports && task.reports.length > 0) {
      const reviewReports = task.reports.filter(r =>
        r.type === 'code_review' ||
        r.type === 'review' ||
        r.name.toLowerCase().includes('review')
      );

      details.reportCount = task.reports.length;
      details.reviewReportCount = reviewReports.length;

      if (reviewReports.length === 0) {
        errors.push('未找到代码审核报告');
      }
    } else {
      details.reportCount = 0;
      details.reviewReportCount = 0;
      errors.push('任务未配置任何报告');
    }

    // 检查 deliverables 中是否有报告
    if (task.deliverables) {
      const hasReportDeliverable = task.deliverables.some(d =>
        d.type === 'report' || d.path.includes('report')
      );
      details.hasReportDeliverable = hasReportDeliverable;
    }

    const passed = details.reviewReportCount !== undefined &&
                   (details.reviewReportCount as number) > 0;

    return {
      ruleId: rule.id,
      passed: passed || !this.config.requireReviewReport,
      ruleName: rule.name,
      message: passed
        ? `审核报告存在性检查通过 (找到 ${details.reviewReportCount} 个审核报告)`
        : passed || !this.config.requireReviewReport
          ? '审核报告检查跳过 (未要求)'
          : `审核报告不存在: ${errors.join('; ')}`,
      details: {
        ...details,
        requireReviewReport: this.config.requireReviewReport,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // ============== 报告生成 ==============

  /**
   * 生成QA前置门禁报告
   *
   * @param result 门禁运行结果
   * @returns 门禁报告
   */
  generateReport(result: PreQAGateRunResult): PreQAGateReport {
    const recommendations: string[] = [];

    // 根据失败规则生成建议
    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'rule-task-status':
            recommendations.push('任务状态不正确: 确保任务状态为 wait_qa 或 cr_passed');
            break;
          case 'rule-code-review-pass':
            recommendations.push('代码审核未通过: 请先完成代码审核并确保审核通过');
            break;
          case 'rule-qa-checkpoints-defined':
            recommendations.push('QA检查点未定义: 添加包含"qa", "test"或"验证"关键词的检查点');
            break;
          case 'rule-test-config-ready':
            recommendations.push('测试配置未就绪: 配置 testConfig 或 harness 测试环境');
            break;
          case 'rule-review-report-exist':
            recommendations.push('审核报告缺失: 确保代码审核报告已生成并关联到任务');
            break;
        }
      }
    }

    // 如果全部通过，给出正面反馈
    if (result.decision === 'PRE_QA_PASS') {
      recommendations.push('✅ 任务满足QA验证条件，可以进入QA验证阶段');
    }

    return {
      reportId: `pre-qa-gate-report-${result.taskId}-${Date.now()}`,
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
  formatResult(result: PreQAGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    // 决策图标
    const decisionIcon = result.decision === 'PRE_QA_PASS' ? '✅' :
                        result.decision === 'PRE_QA_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} QA验证阶段前门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    // 决策结果
    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入QA验证阶段: ${result.allowed ? '是' : '否'}`);
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
  updateConfig(config: Partial<PreQAGateRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PreQAGateRunnerConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义规则处理器
   *
   * @param ruleType 规则类型
   * @param handler 处理器函数
   */
  registerRuleHandler(ruleType: string, handler: PreQAGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加规则
   *
   * @param rule 规则配置
   */
  addRule(rule: PreQAGateRule): void {
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
 * 创建QA前置门禁运行器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PreQAGateRunner 实例
 */
export function createPreQAGateRunner(
  cwd: string,
  config?: Partial<PreQAGateRunnerConfig>
): PreQAGateRunner {
  return new PreQAGateRunner(cwd, config);
}

/**
 * 快速执行QA前置门禁检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果
 */
export async function quickPreQAGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PreQAGateRunnerConfig>
): Promise<PreQAGateRunResult> {
  const runner = new PreQAGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行QA前置门禁检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果列表
 */
export async function batchPreQAGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PreQAGateRunnerConfig>
): Promise<PreQAGateRunResult[]> {
  const runner = new PreQAGateRunner(cwd, config);
  const results: PreQAGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PreQAGateRunner;
