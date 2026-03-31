/**
 * Harness Design 模式相关类型定义
 *
 * 基于 Anthropic 的 Harness Design 模式：
 * - 三代理架构：Planner → Generator → Evaluator
 * - 上下文重置：开发者和评估者之间隔离上下文
 * - Sprint Contract：开发前定义"完成"标准
 */

import type { TaskMeta, TaskStatus, TaskRole, CheckpointCategory } from './task.js';

/**
 * Harness 执行配置
 */
export interface HarnessConfig {
  /** 最大重试次数，默认 3 */
  maxRetries: number;
  /** 单任务超时（秒），默认 300 */
  timeout: number;
  /** 并行执行数，默认 1（串行） */
  parallel: number;
  /** 试运行模式，不实际执行 */
  dryRun: boolean;
  /** 计划文件路径 */
  planFile?: string;
  /** 从中断处继续 */
  continue: boolean;
  /** JSON 格式输出 */
  jsonOutput: boolean;
  /** 工作目录 */
  cwd: string;
  /** API 调用重试次数（针对 429/500 等临时错误），默认 3 */
  apiRetryAttempts: number;
  /** API 重试基础延迟（秒），默认 60，使用指数退避 */
  apiRetryDelay: number;
}

/**
 * 默认配置
 */
export const DEFAULT_HARNESS_CONFIG: Omit<HarnessConfig, 'cwd'> = {
  maxRetries: 3,
  timeout: 300,
  parallel: 1,
  dryRun: false,
  continue: false,
  jsonOutput: false,
  apiRetryAttempts: 3,
  apiRetryDelay: 60,
};

/**
 * Sprint Contract - 开发者和评估者之间的协议
 * 定义"完成"的标准
 */
