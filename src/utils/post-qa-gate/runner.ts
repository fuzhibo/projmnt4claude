/**
 * Post-QA Gate Runner
 * QA验证阶段后质量门禁运行器
 *
 * 职责:
 * - 编排QA验证后检查器的执行顺序
 * - 验证 qa-report.json 存在性和格式正确性
 * - 确认QA验证结果 (PASS/NOPASS) 的有效性
 * - 同步QA结果与检查点状态
 * - 收集待人工验证检查点
 * - 生成QA验证后质量门禁报告
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate/runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta, FailureType, QAFailureCategory } from '../../types/task.js';
import { readTaskMeta } from '../task.js';
import { QACheckpointSyncChecker } from './checkers/checkpoint-sync-checker.js';

// ============== 门禁规则类型定义 ==============

/**
 * QA验证后门禁规则类型
 * 对齐设计文档 hd-p13-qa-post-gate-design.md
 */
export type PostQAGateRuleType =
  | 'qa_report_existence'        // R-QA-POST-001: QA报告存在
  | 'qa_report_format'           // R-QA-POST-002: 报告格式有效
  | 'qa_verdict_validity'        // R-QA-POST-003: 测试结果有效
  | 'qa_failures_detail'         // R-QA-POST-004: 测试失败详情
  | 'human_verification_collect' // R-QA-POST-005: 人工验证状态收集
  | 'pipeline_exit_notify'       // R-QA-POST-005a: 人工验证汇总通知
  | 'checkpoint_sync'            // R-QA-POST-006: 检查点状态同步
  | 'test_coverage'              // R-QA-POST-007: 测试覆盖率达标
  | 'custom';                    // 自定义规则

/**
 * QA验证后门禁规则配置
 */
export interface PostQAGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PostQAGateRuleType;
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
   * Post-QA Gate 默认为 'B' 类（检查阶段输出质量）
   * 特殊: 覆盖率检查失败触发 QA 内部重试，而非链式回退
   */
  failureType?: FailureType;
  /** 规则配置参数 */
  config?: Record<string, unknown>;
}

/**
 * QA验证后门禁规则执行结果
 */
export interface PostQAGateRuleResult {
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
  /**
   * CP-5: 失败类型分类
   * 'A' = Task Foundation (中断流水线)
   * 'B' = Phase Artifact (QA内部重试)
   */
  failureType?: FailureType;
}

/**
 * QA验证后门禁决策结果
 */
export type PostQAGateDecision = 'POST_QA_PASS' | 'POST_QA_FAIL' | 'POST_QA_WARN';

/**
 * QA验证后门禁运行结果
 */
export interface PostQAGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PostQAGateDecision;
  /** 是否允许进入评估阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PostQAGateRuleResult[];
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
  /** QA报告路径 */
  qaReportPath?: string;
  /** 待人工验证检查点列表 */
  pendingHumanVerifications?: PendingHumanVerification[];
  /**
   * CP-5: 覆盖率缺口数据
   * 当覆盖率检查失败时，包含缺口信息供 QA 重试机制使用
   */
  coverageGapData?: {
    /** 当前覆盖率 */
    currentCoverage: number;
    /** 最小覆盖率阈值 */
    minCoverage: number;
    /** 覆盖率缺口 */
    gap: number;
    /** 缺口百分比字符串 */
    gapPercent: string;
    /** 覆盖率详情 */
    coverageDetails?: { lines: number; branches: number; functions: number; statements: number };
    /** 失败类型 */
    failureType: 'A' | 'B';
    /** 人类可读消息 */
    message: string;
  };
}

/**
 * 待人工验证检查点
 */
export interface PendingHumanVerification {
  /** 检查点ID */
  id: string;
  /** 检查点描述 */
  description: string;
  /** 所属任务ID */
  taskId: string;
}

/**
 * QA验证后门禁报告
 */
export interface PostQAGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PostQAGateRunResult;
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
  type: 'missing_qa_report' | 'qa_report_invalid' | 'checkpoint_mismatch' | 'test_failures' | 'human_verification_pending' | 'other';
  /** 问题描述 */
  description: string;
  /** 建议操作 */
  suggestedAction: string;
  /** 目标阶段 */
  targetPhase: 'qa_verification' | 'development';
  /** 严重程度 */
  severity: 'error' | 'warning';
}

/**
 * QA报告结构
 */
