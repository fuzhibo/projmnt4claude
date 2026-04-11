import * as path from 'path';
import * as fs from 'fs';
import { getProjectDir, isInitialized } from './path';
import { readTaskMeta, getAllTasks, isSubtask } from './task';
import { normalizeStatus } from '../types/task';
import type { TaskMeta } from '../types/task';

/**
 * parsePlanOutput 解析结果
 */
export interface ParsedPlanOutput {
  tasks: string[];
  batches: string[][];
  metadata: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

/**
 * 任务关系类型
 */
export type TaskRelationType = 'dependency' | 'parent_child' | 'sibling';

/**
 * 任务关系
 */
export interface TaskRelation {
  sourceId: string;
  targetId: string;
  type: TaskRelationType;
}

/**
 * parsePlanOutput: 解析计划输出文本为结构化数据
 *
 * 支持输入格式:
 * - JSON 字符串（符合 ExecutionPlan 接口）
 * - 纯文本（每行一个任务ID）
 */
export function parsePlanOutput(input: string): ParsedPlanOutput {
  const result: ParsedPlanOutput = {
    tasks: [],
    batches: [],
    metadata: {},
    valid: false,
    errors: [],
  };

  if (input === null || input === undefined) {
    result.errors.push('Input is null or undefined');
    return result;
  }

  const trimmed = String(input).trim();
  if (trimmed.length === 0) {
    result.errors.push('Input is empty');
    return result;
  }

  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      result.errors.push('Parsed result is not an object');
      return result;
    }

    // 提取 tasks
    if (Array.isArray(parsed.tasks)) {
      result.tasks = parsed.tasks.filter((t: unknown) => typeof t === 'string');
    }

    // 提取 batches
    if (Array.isArray(parsed.batches)) {
      result.batches = parsed.batches
        .filter((b: unknown) => Array.isArray(b))
        .map((b: unknown[]) => b.filter((t: unknown) => typeof t === 'string'));
    }

    // 提取 metadata（排除 tasks 和 batches）
    for (const key of Object.keys(parsed)) {
      if (key !== 'tasks' && key !== 'batches') {
        result.metadata[key] = parsed[key];
      }
    }

    result.valid = true;
    return result;
  } catch {
    // JSON 解析失败，尝试纯文本模式
  }

  // 纯文本模式：每行一个任务ID
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    result.errors.push('No task IDs found in text input');
    return result;
  }

  result.tasks = lines;
  result.valid = true;
  return result;
}

/**
 * extractTaskIdsFromPlan: 从 ExecutionPlan 中提取任务ID列表
 *
 * 优先使用 batches 展平，fallback 到 tasks 数组。
 */
export function extractTaskIdsFromPlan(plan: ExecutionPlan | null | undefined): string[] {
  if (!plan) {
    return [];
  }

  // 优先使用 batches（按顺序展平）
  if (Array.isArray(plan.batches) && plan.batches.length > 0) {
    const ids: string[] = [];
    for (const batch of plan.batches) {
      if (Array.isArray(batch)) {
        for (const id of batch) {
          if (typeof id === 'string' && id.length > 0) {
            ids.push(id);
          }
        }
      }
    }
    return ids;
  }

  // Fallback 到 tasks
  if (Array.isArray(plan.tasks)) {
    return plan.tasks.filter((t: unknown) => typeof t === 'string' && t.length > 0);
  }

  return [];
}

/**
 * calculateBatchSize: 根据总任务数和最大批次大小计算批次分组
 *
 * @param totalTasks - 总任务数
 * @param maxBatchSize - 每批次最大任务数（默认 5）
 * @returns 二维数组，每个子数组是一个批次
 */
export function calculateBatchSize(totalTasks: number, maxBatchSize: number = 5): string[][] {
  if (!Number.isFinite(totalTasks) || totalTasks <= 0) {
    return [];
  }

  const batchSize = Number.isFinite(maxBatchSize) && maxBatchSize > 0 ? maxBatchSize : 5;
  const batches: string[][] = [];
  let batchIndex = 0;

  for (let i = 0; i < totalTasks; i++) {
    if (i % batchSize === 0) {
      batches.push([]);
      batchIndex = batches.length - 1;
    }
    // 使用序号作为占位ID
    batches[batchIndex]!.push(`task-${i + 1}`);
  }

  return batches;
}

