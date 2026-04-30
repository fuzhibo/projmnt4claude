/**
 * Post-CR Gate Runner
 * 代码审核阶段后质量门禁运行器
 *
 * 职责:
 * - 编排代码审核后检查器的执行顺序
 * - 验证 code-review-report.json 存在性和格式正确性
 * - 确认审核结果 (PASS/NOPASS) 的有效性
 * - 同步审核结果与检查点状态
 * - 生成测试环境配置 tasks_test_env_adv.json
 * - 生成代码审核后质量门禁报告
 *
 * @module post-cr-gate/runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta, CheckpointMetadata } from '../../types/task.js';
import { readTaskMeta } from '../task.js';

// ============== 门禁规则类型定义 ==============

/**
 * 代码审核后门禁规则类型
 */
export type PostCRGateRuleType =
  | 'report_existence'     // 审核报告存在性检查
  | 'report_format'        // 报告格式有效性检查
  | 'verdict_validity'     // 审核结果有效性检查
  | 'checkpoint_sync'      // 检查点状态同步检查
  | 'test_env_config'      // 测试环境配置检查
  | 'timestamp_validity'   // 时间戳有效性检查
  | 'custom';              // 自定义规则

/**
 * 代码审核后门禁规则配置
 */
export interface PostCRGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PostCRGateRuleType;
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
 * 代码审核后门禁规则执行结果
 */
export interface PostCRGateRuleResult {
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
 * 代码审核后门禁决策结果
 */
export type PostCRGateDecision = 'POST_CR_PASS' | 'POST_CR_FAIL' | 'POST_CR_WARN';

/**
 * 代码审核后门禁运行结果
 */
export interface PostCRGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PostCRGateDecision;
  /** 是否允许进入QA阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PostCRGateRuleResult[];
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
  /** 代码审核报告路径 */
  reportPath?: string;
  /** 测试环境配置路径 */
  testEnvConfigPath?: string;
}

/**
 * 代码审核后门禁报告
 */
export interface PostCRGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PostCRGateRunResult;
  /** 建议 */
  recommendations: string[];
  /** 反馈循环项 */
  feedbackItems: FeedbackLoopItem[];
  /** 元数据 */
  metadata: {
    version: string;
    runnerVersion: string;
    rulesExecuted: number;
  };
}

/**
 * 反馈循环项
 */
export interface FeedbackLoopItem {
  /** 问题类型 */
  type: 'missing_test_env' | 'checkpoint_mismatch' | 'report_invalid' | 'other';
  /** 问题描述 */
  description: string;
  /** 建议操作 */
  suggestedAction: string;
  /** 目标阶段 */
  targetPhase: 'code_review' | 'development';
  /** 严重程度 */
  severity: 'error' | 'warning';
}

/**
 * 代码审核后门禁运行器配置
 */
export interface PostCRGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 规则列表 */
  rules: PostCRGateRule[];
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
  /** 代码审核报告路径模板 */
  codeReviewReportPath: string;
  /** 测试环境配置输出路径 */
  testEnvConfigPath: string;
  /** 是否启用反馈循环 */
  enableFeedbackLoop: boolean;
  /** 自定义规则处理器 */
  customRuleHandlers?: Map<string, PostCRGateRuleHandler>;
}

/**
 * 代码审核后门禁规则处理器函数类型
 */
export type PostCRGateRuleHandler = (
  task: TaskMeta,
  rule: PostCRGateRule,
  context: PostCRGateContext
) => Promise<PostCRGateRuleResult>;

/**
 * 代码审核后门禁上下文
 */
export interface PostCRGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 代码审核报告路径 */
  codeReviewReportPath: string;
  /** 测试环境配置路径 */
  testEnvConfigPath: string;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
}

/**
 * 代码审核报告结构
 */
export interface CodeReviewReport {
  /** 报告版本 */
  version: string;
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
  /** 问题列表 */
  issues?: CodeReviewIssue[];
  /** 建议列表 */
  recommendations?: string[];
}

