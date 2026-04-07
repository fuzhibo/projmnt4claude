import prompts from 'prompts';
import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, getTasksDir, getArchiveDir, getProjectDir, getReportsDir, getLogsDir, ensureDir } from '../utils/path';
import {
  readTaskMeta,
  writeTaskMeta,
  getAllTasks,
  getAllTaskIds,
  taskExists,
  isSubtask,
  buildTaskVerification,
  renameTask,
} from '../utils/task';
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
  TaskType,
  CheckpointMetadata,
  TaskHistoryEntry,
  VerificationMethod,
  TransitionNote,
} from '../types/task';
import {
  parseTaskId,
  generateTaskId,
  inferTaskType,
  CURRENT_TASK_SCHEMA_VERSION,
  PIPELINE_INTERMEDIATE_STATUSES,
  PIPELINE_STATUS_MIGRATION_MAP,
  normalizeStatus,
  normalizePriority,
} from '../types/task';
import type { VerdictAction } from '../types/harness';
import { VALID_VERDICT_ACTIONS } from '../types/harness';
import { generateCheckpointId } from '../utils/checkpoint';
import { inferCheckpointsFromDescription, generateStructuredDescription, type StructuredDescription, type DescriptionTemplateType } from '../utils/description-template';
import { SEPARATOR_WIDTH } from '../utils/format';
import type { SprintContract } from '../types/harness';

// 从 analyze-fix-pipeline 重新导出，保持向后兼容
export { fixIssues } from './analyze-fix-pipeline';
export type { FixOptions } from './analyze-fix-pipeline';
import { isMeaninglessSlug } from './analyze-fix-pipeline';

import { areDependenciesCompleted } from '../utils/plan';
import { readConfig } from './config';
import { createLogger, type InstrumentationRecord } from '../utils/logger';
import { AIMetadataAssistant, type DuplicateGroup, classifyFileToLayer, groupFilesByLayer, sortFilesByLayer, type ArchitectureLayer, LAYER_DEFINITIONS } from '../utils/ai-metadata';
import { extractFilePaths } from '../utils/quality-gate';
import { inferDependenciesBatch } from '../utils/dependency-engine';

// ============== Analyze 配置 ==============

/**
 * analyze 命令的配置选项
 * 在 .projmnt4claude/config.json 的 "analyze" 字段中定义
 */
export interface AnalyzeConfig {
  /** 是否自动生成检查点 (默认 true) */
  autoGenerateCheckpoints?: boolean;
  /** 检查点生成器类型: "rule-based" | "ai-powered" | "hybrid" (默认 "rule-based")
   *  - rule-based: 纯关键词匹配推断验证方法 (无 AI 调用)
   *  - ai-powered: 使用 AI 语义理解生成高质量检查点
   *  - hybrid: 先用 rule-based 生成，再用 AI 增强 (默认推荐)
   */
  checkpointGenerator?: 'rule-based' | 'ai-powered' | 'hybrid';
  /** 检查点最低覆盖率阈值 0-1 (默认 0.8)，低于此阈值会产生警告 */
  minCheckpointCoverage?: number;
  /** 忽略的任务 ID 匹配模式 (支持 * 通配符)，如 ["TASK-test-*"] */
  ignorePatterns?: string[];
}

const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  autoGenerateCheckpoints: true,
  checkpointGenerator: 'rule-based',
  minCheckpointCoverage: 0.8,
  ignorePatterns: [],
};

/**
 * 读取 analyze 配置，合并默认值
 */
export function readAnalyzeConfig(cwd: string = process.cwd()): AnalyzeConfig {
  const config = readConfig(cwd);
  if (!config) return { ...DEFAULT_ANALYZE_CONFIG };

  const analyzeRaw = config.analyze;
  if (!analyzeRaw || typeof analyzeRaw !== 'object') return { ...DEFAULT_ANALYZE_CONFIG };

  const userConfig = analyzeRaw as Record<string, unknown>;
  return {
    autoGenerateCheckpoints: typeof userConfig.autoGenerateCheckpoints === 'boolean'
      ? userConfig.autoGenerateCheckpoints
      : DEFAULT_ANALYZE_CONFIG.autoGenerateCheckpoints,
    checkpointGenerator: ['rule-based', 'ai-powered', 'hybrid'].includes(userConfig.checkpointGenerator as string)
      ? userConfig.checkpointGenerator as 'rule-based' | 'ai-powered' | 'hybrid'
      : DEFAULT_ANALYZE_CONFIG.checkpointGenerator,
    minCheckpointCoverage: typeof userConfig.minCheckpointCoverage === 'number' &&
      userConfig.minCheckpointCoverage >= 0 && userConfig.minCheckpointCoverage <= 1
      ? userConfig.minCheckpointCoverage
      : DEFAULT_ANALYZE_CONFIG.minCheckpointCoverage,
    ignorePatterns: Array.isArray(userConfig.ignorePatterns) &&
      userConfig.ignorePatterns.every((p: unknown) => typeof p === 'string')
      ? userConfig.ignorePatterns as string[]
      : DEFAULT_ANALYZE_CONFIG.ignorePatterns,
  };
}

/**
 * 检查任务 ID 是否匹配忽略模式
 * 支持简单的 glob 模式: * 匹配任意字符序列
 */
function matchesIgnorePattern(taskId: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    if (regex.test(taskId)) return true;
  }
  return false;
}

// ============== 规范验证辅助函数 ==============

/**
 * 有效的任务状态值
 */
const VALID_STATUSES: TaskStatus[] = ['open', 'in_progress', 'wait_review', 'wait_qa', 'wait_complete', 'resolved', 'closed', 'abandoned', 'failed'];

/**
 * 有效的任务类型
 */
const VALID_TYPES = ['bug', 'feature', 'research', 'docs', 'refactor', 'test'];

/**
 * 有效的优先级
 */
const VALID_PRIORITIES: TaskPriority[] = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

// ============== Schema 版本化迁移框架 ==============

/**
 * Schema 迁移步骤定义
 */
export interface SchemaMigrationStep {
  /** 目标版本号（迁移到此版本） */
  version: number;
  /** 迁移名称 */
  name: string;
  /** 迁移描述 */
  description: string;
  /** 执行迁移 */
  migrate: (task: TaskMeta) => { changed: boolean; details: string[] };
}

/**
 * 获取从 fromVersion 到最新版本的所有待执行迁移步骤
 */
export function getPendingMigrations(fromVersion: number): SchemaMigrationStep[] {
  return SCHEMA_MIGRATIONS.filter(m => m.version > fromVersion);
}

/**
 * 一次性应用所有待执行的 schema 迁移
 * @returns 迁移结果，包含变更的详情列表
 */
export function applySchemaMigrations(task: TaskMeta): { changed: boolean; details: string[] } {
  const fromVersion = task.schemaVersion ?? 0;
  const pending = getPendingMigrations(fromVersion);

  if (pending.length === 0) {
    return { changed: false, details: [] };
  }

  let anyChanged = false;
  const allDetails: string[] = [];

  for (const migration of pending) {
    const result = migration.migrate(task);
    if (result.changed) {
      anyChanged = true;
      allDetails.push(...result.details);
    }
  }

  // 更新 schema 版本到最新
  if (anyChanged || pending.length > 0) {
    task.schemaVersion = CURRENT_TASK_SCHEMA_VERSION;
    task.updatedAt = new Date().toISOString();
    allDetails.push(`schemaVersion: ${fromVersion} → ${CURRENT_TASK_SCHEMA_VERSION}`);
  }

  return { changed: anyChanged || pending.length > 0, details: allDetails };
}

/**
 * Schema 迁移步骤注册表
 * 按版本号升序排列，每个步骤将任务从上一版本迁移到当前版本
 *
 * 版本 1: 基础 schema（reopenCount + requirementHistory）
 * 版本 2: pipeline 状态规范化 + verdict action 验证
 */
export const SCHEMA_MIGRATIONS: SchemaMigrationStep[] = [
  {
    version: 1,
    name: 'legacy_schema_fields',
    description: '添加 reopenCount 和 requirementHistory 字段',
    migrate(task: TaskMeta): { changed: boolean; details: string[] } {
      const details: string[] = [];
      let changed = false;

      if (task.reopenCount === undefined) {
        task.reopenCount = 0;
        details.push('添加 reopenCount: 0');
        changed = true;
      }
      if (task.requirementHistory === undefined) {
        task.requirementHistory = [];
        details.push('添加 requirementHistory: []');
        changed = true;
      }

      return { changed, details };
    },
  },
  {
    version: 2,
    name: 'pipeline_status_and_verdict_action',
    description: 'pipeline 状态规范化 + verdict action schema 验证',
    migrate(task: TaskMeta): { changed: boolean; details: string[] } {
      const details: string[] = [];
      let changed = false;

      // 迁移 pipeline 中间状态
      if ((task.status as string) in PIPELINE_STATUS_MIGRATION_MAP) {
        const oldStatus = task.status;
        const newStatus = PIPELINE_STATUS_MIGRATION_MAP[task.status];
        if (newStatus && oldStatus !== newStatus) {
          task.status = newStatus;
          details.push(`status: ${oldStatus} → ${newStatus}`);
          changed = true;
        }
      }

      // 清除无效 VerdictAction 值（从 history 中）
      if (!task.history) task.history = [];
      const invalidActionEntries: number[] = [];
      for (let i = 0; i < task.history.length; i++) {
        const entry = task.history[i]!;
        if (entry.action === 'verdict' && entry.newValue && typeof entry.newValue === 'string') {
          if (!VALID_VERDICT_ACTIONS.includes(entry.newValue as VerdictAction)) {
            invalidActionEntries.push(i);
          }
        }
      }
      if (invalidActionEntries.length > 0) {
        // 标记无效条目而非删除，保留审计记录
        for (const idx of invalidActionEntries) {
          const entry = task.history![idx]!;
          task.history[idx] = {
            ...entry,
            timestamp: entry.timestamp,
            newValue: `[migrated: invalid_verdict_action "${entry.newValue}" removed]`,
          };
          details.push(`history[${idx}]: 清除无效 verdict action "${entry.newValue}"`);
        }
        changed = true;
      }

      // 清除 verification 中的无效 verdictAction
      if (task.verification) {
        const verification = task.verification as unknown as Record<string, unknown>;
        if (verification.verdictAction && typeof verification.verdictAction === 'string') {
          if (!VALID_VERDICT_ACTIONS.includes(verification.verdictAction as VerdictAction)) {
            const oldValue = verification.verdictAction;
            delete verification.verdictAction;
            details.push(`verification: 清除无效 verdictAction "${oldValue}"`);
            changed = true;
          }
        }
      }

      return { changed, details };
    },
  },
  {
    version: 3,
    name: 'commit_history_field',
    description: '为 ExecutionStats 添加 commitHistory 字段（harness 批次 git commit SHA 追踪）',
    migrate(task: TaskMeta): { changed: boolean; details: string[] } {
      const details: string[] = [];
      // 幂等：仅当 executionStats 存在但缺少 commitHistory 时补空数组
      if (task.executionStats && task.executionStats.commitHistory === undefined) {
        task.executionStats.commitHistory = [];
        details.push('添加 executionStats.commitHistory: []');
        return { changed: true, details };
      }
      return { changed: false, details };
    },
  },
  {
    version: 4,
    name: 'reopened_to_open_and_transition_notes',
    description: 'reopened→open 迁移 + TransitionNote + resumeAction 初始化',
    migrate(task: TaskMeta): { changed: boolean; details: string[] } {
      const details: string[] = [];
      let changed = false;

      // 初始化 transitionNotes（必须在状态迁移之前，以便写入迁移记录）
      if (task.transitionNotes === undefined) {
        task.transitionNotes = [];
        details.push('添加 transitionNotes: []');
        changed = true;
      }

      // 迁移 reopened 状态到 open（让任务可被重新处理）
      if ((task.status as string) === 'reopened') {
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: 'reopened',
          toStatus: 'open',
          note: 'Schema v4 迁移: reopened → open（reopened 状态已废弃）',
          author: 'schema-migration',
        });
        task.status = 'open';
        details.push('status: reopened → open');
        details.push('transitionNote: 记录 reopened → open 迁移');
        changed = true;
      }

      // 初始化 resumeAction（仅对 pipeline 中间状态的任务设置）
      if (task.resumeAction === undefined) {
        const intermediateStatuses: string[] = ['wait_review', 'wait_qa', 'wait_complete', 'needs_human'];
        if (intermediateStatuses.includes(task.status)) {
          task.resumeAction = 'resume_pipeline';
          details.push(`添加 resumeAction: resume_pipeline (status=${task.status})`);
          changed = true;
        }
      }

      return { changed, details };
    },
  },
];

/**
 * 验证 ISO 时间戳格式
 */
function isValidISOTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') return false;
  // ISO 8601 格式: YYYY-MM-DDTHH:mm:ss.sssZ 或 YYYY-MM-DDTHH:mm:ssZ
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
  if (!isoRegex.test(timestamp)) return false;
  // 验证是否为有效日期
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

/**
 * 验证历史记录条目格式
 */
