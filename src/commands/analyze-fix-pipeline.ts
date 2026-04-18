/**
 * analyze-fix-pipeline.ts - 自动修复管线
 *
 * 从 analyze.ts 提取的修复逻辑，包含 fixSingleIssue 和 fixIssues。
 * 支持传入已有的 AnalysisResult 以避免重复分析。
 */

import prompts from 'prompts';
import * as path from 'path';
import * as fs from 'fs';
import { getArchiveDir } from '../utils/path';
import {
  readTaskMeta,
  getAllTaskIds,
  buildTaskVerification,
  renameTask,
  validateStatusTransition,
  StatusTransitionError,
} from '../utils/task';
import { validatedWriteTaskMeta } from '../utils/task-validation';
import type { StatusTransitionResult } from '../utils/task';
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
  TaskType,
  TaskHistoryEntry,
} from '../types/task';
import {
  parseTaskId,
  generateTaskId,
  normalizeStatus,
  normalizePriority,
  PIPELINE_STATUS_MIGRATION_MAP,
} from '../types/task';
import type { VerdictAction } from '../types/harness';
import { DependencyGraph } from '../utils/dependency-graph';
import { VALID_VERDICT_ACTIONS } from '../types/harness';
import { SEPARATOR_WIDTH } from '../utils/format';
import {
  inferCheckpointPrefix,
  VALID_CHECKPOINT_PREFIXES,
} from '../utils/validation-rules/checkpoint-rules.js';
import { syncCheckpointsToMeta } from '../utils/checkpoint.js';
import { t } from '../i18n/index.js';

import {
  applySchemaMigrations,
  analyzeProject,
  fixCheckpoints,
  performQualityCheck,
  showQualityReport,
} from './analyze';
import type { Issue, AnalysisResult, AIAnalyzeOptions } from './analyze';

// ============== 辅助函数（从 analyze.ts 迁移） ==============

function normalizeType(type: string): string {
  const typeMap: Record<string, string> = {
    'bugfix': 'bug',
    'feat': 'feature',
    'documentation': 'docs',
    'testing': 'test',
    'refactoring': 'refactor',
    // 标准格式直接返回
    'bug': 'bug',
    'feature': 'feature',
    'research': 'research',
    'docs': 'docs',
    'refactor': 'refactor',
    'test': 'test',
  };
  return typeMap[type] || 'feature';
}

/**
 * 判断 slug 是否无意义
 */
