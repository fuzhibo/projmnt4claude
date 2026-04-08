/**
 * 反馈约束引擎核心类型与接口
 *
 * 基于 Harness Design 模式的约束验证层，
 * 在开发阶段输出上执行结构化规则验证并生成反馈。
 */

import type { AgentResult } from '../utils/headless-agent.js';
import type { ReviewResult } from './harness.js';

/** 违规严重级别 */
export type ViolationSeverity = 'error' | 'warning';

/**
 * 验证违规项
 * 单条规则检查失败时产生的违规记录
 */
export interface ValidationViolation {
  /** 触发违规的规则 ID */
  ruleId: string;
  /** 严重级别：error 触发重试，warning 仅记录 */
  severity: ViolationSeverity;
  /** 人类可读的违规描述 */
  message: string;
  /** 涉及的字段路径（可选） */
  field?: string;
  /** 导致违规的值（可选） */
  value?: string;
}

/**
 * 原子验证规则
 * 每条规则检查输出中的单一约束条件
 */
export interface ValidationRule {
  /** 规则唯一标识 */
  id: string;
  /** 规则描述 */
  description: string;
  /** 检查函数：返回违规项或 null */
  check: (output: unknown) => ValidationViolation | null;
  /** 默认严重级别 */
  severity: ViolationSeverity;
}

/**
 * 输出格式类型
 */
export type OutputType = 'json' | 'markdown';

/**
 * 验证规则集
 * 将相关规则组织为一组，按输出格式分类
 */
export interface ValidationRuleSet {
  /** 规则集名称（如 requirement/checkpoints/verdict） */
  name: string;
  /** 输出格式 */
  outputType: OutputType;
  /** 包含的验证规则列表 */
  rules: ValidationRule[];
  /** error 级违规最大重试次数，默认 2 */
  maxRetriesOnError: number;
}

/**
 * 反馈模板接口
 * 将违规信息转换为可理解的反馈提示词
 */
export interface FeedbackTemplate {
  /**
   * 构建反馈提示词
   * @param violations - 违规项列表
   * @param originalOutput - 原始输出内容
   * @returns 反馈提示词字符串
   */
  buildFeedbackPrompt(violations: ValidationViolation[], originalOutput: string): string;
}

/**
 * 引擎执行结果
 */
export interface EngineResult {
  /** Agent 调用结果 */
  result: AgentResult;
  /** 验证产生的违规项 */
  violations: ValidationViolation[];
  /** 已执行的重试次数 */
  retries: number;
  /** 最终是否通过验证 */
  passed: boolean;
  /** Session 连续性信息 */
  sessionContinuity?: {
    /** 是否使用了 session 连续性 */
    used: boolean;
    /** 使用的 session ID */
    sessionId?: string;
  };
}

/**
 * 反馈约束引擎接口
 * 提供约束验证、反馈生成和带反馈重试的核心能力
 */
export interface FeedbackConstraintEngine {
  /**
   * 验证输出是否符合所有规则
   * @param output - 待验证的输出内容
   * @returns 违规项列表（空列表表示全部通过）
   */
  validate(output: unknown): ValidationViolation[];

  /**
   * 根据违规项判断是否应重试
   * 仅当存在 error 级别违规且未超过重试上限时返回 true
   * @param violations - 违规项列表
   */
  shouldRetry(violations: ValidationViolation[]): boolean;

  /**
   * 构建反馈信息
   * 将违规项转换为结构化反馈，供下一轮开发使用
   * @param violations - 违规项列表
   * @param originalOutput - 原始输出内容
   */
  buildFeedback(violations: ValidationViolation[], originalOutput: string): string;

  /**
   * 带反馈的执行循环
   * 调用 Agent，验证输出，如有违规则生成反馈并重试
   * @param invokeFn - Agent 调用函数
   * @param prompt - 初始提示词
   * @param options - 调用选项
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runWithFeedback(invokeFn: any, prompt: string, options: any): Promise<EngineResult>;
}
