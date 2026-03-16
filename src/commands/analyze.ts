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

/**
 * 分析问题接口
 */
export interface Issue {
  taskId: string;
  type: 'stale' | 'orphan' | 'cycle' | 'blocked' | 'no_description' | 'legacy_priority' | 'legacy_status';
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
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
 */
export function showAnalysis(cwd: string = process.cwd()): void {
  const result = analyzeProject(cwd);

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 项目健康分析报告');
  console.log('━'.repeat(60));
  console.log('');

  // 显示统计
  console.log('📈 统计概览:');
  console.log(`   总任务数: ${result.stats.total}`);
  console.log('');
  console.log('   按状态:');
  console.log(`     ⬜ 待处理: ${result.stats.byStatus.open}`);
  console.log(`     🔵 进行中: ${result.stats.byStatus.in_progress}`);
  console.log(`     ✅ 已解决: ${result.stats.byStatus.resolved}`);
  console.log(`     ⚫ 已关闭: ${result.stats.byStatus.closed}`);
  console.log(`     🔄 已重开: ${result.stats.byStatus.reopened}`);
  console.log(`     ❌ 已放弃: ${result.stats.byStatus.abandoned}`);
  console.log('');
  console.log('   按优先级:');
  console.log(`     🔴 P0 (紧急): ${result.stats.byPriority.P0}`);
  console.log(`     🟠 P1 (高): ${result.stats.byPriority.P1}`);
  console.log(`     🟡 P2 (中): ${result.stats.byPriority.P2}`);
  console.log(`     🟢 P3 (低): ${result.stats.byPriority.P3}`);
  console.log(`     📊 Q1: ${result.stats.byPriority.Q1}`);
  console.log(`     📊 Q2: ${result.stats.byPriority.Q2}`);
  console.log(`     📊 Q3: ${result.stats.byPriority.Q3}`);
  console.log(`     📊 Q4: ${result.stats.byPriority.Q4}`);
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
    console.log('━'.repeat(60));
    console.log('🔍 详细问题列表');
    console.log('━'.repeat(60));
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

  console.log('━'.repeat(60));
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
 */
export function showStatus(includeArchived: boolean = false, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const tasks = getAllTasks(cwd, includeArchived);
  const result = analyzeProject(cwd, includeArchived);

  console.log('');
  console.log('━'.repeat(60));
  console.log('📋 项目状态摘要');
  console.log('━'.repeat(60));
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
  const healthScore = calculateHealthScore(result);
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

  console.log('━'.repeat(60));
}

/**
 * 计算 Reopen 统计
 */
function calculateReopenStats(tasks: TaskMeta[]): { reopenCount: number; topReopened: { taskId: string; title: string; count: number }[] } {
  const reopenCount = tasks.filter(t => t.status === 'reopened').length;

  // 统计历史记录中的 reopen 次数
  const reopenCounts: { taskId: string; title: string; count: number }[] = [];

  for (const task of tasks) {
    if (task.history) {
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