export interface QAReport {
  /** 报告版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** QA验证结果 */
  verdict: 'PASS' | 'NOPASS';
  /** 验证时间戳 */
  verifiedAt: string;
  /** 验证人/系统 */
  verifier: string;
  /** 验证总结 */
  summary: string;
  /** 测试失败列表 */
  testFailures?: QATestFailure[];
  /** 失败的检查点 */
  failedCheckpoints?: string[];
  /** 建议列表 */
  recommendations?: string[];
  /** 是否需要人工验证 */
  requiresHuman?: boolean;
  /** 人工验证检查点 */
  humanVerificationCheckpoints?: string[];
  /** 测试覆盖率 */
  coverage?: number;
}

/**
 * QA测试失败项
 */
export interface QATestFailure {
  /** 测试名称 */
  testName: string;
  /** 失败原因 */
  reason: string;
  /** 相关文件 */
  file?: string;
  /** 严重程度 */
  severity: 'high' | 'medium' | 'low';
}

/**
 * QA验证后门禁检查上下文 (对齐设计文档)
 *
 * 用于检查器级别的上下文传递
 */
export interface PostQACheckContext {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** 工作目录 */
  cwd: string;
  /** QA报告 (已解析) */
  qaReport?: QAReport;
}

/**
 * QA验证后门禁运行器配置
 */
export interface PostQAGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 规则列表 */
  rules: PostQAGateRule[];
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
  /** QA报告路径模板 */
  qaReportPath: string;
  /** 是否启用反馈循环 */
  enableFeedbackLoop: boolean;
  /** 自定义规则处理器 */
  customRuleHandlers?: Map<string, PostQAGateRuleHandler>;
}

/**
 * QA验证后门禁规则处理器函数类型
 */
export type PostQAGateRuleHandler = (
  task: TaskMeta,
  rule: PostQAGateRule,
  context: PostQAGateContext
) => Promise<PostQAGateRuleResult>;

/**
 * QA验证后门禁上下文 (运行器内部使用)
 */
export interface PostQAGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** QA报告路径 */
  qaReportPath: string;
  /** 共享数据 (用于规则间数据传递) */
  sharedData: Map<string, unknown>;
}

// ============== 默认配置 ==============

/**
 * 默认QA验证后门禁规则
 * 对齐设计文档: 8条规则 (R-QA-POST-001 ~ R-QA-POST-007 + R-QA-POST-005a)
 */
export const DEFAULT_POST_QA_GATE_RULES: PostQAGateRule[] = [
  {
    id: 'R-QA-POST-001',
    type: 'qa_report_existence',
    name: 'QA报告存在',
    description: '验证 qa-report.json 是否存在',
    enabled: true,
    priority: 1,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-POST-002',
    type: 'qa_report_format',
    name: '报告格式有效',
    description: '验证 qa-report.json 是否可解析为有效JSON',
    enabled: true,
    priority: 2,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-POST-003',
    type: 'qa_verdict_validity',
    name: '测试结果有效',
    description: '验证 result 是否为 PASS 或 NOPASS',
    enabled: true,
    priority: 3,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-POST-004',
    type: 'qa_failures_detail',
    name: '测试失败详情',
    description: 'NOPASS 时验证 testFailures 是否有详细记录',
    enabled: true,
    priority: 4,
    blocking: false,
    failureType: 'B',
  },
  {
    id: 'R-QA-POST-005',
    type: 'human_verification_collect',
    name: '人工验证状态收集',
    description: '收集 requiresHuman 的检查点状态到待人工验证列表',
    enabled: true,
    priority: 5,
    blocking: false,
    failureType: 'B',
  },
  {
    id: 'R-QA-POST-005a',
    type: 'pipeline_exit_notify',
    name: '人工验证汇总通知',
    description: '流水线退出前统一通知所有待人工验证任务',
    enabled: true,
    priority: 6,
    blocking: false,
    failureType: 'B',
  },
  {
    id: 'R-QA-POST-006',
    type: 'checkpoint_sync',
    name: '检查点状态同步',
    description: 'QA结果与检查点状态一致',
    enabled: true,
    priority: 7,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-POST-007',
    type: 'test_coverage',
    name: '测试覆盖率达标',
    description: 'coverage >= 阈值，覆盖率不足触发QA内部重试而非链式回退',
    enabled: true,
    priority: 8,
    blocking: true,
    failureType: 'B',
  },
];

/**
 * 默认QA验证后门禁运行器配置
 */
export const DEFAULT_POST_QA_GATE_RUNNER_CONFIG: PostQAGateRunnerConfig = {
  enabled: true,
  rules: DEFAULT_POST_QA_GATE_RULES,
  stopOnFailure: false,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/post-qa-gate-report.json',
  qaReportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
  enableFeedbackLoop: true,
};

// ============== PostQAGateRunner 类 ==============