function validateHistoryEntry(entry: unknown, index: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: [`history[${index}] 不是有效对象`] };
  }

  const e = entry as Record<string, unknown>;

  // 必需字段: timestamp, action
  if (!e.timestamp || typeof e.timestamp !== 'string') {
    errors.push(`history[${index}].timestamp 缺失或格式错误`);
  } else if (!isValidISOTimestamp(e.timestamp)) {
    errors.push(`history[${index}].timestamp 不是有效的 ISO 时间戳`);
  }

  if (!e.action || typeof e.action !== 'string') {
    errors.push(`history[${index}].action 缺失或格式错误`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证需求变更历史条目格式
 */
function validateRequirementHistoryEntry(entry: unknown, index: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: [`requirementHistory[${index}] 不是有效对象`] };
  }

  const e = entry as Record<string, unknown>;

  // 必需字段: timestamp, version, newDescription, changeReason
  if (!e.timestamp || typeof e.timestamp !== 'string') {
    errors.push(`requirementHistory[${index}].timestamp 缺失或格式错误`);
  } else if (!isValidISOTimestamp(e.timestamp)) {
    errors.push(`requirementHistory[${index}].timestamp 不是有效的 ISO 时间戳`);
  }

  if (typeof e.version !== 'number' || e.version < 1) {
    errors.push(`requirementHistory[${index}].version 应为 >= 1 的数字`);
  }

  if (!e.newDescription || typeof e.newDescription !== 'string') {
    errors.push(`requirementHistory[${index}].newDescription 缺失或格式错误`);
  }

  if (!e.changeReason || typeof e.changeReason !== 'string') {
    errors.push(`requirementHistory[${index}].changeReason 缺失或格式错误`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证任务 ID 格式
 */
function validateTaskIdFormat(id: string): { valid: boolean; format: 'new' | 'old' | 'unknown'; errors: string[] } {
  const errors: string[] = [];

  if (!id || typeof id !== 'string') {
    return { valid: false, format: 'unknown', errors: ['任务 ID 为空或格式错误'] };
  }

  // 旧格式: TASK-001
  if (/^TASK-\d{3,}$/.test(id)) {
    return { valid: true, format: 'old', errors: [] };
  }

  // 新格式: TASK-{type}-{priority}-{slug}-{date}[-suffix]
  const newFormat = /^TASK-(bug|feature|research|docs|refactor|test)-([PQ]\d)-([a-z0-9\-]+)-(\d{8})(?:-\d+)?$/;
  if (newFormat.test(id)) {
    return { valid: true, format: 'new', errors: [] };
  }

  // 子任务格式: {parentId}-N
  const subtaskFormat = /^TASK-(bug|feature|research|docs|refactor|test)-([PQ]\d)-([a-z0-9\-]+)-(\d{8})(?:-\d+)?-\d+$/;
  if (subtaskFormat.test(id)) {
    return { valid: true, format: 'new', errors: [] };
  }

  // 宽松格式：TASK-{任意内容}
  if (id.startsWith('TASK-') && id.length > 5 && /^[a-zA-Z0-9\-_]+$/.test(id)) {
    return { valid: true, format: 'unknown', errors: [] };
  }

  errors.push('任务 ID 格式不符合规范');
  return { valid: false, format: 'unknown', errors };
}

/**
 * 验证状态值是否有效
 */
function isValidStatusValue(status: string): boolean {
  return VALID_STATUSES.includes(status as TaskStatus);
}

/**
 * 验证类型值是否有效
 */
function isValidTypeValue(type: string): boolean {
  return VALID_TYPES.includes(type);
}

/**
 * 验证优先级值是否有效
 */
function isValidPriorityValue(priority: string): boolean {
  return VALID_PRIORITIES.includes(priority as TaskPriority);
}

// ============== 分析问题接口 ==============
export interface Issue {
  taskId: string;
  type:
    | 'stale' | 'orphan' | 'cycle' | 'blocked' | 'no_description'
    | 'legacy_priority' | 'legacy_status' | 'legacy_schema'
    // 关系检查
    | 'invalid_parent_ref' | 'invalid_subtask_ref' | 'invalid_dependency_ref'
    | 'parent_child_mismatch' | 'subtask_not_in_parent'
    // 状态检查
    | 'invalid_status_value' | 'status_reopen_mismatch'
    | 'invalid_type_value' | 'invalid_priority_value'
    // 历史记录检查
    | 'invalid_history_format' | 'invalid_requirement_history_format'
    // 时间戳检查
    | 'invalid_timestamp_format'
    // ID 检查
    | 'invalid_task_id_format'
    // 验证方法检查
    | 'manual_verification'
    | 'missing_verification'  // resolved 状态但缺少 verification 字段
    | 'missing_createdBy'     // 任务缺少 createdBy 字段（无法追踪创建来源）
    // 状态一致性检查
    | 'inconsistent_status'
    // 残留检查
    | 'abandoned_residual'
    // ID 质量检查
    | 'meaningless_id'
    // 覆盖率检查
    | 'low_checkpoint_coverage'
    // 文件引用检查
    | 'file_not_found'
    // 配置忽略
    | 'ignored_by_config'
    // Pipeline 状态迁移
    | 'pipeline_status_migration'
    // VerdictAction schema 验证
    | 'verdict_action_schema'
    // Schema 版本迁移
    | 'schema_version_outdated'
    // AI 语义检测
    | 'semantic_duplicate'
    // 流转完整性检查
    | 'missing_transition_note'
    // 中断任务检测
    | 'interrupted_task'
    // 废弃状态检测
    | 'reopened_status'
    | 'needs_human_status'
    | 'deprecated_status_reference'
    // 依赖推断检测 (IR-08-03)
    | 'missing_inferred_dependency';
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
  details?: Record<string, unknown>; // 额外详情用于修复
}

export interface AnalysisStats {
  total: number;
  parentTasks: number;      // 父任务数
  subtasks: number;         // 子任务数
  subtaskCompletionRate: number; // 子任务完成率
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
  blocked: number;
  stale: number;
  orphan: number;
  cycle: number;
  orphanSubtasks: number;   // 孤儿子任务数
  abandonedResidual: number; // 归档目录中的 abandoned 残留任务数
  resolvedWithoutVerification: number; // resolved 但缺少 verification 的任务数
  inconsistentStatus: number;         // resolved 但 verification.result=failed 的任务数
  fileNotFound: number;     // 引用不存在文件的任务数
  ignored: number;          // 被 ignorePatterns 忽略的任务数
  missingCreatedBy: number; // 缺少 createdBy 字段的任务数
}

export interface AnalysisResult {
  issues: Issue[];
  stats: AnalysisStats;
  qualityScores?: Map<string, ContentQualityScore>;
}

// ============== 内容质量检测 ==============

/**
 * 内容质量评分结果
 */
export interface ContentQualityScore {
  /** 总分 (0-100) */
  totalScore: number;
  /** 描述完整度评分 (0-100) */
  descriptionScore: number;
  /** 检查点质量评分 (0-100) */
  checkpointScore: number;
  /** 关联文件评分 (0-100) */
  relatedFilesScore: number;
  /** 解决方案评分 (0-100) */
  solutionScore: number;
  /** AI 语义评分 (0-100), 仅 deepAnalyze 且非 noAi 时可用 */
  aiSemanticScore?: number;
  /** 扣分项详情 */
  deductions: QualityDeduction[];
  /** 检测时间 */
  checkedAt: string;
}

/**
 * 质量扣分项
 */
export interface QualityDeduction {
  category: 'description' | 'checkpoint' | 'related_files' | 'solution';
  reason: string;
  points: number;
  suggestion?: string;
}

/**
 * 泛化检查点模板列表
 * 这些是过于泛化、不具体的检查点描述
 */
const GENERIC_CHECKPOINT_PATTERNS = [
  /^需求分析与?设计$/,
  /^核心功能实现$/,
  /^测试与?验证$/,
  /^代码审查$/,
  /^功能实现$/,
  /^实现功能$/,
  /^完成功能$/,
  /^开发功能$/,
  /^编写代码$/,
  /^测试通过$/,
  /^验证通过$/,
  /^集成测试$/,
  /^单元测试$/,
  /^功能测试$/,
  /^完成开发$/,
  /^完成实现$/,
  /^实现完成$/,
  /^开发完成$/,
  /^测试完成$/,
  /^验收通过$/,
  /^检查通过$/,
  /^实现逻辑$/,
  /^编写逻辑$/,
  /^完成逻辑$/,
  /^开发完成$/,
  /^代码完成$/,
  /^功能完成$/,
  /^开发功能$/,
];

/**
 * 计算任务内容质量评分
 */
/** AI 增强分析选项 */
export interface AIAnalyzeOptions {
  /** 启用深度分析 (语义重复检测、AI 陈旧评估、语义质量评分) */
  deepAnalyze?: boolean;
  /** 禁用所有 AI 功能 */
  noAi?: boolean;
}

/**
 * 计算内容质量评分
 * CP-4: 结构评分 60% + AI 语义评分 40% (当 deepAnalyze 且非 noAi 时)
 */
export async function calculateContentQuality(
  task: TaskMeta,
  aiOptions?: AIAnalyzeOptions,
  cwd?: string
): Promise<ContentQualityScore> {
  const deductions: QualityDeduction[] = [];
  let descriptionScore = 100;
  let checkpointScore = 100;
  let relatedFilesScore = 100;
  let solutionScore = 100;

  // 1. 描述完整度检测
  const descResult = evaluateDescription(task.description);
  descriptionScore = descResult.score;
  deductions.push(...descResult.deductions);

  // 2. 检查点质量检测
  const cpResult = evaluateCheckpoints(task.checkpoints);
  checkpointScore = cpResult.score;
  deductions.push(...cpResult.deductions);

  // 2.5 架构层级排序检测
  const layerResult = evaluateLayerOrdering(task.checkpoints, task.description);
  checkpointScore = Math.max(0, checkpointScore + (layerResult.score - 100));
  deductions.push(...layerResult.deductions);

  // 3. 关联文件检测
  const filesResult = evaluateRelatedFiles(task.description, task.checkpoints);
  relatedFilesScore = filesResult.score;
  deductions.push(...filesResult.deductions);

  // 4. 解决方案检测
  const solResult = evaluateSolution(task.description);
  solutionScore = solResult.score;
  deductions.push(...solResult.deductions);

  // 计算总分 (加权平均)
  // CP-4: 当 AI 语义评分可用时，结构 60% + AI 语义 40%
  const structuralTotal = Math.round(
    descriptionScore * 0.35 +
    checkpointScore * 0.30 +
    relatedFilesScore * 0.15 +
    solutionScore * 0.20
  );

  // AI 语义评分 (仅 deepAnalyze 且非 noAi 时启用)
  let aiSemanticScore: number | undefined;
  if (aiOptions?.deepAnalyze && !aiOptions?.noAi && cwd) {
    // CP-4: 使用真实 AI 调用进行语义质量评估
    try {
      const aiAssistant = new AIMetadataAssistant(cwd);
      const qualityResult = await aiAssistant.analyzeTaskQuality(task, { cwd });
      if (qualityResult.aiUsed) {
        aiSemanticScore = qualityResult.score;
      }
    } catch {
      // AI 评估失败，仅使用结构评分
    }
  }

  const totalScore = aiSemanticScore !== undefined
    ? Math.round(structuralTotal * 0.6 + aiSemanticScore * 0.4)
    : structuralTotal;

  return {
    totalScore,
    descriptionScore,
    checkpointScore,
    relatedFilesScore,
    solutionScore,
    deductions,
    checkedAt: new Date().toISOString(),
    ...(aiSemanticScore !== undefined ? { aiSemanticScore } : {}),
  };
}

/**
 * 评估描述完整度
 */
function evaluateDescription(description?: string): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  if (!description || description.trim().length === 0) {
    deductions.push({
      category: 'description',
      reason: '缺少描述',
      points: -100,
      suggestion: '添加任务描述以提供更多上下文',
    });
    return { score: 0, deductions };
  }

  const descLength = description.trim().length;

  // 长度检测
  if (descLength < 30) {
    const deduction = -30;
    score += deduction;
    deductions.push({
      category: 'description',
      reason: `描述过短 (< 30字): ${descLength}字`,
      points: deduction,
      suggestion: '扩展描述，详细说明问题背景和需求',
    });
  } else if (descLength < 50) {
    const deduction = -15;
    score += deduction;
    deductions.push({
      category: 'description',
      reason: `描述较短 (< 50字): ${descLength}字`,
      points: deduction,
      suggestion: '添加更多细节，如根因分析、解决方案等',
    });
  }

  // 结构化段落检测
  const hasProblemSection = /##\s*问题描述|##\s*问题|#\s*问题描述|#\s*问题/i.test(description);
  const hasRootCauseSection = /##\s*根因分析|##\s*根因|##\s*原因|#\s*根因分析|#\s*原因/i.test(description);
  const hasSolutionSection = /##\s*解决方案|##\s*方案|#\s*解决方案|#\s*方案/i.test(description);
  const hasCheckpointSection = /##\s*检查点|#\s*检查点|##\s*验收|#\s*验收/i.test(description);

  // 检测结构化程度
  const sectionCount = [hasProblemSection, hasRootCauseSection, hasSolutionSection, hasCheckpointSection]
    .filter(Boolean).length;

  if (sectionCount < 2 && descLength >= 50) {
    const deduction = -10;
    score += deduction;
    deductions.push({
      category: 'description',
      reason: '缺少结构化段落',
      points: deduction,
      suggestion: '使用结构化格式，如"## 问题描述"、"## 解决方案"等',
    });
  }

  // 检测根因分析（对于 bug 类型任务尤其重要）
  if (!hasRootCauseSection && !/因为|由于|原因|根因|caused by|because|root cause/i.test(description)) {
    // 只在描述足够长但缺少根因时扣分
    if (descLength >= 50) {
      const deduction = -10;
      score += deduction;
      deductions.push({
        category: 'description',
        reason: '缺少根因分析',
        points: deduction,
        suggestion: '添加"## 根因分析"部分说明问题产生的原因',
      });
    }
  }

  return { score: Math.max(0, score), deductions };
}

/**
 * 评估检查点质量
 */
function evaluateCheckpoints(checkpoints?: CheckpointMetadata[]): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  if (!checkpoints || checkpoints.length === 0) {
    // 没有检查点不扣分，因为可能使用 checkpoint.md
    return { score: 100, deductions };
  }

  // 检测泛化检查点
  const genericCheckpoints: string[] = [];
  for (const cp of checkpoints) {
    const desc = cp.description.trim();
    for (const pattern of GENERIC_CHECKPOINT_PATTERNS) {
      if (pattern.test(desc)) {
        genericCheckpoints.push(desc);
        break;
      }
    }
  }

  if (genericCheckpoints.length > 0) {
    // 根据泛化检查点比例扣分
    const ratio = genericCheckpoints.length / checkpoints.length;
    const deduction = Math.round(-20 * ratio);
    score += deduction;
    deductions.push({
      category: 'checkpoint',
      reason: `检查点过于泛化: "${genericCheckpoints[0]}"${genericCheckpoints.length > 1 ? ` 等 ${genericCheckpoints.length} 项` : ''}`,
      points: deduction,
      suggestion: '使用更具体的检查点描述，如"实现用户登录 API"而非"核心功能实现"',
    });
  }

  // 检测检查点数量过少
  if (checkpoints.length < 2) {
    const deduction = -10;
    score += deduction;
    deductions.push({
      category: 'checkpoint',
      reason: '检查点数量过少 (< 2)',
      points: deduction,
      suggestion: '添加更多验收检查点以明确完成标准',
    });
  }

  return { score: Math.max(0, score), deductions };
}

/**
 * 从文本中提取文件引用路径（用于层级分析）
 */
function extractFileRefsForLayer(text: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(?:src|lib|test|tests|docs|bin|scripts|config)\/[\w/.-]+\.[a-z]+/g,
    /\.{1,2}\/[\w/.-]+\.[a-z]+/g,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (!seen.has(m)) {
          seen.add(m);
          files.push(m);
        }
      }
    }
  }
  return files;
}

/**
 * 检查检查点是否遵循架构层级顺序
 * Layer0(类型) → Layer1(工具) → Layer2(核心) → Layer3(命令)
 */
function evaluateLayerOrdering(
  checkpoints?: CheckpointMetadata[],
  description?: string
): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  if (!checkpoints || checkpoints.length < 2) {
    return { score: 100, deductions };
  }

  // 从检查点描述和任务描述中提取文件路径
  const allText = [
    description || '',
    ...checkpoints.map(cp => cp.description),
  ].join('\n');

  const filePaths = extractFileRefsForLayer(allText);
  if (filePaths.length < 2) {
    // 文件引用不足，无法评估层级排序
    return { score: 100, deductions };
  }

  // 将文件按层级分组
  const layerGroups = groupFilesByLayer(filePaths);

  // 检查是否有层级跨度跳跃（如直接从 Layer0 跳到 Layer3）
  const layersPresent = Array.from(layerGroups.keys());
  if (layersPresent.length >= 2) {
    // 检查检查点描述中是否提到了文件路径
    const cpWithFiles = checkpoints.filter(cp =>
      filePaths.some(fp => cp.description.includes(fp))
    );

    if (cpWithFiles.length >= 2) {
      // 验证检查点顺序是否遵循层级依赖
      let prevLayerOrder = -1;
      for (const cp of cpWithFiles) {
        const referencedFile = filePaths.find(fp => cp.description.includes(fp));
        if (referencedFile) {
          const currentLayer = classifyFileToLayer(referencedFile);
          const layerOrder = ['Layer0', 'Layer1', 'Layer2', 'Layer3'].indexOf(currentLayer);
          if (layerOrder < prevLayerOrder) {
            // 检查点顺序违反层级依赖（上层出现在底层之前）
            const deduction = -5;
            score += deduction;
            deductions.push({
              category: 'checkpoint',
              reason: `检查点层级顺序异常: "${cp.description}" (${currentLayer}) 出现在更底层检查点之前`,
              points: deduction,
              suggestion: '按架构层级重新排列检查点: 类型定义(Layer0) → 工具函数(Layer1) → 核心逻辑(Layer2) → 命令入口(Layer3)',
            });
            break; // 只报告一次
          }
          prevLayerOrder = layerOrder;
        }
      }
    }
  }

  return { score: Math.max(0, score), deductions };
}

/**
 * 评估关联文件
 */
function evaluateRelatedFiles(
  description?: string,
  checkpoints?: CheckpointMetadata[]
): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  // 从描述中检测文件引用
  const descFiles = extractFilePaths(description || '', { includeBareFilenames: false });

  // 从检查点 evidencePath 检测
  const cpFiles: string[] = [];
  if (checkpoints) {
    for (const cp of checkpoints) {
      if (cp.verification?.evidencePath) {
        cpFiles.push(cp.verification.evidencePath);
      }
    }
  }

  // 检测描述中的 "## 相关文件" 部分
  const hasRelatedFilesSection = /##\s*相关文件|#\s*相关文件|##\s*Related|#\s*Related/i.test(description || '');

  const allFiles = [...descFiles, ...cpFiles];
  const hasAnyFiles = allFiles.length > 0 || hasRelatedFilesSection;

  if (!hasAnyFiles) {
    const deduction = -15;
    score += deduction;
    deductions.push({
      category: 'related_files',
      reason: '缺少关联文件',
      points: deduction,
      suggestion: '添加"## 相关文件"部分，列出需要修改的源文件',
    });
  }

  return { score: Math.max(0, score), deductions };
}

/**
 * 评估解决方案
 */
function evaluateSolution(description?: string): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  if (!description || description.trim().length === 0) {
    return { score: 100, deductions }; // 没有描述时不在此项扣分
  }

  // 检测解决方案部分
  const hasSolutionSection = /##\s*解决方案|##\s*方案|#\s*解决方案|#\s*方案/i.test(description);

  // 检测解决方案关键词
  const hasSolutionKeywords = /建议|应该|需要|实现|修改|添加|更新|重构|suggest|should|need to|implement|modify|add|update|refactor/i.test(description);

  if (!hasSolutionSection && !hasSolutionKeywords) {
    const deduction = -25;
    score += deduction;
    deductions.push({
      category: 'solution',
      reason: '缺少解决方案',
      points: deduction,
      suggestion: '添加"## 解决方案"部分，说明具体的修改方案',
    });
  } else if (!hasSolutionSection && hasSolutionKeywords) {
    // 有关键词但没有明确的章节
    const deduction = -10;
    score += deduction;
    deductions.push({
      category: 'solution',
      reason: '解决方案未结构化',
      points: deduction,
      suggestion: '使用"## 解决方案"标题组织解决方案内容',
    });
  }

  return { score: Math.max(0, score), deductions };
}