/**
 * 代码审核问题项
 */
export interface CodeReviewIssue {
  /** 问题ID */
  id: string;
  /** 问题类型 */
  type: 'error' | 'warning' | 'suggestion';
  /** 问题描述 */
  description: string;
  /** 相关文件 */
  file?: string;
  /** 行号 */
  line?: number;
  /** 严重程度 */
  severity: 'high' | 'medium' | 'low';
}

/**
 * 测试环境配置
 */
export interface TestEnvConfig {
  /** 配置版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 测试环境配置 */
  environment: {
    /** 需要的测试命令 */
    testCommands: string[];
    /** 环境变量 */
    envVars: Record<string, string>;
    /** 依赖服务 */
    dependencies: string[];
  };
  /** 测试建议 */
  recommendations: string[];
}

// ============== 默认配置 ==============

/**
 * 默认代码审核后门禁规则
 */
export const DEFAULT_POST_CR_GATE_RULES: PostCRGateRule[] = [
  {
    id: 'R-CR-POST-001',
    type: 'report_existence',
    name: '审核报告存在性检查',
    description: '验证 code-review-report.json 是否存在',
    enabled: true,
    priority: 1,
    blocking: true,
  },
  {
    id: 'R-CR-POST-002',
    type: 'report_format',
    name: '报告格式有效性检查',
    description: '验证代码审核报告格式是否正确',
    enabled: true,
    priority: 2,
    blocking: true,
  },
  {
    id: 'R-CR-POST-003',
    type: 'verdict_validity',
    name: '审核结果有效性检查',
    description: '验证审核结果是 PASS 还是 NOPASS',
    enabled: true,
    priority: 3,
    blocking: true,
  },
  {
    id: 'R-CR-POST-004',
    type: 'verdict_validity',
    name: '审核原因完整性检查',
    description: '验证审核总结是否完整',
    enabled: true,
    priority: 4,
    blocking: false,
  },
  {
    id: 'R-CR-POST-005',
    type: 'verdict_validity',
    name: '问题项详情检查',
    description: '验证问题项是否有详情',
    enabled: true,
    priority: 5,
    blocking: false,
  },
  {
    id: 'R-CR-POST-006',
    type: 'checkpoint_sync',
    name: '检查点状态同步检查',
    description: '验证审核结果与检查点状态是否一致',
    enabled: true,
    priority: 6,
    blocking: false,
  },
  {
    id: 'R-CR-POST-007',
    type: 'timestamp_validity',
    name: '审核时间戳有效性检查',
    description: '验证审核时间戳是否有效',
    enabled: true,
    priority: 7,
    blocking: false,
  },
  {
    id: 'R-CR-POST-008',
    type: 'test_env_config',
    name: '测试环境配置存在性检查',
    description: '验证测试环境配置是否存在',
    enabled: true,
    priority: 8,
    blocking: false,
  },
  {
    id: 'R-CR-POST-009',
    type: 'test_env_config',
    name: '任务测试环境建议存在性检查',
    description: '验证任务是否有测试环境建议',
    enabled: true,
    priority: 9,
    blocking: false,
  },
  {
    id: 'R-CR-POST-010',
    type: 'test_env_config',
    name: '测试环境配置格式有效性检查',
    description: '验证测试环境配置格式是否正确',
    enabled: true,
    priority: 10,
    blocking: false,
  },
];

/**
 * 默认代码审核后门禁运行器配置
 */
export const DEFAULT_POST_CR_GATE_RUNNER_CONFIG: PostCRGateRunnerConfig = {
  enabled: true,
  rules: DEFAULT_POST_CR_GATE_RULES,
  stopOnFailure: false,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/post-cr-gate-report.json',
  codeReviewReportPath: '.projmnt4claude/outputs/{taskId}/code-review-report.json',
  testEnvConfigPath: '.projmnt4claude/outputs/{taskId}/tasks_test_env_adv.json',
  enableFeedbackLoop: true,
};

