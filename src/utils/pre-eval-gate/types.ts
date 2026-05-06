/**
 * Pre-Eval Gate Types
 * 评估阶段前门禁类型定义
 *
 * 对齐设计文档: docs/investigation/hd-p14-evaluation-pre-gate-design.md
 *
 * @module pre-eval-gate/types
 */

import type { TaskMeta, PhaseHistoryEntry } from '../../types/task.js';

// ============== QA报告结构 ==============

/**
 * QA报告结构 (从 post-qa-gate 复用)
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
  /** 测试覆盖率 */
  coverage?: number;
}

// ============== 检查上下文 ==============

/**
 * 评估前门禁检查上下文
 * 对齐设计文档 PreEvalCheckContext 接口
 */
export interface PreEvalCheckContext {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** 工作目录 */
  cwd: string;
  /** QA报告 (已解析) */
  qaReport?: QAReport;
}

// ============== 检查结果 ==============

/**
 * 失败等级
 */
export type PreEvalSeverity = 'ERROR' | 'WARNING';

/**
 * 单条规则检查结果
 */
export interface PreEvalCheckResult {
  /** 规则ID */
  ruleId: string;
  /** 是否通过 */
  passed: boolean;
  /** 失败等级 */
  severity: PreEvalSeverity;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

// ============== 检查器接口 ==============

/**
 * 评估前门禁检查器接口
 */
export interface IPreEvalChecker {
  /**
   * 执行检查
   * @param ctx 检查上下文
   * @returns 单个或多个检查结果
   */
  check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult | PreEvalCheckResult[]>;
}

// ============== 门禁运行结果 ==============

/**
 * 评估前门禁决策
 */
export type PreEvalGateDecision = 'PRE_EVAL_PASS' | 'PRE_EVAL_FAIL' | 'PRE_EVAL_WARN';

/**
 * 评估前门禁运行结果
 */
export interface PreEvalGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PreEvalGateDecision;
  /** 是否允许进入评估阶段 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PreEvalCheckResult[];
  /** 通过的规则数 */
  passedRules: number;
  /** 失败的规则数 */
  failedRules: number;
  /** 警告数 */
  warningCount: number;
  /** 阻塞失败数 (ERROR级别) */
  blockingFailures: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

// ============== 门禁报告 ==============

/**
 * 评估前门禁报告
 */
export interface PreEvalGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PreEvalGateRunResult;
  /** 建议 */
  recommendations: string[];
  /** 元数据 */
  metadata: {
    version: string;
    runnerVersion: string;
    rulesExecuted: number;
  };
}

// ============== 运行器配置 ==============

/**
 * 评估前门禁运行器配置
 */
export interface PreEvalGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
  /** QA报告路径模板 */
  qaReportPath: string;
  /** 阶段报告输出目录模板 */
  outputsPath: string;
}

// ============== 阶段报告结构 ==============

/**
 * 开发报告结构 (dev-report.json)
 */
export interface DevReport {
  version: string;
  taskId: string;
  verdict: string;
  generatedAt: string;
}

/**
 * 代码审核报告结构 (code-review-report.json)
 */
export interface CodeReviewReport {
  version: string;
  taskId: string;
  verdict: string;
  reviewedAt: string;
}
