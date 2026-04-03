import prompts from 'prompts';
import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, getTasksDir, getArchiveDir, getProjectDir } from '../utils/path';
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
} from '../types/task';
import {
  parseTaskId,
  generateTaskId,
  inferTaskType,
  CURRENT_TASK_SCHEMA_VERSION,
  PIPELINE_INTERMEDIATE_STATUSES,
  PIPELINE_STATUS_MIGRATION_MAP,
} from '../types/task';
import type { VerdictAction } from '../types/harness';
import { VALID_VERDICT_ACTIONS } from '../types/harness';
import { generateCheckpointId } from '../utils/checkpoint';
import { inferCheckpointsFromDescription } from '../utils/description-template';
import { SEPARATOR_WIDTH } from '../utils/format';
import type { SprintContract } from '../types/harness';

import { areDependenciesCompleted } from '../utils/plan';
import { readConfig } from './config';

// ============== Analyze 配置 ==============

/**
 * analyze 命令的配置选项
 * 在 .projmnt4claude/config.json 的 "analyze" 字段中定义
 */
export interface AnalyzeConfig {
  /** 是否自动生成检查点 (默认 true) */
  autoGenerateCheckpoints?: boolean;
  /** 检查点生成器类型: "ai-powered" | "simple" (默认 "ai-powered") */
  checkpointGenerator?: 'ai-powered' | 'simple';
  /** 检查点最低覆盖率阈值 0-1 (默认 0.8)，低于此阈值会产生警告 */
  minCheckpointCoverage?: number;
  /** 忽略的任务 ID 匹配模式 (支持 * 通配符)，如 ["TASK-test-*"] */
  ignorePatterns?: string[];
}

const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  autoGenerateCheckpoints: true,
  checkpointGenerator: 'ai-powered',
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
    checkpointGenerator: userConfig.checkpointGenerator === 'simple' || userConfig.checkpointGenerator === 'ai-powered'
      ? userConfig.checkpointGenerator
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

/**
 * 优先级映射：将旧格式 (urgent/high/medium/low) 映射到新格式 (P0/P1/P2/P3)
 */
function normalizePriority(priority: string): TaskPriority {
  const priorityMap: Record<string, TaskPriority> = {
    'urgent': 'P0',
    'high': 'P1',
    'medium': 'P2',
    'low': 'P3',
    // 已经是新格式的直接返回
    'P0': 'P0',
    'P1': 'P1',
    'P2': 'P2',
    'P3': 'P3',
    'Q1': 'Q1',
    'Q2': 'Q2',
    'Q3': 'Q3',
    'Q4': 'Q4',
  };
  return priorityMap[priority] || 'P2'; // 默认为 P2
}

/**
 * 状态映射：将旧格式/变体格式映射到标准格式
 */
function normalizeStatus(status: string): TaskStatus {
  const statusMap: Record<string, TaskStatus> = {
    // 旧格式映射
    'pending': 'open',
    'reopen': 'reopened',
    'completed': 'closed',
    'cancelled': 'abandoned',
    'blocked': 'open',
    // 标准格式直接返回
    'open': 'open',
    'in_progress': 'in_progress',
    'resolved': 'resolved',
    'closed': 'closed',
    'reopened': 'reopened',
    'abandoned': 'abandoned',
  };
  return statusMap[status] || 'open';
}

// ============== 规范验证辅助函数 ==============

/**
 * 有效的任务状态值
 */