/**
 * QA验证阶段后质量门禁运行器
 *
 * 统一管理和执行QA验证后质量门禁检查，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入评估阶段。
 *
 * 对齐设计文档 hd-p13-qa-post-gate-design.md，实现8条检测规则:
 * - R-QA-POST-001: QA报告存在 (ERROR)
 * - R-QA-POST-002: 报告格式有效 (ERROR)
 * - R-QA-POST-003: 测试结果有效 (ERROR)
 * - R-QA-POST-004: 测试失败详情 (WARNING)
 * - R-QA-POST-005: 人工验证状态收集 (INFO)
 * - R-QA-POST-005a: 人工验证汇总通知 (INFO)
 * - R-QA-POST-006: 检查点状态同步 (ERROR)
 * - R-QA-POST-007: 测试覆盖率达标 (WARNING)
 */
export class PostQAGateRunner {
  private config: PostQAGateRunnerConfig;
  private customHandlers: Map<string, PostQAGateRuleHandler>;
  private cwd: string;

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PostQAGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map(config?.customRuleHandlers || []);

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PostQAGateRunnerConfig>): PostQAGateRunnerConfig {
    return {
      ...DEFAULT_POST_QA_GATE_RUNNER_CONFIG,
      ...config,
      rules: config?.rules ?? DEFAULT_POST_QA_GATE_RULES,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('qa_report_existence', this.handleQAReportExistenceRule.bind(this));
    this.customHandlers.set('qa_report_format', this.handleQAReportFormatRule.bind(this));
    this.customHandlers.set('qa_verdict_validity', this.handleQAVerdictValidityRule.bind(this));
    this.customHandlers.set('qa_failures_detail', this.handleQAFailuresDetailRule.bind(this));
    this.customHandlers.set('human_verification_collect', this.handleHumanVerificationCollectRule.bind(this));
    this.customHandlers.set('pipeline_exit_notify', this.handlePipelineExitNotifyRule.bind(this));
    this.customHandlers.set('checkpoint_sync', this.handleCheckpointSyncRule.bind(this));
    this.customHandlers.set('test_coverage', this.handleTestCoverageRule.bind(this));
  }

  /**
   * 执行QA验证后门禁检查
   *
   * @param taskId 任务ID
   * @param options 可选参数
   * @returns 门禁运行结果
   */
  async run(taskId: string, options?: {
    qaReportPath?: string;
  }): Promise<PostQAGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'POST_QA_PASS',
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
        decision: 'POST_QA_FAIL',
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
    const qaReportPath = options?.qaReportPath ??
      this.config.qaReportPath.replace('{taskId}', taskId);

    // 创建上下文
    const context: PostQAGateContext = {
      taskId,
      cwd: this.cwd,
      qaReportPath,
      sharedData: new Map(),
    };

    // 按优先级排序规则
    const sortedRules = [...this.config.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    // 执行所有规则
    const ruleResults: PostQAGateRuleResult[] = [];
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
    const allowed = decision === 'POST_QA_PASS' || (decision === 'POST_QA_WARN' && blockingFailures === 0);

    const duration = Date.now() - startTime;
    const passedRules = ruleResults.filter(r => r.passed).length;
    const warningCount = ruleResults.filter(r => !r.passed && !this.isBlockingRule(r.ruleId)).length;

    // 获取待人工验证列表
    const pendingHumanVerifications = (context.sharedData.get('pendingHumanVerifications') ?? []) as PendingHumanVerification[];

    // CP-5: 获取覆盖率缺口数据（用于 QA 重试 prompt）
    const coverageGapData = context.sharedData.get('coverageGap') as PostQAGateRunResult['coverageGapData'];

    const runResult: PostQAGateRunResult = {
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
      qaReportPath,
      pendingHumanVerifications: pendingHumanVerifications.length > 0 ? pendingHumanVerifications : undefined,
      coverageGapData,
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
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
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
          failureType: rule.failureType ?? 'A',
          duration: Date.now() - startTime,
          timestamp,
        };
      }

      // 执行规则处理器
      const result = await handler(task, rule, context);
      result.duration = Date.now() - startTime;
      result.ruleId = rule.id;
      result.failureType = rule.failureType ?? (rule.blocking ? 'A' : 'B');
      return result;
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `规则执行失败: ${error instanceof Error ? error.message : String(error)}`,
        failureType: rule.failureType ?? 'A',
        duration: Date.now() - startTime,
        timestamp,
      };
    }
  }

  /**
   * 计算门禁决策
   */
  private calculateDecision(results: PostQAGateRuleResult[], blockingFailures: number): PostQAGateDecision {
    if (blockingFailures > 0) {
      return 'POST_QA_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'POST_QA_PASS';
    }

    // 有非阻塞失败，返回警告
    return 'POST_QA_WARN';
  }

  /**
   * 判断是否为阻塞规则
   */
  private isBlockingRule(ruleId: string): boolean {
    const rule = this.config.rules.find(r => r.id === ruleId);
    return rule?.blocking ?? false;
  }

  // ============== CP-4/CP-6: QA 门禁失败分类 ==============

  /**
   * CP-4: Classify QA gate failure into categories for retry routing
   *
   * Coverage issues → 'coverage_retry' (QA internal retry)
   * Functional issues → 'chain_rollback' (chain rollback: QA → CR → Dev)
   * No failure → 'none'
   *
   * @param result - Post-QA gate run result
   * @returns QAFailureCategory classification
   */
  classifyQAFailureCategory(result: PostQAGateRunResult): QAFailureCategory {
    if (result.decision === 'POST_QA_PASS') {
      return 'none';
    }

    // Check for coverage-related failures (R-QA-POST-007: test_coverage)
    const coverageFailure = result.ruleResults.find(
      r => !r.passed && r.failureType === 'B' && r.ruleId === 'R-QA-POST-007'
    );

    // If coverage failure exists and we have gap data → coverage_retry
    if (coverageFailure && result.coverageGapData) {
      return 'coverage_retry';
    }

    // All other failures → chain_rollback
    const hasFailures = result.ruleResults.some(r => !r.passed);
    if (hasFailures) {
      return 'chain_rollback';
    }

    return 'none';
  }

  /**
   * CP-6: Classify QA gate failure with detailed retry information
   *
   * 覆盖率问题触发 QA 内部重试，功能性问题触发链式回退
   *
   * - 覆盖率问题 (failureType: B, ruleType: test_coverage) → QA 内部重试
   * - 功能性问题 (failureType: A) → 链式回退 (QA → CR → Dev)
   * - 其他 B 类问题 → 链式回退到阶段起点
   *
   * @deprecated Use classifyQAFailureCategory for simple category check
   */
  classifyQAGateFailure(result: PostQAGateRunResult): {
    /** 是否需要 QA 内部重试（覆盖率问题） */
    needsQARetry: boolean;
    /** 是否需要链式回退（功能性问题） */
    needsChainRollback: boolean;
    /** 失败分类 */
    failureCategory: QAFailureCategory;
    /** 覆盖率缺口数据（仅覆盖率重试时有值） */
    coverageGapData?: PostQAGateRunResult['coverageGapData'];
    /** QA 重试 prompt（仅覆盖率重试时有值） */
    qaRetryPrompt?: string;
  } {
    const category = this.classifyQAFailureCategory(result);

    if (category === 'none') {
      return { needsQARetry: false, needsChainRollback: false, failureCategory: 'none' };
    }

    if (category === 'coverage_retry' && result.coverageGapData) {
      const prompt = this.generateQARetryPrompt(result.coverageGapData);
      return {
        needsQARetry: true,
        needsChainRollback: false,
        failureCategory: 'coverage_retry',
        coverageGapData: result.coverageGapData,
        qaRetryPrompt: prompt,
      };
    }

    // chain_rollback
    return { needsQARetry: false, needsChainRollback: true, failureCategory: 'chain_rollback' };
  }

  /**
   * CP-5: 生成 QA 重试 prompt
   *
   * 包含覆盖率缺口数据，让 QA 根据覆盖率要求扩展测试用例
   */
  generateQARetryPrompt(gapData: NonNullable<PostQAGateRunResult['coverageGapData']>): string {
    const lines: string[] = [];

    lines.push('覆盖率门禁未通过，需要扩展测试用例。');
    lines.push('');
    lines.push(`当前覆盖率: ${(gapData.currentCoverage * 100).toFixed(1)}%`);
    lines.push(`阈值要求: ${(gapData.minCoverage * 100).toFixed(0)}%`);
    lines.push(`覆盖率缺口: ${gapData.gapPercent}`);
    lines.push('');

    if (gapData.coverageDetails) {
      const d = gapData.coverageDetails;
      lines.push('覆盖率详情:');
      lines.push(`  行覆盖率: ${(d.lines * 100).toFixed(1)}%`);
      lines.push(`  分支覆盖率: ${(d.branches * 100).toFixed(1)}%`);
      lines.push(`  函数覆盖率: ${(d.functions * 100).toFixed(1)}%`);
      lines.push(`  语句覆盖率: ${(d.statements * 100).toFixed(1)}%`);
      lines.push('');

      // 找出最低覆盖率维度，给出针对性建议
      const dimensions = [
        { name: '行覆盖率', value: d.lines },
        { name: '分支覆盖率', value: d.branches },
        { name: '函数覆盖率', value: d.functions },
        { name: '语句覆盖率', value: d.statements },
      ].sort((a, b) => a.value - b.value);

      lines.push(`最低覆盖率维度: ${dimensions[0].name} (${(dimensions[0].value * 100).toFixed(1)}%)`);
      lines.push('建议优先补充该维度的测试用例。');
    }

    lines.push('');
    lines.push('请扩展测试用例，覆盖上述未覆盖的代码路径。');

    return lines.join('\n');
  }

  // ============== 内置规则处理器 ==============

  /**
   * R-QA-POST-001: QA报告存在性检查
   * 等级: ERROR (阻塞)
   */
  private async handleQAReportExistenceRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);
    const exists = fs.existsSync(reportPath);

    return {
      ruleId: rule.id,
      passed: exists,
      ruleName: rule.name,
      message: exists
        ? `QA报告存在: ${context.qaReportPath}`
        : `QA报告不存在: ${context.qaReportPath}`,
      details: {
        reportPath: context.qaReportPath,
        fullPath: reportPath,
        exists,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * R-QA-POST-002: 报告格式有效性检查
   * 等级: ERROR (阻塞)
   * 验证 qa-report.json 是否可解析为有效JSON
   */
  private async handleQAReportFormatRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查QA报告格式: 报告文件不存在',
        details: { reportPath: context.qaReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      const requiredFields = ['version', 'taskId', 'verdict', 'verifiedAt', 'verifier', 'summary'];
      const missingFields = requiredFields.filter(field => !(field in report));

      const passed = missingFields.length === 0;

      return {
        ruleId: rule.id,
        passed,
        ruleName: rule.name,
        message: passed
          ? 'QA报告格式有效'
          : `QA报告格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          reportPath: context.qaReportPath,
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
        message: `QA报告格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath: context.qaReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-QA-POST-003: 测试结果有效性检查
   * 等级: ERROR (阻塞)
   * 验证 result ∈ {PASS, NOPASS}
   */
  private async handleQAVerdictValidityRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查QA验证结果: 报告文件不存在',
        details: { reportPath: context.qaReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      const validVerdicts = ['PASS', 'NOPASS'];
      const isValid = validVerdicts.includes(report.verdict);

      return {
        ruleId: rule.id,
        passed: isValid,
        ruleName: rule.name,
        message: isValid
          ? `QA验证结果有效: ${report.verdict}`
          : `QA验证结果无效: ${report.verdict} (应为 PASS 或 NOPASS)`,
        details: {
          verdict: report.verdict,
          validVerdicts,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `QA验证结果检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { reportPath: context.qaReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-QA-POST-004: 测试失败详情检查
   * 等级: WARNING (非阻塞)
   * NOPASS 时验证 testFailures 是否有详细记录
   */
  private async handleQAFailuresDetailRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);

    if (!fs.existsSync(reportPath)) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: '无法检查测试失败详情: 报告文件不存在',
        details: { reportPath: context.qaReportPath },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content) as QAReport;

      // PASS 时无需检查测试失败详情
      if (report.verdict === 'PASS') {
        return {
          ruleId: rule.id,
          passed: true,
          ruleName: rule.name,
          message: 'QA结果为PASS，无需检查测试失败详情',
          details: { verdict: report.verdict },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // NOPASS 时检查 testFailures 是否存在且有详细信息
      const hasTestFailures = !!report.testFailures && Array.isArray(report.testFailures);

      if (!hasTestFailures || report.testFailures!.length === 0) {
        return {
          ruleId: rule.id,
          passed: false,
          ruleName: rule.name,
          message: 'QA结果为NOPASS但缺少测试失败详情',
          details: { verdict: report.verdict, hasTestFailures },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // 检查每个失败项是否有详细信息
      const failuresWithDetails = report.testFailures!.filter(f =>
        f.testName && f.reason && f.severity
      );

      const passed = failuresWithDetails.length === report.testFailures!.length;

      return {
        ruleId: rule.id,
        passed,
        ruleName: rule.name,
        message: passed
          ? `测试失败文档完整 (${failuresWithDetails.length}/${report.testFailures!.length})`
          : `测试失败文档不完整: ${report.testFailures!.length - failuresWithDetails.length} 个失败项缺少详情`,
        details: {
          totalFailures: report.testFailures!.length,
          failuresWithDetails: failuresWithDetails.length,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        passed: false,
        ruleName: rule.name,
        message: `测试失败详情检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * R-QA-POST-005: 人工验证状态收集
   * 等级: INFO (非阻塞，不阻断任务)
   *
   * 收集 requiresHuman 的检查点状态到待人工验证列表。
   * 不阻塞任务执行，只收集需要人工验证的检查点到待验证列表。
   */
  private async handleHumanVerificationCollectRule(
    task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);

    // 读取QA报告
    let qaReport: QAReport | undefined;
    if (fs.existsSync(reportPath)) {
      try {
        const content = fs.readFileSync(reportPath, 'utf-8');
        qaReport = JSON.parse(content) as QAReport;
      } catch {
        // 解析失败，继续收集
      }
    }

    // 收集需要人工验证但未完成的检查点
    const pendingHuman: PendingHumanVerification[] = [];

    for (const cp of task.checkpoints || []) {
      if (cp.requiresHuman && cp.status !== 'completed') {
        // 检查是否在 humanVerificationCheckpoints 中
        const verified = qaReport?.humanVerificationCheckpoints?.includes(cp.id);
        if (!verified) {
          pendingHuman.push({
            id: cp.id,
            description: cp.description,
            taskId: context.taskId,
          });
        }
      }
    }

    // 将待人工验证列表写入共享数据，供 R-QA-POST-005a 使用
    if (pendingHuman.length > 0) {
      context.sharedData.set('pendingHumanVerifications', pendingHuman);
    }

    return {
      ruleId: rule.id,
      passed: true, // 不阻断，只收集
      ruleName: rule.name,
      message: pendingHuman.length === 0
        ? '无待人工验证检查点'
        : `已收集 ${pendingHuman.length} 个待人工验证检查点`,
      details: {
        pendingHumanVerifications: pendingHuman,
        willNotifyAtPipelineExit: pendingHuman.length > 0,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * R-QA-POST-005a: 人工验证汇总通知
   * 等级: INFO (非阻塞)
   *
   * 在所有任务执行完成后，统一汇总所有待人工验证的检查点并通知用户。
   * 生成格式化的通知消息，便于用户了解需要手动处理的检查点。
   */
  private async handlePipelineExitNotifyRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    // 从共享数据获取 R-QA-POST-005 收集的待人工验证列表
    const pendingList = (context.sharedData.get('pendingHumanVerifications') ?? []) as PendingHumanVerification[];

    if (pendingList.length === 0) {
      return {
        ruleId: rule.id,
        passed: true,
        ruleName: rule.name,
        message: '无待人工验证检查点，跳过通知',
        details: { pendingCount: 0 },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // 按任务分组
    const groupedByTask = new Map<string, PendingHumanVerification[]>();
    for (const item of pendingList) {
      const existing = groupedByTask.get(item.taskId) || [];
      existing.push(item);
      groupedByTask.set(item.taskId, existing);
    }

    // 生成通知摘要
    const notificationSummary = this.formatHumanVerificationNotification(groupedByTask);

    return {
      ruleId: rule.id,
      passed: true, // INFO级别，不阻断
      ruleName: rule.name,
      message: `已生成待人工验证通知: ${pendingList.length} 个检查点待验证`,
      details: {
        pendingCount: pendingList.length,
        taskCount: groupedByTask.size,
        notificationSummary,
        pendingItems: pendingList,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 格式化待人工验证通知
   */
  private formatHumanVerificationNotification(
    groupedByTask: Map<string, PendingHumanVerification[]>
  ): string {
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

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`总计: ${Array.from(groupedByTask.values()).flat().length} 个检查点待人工验证`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return lines.join('\n');
  }

  /**
   * R-QA-POST-006: 检查点状态同步检查
   * 等级: ERROR (阻塞)
   * QA结果与检查点状态一致
   *
   * 委托给 QACheckpointSyncChecker 实现
   */
  private async handleCheckpointSyncRule(
    task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const syncChecker = new QACheckpointSyncChecker(context.cwd, {
      reportPath: this.config.qaReportPath,
    });

    const result = await syncChecker.check(context.taskId, task.checkpoints ?? []);

    return {
      ruleId: rule.id,
      passed: result.passed,
      ruleName: rule.name,
      message: result.message,
      details: result.details,
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * R-QA-POST-007: 测试覆盖率达标检查
   * 等级: ERROR (阻塞) - CP-4: 改为 blocking: true
   * 覆盖率 >= 阈值 (默认60%)
   *
   * CP-5: 覆盖率缺口数据存储在 sharedData 中，供 QA 重试机制使用
   *
   * 覆盖率来源优先级:
   * 1. qa-report.json 中的 coverage 字段
   * 2. 测试框架生成的覆盖率报告 (coverage-summary.json)
   *
   * 综合覆盖率计算 (加权平均):
   * coverage = (lineCov * 0.4) + (branchCov * 0.3) + (funcCov * 0.2) + (stmtCov * 0.1)
   */
  private async handleTestCoverageRule(
    _task: TaskMeta,
    rule: PostQAGateRule,
    context: PostQAGateContext
  ): Promise<PostQAGateRuleResult> {
    const reportPath = path.join(context.cwd, context.qaReportPath);
    const minCoverage = (rule.config?.minCoverage as number) ?? 0.6; // 默认60%

    // 尝试从 qa-report.json 获取覆盖率
    let coverage: number | undefined;
    let coverageDetails: { lines: number; branches: number; functions: number; statements: number } | undefined;

    if (fs.existsSync(reportPath)) {
      try {
        const content = fs.readFileSync(reportPath, 'utf-8');
        const report = JSON.parse(content) as QAReport;
        coverage = report.coverage;
      } catch {
        // 解析失败，继续
      }
    }

    // 如果 qa-report.json 中没有覆盖率，从覆盖率报告文件计算
    if (coverage === undefined) {
      const result = await this.calculateCoverageFromReportsWithDetails(context);
      coverage = result.coverage;
      coverageDetails = result.details;
    }

    const passed = coverage >= minCoverage;
    const gap = passed ? 0 : minCoverage - coverage!;

    // CP-5: 将覆盖率缺口数据存储在 sharedData 中，供 QA 重试机制使用
    if (!passed) {
      context.sharedData.set('coverageGap', {
        currentCoverage: coverage,
        minCoverage,
        gap,
        gapPercent: `${(gap * 100).toFixed(1)}%`,
        coverageDetails,
        failureType: 'B', // 覆盖率问题触发 QA 内部重试
        message: `当前覆盖率: ${(coverage! * 100).toFixed(1)}%，阈值要求: ${(minCoverage * 100).toFixed(0)}%，缺口: ${(gap * 100).toFixed(1)}%`,
      });
    }

    return {
      ruleId: rule.id,
      passed,
      ruleName: rule.name,
      message: passed
        ? `测试覆盖率达标: ${(coverage! * 100).toFixed(1)}% >= ${(minCoverage * 100).toFixed(0)}%`
        : `测试覆盖率未达标: ${(coverage! * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(0)}%`,
      details: {
        coverage,
        minCoverage,
        coveragePercent: `${(coverage! * 100).toFixed(1)}%`,
        thresholdPercent: `${(minCoverage * 100).toFixed(0)}%`,
        gap: gap,
        gapPercent: `${(gap * 100).toFixed(1)}%`,
        coverageDetails,
        failureType: 'B',
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 从测试框架报告计算综合覆盖率
   */
  private async calculateCoverageFromReports(context: PostQAGateContext): Promise<number> {
    const result = await this.calculateCoverageFromReportsWithDetails(context);
    return result.coverage;
  }

  /**
   * 从测试框架报告计算综合覆盖率（带详细信息）
   * CP-5: 返回覆盖率详情，用于 QA 重试 prompt
   */
  private async calculateCoverageFromReportsWithDetails(context: PostQAGateContext): Promise<{
    coverage: number;
    details?: { lines: number; branches: number; functions: number; statements: number };
  }> {
    const coverageFiles = [
      path.join(context.cwd, 'coverage', 'coverage-summary.json'),
      path.join(context.cwd, 'coverage', 'lcov-report', 'coverage-summary.json'),
      path.join(context.cwd, '.projmnt4claude', 'outputs', context.taskId, 'coverage-report.json'),
    ];

    for (const filePath of coverageFiles) {
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const raw = this.parseCoverageData(content);
          // 加权平均
          const coverage = Math.round(
            (raw.lines * 0.4 + raw.branches * 0.3 + raw.functions * 0.2 + raw.statements * 0.1) * 1000
          ) / 1000;
          return {
            coverage,
            details: raw,
          };
        } catch {
          // 解析失败，尝试下一个文件
        }
      }
    }

    return { coverage: 0 }; // 默认返回0
  }

  /**
   * 解析覆盖率数据
   */
  private parseCoverageData(content: Record<string, unknown>): {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  } {
    const total = content.total as Record<string, Record<string, number>> | undefined;
    if (total) {
      return {
        lines: (total.lines?.pct ?? 0) / 100,
        branches: (total.branches?.pct ?? 0) / 100,
        functions: (total.functions?.pct ?? 0) / 100,
        statements: (total.statements?.pct ?? 0) / 100,
      };
    }

    return {
      lines: ((content as Record<string, Record<string, number>>).lines?.pct ?? 0) / 100,
      branches: ((content as Record<string, Record<string, number>>).branches?.pct ?? 0) / 100,
      functions: ((content as Record<string, Record<string, number>>).functions?.pct ?? 0) / 100,
      statements: ((content as Record<string, Record<string, number>>).statements?.pct ?? 0) / 100,
    };
  }

  // ============== 报告生成 ==============

  /**
   * 生成QA验证后门禁报告
   *
   * @param result 门禁运行结果
   * @param context 门禁上下文
   * @returns 门禁报告
   */
  generateReport(result: PostQAGateRunResult, context: PostQAGateContext): PostQAGateReport {
    const recommendations: string[] = [];
    const feedbackItems: FeedbackLoopItem[] = [];

    // 根据失败规则生成建议和反馈项
    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'R-QA-POST-001':
            recommendations.push('QA报告不存在: 请先生成QA验证报告');
            feedbackItems.push({
              type: 'missing_qa_report',
              description: 'QA报告不存在',
              suggestedAction: '在QA验证阶段生成QA报告',
              targetPhase: 'qa_verification',
              severity: 'error',
            });
            break;
          case 'R-QA-POST-002':
            recommendations.push('QA报告格式无效: 检查报告文件格式');
            feedbackItems.push({
              type: 'qa_report_invalid',
              description: 'QA报告格式无效',
              suggestedAction: '修复QA报告格式',
              targetPhase: 'qa_verification',
              severity: 'error',
            });
            break;
          case 'R-QA-POST-003':
            recommendations.push('QA验证结果无效: 确保验证结果为 PASS 或 NOPASS');
            break;
          case 'R-QA-POST-004':
            recommendations.push('测试失败详情不完整: 为所有失败项添加详细信息');
            feedbackItems.push({
              type: 'test_failures',
              description: '测试失败文档不完整',
              suggestedAction: '补充测试失败项的详细信息',
              targetPhase: 'qa_verification',
              severity: 'warning',
            });
            break;
          case 'R-QA-POST-006':
            recommendations.push('检查点状态不同步: 同步QA结果与检查点状态');
            feedbackItems.push({
              type: 'checkpoint_mismatch',
              description: 'QA结果与检查点状态不一致',
              suggestedAction: '更新检查点状态以匹配QA结果',
              targetPhase: 'qa_verification',
              severity: 'warning',
            });
            break;
          case 'R-QA-POST-007':
            recommendations.push('测试覆盖率未达标: 增加测试用例提高覆盖率');
            break;
        }
      }
    }

    // 如果有待人工验证检查点，添加建议
    if (result.pendingHumanVerifications && result.pendingHumanVerifications.length > 0) {
      recommendations.push(`有 ${result.pendingHumanVerifications.length} 个检查点需要人工验证`);
      feedbackItems.push({
        type: 'human_verification_pending',
        description: `${result.pendingHumanVerifications.length} 个检查点待人工验证`,
        suggestedAction: '请在流水线退出前完成人工验证',
        targetPhase: 'qa_verification',
        severity: 'warning',
      });
    }

    // 如果全部通过，给出正面反馈
    if (result.decision === 'POST_QA_PASS') {
      recommendations.push('QA验证后质量门禁通过，可以进入评估阶段');
    }

    return {
      reportId: `post-qa-gate-report-${result.taskId}-${Date.now()}`,
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
  private async saveReport(report: PostQAGateReport): Promise<void> {
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
  formatResult(result: PostQAGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    // 决策图标
    const decisionIcon = result.decision === 'POST_QA_PASS' ? '✅' :
                        result.decision === 'POST_QA_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} QA验证后质量门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    // 决策结果
    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入评估阶段: ${result.allowed ? '是' : '否'}`);
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

    // 待人工验证通知
    if (result.pendingHumanVerifications && result.pendingHumanVerifications.length > 0) {
      lines.push('🔔 待人工验证检查点:');
      for (const item of result.pendingHumanVerifications) {
        lines.push(`   - ${item.id}: ${item.description}`);
      }
      lines.push('');
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
  updateConfig(config: Partial<PostQAGateRunnerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PostQAGateRunnerConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义规则处理器
   *
   * @param ruleType 规则类型
   * @param handler 处理器函数
   */
  registerRuleHandler(ruleType: string, handler: PostQAGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加规则
   *
   * @param rule 规则配置
   */
  addRule(rule: PostQAGateRule): void {
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
 * 创建QA验证后门禁运行器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns PostQAGateRunner 实例
 */
export function createPostQAGateRunner(
  cwd: string,
  config?: Partial<PostQAGateRunnerConfig>
): PostQAGateRunner {
  return new PostQAGateRunner(cwd, config);
}

/**
 * 快速执行QA验证后门禁检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果
 */
export async function quickPostQAGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PostQAGateRunnerConfig>
): Promise<PostQAGateRunResult> {
  const runner = new PostQAGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行QA验证后门禁检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 门禁运行结果列表
 */
export async function batchPostQAGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PostQAGateRunnerConfig>
): Promise<PostQAGateRunResult[]> {
  const runner = new PostQAGateRunner(cwd, config);
  const results: PostQAGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PostQAGateRunner;