/**
 * 执行内容质量检测
 * CP-4: 传递 AI 选项到 calculateContentQuality
 */
export async function performQualityCheck(cwd: string = process.cwd(), aiOptions?: AIAnalyzeOptions): Promise<Map<string, ContentQualityScore>> {
  const tasks = getAllTasks(cwd, false);
  const scores = new Map<string, ContentQualityScore>();

  for (const task of tasks) {
    const score = await calculateContentQuality(task, aiOptions, cwd);
    scores.set(task.id, score);
  }

  return scores;
}

/**
 * 显示内容质量检测结果
 */
export function showQualityReport(
  scores: Map<string, ContentQualityScore>,
  options: { compact?: boolean; json?: boolean; threshold?: number } = {}
): void {
  const { compact = false, json = false, threshold = 60 } = options;

  if (json) {
    const result: Record<string, ContentQualityScore> = {};
    scores.forEach((score, taskId) => {
      result[taskId] = score;
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const separator = compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  console.log('');
  console.log(separator);
  console.log('📊 内容质量检测报告');
  console.log(separator);
  console.log('');

  // 按总分排序
  const sortedScores = Array.from(scores.entries()).sort((a, b) => a[1].totalScore - b[1].totalScore);

  // 统计
  const lowQualityTasks = sortedScores.filter(([_, s]) => s.totalScore < threshold);
  const avgScore = sortedScores.reduce((sum, [_, s]) => sum + s.totalScore, 0) / sortedScores.length;

  console.log(`📈 总体统计:`);
  console.log(`   检测任务数: ${scores.size}`);
  console.log(`   平均分数: ${avgScore.toFixed(1)}/100`);
  console.log(`   低质量任务 (< ${threshold}分): ${lowQualityTasks.length}`);
  console.log('');

  if (sortedScores.length === 0) {
    console.log('✅ 没有任务需要检测');
    console.log('');
    return;
  }

  // 显示详细评分
  console.log(separator);
  console.log('📋 任务质量评分');
  console.log(separator);
  console.log('');

  for (const [taskId, score] of sortedScores) {
    const icon = score.totalScore >= 80 ? '🟢' : score.totalScore >= 60 ? '🟡' : '🔴';
    console.log(`${icon} ${taskId}: ${score.totalScore}/100`);
    console.log(`   描述完整度: ${score.descriptionScore}%`);
    console.log(`   检查点质量: ${score.checkpointScore}%`);
    console.log(`   关联文件: ${score.relatedFilesScore}%`);
    console.log(`   解决方案: ${score.solutionScore}%`);
    if (score.aiSemanticScore !== undefined) {
      console.log(`   AI 语义评分: ${score.aiSemanticScore}% (结构 60% + AI 40%)`);
    }

    // 显示扣分项
    if (score.deductions.length > 0) {
      for (const deduction of score.deductions) {
        console.log(`   └─ ${deduction.reason} (${deduction.points}分)`);
      }
    }
    console.log('');
  }

  // 显示改进建议
  if (lowQualityTasks.length > 0) {
    console.log(separator);
    console.log('💡 改进建议');
    console.log(separator);
    console.log('');

    for (const [taskId, score] of lowQualityTasks.slice(0, 5)) {
      console.log(`📌 ${taskId}:`);
      const suggestions = score.deductions
        .filter(d => d.suggestion)
        .map(d => d.suggestion);

      if (suggestions.length > 0) {
        console.log(`   ${suggestions[0]}`);
      }
      console.log('');
    }

    if (lowQualityTasks.length > 5) {
      console.log(`   ... 还有 ${lowQualityTasks.length - 5} 个低质量任务`);
      console.log('');
    }
  }

  console.log(separator);
  console.log('');
}

/**
 * AI 语义重复检测
 * CP-2: 批量发送任务 (每 prompt 最多 10 个，只含 ID+标题+描述)，返回语义重叠任务对
 */
async function detectSemanticDuplicates(
  tasks: TaskMeta[],
  cwd: string,
): Promise<Issue[]> {
  if (tasks.length < 2) return [];

  const aiAssistant = new AIMetadataAssistant(cwd);
  const batchSize = 10;
  const allIssues: Issue[] = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    try {
      const result = await aiAssistant.detectDuplicates(batch, { cwd });
      if (result.aiUsed && result.duplicates.length > 0) {
        for (const group of result.duplicates) {
          allIssues.push({
            taskId: group.taskIds[0] || '__semantic__',
            type: 'semantic_duplicate',
            severity: 'medium',
            message: `语义重复检测: ${group.taskIds.join(', ')} 相似度 ${(group.similarity * 100).toFixed(0)}%${group.reason ? ` - ${group.reason}` : ''}`,
            suggestion: group.keepTaskId
              ? `建议保留 ${group.keepTaskId}，合并或关闭其他重复任务`
              : '检查重复任务，保留最相关的一个，关闭或合并其余任务',
            details: {
              duplicateTaskIds: group.taskIds,
              similarity: group.similarity,
              keepTaskId: group.keepTaskId,
              reason: group.reason,
              aiUsed: result.aiUsed,
            },
          });
        }
      }
    } catch (err) {
      const logger = createLogger('analyze', cwd);
      logger.warn('语义重复检测失败', {
        error: err instanceof Error ? err.message : String(err),
        batchIndex: Math.floor(i / batchSize),
      });
    }
  }

  return allIssues;
}

/**
 * AI 陈旧任务相关性评估
 * CP-3: 在现有 stale 检测后调用 AI 评估，避免误报关闭仍相关任务
 */
async function assessStalenessWithAI(
  task: TaskMeta,
  cwd: string,
): Promise<{ stillStale: boolean; reason?: string } | null> {
  try {
    const aiAssistant = new AIMetadataAssistant(cwd);
    const result = await aiAssistant.assessStaleness(task, { cwd });
    if (result.aiUsed) {
      return {
        stillStale: result.isStale,
        reason: result.reason,
      };
    }
  } catch {
    // AI 评估失败，回退到规则引擎结果（保持 stale 标记）
  }
  return null;
}

/**
 * 分析项目健康状态
 * CP-2/3/6/7: 支持 AI 增强分析
 */
export async function analyzeProject(
  cwd: string = process.cwd(),
  includeArchived: boolean = false,
  aiOptions?: AIAnalyzeOptions,
): Promise<AnalysisResult> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const tasks = getAllTasks(cwd, includeArchived);
  const issues: Issue[] = [];

  // 加载 analyze 配置
  const analyzeConfig = readAnalyzeConfig(cwd);

  // 过滤被忽略的任务
  const filteredTasks = analyzeConfig.ignorePatterns && analyzeConfig.ignorePatterns.length > 0
    ? tasks.filter(task => {
        if (matchesIgnorePattern(task.id, analyzeConfig.ignorePatterns!)) {
          return false;
        }
        return true;
      })
    : tasks;
  const ignoredCount = tasks.length - filteredTasks.length;

  // 初始化统计
  const stats: AnalysisStats = {
    total: filteredTasks.length,
    parentTasks: 0,
    subtasks: 0,
    subtaskCompletionRate: 0,
    byStatus: {
      open: 0,
      in_progress: 0,
      wait_review: 0,
      wait_qa: 0,
      wait_complete: 0,
      resolved: 0,
      closed: 0,
      abandoned: 0,
      failed: 0,
    },
    byPriority: {
      P0: 0,
      P1: 0,
      P2: 0,
      P3: 0,
      Q1: 0,
      Q2: 0,
      Q3: 0,
      Q4: 0,
    },
    blocked: 0,
    stale: 0,
    orphan: 0,
    cycle: 0,
    orphanSubtasks: 0,
    abandonedResidual: 0,
    resolvedWithoutVerification: 0,
    inconsistentStatus: 0,
    fileNotFound: 0,
    ignored: ignoredCount,
    missingCreatedBy: 0,
  };

  const now = new Date();
  const staleThreshold = 7 * 24 * 60 * 60 * 1000; // 7 天

  // 检测循环依赖
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycleTasks = new Set<string>();

  function detectCycle(taskId: string): boolean {
    visited.add(taskId);
    recursionStack.add(taskId);

    const task = readTaskMeta(taskId, cwd);
    if (task) {
      for (const dep of task.dependencies) {
        if (!visited.has(dep)) {
          if (detectCycle(dep)) {
            cycleTasks.add(taskId);
            return true;
          }
        } else if (recursionStack.has(dep)) {
          cycleTasks.add(taskId);
          return true;
        }
      }
    }

    recursionStack.delete(taskId);
    return false;
  }

  for (const task of filteredTasks) {
    // 统计状态 (使用规范化函数)
    const normalizedStatus = normalizeStatus(task.status);
    stats.byStatus[normalizedStatus]++;

    // 统计优先级 (使用规范化函数)
    const normalizedPriority = normalizePriority(task.priority);
    stats.byPriority[normalizedPriority]++;

    // 检测过期任务 (stale)
    // CP-3: AI 辅助陈旧评估 (deepAnalyze 且非 noAi 时)
    const updatedAt = new Date(task.updatedAt);
    const isRuleStale = now.getTime() - updatedAt.getTime() > staleThreshold &&
      (normalizedStatus === 'open' || normalizedStatus === 'in_progress');
    if (isRuleStale) {
      let shouldFlagStale = true;
      let aiAssessment: { stillStale: boolean; reason?: string } | null = null;

      // CP-3: 使用 AI 评估是否仍然相关
      if (aiOptions?.deepAnalyze && !aiOptions?.noAi) {
        aiAssessment = await assessStalenessWithAI(task, cwd);
        if (aiAssessment !== null && !aiAssessment.stillStale) {
          // AI 评估认为不再陈旧，抑制 stale 标记
          shouldFlagStale = false;
        }
        // AI 确认仍然陈旧时，保留 shouldFlagStale = true
      }

      if (shouldFlagStale) {
        stats.stale++;
        issues.push({
          taskId: task.id,
          type: 'stale',
          severity: 'medium',
          message: `任务已 ${Math.floor((now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000))} 天未更新`,
          suggestion: aiAssessment?.stillStale && aiAssessment?.reason
            ? `AI 确认任务陈旧: ${aiAssessment.reason}，建议更新或关闭`
            : '检查任务是否仍然相关，考虑更新状态或关闭',
          details: {
            ...(aiAssessment && {
              aiAssessed: aiAssessment.stillStale,
              aiReason: aiAssessment.reason,
            }),
          },
        });
      }
    }

    // 检测无描述任务
    if (!task.description || task.description.trim() === '') {
      issues.push({
        taskId: task.id,
        type: 'no_description',
        severity: 'low',
        message: '任务缺少描述',
        suggestion: '添加任务描述以提供更多上下文',
      });
    }

    // 检测被阻塞的任务
    if (task.dependencies.length > 0) {
      const uncompletedDeps = task.dependencies.filter(depId => {
        const depTask = readTaskMeta(depId, cwd);
        if (!depTask) return true;
        const depStatus = normalizeStatus(depTask.status);
        return depStatus !== 'resolved' && depStatus !== 'closed';
      });

      if (uncompletedDeps.length > 0 && normalizedStatus !== 'resolved' && normalizedStatus !== 'closed') {
        stats.blocked++;
        issues.push({
          taskId: task.id,
          type: 'blocked',
          severity: 'medium',
          message: `任务被 ${uncompletedDeps.length} 个未完成的依赖阻塞`,
          suggestion: `先完成依赖任务: ${uncompletedDeps.join(', ')}`,
        });
      }
    }

    // 检测孤儿任务 (无依赖但优先级高且状态为 open)
    const taskNormalizedPriority = normalizePriority(task.priority);
    if (task.dependencies.length === 0 && taskNormalizedPriority === 'P0' && normalizedStatus === 'open') {
      stats.orphan++;
      issues.push({
        taskId: task.id,
        type: 'orphan',
        severity: 'low',
        message: 'P0紧急任务无依赖但未开始',
        suggestion: '考虑将此任务添加到执行计划中',
      });
    }

    // 检测旧格式优先级 (urgent/high/medium/low)
    if (['urgent', 'high', 'medium', 'low'].includes(task.priority)) {
      issues.push({
        taskId: task.id,
        type: 'legacy_priority',
        severity: 'low',
        message: `任务使用旧格式优先级: ${task.priority}`,
        suggestion: `将优先级更新为 ${normalizePriority(task.priority)}`,
      });
    }

    // 检测旧格式状态 (pending/completed/reopen/cancelled/blocked)
    const legacyStatuses = ['pending', 'completed', 'reopen', 'cancelled', 'blocked'];
    if (legacyStatuses.includes(task.status)) {
      issues.push({
        taskId: task.id,
        type: 'legacy_status',
        severity: 'low',
        message: `任务使用旧格式状态: ${task.status}`,
        suggestion: `将状态更新为 ${normalizeStatus(task.status)}`,
      });
    }

    // 检测旧格式 schema (缺少 reopenCount 或 requirementHistory 字段)
    if (task.reopenCount === undefined || task.requirementHistory === undefined) {
      issues.push({
        taskId: task.id,
        type: 'legacy_schema',
        severity: 'low',
        message: '任务 meta.json 缺少新规范字段',
        suggestion: '添加 reopenCount 和 requirementHistory 字段以符合最新规范',
      });
    }

    // ========== Schema 版本化检测 ==========

    // 检测 pipeline 中间状态（wait_review/wait_qa/wait_complete/needs_human）
    // 这些状态仅在 harness pipeline 执行期间使用，旧任务停留在此表示 pipeline 中断或版本过旧
    if (PIPELINE_INTERMEDIATE_STATUSES.includes(task.status)) {
      const targetStatus = PIPELINE_STATUS_MIGRATION_MAP[task.status];
      issues.push({
        taskId: task.id,
        type: 'pipeline_status_migration',
        severity: 'medium',
        message: `任务使用 pipeline 中间状态: ${task.status}，应迁移为 ${targetStatus}`,
        suggestion: `使用 --fix 将状态从 ${task.status} 自动迁移为 ${targetStatus}`,
        details: {
          currentStatus: task.status,
          targetStatus,
          migrationReason: (task.status as string) === 'needs_human'
            ? 'needs_human 已弃用，重置为 open 以便人工重新处理'
            : `pipeline 中间状态 ${task.status} 表明 pipeline 中断，建议迁移到 ${targetStatus}`,
        },
      });
    }

    // 检测无效的 VerdictAction 值
    // 检查 history 条目中是否包含无效的 verdict action 数据
    const invalidVerdictActions: string[] = [];
    for (const entry of task.history || []) {
      if (entry.action === 'verdict' && entry.newValue && typeof entry.newValue === 'string') {
        if (!VALID_VERDICT_ACTIONS.includes(entry.newValue as VerdictAction)) {
          invalidVerdictActions.push(entry.newValue);
        }
      }
    }
    // 也检查 verification 字段中可能的 verdict 相关数据
    if (task.verification) {
      const verification = task.verification as unknown as Record<string, unknown>;
      // 检查是否有嵌套的 verdict action
      if (verification.verdictAction && typeof verification.verdictAction === 'string') {
        if (!VALID_VERDICT_ACTIONS.includes(verification.verdictAction as VerdictAction)) {
          invalidVerdictActions.push(verification.verdictAction as string);
        }
      }
    }
    if (invalidVerdictActions.length > 0) {
      issues.push({
        taskId: task.id,
        type: 'verdict_action_schema',
        severity: 'medium',
        message: `任务包含无效的 VerdictAction 值: ${[...new Set(invalidVerdictActions)].join(', ')}`,
        suggestion: `使用 --fix 清除无效的 VerdictAction 值，有效值为: ${VALID_VERDICT_ACTIONS.join(', ')}`,
        details: { invalidActions: [...new Set(invalidVerdictActions)] },
      });
    }

    // 检测 schema 版本过时
    const taskSchemaVersion = task.schemaVersion ?? 0;
    if (taskSchemaVersion < CURRENT_TASK_SCHEMA_VERSION) {
      const pendingMigrations = getPendingMigrations(taskSchemaVersion);
      issues.push({
        taskId: task.id,
        type: 'schema_version_outdated',
        severity: taskSchemaVersion === 0 ? 'medium' : 'low',
        message: `任务 schema 版本过时: v${taskSchemaVersion} → v${CURRENT_TASK_SCHEMA_VERSION}，需迁移 ${pendingMigrations.map(m => m.name).join(', ')}`,
        suggestion: '使用 --fix 一次性完成所有版本迁移',
        details: {
          currentVersion: taskSchemaVersion,
          targetVersion: CURRENT_TASK_SCHEMA_VERSION,
          pendingMigrations: pendingMigrations.map(m => ({ version: m.version, name: m.name })),
        },
      });
    }

    // 检测缺少 createdBy 字段（无法追踪任务创建来源）
    if (!task.createdBy) {
      stats.missingCreatedBy++;
      issues.push({
        taskId: task.id,
        type: 'missing_createdBy',
        severity: 'low',
        message: '任务缺少 createdBy 字段，无法追踪创建来源',
        suggestion: '设置 createdBy 字段以符合最新规范（cli | init-requirement | harness-dev | harness-review | harness-qa | harness-eval | import）',
      });
    }

    // ========== 新增：规范合规性检查 ==========

    // 1. 检测无效的任务 ID 格式
    const idValidation = validateTaskIdFormat(task.id);
    if (!idValidation.valid) {
      issues.push({
        taskId: task.id,
        type: 'invalid_task_id_format',
        severity: 'medium',
        message: `任务 ID 格式不符合规范: ${idValidation.errors.join(', ')}`,
        suggestion: '使用格式 TASK-{type}-{priority}-{slug}-{date}，如 TASK-feature-P1-user-auth-20260319',
        details: { format: idValidation.format },
      });
    }

    // 1.5 检测无意义的任务 ID（slug 为空、哈希或 task- 前缀）
    const idInfo = parseTaskId(task.id);
    if (idInfo.valid) {
      let slugToCheck: string | undefined = idInfo.slug;

      // 非标准格式（如 bugfix 类型）用宽松正则提取 slug
      if (!slugToCheck && idInfo.format === 'unknown') {
        const lenientMatch = task.id.match(/^TASK-[a-z]+-[PQ]\d-([a-z0-9\-]+)-\d{8}/);
        if (lenientMatch) {
          slugToCheck = lenientMatch[1];
        }
      }

      if (slugToCheck) {
        // 有 slug，检查是否无意义
        if (isMeaninglessSlug(slugToCheck)) {
          issues.push({
            taskId: task.id,
            type: 'meaningless_id',
            severity: 'low',
            message: `任务 ID 的 slug 无意义: "${slugToCheck}"`,
            suggestion: '使用 --fix 自动从描述/标题提取关键词重命名，或手动重命名任务目录',
            details: { slug: slugToCheck, format: idInfo.format },
          });
        }
      } else {
        // slug 为空：旧格式 (TASK-001) 或空 slug (TASK-feature-P2--20260330)
        const reason = idInfo.format === 'old'
          ? '任务使用旧格式 ID'
          : '任务 ID 缺少有意义的 slug';
        issues.push({
          taskId: task.id,
          type: 'meaningless_id',
          severity: 'low',
          message: `${reason}: ${task.id}`,
          suggestion: '使用 --fix 自动从描述/标题提取关键词重命名',
          details: { format: idInfo.format },
        });
      }
    }

    // 2. 检测无效的状态值
    if (!isValidStatusValue(task.status)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_status_value',
        severity: 'high',
        message: `任务状态值无效: ${task.status}`,
        suggestion: `使用有效状态: ${VALID_STATUSES.join(', ')}`,
        details: { currentValue: task.status },
      });
    }

    // 2.5 检测废弃状态 reopened（v4 已废弃，应迁移为 open + reopenCount）
    if ((task.status as string) === 'reopened') {
      issues.push({
        taskId: task.id,
        type: 'reopened_status',
        severity: 'high',
        message: `任务使用已废弃的 reopened 状态（v4 已废弃，应使用 open + reopenCount 追踪）`,
        suggestion: '使用 --fix 自动迁移: reopened → open，并记录 transitionNote',
        details: { currentValue: task.status, targetValue: 'open' },
      });
    }

    // 2.6 检测废弃状态 needs_human（v4 已废弃，应迁移为 open + resumeAction）
    if ((task.status as string) === 'needs_human') {
      issues.push({
        taskId: task.id,
        type: 'needs_human_status',
        severity: 'high',
        message: `任务使用已废弃的 needs_human 状态（v4 已废弃，应使用 open + resumeAction 追踪）`,
        suggestion: '使用 --fix 自动迁移: needs_human → open，并设置 resumeAction',
        details: { currentValue: task.status, targetValue: 'open' },
      });
    }

    // 2.7 检测历史记录中对废弃状态的引用
    const deprecatedStatusRefs: string[] = [];
    for (const entry of task.history || []) {
      if ((entry.oldValue as string) === 'reopened' || (entry.newValue as string) === 'reopened' ||
          (entry.oldValue as string) === 'needs_human' || (entry.newValue as string) === 'needs_human') {
        const ref = [entry.oldValue, entry.newValue]
          .filter(v => v === 'reopened' || v === 'needs_human')
          .join(', ');
        deprecatedStatusRefs.push(ref);
      }
    }
    if (deprecatedStatusRefs.length > 0) {
      const uniqueRefs = [...new Set(deprecatedStatusRefs)].join(', ');
      issues.push({
        taskId: task.id,
        type: 'deprecated_status_reference',
        severity: 'low',
        message: `历史记录中引用了废弃状态: ${uniqueRefs}`,
        suggestion: '使用 --fix 自动清理历史记录中的废弃状态引用',
        details: { deprecatedRefs: [...new Set(deprecatedStatusRefs)] },
      });
    }

    // 3. 检测 reopenCount 与流转记录不一致（reopened 状态已废弃，通过 reopenCount + transitionNote 追踪）
    if ((task.reopenCount ?? 0) > 0) {
      const reopenHistoryCount = task.history?.filter(
        (h: TaskHistoryEntry) =>
          (h.action === 'status_change' && h.newValue === 'reopened') ||
          (h.field === 'status' && h.oldValue === 'resolved' && h.newValue === 'open')
      ).length || 0;
      const reopenTransitionCount = task.transitionNotes?.filter(
        (note: TransitionNote) =>
          note.fromStatus === 'resolved' && (note.toStatus === 'open' || (note.toStatus as string) === 'reopened')
      ).length || 0;

      if (reopenHistoryCount === 0 && reopenTransitionCount === 0) {
        issues.push({
          taskId: task.id,
          type: 'status_reopen_mismatch',
          severity: 'medium',
          message: `任务 reopenCount=${task.reopenCount} 但无对应的 reopen 流转记录`,
          suggestion: '确保 reopen 操作有对应的 transitionNote 和 history 记录',
          details: { reopenCount: task.reopenCount, status: task.status },
        });
      }
    }

    // 4. 检测无效的类型值
    if (!isValidTypeValue(task.type)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_type_value',
        severity: 'high',
        message: `任务类型值无效: ${task.type}`,
        suggestion: `使用有效类型: ${VALID_TYPES.join(', ')}`,
        details: { currentValue: task.type },
      });
    }

    // 5. 检测无效的优先级值
    if (!isValidPriorityValue(task.priority)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_priority_value',
        severity: 'high',
        message: `任务优先级值无效: ${task.priority}`,
        suggestion: `使用有效优先级: ${VALID_PRIORITIES.join(', ')}`,
        details: { currentValue: task.priority },
      });
    }

    // 6. 检测时间戳格式
    if (!isValidISOTimestamp(task.createdAt)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_timestamp_format',
        severity: 'medium',
        message: 'createdAt 不是有效的 ISO 时间戳',
        suggestion: '使用 ISO 8601 格式，如 2026-03-19T10:00:00.000Z',
        details: { field: 'createdAt', value: task.createdAt },
      });
    }

    if (!isValidISOTimestamp(task.updatedAt)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_timestamp_format',
        severity: 'medium',
        message: 'updatedAt 不是有效的 ISO 时间戳',
        suggestion: '使用 ISO 8601 格式，如 2026-03-19T10:00:00.000Z',
        details: { field: 'updatedAt', value: task.updatedAt },
      });
    }

    // 7. 检测 manual 验证方法（禁止使用）
    if (task.checkpoints && task.checkpoints.length > 0) {
      const manualCheckpoints = task.checkpoints.filter(
        cp => (cp.verification?.method as string) === 'manual'
      );
      if (manualCheckpoints.length > 0) {
        issues.push({
          taskId: task.id,
          type: 'manual_verification',
          severity: 'high',
          message: `有 ${manualCheckpoints.length} 个检查点使用了禁止的 manual 验证方法`,
          suggestion: '将 manual 替换为 code_review/lint/functional_test/e2e_test/architect_review/automated 等具体验证方法',
          details: { checkpointIds: manualCheckpoints.map(cp => cp.id) },
        });
      }
    }

    // 7.5 检测 resolved 状态但缺少 verification 字段
    if (normalizedStatus === 'resolved' && !task.verification) {
      stats.resolvedWithoutVerification++;
      issues.push({
        taskId: task.id,
        type: 'missing_verification',
        severity: 'medium',
        message: '任务已 resolved 但缺少 verification 字段',
        suggestion: '运行 analyze --fix 自动回填 verification 字段',
        details: { status: task.status, hasCheckpoints: !!(task.checkpoints && task.checkpoints.length > 0) },
      });
    }

    // 7.6 检测状态一致性：resolved 但 verification.result=failed 或 checkpointCompletionRate=0
    if (normalizedStatus === 'resolved' && task.verification && task.verification.result === 'failed') {
      stats.inconsistentStatus++;
      issues.push({
        taskId: task.id,
        type: 'inconsistent_status',
        severity: 'high',
        message: `任务状态矛盾: status=resolved 但 verification.result=failed, checkpointCompletionRate=${task.verification.checkpointCompletionRate ?? 0}`,
        suggestion: '运行 analyze --fix 自动将状态改为 open，或手动检查验收标准',
        details: {
          status: task.status,
          verificationResult: task.verification.result,
          checkpointCompletionRate: task.verification.checkpointCompletionRate,
          reopenCount: task.reopenCount,
        },
      });
    }

    // 8. 检测父任务引用有效性
    if (task.parentId) {
      if (!taskExists(task.parentId, cwd)) {
        issues.push({
          taskId: task.id,
          type: 'invalid_parent_ref',
          severity: 'high',
          message: `父任务 ${task.parentId} 不存在`,
          suggestion: '删除无效的 parentId 或创建父任务',
          details: { parentId: task.parentId },
        });
      } else {
        // 检查子任务是否在父任务的 subtaskIds 中
        const parentTask = readTaskMeta(task.parentId, cwd);
        if (parentTask && parentTask.subtaskIds && !parentTask.subtaskIds.includes(task.id)) {
          issues.push({
            taskId: task.id,
            type: 'subtask_not_in_parent',
            severity: 'medium',
            message: `子任务未在父任务 ${task.parentId} 的 subtaskIds 中`,
            suggestion: '将子任务 ID 添加到父任务的 subtaskIds 数组',
            details: { parentId: task.parentId },
          });
        }
      }
    }

    // 8. 检测子任务引用有效性
    if (task.subtaskIds && task.subtaskIds.length > 0) {
      for (const subtaskId of task.subtaskIds) {
        if (!taskExists(subtaskId, cwd)) {
          issues.push({
            taskId: task.id,
            type: 'invalid_subtask_ref',
            severity: 'medium',
            message: `子任务 ${subtaskId} 不存在`,
            suggestion: '从 subtaskIds 中移除无效引用或创建子任务',
            details: { subtaskId },
          });
        } else {
          // 检查子任务的 parentId 是否指向当前任务
          const subtask = readTaskMeta(subtaskId, cwd);
          if (subtask && subtask.parentId !== task.id) {
            issues.push({
              taskId: task.id,
              type: 'parent_child_mismatch',
              severity: 'medium',
              message: `子任务 ${subtaskId} 的 parentId 不指向当前任务`,
              suggestion: `将子任务的 parentId 更新为 ${task.id}`,
              details: { subtaskId, expectedParentId: task.id, actualParentId: subtask.parentId },
            });
          }
        }
      }
    }

    // 9. 检测依赖引用有效性
    if (task.dependencies && task.dependencies.length > 0) {
      for (const depId of task.dependencies) {
        if (!taskExists(depId, cwd)) {
          issues.push({
            taskId: task.id,
            type: 'invalid_dependency_ref',
            severity: 'medium',
            message: `依赖任务 ${depId} 不存在`,
            suggestion: '从 dependencies 中移除无效引用或创建依赖任务',
            details: { dependencyId: depId },
          });
        }
      }
    }

    // 10. 检测历史记录格式
    if (task.history && Array.isArray(task.history)) {
      for (let i = 0; i < task.history.length; i++) {
        const entryValidation = validateHistoryEntry(task.history[i], i);
        if (!entryValidation.valid) {
          issues.push({
            taskId: task.id,
            type: 'invalid_history_format',
            severity: 'low',
            message: `history[${i}] 格式不正确: ${entryValidation.errors.join(', ')}`,
            suggestion: '确保每个历史条目包含 timestamp (ISO格式) 和 action 字段',
            details: { index: i, errors: entryValidation.errors },
          });
        }
      }
    }

    // 11. 检测需求变更历史格式
    if (task.requirementHistory && Array.isArray(task.requirementHistory)) {
      for (let i = 0; i < task.requirementHistory.length; i++) {
        const reqValidation = validateRequirementHistoryEntry(task.requirementHistory[i], i);
        if (!reqValidation.valid) {
          issues.push({
            taskId: task.id,
            type: 'invalid_requirement_history_format',
            severity: 'low',
            message: `requirementHistory[${i}] 格式不正确: ${reqValidation.errors.join(', ')}`,
            suggestion: '确保每个需求变更条目包含 timestamp, version, newDescription, changeReason',
            details: { index: i, errors: reqValidation.errors },
          });
        }
      }
    }

    // 12. 检测历史流转缺失 transitionNote
    if (task.history && Array.isArray(task.history)) {
      const statusEntries = task.history.filter(
        (entry: TaskHistoryEntry) => entry.field === 'status' && entry.oldValue && entry.newValue
      );
      const existingNotes = task.transitionNotes || [];

      for (const entry of statusEntries) {
        const hasMatchingNote = existingNotes.some(
          (note: TransitionNote) =>
            note.fromStatus === entry.oldValue && note.toStatus === entry.newValue
        );
        if (!hasMatchingNote) {
          // 推断 author
          const actionLower = (entry.action || '').toLowerCase();
          const author = (actionLower.includes('pipeline') || actionLower.includes('harness'))
            ? 'pipeline'
            : 'user';

          // 推断 decision 描述
          const decisionMap: Record<string, string> = {
            'open→in_progress': '开始执行任务',
            'in_progress→wait_review': '提交代码审查',
            'wait_review→wait_qa': '审查通过，进入QA',
            'wait_qa→wait_complete': 'QA通过，等待完成确认',
            'wait_complete→resolved': '任务完成',
            'open→closed': '关闭任务',
            'in_progress→resolved': '直接标记完成',
            'resolved→reopened': '重新打开任务',
            'reopened→in_progress': '重新开始执行',
            'open→abandoned': '放弃任务',
            'in_progress→open': '退回待办',
          };
          const statusKey = `${entry.oldValue}→${entry.newValue}`;
          const decision = decisionMap[statusKey] || `${entry.oldValue} → ${entry.newValue}`;

          issues.push({
            taskId: task.id,
            type: 'missing_transition_note',
            severity: 'low',
            message: `历史流转 ${statusKey} 缺少 transitionNote 记录`,
            suggestion: '使用 --fix 自动从历史条目回填 transitionNote',
            details: {
              historyEntry: {
                timestamp: entry.timestamp,
                action: entry.action,
                oldValue: entry.oldValue,
                newValue: entry.newValue,
                reason: entry.reason,
                user: entry.user,
                verificationDetails: entry.verificationDetails,
              },
              inferredAuthor: author,
              inferredDecision: decision,
              inferredAnalysis: entry.reason || '',
              inferredEvidence: entry.verificationDetails || '',
            },
          });
        }
      }
    }

    // 13. 检测中断任务（in_progress 且无活跃 Pipeline）
    if (normalizedStatus === 'in_progress') {
      // 检查是否有活跃 pipeline 状态文件
      const omcStateDir = path.resolve(cwd, '.omc/state');
      let hasActivePipeline = false;

      if (fs.existsSync(omcStateDir)) {
        const pipelineStateFiles = fs.readdirSync(omcStateDir)
          .filter(f => f.includes('pipeline') && f.endsWith('.json'));

        for (const stateFile of pipelineStateFiles) {
          try {
            const stateData = JSON.parse(
              fs.readFileSync(path.join(omcStateDir, stateFile), 'utf-8')
            );
            if (stateData.active === true) {
              // 检查 pipeline 状态是否关联当前任务
              const taskIds: string[] = stateData.taskIds || (stateData.taskDescription ? [task.id] : []);
              if (taskIds.length === 0 || taskIds.includes(task.id)) {
                hasActivePipeline = true;
                break;
              }
            }
          } catch { /* ignore invalid state files */ }
        }
      }

      if (!hasActivePipeline) {
        // 计算中断时长
        const lastUpdated = new Date(task.updatedAt);
        const interruptedDurationMs = now.getTime() - lastUpdated.getTime();
        const interruptedDays = Math.floor(interruptedDurationMs / (24 * 60 * 60 * 1000));

        // 计算检查点完成率
        const totalCheckpoints = task.checkpoints?.length || 0;
        const completedCheckpoints = task.checkpoints?.filter(
          cp => cp.status === 'completed'
        ).length || 0;
        const checkpointRate = totalCheckpoints > 0 ? completedCheckpoints / totalCheckpoints : 0;

        // 检查是否有 requiresHuman 的检查点
        const hasRequiresHuman = task.checkpoints?.some(cp => cp.requiresHuman === true) || false;

        // 给出状态建议
        let suggestion_status: string;
        let suggestion_reason: string;
        if (checkpointRate >= 0.8 && totalCheckpoints > 0) {
          suggestion_status = 'wait_qa';
          suggestion_reason = `检查点完成率 ${(checkpointRate * 100).toFixed(0)}%，建议转为 wait_qa`;
        } else if (interruptedDays < 1 && !hasRequiresHuman) {
          suggestion_status = 'in_progress';
          suggestion_reason = '中断时间短且无需人工检查点，建议保持 in_progress';
        } else {
          suggestion_status = 'open';
          suggestion_reason = '任务中断较久，建议重置为 open 以便重新规划';
        }

        issues.push({
          taskId: task.id,
          type: 'interrupted_task',
          severity: 'medium',
          message: `in_progress 任务无活跃 Pipeline，已中断 ${interruptedDays} 天`,
          suggestion: `建议: ${suggestion_reason}。使用 --fix 自动应用建议状态`,
          details: {
            currentStatus: task.status,
            interruptedDays,
            checkpointRate: Math.round(checkpointRate * 100) / 100,
            totalCheckpoints,
            completedCheckpoints,
            hasRequiresHuman,
            suggestedStatus: suggestion_status,
            suggestionReason: suggestion_reason,
          },
        });
      }
    }

    // 14. 检测引用文件不存在 (file_not_found)
    const taskText = `${task.description || ''}\n${task.title || ''}`;
    const referencedFiles = extractFilePaths(taskText, { includeBareFilenames: false });
    const missingRefs = referencedFiles.filter(fp => !fs.existsSync(path.resolve(cwd, fp)));
    if (missingRefs.length > 0) {
      stats.fileNotFound++;
      issues.push({
        taskId: task.id,
        type: 'file_not_found',
        severity: 'high',
        message: `任务引用了 ${missingRefs.length} 个不存在的文件: ${missingRefs.join(', ')}`,
        suggestion: '检查文件路径是否正确，或移除对不存在文件的引用',
        details: { missingFiles: missingRefs },
      });
    }

    // 检测循环依赖
    if (!visited.has(task.id)) {
      detectCycle(task.id);
    }
  }

  // 检查检查点覆盖率
  if (analyzeConfig.minCheckpointCoverage && analyzeConfig.minCheckpointCoverage > 0) {
    const tasksWithCheckpoints = filteredTasks.filter(
      t => t.checkpoints && t.checkpoints.length > 0
    );
    const coverageRate = filteredTasks.length > 0
      ? tasksWithCheckpoints.length / filteredTasks.length
      : 0;

    if (coverageRate < analyzeConfig.minCheckpointCoverage) {
      issues.push({
        taskId: '__global__',
        type: 'low_checkpoint_coverage',
        severity: 'medium',
        message: `检查点覆盖率 ${(coverageRate * 100).toFixed(1)}% 低于配置阈值 ${(analyzeConfig.minCheckpointCoverage * 100).toFixed(1)}%`,
        suggestion: '为缺少检查点的任务添加验收标准，或运行 analyze --fix-checkpoints 自动生成',
        details: {
          coverageRate: Math.round(coverageRate * 100) / 100,
          threshold: analyzeConfig.minCheckpointCoverage,
          tasksWithoutCheckpoints: filteredTasks.length - tasksWithCheckpoints.length,
        },
      });
    }
  }

  // 计算子任务统计
  const parentTasks = filteredTasks.filter(t => !isSubtask(t.id));
  const subtasks = filteredTasks.filter(t => isSubtask(t.id));
  const completedSubtasks = subtasks.filter(t => t.status === 'resolved' || t.status === 'closed');

  stats.parentTasks = parentTasks.length;
  stats.subtasks = subtasks.length;
  stats.subtaskCompletionRate = subtasks.length > 0
    ? Math.round((completedSubtasks.length / subtasks.length) * 100)
    : 0;

  // 检测孤儿子任务（父任务不存在）
  for (const subtask of subtasks) {
    const parentId = subtask.parentId;
    if (parentId && !taskExists(parentId, cwd)) {
      stats.orphanSubtasks++;
      issues.push({
        taskId: subtask.id,
        type: 'orphan',
        severity: 'medium',
        message: `子任务的父任务 ${parentId} 不存在`,
        suggestion: '删除孤儿子任务或重新创建父任务',
      });
    }
  }

  // 检测归档目录中的 abandoned 残留任务
  const archiveDir = getArchiveDir(cwd);
  if (fs.existsSync(archiveDir)) {
    const abandonedDirs = fs.readdirSync(archiveDir)
      .filter(name => {
        const dirPath = path.join(archiveDir, name);
        if (!fs.statSync(dirPath).isDirectory()) return false;
        const metaPath = path.join(dirPath, 'meta.json');
        if (!fs.existsSync(metaPath)) return false;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          return meta.status === 'abandoned';
        } catch {
          return false;
        }
      });

    if (abandonedDirs.length > 0) {
      stats.abandonedResidual = abandonedDirs.length;
      issues.push({
        taskId: '__archive__',
        type: 'abandoned_residual',
        severity: 'low',
        message: `归档目录中存在 ${abandonedDirs.length} 个 abandoned 任务残留`,
        suggestion: '运行 task purge -y 清除残留的 abandoned 任务',
        details: { count: abandonedDirs.length, tasks: abandonedDirs },
      });
    }
  }

  // 添加循环依赖问题
  for (const taskId of cycleTasks) {
    stats.cycle++;
    issues.push({
      taskId,
      type: 'cycle',
      severity: 'high',
      message: '检测到循环依赖',
      suggestion: '移除循环依赖以避免死锁',
    });
  }

  // IR-08-03: 使用统一依赖推断引擎检测缺失的推断依赖
  // 检测任务间有文件重叠但未建立显式依赖的情况
  const inferredDeps = inferDependenciesBatch(filteredTasks);
  for (const [taskId, deps] of inferredDeps) {
    const task = filteredTasks.find(t => t.id === taskId);
    if (!task) continue;
    // 筛选出尚未在显式依赖中声明的推断依赖
    const explicitDeps = new Set(task.dependencies);
    const missingDeps = deps.filter(d => !explicitDeps.has(d.depTaskId));
    if (missingDeps.length > 0) {
      for (const dep of missingDeps) {
        issues.push({
          taskId,
          type: 'missing_inferred_dependency',
          severity: 'low',
          message: `与 ${dep.depTaskId} 共享文件但未声明依赖: ${dep.overlappingFiles.join(', ')}`,
          suggestion: `考虑将 ${dep.depTaskId} 添加为显式依赖`,
          details: { depTaskId: dep.depTaskId, overlappingFiles: dep.overlappingFiles },
        });
      }
    }
  }

  // CP-2: AI 语义重复检测 (仅 deepAnalyze 且非 noAi 时启用)
  if (aiOptions?.deepAnalyze && !aiOptions?.noAi && filteredTasks.length >= 2) {
    const semanticIssues = await detectSemanticDuplicates(filteredTasks, cwd);
    if (semanticIssues.length > 0) {
      issues.push(...semanticIssues);
    }
  }

  return { issues, stats };
}