const VALID_STATUSES: TaskStatus[] = ['open', 'in_progress', 'wait_review', 'wait_qa', 'wait_complete', 'needs_human', 'resolved', 'closed', 'reopened', 'abandoned'];

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
      const invalidActionEntries: number[] = [];
      for (let i = 0; i < (task.history?.length || 0); i++) {
        const entry = task.history![i]!;
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

/**
 * 检测 slug 是否无意义
 * 无意义的 slug 包括：
 * - 哈希生成的短标识 (如 t1a2b3c, t5f8e2d)
 * - 空或极短 (<=2 字符)
 * - 通用词 task 或 task- 前缀
 */
function isMeaninglessSlug(slug: string): boolean {
  if (!slug || slug.length === 0) return true;
  // 哈希生成的标识: t + 短字母数字 (如 t1a2b3c)
  if (/^t[0-9a-z]+$/.test(slug) && slug.length <= 12) return true;
  // 通用词: task 或 task- 前缀
  if (slug === 'task' || slug.startsWith('task-')) return true;
  return false;
}

/**
 * 从 description/title 提取有意义的关键词生成 slug
 */
function extractSlugFromTask(task: TaskMeta): string {
  const source = task.description || task.title || '';
  if (!source) return '';

  // 优先提取英文关键词
  const englishWords = source.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) || [];
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'add', 'implement', 'ensure', 'verify', 'complete', 'check', 'update',
    'option', 'options', 'task', 'feature', 'bug', 'fix', 'and', 'or',
    'not', 'this', 'that', 'it', 'its', 'but', 'if', 'so', 'no', 'yes',
  ]);

  const meaningful = englishWords
    .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)
    .map(w => w.toLowerCase());

  if (meaningful.length > 0) {
    // 取前 4 个关键词组成 slug
    return meaningful.slice(0, 4).join('-').substring(0, 40);
  }

  // 中文标题：生成短哈希标识（与 generateTaskId 相同逻辑，但用 description 内容）
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return `t${Math.abs(hash).toString(36)}`;
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
    | 'schema_version_outdated';
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
export function calculateContentQuality(task: TaskMeta): ContentQualityScore {
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

  // 3. 关联文件检测
  const filesResult = evaluateRelatedFiles(task.description, task.checkpoints);
  relatedFilesScore = filesResult.score;
  deductions.push(...filesResult.deductions);

  // 4. 解决方案检测
  const solResult = evaluateSolution(task.description);
  solutionScore = solResult.score;
  deductions.push(...solResult.deductions);

  // 计算总分 (加权平均)
  const totalScore = Math.round(
    descriptionScore * 0.35 +
    checkpointScore * 0.30 +
    relatedFilesScore * 0.15 +
    solutionScore * 0.20
  );

  return {
    totalScore,
    descriptionScore,
    checkpointScore,
    relatedFilesScore,
    solutionScore,
    deductions,
    checkedAt: new Date().toISOString(),
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
 * 评估关联文件
 */
function evaluateRelatedFiles(
  description?: string,
  checkpoints?: CheckpointMetadata[]
): { score: number; deductions: QualityDeduction[] } {
  const deductions: QualityDeduction[] = [];
  let score = 100;

  // 从描述中检测文件引用
  const descFiles = extractFileReferences(description || '');

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
 * 从文本中提取文件引用
 * BUG-012-0: 仅匹配包含目录分隔符的路径，避免误匹配裸文件名
 */
function extractFileReferences(text: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    // 标准源码路径（至少一级目录）
    /(?:src|lib|test|tests|docs|bin|scripts|config)\/[\w/.-]+\.[a-z]+/g,
    // 相对路径
    /\.{1,2}\/[\w/.-]+\.[a-z]+/g,
    // 带目录分隔符的文件路径（至少包含一个 /）
    /[\w-]+\/[\w/.-]+\.(ts|tsx|js|jsx|py|go|java|rs|md|json|yaml|yml)/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (!seen.has(match)) {
          seen.add(match);
          files.push(match);
        }
      }
    }
  }

  return files;
}

/**
 * 执行内容质量检测
 */
