import * as path from 'path';
import * as fs from 'fs';
import { getTasksDir, isInitialized } from './path';
import type { TaskMeta, TaskHistoryEntry } from '../types/task';
import { createDefaultTaskMeta, isValidTaskId, generateNextTaskId, generateTaskId } from '../types/task';

/**
 * 获取任务目录路径
 */
export function getTaskDir(taskId: string, cwd: string = process.cwd()): string {
  return path.join(getTasksDir(cwd), taskId);
}

/**
 * 获取任务元数据文件路径
 */
export function getTaskMetaPath(taskId: string, cwd: string = process.cwd()): string {
  return path.join(getTaskDir(taskId, cwd), 'meta.json');
}

/**
 * 读取任务元数据
 */
export function readTaskMeta(taskId: string, cwd: string = process.cwd()): TaskMeta | null {
  if (!isInitialized(cwd)) {
    return null;
  }

  const metaPath = getTaskMetaPath(taskId, cwd);
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as TaskMeta;
  } catch {
    return null;
  }
}

/**
 * 写入任务元数据（自动记录历史)
 */
export function writeTaskMeta(task: TaskMeta, cwd: string = process.cwd()): void {
  const taskDir = getTaskDir(task.id, cwd);
  const metaPath = getTaskMetaPath(task.id, cwd);

  // 确保任务目录存在
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }

  // 读取旧的任务数据用于历史比较
  const oldTask = readTaskMeta(task.id, cwd);

  // 记录历史变更
  const historyEntries: TaskHistoryEntry[] = [];

  if (oldTask) {
    // 比较并记录字段变更
    const fields: (keyof TaskMeta)[] = ['title', 'description', 'priority', 'status', 'recommendedRole', 'branch', 'dependencies'];

    for (const field of fields) {
      const oldValue = oldTask[field as keyof TaskMeta];
      const newValue = task[field as keyof TaskMeta];

      // 跳过 updatedAt, createdAt, id, history 字段
      if (field === 'updatedAt' || field === 'createdAt' || field === 'id' || field === 'history') {
        continue;
      }

      // 对于 dependencies 字段，需要特殊处理
      if (field === 'dependencies') {
        const oldDeps = JSON.stringify(oldValue as string[] || []);
        const newDeps = JSON.stringify(newValue as string[] || []);
        if (oldDeps !== newDeps) {
          historyEntries.push({
            timestamp: new Date().toISOString(),
            action: `更新依赖列表`,
            field: 'dependencies',
            oldValue: oldDeps.length > 0 ? oldDeps.join(', ') : '无',
            newValue: newDeps.length > 0 ? newDeps.join(', ') : '无',
            user: process.env.USER || undefined,
          });
        }
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        // 其他字段的变更
        historyEntries.push({
          timestamp: new Date().toISOString(),
          action: `更新${field}`,
          field,
          oldValue: String(oldValue ?? '无'),
          newValue: String(newValue ?? '无'),
          user: process.env.USER || undefined,
        });
      }
    }
  }

  // 合并历史记录
  if (historyEntries.length > 0) {
    task.history = [...(oldTask?.history || []), ...historyEntries];
  }

  // 更新时间戳
  task.updatedAt = new Date().toISOString();

  fs.writeFileSync(metaPath, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * 获取所有任务ID
 */
export function getAllTaskIds(cwd: string = process.cwd()): string[] {
  if (!isInitialized(cwd)) {
    return [];
  }

  const tasksDir = getTasksDir(cwd);
  if (!fs.existsSync(tasksDir)) {
    return [];
  }

  return fs
    .readdirSync(tasksDir)
    .filter(name => {
      const taskDir = path.join(tasksDir, name);
      const metaPath = path.join(taskDir, 'meta.json');
      return fs.statSync(taskDir).isDirectory() && fs.existsSync(metaPath);
    });
}

/**
 * 获取所有任务
 */
export function getAllTasks(cwd: string = process.cwd(), includeArchived: boolean = false): TaskMeta[] {
  const taskIds = getAllTaskIds(cwd);
  const tasks = taskIds
    .map(id => readTaskMeta(id, cwd))
    .filter((task): task is TaskMeta => task !== null);

  // 如果包含归档任务，也读取归档目录中的任务
  if (includeArchived) {
    const archiveDir = path.join(getProjDir(cwd), 'archive');
    if (fs.existsSync(archiveDir)) {
      const archivedTaskDirs = fs.readdirSync(archiveDir)
        .filter(name => fs.statSync(path.join(archiveDir, name)).isDirectory());

      for (const taskId of archivedTaskDirs) {
        const metaPath = path.join(archiveDir, taskId, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const content = fs.readFileSync(metaPath, 'utf-8');
            const task = JSON.parse(content) as TaskMeta;
            tasks.push(task);
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  }

  return tasks;
}

/**
 * 生成新任务ID (新格式)
 * 格式: {priority}-{slug}-{status}-{group}-{date}
 */
export function generateNewTaskId(
  cwd: string = process.cwd(),
  priority: string = 'P2',
  title: string = 'task',
  status: string = 'open',
  group: string = ''
): string {
  const existingIds = getAllTaskIds(cwd);
  return generateTaskId(priority, title, status, group, existingIds);
}

/**
 * 检查任务是否存在
 */
export function taskExists(taskId: string, cwd: string = process.cwd()): boolean {
  return readTaskMeta(taskId, cwd) !== null;
}

/**
 * 生成子任务ID
 * 格式: {parentId}-{n} (如 TASK-001-1, TASK-001-2)
 */
export function generateSubtaskId(
  parentId: string,
  cwd: string = process.cwd()
): string {
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    throw new Error(`父任务 ${parentId} 不存在`);
  }

  // 获取现有子任务ID列表
  const existingSubtaskIds = parentTask.subtaskIds || [];

  // 找出最大的子任务编号
  let maxNum = 0;
  for (const subtaskId of existingSubtaskIds) {
    const match = subtaskId.match(new RegExp(`^${parentId}-(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }

  // 生成新的子任务ID
  return `${parentId}-${maxNum + 1}`;
}

/**
 * 将子任务关联到父任务
 */
export function addSubtaskToParent(
  parentId: string,
  subtaskId: string,
  cwd: string = process.cwd()
): void {
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    throw new Error(`父任务 ${parentId} 不存在`);
  }

  // 初始化 subtaskIds 数组
  if (!parentTask.subtaskIds) {
    parentTask.subtaskIds = [];
  }

  // 确保 history 数组存在
  if (!parentTask.history) {
    parentTask.history = [];
  }

  // 检查子任务是否已关联
  if (parentTask.subtaskIds.includes(subtaskId)) {
    return; // 已关联，无需重复添加
  }

  // 添加子任务ID
  parentTask.subtaskIds.push(subtaskId);
  parentTask.updatedAt = new Date().toISOString();

  // 添加历史记录
  parentTask.history.push({
    timestamp: new Date().toISOString(),
    action: `添加子任务 ${subtaskId}`,
    field: 'subtaskIds',
    newValue: subtaskId,
  });

  writeTaskMeta(parentTask, cwd);
}

/**
 * 获取所有子任务
 */
export function getSubtasks(
  parentId: string,
  cwd: string = process.cwd()
): TaskMeta[] {
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    return [];
  }

  const subtaskIds = parentTask.subtaskIds || [];
  const subtasks: TaskMeta[] = [];

  for (const subtaskId of subtaskIds) {
    const subtask = readTaskMeta(subtaskId, cwd);
    if (subtask) {
      subtasks.push(subtask);
    }
  }

  // 按创建时间排序
  subtasks.sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return subtasks;
}

/**
 * 从子任务ID解析父任务ID
 * 格式: {parentId}-{n} -> parentId
 */
export function parseParentFromSubtaskId(subtaskId: string): string | null {
  const match = subtaskId.match(/^(.+)-(\d+)$/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * 检查是否为子任务
 */
export function isSubtask(taskId: string): boolean {
  return parseParentFromSubtaskId(taskId) !== null;
}

/**
 * 获取父任务
 */
export function getParentTask(
  taskId: string,
  cwd: string = process.cwd()
): TaskMeta | null {
  const task = readTaskMeta(taskId, cwd);
  if (!task || !task.parentId) {
    return null;
  }
  return readTaskMeta(task.parentId, cwd);
}