export interface SprintContract {
  /** 任务ID */
  taskId: string;
  /** 验收标准列表 */
  acceptanceCriteria: string[];
  /** 验证命令列表 */
  verificationCommands: string[];
  /** 检查点ID列表 */
  checkpoints: string[];
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 开发阶段状态
 */
export type DevPhaseStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout';

/**
 * 开发阶段报告
 */
export interface DevReport {
  /** 任务ID */
  taskId: string;
  /** 执行状态 */
  status: DevPhaseStatus;
  /** 代码变更列表 */
  changes: string[];
  /** 证据文件路径列表 */
  evidence: string[];
  /** 完成的检查点ID列表 */
  checkpointsCompleted: string[];
  /** 执行开始时间 */
  startTime: string;
  /** 执行结束时间 */
  endTime: string;
  /** 执行时长（毫秒） */
  duration: number;
  /** 错误信息（如有） */
  error?: string;
  /** Claude 会话输出 */
  claudeOutput?: string;
}

/**
 * 审查结果
 */
export type ReviewResult = 'PASS' | 'NOPASS';

/**
 * 审查阶段报告
 */
export interface ReviewVerdict {
  /** 任务ID */
  taskId: string;
  /** 审查结果 */
  result: ReviewResult;
  /** 结果原因说明 */
  reason: string;
  /** 未通过的验收标准 */
  failedCriteria: string[];
  /** 未通过的检查点 */
  failedCheckpoints: string[];
  /** 审查时间 */
  reviewedAt: string;
  /** 审查者（通常是独立的 Claude 会话） */
  reviewedBy: string;
  /** 详细反馈 */
  details?: string;
}

/**
 * 代码审核阶段结果
 * 由 HarnessCodeReviewer 生成
 */
export interface CodeReviewVerdict {
  /** 任务ID */
  taskId: string;
  /** 审核结果 */
  result: ReviewResult;
  /** 结果原因说明 */
  reason: string;
  /** 代码质量问题列表 */
  codeQualityIssues: string[];
  /** 未通过的代码审核检查点 */
  failedCheckpoints: string[];
  /** 审核时间 */
  reviewedAt: string;
  /** 审核者角色 */
  reviewedBy: 'code_reviewer';
  /** 详细反馈 */
  details?: string;
}

/**
 * QA 验证阶段结果
 * 由 HarnessQATester 生成
 */
export interface QAVerdict {
  /** 任务ID */
  taskId: string;
  /** 验证结果 */
  result: ReviewResult;
  /** 结果原因说明 */
  reason: string;
  /** 测试失败列表 */
  testFailures: string[];
  /** 未通过的 QA 检查点 */
  failedCheckpoints: string[];
  /** 是否需要人工验证 */
  requiresHuman: boolean;
  /** 需要人工验证的检查点 */
  humanVerificationCheckpoints: string[];
  /** 验证时间 */
  verifiedAt: string;
  /** 验证者角色 */
  verifiedBy: 'qa_tester';
  /** 详细反馈 */
  details?: string;
}

/**
 * 人工验证阶段结果
 * 由 HarnessHumanVerifier 生成
 */
export interface HumanVerdict {
  /** 任务ID */
  taskId: string;
  /** 验证结果 */
  result: ReviewResult;
  /** 结果原因说明 */
  reason: string;
  /** 验证的检查点ID */
  checkpointId: string;
  /** 验证人（用户） */
  verifiedBy: string;
  /** 验证时间 */
  verifiedAt: string;
  /** 用户反馈 */
  userFeedback?: string;
}

/**
 * 任务执行记录
 */
export interface TaskExecutionRecord {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** Sprint Contract */
  contract: SprintContract;
  /** 开发报告 */
  devReport: DevReport;
  /** 代码审核结果 */
  codeReviewVerdict?: CodeReviewVerdict;
  /** QA 验证结果 */
  qaVerdict?: QAVerdict;
  /** 人工验证结果列表 */
  humanVerdicts?: HumanVerdict[];
  /** 审查结果 */
  reviewVerdict?: ReviewVerdict;
  /** 重试次数 */
  retryCount: number;
  /** 最终状态 */
  finalStatus: TaskStatus;
  /** 执行时间线 */
  timeline: ExecutionTimelineEntry[];
}

/**
 * 执行时间线条目
 */
export interface ExecutionTimelineEntry {
  /** 时间 */
  timestamp: string;
  /** 事件类型 */
  event: 'started' | 'skipped' | 'dev_started' | 'dev_completed' | 'code_review_started' | 'code_review_completed' | 'qa_started' | 'qa_completed' | 'human_verification_started' | 'human_verification_completed' | 'review_started' | 'review_completed' | 'retry' | 'completed' | 'failed';
  /** 描述 */
  description: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/**
 * 执行摘要
 */
export interface ExecutionSummary {
  /** 总任务数 */
  totalTasks: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 重试总次数 */
  totalRetries: number;
  /** 总执行时长（毫秒） */
  duration: number;
  /** 开始时间 */
  startTime: string;
  /** 结束时间 */
  endTime: string;
  /** 各任务结果 */
  taskResults: Map<string, TaskExecutionRecord>;
  /** 配置 */
  config: HarnessConfig;
}

/**
 * Harness 执行状态
 */
export type HarnessState = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Harness 运行时状态（用于持久化和恢复）
 */
export interface HarnessRuntimeState {
  /** 状态 */
  state: HarnessState;
  /** 配置 */
  config: HarnessConfig;
  /** 任务队列 */
  taskQueue: string[];
  /** 当前执行索引 */
  currentIndex: number;
  /** 执行记录 */
  records: TaskExecutionRecord[];
  /** 开始时间 */
  startTime: string;
  /** 重试计数器 */
  retryCounter: Map<string, number>;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * Headless Claude 执行选项
 */
export interface HeadlessClaudeOptions {
  /** 任务描述/提示词 */
  prompt: string;
  /** 允许的工具列表 */
  allowedTools: string[];
  /** 超时时间（秒） */
  timeout: number;
  /** 工作目录 */
  cwd: string;
  /** 输出格式 */
  outputFormat: 'text' | 'json';
}

/**
 * Headless Claude 执行结果
 */
export interface HeadlessClaudeResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 退出码 */
  exitCode: number;
  /** 执行时长（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 创建默认 Sprint Contract
 */
export function createDefaultSprintContract(taskId: string): SprintContract {
  const now = new Date().toISOString();
  return {
    taskId,
    acceptanceCriteria: [],
    verificationCommands: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 创建默认开发报告
 */
export function createDefaultDevReport(taskId: string): DevReport {
  const now = new Date().toISOString();
  return {
    taskId,
    status: 'pending',
    changes: [],
    evidence: [],
    checkpointsCompleted: [],
    startTime: now,
    endTime: now,
    duration: 0,
  };
}

/**
 * 创建默认执行记录
 */
export function createDefaultExecutionRecord(task: TaskMeta): TaskExecutionRecord {
  return {
    taskId: task.id,
    task,
    contract: createDefaultSprintContract(task.id),
    devReport: createDefaultDevReport(task.id),
    retryCount: 0,
    finalStatus: task.status,
    timeline: [],
  };
}

/**
 * 创建默认运行时状态
 */
export function createDefaultRuntimeState(config: HarnessConfig): HarnessRuntimeState {
  const now = new Date().toISOString();
  return {
    state: 'idle',
    config,
    taskQueue: [],
    currentIndex: 0,
    records: [],
    startTime: now,
    retryCounter: new Map(),
    updatedAt: now,
  };
}

// ============================================================
// 流水线状态报告类型（供 AI 读取）
// ============================================================

/**
 * 流水线阶段
 */
export type HarnessReportPhase =
  | 'idle'           // 空闲
  | 'initialization' // 初始化
  | 'development'    // 开发阶段
  | 'code_review'    // 代码审核阶段
  | 'qa_verification'// QA 验证阶段
  | 'human_verification' // 人工验证阶段
  | 'evaluation'     // 最终评估阶段
  | 'completed'      // 完成
  | 'failed';        // 失败

/**
 * 阶段历史条目
 */
export interface PhaseHistoryEntry {
  /** 阶段 */
  phase: HarnessReportPhase;
  /** 任务ID */
  taskId?: string;
  /** 状态 */
  status: 'started' | 'completed' | 'failed';
  /** 时间戳 */
  timestamp: string;
  /** 消息 */
  message?: string;
  /** 持续时间（毫秒） */
  duration?: number;
}

/**
 * 流水线状态报告
 * 存储位置：.projmnt4claude/harness-status.json
 */
export interface HarnessStatusReport {
  /** 会话ID（关联到当前 AI 会话） */
  sessionId?: string;

  /** 流水线状态 */
  state: HarnessState;

  /** 当前阶段 */
  currentPhase: HarnessReportPhase;

  /** 当前任务ID */
  currentTaskId?: string;

  /** 总任务数 */
  totalTasks: number;

  /** 已完成任务数 */
  completedTasks: number;

  /** 进度百分比 (0-100) */
  progress: number;

  /** 状态消息 */
  message: string;

  /** 时间戳 */
  timestamp: string;

  /** 阶段历史 */
  phaseHistory: PhaseHistoryEntry[];

  /** 错误信息（如有） */
  error?: {
    code: string;
    message: string;
    taskId?: string;
  };
}

/**
 * 创建默认状态报告
 */
export function createDefaultStatusReport(sessionId?: string): HarnessStatusReport {
  return {
    sessionId,
    state: 'idle',
    currentPhase: 'idle',
    totalTasks: 0,
    completedTasks: 0,
    progress: 0,
    message: '流水线就绪',
    timestamp: new Date().toISOString(),
    phaseHistory: [],
  };
}