export function isMeaninglessSlug(slug: string): boolean {
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

/**
 * 设置任务状态（带验证和日志）
 * 修复管线内部使用：所有状态变更通过此函数集中管理
 * - 验证状态转换是否合法
 * - 非标准转换时输出警告（修复管线允许强制设置）
 * @returns 验证结果
 */
function setTaskStatusValidated(
  task: TaskMeta,
  newStatus: TaskStatus,
  context: string,
): StatusTransitionResult {
  const result = validateStatusTransition(task.status, newStatus);
  if (!result.valid) {
    console.warn(`  ⚠️  ${t(cwd).analyzeFixPipeline.nonStandardTransition.replace('{context}', context).replace('{oldStatus}', task.status).replace('{newStatus}', newStatus)} — ${result.reason}`);
  }
  task.status = newStatus;
  return result;
}

// ============== 修复选项类型 ==============

export interface FixOptions {
  nonInteractive?: boolean;
}

// ============== 修复管线核心 ==============

/**
 * 修复单个问题
 * @returns 修复结果: 'fixed' | 'skipped' | 'unfixable'
 */
export async function fixSingleIssue(
  issue: Issue,
  cwd: string,
  nonInteractive: boolean
): Promise<'fixed' | 'skipped' | 'unfixable'> {
  const task = readTaskMeta(issue.taskId, cwd);
  if (!task) return 'skipped';

  switch (issue.type) {
    case 'stale': {
      if (nonInteractive) {
        // 自动决策: 超过 30 天的过期任务自动关闭
        const updatedAt = new Date(task.updatedAt);
        const staleDays = Math.floor((Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000));
        if (staleDays > 30) {
          const oldStatus = task.status;
          setTaskStatusValidated(task, 'closed', 'stale-auto-close');
          if (!task.transitionNotes) task.transitionNotes = [];
          task.transitionNotes.push({
            timestamp: new Date().toISOString(),
            fromStatus: oldStatus as TaskStatus,
            toStatus: 'closed',
            note: t(cwd).analyzeFixPipeline.staleAutoCloseNote.replace('{days}', String(staleDays)),
            author: 'analyze-fix',
          });
          // writeTaskMeta 自动监听 status 字段变更并生成 history 记录
          validatedWriteTaskMeta(task, cwd);
          console.log('  ' + t(cwd).analyzeFixPipeline.autoClosingStale.replace('{days}', String(staleDays)).replace('{taskId}', issue.taskId));
          return 'fixed';
        }
        console.log(t(cwd).analyzeFixPipeline.skipStale.replace('{taskId}', issue.taskId).replace('{days}', String(staleDays)));
        return 'skipped';
      }
      console.log(t(cwd).analyzeFixPipeline.checkingStale.replace('{taskId}', issue.taskId));
      const response = await prompts({
        type: 'select',
        name: 'action',
        message: t(cwd).analyzeFixPipeline.staleTaskPrompt.replace('{taskId}', issue.taskId),
        choices: [
          { title: t(cwd).analyzeFixPipeline.closingTask, value: 'close' },
          { title: t(cwd).analyzeFixPipeline.markingInProgress, value: 'progress' },
          { title: t(cwd).common.skip, value: 'skip' },
        ],
      });

      if (response.action === 'close') {
        const oldStatus = task.status;
        setTaskStatusValidated(task, 'closed', 'stale-user-close');
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: 'closed',
          note: t(cwd).analyzeFixPipeline.staleUserCloseNote,
          author: 'analyze-fix',
        });
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.closedTask.replace('{taskId}', issue.taskId));
        return 'fixed';
      } else if (response.action === 'progress') {
        const oldStatus = task.status;
        setTaskStatusValidated(task, 'in_progress', 'stale-user-progress');
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: 'in_progress',
          note: t(cwd).analyzeFixPipeline.staleUserProgressNote,
          author: 'analyze-fix',
        });
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.markedInProgress.replace('{taskId}', issue.taskId));
        return 'fixed';
      }
      return 'skipped';
    }

    case 'no_description': {
      if (nonInteractive) {
        console.log(t(cwd).analyzeFixPipeline.skipNoDescription.replace('{taskId}', issue.taskId));
        return 'skipped';
      }
      console.log(t(cwd).analyzeFixPipeline.checkingNoDescription.replace('{taskId}', issue.taskId));
      const response = await prompts({
        type: 'text',
        name: 'description',
        message: t(cwd).analyzeFixPipeline.descriptionPrompt.replace('{taskId}', issue.taskId),
      });

      if (response.description && response.description.trim()) {
        task.description = response.description.trim();
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.addingDescription.replace('{taskId}', issue.taskId));
        return 'fixed';
      }
      return 'skipped';
    }

    case 'cycle': {
      console.log(t(cwd).analyzeFixPipeline.analyzingCycle.replace('{taskId}', issue.taskId));
      // CP-1/CP-15: Use graph module to detect cycles and get auto-fix suggestions
      const allCycleTasks = getAllTaskIds(cwd).map(id => readTaskMeta(id, cwd)).filter((t): t is TaskMeta => t !== null);
      const cycleGraph = DependencyGraph.fromTasks(allCycleTasks);
      const anomalies = cycleGraph.detectAnomalies();

      // Find cycle anomalies involving this task
      const cycleAnomalies = anomalies.filter(a => a.type === 'cycle' && a.nodeIds.includes(issue.taskId));
      if (cycleAnomalies.length === 0) {
        console.log('   ' + t(cwd).analyzeFixPipeline.cycleNotFound.replace('{taskId}', issue.taskId));
        return 'skipped';
      }

      // Try to apply auto-fix suggestions
      let fixedAny = false;
      for (const anomaly of cycleAnomalies) {
        if (anomaly.autoFix) {
          console.log('   ' + t(cwd).analyzeFixPipeline.autoFixDescription.replace('{description}', anomaly.autoFix.description));
          for (const change of anomaly.autoFix.edgeChanges) {
            if (change.action === 'remove') {
              const fromTask = readTaskMeta(change.from, cwd);
              if (fromTask && fromTask.dependencies.includes(change.to)) {
                fromTask.dependencies = fromTask.dependencies.filter(d => d !== change.to);
                validatedWriteTaskMeta(fromTask, cwd);
                console.log('  ' + t(cwd).analyzeFixPipeline.breakingCycle.replace('{from}', change.from).replace('{to}', change.to));
                fixedAny = true;
              }
            }
          }
        } else {
          const cycle = (anomaly.cyclePath || anomaly.nodeIds).join(' → ');
          console.log('   ' + t(cwd).analyzeFixPipeline.cycleManualFix.replace('{cycle}', cycle));
        }
      }

      if (fixedAny) {
        return 'fixed';
      }
      console.log('   ' + t(cwd).analyzeFixPipeline.manualCheckCycle);
      return 'unfixable';
    }

    case 'legacy_priority': {
      console.log(t(cwd).analyzeFixPipeline.fixingPriority.replace('{taskId}', issue.taskId));
      const oldPriority = task.priority;
      const newPriority = normalizePriority(task.priority);
      task.priority = newPriority;
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.priorityUpdated.replace('{old}', oldPriority).replace('{new}', newPriority));
      return 'fixed';
    }

    case 'legacy_status': {
      console.log(t(cwd).analyzeFixPipeline.fixingStatus.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      const newStatus = normalizeStatus(task.status);
      setTaskStatusValidated(task, newStatus, 'legacy-status-fix');
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus as TaskStatus,
        toStatus: newStatus,
        note: t(cwd).analyzeFixPipeline.legacyStatusFixNote.replace('{oldStatus}', oldStatus).replace('{newStatus}', newStatus),
        author: 'analyze-fix',
      });
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.statusUpdated.replace('{old}', oldStatus).replace('{new}', newStatus));
      return 'fixed';
    }

    case 'legacy_schema': {
      console.log(t(cwd).analyzeFixPipeline.fixingSchema.replace('{taskId}', issue.taskId));
      if (task.reopenCount === undefined) {
        task.reopenCount = 0;
        console.log('  ' + t(cwd).analyzeFixPipeline.reopenCountAdded);
      }
      if (task.requirementHistory === undefined) {
        task.requirementHistory = [];
        console.log('  ' + t(cwd).analyzeFixPipeline.requirementHistoryAdded);
      }
      validatedWriteTaskMeta(task, cwd);
      return 'fixed';
    }

    case 'null_array_field': {
      const fields = (issue.details?.fields as string[]) ?? [];
      if (fields.length === 0) return 'skipped';
      console.log(t(cwd).analyzeFixPipeline.fixingEmptyArrays.replace('{taskId}', issue.taskId).replace('{fields}', fields.join(', ')));
      const FIELD_DEFAULTS: Record<string, unknown[]> = {
        dependencies: [],
        history: [],
        checkpoints: [],
        subtaskIds: [],
        discussionTopics: [],
        fileWarnings: [],
        allowedTools: [],
      };
      for (const field of fields) {
        const key = field as keyof TaskMeta;
        if (task[key] === null || task[key] === undefined) {
          (task as unknown as Record<string, unknown>)[key] = FIELD_DEFAULTS[field] ?? [];
          console.log('  ' + t(cwd).analyzeFixPipeline.arrayInitialized.replace('{field}', field));
        }
      }
      validatedWriteTaskMeta(task, cwd);
      return 'fixed';
    }

    case 'pipeline_status_migration': {
      console.log(t(cwd).analyzeFixPipeline.migratingPipelineStatus.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      const targetStatus = issue.details?.targetStatus as TaskStatus;
      if (targetStatus && PIPELINE_STATUS_MIGRATION_MAP[oldStatus]) {
        setTaskStatusValidated(task, targetStatus, 'pipeline-status-migration');
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: targetStatus,
          note: t(cwd).analyzeFixPipeline.pipelineStatusMigrationNote.replace('{oldStatus}', oldStatus).replace('{targetStatus}', targetStatus),
          author: 'analyze-fix',
        });
        // writeTaskMeta 自动监听 status 字段变更并生成 history 记录
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.statusMigrated.replace('{old}', oldStatus).replace('{new}', targetStatus));
        return 'fixed';
      }
      console.log('  ' + t(cwd).analyzeFixPipeline.cannotDetermineTargetStatus);
      return 'unfixable';
    }

    case 'verdict_action_schema': {
      console.log(t(cwd).analyzeFixPipeline.fixingVerdictAction.replace('{taskId}', issue.taskId));
      let fixedAny = false;

      // 修复 history 中的无效 verdict action
      if (!task.history) task.history = [];
      for (let i = 0; i < task.history.length; i++) {
        const entry = task.history[i]!;
        if (entry.action === 'verdict' && entry.newValue && typeof entry.newValue === 'string') {
          if (!VALID_VERDICT_ACTIONS.includes(entry.newValue as VerdictAction)) {
            const oldVal = entry.newValue;
            entry.newValue = `[migrated: invalid_verdict_action "${oldVal}" removed]`;
            console.log('  ' + t(cwd).analyzeFixPipeline.verdictActionCleared.replace('{index}', String(i)).replace('{value}', oldVal));
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
            console.log('  ' + t(cwd).analyzeFixPipeline.verificationCleared.replace('{value}', oldVal));
            fixedAny = true;
          }
        }
      }

      if (fixedAny) {
        validatedWriteTaskMeta(task, cwd);
        return 'fixed';
      }
      return 'skipped';
    }

    case 'schema_version_outdated': {
      console.log(t(cwd).analyzeFixPipeline.migratingSchema.replace('{taskId}', issue.taskId));
      const migrationResult = applySchemaMigrations(task);
      if (migrationResult.changed) {
        validatedWriteTaskMeta(task, cwd);
        for (const detail of migrationResult.details) {
          // Translate schema migration detail keys
          let translatedDetail = detail;
          if (detail === 'schemaMigrationReopenCount') {
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationReopenCount;
          } else if (detail === 'schemaMigrationRequirementHistory') {
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationRequirementHistory;
          } else if (detail === 'schemaMigrationCommitHistory') {
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationCommitHistory;
          } else if (detail === 'schemaMigrationTransitionNotes') {
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationTransitionNotes;
          } else if (detail.startsWith('schemaMigrationResumeAction:')) {
            const status = detail.match(/status:(.+)/)?.[1] || '';
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationResumeAction.replace('{status}', status);
          } else if (detail.startsWith('schemaMigrationCheckpointPrefix:')) {
            const oldMatch = detail.match(/old:"([^"]+)"/)?.[1] || '';
            const newMatch = detail.match(/new:"([^"]+)"/)?.[1] || '';
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationCheckpointPrefix.replace('{old}', oldMatch).replace('{new}', newMatch);
          } else if (detail.startsWith('schemaMigrationCheckpointPolicy:')) {
            const policy = detail.match(/policy:"([^"]+)"/)?.[1] || '';
            const type = detail.match(/type:"([^"]+)"/)?.[1] || '';
            const priority = detail.match(/priority:"([^"]+)"/)?.[1] || '';
            translatedDetail = t(cwd).analyzeCmd.schemaMigrationCheckpointPolicy.replace('{policy}', policy).replace('{type}', type).replace('{priority}', priority);
          }
          console.log(`  ✅ ${translatedDetail}`);
        }
        return 'fixed';
      }
      return 'skipped';
    }

    case 'missing_createdBy': {
      console.log(t(cwd).analyzeFixPipeline.fixingCreatedBy.replace('{taskId}', issue.taskId));
      if (!task.createdBy) {
        task.createdBy = 'import';
        console.log('  ' + t(cwd).analyzeFixPipeline.createdByAdded);
      }
      validatedWriteTaskMeta(task, cwd);
      return 'fixed';
    }

    case 'invalid_status_value': {
      console.log(t(cwd).analyzeFixPipeline.fixingInvalidStatus.replace('{taskId}', issue.taskId));
      if (issue.details?.currentValue) {
        const oldStatus = task.status;
        setTaskStatusValidated(task, normalizeStatus(task.status), 'invalid-status-value-fix');
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: task.status,
          note: t(cwd).analyzeFixPipeline.invalidStatusValueFixNote.replace('{oldStatus}', oldStatus).replace('{newStatus}', task.status),
          author: 'analyze-fix',
        });
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.statusUpdated.replace('{old}', oldStatus).replace('{new}', task.status));
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'invalid_type_value': {
      console.log(t(cwd).analyzeFixPipeline.fixingInvalidType.replace('{taskId}', issue.taskId));
      if (issue.details?.currentValue) {
        const oldType = task.type;
        task.type = normalizeType(task.type) as TaskType;
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.typeUpdated.replace('{old}', oldType).replace('{new}', task.type));
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'invalid_priority_value': {
      console.log(t(cwd).analyzeFixPipeline.fixingInvalidPriority.replace('{taskId}', issue.taskId));
      if (issue.details?.currentValue) {
        const oldPriority = task.priority;
        task.priority = normalizePriority(task.priority);
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.priorityUpdated.replace('{old}', oldPriority).replace('{new}', task.priority));
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'status_reopen_mismatch': {
      console.log(t(cwd).analyzeFixPipeline.fixingReopenTransition.replace('{taskId}', issue.taskId));
      // 确保 transitionNotes 已初始化
      if (!task.transitionNotes) task.transitionNotes = [];

      // 补录 reopen transitionNote
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'resolved',
        toStatus: 'open',
        note: t(cwd).analyzeFixPipeline.reopenMismatchFixNote.replace('{count}', String(task.reopenCount ?? 0)),
        author: 'analyze-fix',
      });

      // 确保 status 为 open（已废弃 reopened）
      if ((task.status as string) === 'reopened') {
        setTaskStatusValidated(task, 'open', 'reopen-mismatch-fix');
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: 'reopened',
          toStatus: 'open',
          note: t(cwd).analyzeFixPipeline.reopenedStatusMigrationNote,
          author: 'analyze-fix',
        });
      }

      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.transitionNoteAdded.replace('{count}', String(task.reopenCount ?? 0)));
      return 'fixed';
    }

    case 'inconsistent_status': {
      console.log(t(cwd).analyzeFixPipeline.fixingStatusContradiction.replace('{taskId}', issue.taskId));
      // 将状态改回 open，清除旧的 verification
      const oldStatus = task.status;
      setTaskStatusValidated(task, 'open', 'inconsistent-status-fix');
      task.verification = undefined;
      task.updatedAt = new Date().toISOString();
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus as TaskStatus,
        toStatus: 'open',
        note: t(cwd).analyzeFixPipeline.inconsistentStatusFixNote,
        author: 'analyze-fix',
      });
      // writeTaskMeta 自动监听 status 字段变更并生成 history 记录
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.statusContradictionFixed);
      return 'fixed';
    }

    case 'invalid_timestamp_format': {
      console.log(t(cwd).analyzeFixPipeline.fixingTimestamp.replace('{taskId}', issue.taskId));
      if (issue.details?.field) {
        const field = issue.details.field as string;
        const now = new Date().toISOString();
        if (field === 'createdAt' || field === 'updatedAt') {
          (task as unknown as Record<string, unknown>)[field] = now;
          validatedWriteTaskMeta(task, cwd);
          console.log('  ' + t(cwd).analyzeFixPipeline.timestampUpdated.replace('{field}', field).replace('{value}', now));
          return 'fixed';
        }
      }
      return 'unfixable';
    }

    case 'invalid_parent_ref': {
      console.log(t(cwd).analyzeFixPipeline.invalidParent.replace('{taskId}', issue.taskId));
      console.log('   ' + t(cwd).analyzeFixPipeline.manualFixInvalidParent);
      return 'unfixable';
    }

    case 'invalid_subtask_ref': {
      console.log(t(cwd).analyzeFixPipeline.fixingSubtaskRef.replace('{taskId}', issue.taskId));
      if (task.subtaskIds && issue.details?.subtaskId) {
        const invalidId = issue.details.subtaskId as string;
        const oldLength = task.subtaskIds.length;
        task.subtaskIds = task.subtaskIds.filter(id => id !== invalidId);
        if (task.subtaskIds.length < oldLength) {
          validatedWriteTaskMeta(task, cwd);
          console.log('  ' + t(cwd).analyzeFixPipeline.subtaskRefRemoved.replace('{id}', invalidId));
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'invalid_dependency_ref': {
      console.log(t(cwd).analyzeFixPipeline.fixingDependencyRef.replace('{taskId}', issue.taskId));
      // CP-2: Use graph to validate all dependency references
      const allDepTasks = getAllTaskIds(cwd).map(id => readTaskMeta(id, cwd)).filter((t): t is TaskMeta => t !== null);
      const validTaskIds = new Set(allDepTasks.map(t => t.id));
      let removedAny = false;

      if (task.dependencies) {
        // Validate ALL dependency refs using graph, not just the reported one
        const invalidRefs = task.dependencies.filter(depId => !validTaskIds.has(depId));
        if (invalidRefs.length > 0) {
          const oldLength = task.dependencies.length;
          task.dependencies = task.dependencies.filter(depId => validTaskIds.has(depId));
          removedAny = task.dependencies.length < oldLength;
          if (removedAny) {
            validatedWriteTaskMeta(task, cwd);
            for (const invalidId of invalidRefs) {
              console.log('  ' + t(cwd).analyzeFixPipeline.dependencyRefRemoved.replace('{id}', invalidId));
            }
          }
        }
      }

      // Also handle the specific reported invalid ref if not caught above
      if (!removedAny && task.dependencies && issue.details?.dependencyId) {
        const invalidId = issue.details.dependencyId as string;
        const oldLength = task.dependencies.length;
        task.dependencies = task.dependencies.filter(id => id !== invalidId);
        if (task.dependencies.length < oldLength) {
          validatedWriteTaskMeta(task, cwd);
          console.log('  ' + t(cwd).analyzeFixPipeline.dependencyRefRemoved.replace('{id}', invalidId));
          removedAny = true;
        }
      }

      return removedAny ? 'fixed' : 'skipped';
    }

    case 'missing_inferred_dependency': {
      console.log(t(cwd).analyzeFixPipeline.inferringDependencies.replace('{taskId}', issue.taskId));
      // CP-3: Use graph to compare inferred vs explicit dependencies
      const allInferredTasks = getAllTaskIds(cwd).map(id => readTaskMeta(id, cwd)).filter((t): t is TaskMeta => t !== null);
      const inferredGraph = DependencyGraph.fromTasks(allInferredTasks);

      if (issue.details?.inferredDependencies) {
        const inferredDeps = issue.details.inferredDependencies as Array<{ depTaskId: string; reason: string }>;
        if (inferredDeps.length > 0) {
          let addedAny = false;
          for (const inferred of inferredDeps) {
            if (!task.dependencies.includes(inferred.depTaskId)) {
              // Use graph to verify target node exists
              if (!inferredGraph.hasNode(inferred.depTaskId)) {
                console.log('   ' + t(cwd).analyzeFixPipeline.inferredDepNotFound.replace('{id}', inferred.depTaskId));
                continue;
              }
              // Use graph to check if adding this dep would create a cycle
              if (inferredGraph.wouldCreateCycle(issue.taskId, inferred.depTaskId)) {
                console.log('   ' + t(cwd).analyzeFixPipeline.inferredDepWouldCreateCycle.replace('{id}', inferred.depTaskId));
                continue;
              }
              task.dependencies.push(inferred.depTaskId);
              console.log('  ' + t(cwd).analyzeFixPipeline.inferredDepAdded.replace('{id}', inferred.depTaskId).replace('{reason}', inferred.reason));
              addedAny = true;
            }
          }
          if (addedAny) {
            validatedWriteTaskMeta(task, cwd);
            return 'fixed';
          }
        }
      }
      return 'skipped';
    }

    case 'subtask_not_in_parent': {
      console.log(t(cwd).analyzeFixPipeline.fixingParentRef.replace('{taskId}', issue.taskId));
      if (task.parentId) {
        const parentTask = readTaskMeta(task.parentId, cwd);
        if (parentTask) {
          if (!parentTask.subtaskIds) {
            parentTask.subtaskIds = [];
          }
          if (!parentTask.subtaskIds.includes(task.id)) {
            parentTask.subtaskIds.push(task.id);
            validatedWriteTaskMeta(parentTask, cwd);
            console.log('  ' + t(cwd).analyzeFixPipeline.parentRefAdded);
            return 'fixed';
          }
        }
      }
      return 'skipped';
    }

    case 'parent_child_mismatch': {
      console.log(t(cwd).analyzeFixPipeline.fixingParentChildRelation.replace('{taskId}', issue.taskId));
      if (issue.details?.subtaskId && issue.details?.expectedParentId) {
        const subtaskId = issue.details.subtaskId as string;
        const subtask = readTaskMeta(subtaskId, cwd);
        if (subtask) {
          subtask.parentId = issue.details.expectedParentId as string;
          validatedWriteTaskMeta(subtask, cwd);
          console.log('  ' + t(cwd).analyzeFixPipeline.parentChildRelationFixed.replace('{subtaskId}', subtaskId).replace('{parentId}', subtask.parentId));
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'meaningless_id': {
      // 从 description/title 提取关键词生成新 ID
      const slug = extractSlugFromTask(task);
      if (!slug || isMeaninglessSlug(slug)) {
        console.log(t(cwd).analyzeFixPipeline.cannotExtractKeywords.replace('{taskId}', issue.taskId));
        return 'unfixable';
      }

      const idInfo = parseTaskId(task.id);
      // 优先使用 task 自身的 type/priority（更可靠），再从 ID 解析
      const taskType = (task.type || idInfo.type || 'feature') as TaskType;
      const taskPriority = (task.priority || idInfo.priority) as TaskPriority;
      const existingIds = getAllTaskIds(cwd);
      const newId = generateTaskId(taskType, taskPriority, slug, existingIds);

      if (newId === task.id) {
        console.log('  ' + t(cwd).analyzeFixPipeline.generatedIdSame);
        return 'skipped';
      }

      console.log(t(cwd).analyzeFixPipeline.renamingTask.replace('{old}', task.id).replace('{new}', newId));
      const result = renameTask(task.id, newId, cwd);
      if (result.success) {
        console.log('  ' + t(cwd).analyzeFixPipeline.taskRenamed.replace('{id}', newId));
        return 'fixed';
      }
      console.log('  ' + t(cwd).analyzeFixPipeline.renameFailed.replace('{error}', result.error || ''));
      return 'unfixable';
    }

    case 'invalid_history_format':
    case 'invalid_requirement_history_format':
    case 'invalid_task_id_format': {
      console.log(t(cwd).analyzeFixPipeline.cannotAutoFix.replace('{taskId}', issue.taskId).replace('{type}', issue.type));
      console.log('   ' + t(cwd).analyzeFixPipeline.suggestion.replace('{suggestion}', issue.suggestion || ''));
      return 'unfixable';
    }

    case 'manual_verification': {
      console.log(t(cwd).analyzeFixPipeline.fixingManualVerification.replace('{taskId}', issue.taskId));
      if (task.checkpoints && issue.details?.checkpointIds) {
        let fixedCount_local = 0;
        for (const cpId of issue.details.checkpointIds as string[]) {
          const cp = task.checkpoints.find(c => c.id === cpId);
          if (cp && cp.verification && (cp.verification.method as string) === 'manual') {
            cp.verification.method = 'automated';
            console.log('  ' + t(cwd).analyzeFixPipeline.manualToAutomated.replace('{id}', cpId));
            fixedCount_local++;
          }
        }
        if (fixedCount_local > 0) {
          validatedWriteTaskMeta(task, cwd);
          return 'fixed';
        }
      }
      return 'skipped';
    }

    case 'missing_verification': {
      console.log(t(cwd).analyzeFixPipeline.fixingMissingVerification.replace('{taskId}', issue.taskId));
      if (task.status === 'resolved' && !task.verification) {
        task.verification = buildTaskVerification(task);
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.verificationAutoFilled);
        console.log('     ' + t(cwd).analyzeFixPipeline.result + ': ' + task.verification.result);
        console.log('     ' + t(cwd).analyzeFixPipeline.checkpointCompletionRate.replace('{rate}', String(task.verification.checkpointCompletionRate)));
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
            console.error('  ' + t(cwd).analyzeFixPipeline.deleteFailed.replace('{taskId}', taskId));
          }
        }
        console.log('  ' + t(cwd).analyzeFixPipeline.abandonedTaskDeleted.replace('{count}', String(deleted)));
        return deleted > 0 ? 'fixed' : 'skipped';
      } else {
        console.log(t(cwd).analyzeFixPipeline.checkingAbandoned);
        console.log('  ' + t(cwd).analyzeFixPipeline.abandonedFound.replace('{count}', String(tasksToDelete.length)).replace('{tasks}', tasksToDelete.join(', ')));
        const response = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: t(cwd).analyzeFixPipeline.confirmCleanupAbandoned,
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
              console.error('  ' + t(cwd).analyzeFixPipeline.deleteFailed.replace('{taskId}', taskId));
            }
          }
          console.log('  ' + t(cwd).analyzeFixPipeline.abandonedTaskDeleted.replace('{count}', String(deleted)));
          return deleted > 0 ? 'fixed' : 'skipped';
        }
        return 'skipped';
      }
    }

    case 'file_not_found': {
      console.log(t(cwd).analyzeFixPipeline.missingFileRef.replace('{taskId}', issue.taskId));
      if (issue.details?.missingFiles) {
        console.log('   ' + t(cwd).analyzeFixPipeline.missingFiles.replace('{files}', (issue.details.missingFiles as string[]).join(', ')));
      }
      console.log('   ' + t(cwd).analyzeFixPipeline.suggestion.replace('{suggestion}', issue.suggestion || ''));
      return 'unfixable';
    }

    case 'missing_transition_note': {
      console.log(t(cwd).analyzeFixPipeline.fillingTransitionNote.replace('{taskId}', issue.taskId));
      const historyEntry = issue.details?.historyEntry as TaskHistoryEntry | undefined;
      if (!historyEntry) {
        console.log('  ' + t(cwd).analyzeFixPipeline.missingHistoryDetail);
        return 'unfixable';
      }

      // 推断各字段
      const actionLower = (historyEntry.action || '').toLowerCase();
      const author: string = (actionLower.includes('pipeline') || actionLower.includes('harness'))
        ? 'pipeline'
        : 'user';
      const analysis = historyEntry.reason || '';
      const evidence = historyEntry.verificationDetails || '';

      // 构建 decision 描述
      const decisionMap: Record<string, string> = {
        'open→in_progress': '开始执行任务',
        'in_progress→wait_review': '提交代码审查',
        'wait_review→wait_qa': '审查通过，进入QA',
        'wait_qa→wait_evaluation': 'QA通过，等待评估',
        'wait_evaluation→resolved': '评估通过，任务完成',
        'open→closed': '关闭任务',
        'in_progress→resolved': '直接标记完成',
        'resolved→reopened': '重新打开任务',
        'reopened→in_progress': '重新开始执行',
        'open→abandoned': '放弃任务',
        'in_progress→open': '退回待办',
      };
      const statusKey = `${historyEntry.oldValue}→${historyEntry.newValue}`;
      const decision = decisionMap[statusKey] || `${historyEntry.oldValue} → ${historyEntry.newValue}`;

      // 组合 note 内容
      const noteParts = [decision];
      if (analysis) noteParts.push(`分析: ${analysis}`);
      if (evidence) noteParts.push(`证据: ${evidence}`);
      const note = noteParts.join(' | ');

      if (!task.transitionNotes) {
        task.transitionNotes = [];
      }
      task.transitionNotes.push({
        timestamp: historyEntry.timestamp || new Date().toISOString(),
        fromStatus: historyEntry.oldValue as TaskStatus,
        toStatus: historyEntry.newValue as TaskStatus,
        note,
        author,
      });
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.transitionNoteFilled.replace('{status}', statusKey).replace('{author}', author));
      return 'fixed';
    }

    case 'interrupted_task': {
      const suggestedStatus = issue.details?.suggestedStatus as string | undefined;
      if (!suggestedStatus) {
        console.log('  ' + t(cwd).analyzeFixPipeline.missingSuggestion);
        return 'unfixable';
      }

      console.log(t(cwd).analyzeFixPipeline.fixingInterruptedTask.replace('{taskId}', issue.taskId));
      console.log('   ' + t(cwd).analyzeFixPipeline.currentStatus.replace('{status}', task.status) + ' → ' + t(cwd).analyzeFixPipeline.suggestedStatus.replace('{status}', suggestedStatus));
      console.log('   ' + t(cwd).analyzeFixPipeline.reason.replace('{reason}', (issue.details?.suggestionReason as string) || issue.suggestion || ''));

      // 如果建议保持 in_progress，跳过
      if (suggestedStatus === 'in_progress') {
        console.log('  ' + t(cwd).analyzeFixPipeline.skipKeepInProgress);
        return 'skipped';
      }

      // 非交互模式下直接应用建议
      if (nonInteractive || !process.stdin.isTTY) {
        const oldStatus = task.status;
        setTaskStatusValidated(task, suggestedStatus as TaskStatus, 'interrupted-task-auto');
        task.updatedAt = new Date().toISOString();

        // writeTaskMeta 自动监听 status 字段变更并生成 history 记录

        // 添加 transitionNote
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: suggestedStatus as TaskStatus,
          note: t(cwd).analyzeFixPipeline.interruptedTaskAutoNote.replace('{days}', String((issue.details?.interruptedDays as number) || 0)),
          author: 'analyze',
        });

        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.statusFixed.replace('{taskId}', issue.taskId).replace('{old}', oldStatus).replace('{new}', suggestedStatus));
        return 'fixed';
      }

      // 交互模式下询问用户
      const response = await prompts({
        type: 'confirm',
        name: 'apply',
        message: t(cwd).analyzeFixPipeline.confirmStatusChange.replace('{taskId}', issue.taskId).replace('{oldStatus}', task.status).replace('{newStatus}', suggestedStatus),
        initial: true,
      });

      if (response.apply) {
        const oldStatus = task.status;
        setTaskStatusValidated(task, suggestedStatus as TaskStatus, 'interrupted-task-manual');
        task.updatedAt = new Date().toISOString();

        // writeTaskMeta 自动监听 status 字段变更并生成 history 记录

        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: suggestedStatus as TaskStatus,
          note: t(cwd).analyzeFixPipeline.interruptedTaskManualNote.replace('{days}', String((issue.details?.interruptedDays as number) || 0)),
          author: 'analyze',
        });

        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.statusFixed.replace('{taskId}', issue.taskId).replace('{old}', oldStatus).replace('{new}', suggestedStatus));
        return 'fixed';
      }
      return 'skipped';
    }

    case 'reopened_status': {
      console.log(t(cwd).analyzeFixPipeline.migratingReopenedStatus.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      setTaskStatusValidated(task, 'open', 'reopened-migration');
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'reopened',
        toStatus: 'open',
        note: t(cwd).analyzeFixPipeline.reopenedStatusMigrationNote,
        author: 'analyze-fix',
      });
      // writeTaskMeta 自动监听 status 字段变更并生成 history 记录
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.reopenedMigrated);
      return 'fixed';
    }

    case 'needs_human_status': {
      console.log(t(cwd).analyzeFixPipeline.migratingNeedsHumanStatus.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      setTaskStatusValidated(task, 'open', 'needs-human-migration');
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'needs_human',
        toStatus: 'open',
        note: t(cwd).analyzeFixPipeline.needsHumanStatusMigrationNote,
        author: 'analyze-fix',
      });
      // writeTaskMeta 自动监听 status 字段变更并生成 history 记录
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.needsHumanMigrated);
      return 'fixed';
    }

    case 'low_checkpoint_coverage': {
      console.log(t(cwd).analyzeFixPipeline.checkpointCoverageWarning);
      if (issue.details?.tasksWithoutCheckpoints) {
        console.log('   ' + t(cwd).analyzeFixPipeline.tasksWithoutCheckpoints.replace('{count}', String(issue.details.tasksWithoutCheckpoints)));
      }
      if (issue.details?.coverageRate != null) {
        console.log('   ' + t(cwd).analyzeFixPipeline.currentCoverage.replace('{rate}', String(((issue.details.coverageRate as number) * 100).toFixed(1))));
      }
      console.log('   ' + t(cwd).analyzeFixPipeline.suggestion.replace('{suggestion}', t(cwd).analyzeFixPipeline.lowQualitySuggestion));
      return 'unfixable';
    }

    case 'low_quality': {
      const score = issue.details?.totalScore ?? '?';
      console.log(t(cwd).analyzeFixPipeline.lowQualityTask.replace('{taskId}', issue.taskId).replace('{score}', String(score)));
      const deductions = (issue.details?.deductions as Array<{ reason: string; suggestion?: string }> | undefined) ?? [];
      if (deductions.length > 0) {
        for (const d of deductions.slice(0, 3)) {
          console.log(`   └─ ${d.reason}${d.suggestion ? ` (${t(cwd).analyzeFixPipeline.suggestion.replace('{suggestion}', d.suggestion)})` : ''}`);
        }
      }
      console.log('   ' + t(cwd).analyzeFixPipeline.suggestion.replace('{suggestion}', issue.suggestion || ''));
      return 'unfixable';
    }

    case 'deprecated_status_reference': {
      console.log(t(cwd).analyzeFixPipeline.cleaningObsoleteStatus.replace('{taskId}', issue.taskId));
      let fixedAny = false;
      for (const entry of task.history || []) {
        if ((entry.oldValue as string) === 'reopened' || (entry.oldValue as string) === 'needs_human') {
          entry.oldValue = 'open';
          fixedAny = true;
        }
        if ((entry.newValue as string) === 'reopened') {
          entry.newValue = 'open';
          fixedAny = true;
        }
        if ((entry.newValue as string) === 'needs_human') {
          entry.newValue = 'open';
          fixedAny = true;
        }
      }
      for (const note of task.transitionNotes || []) {
        if ((note.fromStatus as string) === 'reopened' || (note.fromStatus as string) === 'needs_human') {
          note.fromStatus = 'open';
          fixedAny = true;
        }
        if ((note.toStatus as string) === 'reopened' || (note.toStatus as string) === 'needs_human') {
          note.toStatus = 'open';
          fixedAny = true;
        }
      }
      if (fixedAny) {
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.obsoleteStatusCleaned);
        return 'fixed';
      }
      return 'skipped';
    }

    // ============== Layer 1 质量门禁规则修复 ==============

    case 'report_status_mismatch': {
      // CP-6: update_status — 更新状态到推断值
      const impliedStatus = issue.details?.impliedStatus as TaskStatus | undefined;
      if (!impliedStatus) {
        console.log('  ' + t(cwd).analyzeFixPipeline.missingInferenceInfo);
        return 'unfixable';
      }

      console.log(t(cwd).analyzeFixPipeline.fixingReportStatusMismatch.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      setTaskStatusValidated(task, impliedStatus, 'report-status-mismatch');
      task.updatedAt = new Date().toISOString();
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus as TaskStatus,
        toStatus: impliedStatus,
        note: t(cwd).analyzeFixPipeline.reportStatusMismatchNote.replace('{oldStatus}', oldStatus).replace('{newStatus}', impliedStatus).replace('{reportFile}', String(issue.details?.reportFile)),
        author: 'analyze-fix',
      });

      // writeTaskMeta 自动监听 7 个字段(title/description/priority/status/recommendedRole/branch/dependencies)变更并生成 history 记录
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.reportStatusMismatchFixed.replace('{old}', oldStatus).replace('{new}', impliedStatus).replace('{report}', String(issue.details?.reportFile)));
      return 'fixed';
    }

    case 'checkpoint_status_mismatch': {
      // CP-7: complete_checkpoints — 自动完成 pending 检查点（旧版遗留）
      console.log(t(cwd).analyzeFixPipeline.fixingCheckpointStatusMismatch.replace('{taskId}', issue.taskId));
      if (!task.checkpoints || task.checkpoints.length === 0) {
        return 'skipped';
      }

      const now = new Date().toISOString();
      let completedCount = 0;
      for (const cp of task.checkpoints) {
        if (cp.status === 'pending') {
          cp.status = 'completed';
          cp.updatedAt = now;
          if (cp.verification) {
            cp.verification.result = 'passed (auto-completed by analyze-fix: legacy task)';
            cp.verification.verifiedAt = now;
            cp.verification.verifiedBy = 'analyze-fix';
          }
          completedCount++;
        }
      }

      if (completedCount > 0) {
        task.updatedAt = now;
        // writeTaskMeta 自动监听 7 个字段(title/description/priority/status/recommendedRole/branch/dependencies)变更并生成 history 记录
        validatedWriteTaskMeta(task, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.checkpointStatusMismatchFixed.replace('{count}', String(completedCount)));
        return 'fixed';
      }
      return 'skipped';
    }

    case 'missing_pipeline_evidence': {
      // CP-1: reset_to_open — 缺少恢复证据，重置为 open
      const fixAction = issue.details?.fixAction as string | undefined;
      if (fixAction !== 'reset_to_open') {
        console.log('  ' + t(cwd).analyzeFixPipeline.unknownFixAction.replace('{action}', fixAction || ''));
        return 'unfixable';
      }

      console.log(t(cwd).analyzeFixPipeline.resettingTask.replace('{taskId}', issue.taskId));
      const oldStatus = task.status;
      setTaskStatusValidated(task, 'open', 'missing-pipeline-evidence');
      task.updatedAt = new Date().toISOString();

      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus as TaskStatus,
        toStatus: 'open',
        note: t(cwd).analyzeFixPipeline.missingPipelineEvidenceNote.replace('{oldStatus}', oldStatus),
        author: 'analyze-fix',
      });

      // 设置 resumeAction 以便后续恢复
      if (!task.resumeAction) {
        task.resumeAction = 'reset_to_open';
      }

      // writeTaskMeta 自动监听 7 个字段(title/description/priority/status/recommendedRole/branch/dependencies)变更并生成 history 记录
      validatedWriteTaskMeta(task, cwd);
      console.log('  ' + t(cwd).analyzeFixPipeline.taskReset.replace('{old}', oldStatus));
      return 'fixed';
    }

    case 'checkpoint_validation_error': {
      // 检查点验证错误修复 - 目前支持前缀修复
      const ruleId = issue.details?.ruleId as string | undefined;

      // 只处理 checkpoint-required-prefix 规则的错误
      if (ruleId !== 'checkpoint-required-prefix') {
        console.log('  ' + t(cwd).analyzeFixPipeline.unsupportedRule.replace('{rule}', ruleId || ''));
        return 'unfixable';
      }

      console.log(t(cwd).analyzeFixPipeline.fixingCheckpointPrefix.replace('{taskId}', issue.taskId));

      if (!task.checkpoints || task.checkpoints.length === 0) {
        console.log('  ' + t(cwd).analyzeFixPipeline.noCheckpoints);
        return 'skipped';
      }

      let updatedCount = 0;
      const now = new Date().toISOString();

      for (const cp of task.checkpoints) {
        const trimmed = cp.description.trim().toLowerCase();
        const hasValidPrefix = VALID_CHECKPOINT_PREFIXES.some(prefix =>
          trimmed.startsWith(prefix.toLowerCase())
        );

        if (!hasValidPrefix) {
          const inferredPrefix = inferCheckpointPrefix(cp.description);
          cp.description = `${inferredPrefix} ${cp.description}`;
          cp.updatedAt = now;
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        task.updatedAt = now;
        // 同步检查点到 meta.json 和 checkpoint.md
        syncCheckpointsToMeta(task.id, task.checkpoints, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.checkpointPrefixUpdated.replace('{count}', String(updatedCount)));
        return 'fixed';
      }

      console.log('  ' + t(cwd).analyzeFixPipeline.allCheckpointsHavePrefix);
      return 'skipped';
    }

    case 'missing_checkpoint_prefix': {
      // 专门的检查点前缀缺失修复 - 复用 checkpoint_validation_error 中的前缀修复逻辑
      console.log(t(cwd).analyzeFixPipeline.fixingCheckpointPrefix.replace('{taskId}', issue.taskId));

      if (!task.checkpoints || task.checkpoints.length === 0) {
        console.log('  ' + t(cwd).analyzeFixPipeline.noCheckpoints);
        return 'skipped';
      }

      let updatedCount = 0;
      const now = new Date().toISOString();

      for (const cp of task.checkpoints) {
        const trimmed = cp.description.trim().toLowerCase();
        const hasValidPrefix = VALID_CHECKPOINT_PREFIXES.some(prefix =>
          trimmed.startsWith(prefix.toLowerCase())
        );

        if (!hasValidPrefix) {
          const inferredPrefix = inferCheckpointPrefix(cp.description);
          cp.description = `${inferredPrefix} ${cp.description}`;
          cp.updatedAt = now;
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        task.updatedAt = now;
        // 同步检查点到 meta.json 和 checkpoint.md
        syncCheckpointsToMeta(task.id, task.checkpoints, cwd);
        console.log('  ' + t(cwd).analyzeFixPipeline.checkpointPrefixUpdated.replace('{count}', String(updatedCount)));
        return 'fixed';
      }

      console.log('  ' + t(cwd).analyzeFixPipeline.allCheckpointsHavePrefix);
      return 'skipped';
    }

    default:
      return 'unfixable';
  }
}