/**
 * detectTaskRelations: 检测任务之间的关系
 *
 * 识别的关系类型:
 * - dependency: A 依赖 B（B 在 A 的 dependencies 中）
 * - parent_child: A 是 B 的父任务
 * - sibling: A 和 B 有相同的父任务
 */
export function detectTaskRelations(tasks: TaskMeta[]): TaskRelation[] {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const relations: TaskRelation[] = [];
  const taskMap = new Map<string, TaskMeta>();

  for (const task of tasks) {
    if (task && task.id) {
      taskMap.set(task.id, task);
    }
  }

  for (const task of tasks) {
    if (!task || !task.id) continue;

    // 检测依赖关系
    if (Array.isArray(task.dependencies)) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          relations.push({
            sourceId: task.id,
            targetId: depId,
            type: 'dependency',
          });
        }
      }
    }

    // 检测父子关系
    if (task.parentId && taskMap.has(task.parentId)) {
      relations.push({
        sourceId: task.parentId,
        targetId: task.id,
        type: 'parent_child',
      });
    }
  }

  // 检测兄弟关系（相同父任务）
  const childrenByParent = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task || !task.id || !task.parentId) continue;
    if (!taskMap.has(task.parentId)) continue;
    const siblings = childrenByParent.get(task.parentId);
    if (siblings) {
      siblings.push(task.id);
    } else {
      childrenByParent.set(task.parentId, [task.id]);
    }
  }

  for (const [_parentId, childIds] of childrenByParent) {
    for (let i = 0; i < childIds.length; i++) {
      for (let j = i + 1; j < childIds.length; j++) {
        relations.push({
          sourceId: childIds[i]!,
          targetId: childIds[j]!,
          type: 'sibling',
        });
      }
    }
  }

  return relations;
}

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
    // Bug3 fix: 同时检查 ID 命名模式和 meta.json parentId 字段
    if (!includeSubtasks && (isSubtask(task.id) || !!task.parentId)) {
      return false;
    }

    // Bug4 fix: 排除有子任务的父任务（跟踪容器），不应被推荐执行
    if (task.subtaskIds && task.subtaskIds.length > 0) {
      return false;
    }

    // P0修复: 跳过父任务已完成的子任务
    if (task.parentId && isParentTaskCompleted(task.id, cwd)) {
      skippedDueToParent.push(task.id);
      return false;
    }

    // 检查状态是否可执行且依赖已完成
    // CP-5: isExecutableStatus 内部已调用 normalizeStatus
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

/**
 * 子任务缺失检测结果
 */
export interface MissingSubtaskWarning {
  parentTaskId: string;     // 父任务 ID
  parentTitle: string;      // 父任务标题
  missingSubtaskIds: string[];  // 已声明但不存在的子任务 ID
  expectedCount: number;    // 预期子任务数（subtaskIds 长度）
  actualCount: number;      // 实际存在的子任务数
}

/**
 * 检测所有任务中声明了但实际缺失的子任务
 *
 * 遍历所有父任务（有 subtaskIds 的任务），检查每个 subtaskId 是否能被
 * readTaskMeta 成功读取。缺失的子任务可能是被手动删除、ID 错误、或创建流程中断。
 *
 * @param cwd - 项目目录
 * @returns 缺失子任务告警列表
 */
export function detectMissingSubtasks(cwd: string = process.cwd()): MissingSubtaskWarning[] {
  const allTasks = getAllTasks(cwd);
  const warnings: MissingSubtaskWarning[] = [];

  for (const task of allTasks) {
    if (!task.subtaskIds || task.subtaskIds.length === 0) {
      continue;
    }

    const missingIds: string[] = [];
    let actualCount = 0;

    for (const subtaskId of task.subtaskIds) {
      const subtask = readTaskMeta(subtaskId, cwd);
      if (subtask) {
        actualCount++;
      } else {
        missingIds.push(subtaskId);
      }
    }

    if (missingIds.length > 0) {
      warnings.push({
        parentTaskId: task.id,
        parentTitle: task.title,
        missingSubtaskIds: missingIds,
        expectedCount: task.subtaskIds.length,
        actualCount,
      });
    }
  }

  return warnings;
}
