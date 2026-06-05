/**
 * init-requirement 基础架构类型定义
 *
 * 定义 ConversionStatus、GateFixResult、AlignmentResult、GateFailure 等核心类型，
 * 作为 init-requirement 流程间的正式接口契约。
 */

import type { CheckpointPrefix, ParsedCheckpoint } from './prefix-map.js';
import type { PreDevPhaseGateResult, PreDevPhaseRuleResult } from '../types/pre-dev-phase-gate.js';

// ParsedCheckpoint 从 prefix-map.ts 导入，避免重复定义
export type { ParsedCheckpoint };

// ============================================================
// 转换状态类型
// ============================================================

export type ConversionState = 'pending' | 'completed' | 'failed';

export interface ConversionTaskDetail {
  taskId?: string;
  convertedAt?: string;
  lastError?: string;
  lastAttemptAt?: string;
}

export interface ConversionStatus {
  reports: Record<string, ConversionState>;
  tasks: Record<string, ConversionTaskDetail>;
  lastRunAt: string;
}

// ============================================================
// 门禁修复相关类型
// ============================================================

export interface GateFixResult {
  passed: boolean;
  taskId: string;
  attempt: number;
  failures?: string[];
  cleanedUp?: boolean;
}

export interface AlignmentResult {
  aligned: boolean;
  checks: {
    rootCauseAlignment: { passed: boolean; detail: string };
    solutionAlignment: { passed: boolean; detail: string };
    checkpointAlignment: { passed: boolean; detail: string };
  };
  issues: string[];
}

export type GateFailureSource = 'preDevGate' | 'qualityGate' | 'dependencyCheck' | 'alignment';

export interface GateFailure {
  source: GateFailureSource;
  detail: string;
  ruleResults?: PreDevPhaseRuleResult[];
  suggestions?: string[];
}

// ============================================================
// 门禁运行依赖接口（用于解耦与依赖注入）
// ============================================================

export interface GateDependencies {
  runPreDevGate: (params: {
    taskId: string;
    task: Record<string, unknown>;
    cwd: string;
    attempt: number;
    maxRetries: number;
    isResumed: boolean;
  }) => Promise<PreDevPhaseGateResult>;

  checkQualityGate: (taskId: string, config: { minQualityScore: number }, cwd: string) => Promise<{
    passed: boolean;
    score: { totalScore: number };
    suggestions?: string[];
  }>;

  validateNewTaskDeps: (taskId: string) => boolean;

  readTaskMeta: (taskId: string, cwd: string) => Record<string, unknown>;

  writeTaskMeta: (task: Record<string, unknown>, cwd: string) => void;

  invokeAIAgent: (prompt: string, options: {
    outputFormat: string;
    timeout: number;
    allowedTools: string[];
    cwd: string;
  }) => Promise<{ output: string; success: boolean; durationMs: number; error?: string }>;

  runAlignmentCheck: (reportPath: string, taskId: string, cwd: string) => Promise<AlignmentResult>;

  moveTaskToArchive: (taskId: string, cwd: string) => void;

  updateConversionStatus: (
    investigationDir: string,
    reportPath: string,
    state: ConversionState,
    detail?: { taskId?: string; lastError?: string; lastAttemptAt?: string },
  ) => void;
}

// ============================================================
// 默认质量门禁配置
// ============================================================

export const DEFAULT_QUALITY_GATE_CONFIG = {
  minQualityScore: 60,
} as const;