export function performQualityCheck(cwd: string = process.cwd()): Map<string, ContentQualityScore> {
  const tasks = getAllTasks(cwd, false);
  const scores = new Map<string, ContentQualityScore>();

  for (const task of tasks) {
    const score = calculateContentQuality(task);
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
 * 分析项目健康状态
 */
export function analyzeProject(cwd: string = process.cwd(), includeArchived: boolean = false): AnalysisResult {
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
      reopened: 0,
      abandoned: 0,
      needs_human: 0,
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
    const updatedAt = new Date(task.updatedAt);
    if (now.getTime() - updatedAt.getTime() > staleThreshold &&
        (normalizedStatus === 'open' || normalizedStatus === 'in_progress')) {
      stats.stale++;
      issues.push({
        taskId: task.id,
        type: 'stale',
        severity: 'medium',
        message: `任务已 ${Math.floor((now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000))} 天未更新`,
        suggestion: '检查任务是否仍然相关，考虑更新状态或关闭',
      });
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
          migrationReason: task.status === 'needs_human'
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

    // 3. 检测状态与 reopenCount 不一致
    if (normalizedStatus === 'reopened' && (task.reopenCount === undefined || task.reopenCount === 0)) {
      issues.push({
        taskId: task.id,
        type: 'status_reopen_mismatch',
        severity: 'medium',
        message: '任务状态为 reopened 但 reopenCount 为 0 或未设置',
        suggestion: '设置 reopenCount >= 1 或将状态改为其他值',
        details: { status: task.status, reopenCount: task.reopenCount },
      });
    }

    // 4. 检测无效的类型值
    if (!isValidTypeValue(task.type)) {
      issues.push({
        taskId: task.id,
        type: 'invalid_status_value',
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
        type: 'invalid_status_value',
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
        suggestion: '运行 analyze --fix-verification 自动回填 verification 字段',
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
        suggestion: '运行 analyze --fix-status 自动将状态改为 reopened，或手动检查验收标准',
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

    // 12. 检测引用文件不存在 (file_not_found)
    const taskText = `${task.description || ''}\n${task.title || ''}`;
    const referencedFiles = extractFileReferences(taskText);
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

  return { issues, stats };
}

/**
 * 显示分析结果
 * 重构版本：仅显示问题分析，不重复输出统计信息
 */
export function showAnalysis(options: { compact?: boolean } = {}, cwd: string = process.cwd()): void {
  const result = analyzeProject(cwd);

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
}

/**
 * 修复选项类型
 */
export interface FixOptions {
  nonInteractive?: boolean;
  fixType?: 'all' | 'verification' | 'status' | 'checkpoints';
}

/**
 * 判断问题类型是否属于 verification 类别
 */
function isVerificationIssue(type: Issue['type']): boolean {
  return type === 'manual_verification' || type === 'missing_verification';
}

/**
 * 判断问题类型是否属于 status 类别
 */
function isStatusIssue(type: Issue['type']): boolean {
  return [
    'legacy_status',
    'invalid_status_value',
    'status_reopen_mismatch',
    'inconsistent_status',
    'legacy_priority',
    'legacy_schema',
    'missing_createdBy',
    'invalid_timestamp_format',
    'pipeline_status_migration',
    'verdict_action_schema',
    'schema_version_outdated',
  ].includes(type);
}

/**
 * 修复单个问题
 * @returns 修复结果: 'fixed' | 'skipped' | 'unfixable'
 */
async function fixSingleIssue(
  issue: Issue,
  cwd: string,
  nonInteractive: boolean
): Promise<'fixed' | 'skipped' | 'unfixable'> {
  const task = readTaskMeta(issue.taskId, cwd);
  if (!task) return 'skipped';

  switch (issue.type) {
    case 'stale': {
      if (nonInteractive) {
        console.log(`⏭️  跳过过期任务 ${issue.taskId} (非交互模式下需要手动处理)`);
        return 'skipped';
      }
      console.log(`检查过期任务 ${issue.taskId}...`);
      const response = await prompts({
        type: 'select',
        name: 'action',
        message: `任务 ${issue.taskId} 已过期，如何处理?`,
        choices: [
          { title: '标记为已关闭', value: 'close' },
          { title: '标记为进行中', value: 'progress' },
          { title: '跳过', value: 'skip' },
        ],
      });

      if (response.action === 'close') {
        task.status = 'closed';
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已关闭任务 ${issue.taskId}`);
        return 'fixed';
      } else if (response.action === 'progress') {
        task.status = 'in_progress';
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将任务 ${issue.taskId} 标记为进行中`);
        return 'fixed';
      }
      return 'skipped';
    }

    case 'no_description': {
      if (nonInteractive) {
        console.log(`⏭️  跳过无描述任务 ${issue.taskId} (非交互模式下需要手动处理)`);
        return 'skipped';
      }
      console.log(`检查无描述任务 ${issue.taskId}...`);
      const response = await prompts({
        type: 'text',
        name: 'description',
        message: `为任务 ${issue.taskId} 添加描述 (留空跳过):`,
      });

      if (response.description && response.description.trim()) {
        task.description = response.description.trim();
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已为任务 ${issue.taskId} 添加描述`);
        return 'fixed';
      }
      return 'skipped';
    }

    case 'cycle': {
      console.log(`⚠️  任务 ${issue.taskId} 存在循环依赖，需要手动处理`);
      return 'unfixable';
    }

    case 'legacy_priority': {
      console.log(`🔄 修复任务 ${issue.taskId} 的优先级格式...`);
      const oldPriority = task.priority;
      const newPriority = normalizePriority(task.priority);
      task.priority = newPriority;
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已将优先级从 ${oldPriority} 更新为 ${newPriority}`);
      return 'fixed';
    }

    case 'legacy_status': {
      console.log(`🔄 修复任务 ${issue.taskId} 的状态格式...`);
      const oldStatus = task.status;
      const newStatus = normalizeStatus(task.status);
      task.status = newStatus;
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已将状态从 ${oldStatus} 更新为 ${newStatus}`);
      return 'fixed';
    }

    case 'legacy_schema': {
      console.log(`🔄 修复任务 ${issue.taskId} 的规范字段...`);
      if (task.reopenCount === undefined) {
        task.reopenCount = 0;
        console.log(`  ✅ 已添加 reopenCount: 0`);
      }
      if (task.requirementHistory === undefined) {
        task.requirementHistory = [];
        console.log(`  ✅ 已添加 requirementHistory: []`);
      }
      writeTaskMeta(task, cwd);
      return 'fixed';
    }

    case 'pipeline_status_migration': {
      console.log(`🔄 迁移任务 ${issue.taskId} 的 pipeline 状态...`);
      const oldStatus = task.status;
      const targetStatus = issue.details?.targetStatus as TaskStatus;
      if (targetStatus && PIPELINE_STATUS_MIGRATION_MAP[oldStatus]) {
        task.status = targetStatus;
        task.history.push({
          timestamp: new Date().toISOString(),
          action: `pipeline_status_migration`,
          field: 'status',
          oldValue: oldStatus,
          newValue: targetStatus,
          reason: `analyze 迁移: pipeline 中间状态 ${oldStatus} → ${targetStatus}`,
          user: 'analyze-fix',
        });
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 状态已从 ${oldStatus} 迁移为 ${targetStatus}`);
        return 'fixed';
      }
      console.log(`  ⚠️ 无法确定迁移目标状态`);
      return 'unfixable';
    }

    case 'verdict_action_schema': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效 VerdictAction 值...`);
      let fixedAny = false;

      // 修复 history 中的无效 verdict action
      for (let i = 0; i < (task.history?.length || 0); i++) {
        const entry = task.history![i]!;
        if (entry.action === 'verdict' && entry.newValue && typeof entry.newValue === 'string') {
          if (!VALID_VERDICT_ACTIONS.includes(entry.newValue as VerdictAction)) {
            const oldVal = entry.newValue;
            entry.newValue = `[migrated: invalid_verdict_action "${oldVal}" removed]`;
            console.log(`  ✅ history[${i}]: 清除无效 verdict action "${oldVal}"`);
            fixedAny = true;
          }
        }
      }

      // 修复 verification 中的无效 verdictAction
      if (task.verification) {
        const verification = task.verification as unknown as Record<string, unknown>;
        if (verification.verdictAction && typeof verification.verdictAction === 'string') {
          if (!VALID_VERDICT_ACTIONS.includes(verification.verdictAction as VerdictAction)) {
            const oldVal = verification.verdictAction as string;
            delete verification.verdictAction;
            console.log(`  ✅ verification: 清除无效 verdictAction "${oldVal}"`);
            fixedAny = true;
          }
        }
      }

      if (fixedAny) {
        writeTaskMeta(task, cwd);
        return 'fixed';
      }
      return 'skipped';
    }

    case 'schema_version_outdated': {
      console.log(`🔄 迁移任务 ${issue.taskId} 的 schema 版本...`);
      const migrationResult = applySchemaMigrations(task);
      if (migrationResult.changed) {
        writeTaskMeta(task, cwd);
        for (const detail of migrationResult.details) {
          console.log(`  ✅ ${detail}`);
        }
        return 'fixed';
      }
      return 'skipped';
    }

    case 'missing_createdBy': {
      console.log(`🔄 修复任务 ${issue.taskId} 的 createdBy 字段...`);
      if (!task.createdBy) {
        task.createdBy = 'import';
        console.log(`  ✅ 已添加 createdBy: import`);
      }
      writeTaskMeta(task, cwd);
      return 'fixed';
    }

    case 'invalid_status_value': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效状态值...`);
      if (issue.details?.currentValue) {
        const oldStatus = task.status;
        task.status = normalizeStatus(task.status);
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将状态从 ${oldStatus} 更新为 ${task.status}`);
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'status_reopen_mismatch': {
      console.log(`🔄 修复任务 ${issue.taskId} 的 reopenCount 不一致...`);
      const reopenFromHistory = task.history?.filter(
        (h) => h.action === 'status_change' && h.newValue === 'reopened'
      ).length || 0;
      task.reopenCount = Math.max(1, reopenFromHistory);
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已将 reopenCount 设置为 ${task.reopenCount}`);
      return 'fixed';
    }

    case 'inconsistent_status': {
      console.log(`🔄 修复任务 ${issue.taskId} 的状态矛盾 (resolved + verification.failed)...`);
      // 将状态改回 reopened，清除旧的 verification
      task.status = 'reopened';
      task.verification = undefined;
      task.updatedAt = new Date().toISOString();
      task.history.push({
        timestamp: new Date().toISOString(),
        action: `状态变更: resolved → reopened`,
        field: 'status',
        oldValue: 'resolved',
        newValue: 'reopened',
        reason: '修复状态矛盾: resolved 但 verification.result=failed',
        user: 'analyze-fix',
      });
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已将状态从 resolved 改为 reopened，清除旧 verification`);
      return 'fixed';
    }

    case 'invalid_timestamp_format': {
      console.log(`🔄 修复任务 ${issue.taskId} 的时间戳格式...`);
      if (issue.details?.field) {
        const field = issue.details.field as string;
        const now = new Date().toISOString();
        if (field === 'createdAt' || field === 'updatedAt') {
          (task as unknown as Record<string, unknown>)[field] = now;
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将 ${field} 更新为 ${now}`);
          return 'fixed';
        }
      }
      return 'unfixable';
    }

    case 'invalid_parent_ref': {
      console.log(`⚠️  任务 ${issue.taskId} 的父任务引用无效，无法自动修复`);
      console.log(`   建议: 手动检查并删除无效的 parentId 或创建父任务`);
      return 'unfixable';
    }

    case 'invalid_subtask_ref': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效子任务引用...`);
      if (task.subtaskIds && issue.details?.subtaskId) {
        const invalidId = issue.details.subtaskId as string;
        const oldLength = task.subtaskIds.length;
        task.subtaskIds = task.subtaskIds.filter(id => id !== invalidId);
        if (task.subtaskIds.length < oldLength) {
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已从 subtaskIds 中移除无效引用 ${invalidId}`);
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'invalid_dependency_ref': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效依赖引用...`);
      if (task.dependencies && issue.details?.dependencyId) {
        const invalidId = issue.details.dependencyId as string;
        const oldLength = task.dependencies.length;
        task.dependencies = task.dependencies.filter(id => id !== invalidId);
        if (task.dependencies.length < oldLength) {
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已从 dependencies 中移除无效引用 ${invalidId}`);
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'subtask_not_in_parent': {
      console.log(`🔄 修复子任务 ${issue.taskId} 在父任务中的引用...`);
      if (task.parentId) {
        const parentTask = readTaskMeta(task.parentId, cwd);
        if (parentTask) {
          if (!parentTask.subtaskIds) {
            parentTask.subtaskIds = [];
          }
          if (!parentTask.subtaskIds.includes(task.id)) {
            parentTask.subtaskIds.push(task.id);
            writeTaskMeta(parentTask, cwd);
            console.log(`  ✅ 已将子任务添加到父任务的 subtaskIds 中`);
            return 'fixed';
          }
        }
      }
      return 'skipped';
    }

    case 'parent_child_mismatch': {
      console.log(`🔄 修复任务 ${issue.taskId} 的父子关系不一致...`);
      if (issue.details?.subtaskId && issue.details?.expectedParentId) {
        const subtaskId = issue.details.subtaskId as string;
        const subtask = readTaskMeta(subtaskId, cwd);
        if (subtask) {
          subtask.parentId = issue.details.expectedParentId as string;
          writeTaskMeta(subtask, cwd);
          console.log(`  ✅ 已将子任务 ${subtaskId} 的 parentId 更新为 ${subtask.parentId}`);
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'meaningless_id': {
      // 从 description/title 提取关键词生成新 ID
      const slug = extractSlugFromTask(task);
      if (!slug || isMeaninglessSlug(slug)) {
        console.log(`⚠️  任务 ${issue.taskId} 无法提取有意义的关键词，跳过重命名`);
        return 'unfixable';
      }

      const idInfo = parseTaskId(task.id);
      // 优先使用 task 自身的 type/priority（更可靠），再从 ID 解析
      const taskType = (task.type || idInfo.type || 'feature') as TaskType;
      const taskPriority = (task.priority || idInfo.priority) as TaskPriority;
      const existingIds = getAllTaskIds(cwd);
      const newId = generateTaskId(taskType, taskPriority, slug, existingIds);

      if (newId === task.id) {
        console.log(`  ⏭️  任务 ${issue.taskId} 生成的 ID 与当前相同，跳过`);
        return 'skipped';
      }

      console.log(`🔄 重命名任务: ${task.id} → ${newId}`);
      const result = renameTask(task.id, newId, cwd);
      if (result.success) {
        console.log(`  ✅ 已重命名为 ${newId}`);
        return 'fixed';
      }
      console.log(`  ❌ 重命名失败: ${result.error}`);
      return 'unfixable';
    }

    case 'invalid_history_format':
    case 'invalid_requirement_history_format':
    case 'invalid_task_id_format': {
      console.log(`⚠️  任务 ${issue.taskId} 的 ${issue.type} 问题无法自动修复`);
      console.log(`   建议: ${issue.suggestion}`);
      return 'unfixable';
    }

    case 'manual_verification': {
      console.log(`🔄 修复任务 ${issue.taskId} 的 manual 验证方法...`);
      if (task.checkpoints && issue.details?.checkpointIds) {
        let fixedCount_local = 0;
        for (const cpId of issue.details.checkpointIds as string[]) {
          const cp = task.checkpoints.find(c => c.id === cpId);
          if (cp && cp.verification && (cp.verification.method as string) === 'manual') {
            cp.verification.method = 'automated';
            console.log(`  ✅ 检查点 ${cpId}: manual -> automated`);
            fixedCount_local++;
          }
        }
        if (fixedCount_local > 0) {
          writeTaskMeta(task, cwd);
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'missing_verification': {
      console.log(`🔄 修复任务 ${issue.taskId} 的缺失 verification 字段...`);
      if (task.status === 'resolved' && !task.verification) {
        task.verification = buildTaskVerification(task);
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已自动填充 verification 字段`);
        console.log(`     结果: ${task.verification.result}`);
        console.log(`     完成率: ${task.verification.checkpointCompletionRate}%`);
        return 'fixed';
      }
      return 'skipped';
    }
    case 'abandoned_residual': {
      const archiveDir = getArchiveDir(cwd);
      const tasksToDelete = (issue.details?.tasks as string[]) || [];
      if (tasksToDelete.length === 0) return 'skipped';

      if (nonInteractive) {
        let deleted = 0;
        for (const taskId of tasksToDelete) {
          const dirPath = path.join(archiveDir, taskId);
          try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            deleted++;
          } catch {
            console.error(`  ❌ 删除 ${taskId} 失败`);
          }
        }
        console.log(`  ✅ 已清除 ${deleted} 个 abandoned 残留任务`);
        return deleted > 0 ? 'fixed' : 'skipped';
      } else {
        console.log(`检查 abandoned 残留任务...`);
        console.log(`  发现 ${tasksToDelete.length} 个: ${tasksToDelete.join(', ')}`);
        const response = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: `是否清除这些 abandoned 残留任务?`,
          initial: true,
        });
        if (response.confirm) {
          let deleted = 0;
          for (const taskId of tasksToDelete) {
            const dirPath = path.join(archiveDir, taskId);
            try {
              fs.rmSync(dirPath, { recursive: true, force: true });
              deleted++;
            } catch {
              console.error(`  ❌ 删除 ${taskId} 失败`);
            }
          }
          console.log(`  ✅ 已清除 ${deleted} 个 abandoned 残留任务`);
          return deleted > 0 ? 'fixed' : 'skipped';
        }
        return 'skipped';
      }
    }

    case 'file_not_found': {
      console.log(`⚠️  任务 ${issue.taskId} 引用了不存在的文件，无法自动修复`);
      if (issue.details?.missingFiles) {
        console.log(`   不存在的文件: ${(issue.details.missingFiles as string[]).join(', ')}`);
      }
      console.log(`   建议: ${issue.suggestion}`);
      return 'unfixable';
    }

    default:
      return 'unfixable';
  }
}

/**
 * 自动修复问题
 * @param cwd 工作目录
 * @param options 修复选项
 */
export async function fixIssues(
  cwd: string = process.cwd(),
  options: FixOptions = {}
): Promise<{ fixed: number; skipped: number; unfixable: number }> {
  const { nonInteractive = false, fixType = 'all' } = options;
  const result = analyzeProject(cwd);

  if (result.issues.length === 0) {
    console.log('✅ 没有需要修复的问题');
    return { fixed: 0, skipped: 0, unfixable: 0 };
  }

  // 根据修复类型过滤问题
  let issuesToFix = result.issues;
  if (fixType === 'verification') {
    issuesToFix = result.issues.filter(i => isVerificationIssue(i.type));
  } else if (fixType === 'status') {
    issuesToFix = result.issues.filter(i => isStatusIssue(i.type));
  }

  if (issuesToFix.length === 0) {
    console.log(`✅ 没有需要修复的 ${fixType === 'verification' ? '验证方法' : fixType === 'status' ? '状态' : ''} 问题`);
    return { fixed: 0, skipped: 0, unfixable: 0 };
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔧 自动修复问题');
  if (fixType !== 'all') {
    console.log(`   修复类型: ${fixType}`);
  }
  if (nonInteractive) {
    console.log('   (非交互模式)');
  }
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  let fixedCount = 0;
  let skippedCount = 0;
  let unfixableCount = 0;

  for (const issue of issuesToFix) {
    const fixResult = await fixSingleIssue(issue, cwd, nonInteractive);
    if (fixResult === 'fixed') {
      fixedCount++;
    } else if (fixResult === 'skipped') {
      skippedCount++;
    } else {
      unfixableCount++;
    }
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`✅ 共修复 ${fixedCount} 个问题`);
  if (skippedCount > 0) console.log(`⏭️  跳过 ${skippedCount} 个问题`);
  if (unfixableCount > 0) console.log(`⚠️  ${unfixableCount} 个问题无法自动修复`);
  console.log('━'.repeat(SEPARATOR_WIDTH));

  return { fixed: fixedCount, skipped: skippedCount, unfixable: unfixableCount };
}

/**
 * 仅修复验证方法问题
 */
export async function fixVerification(
  cwd: string = process.cwd(),
  nonInteractive: boolean = false
): Promise<void> {
  await fixIssues(cwd, { nonInteractive, fixType: 'verification' });
}

/**
 * 仅修复状态相关问题
 */
export async function fixStatus(
  cwd: string = process.cwd(),
  nonInteractive: boolean = false
): Promise<void> {
  await fixIssues(cwd, { nonInteractive, fixType: 'status' });
}

/**
 * 显示项目状态摘要
 * 支持多种输出格式：quiet, json, full
 */
export function showStatus(
  options: {
    includeArchived?: boolean;
    quiet?: boolean;
    json?: boolean;
    compact?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const includeArchived = options.includeArchived || false;
  const tasks = getAllTasks(cwd, includeArchived);
  const result = analyzeProject(cwd, includeArchived);
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
  console.log(`   已重开: ${result.stats.byStatus.reopened}`);
  console.log(`   已放弃: ${result.stats.byStatus.abandoned}`);
  if (result.stats.ignored > 0) {
    console.log(`   已忽略: ${result.stats.ignored} (配置 ignorePatterns)`);
  }
  console.log('');

  // Reopen 统计
  const reopenStats = calculateReopenStats(tasks);
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
  const reopenCount = tasks.filter(t => t.status === 'reopened').length;

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
  const useSimpleMode = analyzeConfig.checkpointGenerator === 'simple';

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

  const generatorLabel = analyzeConfig.checkpointGenerator === 'simple' ? '简单' : '智能';
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