/**
 * 自动修复问题
 * @param cwd 工作目录
 * @param options 修复选项
 * @param existingResult 可选的已有分析结果，传入时跳过重复分析
 */
export async function fixIssues(
  cwd: string = process.cwd(),
  options: FixOptions = {},
  existingResult?: AnalysisResult
): Promise<{ fixed: number; skipped: number; unfixable: number }> {
  const { nonInteractive = false } = options;
  const result = existingResult ?? await analyzeProject(cwd);

  if (result.issues.length === 0) {
    console.log(t(cwd).analyzeFixPipeline.noIssuesFound);
    return { fixed: 0, skipped: 0, unfixable: 0 };
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(t(cwd).analyzeFixPipeline.autoFixIssues);
  if (nonInteractive) {
    console.log('   ' + t(cwd).analyzeFixPipeline.nonInteractiveMode);
  }
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  let fixedCount = 0;
  let skippedCount = 0;
  let unfixableCount = 0;

  for (const issue of result.issues) {
    let fixResult: 'fixed' | 'skipped' | 'unfixable';
    try {
      fixResult = await fixSingleIssue(issue, cwd, nonInteractive);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(t(cwd).analyzeFixPipeline.fixError.replace('{taskId}', issue.taskId).replace('{type}', issue.type).replace('{error}', errorMsg));
      fixResult = 'skipped';
    }
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
  console.log(t(cwd).analyzeFixPipeline.fixComplete.replace('{count}', String(fixedCount)));
  if (skippedCount > 0) console.log(t(cwd).analyzeFixPipeline.fixSkipped.replace('{count}', String(skippedCount)));
  if (unfixableCount > 0) console.log(t(cwd).analyzeFixPipeline.fixUnfixable.replace('{count}', String(unfixableCount)));
  console.log('━'.repeat(SEPARATOR_WIDTH));

  return { fixed: fixedCount, skipped: skippedCount, unfixable: unfixableCount };
}

// ============== 5阶段修复流水线 ==============

export interface FixPipelineOptions {
  nonInteractive?: boolean;
  /** Only run rule-based stages (1, 2) */
  rulesOnly?: boolean;
  /** Only run checkpoint fixes (stage 4) */
  checkpointsOnly?: boolean;
  /** Only run quality report (stage 5) */
  qualityOnly?: boolean;
  /** Skip AI analysis stage (stage 3) */
  noAi?: boolean;
  /** AI options for stages that use AI */
  aiOptions?: AIAnalyzeOptions;
  /** Quality report display options */
  compact?: boolean;
  json?: boolean;
  threshold?: number;
  /** Target task ID for checkpoint stage */
  taskId?: string;
}

interface StageResult {
  executed: boolean;
  skipped: boolean;
  duration: number;
  summary: string;
}

export interface FixPipelineResult {
  stages: {
    stage1: StageResult;
    stage2: StageResult;
    stage3: StageResult;
    stage4: StageResult;
    stage5: StageResult;
  };
  totalTime: number;
}

function emptyStageResult(summary: string): StageResult {
  return { executed: false, skipped: true, duration: 0, summary };
}

/**
 * 5阶段修复流水线
 *
 * Stage 1: 规则引擎分析 (无AI消耗)
 * Stage 2: 规则修复 (无AI消耗)
 * Stage 3: AI 分析 (--no-ai 跳过)
 * Stage 4: 检查点修复
 * Stage 5: 质量报告
 *
 * 参数组合:
 *   --fix                → 全部5阶段
 *   --fix --no-ai        → 1,2,4,5 跳过3
 *   --fix --rules-only   → 仅1,2
 *   --fix --checkpoints-only → 仅4
 *   --fix --quality-only → 仅5
 */
export async function fixPipeline(
  cwd: string = process.cwd(),
  options: FixPipelineOptions = {},
): Promise<FixPipelineResult> {
  const pipelineStart = Date.now();
  const {
    nonInteractive = false,
    rulesOnly = false,
    checkpointsOnly = false,
    qualityOnly = false,
    noAi = false,
    aiOptions = {},
    compact = false,
    json = false,
    threshold = 60,
    taskId,
  } = options;

  // Determine which stages to run
  const runStage1 = !checkpointsOnly && !qualityOnly;
  const runStage2 = !checkpointsOnly && !qualityOnly;
  const runStage3 = !noAi && !rulesOnly && !checkpointsOnly && !qualityOnly;
  const runStage4 = !rulesOnly && !qualityOnly;
  const runStage5 = !rulesOnly && !checkpointsOnly;

  let analysisResult: AnalysisResult | undefined;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(t(cwd).analyzeFixPipeline.fixPipelineMode);
  const stages: string[] = [];
  if (runStage1) stages.push('1');
  if (runStage2) stages.push('2');
  if (runStage3) stages.push('3');
  if (runStage4) stages.push('4');
  if (runStage5) stages.push('5');
  console.log('   ' + t(cwd).analyzeFixPipeline.executingStages + ': ' + stages.join(', ') + ' / 5');
  console.log('━'.repeat(SEPARATOR_WIDTH));

  // ===== Stage 1: 规则引擎分析 =====
  let stage1Result: StageResult;
  if (runStage1) {
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage1Analysis);
    try {
      analysisResult = await analyzeProject(cwd, false, aiOptions);
      const issueCount = analysisResult.issues.length;
      const duration = Date.now() - start;
      stage1Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage1Complete.replace('{count}', String(issueCount)).replace('{duration}', (duration / 1000).toFixed(1)),
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage1Complete.replace('{count}', String(issueCount)).replace('{duration}', (duration / 1000).toFixed(1)));
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      stage1Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage1Failed.replace('{error}', errorMsg),
      };
      console.error('   ' + t(cwd).analyzeFixPipeline.stage1Failed.replace('{error}', errorMsg));
    }
  } else {
    stage1Result = emptyStageResult(t(cwd).analyzeFixPipeline.stage1Skipped);
    console.log('   ' + t(cwd).analyzeFixPipeline.stage1Skipped);
  }

  // ===== Stage 2: 规则修复 =====
  let stage2Result: StageResult;
  if (runStage2 && analysisResult) {
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage2Fix);
    try {
      const fixResult = await fixIssues(cwd, { nonInteractive }, analysisResult);
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage2Complete.replace('{fixed}', String(fixResult.fixed)).replace('{skipped}', String(fixResult.skipped)).replace('{duration}', (duration / 1000).toFixed(1)),
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage2Complete.replace('{fixed}', String(fixResult.fixed)).replace('{skipped}', String(fixResult.skipped)).replace('{duration}', (duration / 1000).toFixed(1)));
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage2Failed.replace('{error}', errorMsg),
      };
      console.error('   ' + t(cwd).analyzeFixPipeline.stage2Failed.replace('{error}', errorMsg));
    }
  } else if (runStage2 && !analysisResult) {
    // Stage 1 was skipped but we still need analysis for stage 2
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage2FixWithAnalysis);
    try {
      const fixResult = await fixIssues(cwd, { nonInteractive });
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage2Complete.replace('{fixed}', String(fixResult.fixed)).replace('{skipped}', String(fixResult.skipped)).replace('{duration}', (duration / 1000).toFixed(1)),
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage2Complete.replace('{fixed}', String(fixResult.fixed)).replace('{skipped}', String(fixResult.skipped)).replace('{duration}', (duration / 1000).toFixed(1)));
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage2Failed.replace('{error}', errorMsg),
      };
      console.error('   ' + t(cwd).analyzeFixPipeline.stage2Failed.replace('{error}', errorMsg));
    }
  } else {
    stage2Result = emptyStageResult(t(cwd).analyzeFixPipeline.stage2Skipped);
    console.log('   ' + t(cwd).analyzeFixPipeline.stage2Skipped);
  }

  // ===== Stage 3: AI 分析 =====
  let stage3Result: StageResult;
  if (runStage3) {
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage3AI);
    // Stage 3 is a placeholder for AI per-task analysis.
    // Currently uses deepAnalyze option if provided.
    if (aiOptions.deepAnalyze && !aiOptions.noAi) {
      try {
        // Re-analyze with AI options for semantic detection
        if (!analysisResult) {
          analysisResult = await analyzeProject(cwd, false, aiOptions);
        }
        const aiIssues = analysisResult.issues.filter(
          i => i.type === 'semantic_duplicate' || i.type === 'missing_inferred_dependency'
        );
        const duration = Date.now() - start;
        stage3Result = {
          executed: true,
          skipped: false,
          duration,
          summary: t(cwd).analyzeFixPipeline.stage3Complete.replace('{count}', String(aiIssues.length)).replace('{duration}', (duration / 1000).toFixed(1)),
        };
        console.log('   ' + t(cwd).analyzeFixPipeline.stage3Complete.replace('{count}', String(aiIssues.length)).replace('{duration}', (duration / 1000).toFixed(1)));
      } catch (error) {
        const duration = Date.now() - start;
        const errorMsg = error instanceof Error ? error.message : String(error);
        stage3Result = {
          executed: true,
          skipped: false,
          duration,
          summary: t(cwd).analyzeFixPipeline.stage3Failed.replace('{error}', errorMsg),
        };
        console.error('   ' + t(cwd).analyzeFixPipeline.stage3Failed.replace('{error}', errorMsg));
      }
    } else {
      const duration = Date.now() - start;
      stage3Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage3NotEnabled,
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage3NotEnabled);
    }
  } else {
    const skipReason = noAi ? '--no-ai' : '--rules-only/--checkpoints-only/--quality-only';
    stage3Result = emptyStageResult(t(cwd).analyzeFixPipeline.stage3Skipped.replace('{reason}', skipReason));
    console.log('   ' + t(cwd).analyzeFixPipeline.stage3Skipped.replace('{reason}', skipReason));
  }

  // ===== Stage 4: 检查点修复 =====
  let stage4Result: StageResult;
  if (runStage4) {
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage4Checkpoint);
    try {
      await fixCheckpoints(cwd, { nonInteractive, taskId });
      const duration = Date.now() - start;
      stage4Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage4Complete.replace('{duration}', (duration / 1000).toFixed(1)),
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage4Complete.replace('{duration}', (duration / 1000).toFixed(1)));
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      stage4Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage4Failed.replace('{error}', errorMsg),
      };
      console.error('   ' + t(cwd).analyzeFixPipeline.stage4Failed.replace('{error}', errorMsg));
    }
  } else {
    stage4Result = emptyStageResult(t(cwd).analyzeFixPipeline.stage4Skipped);
    console.log('   ' + t(cwd).analyzeFixPipeline.stage4Skipped);
  }

  // ===== Stage 5: 质量报告 =====
  let stage5Result: StageResult;
  if (runStage5) {
    const start = Date.now();
    console.log('\n' + t(cwd).analyzeFixPipeline.stage5Quality);
    try {
      const scores = await performQualityCheck(cwd, aiOptions);
      showQualityReport(scores, { compact, json, threshold });
      const lowQualityCount = Array.from(scores.values()).filter(s => s.totalScore < threshold).length;

      // 将低质量任务生成为 issue 并通过 fixSingleIssue 报告
      let qualityReportedCount = 0;
      if (lowQualityCount > 0) {
        console.log('\n   ' + t(cwd).analyzeFixPipeline.qualityIssuesFound.replace('{count}', String(lowQualityCount)));
        for (const [taskId, score] of scores) {
          if (score.totalScore < threshold) {
            const qualityIssue: Issue = {
              taskId,
              type: 'low_quality',
              severity: score.totalScore < 40 ? 'high' : 'medium',
              message: t(cwd).analyzeFixPipeline.lowQualityTask.replace('{taskId}', taskId).replace('{score}', String(score.totalScore)),
              suggestion: score.deductions.length > 0 && score.deductions[0]?.suggestion
                ? score.deductions[0].suggestion
                : t(cwd).analyzeFixPipeline.lowQualitySuggestion,
              details: { totalScore: score.totalScore, deductions: score.deductions },
            };
            await fixSingleIssue(qualityIssue, cwd, nonInteractive);
            qualityReportedCount++;
          }
        }
      }

      const duration = Date.now() - start;
      stage5Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage5Complete.replace('{count}', String(scores.size)).replace('{suggestions}', String(qualityReportedCount)).replace('{duration}', (duration / 1000).toFixed(1)),
      };
      console.log('   ' + t(cwd).analyzeFixPipeline.stage5Complete.replace('{count}', String(scores.size)).replace('{suggestions}', String(qualityReportedCount)).replace('{duration}', (duration / 1000).toFixed(1)));
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      stage5Result = {
        executed: true,
        skipped: false,
        duration,
        summary: t(cwd).analyzeFixPipeline.stage5Failed.replace('{error}', errorMsg),
      };
      console.error('   ' + t(cwd).analyzeFixPipeline.stage5Failed.replace('{error}', errorMsg));
    }
  } else {
    stage5Result = emptyStageResult(t(cwd).analyzeFixPipeline.stage5Skipped);
    console.log('   ' + t(cwd).analyzeFixPipeline.stage5Skipped);
  }

  // ===== Pipeline Summary =====
  const totalTime = Date.now() - pipelineStart;
  const allStages = [stage1Result, stage2Result, stage3Result, stage4Result, stage5Result];
  const executedStages = allStages.filter(s => s.executed).length;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(t(cwd).analyzeFixPipeline.pipelineComplete.replace('{stages}', String(executedStages)).replace('{duration}', (totalTime / 1000).toFixed(1)));
  console.log('━'.repeat(SEPARATOR_WIDTH));

  return {
    stages: {
      stage1: stage1Result,
      stage2: stage2Result,
      stage3: stage3Result,
      stage4: stage4Result,
      stage5: stage5Result,
    },
    totalTime,
  };
}

