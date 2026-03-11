import * as path from 'path';
import * as fs from 'fs';
import { getProjectDir, isInitialized } from './path';
import { readTaskMeta, getAllTasks, isSubtask } from './task';

/**
 * 执行计划接口
 */
export interface ExecutionPlan {
  tasks: string[];      // 任务ID列表（有序）
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
    if (!depTask || (depTask.status !== 'resolved' && depTask.status !== 'closed')) {
      return false;
    }
  }

  return true;
}

/**
 * 获取可执行的任务（状态为 open 且依赖已完成）
 */
export function getExecutableTasks(cwd: string = process.cwd(), includeSubtasks: boolean = false): string[] {
  const tasks = getAllTasks(cwd);
  return tasks
    .filter(task => {
      // 过滤掉子任务（除非明确要求包含）
      if (!includeSubtasks && isSubtask(task.id)) {
        return false;
      }
      return task.status === 'open' && areDependenciesCompleted(task.id, cwd);
    })
    .map(task => task.id);
}