/**
 * 显示分析结果
 * 重构版本：仅显示问题分析，不重复输出统计信息
 * CP-1: 支持 AI 增强分析选项
 */
export async function showAnalysis(options: { compact?: boolean; deepAnalyze?: boolean; noAi?: boolean } = {}, cwd: string = process.cwd()): Promise<void> {
  // CP-3: 模块日志 + 埋点初始化
  const logger = createLogger('analyze', cwd);
  const startTime = Date.now();

  const aiOptions: AIAnalyzeOptions = {
    deepAnalyze: !!options.deepAnalyze,
    noAi: !!options.noAi,
  };

  const result = await analyzeProject(cwd, false, aiOptions);

  const separator = options.compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  console.log('');
  console.log(separator);
  console.log('🔍 项目问题分析');
  console.log(separator);
  console.log('');

  // 显示问题摘要
  console.log('⚠️  问题摘要:');
  console.log(`   过期任务: ${result.stats.stale}`);
  console.log(`   被阻塞: ${result.stats.blocked}`);
  console.log(`   孤儿任务: ${result.stats.orphan}`);
  console.log(`   循环依赖: ${result.stats.cycle}`);
  console.log(`   Abandoned 残留: ${result.stats.abandonedResidual}`);
  if (result.stats.resolvedWithoutVerification > 0) {
    console.log(`   缺少 verification: ${result.stats.resolvedWithoutVerification}`);
  }
  if (result.stats.inconsistentStatus > 0) {
    console.log(`   状态矛盾 (resolved+failed): ${result.stats.inconsistentStatus}`);
  }
  if (result.stats.fileNotFound > 0) {
    console.log(`   文件不存在引用: ${result.stats.fileNotFound}`);
  }
  if (result.stats.ignored > 0) {
    console.log(`   已忽略 (配置): ${result.stats.ignored}`);
  }
  console.log('');

  // 显示详细问题
  if (result.issues.length > 0) {
    console.log(separator);
    console.log('📋 详细问题列表');
    console.log(separator);
    console.log('');

    // 按严重程度排序
    const sortedIssues = result.issues.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    for (const issue of sortedIssues) {
      const severityIcon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟠' : '🟡';
      console.log(`${severityIcon} [${issue.taskId}] ${issue.message}`);
      console.log(`   类型: ${issue.type}`);
      console.log(`   建议: ${issue.suggestion}`);
      console.log('');
    }
  } else {
    console.log('✅ 未发现问题，项目状态良好！');
  }

  console.log(separator);
  console.log('');
  console.log('💡 提示: 使用 `status` 命令查看完整统计信息');
  console.log('');

  // CP-9: 记录 analyze 埋点（问题分布 + 耗时）
  const issueDistribution: Record<string, number> = {};
  for (const issue of result.issues) {
    issueDistribution[issue.type] = (issueDistribution[issue.type] || 0) + 1;
  }
  logger.logInstrumentation({
    module: 'analyze',
    action: 'show_analysis',
    input_summary: `total_tasks=${result.stats.total}, include_archived=false`,
    output_summary: `issues=${result.issues.length}, stale=${result.stats.stale}, blocked=${result.stats.blocked}, cycle=${result.stats.cycle}`,
    ai_used: false,
    ai_enhanced_fields: [],
    duration_ms: Date.now() - startTime,
    user_edit_count: 0,
    module_data: {
      issue_distribution: issueDistribution,
      health_score: calculateHealthScore(result),
      by_status: result.stats.byStatus,
      by_priority: result.stats.byPriority,
    },
  });
  logger.flush();
}


