import * as path from 'path';
import * as fs from 'fs';
import { getProjectDir, isInitialized } from './path';
import { readTaskMeta, getAllTasks, isSubtask } from './task';
import { normalizeStatus } from '../types/task';

/**
 * 可执行状态及其优先级（数字越小优先级越高）
 */
const EXECUTABLE_STATUS_PRIORITY: Record<string, number> = {
  'in_progress': 1,   // 进行中的任务应该继续
  'open': 2,          // 新任务
};

/**
 * 检查状态是否可执行
 */
function isExecutableStatus(status: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized in EXECUTABLE_STATUS_PRIORITY;
}

/**
 * 获取状态优先级
 */
function getStatusPriority(status: string): number {
  const normalized = normalizeStatus(status);
  return EXECUTABLE_STATUS_PRIORITY[normalized] ?? 999;
}

/**
 * 执行计划接口
 */
export interface ExecutionPlan {
  tasks: string[];      // 任务ID列表（有序，向后兼容）
  batches?: string[][]; // 按批次分组的任务ID二维数组
  createdAt: string;    // 创建时间
  updatedAt: string;    // 更新时间
}

/**
 * 获取执行计划文件路径
 */
export function getPlanPath(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'current-plan.json');
}

/**
 * 读取执行计划
 */
export function readPlan(cwd: string = process.cwd()): ExecutionPlan | null {
  if (!isInitialized(cwd)) {
    return null;
  }

  const planPath = getPlanPath(cwd);
  try {
    if (!fs.existsSync(planPath)) {
      return null;
    }
    const content = fs.readFileSync(planPath, 'utf-8');
    return JSON.parse(content) as ExecutionPlan;
  } catch {
    return null;
  }
}

/**
 * 写入执行计划
 */
export function writePlan(plan: ExecutionPlan, cwd: string = process.cwd()): void {
  const planPath = getPlanPath(cwd);
  plan.updatedAt = new Date().toISOString();
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * 创建空计划
 */
export function createEmptyPlan(): ExecutionPlan {
  const now = new Date().toISOString();
  return {
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取或创建计划
 */
export function getOrCreatePlan(cwd: string = process.cwd()): ExecutionPlan {
  const plan = readPlan(cwd);
  if (plan) {
    return plan;
  }
  return createEmptyPlan();
}

/**
 * 添加任务到计划
 */
export function addTaskToPlan(
  taskId: string,
  afterId?: string,
  cwd: string = process.cwd()
): boolean {
  const plan = getOrCreatePlan(cwd);

  // 检查任务是否已在计划中
  if (plan.tasks.includes(taskId)) {
    return false;
  }

  if (afterId) {
    // 添加到指定任务之后
    const index = plan.tasks.indexOf(afterId);
    if (index === -1) {
      // afterId 不存在，添加到末尾
      plan.tasks.push(taskId);
    } else {
      plan.tasks.splice(index + 1, 0, taskId);
    }
  } else {
    // 添加到末尾
    plan.tasks.push(taskId);
  }

  writePlan(plan, cwd);
  return true;
}

/**
 * 从计划移除任务
 */
export function removeTaskFromPlan(taskId: string, cwd: string = process.cwd()): boolean {
  const plan = readPlan(cwd);
  if (!plan) {
    return false;
  }

  const index = plan.tasks.indexOf(taskId);
  if (index === -1) {
    return false;
  }

  plan.tasks.splice(index, 1);
  writePlan(plan, cwd);
  return true;
}

/**
 * 清空计划
 */
export function clearPlan(cwd: string = process.cwd()): void {
  const plan = createEmptyPlan();
  writePlan(plan, cwd);
}

/**
 * 检查任务依赖是否全部完成
 */
export function areDependenciesCompleted(taskId: string, cwd: string = process.cwd()): boolean {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    return false;
  }

  for (const depId of task.dependencies) {
    const depTask = readTaskMeta(depId, cwd);
    if (!depTask) {
      return false;
    }
    // 使用规范化状态检查依赖是否完成
    const normalizedStatus = normalizeStatus(depTask.status);
    if (normalizedStatus !== 'resolved' && normalizedStatus !== 'closed') {
      return false;
    }
  }

  return true;
}

/**
 * 检查子任务的父任务是否已完成
 */
export function isParentTaskCompleted(taskId: string, cwd: string = process.cwd()): boolean {
  const task = readTaskMeta(taskId, cwd);
  if (!task || !task.parentId) {
    return false;
  }

  const parentTask = readTaskMeta(task.parentId, cwd);
  if (!parentTask) {
    return false;
  }

  const normalizedStatus = normalizeStatus(parentTask.status);
  return normalizedStatus === 'resolved' || normalizedStatus === 'closed';
}

/**
 * 获取可执行的任务（支持多种状态，按优先级排序）
 *
 * 状态优先级：
 * - reopened: 最高优先级（之前完成有问题，需要重新处理）
 * - in_progress: 进行中的任务应该继续
 * - open: 新任务
 *
 * 智能过滤：
 * - 跳过父任务已完成的子任务
 */
export function getExecutableTasks(cwd: string = process.cwd(), includeSubtasks: boolean = false): string[] {
  const tasks = getAllTasks(cwd);
  const skippedDueToParent: string[] = [];

  // 过滤可执行任务
  const executableTasks = tasks.filter(task => {
    // 过滤掉子任务（除非明确要求包含）
    if (!includeSubtasks && isSubtask(task.id)) {
      return false;
    }

    // P0修复: 跳过父任务已完成的子任务
    if (task.parentId && isParentTaskCompleted(task.id, cwd)) {
      skippedDueToParent.push(task.id);
      return false;
    }

    // 检查状态是否可执行且依赖已完成
    return isExecutableStatus(task.status) && areDependenciesCompleted(task.id, cwd);
  });

  // 按状态优先级排序（reopened > in_progress > open）
  executableTasks.sort((a, b) => {
    const priorityA = getStatusPriority(a.status);
    const priorityB = getStatusPriority(b.status);
    return priorityA - priorityB;
  });

  // 显示跳过原因（如果有）
  if (skippedDueToParent.length > 0) {
    console.log('');
    console.log('⚠️  以下子任务的父任务已完成，跳过推荐:');
    for (const taskId of skippedDueToParent) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        console.log(`   - ${taskId} (父任务 ${task.parentId} 已 resolved)`);
      }
    }
    console.log('');
  }

  return executableTasks.map(task => task.id);
}
