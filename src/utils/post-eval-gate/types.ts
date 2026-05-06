/**
 * Post-Eval Gate Types
 * 评估阶段后门禁类型定义
 *
 * 对齐设计文档: docs/investigation/hd-p15-evaluation-post-gate-design.md
 *
 * @module post-eval-gate/types
 */

import type { TaskMeta } from '../../types/task.js';

// ============== 阶段报告结构 ==============

/**
 * 评估报告结构 (evaluation-report.json)
 */
export interface EvalReport {
  /** 报告版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 评估结果 */
  result: 'PASS' | 'NOPASS';
  /** 评估时间戳 */
  evaluatedAt: string;
  /** 评估人/系统 */
  evaluator: string;
  /** 评估总结 */
  summary: string;
  /** 评估日志 */
  evaluationLogs: string[];
  /** 建议列表 */
  recommendations?: string[];
}

/**
 * 开发报告结构 (dev-report.json)
 */
export interface DevReport {
  /** 报告版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 开发状态 */
  status: string;
  /** 生成时间 */
  generatedAt: string;
}

/**
 * 代码审核报告结构 (code-review-report.json)
 */
export interface CodeReviewReport {
  /** 报告版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 审核结果 */
  result: string;
  /** 审核时间 */
  reviewedAt: string;
}

/**
 * QA报告结构 (qa-report.json)
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
 * 评估后门禁检查上下文
 * 对齐设计文档 PostEvalCheckContext 接口
 */
export interface PostEvalCheckContext {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** 工作目录 */
  cwd: string;
  /** 评估报告 (已解析) */
  evalReport?: EvalReport;
  /** 开发报告 (已解析) */
  devReport?: DevReport;
  /** 代码审核报告 (已解析) */
  codeReviewReport?: CodeReviewReport;
  /** QA报告 (已解析) */
  qaReport?: QAReport;
}

// ============== 检查结果 ==============

/**
 * 失败等级
 */
export type PostEvalSeverity = 'ERROR' | 'WARNING';

/**
 * 单条规则检查结果
 */
export interface PostEvalCheckResult {
  /** 规则ID */
  ruleId: string;
  /** 是否通过 */
  passed: boolean;
  /** 失败等级 */
  severity: PostEvalSeverity;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

// ============== 检查器接口 ==============

/**
 * 评估后门禁检查器接口
 */
export interface IPostEvalChecker {
  /**
   * 执行检查
   * @param ctx 检查上下文
   * @returns 单个或多个检查结果
   */
  check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult | PostEvalCheckResult[]>;
}

// ============== 门禁运行结果 ==============

/**
 * 评估后门禁决策
 */
export type PostEvalGateDecision = 'POST_EVAL_PASS' | 'POST_EVAL_FAIL' | 'POST_EVAL_WARN';

/**
 * 评估后门禁运行结果
 */
export interface PostEvalGateRunResult {
  /** 任务ID */
  taskId: string;
  /** 门禁决策 */
  decision: PostEvalGateDecision;
  /** 是否允许标记任务完成 */
  allowed: boolean;
  /** 规则结果列表 */
  ruleResults: PostEvalCheckResult[];
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
 * 评估后门禁报告
 */
export interface PostEvalGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PostEvalGateRunResult;
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
 * 评估后门禁运行器配置
 */
export interface PostEvalGateRunnerConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 是否生成报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
  /** 阶段报告输出目录模板 */
  outputsPath: string;
}