/**
 * 显示项目状态摘要
 * 支持多种输出格式：quiet, json, full
 */
export async function showStatus(
  options: {
    includeArchived?: boolean;
    quiet?: boolean;
    json?: boolean;
    compact?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const includeArchived = options.includeArchived || false;
  const tasks = getAllTasks(cwd, includeArchived);
  const result = await analyzeProject(cwd, includeArchived);
  const healthScore = calculateHealthScore(result);

  // JSON 格式输出
  if (options.json) {
    console.log(JSON.stringify({
      total: result.stats.total,
      parentTasks: result.stats.parentTasks,
      subtasks: result.stats.subtasks,
      subtaskCompletionRate: result.stats.subtaskCompletionRate,
      byStatus: result.stats.byStatus,
      byPriority: result.stats.byPriority,
      healthScore,
      issues: {
        stale: result.stats.stale,
        blocked: result.stats.blocked,
        orphan: result.stats.orphan,
        cycle: result.stats.cycle,
        resolvedWithoutVerification: result.stats.resolvedWithoutVerification,
        inconsistentStatus: result.stats.inconsistentStatus,
        fileNotFound: result.stats.fileNotFound,
        ignored: result.stats.ignored,
        missingCreatedBy: result.stats.missingCreatedBy,
      },
    }, null, 2));
    return;
  }

  // 精简输出 (--quiet)
  if (options.quiet) {
    const healthIcon = healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴';
    console.log(`${result.stats.total} tasks | ${result.stats.byStatus.open} open | ${result.stats.byStatus.in_progress} in_progress | ${result.stats.byStatus.resolved + result.stats.byStatus.closed} done | health: ${healthIcon} ${healthScore}/100`);
    return;
  }

  // 精简模式 (--compact)
  const separator = options.compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  console.log('');
  console.log(separator);
  console.log('📋 项目状态摘要');
  console.log(separator);
  console.log('');

  // 基本统计
  console.log('📊 任务统计:');
  console.log(`   总数: ${tasks.length}`);
  if (result.stats.subtasks > 0) {
    console.log(`   ├── 父任务: ${result.stats.parentTasks}`);
    console.log(`   └── 子任务: ${result.stats.subtasks} (完成率: ${result.stats.subtaskCompletionRate}%)`);
  }
  console.log(`   待处理: ${result.stats.byStatus.open}`);
  console.log(`   进行中: ${result.stats.byStatus.in_progress}`);
  console.log(`   已完成: ${result.stats.byStatus.resolved + result.stats.byStatus.closed}`);
  const reopenStats = calculateReopenStats(tasks);
  console.log(`   已重开: ${reopenStats.reopenCount}`);
  console.log(`   已放弃: ${result.stats.byStatus.abandoned}`);
  if (reopenStats.reopenCount > 0) {
    console.log('🔄 Reopen 统计:');
    console.log(`   当前 reopen 任务数: ${reopenStats.reopenCount}`);
    if (reopenStats.topReopened.length > 0) {
      console.log(`   Reopen Top 10:`);
      reopenStats.topReopened.slice(0, 10).forEach((item, index) => {
        console.log(`     ${index + 1}. ${item.taskId} (${item.count}次) - ${item.title}`);
      });
    }
    console.log('');
  }

  // 归档统计
  if (includeArchived) {
    const archivedCount = countArchivedTasks(cwd);
    console.log('📦 归档统计:');
    console.log(`   已归档任务: ${archivedCount}`);
    console.log('');
  }

  // 健康指标
  const healthIcon = healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴';

  console.log('💚 健康指标:');
  console.log(`   健康分数: ${healthIcon} ${healthScore}/100`);
  console.log(`   过期任务: ${result.stats.stale}`);
  console.log(`   被阻塞: ${result.stats.blocked}`);
  console.log(`   循环依赖: ${result.stats.cycle}`);
  console.log('');

  // 优先级分布
  console.log('🎯 优先级分布:');
  console.log(`   🔴 P0 (紧急): ${result.stats.byPriority.P0}`);
  console.log(`   🟠 P1 (高): ${result.stats.byPriority.P1}`);
  console.log(`   🟡 P2 (中): ${result.stats.byPriority.P2}`);
  console.log(`   🟢 P3 (低): ${result.stats.byPriority.P3}`);
  if (result.stats.byPriority.Q1 + result.stats.byPriority.Q2 + result.stats.byPriority.Q3 + result.stats.byPriority.Q4 > 0) {
    console.log(`   📊 Q1-Q4: ${result.stats.byPriority.Q1 + result.stats.byPriority.Q2 + result.stats.byPriority.Q3 + result.stats.byPriority.Q4}`);
  }
  console.log('');

  console.log(separator);
}

/**
 * 计算 Reopen 统计
 * 优先使用 reopenCount 字段，回退到历史记录计算
 */
function calculateReopenStats(tasks: TaskMeta[]): { reopenCount: number; topReopened: { taskId: string; title: string; count: number }[] } {
  const reopenCount = tasks.filter(t => (t.reopenCount ?? 0) > 0).length;

  // 统计 reopen 次数：优先使用 reopenCount 字段
  const reopenCounts: { taskId: string; title: string; count: number }[] = [];

  for (const task of tasks) {
    // 优先使用专用的 reopenCount 字段
    if (task.reopenCount && task.reopenCount > 0) {
      reopenCounts.push({
        taskId: task.id,
        title: task.title,
        count: task.reopenCount,
      });
    } else if (task.history) {
      // 回退：从历史记录计算
      const reopenTimes = task.history.filter(h => h.action === 'status_change' && h.newValue === 'reopened').length;
      if (reopenTimes > 0) {
        reopenCounts.push({
          taskId: task.id,
          title: task.title,
          count: reopenTimes,
        });
      }
    }
  }

  // 按次数排序
  reopenCounts.sort((a, b) => b.count - a.count);

  return { reopenCount, topReopened: reopenCounts };
}

/**
 * 统计归档任务数量
 */
function countArchivedTasks(cwd: string): number {
  const archiveDir = path.join(getProjectDir(cwd), 'archive');
  if (!fs.existsSync(archiveDir)) {
    return 0;
  }
  return fs.readdirSync(archiveDir)
    .filter(name => fs.statSync(path.join(archiveDir, name)).isDirectory())
    .length;
}

/**
 * 计算健康分数 (0-100)
 */
function calculateHealthScore(result: AnalysisResult): number {
  if (result.stats.total === 0) return 100;

  let score = 100;

  // 过期任务扣分
  score -= result.stats.stale * 5;

  // 被阻塞任务扣分
  score -= result.stats.blocked * 3;

  // 循环依赖严重扣分
  score -= result.stats.cycle * 15;

  // 孤儿任务轻微扣分
  score -= result.stats.orphan * 1;

  // abandoned 残留任务轻微扣分
  score -= result.stats.abandonedResidual * 0.5;

  // 无描述任务轻微扣分
  const noDescIssues = result.issues.filter(i => i.type === 'no_description').length;
  score -= noDescIssues * 0.5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============== 检查点生成功能 ==============

/**
 * 代码库搜索结果
 */
interface CodeSearchResult {
  /** 匹配的文件路径 */
  filePath: string;
  /** 匹配的行号 */
  lineNumbers: number[];
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 相关性分数 */
  relevanceScore: number;
}

/**
 * 从验收标准提取关键词
 */
function extractKeywordsFromCriteria(criteria: string): string[] {
  const keywords: string[] = [];

  // 移除常见的停用词
  const stopWords = new Set([
    '的', '和', '与', '或', '在', '是', '有', '为', '了', '对', '这', '那',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    '添加', '实现', '确保', '验证', '完成', '检查', '更新', '修改', '配置',
    'add', 'implement', 'ensure', 'verify', 'complete', 'check', 'update',
    'option', 'options', '功能', '选项',
  ]);

  // 提取英文单词
  const englishWords = criteria.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) || [];
  for (const word of englishWords) {
    const lower = word.toLowerCase();
    if (!stopWords.has(lower) && word.length > 2) {
      keywords.push(lower);
    }
  }

  // 提取中文关键词（2-6个字符）
  const chineseWords = criteria.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  for (const word of chineseWords) {
    if (!stopWords.has(word)) {
      keywords.push(word);
    }
  }

  // 提取驼峰命名和下划线命名
  const identifiers = criteria.match(/[a-zA-Z_][a-zA-Z0-9_]+/g) || [];
  for (const id of identifiers) {
    if (id.length > 3 && !stopWords.has(id.toLowerCase())) {
      keywords.push(id);
    }
  }

  // 去重并返回
  return [...new Set(keywords)];
}

/**
 * 搜索代码库以找到与验收标准相关的文件
 */
function searchCodebaseForCriteria(
  criteria: string,
  cwd: string
): CodeSearchResult[] {
  const results: CodeSearchResult[] = [];
  const keywords = extractKeywordsFromCriteria(criteria);

  if (keywords.length === 0) {
    return results;
  }

  // 定义搜索范围（排除不需要搜索的目录）
  const excludeDirs = new Set([
    'node_modules', 'dist', 'build', '.git', '.projmnt4claude',
    'coverage', '.next', '.nuxt', 'out', 'tmp', 'temp',
  ]);

  // 定义优先搜索的文件扩展名
  const priorityExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.go', '.java', '.rs',
  ]);

  // 递归搜索目录
  function searchDirectory(dir: string, depth: number = 0): void {
    if (depth > 10) return; // 限制搜索深度

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 跳过排除的目录
          if (excludeDirs.has(entry.name) || entry.name.startsWith('.')) {
            continue;
          }
          searchDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // 只处理源代码文件
          const ext = path.extname(entry.name);
          if (!priorityExtensions.has(ext)) {
            continue;
          }

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const matchedKeywords: string[] = [];
            const lineNumbers: number[] = [];

            // 检查每个关键词
            for (const keyword of keywords) {
              const regex = new RegExp(escapeRegExp(keyword), 'gi');
              let hasMatch = false;

              lines.forEach((line, index) => {
                if (regex.test(line)) {
                  hasMatch = true;
                  if (!lineNumbers.includes(index + 1)) {
                    lineNumbers.push(index + 1);
                  }
                }
              });

              if (hasMatch) {
                matchedKeywords.push(keyword);
              }
            }

            // 如果有匹配，添加到结果
            if (matchedKeywords.length > 0) {
              // 计算相关性分数
              const uniqueKeywordRatio = matchedKeywords.length / keywords.length;
              const matchDensity = lineNumbers.length / Math.max(lines.length, 1);
              const relevanceScore = (uniqueKeywordRatio * 0.7 + matchDensity * 0.3) * 100;

              results.push({
                filePath: path.relative(cwd, fullPath),
                lineNumbers: lineNumbers.slice(0, 10), // 最多保留10个行号
                matchedKeywords,
                relevanceScore: Math.round(relevanceScore),
              });
            }
          } catch {
            // 忽略读取错误
          }
        }
      }
    } catch {
      // 忽略目录读取错误
    }
  }

  // 转义正则表达式特殊字符
  function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 开始搜索
  searchDirectory(cwd);

  // 按相关性排序，返回前10个结果
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.slice(0, 10);
}

