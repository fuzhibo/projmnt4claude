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
  writeTaskMeta,
  getAllTaskIds,
  buildTaskVerification,
  renameTask,
} from '../utils/task';
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

// ============== 修复选项类型 ==============

export interface FixOptions {
  nonInteractive?: boolean;
}

// ============== 修复管线核心 ==============

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
        // 自动决策: 超过 30 天的过期任务自动关闭
        const updatedAt = new Date(task.updatedAt);
        const staleDays = Math.floor((Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000));
        if (staleDays > 30) {
          task.status = 'closed';
          if (!task.history) task.history = [];
          task.history.push({
            timestamp: new Date().toISOString(),
            action: 'auto_close_stale',
            field: 'status',
            oldValue: task.status,
            newValue: 'closed',
            reason: `非交互模式自动关闭: 任务已过期 ${staleDays} 天 (>30天阈值)`,
            user: 'analyze-fix',
          });
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已自动关闭过期 ${staleDays} 天的任务 ${issue.taskId} (>30天阈值)`);
          return 'fixed';
        }
        console.log(`⏭️  跳过过期任务 ${issue.taskId} (${staleDays}天, 非交互模式下超过30天才自动关闭)`);
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
      console.log(`🔄 分析任务 ${issue.taskId} 的循环依赖...`);
      // CP-1/CP-15: Use graph module to detect cycles and get auto-fix suggestions
      const allCycleTasks = getAllTaskIds(cwd).map(id => readTaskMeta(id, cwd)).filter((t): t is TaskMeta => t !== null);
      const cycleGraph = DependencyGraph.fromTasks(allCycleTasks);
      const anomalies = cycleGraph.detectAnomalies();

      // Find cycle anomalies involving this task
      const cycleAnomalies = anomalies.filter(a => a.type === 'cycle' && a.nodeIds.includes(issue.taskId));
      if (cycleAnomalies.length === 0) {
        console.log(`   ⚠️  未找到涉及 ${issue.taskId} 的循环依赖（可能已修复）`);
        return 'skipped';
      }

      // Try to apply auto-fix suggestions
      let fixedAny = false;
      for (const anomaly of cycleAnomalies) {
        if (anomaly.autoFix) {
          console.log(`   💡 ${anomaly.autoFix.description}`);
          for (const change of anomaly.autoFix.edgeChanges) {
            if (change.action === 'remove') {
              const fromTask = readTaskMeta(change.from, cwd);
              if (fromTask && fromTask.dependencies.includes(change.to)) {
                fromTask.dependencies = fromTask.dependencies.filter(d => d !== change.to);
                writeTaskMeta(fromTask, cwd);
                console.log(`  ✅ 已断开 ${change.from} → ${change.to} 的依赖以打破循环`);
                fixedAny = true;
              }
            }
          }
        } else {
          console.log(`   ⚠️  循环 ${(anomaly.cyclePath || anomaly.nodeIds).join(' → ')} 中所有边均为显式依赖，需人工处理`);
        }
      }

      if (fixedAny) {
        return 'fixed';
      }
      console.log(`   建议: 手动检查并调整循环依赖中任务的依赖关系`);
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

    case 'null_array_field': {
      const fields = (issue.details?.fields as string[]) ?? [];
      if (fields.length === 0) return 'skipped';
      console.log(`🔄 修复任务 ${issue.taskId} 的空数组字段: ${fields.join(', ')}`);
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
          console.log(`  ✅ 已初始化 ${field}: []`);
        }
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
        if (!task.history) task.history = [];
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
      if (!task.history) task.history = [];
      for (let i = 0; i < task.history.length; i++) {
        const entry = task.history[i]!;
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

    case 'invalid_type_value': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效类型值...`);
      if (issue.details?.currentValue) {
        const oldType = task.type;
        task.type = normalizeType(task.type) as TaskType;
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将类型从 ${oldType} 更新为 ${task.type}`);
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'invalid_priority_value': {
      console.log(`🔄 修复任务 ${issue.taskId} 的无效优先级值...`);
      if (issue.details?.currentValue) {
        const oldPriority = task.priority;
        task.priority = normalizePriority(task.priority);
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将优先级从 ${oldPriority} 更新为 ${task.priority}`);
        return 'fixed';
      }
      return 'unfixable';
    }

    case 'status_reopen_mismatch': {
      console.log(`🔄 修复任务 ${issue.taskId} 的 reopen 流转记录缺失...`);
      // 确保 transitionNotes 已初始化
      if (!task.transitionNotes) task.transitionNotes = [];

      // 补录 reopen transitionNote
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'resolved',
        toStatus: 'open',
        note: `补录 reopen 流转记录 (reopenCount=${task.reopenCount})`,
        author: 'analyze-fix',
      });

      // 确保 status 为 open（已废弃 reopened）
      if ((task.status as string) === 'reopened') {
        task.status = 'open';
      }

      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已补录 transitionNote，reopenCount=${task.reopenCount}`);
      return 'fixed';
    }

    case 'inconsistent_status': {
      console.log(`🔄 修复任务 ${issue.taskId} 的状态矛盾 (resolved + verification.failed)...`);
      // 将状态改回 open，清除旧的 verification
      task.status = 'open';
      task.verification = undefined;
      task.updatedAt = new Date().toISOString();
      if (!task.history) task.history = [];
      task.history.push({
        timestamp: new Date().toISOString(),
        action: `状态变更: resolved → open`,
        field: 'status',
        oldValue: 'resolved',
        newValue: 'open',
        reason: '修复状态矛盾: resolved 但 verification.result=failed',
        user: 'analyze-fix',
      });
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已将状态从 resolved 改为 open，清除旧 verification`);
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
            writeTaskMeta(task, cwd);
            for (const invalidId of invalidRefs) {
              console.log(`  ✅ 已从 dependencies 中移除无效引用 ${invalidId}`);
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
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已从 dependencies 中移除无效引用 ${invalidId}`);
          removedAny = true;
        }
      }

      return removedAny ? 'fixed' : 'skipped';
    }

    case 'missing_inferred_dependency': {
      console.log(`🔄 修复任务 ${issue.taskId} 的推断依赖缺失...`);
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
                console.log(`   ⚠️  推断依赖 ${inferred.depTaskId} 不存在，跳过`);
                continue;
              }
              // Use graph to check if adding this dep would create a cycle
              if (inferredGraph.wouldCreateCycle(issue.taskId, inferred.depTaskId)) {
                console.log(`   ⚠️  添加推断依赖 ${inferred.depTaskId} 会形成循环，跳过 (GATE-DEP-002)`);
                continue;
              }
              task.dependencies.push(inferred.depTaskId);
              console.log(`  ✅ 已添加推断依赖 ${inferred.depTaskId}: ${inferred.reason}`);
              addedAny = true;
            }
          }
          if (addedAny) {
            writeTaskMeta(task, cwd);
            return 'fixed';
          }
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

    case 'missing_transition_note': {
      console.log(`🔄 回填任务 ${issue.taskId} 的 transitionNote...`);
      const historyEntry = issue.details?.historyEntry as TaskHistoryEntry | undefined;
      if (!historyEntry) {
        console.log(`  ⚠️  缺少历史条目详情，无法回填`);
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
        'wait_qa→wait_complete': 'QA通过，等待完成确认',
        'wait_complete→resolved': '任务完成',
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
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 已回填 transitionNote: ${statusKey} (${author})`);
      return 'fixed';
    }

    case 'interrupted_task': {
      const suggestedStatus = issue.details?.suggestedStatus as string | undefined;
      if (!suggestedStatus) {
        console.log(`  ⚠️  缺少状态建议，无法自动修复`);
        return 'unfixable';
      }

      console.log(`🔄 修复中断任务 ${issue.taskId}...`);
      console.log(`   当前状态: ${task.status} → 建议状态: ${suggestedStatus}`);
      console.log(`   原因: ${issue.details?.suggestionReason || issue.suggestion}`);

      // 如果建议保持 in_progress，跳过
      if (suggestedStatus === 'in_progress') {
        console.log(`  ⏭️  建议保持 in_progress，跳过修复`);
        return 'skipped';
      }

      // 非交互模式下直接应用建议
      if (nonInteractive || !process.stdin.isTTY) {
        const oldStatus = task.status;
        task.status = suggestedStatus as TaskStatus;
        task.updatedAt = new Date().toISOString();

        // 添加 history 记录
        if (!task.history) task.history = [];
        task.history.push({
          timestamp: new Date().toISOString(),
          action: 'analyze_interrupted_task_fix',
          field: 'status',
          oldValue: oldStatus,
          newValue: suggestedStatus,
          reason: `中断任务自动修复: ${issue.details?.suggestionReason || ''}`,
        });

        // 添加 transitionNote
        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: suggestedStatus as TaskStatus,
          note: `中断任务自动修复: ${(issue.details?.interruptedDays as number) || 0} 天无活跃 Pipeline`,
          author: 'analyze',
        });

        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将任务 ${issue.taskId} 状态从 ${oldStatus} 修改为 ${suggestedStatus}`);
        return 'fixed';
      }

      // 交互模式下询问用户
      const response = await prompts({
        type: 'confirm',
        name: 'apply',
        message: `是否将任务 ${issue.taskId} 状态从 ${task.status} 修改为 ${suggestedStatus}?`,
        initial: true,
      });

      if (response.apply) {
        const oldStatus = task.status;
        task.status = suggestedStatus as TaskStatus;
        task.updatedAt = new Date().toISOString();

        if (!task.history) task.history = [];
        task.history.push({
          timestamp: new Date().toISOString(),
          action: 'analyze_interrupted_task_fix',
          field: 'status',
          oldValue: oldStatus,
          newValue: suggestedStatus,
          reason: `中断任务手动确认修复: ${issue.details?.suggestionReason || ''}`,
        });

        if (!task.transitionNotes) task.transitionNotes = [];
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: oldStatus as TaskStatus,
          toStatus: suggestedStatus as TaskStatus,
          note: `中断任务手动确认修复: ${(issue.details?.interruptedDays as number) || 0} 天无活跃 Pipeline`,
          author: 'analyze',
        });

        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已将任务 ${issue.taskId} 状态从 ${oldStatus} 修改为 ${suggestedStatus}`);
        return 'fixed';
      }
      return 'skipped';
    }

    case 'reopened_status': {
      console.log(`🔄 迁移任务 ${issue.taskId} 的废弃 reopened 状态...`);
      const oldStatus = task.status;
      task.status = 'open';
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'reopened',
        toStatus: 'open',
        note: 'analyze --fix: reopened 状态已废弃，迁移为 open',
        author: 'analyze-fix',
      });
      if (!task.history) task.history = [];
      task.history.push({
        timestamp: new Date().toISOString(),
        action: 'deprecated_status_migration',
        field: 'status',
        oldValue: oldStatus,
        newValue: 'open',
        reason: 'reopened 状态已废弃（v4），迁移为 open',
        user: 'analyze-fix',
      });
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 状态已从 reopened 迁移为 open`);
      return 'fixed';
    }

    case 'needs_human_status': {
      console.log(`🔄 迁移任务 ${issue.taskId} 的废弃 needs_human 状态...`);
      const oldStatus = task.status;
      task.status = 'open';
      if (!task.transitionNotes) task.transitionNotes = [];
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: 'needs_human',
        toStatus: 'open',
        note: 'analyze --fix: needs_human 状态已废弃，迁移为 open 以便重新处理',
        author: 'analyze-fix',
      });
      if (!task.history) task.history = [];
      task.history.push({
        timestamp: new Date().toISOString(),
        action: 'deprecated_status_migration',
        field: 'status',
        oldValue: oldStatus,
        newValue: 'open',
        reason: 'needs_human 状态已废弃（v4），迁移为 open',
        user: 'analyze-fix',
      });
      writeTaskMeta(task, cwd);
      console.log(`  ✅ 状态已从 needs_human 迁移为 open`);
      return 'fixed';
    }

    case 'low_checkpoint_coverage': {
      console.log(`⚠️  项目检查点覆盖率不足，需人工补充`);
      if (issue.details?.tasksWithoutCheckpoints) {
        console.log(`   缺少检查点的任务数: ${issue.details.tasksWithoutCheckpoints}`);
      }
      if (issue.details?.coverageRate != null) {
        console.log(`   当前覆盖率: ${((issue.details.coverageRate as number) * 100).toFixed(1)}%`);
      }
      console.log(`   建议: 使用 --fix --checkpoints-only 自动生成检查点，或手动为任务添加验收标准`);
      return 'unfixable';
    }

    case 'low_quality': {
      console.log(`⚠️  任务 ${issue.taskId} 内容质量低 (${issue.details?.totalScore ?? '?'}分/100)`);
      const deductions = (issue.details?.deductions as Array<{ reason: string; suggestion?: string }> | undefined) ?? [];
      if (deductions.length > 0) {
        for (const d of deductions.slice(0, 3)) {
          console.log(`   └─ ${d.reason}${d.suggestion ? ` (建议: ${d.suggestion})` : ''}`);
        }
      }
      console.log(`   建议: ${issue.suggestion}`);
      return 'unfixable';
    }

    case 'deprecated_status_reference': {
      console.log(`🔄 清理任务 ${issue.taskId} 历史记录中的废弃状态引用...`);
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
        writeTaskMeta(task, cwd);
        console.log(`  ✅ 已清理历史记录中的废弃状态引用`);
        return 'fixed';
      }
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
    console.log('✅ 没有需要修复的问题');
    return { fixed: 0, skipped: 0, unfixable: 0 };
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔧 自动修复问题');
  if (nonInteractive) {
    console.log('   (非交互模式)');
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
      console.error(`❌ 修复 ${issue.taskId} (${issue.type}) 时出错: ${error instanceof Error ? error.message : String(error)}`);
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
  console.log(`✅ 共修复 ${fixedCount} 个问题`);
  if (skippedCount > 0) console.log(`⏭️  跳过 ${skippedCount} 个问题`);
  if (unfixableCount > 0) console.log(`⚠️  ${unfixableCount} 个问题无法自动修复`);
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
  console.log('🔧 analyze --fix 流水线模式');
  const stages: string[] = [];
  if (runStage1) stages.push('1');
  if (runStage2) stages.push('2');
  if (runStage3) stages.push('3');
  if (runStage4) stages.push('4');
  if (runStage5) stages.push('5');
  console.log(`   执行阶段: ${stages.join(', ')} / 5`);
  console.log('━'.repeat(SEPARATOR_WIDTH));

  // ===== Stage 1: 规则引擎分析 =====
  let stage1Result: StageResult;
  if (runStage1) {
    const start = Date.now();
    console.log('\n📋 Stage 1: 规则引擎分析...');
    try {
      analysisResult = await analyzeProject(cwd, false, aiOptions);
      const issueCount = analysisResult.issues.length;
      const duration = Date.now() - start;
      stage1Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `发现 ${issueCount} 个问题`,
      };
      console.log(`   ✅ Stage 1 完成: 发现 ${issueCount} 个问题 (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = Date.now() - start;
      stage1Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `分析失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      console.error(`   ❌ Stage 1 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    stage1Result = emptyStageResult('跳过 (--checkpoints-only 或 --quality-only)');
    console.log('   ⏭️  Stage 1: 跳过');
  }

  // ===== Stage 2: 规则修复 =====
  let stage2Result: StageResult;
  if (runStage2 && analysisResult) {
    const start = Date.now();
    console.log('\n🔧 Stage 2: 规则修复...');
    try {
      const fixResult = await fixIssues(cwd, { nonInteractive }, analysisResult);
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `修复 ${fixResult.fixed} 个, 跳过 ${fixResult.skipped} 个, 不可修复 ${fixResult.unfixable} 个`,
      };
      console.log(`   ✅ Stage 2 完成: ${fixResult.fixed} 修复, ${fixResult.skipped} 跳过 (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `修复失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      console.error(`   ❌ Stage 2 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (runStage2 && !analysisResult) {
    // Stage 1 was skipped but we still need analysis for stage 2
    const start = Date.now();
    console.log('\n🔧 Stage 2: 规则修复 (含分析)...');
    try {
      const fixResult = await fixIssues(cwd, { nonInteractive });
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `修复 ${fixResult.fixed} 个, 跳过 ${fixResult.skipped} 个, 不可修复 ${fixResult.unfixable} 个`,
      };
      console.log(`   ✅ Stage 2 完成: ${fixResult.fixed} 修复, ${fixResult.skipped} 跳过 (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = Date.now() - start;
      stage2Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `修复失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      console.error(`   ❌ Stage 2 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    stage2Result = emptyStageResult('跳过 (--rules-only 未设置但缺少分析结果, 或 --checkpoints-only/--quality-only)');
    console.log('   ⏭️  Stage 2: 跳过');
  }

  // ===== Stage 3: AI 分析 =====
  let stage3Result: StageResult;
  if (runStage3) {
    const start = Date.now();
    console.log('\n🤖 Stage 3: AI 深度分析...');
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
          summary: `AI 发现 ${aiIssues.length} 个语义问题`,
        };
        console.log(`   ✅ Stage 3 完成: AI 发现 ${aiIssues.length} 个语义问题 (${(duration / 1000).toFixed(1)}s)`);
      } catch (error) {
        const duration = Date.now() - start;
        stage3Result = {
          executed: true,
          skipped: false,
          duration,
          summary: `AI 分析失败: ${error instanceof Error ? error.message : String(error)}`,
        };
        console.error(`   ❌ Stage 3 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      const duration = Date.now() - start;
      stage3Result = {
        executed: true,
        skipped: false,
        duration,
        summary: 'AI 深度分析未启用 (使用 --deep-analyze 激活)',
      };
      console.log('   ⏭️  Stage 3: AI 深度分析未启用 (使用 --deep-analyze 激活完整 AI 分析)');
    }
  } else {
    stage3Result = emptyStageResult(noAi ? '跳过 (--no-ai)' : '跳过 (--rules-only/--checkpoints-only/--quality-only)');
    console.log(`   ⏭️  Stage 3: 跳过 (${noAi ? '--no-ai' : '未选择'})`);
  }

  // ===== Stage 4: 检查点修复 =====
  let stage4Result: StageResult;
  if (runStage4) {
    const start = Date.now();
    console.log('\n📌 Stage 4: 检查点修复...');
    try {
      await fixCheckpoints(cwd, { nonInteractive, taskId });
      const duration = Date.now() - start;
      stage4Result = {
        executed: true,
        skipped: false,
        duration,
        summary: '检查点修复完成',
      };
      console.log(`   ✅ Stage 4 完成: 检查点修复 (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = Date.now() - start;
      stage4Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `检查点修复失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      console.error(`   ❌ Stage 4 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    stage4Result = emptyStageResult('跳过 (--rules-only 或 --quality-only)');
    console.log('   ⏭️  Stage 4: 跳过');
  }

  // ===== Stage 5: 质量报告 =====
  let stage5Result: StageResult;
  if (runStage5) {
    const start = Date.now();
    console.log('\n📊 Stage 5: 质量报告...');
    try {
      const scores = await performQualityCheck(cwd, aiOptions);
      showQualityReport(scores, { compact, json, threshold });
      const lowQualityCount = Array.from(scores.values()).filter(s => s.totalScore < threshold).length;

      // 将低质量任务生成为 issue 并通过 fixSingleIssue 报告
      let qualityReportedCount = 0;
      if (lowQualityCount > 0) {
        console.log(`\n   🔍 检测到 ${lowQualityCount} 个低质量任务，生成修复建议...`);
        for (const [taskId, score] of scores) {
          if (score.totalScore < threshold) {
            const qualityIssue: Issue = {
              taskId,
              type: 'low_quality',
              severity: score.totalScore < 40 ? 'high' : 'medium',
              message: `任务内容质量低 (${score.totalScore}/100)`,
              suggestion: score.deductions.length > 0 && score.deductions[0]?.suggestion
                ? score.deductions[0].suggestion
                : '改善任务描述、检查点、关联文件等质量',
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
        summary: `检测 ${scores.size} 个任务, ${lowQualityCount} 个低质量, ${qualityReportedCount} 个已生成改进建议`,
      };
      console.log(`   ✅ Stage 5 完成: 检测 ${scores.size} 个任务, ${qualityReportedCount} 个改进建议 (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = Date.now() - start;
      stage5Result = {
        executed: true,
        skipped: false,
        duration,
        summary: `质量报告失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      console.error(`   ❌ Stage 5 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    stage5Result = emptyStageResult('跳过 (--rules-only 或 --checkpoints-only)');
    console.log('   ⏭️  Stage 5: 跳过');
  }

  // ===== Pipeline Summary =====
  const totalTime = Date.now() - pipelineStart;
  const allStages = [stage1Result, stage2Result, stage3Result, stage4Result, stage5Result];
  const executedStages = allStages.filter(s => s.executed).length;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`✅ 流水线完成: ${executedStages}/5 阶段已执行 (${(totalTime / 1000).toFixed(1)}s)`);
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
