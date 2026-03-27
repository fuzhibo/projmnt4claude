import prompts from 'prompts';
import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, getTasksDir, getArchiveDir, getProjectDir } from '../utils/path';
import {
  readTaskMeta,
  writeTaskMeta,
  getAllTasks,
  taskExists,
  isSubtask,
} from '../utils/task';
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
} from '../types/task';

import { areDependenciesCompleted } from '../utils/plan';

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
const VALID_STATUSES: TaskStatus[] = ['open', 'in_progress', 'wait_review', 'wait_qa', 'wait_complete', 'resolved', 'closed', 'reopened', 'abandoned'];

/**
 * 有效的任务类型
 */
const VALID_TYPES = ['bug', 'feature', 'research', 'docs', 'refactor', 'test'];

/**
 * 有效的优先级
 */
const VALID_PRIORITIES: TaskPriority[] = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

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
    // 历史记录检查
    | 'invalid_history_format' | 'invalid_requirement_history_format'
    // 时间戳检查
    | 'invalid_timestamp_format'
    // ID 检查
    | 'invalid_task_id_format'
    // 验证方法检查
    | 'manual_verification';
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
}

export interface AnalysisResult {
  issues: Issue[];
  stats: AnalysisStats;
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

  // 初始化统计
  const stats: AnalysisStats = {
    total: tasks.length,
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

  for (const task of tasks) {
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

    // 检测循环依赖
    if (!visited.has(task.id)) {
      detectCycle(task.id);
    }
  }

  // 计算子任务统计
  const parentTasks = tasks.filter(t => !isSubtask(t.id));
  const subtasks = tasks.filter(t => isSubtask(t.id));
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

  const separator = options.compact ? '---' : '━'.repeat(60);

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
 * 自动修复问题
 * @param cwd 工作目录
 * @param nonInteractive 非交互模式：自动修复可修复的问题，跳过需要用户输入的问题
 */
export async function fixIssues(cwd: string = process.cwd(), nonInteractive: boolean = false): Promise<void> {
  const result = analyzeProject(cwd);

  if (result.issues.length === 0) {
    console.log('✅ 没有需要修复的问题');
    return;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('🔧 自动修复问题');
  if (nonInteractive) {
    console.log('   (非交互模式)');
  }
  console.log('━'.repeat(60));
  console.log('');

  let fixedCount = 0;
  let skippedCount = 0;

  for (const issue of result.issues) {
    const task = readTaskMeta(issue.taskId, cwd);
    if (!task) continue;

    switch (issue.type) {
      case 'stale': {
        if (nonInteractive) {
          console.log(`⏭️  跳过过期任务 ${issue.taskId} (非交互模式下需要手动处理)`);
          skippedCount++;
          break;
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
          fixedCount++;
        } else if (response.action === 'progress') {
          task.status = 'in_progress';
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将任务 ${issue.taskId} 标记为进行中`);
          fixedCount++;
        }
        break;
      }

      case 'no_description': {
        if (nonInteractive) {
          console.log(`⏭️  跳过无描述任务 ${issue.taskId} (非交互模式下需要手动处理)`);
          skippedCount++;
          break;
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
          fixedCount++;
        }
        break;
      }

      case 'cycle': {
        console.log(`⚠️  任务 ${issue.taskId} 存在循环依赖，需要手动处理`);
        break;
      }

      case 'legacy_priority': {
        console.log(`🔄 修复任务 ${issue.taskId} 的优先级格式...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task) {
          const oldPriority = task.priority;
          const newPriority = normalizePriority(task.priority);
          task.priority = newPriority;
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将优先级从 ${oldPriority} 更新为 ${newPriority}`);
          fixedCount++;
        }
        break;
      }

      case 'legacy_status': {
        console.log(`🔄 修复任务 ${issue.taskId} 的状态格式...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task) {
          const oldStatus = task.status;
          const newStatus = normalizeStatus(task.status);
          task.status = newStatus;
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将状态从 ${oldStatus} 更新为 ${newStatus}`);
          fixedCount++;
        }
        break;
      }

      case 'legacy_schema': {
        console.log(`🔄 修复任务 ${issue.taskId} 的规范字段...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task) {
          // 添加缺失的新规范字段
          if (task.reopenCount === undefined) {
            task.reopenCount = 0;
            console.log(`  ✅ 已添加 reopenCount: 0`);
          }
          if (task.requirementHistory === undefined) {
            task.requirementHistory = [];
            console.log(`  ✅ 已添加 requirementHistory: []`);
          }
          writeTaskMeta(task, cwd);
          fixedCount++;
        }
        break;
      }

      // ========== 新增：规范合规性修复 ==========

      case 'invalid_status_value': {
        console.log(`🔄 修复任务 ${issue.taskId} 的无效状态值...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && issue.details?.currentValue) {
          const oldStatus = task.status;
          // 尝试规范化，如果失败则设为 'open'
          task.status = normalizeStatus(task.status);
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将状态从 ${oldStatus} 更新为 ${task.status}`);
          fixedCount++;
        }
        break;
      }

      case 'status_reopen_mismatch': {
        console.log(`🔄 修复任务 ${issue.taskId} 的 reopenCount 不一致...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task) {
          // 从历史记录计算 reopen 次数
          const reopenFromHistory = task.history?.filter(
            (h: TaskHistoryEntry) => h.action === 'status_change' && h.newValue === 'reopened'
          ).length || 0;

          task.reopenCount = Math.max(1, reopenFromHistory);
          writeTaskMeta(task, cwd);
          console.log(`  ✅ 已将 reopenCount 设置为 ${task.reopenCount}`);
          fixedCount++;
        }
        break;
      }

      case 'invalid_timestamp_format': {
        console.log(`🔄 修复任务 ${issue.taskId} 的时间戳格式...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && issue.details?.field) {
          const field = issue.details.field as string;
          const now = new Date().toISOString();

          if (field === 'createdAt' || field === 'updatedAt') {
            (task as Record<string, unknown>)[field] = now;
            writeTaskMeta(task, cwd);
            console.log(`  ✅ 已将 ${field} 更新为 ${now}`);
            fixedCount++;
          }
        }
        break;
      }

      case 'invalid_parent_ref': {
        console.log(`⚠️  任务 ${issue.taskId} 的父任务引用无效，无法自动修复`);
        console.log(`   建议: 手动检查并删除无效的 parentId 或创建父任务`);
        skippedCount++;
        break;
      }

      case 'invalid_subtask_ref': {
        console.log(`🔄 修复任务 ${issue.taskId} 的无效子任务引用...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && task.subtaskIds && issue.details?.subtaskId) {
          const invalidId = issue.details.subtaskId as string;
          const oldLength = task.subtaskIds.length;
          task.subtaskIds = task.subtaskIds.filter(id => id !== invalidId);
          if (task.subtaskIds.length < oldLength) {
            writeTaskMeta(task, cwd);
            console.log(`  ✅ 已从 subtaskIds 中移除无效引用 ${invalidId}`);
            fixedCount++;
          }
        }
        break;
      }

      case 'invalid_dependency_ref': {
        console.log(`🔄 修复任务 ${issue.taskId} 的无效依赖引用...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && task.dependencies && issue.details?.dependencyId) {
          const invalidId = issue.details.dependencyId as string;
          const oldLength = task.dependencies.length;
          task.dependencies = task.dependencies.filter(id => id !== invalidId);
          if (task.dependencies.length < oldLength) {
            writeTaskMeta(task, cwd);
            console.log(`  ✅ 已从 dependencies 中移除无效引用 ${invalidId}`);
            fixedCount++;
          }
        }
        break;
      }

      case 'subtask_not_in_parent': {
        console.log(`🔄 修复子任务 ${issue.taskId} 在父任务中的引用...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && task.parentId) {
          const parentTask = readTaskMeta(task.parentId, cwd);
          if (parentTask) {
            if (!parentTask.subtaskIds) {
              parentTask.subtaskIds = [];
            }
            if (!parentTask.subtaskIds.includes(task.id)) {
              parentTask.subtaskIds.push(task.id);
              writeTaskMeta(parentTask, cwd);
              console.log(`  ✅ 已将子任务添加到父任务的 subtaskIds 中`);
              fixedCount++;
            }
          }
        }
        break;
      }

      case 'parent_child_mismatch': {
        console.log(`🔄 修复任务 ${issue.taskId} 的父子关系不一致...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && issue.details?.subtaskId && issue.details?.expectedParentId) {
          const subtaskId = issue.details.subtaskId as string;
          const subtask = readTaskMeta(subtaskId, cwd);
          if (subtask) {
            subtask.parentId = issue.details.expectedParentId as string;
            writeTaskMeta(subtask, cwd);
            console.log(`  ✅ 已将子任务 ${subtaskId} 的 parentId 更新为 ${subtask.parentId}`);
            fixedCount++;
          }
        }
        break;
      }

      case 'invalid_history_format':
      case 'invalid_requirement_history_format':
      case 'invalid_task_id_format': {
        console.log(`⚠️  任务 ${issue.taskId} 的 ${issue.type} 问题无法自动修复`);
        console.log(`   建议: ${issue.suggestion}`);
        skippedCount++;
        break;
      }

      // ========== 新增：manual 验证修复 ==========

      case 'manual_verification': {
        console.log(`🔄 修复任务 ${issue.taskId} 的 manual 验证方法...`);
        const task = readTaskMeta(issue.taskId, cwd);
        if (task && task.checkpoints && issue.details?.checkpointIds) {
          let fixedCount_local = 0;
          for (const cpId of issue.details.checkpointIds as string[]) {
            const cp = task.checkpoints.find(c => c.id === cpId);
            if (cp && cp.verification && (cp.verification.method as string) === 'manual') {
              // 将 manual 替换为 automated
              cp.verification.method = 'automated';
              console.log(`  ✅ 检查点 ${cpId}: manual -> automated`);
              fixedCount_local++;
            }
          }
          if (fixedCount_local > 0) {
            writeTaskMeta(task, cwd);
            fixedCount++;
          }
        }
        break;
      }

      default:
        break;
    }
  }

  console.log('');
  console.log(`━`.repeat(60));
  console.log(`✅ 共修复 ${fixedCount} 个问题`);
  console.log('━'.repeat(60));
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
  const separator = options.compact ? '---' : '━'.repeat(60);

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

  // 无描述任务轻微扣分
  const noDescIssues = result.issues.filter(i => i.type === 'no_description').length;
  score -= noDescIssues * 0.5;

  return Math.max(0, Math.min(100, Math.round(score)));
}