/**
 * 基于代码库搜索结果生成智能检查点
 */
function generateSmartCheckpoints(
  taskId: string,
  criteria: string,
  searchResults: CodeSearchResult[],
  index: number
): CheckpointMetadata {
  const now = new Date().toISOString();
  const id = generateCheckpointId(taskId, index, criteria);

  // 基于搜索结果推断验证方法
  const verificationMethod = inferSmartVerificationMethod(criteria, searchResults);

  // 生成验证命令（如果可以推断）
  const verificationCommands = inferVerificationCommands(criteria, searchResults);

  const checkpoint: CheckpointMetadata = {
    id,
    description: criteria,
    status: 'pending',
    verification: {
      method: verificationMethod,
      commands: verificationCommands,
    },
    createdAt: now,
    updatedAt: now,
  };

  // 如果有相关的代码文件，添加到验证信息中
  if (searchResults.length > 0) {
    checkpoint.verification!.evidencePath = searchResults
      .slice(0, 3)
      .map(r => r.filePath)
      .join(', ');
  }

  return checkpoint;
}

/**
 * 基于搜索结果智能推断验证方法
 */
function inferSmartVerificationMethod(
  criteria: string,
  searchResults: CodeSearchResult[]
): VerificationMethod {
  const lowerCriteria = criteria.toLowerCase();

  // 1. 基于验收标准内容推断
  // 测试相关
  if (lowerCriteria.includes('测试') || lowerCriteria.includes('test')) {
    if (lowerCriteria.includes('e2e') || lowerCriteria.includes('端到端')) {
      return 'e2e_test';
    }
    if (lowerCriteria.includes('集成') || lowerCriteria.includes('integration')) {
      return 'integration_test';
    }
    return 'unit_test';
  }

  // 代码审查相关
  if (lowerCriteria.includes('审查') || lowerCriteria.includes('review') ||
      lowerCriteria.includes('代码质量') || lowerCriteria.includes('重构')) {
    return 'code_review';
  }

  // API 相关
  if (lowerCriteria.includes('api') || lowerCriteria.includes('接口')) {
    return 'functional_test';
  }

  // UI 相关
  if (lowerCriteria.includes('ui') || lowerCriteria.includes('界面') ||
      lowerCriteria.includes('页面') || lowerCriteria.includes('组件')) {
    return 'e2e_test';
  }

  // 架构相关
  if (lowerCriteria.includes('架构') || lowerCriteria.includes('architecture') ||
      lowerCriteria.includes('设计') || lowerCriteria.includes('design')) {
    return 'architect_review';
  }

  // 2. 基于搜索结果推断
  if (searchResults.length > 0) {
    // 检查匹配的文件路径
    const filePaths = searchResults.map(r => r.filePath.toLowerCase()).join(' ');

    // 测试文件
    if (filePaths.includes('test') || filePaths.includes('spec')) {
      return 'unit_test';
    }

    // API 路由
    if (filePaths.includes('api') || filePaths.includes('route') || filePaths.includes('controller')) {
      return 'functional_test';
    }

    // UI 组件
    if (filePaths.includes('component') || filePaths.includes('page') || filePaths.includes('view')) {
      return 'e2e_test';
    }

    // 配置文件
    if (filePaths.includes('config') || filePaths.includes('setting')) {
      return 'automated';
    }
  }

  // 默认使用自动化验证
  return 'automated';
}

/**
 * 推断验证命令
 */
function inferVerificationCommands(
  criteria: string,
  searchResults: CodeSearchResult[]
): string[] {
  const commands: string[] = [];
  const lowerCriteria = criteria.toLowerCase();

  // 基于验收标准推断命令
  if (lowerCriteria.includes('构建') || lowerCriteria.includes('build')) {
    commands.push('npm run build');
  }

  if (lowerCriteria.includes('lint') || lowerCriteria.includes('代码规范')) {
    commands.push('npm run lint');
  }

  if (lowerCriteria.includes('测试') || lowerCriteria.includes('test')) {
    commands.push('npm test');
  }

  if (lowerCriteria.includes('类型检查') || lowerCriteria.includes('type check')) {
    commands.push('npx tsc --noEmit');
  }

  // 基于搜索结果推断命令
  if (searchResults.length > 0) {
    // 如果匹配的是测试文件
    const hasTestFiles = searchResults.some(r =>
      r.filePath.includes('test') || r.filePath.includes('spec')
    );
    if (hasTestFiles && !commands.includes('npm test')) {
      commands.push('npm test');
    }
  }

  return commands;
}

/**
 * 获取 Contract 文件路径
 */
function getContractPath(taskId: string, cwd: string): string {
  return path.join(getTasksDir(cwd), taskId, 'contract.json');
}

/**
 * 读取 Contract 文件
 */
