/**
 * PreCheck Orchestrator Types
 * 预检查协调器类型定义
 */

// ============== 核心配置类型 ==============

export interface PrecheckConfig {
  /** 是否启用检查点 */
  enableCheckpoint: boolean;
  /** 检查点存储路径 */
  checkpointPath?: string;
  /** 是否在失败时停止 */
  stopOnFailure: boolean;
  /** 全局超时（毫秒） */
  globalTimeout: number;
  /** 阶段配置 */
  phases: PhaseConfig[];
  /** 输出配置 */
  output: OutputConfig;
}

export interface PhaseConfig {
  name: string;
  description: string;
  enabled: boolean;
  order: number;
  stopOnFailure: boolean;
  timeout: number;
  checks: string[];
}

export interface OutputConfig {
  formats: ('json' | 'markdown' | 'terminal')[];
  outputDir: string;
  verbose: boolean;
}

// ============== 检查项类型 ==============

export type CheckCategory =
  | 'environment'
  | 'metadata'
  | 'dependency'
  | 'resource'
  | 'quality';

export interface CheckContext {
  taskId: string;
  cwd: string;
  phase: string;
  sharedData: Map<string, unknown>;
  logger: CheckLogger;
}

export interface CheckLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface CheckItem {
  id: string;
  name: string;
  description: string;
  category: CheckCategory;
  execute: (context: CheckContext) => Promise<CheckResult>;
  priority: number;
  dependencies?: string[];
}

// ============== 检查结果类型 ==============

export interface CheckResult {
  checkId: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
  duration: number;
  timestamp: string;
}

export interface PhaseResult {
  phase: string;
  passed: boolean;
  duration: number;
  checks: CheckResult[];
  errors: string[];
  timestamp: string;
}

export interface ReportSummary {
  totalPhases: number;
  passedPhases: number;
  failedPhases: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  duration: number;
  status: 'passed' | 'failed' | 'partial';
}

export interface ReportMetadata {
  generatedAt: string;
  version: string;
  orchestratorVersion: string;
}

export interface PrecheckReport {
  taskId: string;
  summary: ReportSummary;
  phases: PhaseResult[];
  recommendations: string[];
  metadata: ReportMetadata;
}

export interface PrecheckResult {
  taskId: string;
  passed: boolean;
  phases: PhaseResult[];
  summary: ReportSummary;
  checkpoint?: CheckPoint;
  duration: number;
  timestamp: string;
}

// ============== 检查点类型 ==============

export interface CheckPoint {
  taskId: string;
  completedPhases: string[];
  currentPhase: string | null;
  phaseResults: PhaseResult[];
  sharedData: Record<string, unknown>;
  createdAt: string;
}

export interface CheckpointData {
  version: string;
  taskId: string;
  status: 'in_progress' | 'completed' | 'failed';
  completedPhases: string[];
  currentPhase: string | null;
  phaseResults: PhaseResult[];
  sharedData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============== 阶段类型 ==============

export interface CheckPhase {
  name: string;
  description: string;
  order: number;
  checks: CheckItem[];
  stopOnFailure: boolean;
  timeout: number;
}

export interface PhaseContext {
  taskId: string;
  cwd: string;
  config: PrecheckConfig;
  sharedData: Map<string, unknown>;
}