// ============== PostCRGateRunner 类 ==============

/**
 * 代码审核阶段后质量门禁运行器
 *
 * 统一管理和执行代码审核后质量门禁检查，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入QA阶段。
 */
export class PostCRGateRunner {
  private config: PostCRGateRunnerConfig;
  private customHandlers: Map<string, PostCRGateRuleHandler>;
  private cwd: string;

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PostCRGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map(config?.customRuleHandlers || []);

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PostCRGateRunnerConfig>): PostCRGateRunnerConfig {
    return {
      ...DEFAULT_POST_CR_GATE_RUNNER_CONFIG,
      ...config,
      rules: config?.rules ?? DEFAULT_POST_CR_GATE_RULES,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('report_existence', this.handleReportExistenceRule.bind(this));
    this.customHandlers.set('report_format', this.handleReportFormatRule.bind(this));
    this.customHandlers.set('verdict_validity', this.handleVerdictValidityRule.bind(this));
    this.customHandlers.set('checkpoint_sync', this.handleCheckpointSyncRule.bind(this));
    this.customHandlers.set('test_env_config', this.handleTestEnvConfigRule.bind(this));
    this.customHandlers.set('timestamp_validity', this.handleTimestampValidityRule.bind(this));
  }

  /**
   * 执行代码审核后门禁检查
   *
   * @param taskId 任务ID
   * @param options 可选参数
   * @returns 门禁运行结果
   */
  async run(taskId: string, options?: {
    codeReviewReportPath?: string;
    testEnvConfigPath?: string;
  }): Promise<PostCRGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'POST_CR_PASS',
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
        decision: 'POST_CR_FAIL',
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

    // 解析路径模板
    const codeReviewReportPath = options?.codeReviewReportPath ??
      this.config.codeReviewReportPath.replace('{taskId}', taskId);
    const testEnvConfigPath = options?.testEnvConfigPath ??
      this.config.testEnvConfigPath.replace('{taskId}', taskId);

    // 创建上下文
    const context: PostCRGateContext = {
      taskId,
      cwd: this.cwd,
      codeReviewReportPath,
      testEnvConfigPath,
      sharedData: new Map(),
    };

    // 按优先级排序规则
    const sortedRules = [...this.config.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    // 执行所有规则
    const ruleResults: PostCRGateRuleResult[] = [];
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
    const allowed = decision === 'POST_CR_PASS' || (decision === 'POST_CR_WARN' && blockingFailures === 0);

    const duration = Date.now() - startTime;
    const passedRules = ruleResults.filter(r => r.passed).length;
    const warningCount = ruleResults.filter(r => !r.passed && !this.isBlockingRule(r.ruleId)).length;

    const runResult: PostCRGateRunResult = {
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
      reportPath: codeReviewReportPath,
      testEnvConfigPath,
    };

    // 生成报告
    if (this.config.generateReport) {
      const report = this.generateReport(runResult, context);
      await this.saveReport(report);
    }

    return runResult;
  }

  /**
   * 执行单个规则
   */
  private async executeRule(
    task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
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
      result.ruleId = rule.id;
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
  private calculateDecision(results: PostCRGateRuleResult[], blockingFailures: number): PostCRGateDecision {
    if (blockingFailures > 0) {
      return 'POST_CR_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'POST_CR_PASS';
    }

    // 有非阻塞失败，返回警告
    return 'POST_CR_WARN';
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
   * R-CR-POST-001: 审核报告存在性检查
   */
  private async handleReportExistenceRule(
    _task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const reportPath = path.join(context.cwd, context.codeReviewReportPath);
    const exists = fs.existsSync(reportPath);

    return {
      ruleId: rule.id,
      passed: exists,
      ruleName: rule.name,
      message: exists
        ? `代码审核报告存在: ${context.codeReviewReportPath}`
        : `代码审核报告不存在: ${context.codeReviewReportPath}`,
      details: {
        reportPath: context.codeReviewReportPath,
        fullPath: reportPath,
        exists,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * R-CR-POST-002: 报告格式有效性检查
   */
  private async handleReportFormatRule(
    _task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const reportPath = path.join(context.cwd, context.codeReviewReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查报告格式: 报告文件不存在',
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const requiredFields = ['version', 'taskId', 'verdict', 'reviewedAt', 'reviewer', 'summary'];
      const missingFields = requiredFields.filter(field => !(field in report));

      const passed = missingFields.length === 0;

      return {
        ruleId: rule.id,
        passed,
        ruleName: rule.name,
        message: passed
          ? '代码审核报告格式有效'
          : `代码审核报告格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          reportPath: context.codeReviewReportPath,
          requiredFields,
          missingFields,
          hasIssues: !!report.issues && Array.isArray(report.issues),
          hasRecommendations: !!report.recommendations && Array.isArray(report.recommendations),
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `报告格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-CR-POST-003, 004, 005: 审核结果有效性检查
   */
  private async handleVerdictValidityRule(
    _task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const reportPath = path.join(context.cwd, context.codeReviewReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查审核结果: 报告文件不存在',
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      // R-CR-POST-003: 审核结果有效性
      if (rule.id === 'R-CR-POST-003') {
        const validVerdicts = ['PASS', 'NOPASS'];
        const isValid = validVerdicts.includes(report.verdict);

        return {
          ruleId: rule.id,
          passed: isValid,
          ruleName: rule.name,
          message: isValid
            ? `审核结果有效: ${report.verdict}`
            : `审核结果无效: ${report.verdict} (应为 PASS 或 NOPASS)`,
          details: {
            verdict: report.verdict,
            validVerdicts,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // R-CR-POST-004: 审核原因完整性
      if (rule.id === 'R-CR-POST-004') {
        const hasSummary = !!report.summary && report.summary.trim().length > 0;
        const isComplete = hasSummary && report.summary.trim().length >= 10;

        return {
          ruleId: rule.id,
          passed: isComplete,
          ruleName: rule.name,
          message: isComplete
            ? `审核原因完整 (${report.summary.length} 字符)`
            : `审核原因不完整: ${hasSummary ? '内容过短' : '缺少总结'}`,
          details: {
            hasSummary,
            summaryLength: report.summary?.length ?? 0,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // R-CR-POST-005: 问题项详情检查
      if (rule.id === 'R-CR-POST-005') {
        const hasIssues = !!report.issues && Array.isArray(report.issues);
        const issuesWithDetails = report.issues?.filter(issue =>
          issue.id && issue.type && issue.description && issue.severity
        ) ?? [];

        // 如果有问题，需要详情；如果没有问题，直接通过
        const passed = !hasIssues ||
          (report.issues!.length === 0) ||
          (issuesWithDetails.length === report.issues!.length);

        return {
          ruleId: rule.id,
          passed,
          ruleName: rule.name,
          message: passed
            ? `问题项详情完整 (${issuesWithDetails.length}/${report.issues?.length ?? 0})`
            : `问题项详情不完整: ${report.issues!.length - issuesWithDetails.length} 个问题缺少详情`,
          details: {
            totalIssues: report.issues?.length ?? 0,
            issuesWithDetails: issuesWithDetails.length,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `未知的审核结果检查规则: ${rule.id}`,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `审核结果检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-CR-POST-006: 检查点状态同步检查
   */
  private async handleCheckpointSyncRule(
    task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const reportPath = path.join(context.cwd, context.codeReviewReportPath);

    // 检查是否有代码审核相关的检查点
    const codeReviewCheckpoints = task.checkpoints?.filter(cp =>
      cp.description.toLowerCase().includes('review') ||
      cp.description.toLowerCase().includes('审核')
    ) ?? [];

    if (codeReviewCheckpoints.length === 0) {
      return {
        ruleId: rule.id,
        passed: true,
        ruleName: rule.name,
        message: '任务没有代码审核相关检查点，跳过同步检查',
        details: {
          totalCheckpoints: task.checkpoints?.length ?? 0,
          codeReviewCheckpoints: 0,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // 读取审核报告
    let reportVerdict: string | undefined;
    if (fs.existsSync(reportPath)) {
      try {
        const content = fs.readFileSync(reportPath, 'utf-8');
        const report = JSON.parse(content) as CodeReviewReport;
        reportVerdict = report.verdict;
      } catch {
        // 解析失败，继续检查
      }
    }

    // 检查检查点状态
    const completedCodeReviewCheckpoints = codeReviewCheckpoints.filter(cp =>
      cp.status === 'completed'
    );

    // 如果审核报告是 PASS，应该有完成的代码审核检查点
    const isSynced = reportVerdict === 'PASS'
      ? completedCodeReviewCheckpoints.length > 0 || codeReviewCheckpoints.length === 0
      : true; // NOPASS 不需要强制检查点完成

    return {
      ruleId: rule.id,
      passed: isSynced,
      ruleName: rule.name,
      message: isSynced
        ? `检查点状态同步 (${completedCodeReviewCheckpoints.length}/${codeReviewCheckpoints.length} 代码审核检查点完成)`
        : `检查点状态不同步: 审核结果为 PASS 但无完成的代码审核检查点`,
      details: {
        reportVerdict,
        totalCodeReviewCheckpoints: codeReviewCheckpoints.length,
        completedCodeReviewCheckpoints: completedCodeReviewCheckpoints.length,
        checkpoints: codeReviewCheckpoints.map(cp => ({
          id: cp.id,
          description: cp.description,
          status: cp.status,
        })),
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * R-CR-POST-007: 审核时间戳有效性检查
   */
  private async handleTimestampValidityRule(
    _task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const reportPath = path.join(context.cwd, context.codeReviewReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查时间戳: 报告文件不存在',
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as CodeReviewReport;

      const reviewedAt = report.reviewedAt;
      const reviewDate = new Date(reviewedAt);
      const now = new Date();
      const isValidDate = !isNaN(reviewDate.getTime());
      const isNotFuture = reviewDate <= now;

      const passed = isValidDate && isNotFuture;

      return {
        ruleId: rule.id,
        passed,
        ruleName: rule.name,
        message: passed
          ? `审核时间戳有效: ${reviewedAt}`
          : `审核时间戳无效: ${!isValidDate ? '无效日期格式' : '未来日期'}`,
        details: {
          reviewedAt,
          isValidDate,
          isNotFuture,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `时间戳检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath: context.codeReviewReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-CR-POST-008, 009, 010: 测试环境配置检查
   */
  private async handleTestEnvConfigRule(
    task: TaskMeta,
    rule: PostCRGateRule,
    context: PostCRGateContext
  ): Promise<PostCRGateRuleResult> {
    const configPath = path.join(context.cwd, context.testEnvConfigPath);

    // R-CR-POST-008: 测试环境配置存在性
    if (rule.id === 'R-CR-POST-008') {
      const exists = fs.existsSync(configPath);

      return {
        ruleId: rule.id,
        passed: exists,
        ruleName: rule.name,
        message: exists
          ? `测试环境配置存在: ${context.testEnvConfigPath}`
          : `测试环境配置不存在: ${context.testEnvConfigPath}`,
        details: {
          configPath: context.testEnvConfigPath,
          exists,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // R-CR-POST-009: 任务测试环境建议存在性
    if (rule.id === 'R-CR-POST-009') {
      // 从任务描述或合同文件中提取测试建议
      const hasTestEnvInDescription = /测试|test/i.test(task.description ?? '');

      // 检查是否有verificationCommands
      const hasVerificationCommands = task.checkpoints?.some(cp =>
        cp.verification?.commands && cp.verification.commands.length > 0
      );

      const hasRecommendations = hasTestEnvInDescription || hasVerificationCommands;

      return {
        ruleId: rule.id,
        passed: hasRecommendations,
        ruleName: rule.name,
        message: hasRecommendations
          ? '任务包含测试环境建议'
          : '任务缺少测试环境建议 (描述中没有测试相关内容或验证命令)',
        details: {
          hasTestEnvInDescription,
          hasVerificationCommands,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // R-CR-POST-010: 测试环境配置格式有效性
    if (rule.id === 'R-CR-POST-010') {
      if (!fs.existsSync(configPath)) {
        return {
          ruleId: rule.id,
          passed: false,
          ruleName: rule.name,
          message: '无法检查配置格式: 配置文件不存在',
          details: { configPath: context.testEnvConfigPath },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content) as TestEnvConfig;

        const requiredFields = ['version', 'taskId', 'generatedAt', 'environment', 'recommendations'];
        const missingFields = requiredFields.filter(field => !(field in config));

        const passed = missingFields.length === 0;

        return {
          ruleId: rule.id,
          passed,
          ruleName: rule.name,
          message: passed
            ? '测试环境配置格式有效'
            : `测试环境配置格式无效: 缺少字段 [${missingFields.join(', ')}]`,
          details: {
            configPath: context.testEnvConfigPath,
            requiredFields,
            missingFields,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        return {
          ruleId: rule.id,
          passed: false,
          ruleName: rule.name,
          message: `配置格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
          details: { configPath: context.testEnvConfigPath },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return {
      ruleId: rule.id,
      passed: false,
      ruleName: rule.name,
      message: `未知的测试环境配置规则: ${rule.id}`,
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // ============== 报告生成 ==============

  /**
   * 生成代码审核后门禁报告
   *
   * @param result 门禁运行结果
   * @param context 门禁上下文
   * @returns 门禁报告
   */
  generateReport(result: PostCRGateRunResult, context: PostCRGateContext): PostCRGateReport {
    const recommendations: string[] = [];
    const feedbackItems: FeedbackLoopItem[] = [];

    // 根据失败规则生成建议和反馈项
    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'R-CR-POST-001':
            recommendations.push('代码审核报告不存在: 请先生成代码审核报告');
            feedbackItems.push({
              type: 'report_invalid',
              description: '代码审核报告不存在',
              suggestedAction: '在代码审核阶段生成审核报告',
              targetPhase: 'code_review',
              severity: 'error',
            });
            break;
          case 'R-CR-POST-002':
            recommendations.push('代码审核报告格式无效: 检查报告文件格式');
            feedbackItems.push({
              type: 'report_invalid',
              description: '代码审核报告格式无效',
              suggestedAction: '修复审核报告格式',
              targetPhase: 'code_review',
              severity: 'error',
            });
            break;
          case 'R-CR-POST-003':
            recommendations.push('审核结果无效: 确保审核结果为 PASS 或 NOPASS');
            break;
          case 'R-CR-POST-004':
            recommendations.push('审核原因不完整: 添加详细的审核总结');
            break;
          case 'R-CR-POST-005':
            recommendations.push('问题项详情不完整: 为所有问题添加详细信息');
            break;
          case 'R-CR-POST-006':
            recommendations.push('检查点状态不同步: 同步审核结果与检查点状态');
            feedbackItems.push({
              type: 'checkpoint_mismatch',
              description: '审核结果与检查点状态不一致',
              suggestedAction: '更新检查点状态以匹配审核结果',
              targetPhase: 'code_review',
              severity: 'warning',
            });
            break;
          case 'R-CR-POST-007':
            recommendations.push('审核时间戳无效: 检查审核时间');
            break;
          case 'R-CR-POST-008':
            recommendations.push('测试环境配置不存在: 需要生成测试环境配置');
            feedbackItems.push({
              type: 'missing_test_env',
              description: '测试环境配置缺失',
              suggestedAction: '生成 tasks_test_env_adv.json 配置文件',
              targetPhase: 'code_review',
              severity: 'warning',
            });
            break;
          case 'R-CR-POST-009':
            recommendations.push('任务缺少测试环境建议: 在任务描述中添加测试相关信息');
            break;
          case 'R-CR-POST-010':
            recommendations.push('测试环境配置格式无效: 检查配置文件格式');
            break;
        }
      }
    }

    // 如果全部通过，给出正面反馈
    if (result.decision === 'POST_CR_PASS') {
      recommendations.push('✅ 代码审核后质量门禁通过，可以进入QA阶段');
    }

    return {
      reportId: `post-cr-gate-report-${result.taskId}-${Date.now()}`,
      taskId: result.taskId,
      generatedAt: new Date().toISOString(),
      result,
      recommendations,
      feedbackItems,
      metadata: {
        version: '1.0.0',
        runnerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
      },
    };
  }

  /**
   * 保存门禁报告
   */
  private async saveReport(report: PostCRGateReport): Promise<void> {
    if (!this.config.reportPath) return;

    const reportDir = path.dirname(path.join(this.cwd, this.config.reportPath));
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(this.cwd, this.config.reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * 格式化门禁结果为终端输出
   *
   * @param result 门禁运行结果
   * @returns 格式化字符串
   */
  formatResult(result: PostCRGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    // 决策图标
    const decisionIcon = result.decision === 'POST_CR_PASS' ? '✅' :
                        result.decision === 'POST_CR_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 代码审核后质量门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    // 决策结果
    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入QA阶段: ${result.allowed ? '是' : '否'}`);
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
  updateConfig(config: Partial<PostCRGateRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PostCRGateRunnerConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义规则处理器
   *
   * @param ruleType 规则类型
   * @param handler 处理器函数
   */
  registerRuleHandler(ruleType: string, handler: PostCRGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加规则
   *
   * @param rule 规则配置
   */
  addRule(rule: PostCRGateRule): void {
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
 * 创建代码审核后门禁运行器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PostCRGateRunner 实例
 */
export function createPostCRGateRunner(
  cwd: string,
  config?: Partial<PostCRGateRunnerConfig>
): PostCRGateRunner {
  return new PostCRGateRunner(cwd, config);
}

/**
 * 快速执行代码审核后门禁检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果
 */
export async function quickPostCRGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PostCRGateRunnerConfig>
): Promise<PostCRGateRunResult> {
  const runner = new PostCRGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行代码审核后门禁检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果列表
 */
export async function batchPostCRGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PostCRGateRunnerConfig>
): Promise<PostCRGateRunResult[]> {
  const runner = new PostCRGateRunner(cwd, config);
  const results: PostCRGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

/**
 * 生成测试环境配置
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param outputPath 输出路径
 * @returns 生成的配置路径
 */
export async function generateTestEnvConfig(
  taskId: string,
  cwd: string = process.cwd(),
  outputPath?: string
): Promise<string> {
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  const configPath = outputPath ??
    path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');

  // 从检查点提取验证命令
  const testCommands: string[] = [];
  for (const checkpoint of task.checkpoints ?? []) {
    if (checkpoint.verification?.commands) {
      testCommands.push(...checkpoint.verification.commands);
    }
  }

  // 如果检查点没有命令，使用默认值
  if (testCommands.length === 0) {
    testCommands.push('bun test');
    testCommands.push('bun run build');
  }

  const config: TestEnvConfig = {
    version: '1.0.0',
    taskId,
    generatedAt: new Date().toISOString(),
    environment: {
      testCommands: [...new Set(testCommands)], // 去重
      envVars: {
        NODE_ENV: 'test',
        TASK_ID: taskId,
      },
      dependencies: [],
    },
    recommendations: [
      '运行测试前确保依赖已安装: bun install',
      `执行测试命令: ${testCommands.join(', ')}`,
    ],
  };

  // 确保目录存在
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

export default PostCRGateRunner;