function readContract(taskId: string, cwd: string): SprintContract | null {
  const contractPath = getContractPath(taskId, cwd);
  if (!fs.existsSync(contractPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(contractPath, 'utf-8');
    return JSON.parse(content) as SprintContract;
  } catch {
    return null;
  }
}

/**
 * 保存 Contract 文件
 */
function saveContract(taskId: string, contract: SprintContract, cwd: string): void {
  const contractPath = getContractPath(taskId, cwd);
  const dir = path.dirname(contractPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  contract.updatedAt = new Date().toISOString();
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf-8');
}

/**
 * 基于验收标准生成检查点
 * 智能分析 acceptanceCriteria 并搜索代码库生成对应的检查点
 */
function generateCheckpointsFromCriteria(
  taskId: string,
  acceptanceCriteria: string[],
  taskTitle?: string,
  cwd: string = process.cwd(),
  taskDescription?: string
): CheckpointMetadata[] {
  const checkpoints: CheckpointMetadata[] = [];
  const now = new Date().toISOString();

  // 读取配置决定生成模式
  const analyzeConfig = readAnalyzeConfig(cwd);
  const useSimpleMode = analyzeConfig.checkpointGenerator === 'rule-based';

  const criteriaList = (acceptanceCriteria && acceptanceCriteria.length > 0)
    ? acceptanceCriteria
    : generateDefaultCheckpoints(taskTitle || taskId, taskDescription);

  for (let index = 0; index < criteriaList.length; index++) {
    const criteria = criteriaList[index]!;
    const id = generateCheckpointId(taskId, index, criteria);

    if (useSimpleMode) {
      // 简单模式: 不搜索代码库，直接基于关键词推断验证方法
      const method = inferVerificationMethod(criteria);
      checkpoints.push({
        id,
        description: criteria,
        status: 'pending',
        verification: { method },
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // 智能模式: 搜索代码库以找到相关文件，生成更精确的检查点
      const searchResults = searchCodebaseForCriteria(criteria, cwd);
      const checkpoint = generateSmartCheckpoints(taskId, criteria, searchResults, index);
      checkpoint.createdAt = now;
      checkpoint.updatedAt = now;
      checkpoint.status = 'pending';
      checkpoints.push(checkpoint);
    }
  }

  return checkpoints;
}

/**
 * 根据描述内容推断验证方法
 */
function inferVerificationMethod(description: string): VerificationMethod {
  const lowerDesc = description.toLowerCase();

  // 测试相关
  if (lowerDesc.includes('测试') || lowerDesc.includes('test')) {
    return 'unit_test';
  }

  // 代码审查相关
  if (lowerDesc.includes('审查') || lowerDesc.includes('review') || lowerDesc.includes('代码质量')) {
    return 'code_review';
  }

  // API 相关
  if (lowerDesc.includes('api') || lowerDesc.includes('接口')) {
    return 'functional_test';
  }

  // UI 相关
  if (lowerDesc.includes('ui') || lowerDesc.includes('界面') || lowerDesc.includes('页面')) {
    return 'e2e_test';
  }

  // 文档相关
  if (lowerDesc.includes('文档') || lowerDesc.includes('document')) {
    return 'automated';
  }

  // 默认使用自动化验证
  return 'automated';
}

/**
 * 生成智能默认检查点
 *
 * 优先使用 inferCheckpointsFromDescription 从任务标题/描述中提取
 * 具体的可验证条件，避免生成泛化的流程阶段检查点。
 */
function generateDefaultCheckpoints(taskTitle: string, taskDescription?: string): string[] {
  const content = taskDescription || taskTitle;
  const taskType = inferTaskType(taskTitle);

  // 使用智能检查点生成器
  const smartCheckpoints = inferCheckpointsFromDescription(content, taskType);
  if (smartCheckpoints.length > 0) {
    return smartCheckpoints;
  }

  // 最后回退：基于标题中的具体实体生成检查点
  return generateTitleBasedCheckpoints(taskTitle);
}

/**
 * 基于标题中的具体实体生成检查点
 * 仅在智能生成无法提取任何内容时使用
 * 不使用泛化的流程阶段（如"需求分析与设计"）
 */
function generateTitleBasedCheckpoints(taskTitle: string): string[] {
  const checkpoints: string[] = [];

  // 从标题中提取具体标识符（PascalCase、camelCase、snake_case）
  const identifierMatches = taskTitle.match(/\b[A-Z][a-zA-Z0-9]{2,}\b|\b[a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\b/g);
  if (identifierMatches) {
    const uniqueIds = [...new Set(identifierMatches)].slice(0, 3);
    for (const id of uniqueIds) {
      checkpoints.push(`${id} 相关功能已实现`);
    }
  }

  // 从标题中提取文件路径
  const fileMatches = taskTitle.match(/(?:src|lib|test|config)\/[\w/.-]+\.[a-z]+/g);
  if (fileMatches) {
    const uniqueFiles = [...new Set(fileMatches)].slice(0, 2);
    for (const file of uniqueFiles) {
      checkpoints.push(`${file} 包含所需修改`);
    }
  }

  // 如果标题包含动作动词，生成针对性检查点
  const actionPatterns: [RegExp, string][] = [
    [/修复|fix/i, '问题已定位并修复'],
    [/实现|implement/i, '核心功能已实现'],
    [/添加|add/i, '新功能已添加并可用'],
    [/优化|optimize/i, '性能优化已完成并验证'],
    [/重构|refactor/i, '重构完成，行为不变'],
    [/集成|integrate/i, '集成完成，接口连通'],
    [/迁移|migrate/i, '迁移完成，功能等价'],
    [/配置|config/i, '配置已生效'],
  ];
  for (const [pattern, checkpoint] of actionPatterns) {
    if (pattern.test(taskTitle)) {
      checkpoints.push(checkpoint);
      break;
    }
  }

  // 确保至少有 2 个检查点
  if (checkpoints.length < 2) {
    checkpoints.push(`${taskTitle.substring(0, 30)} 目标已达成`);
    checkpoints.push('相关代码已通过验证');
  }

  return [...new Set(checkpoints)];
}

/**
 * 从任务描述提取验收标准
 * 与 harness-executor.ts 中的 extractAcceptanceCriteria 逻辑一致
 */
function extractAcceptanceCriteriaFromDescription(description: string): string[] {
  const criteria: string[] = [];

  // 尝试提取列表项
  const lines = description.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 "- [ ] xxx" 或 "- xxx" 或 "1. xxx" 格式
    if (/^[-*]\s*(?:\[[ x]\])?\s*(.+)/.test(trimmed) || /^\d+\.\s*(.+)/.test(trimmed)) {
      const match = trimmed.match(/^(?:[-*]|\d+\.)\s*(?:\[[ x]\])?\s*(.+)/);
      if (match && match[1]) {
        criteria.push(match[1].trim());
      }
    }
  }

  // 如果没有提取到，将整个描述作为一条标准
  if (criteria.length === 0 && description.trim()) {
    criteria.push(description.trim());
  }

  return criteria;
}

/**
 * 修复单个任务的检查点
 */
function fixTaskCheckpoints(taskId: string, cwd: string): { fixed: boolean; reason: string } {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    return { fixed: false, reason: '任务不存在' };
  }

  // 读取或创建 contract
  let contract = readContract(taskId, cwd);

  if (!contract) {
    const now = new Date().toISOString();
    contract = {
      taskId,
      acceptanceCriteria: [],
      verificationCommands: [],
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  // 检查是否需要修复（基于 contract.json 的 checkpoints 是否为空）
  if (contract.checkpoints && contract.checkpoints.length > 0) {
    return { fixed: false, reason: '检查点已存在' };
  }

  // 如果 contract 中没有验收标准，从任务描述中提取
  let acceptanceCriteria = contract.acceptanceCriteria || [];
  if (acceptanceCriteria.length === 0 && task.description) {
    acceptanceCriteria = extractAcceptanceCriteriaFromDescription(task.description);
    // 将提取的验收标准写回 contract
    contract.acceptanceCriteria = acceptanceCriteria;
  }

  // 生成检查点（传递 cwd 以启用代码库搜索）
  const checkpoints = generateCheckpointsFromCriteria(
    taskId,
    acceptanceCriteria,
    task.title,
    cwd,
    task.description
  );

  if (checkpoints.length === 0) {
    return { fixed: false, reason: '无法生成检查点' };
  }

  // 更新 contract
  contract.checkpoints = checkpoints.map(cp => cp.id);

  // 始终更新 meta.json 中的 checkpoints 字段（因为 contract.checkpoints 原本为空）
  // 即使 task.checkpoints 已有旧数据，也用新生成的智能检查点替换
  task.checkpoints = checkpoints;
  writeTaskMeta(task, cwd);

  // 同时更新 checkpoint.md 文件，确保与 meta.json 同步
  // 这样 syncCheckpointsToMeta 不会覆盖我们的智能检查点
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  const checkpointContent = `# ${taskId} 检查点\n\n` +
    checkpoints.map(cp => `- [ ] ${cp.description}`).join('\n') +
    '\n';
  fs.writeFileSync(checkpointPath, checkpointContent, 'utf-8');

  // 保存 contract
  saveContract(taskId, contract, cwd);

  return { fixed: true, reason: `生成了 ${checkpoints.length} 个检查点` };
}

/**
 * 修复所有任务的检查点
 */
export async function fixCheckpoints(
  cwd: string = process.cwd(),
  options: { nonInteractive?: boolean; taskId?: string } = {}
): Promise<void> {
  // 读取 analyze 配置，检查是否允许自动生成
  const analyzeConfig = readAnalyzeConfig(cwd);
  if (analyzeConfig.autoGenerateCheckpoints === false) {
    console.log('');
    console.log('⏭️  检查点自动生成已禁用 (analyze.autoGenerateCheckpoints = false)');
    console.log('   提示: 在 .projmnt4claude/config.json 中设置 analyze.autoGenerateCheckpoints = true 以启用');
    console.log('');
    return;
  }

  const generatorLabel = analyzeConfig.checkpointGenerator === 'rule-based' ? '规则引擎' : analyzeConfig.checkpointGenerator === 'ai-powered' ? 'AI 驱动' : '混合';
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`🔧 ${generatorLabel}生成检查点 (模式: ${analyzeConfig.checkpointGenerator})`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  let tasksToFix: TaskMeta[];

  if (options.taskId) {
    // 修复指定任务
    const task = readTaskMeta(options.taskId, cwd);
    if (!task) {
      console.error(`❌ 任务 ${options.taskId} 不存在`);
      return;
    }
    tasksToFix = [task];
  } else {
    // 获取所有任务
    tasksToFix = getAllTasks(cwd, false);
  }

  // 筛选需要修复的任务
  const tasksNeedingFix: TaskMeta[] = [];

  for (const task of tasksToFix) {
    const contract = readContract(task.id, cwd);
    if (!contract || !contract.checkpoints || contract.checkpoints.length === 0) {
      tasksNeedingFix.push(task);
    }
  }

  if (tasksNeedingFix.length === 0) {
    console.log('✅ 所有任务的检查点都已配置');
    return;
  }

  console.log(`📋 发现 ${tasksNeedingFix.length} 个任务需要生成检查点:\n`);

  // 显示任务列表
  tasksNeedingFix.slice(0, 10).forEach((task, index) => {
    console.log(`   ${index + 1}. ${task.id} - ${task.title}`);
  });

  if (tasksNeedingFix.length > 10) {
    console.log(`   ... 还有 ${tasksNeedingFix.length - 10} 个任务`);
  }
  console.log('');

  // 确认修复
  if (!options.nonInteractive) {
    const response = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: `是否为这 ${tasksNeedingFix.length} 个任务生成检查点?`,
      initial: true,
    });

    if (!response.proceed) {
      console.log('已取消');
      return;
    }
  }

  // 执行修复
  let fixedCount = 0;
  let skippedCount = 0;

  for (const task of tasksNeedingFix) {
    console.log(`\n处理 ${task.id}...`);
    const result = fixTaskCheckpoints(task.id, cwd);

    if (result.fixed) {
      console.log(`  ✅ ${result.reason}`);
      fixedCount++;
    } else {
      console.log(`  ⏭️  ${result.reason}`);
      skippedCount++;
    }
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`✅ 完成: 修复 ${fixedCount} 个，跳过 ${skippedCount} 个`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
}

// ============== Bug Report 分析模式 ==============

/**
 * Bug Report 文档提取的字段
 */
interface BugReportFields {
  /** 问题描述 */
  problem: string;
  /** 根因分析 */
  rootCause?: string;
  /** 复现步骤 */
  reproductionSteps: string[];
  /** 建议修复 */
  suggestedFix?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** 环境/平台信息 */
  environment?: string;
  /** 影响范围 */
  impact?: string;
  /** 相关文件（从报告中提取） */
  relatedFiles: string[];
  /** 报告原始元数据 */
  metadata: Record<string, string>;
}

/**
 * Bug 分析结果
 */
export interface BugReportAnalysis {
  /** 原始 bug report 提取字段 */
  fields: BugReportFields;
  /** 日志上下文 */
  logContext: string[];
  /** 问题分类 */
  classification: BugClassification;
  /** 严重性评估 */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** 根因验证 */
  rootCauseVerification: string;
  /** 影响范围评估 */
  impactAssessment: string;
  /** 改进建议（按优先级排序） */
  improvementSuggestions: Array<{ priority: number; suggestion: string }>;
  /** 结构化需求描述（可直接用于 init-requirement） */
  requirementDescription: string;
  /** 分析报告 Markdown */
  reportMarkdown: string;
  /** 报告文件路径 */
  reportPath: string;
}

/**
 * Bug 分类
 */
interface BugClassification {
  /** 主分类 */
  category: string;
  /** 子分类 */
  subcategory: string;
  /** 分类置信度 0-1 */
  confidence: number;
}

/**
 * Bug Report 分析选项
 */
export interface BugReportOptions {
  /** 是否导出训练数据 */
  exportTrainingData?: boolean;
  /** 禁用 AI 分析 */
  noAi?: boolean;
}

/**
 * 从 Markdown 文本中提取 Bug Report 字段
 * 支持多种常见 bug report 格式
 */
function extractBugReportFields(markdown: string): BugReportFields {
  const fields: BugReportFields = {
    problem: '',
    reproductionSteps: [],
    relatedFiles: [],
    metadata: {},
  };

  // 提取问题描述
  const problemPatterns = [
    /(?:##?\s*(?:问题描述|Problem|问题|Description|Bug\s*Description))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:问题描述|Problem|Bug)[:：]\s*([^\n]+(?:\n(?!\n#)[^\n]+)*)/i,
  ];
  for (const pattern of problemPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.problem = match[1].trim();
      break;
    }
  }
  if (!fields.problem) {
    // 使用第一段非标题文本作为问题描述
    const firstParagraph = markdown.replace(/^#.*$/gm, '').trim().split(/\n\n+/)[0];
    if (firstParagraph) {
      fields.problem = firstParagraph.trim();
    }
  }

  // 提取根因分析
  const rootCausePatterns = [
    /(?:##?\s*(?:根因分析|Root\s*Cause|原因分析|Cause))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:根因分析|Root\s*Cause|原因)[:：]\s*([^\n]+(?:\n(?!\n#)[^\n]+)*)/i,
  ];
  for (const pattern of rootCausePatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.rootCause = match[1].trim();
      break;
    }
  }

  // 提取复现步骤
  const reproPatterns = [
    /(?:##?\s*(?:复现步骤|Steps\s*to\s*Reproduce|Reproduction|复现))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:复现步骤|Steps\s*to\s*Reproduce)[:：]\s*([\s\S]*?)(?=\n##?\s|\n#|$)/i,
  ];
  for (const pattern of reproPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // 匹配有序或无序列表项
        const itemMatch = trimmed.match(/^(?:\d+[.)]\s*|[-*]\s*)(.+)/);
        if (itemMatch?.[1]) {
          fields.reproductionSteps.push(itemMatch[1].trim());
        }
      }
      break;
    }
  }

  // 提取建议修复
  const fixPatterns = [
    /(?:##?\s*(?:建议修复|Suggested\s*Fix|建议|Fix|修复方案|Fix\s*Suggestion))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:建议修复|Suggested\s*Fix|修复方案)[:：]\s*([^\n]+(?:\n(?!\n#)[^\n]+)*)/i,
  ];
  for (const pattern of fixPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.suggestedFix = match[1].trim();
      break;
    }
  }

  // 提取错误信息
  const errorPatterns = [
    /(?:##?\s*(?:错误信息|Error|错误|Error\s*Message))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:错误信息|Error\s*Message)[:：]\s*([\s\S]*?)(?=\n##?\s|\n#|$)/i,
  ];
  for (const pattern of errorPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.errorMessage = match[1].trim();
      break;
    }
  }

  // 提取环境信息
  const envPatterns = [
    /(?:##?\s*(?:环境|Environment|平台|Platform))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:环境|Environment)[:：]\s*([^\n]+(?:\n(?!\n#)[^\n]+)*)/i,
  ];
  for (const pattern of envPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.environment = match[1].trim();
      break;
    }
  }

  // 提取影响范围
  const impactPatterns = [
    /(?:##?\s*(?:影响范围|Impact|影响))\s*\n([\s\S]*?)(?=\n##?\s|\n#|$)/i,
    /(?:影响范围|Impact)[:：]\s*([^\n]+(?:\n(?!\n#)[^\n]+)*)/i,
  ];
  for (const pattern of impactPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      fields.impact = match[1].trim();
      break;
    }
  }

  // 提取相关文件
  const filePathPattern = /\b(?:src\/|lib\/|test\/|tests\/|docs\/)?[\w/-]+\.(ts|js|tsx|jsx|py|go|java|rs|md)\b/g;
  const autoDetected = markdown.match(filePathPattern);
  if (autoDetected) {
    fields.relatedFiles = [...new Set(autoDetected)];
  }

  // 提取元数据（键值对格式）
  const metaPattern = /\*\*(\w+(?:\s+\w+)?)\*\*:\s*(.+)/g;
  let metaMatch;
  while ((metaMatch = metaPattern.exec(markdown)) !== null) {
    const key = metaMatch[1]?.trim();
    const value = metaMatch[2]?.trim();
    if (key && value && !['Problem', 'Root Cause', 'Steps to Reproduce', 'Suggested Fix', 'Error'].includes(key)) {
      fields.metadata[key] = value;
    }
  }

  return fields;
}

/**
 * 从 .projmnt4claude/logs/ 加载与 bug report 相关的日志上下文
 * 根据时间范围或关键词匹配提取相关日志条目
 */
function loadLogContext(cwd: string, keywords: string[]): string[] {
  const logsDir = getLogsDir(cwd);
  if (!fs.existsSync(logsDir)) return [];

  const contextLines: string[] = [];
  try {
    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, path: path.join(logsDir, f), mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    // 读取最近的 3 个日志文件
    const recentFiles = files.slice(0, 3);
    for (const file of recentFiles) {
      try {
        const content = fs.readFileSync(file.path, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            // 提取错误和警告级别的日志，或包含关键词的日志
            const message = entry.message || '';
            const isRelevant = entry.level === 'error' || entry.level === 'warn' ||
              keywords.some(kw => message.toLowerCase().includes(kw.toLowerCase()));
            if (isRelevant) {
              const timestamp = entry.timestamp || '';
              const level = entry.level || 'info';
              const comp = entry.component ? `[${entry.component}]` : '';
              contextLines.push(`${timestamp} [${level}]${comp} ${message}`);
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
  } catch {
    // 日志目录读取失败
  }

  return contextLines;
}

/**
 * 基于规则的 Bug 分类和严重性评估
 */
function classifyBug(fields: BugReportFields): {
  classification: BugClassification;
  severity: 'critical' | 'high' | 'medium' | 'low';
  rootCauseVerification: string;
  impactAssessment: string;
  suggestions: Array<{ priority: number; suggestion: string }>;
} {
  const problemLower = fields.problem.toLowerCase();
  const errorLower = (fields.errorMessage || '').toLowerCase();
  const combined = `${problemLower} ${errorLower} ${(fields.rootCause || '').toLowerCase()}`;

  // 分类关键词映射
  const categoryMap: Array<{ keywords: string[]; category: string; subcategory: string }> = [
    { keywords: ['crash', '崩溃', 'segfault', 'null pointer', '空指针', 'fatal'], category: 'runtime_error', subcategory: 'crash' },
    { keywords: ['memory leak', '内存泄漏', 'oom', 'out of memory'], category: 'runtime_error', subcategory: 'memory' },
    { keywords: ['timeout', '超时', 'hang', '卡死', 'deadlock', '死锁'], category: 'performance', subcategory: 'responsiveness' },
    { keywords: ['slow', '性能', 'performance', 'latency', '延迟'], category: 'performance', subcategory: 'degradation' },
    { keywords: ['race condition', '竞态', 'concurrent', '并发'], category: 'concurrency', subcategory: 'race_condition' },
    { keywords: ['auth', '认证', 'permission', '权限', '401', '403', 'unauthorized'], category: 'security', subcategory: 'auth' },
    { keywords: ['xss', 'injection', '注入', 'csrf', 'sql'], category: 'security', subcategory: 'vulnerability' },
    { keywords: ['数据丢失', 'data loss', 'corruption', '数据损坏'], category: 'data_integrity', subcategory: 'corruption' },
    { keywords: ['ui', '界面', 'display', '显示', 'layout', '布局', '样式', 'style', 'css'], category: 'ui', subcategory: 'display' },
    { keywords: ['api', '接口', 'request', '请求', 'response', '响应', 'http'], category: 'api', subcategory: 'contract' },
    { keywords: ['build', '编译', 'compile', 'webpack', 'bundle'], category: 'build', subcategory: 'compilation' },
    { keywords: ['test', '测试', 'spec', 'assert'], category: 'testing', subcategory: 'failure' },
    { keywords: ['config', '配置', 'setting', '设置'], category: 'configuration', subcategory: 'misconfiguration' },
    { keywords: ['type', '类型', 'typescript', 'ts error'], category: 'type_system', subcategory: 'type_error' },
  ];

  let classification: BugClassification = { category: 'unknown', subcategory: 'unclassified', confidence: 0.3 };
  for (const rule of categoryMap) {
    if (rule.keywords.some(kw => combined.includes(kw))) {
      classification = { category: rule.category, subcategory: rule.subcategory, confidence: 0.8 };
      break;
    }
  }

  // 严重性评估
  let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
  if (combined.includes('crash') || combined.includes('崩溃') || combined.includes('fatal') ||
      combined.includes('data loss') || combined.includes('数据丢失') || combined.includes('security') ||
      combined.includes('安全') || combined.includes('segfault')) {
    severity = 'critical';
  } else if (combined.includes('timeout') || combined.includes('超时') || combined.includes('hang') ||
             combined.includes('卡死') || combined.includes('auth') || combined.includes('认证失败') ||
             combined.includes('memory leak') || combined.includes('内存泄漏')) {
    severity = 'high';
  } else if (combined.includes('ui') || combined.includes('界面') || combined.includes('display') ||
             combined.includes('样式') || combined.includes('style') || combined.includes('layout') ||
             combined.includes('布局') || combined.includes('config') || combined.includes('配置')) {
    severity = 'low';
  }

  // 根因验证
  let rootCauseVerification = '未能自动验证根因';
  if (fields.rootCause) {
    if (fields.errorMessage && fields.rootCause.toLowerCase().includes(fields.errorMessage.toLowerCase().substring(0, 20))) {
      rootCauseVerification = '根因描述与错误信息部分匹配';
    } else {
      rootCauseVerification = '根因已提供，需结合代码进一步验证';
    }
  } else {
    rootCauseVerification = '根因未提供，建议进行根因分析';
  }

  // 影响范围评估
  let impactAssessment = fields.impact || '影响范围未在 bug report 中明确说明';
  if (!fields.impact) {
    if (severity === 'critical') {
      impactAssessment = '根据严重性推断: 可能影响核心功能或数据安全，建议立即评估';
    } else if (severity === 'high') {
      impactAssessment = '根据严重性推断: 可能影响重要功能的可用性';
    } else {
      impactAssessment = '根据严重性推断: 影响范围有限，可能是局部问题';
    }
  }

  // 改进建议（按优先级排序）
  const suggestions: Array<{ priority: number; suggestion: string }> = [];

  if (!fields.rootCause) {
    suggestions.push({ priority: 1, suggestion: '进行根因分析: 使用 debugger 或日志定位根本原因' });
  }
  if (fields.reproductionSteps.length === 0) {
    suggestions.push({ priority: 2, suggestion: '补充复现步骤: 提供最小可复现示例' });
  }
  if (fields.relatedFiles.length === 0) {
    suggestions.push({ priority: 3, suggestion: '定位相关文件: 通过错误堆栈或代码搜索缩小范围' });
  }
  if (fields.suggestedFix) {
    suggestions.push({ priority: 4, suggestion: `验证修复方案: ${fields.suggestedFix.substring(0, 100)}` });
  } else {
    suggestions.push({ priority: 4, suggestion: '制定修复方案: 基于根因分析提出至少一个修复方案' });
  }
  suggestions.push({ priority: 5, suggestion: '添加回归测试: 编写测试防止问题复发' });
  if (severity === 'critical' || severity === 'high') {
    suggestions.push({ priority: 6, suggestion: '更新文档: 记录已知问题和解决方案供团队参考' });
  }

  return { classification, severity, rootCauseVerification, impactAssessment, suggestions };
}

/**
 * 生成 Bug 分析报告 Markdown（与 init-requirement --template detailed 对齐）
 */
function generateBugAnalysisMarkdown(
  fields: BugReportFields,
  logContext: string[],
  analysis: {
    classification: BugClassification;
    severity: 'critical' | 'high' | 'medium' | 'low';
    rootCauseVerification: string;
    impactAssessment: string;
    suggestions: Array<{ priority: number; suggestion: string }>;
  },
  reportTimestamp: string,
): string {
  const severityLabel: Record<string, string> = {
    critical: '🔴 紧急',
    high: '🟠 高',
    medium: '🟡 中',
    low: '🟢 低',
  };

  const parts: string[] = [];

  // 头部
  parts.push('# 任务描述');
  parts.push('');
  parts.push(`**来源**: Bug Report 分析转化`);
  parts.push(`**分析时间**: ${reportTimestamp}`);
  parts.push(`**分类**: ${analysis.classification.category}/${analysis.classification.subcategory}`);
  parts.push(`**严重性**: ${severityLabel[analysis.severity] || analysis.severity}`);
  parts.push('');

  // 问题描述
  parts.push('## 问题描述');
  parts.push(fields.problem || '（未提取到问题描述）');
  parts.push('');
  if (fields.errorMessage) {
    parts.push('### 错误信息');
    parts.push('```');
    parts.push(fields.errorMessage);
    parts.push('```');
    parts.push('');
  }
  if (fields.reproductionSteps.length > 0) {
    parts.push('### 复现步骤');
    fields.reproductionSteps.forEach((step, idx) => {
      parts.push(`${idx + 1}. ${step}`);
    });
    parts.push('');
  }
  if (fields.environment) {
    parts.push('### 环境信息');
    parts.push(fields.environment);
    parts.push('');
  }

  // 根因分析
  parts.push('## 根因分析');
  if (fields.rootCause) {
    parts.push(fields.rootCause);
  } else {
    parts.push('（根因未提供，需进一步分析）');
  }
  parts.push('');
  parts.push(`**根因验证**: ${analysis.rootCauseVerification}`);
  parts.push('');

  // 解决方案
  parts.push('## 解决方案');
  if (fields.suggestedFix) {
    parts.push(fields.suggestedFix);
  } else {
    parts.push('（修复方案未提供，需根据根因分析制定）');
  }
  parts.push('');

  // 影响范围评估
  parts.push('## 影响范围');
  parts.push(analysis.impactAssessment);
  parts.push('');

  // 日志上下文
  if (logContext.length > 0) {
    parts.push('## 日志上下文');
    parts.push('从 `.projmnt4claude/logs/` 提取的相关日志:');
    parts.push('');
    parts.push('```');
    logContext.slice(0, 50).forEach(line => {
      parts.push(line);
    });
    if (logContext.length > 50) {
      parts.push(`... 还有 ${logContext.length - 50} 条日志`);
    }
    parts.push('```');
    parts.push('');
  }

  // 改进建议
  parts.push('## 改进建议');
  analysis.suggestions.forEach(s => {
    parts.push(`${s.priority}. ${s.suggestion}`);
  });
  parts.push('');

  // 检查点
  const checkpoints = analysis.suggestions.map(s => s.suggestion);
  if (fields.reproductionSteps.length > 0) {
    checkpoints.unshift('复现问题: 按照复现步骤验证 bug 存在');
  }
  if (checkpoints.length > 0) {
    parts.push('## 检查点');
    checkpoints.forEach((cp, idx) => {
      parts.push(`- CP-${idx + 1}: ${cp}`);
    });
    parts.push('');
  }

  // 相关文件
  if (fields.relatedFiles.length > 0) {
    parts.push('## 相关文件');
    fields.relatedFiles.forEach(f => {
      parts.push(`- ${f}`);
    });
    parts.push('');
  }

  // 验收标准（与 detailed template 对齐）
  parts.push('## 验收标准');
  parts.push('请确保满足以下所有标准:');
  checkpoints.forEach((cp, idx) => {
    parts.push(`${idx + 1}. ${cp} 已完成并验证`);
  });
  parts.push(`${checkpoints.length + 1}. 代码已通过 lint 检查`);
  parts.push(`${checkpoints.length + 2}. 相关测试已通过`);
  parts.push('');

  return parts.join('\n');
}

/**
 * 生成结构化需求描述（可作为 init-requirement 输入）
 */
function generateRequirementFromAnalysis(
  fields: BugReportFields,
  analysis: {
    classification: BugClassification;
    severity: 'critical' | 'high' | 'medium' | 'low';
    suggestions: Array<{ priority: number; suggestion: string }>;
  },
): string {
  const severityLabel: Record<string, string> = {
    critical: '紧急',
    high: '高',
    medium: '中',
    low: '低',
  };

  const parts: string[] = [];
  parts.push(`[Bug修复-${analysis.classification.category}] ${fields.problem.substring(0, 80)}`);
  parts.push('');
  parts.push('问题描述:');
  parts.push(fields.problem);
  if (fields.errorMessage) {
    parts.push(`错误: ${fields.errorMessage.substring(0, 200)}`);
  }
  if (fields.rootCause) {
    parts.push(`根因: ${fields.rootCause}`);
  }
  if (fields.suggestedFix) {
    parts.push(`建议修复: ${fields.suggestedFix}`);
  }
  parts.push(`严重性: ${severityLabel[analysis.severity]}`);
  parts.push(`分类: ${analysis.classification.category}/${analysis.classification.subcategory}`);
  if (analysis.suggestions.length > 0) {
    parts.push('检查点:');
    analysis.suggestions.forEach(s => {
      parts.push(`- ${s.suggestion}`);
    });
  }
  if (fields.relatedFiles.length > 0) {
    parts.push('相关文件:');
    fields.relatedFiles.forEach(f => {
      parts.push(`- ${f}`);
    });
  }

  return parts.join('\n');
}

/**
 * 导出训练数据为 JSONL 格式
 */
function exportTrainingDataToJsonl(
  fields: BugReportFields,
  analysis: BugReportAnalysis,
  exportPath: string,
): void {
  const trainingEntry = {
    input: JSON.stringify({
      problem: fields.problem,
      rootCause: fields.rootCause,
      reproductionSteps: fields.reproductionSteps,
      errorMessage: fields.errorMessage,
      suggestedFix: fields.suggestedFix,
      relatedFiles: fields.relatedFiles,
    }),
    output: JSON.stringify({
      classification: analysis.classification,
      severity: analysis.severity,
      rootCauseVerification: analysis.rootCauseVerification,
      impactAssessment: analysis.impactAssessment,
      suggestions: analysis.improvementSuggestions,
    }),
    metadata: {
      timestamp: new Date().toISOString(),
      category: analysis.classification.category,
      subcategory: analysis.classification.subcategory,
      severity: analysis.severity,
      confidence: analysis.classification.confidence,
    },
  };

  // JSONL: 每行一个 JSON 对象
  const line = JSON.stringify(trainingEntry);
  fs.appendFileSync(exportPath, line + '\n', 'utf-8');
}

/**
 * Bug Report 分析核心函数
 *
 * 读取 Bug Report Markdown 文档，提取问题描述/根因分析/复现步骤/建议修复，
 * 结合日志上下文进行分类和严重性评估，输出与 init-requirement --template detailed
 * 对齐的结构化 Markdown 分析报告。
 *
 * @param bugReportPath - Bug report 文件路径或包含 bug report 的目录路径
 * @param cwd - 项目工作目录
 * @param options - 分析选项
 */
export async function analyzeBugReport(
  bugReportPath: string,
  cwd: string = process.cwd(),
  options: BugReportOptions = {},
): Promise<BugReportAnalysis> {
  const logger = createLogger('analyze-bug-report', cwd);
  const startTime = Date.now();

  // CP-1: 检测 bug report 路径
  const resolvedPath = path.resolve(bugReportPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Bug report 路径不存在: ${resolvedPath}`);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🐛 Bug Report 分析模式');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(`  输入: ${resolvedPath}`);
  console.log('');

  // 读取 bug report 内容
  let markdown: string;
  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    // 如果是目录，查找目录下的 .md 文件
    const mdFiles = fs.readdirSync(resolvedPath)
      .filter(f => f.endsWith('.md') || f.endsWith('.markdown'));
    if (mdFiles.length === 0) {
      throw new Error(`目录中未找到 Markdown 文件: ${resolvedPath}`);
    }
    // 取最新的 md 文件
    const sorted = mdFiles
      .map(f => ({ name: f, path: path.join(resolvedPath, f), mtime: fs.statSync(path.join(resolvedPath, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const latestFile = sorted[0];
    if (!latestFile) {
      throw new Error(`目录中未找到有效的 Markdown 文件: ${resolvedPath}`);
    }
    markdown = fs.readFileSync(latestFile.path, 'utf-8');
    console.log(`  使用文件: ${latestFile.name}`);
  } else {
    markdown = fs.readFileSync(resolvedPath, 'utf-8');
  }

  // CP-6: 提取 bug report 字段
  console.log('  📋 提取 Bug Report 字段...');
  const fields = extractBugReportFields(markdown);
  console.log(`    问题描述: ${fields.problem.substring(0, 60)}...`);
  console.log(`    复现步骤: ${fields.reproductionSteps.length} 项`);
  console.log(`    相关文件: ${fields.relatedFiles.length} 个`);
  console.log('');

  // CP-7: 加载日志上下文
  console.log('  📂 加载日志上下文...');
  const keywords = [
    ...fields.problem.split(/\s+/).filter(w => w.length > 3).slice(0, 5),
    ...(fields.errorMessage ? [fields.errorMessage.substring(0, 30)] : []),
  ];
  const logContext = loadLogContext(cwd, keywords);
  console.log(`    相关日志: ${logContext.length} 条`);
  console.log('');

  // CP-8: 分类和严重性评估（规则引擎基础 + AI 增强）
  console.log('  🔍 执行分类和严重性评估...');
  const analysis = classifyBug(fields);

  // CP-8: AI 辅助深层分析 — 当未禁用 AI 时调用 AIMetadataAssistant 增强规则引擎结果
  let aiUsed = false;
  let aiEnhancedFields: string[] = [];
  if (options.noAi !== true) {
    try {
      const aiAssistant = new AIMetadataAssistant(cwd);
      const logContextStr = logContext.length > 0 ? logContext.join('\n') : undefined;
      const aiResult = await aiAssistant.analyzeBugReport(markdown, logContextStr, { cwd });

      if (aiResult.aiUsed) {
        aiUsed = true;

        // AI 提供的任务类型信息增强分类
        if (aiResult.type) {
          analysis.classification.subcategory = `${analysis.classification.subcategory} (AI: ${aiResult.type})`;
          aiEnhancedFields.push('classification');
        }

        // AI 优先级评估可能更准确，取更严重的结果
        if (aiResult.priority) {
          const priorityToSeverity: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
            P0: 'critical', P1: 'high', P2: 'medium', P3: 'low',
          };
          const aiSeverity = priorityToSeverity[aiResult.priority];
          if (aiSeverity) {
            const severityOrder = ['low', 'medium', 'high', 'critical'];
            if (severityOrder.indexOf(aiSeverity) > severityOrder.indexOf(analysis.severity)) {
              analysis.severity = aiSeverity;
              aiEnhancedFields.push('severity');
            }
          }
        }

        // AI 根因验证
        if (aiResult.rootCause) {
          analysis.rootCauseVerification = `AI 验证: ${aiResult.rootCause}`;
          aiEnhancedFields.push('rootCauseVerification');
        }

        // AI 影响范围评估
        if (aiResult.impactScope) {
          analysis.impactAssessment = `AI 评估: ${aiResult.impactScope}`;
          aiEnhancedFields.push('impactAssessment');
        }

        // AI 检查点作为改进建议追加
        if (aiResult.checkpoints && aiResult.checkpoints.length > 0) {
          const maxExistingPriority = analysis.suggestions.length > 0
            ? Math.max(...analysis.suggestions.map(s => s.priority))
            : 0;
          for (let i = 0; i < aiResult.checkpoints.length; i++) {
            analysis.suggestions.push({
              priority: maxExistingPriority + i + 1,
              suggestion: `[AI] ${aiResult.checkpoints[i]}`,
            });
          }
          aiEnhancedFields.push('suggestions');
        }

        console.log(`    ✅ AI 分析完成，增强了 ${aiEnhancedFields.length} 个字段`);
      }
    } catch (aiError) {
      console.log(`    ⚠️  AI 分析失败，使用规则引擎结果: ${aiError instanceof Error ? aiError.message : String(aiError)}`);
    }
  }

  console.log(`    分类: ${analysis.classification.category}/${analysis.classification.subcategory}`);
  console.log(`    严重性: ${analysis.severity}`);
  console.log(`    根因验证: ${analysis.rootCauseVerification}`);
  console.log('');

  // CP-9 & CP-10: 生成结构化 Markdown（与 init-requirement detailed template 对齐）
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportMarkdown = generateBugAnalysisMarkdown(fields, logContext, analysis, timestamp);

  // CP-11: 写入报告文件
  const reportsDir = getReportsDir(cwd);
  ensureDir(reportsDir);
  const reportPath = path.join(reportsDir, `bug-analysis-${timestamp}.md`);
  fs.writeFileSync(reportPath, reportMarkdown, 'utf-8');
  console.log(`  📄 报告已写入: ${reportPath}`);
  console.log('');

  // 生成需求描述（可用于 init-requirement）
  const requirementDescription = generateRequirementFromAnalysis(fields, analysis);

  const result: BugReportAnalysis = {
    fields,
    logContext,
    classification: analysis.classification,
    severity: analysis.severity,
    rootCauseVerification: analysis.rootCauseVerification,
    impactAssessment: analysis.impactAssessment,
    improvementSuggestions: analysis.suggestions,
    requirementDescription,
    reportMarkdown,
    reportPath,
  };

  // CP-4: 可选训练数据导出
  if (options.exportTrainingData) {
    const config = readConfig(cwd);
    const trainingConfig = config?.training as Record<string, unknown> | undefined;
    const trainingEnabled = trainingConfig?.exportEnabled === true;
    if (!trainingEnabled) {
      console.log('  ⚠️  训练数据导出未启用。请在 config.json 中设置 training.exportEnabled: true');
    } else {
      const trainingDir = path.join(getProjectDir(cwd), 'training');
      ensureDir(trainingDir);
      const exportPath = path.join(trainingDir, 'bug-analysis-training.jsonl');
      exportTrainingDataToJsonl(fields, result, exportPath);
      console.log(`  📊 训练数据已追加: ${exportPath}`);
      console.log('');
    }
  }

  // CP-3: 自动流转提示
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('💡 下一步:');
  console.log(`   将分析结果转化为改进任务:`);
  console.log(`   projmnt4claude init-requirement "${requirementDescription.replace(/"/g, '\\"').substring(0, 200)}..." --template detailed`);
  console.log('');
  console.log(`   或直接使用报告文件:`);
  console.log(`   projmnt4claude init-requirement "$(cat ${reportPath})" --template detailed`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 记录埋点
  logger.logInstrumentation({
    module: 'analyze-bug-report',
    action: 'analyze',
    input_summary: `path=${resolvedPath}, size=${markdown.length}`,
    output_summary: `classification=${analysis.classification.category}, severity=${analysis.severity}, report=${reportPath}`,
    ai_used: aiUsed,
    ai_enhanced_fields: aiEnhancedFields,
    duration_ms: Date.now() - startTime,
    user_edit_count: 0,
    module_data: {
      reproductionSteps: fields.reproductionSteps.length,
      relatedFiles: fields.relatedFiles.length,
      logContextEntries: logContext.length,
      suggestions: analysis.suggestions.length,
    },
  });
  logger.flush();

  return result;
}
