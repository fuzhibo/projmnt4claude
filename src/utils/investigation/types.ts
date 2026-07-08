/**
 * Investigation-requirement 类型定义
 *
 * InvestigationReport 作为 investigation 和 init-requirement 之间的正式接口契约。
 * 此文件是类型定义的唯一来源。
 */

// ============================================================
// 检查点前缀映射 - 从 init-requirement 导入（单一来源）
// ============================================================

// PREFIX_MAP 从 init-requirement/prefix-map.ts 导入，避免重复定义
import type { CheckpointPrefix } from '../init-requirement/prefix-map.js';
export { PREFIX_MAP } from '../init-requirement/prefix-map.js';
export type { CheckpointPrefix };

// ============================================================
// 核心报告类型
// ============================================================

/** 调查报告（investigation 和 init 之间的正式接口） */
export interface InvestigationReport {
  metadata: ReportMetadata;
  rootCauseAnalysis: RootCauseItem[];
  solutions: SolutionItem[];
  checkpoints: ReportCheckpoint[];
  assessment: ReportAssessment;
}

export interface ReportMetadata {
  requirementSource: string;
  investigationDate: string;
  investigationDir: string;
  language: 'zh' | 'en';
  parentReport?: string;
  dependsOn?: string[];
}

export interface RootCauseItem {
  id: string;
  title: string;
  description: string;
}

export interface SolutionItem {
  id: string;
  title: string;
  correspondsTo: string;
  description: string;
  files: string[];
  expectedChanges: string;
}

export interface ReportCheckpoint {
  prefix: CheckpointPrefix;
  description: string;
  belongsTo: string;
}

export interface ReportAssessment {
  complexity: 'low' | 'medium' | 'high';
  impactScope: '有限' | '中等' | '广泛';
  estimatedMinutes: number;
}

// ============================================================
// 评审类型
// ============================================================

export interface ReviewResult {
  pass: boolean;
  scores: {
    rootCauseAlignment: number;
    solutionEffectiveness: number;
    checkpointCompleteness: number;
  };
  issues: ReviewIssue[];
}

export interface ReviewIssue {
  dimension: 'rootCauseAlignment' | 'solutionEffectiveness' | 'checkpointCompleteness';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  suggestion: string;
}

// ============================================================
// 拆分类型
// ============================================================

export interface SplitPlan {
  items: SplitItem[];
}

export interface SplitItem {
  title: string;
  relationship: 'parallel' | 'hierarchical';
  scope: string;
  description: string;
  estimatedSize: number;
  dependsOn: number[];
}

export interface SplitReviewResult {
  pass: boolean;
  scores: {
    coverage: number;
    boundaryClarity: number;
    independence: number;
    dependencyReasonability: number;
    antiPhaseSplitting: number;
    granularity: number;
  };
  issues: SplitReviewIssue[];
}

export interface SplitReviewIssue {
  dimension: 'coverage' | 'boundaryClarity' | 'independence' | 'dependencyReasonability' | 'antiPhaseSplitting' | 'granularity';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  suggestion: string;
}

// ============================================================
// 输出模式
// ============================================================

export type OutputMode =
  | { type: 'dir'; path: string }
  | { type: 'file'; path: string };

// ============================================================
// 配置类型
// ============================================================

export interface InvestigationConfig {
  splitThreshold: number;
  maxRetry: number;
  outputDir: string;
}

// ============================================================
// 解析器容错配置 (CA-005)
// ============================================================

/** parseCheckpoints 容错配置选项 */
export interface ParseCheckpointsOptions {
  /** 容错级别: strict(仅完整格式) | normal(三层回退) | loose(极简格式) */
  tolerance?: 'strict' | 'normal' | 'loose';
  /** 是否输出格式警告日志 */
  warnOnInvalidFormat?: boolean;
  /** 是否从分组标题推断缺失的 belongsTo */
  inferBelongsTo?: boolean;
}

// ============================================================
// AI 集成层类型
// ============================================================

export interface AICallOptions {
  prompt: string;
  outputFormat: 'text' | 'json' | 'markdown';
  timeout?: number;
  allowedTools?: string[];
  cwd: string;
  /** 调试模式：输出详细日志 */
  debug?: boolean;
}

export interface AICallResult {
  output: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

// ============================================================
// 验证类型
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  blockingErrors: ValidationError[];
  warningErrors: ValidationError[];
}

export interface ValidationError {
  rule: string;
  message: string;
}

export interface ValidationWarning {
  rule: string;
  message: string;
  autoFixed?: boolean;
}

export interface ValidationRule {
  name: string;
  condition: string;
  investigationAction: 'block' | 'warn';
  initAction: 'block' | 'warn';
}

// ============================================================
// 提示词模板类型
// ============================================================

export interface PromptTemplate {
  name: string;
  description: string;
  params: Record<string, {
    source: 'cli-arg' | 'config' | 'report' | 'computed';
    description: string;
  }>;
  render: (params: Record<string, string>) => string;
}