// ============== CP-5: applyStatusInferenceFix 统一修复管道 ==============

/**
 * 状态推断修复动作
 */
export type StatusInferenceAction =
  | 'reset_to_open'       // CP-1: 缺少恢复证据，重置为 open
  | 'update_status'       // CP-6: 更新状态到推断值
  | 'complete_checkpoints'; // CP-7: 自动完成 pending 检查点（旧版遗留）

/**
 * 状态推断修复结果
 */
export interface StatusInferenceFixResult {
  taskId: string;
  action: StatusInferenceAction;
  applied: boolean;
  oldValue?: string;
  newValue?: string;
  reason: string;
}

/**
 * CP-5: applyStatusInferenceFix — 统一修复管道
 *
 * 对所有任务执行 Layer 1 质量门禁规则检测，并自动应用修复：
 * - reset_to_open: pipeline 中间状态缺少前置报告
 * - update_status: 报告文件 PASS 但状态未推进
 * - complete_checkpoints: resolved 但检查点全 pending（旧版遗留）
 *
 * @param cwd 工作目录
 * @param nonInteractive 是否非交互模式
 * @returns 修复结果列表
 */
export async function applyStatusInferenceFix(
  cwd: string = process.cwd(),
  nonInteractive: boolean = true,
): Promise<StatusInferenceFixResult[]> {
  // 动态导入避免循环依赖（analyze.ts 已导入本模块）
  const {
    checkReportStatusConsistency,
    checkCheckpointConsistency,
    checkMissingPipelineEvidence,
  } = await import('./analyze');
  const { getAllTasks } = await import('../utils/task');

  const tasks = getAllTasks(cwd, false);
  const results: StatusInferenceFixResult[] = [];

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(t(cwd).analyzeFixPipeline.fixPipelineMode);
  console.log('   ' + t(cwd).analyzeFixPipeline.executingStages + ': ' + tasks.length);
  console.log('━'.repeat(SEPARATOR_WIDTH));

  for (const task of tasks) {
    // CP-4 → CP-1: missing_pipeline_evidence → reset_to_open
    const evidenceIssue = checkMissingPipelineEvidence(task.id, task, cwd);
    if (evidenceIssue) {
      const fixIssue: Issue = {
        ...evidenceIssue,
        type: 'missing_pipeline_evidence',
      };
      const fixResult = await fixSingleIssue(fixIssue, cwd, nonInteractive);
      results.push({
        taskId: task.id,
        action: 'reset_to_open',
        applied: fixResult === 'fixed',
        oldValue: task.status,
        newValue: 'open',
        reason: evidenceIssue.message,
      });
      if (fixResult === 'fixed') {
        // 重新读取已更新的 task
        const updatedTask = readTaskMeta(task.id, cwd);
        if (updatedTask) Object.assign(task, updatedTask);
      }
    }

    // CP-2 → CP-6: report_status_mismatch → update_status
    const reportIssue = checkReportStatusConsistency(task.id, task, cwd);
    if (reportIssue) {
      const fixResult = await fixSingleIssue(reportIssue, cwd, nonInteractive);
      results.push({
        taskId: task.id,
        action: 'update_status',
        applied: fixResult === 'fixed',
        oldValue: task.status,
        newValue: reportIssue.details?.impliedStatus as string,
        reason: reportIssue.message,
      });
      if (fixResult === 'fixed') {
        const updatedTask = readTaskMeta(task.id, cwd);
        if (updatedTask) Object.assign(task, updatedTask);
      }
    }

    // CP-3 → CP-7: checkpoint_status_mismatch → complete_checkpoints
    const checkpointIssue = checkCheckpointConsistency(task.id, task);
    if (checkpointIssue) {
      const fixResult = await fixSingleIssue(checkpointIssue, cwd, nonInteractive);
      results.push({
        taskId: task.id,
        action: 'complete_checkpoints',
        applied: fixResult === 'fixed',
        oldValue: `${checkpointIssue.details?.pendingCheckpoints} pending`,
        newValue: `${checkpointIssue.details?.totalCheckpoints} completed`,
        reason: checkpointIssue.message,
      });
    }
  }

  // 汇总
  const applied = results.filter(r => r.applied).length;
  const skipped = results.filter(r => !r.applied).length;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(t(cwd).analyzeFixPipeline.fixComplete.replace('{count}', String(applied)) + ', ' + t(cwd).analyzeFixPipeline.fixSkipped.replace('{count}', String(skipped)));
  console.log('━'.repeat(SEPARATOR_WIDTH));

  return results;
}
