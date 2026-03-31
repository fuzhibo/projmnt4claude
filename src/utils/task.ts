import * as path from 'path';
import * as fs from 'fs';
import { getTasksDir, isInitialized } from './path';
import type { TaskMeta, TaskHistoryEntry, TaskStatus, TaskRole, TaskVerification, VerificationMethod, TaskType, TaskPriority } from '../types/task';
import { createDefaultTaskMeta, isValidTaskId, generateNextTaskId, generateTaskId, parseTaskId } from '../types/task';

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
        const oldStr = String(oldValue ?? '无');
        const newStr = String(newValue ?? '无');

        // 历史记录去重：检查最后一条同字段记录
        const lastFieldEntry = [...(oldTask?.history || [])].reverse().find(e => e.field === field);
        if (lastFieldEntry) {
          // 相同状态变更不记录
          if (lastFieldEntry.oldValue === oldStr && lastFieldEntry.newValue === newStr) {
            continue;
          }
          // 1分钟内重复变更去重
          const lastTime = new Date(lastFieldEntry.timestamp).getTime();
          if (Date.now() - lastTime < 60_000 && lastFieldEntry.newValue === newStr) {
            continue;
          }
        }

        // 其他字段的变更
        historyEntries.push({
          timestamp: new Date().toISOString(),
          action: `更新${field}`,
          field,
          oldValue: oldStr,
          newValue: newStr,
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
 * 格式: TASK-{type}-{priority}-{slug}-{date}
 * 例如: TASK-feature-P1-user-auth-20260312
 */
export function generateNewTaskId(
  cwd: string = process.cwd(),
  type: TaskType = 'feature',
  priority: TaskPriority = 'P2',
  title: string = 'task'
): string {
  const existingIds = getAllTaskIds(cwd);
  return generateTaskId(type, priority, title, existingIds);
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
 * 注意：子任务编号通常是 1-2 位数字（1-99），避免误判日期格式（如 20260316）
 */
export function parseParentFromSubtaskId(subtaskId: string): string | null {
  // 匹配 {parentId}-{1-2位数字} 格式，避免匹配日期（8位数字）
  const match = subtaskId.match(/^(.+)-(\d{1,2})$/);
  if (match) {
    const parentId = match[1];
    // 确保父 ID 不以数字结尾（避免匹配日期中的部分）
    if (!/\d$/.test(parentId)) {
      return parentId;
    }
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

// ============================================================
// 程序化更新函数 - 流水线内部使用，不依赖 AI 记忆
// ============================================================

/**
 * 检查是否应该记录历史变更（去重逻辑）
 * 1. 如果新值与当前值相同，不记录
 * 2. 如果最后一条历史记录在1分钟内有相同的变更，不记录
 */
function shouldRecordHistory(
  history: TaskHistoryEntry[],
  field: string,
  oldValue: string | undefined,
  newValue: string | undefined
): boolean {
  // 新值与旧值相同，不需要记录
  if (oldValue === newValue) {
    return false;
  }

  // 检查最后一条历史记录
  const lastEntry = history[history.length - 1];
  if (lastEntry && lastEntry.field === field) {
    // 检查是否在1分钟内有相同的变更
    const lastTime = new Date(lastEntry.timestamp).getTime();
    const now = Date.now();
    const oneMinuteMs = 60 * 1000;

    if (
      now - lastTime < oneMinuteMs &&
      lastEntry.oldValue === oldValue &&
      lastEntry.newValue === newValue
    ) {
      return false;
    }
  }

  return true;
}

/**
 * 程序化更新任务状态
 * 直接修改 meta.json，不依赖 AI 上下文
 * 当状态变为 resolved 时，自动填充 verification 字段
 */
export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  cwd: string = process.cwd(),
  reason?: string
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const oldStatus = task.status;

  // 去重：如果状态没有变化，直接返回
  if (oldStatus === status) {
    return;
  }

  task.status = status;
  task.updatedAt = new Date().toISOString();

  // 当状态变为 resolved 时，自动填充 verification 字段
  if (status === 'resolved' && !task.verification) {
    task.verification = buildTaskVerification(task);
  }

  // 添加历史记录（带去重检查）
  if (shouldRecordHistory(task.history, 'status', oldStatus, status)) {
    task.history.push({
      timestamp: new Date().toISOString(),
      action: `状态变更: ${oldStatus} → ${status}`,
      field: 'status',
      oldValue: oldStatus,
      newValue: status,
      reason,
      user: process.env.USER || undefined,
    });
  }

  writeTaskMeta(task, cwd);
}

/**
 * 构建任务验证信息
 * 基于检查点状态计算验证结果
 */
export function buildTaskVerification(task: TaskMeta): TaskVerification {
  const now = new Date().toISOString();
  const checkpoints = task.checkpoints || [];

  // 收集所有验证方法
  const methods = new Set<VerificationMethod>();
  let completedCount = 0;
  let failedCount = 0;

  for (const cp of checkpoints) {
    if (cp.verification?.method) {
      methods.add(cp.verification.method);
    }
    if (cp.status === 'completed') {
      completedCount++;
    } else if (cp.status === 'failed') {
      failedCount++;
    }
  }

  // 计算检查点完成率
  const checkpointCompletionRate = checkpoints.length > 0
    ? Math.round((completedCount / checkpoints.length) * 100)
    : 100; // 无检查点时默认 100%

  // 确定验证结果
  let result: 'passed' | 'partial' | 'failed';
  if (checkpointCompletionRate === 100 && failedCount === 0) {
    result = 'passed';
  } else if (checkpointCompletionRate >= 50 && failedCount === 0) {
    result = 'partial';
  } else {
    result = 'failed';
  }

  return {
    verifiedAt: now,
    verifiedBy: process.env.USER || 'system',
    methods: Array.from(methods),
    checkpointCompletionRate,
    result,
    note: checkpoints.length === 0
      ? '任务无检查点，自动通过验证'
      : `完成 ${completedCount}/${checkpoints.length} 个检查点`,
  };
}

/**
 * 程序化分配任务角色
 * 直接修改 meta.json，不依赖 AI 上下文
 */
export function assignRole(
  taskId: string,
  role: TaskRole,
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const oldRole = task.recommendedRole || '无';
  task.recommendedRole = role;
  task.updatedAt = new Date().toISOString();

  // 添加历史记录
  task.history.push({
    timestamp: new Date().toISOString(),
    action: `角色分配: ${oldRole} → ${role}`,
    field: 'recommendedRole',
    oldValue: oldRole,
    newValue: role,
    user: process.env.USER || undefined,
  });

  writeTaskMeta(task, cwd);
}

/**
 * 程序化递增重开次数
 * 直接修改 meta.json，不依赖 AI 上下文
 */
export function incrementReopenCount(
  taskId: string,
  reason: string,
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const oldCount = task.reopenCount || 0;
  task.reopenCount = oldCount + 1;
  task.status = 'reopened';
  task.updatedAt = new Date().toISOString();

  // 添加历史记录
  task.history.push({
    timestamp: new Date().toISOString(),
    action: `任务重开 (第 ${task.reopenCount} 次)`,
    field: 'reopenCount',
    oldValue: String(oldCount),
    newValue: String(task.reopenCount),
    reason,
    user: process.env.USER || undefined,
  });

  writeTaskMeta(task, cwd);
}

/**
 * 重命名任务：修改任务目录名和 ID
 * 同时更新所有引用该任务的其他任务
 * @returns 新的任务 ID
 */
export function renameTask(
  oldTaskId: string,
  newTaskId: string,
  cwd: string = process.cwd()
): { success: boolean; oldId: string; newId: string; error?: string } {
  // 1. 验证旧任务存在
  const task = readTaskMeta(oldTaskId, cwd);
  if (!task) {
    return { success: false, oldId: oldTaskId, newId: newTaskId, error: `任务 '${oldTaskId}' 不存在` };
  }

  // 2. 验证新 ID 不与已有任务冲突
  if (oldTaskId !== newTaskId && taskExists(newTaskId, cwd)) {
    return { success: false, oldId: oldTaskId, newId: newTaskId, error: `目标 ID '${newTaskId}' 已被占用` };
  }

  const tasksDir = getTasksDir(cwd);
  const oldDir = path.join(tasksDir, oldTaskId);
  const newDir = path.join(tasksDir, newTaskId);

  // 3. 更新 meta.json 中的 id
  task.id = newTaskId;
  task.updatedAt = new Date().toISOString();
  task.history.push({
    timestamp: new Date().toISOString(),
    action: `任务重命名: ${oldTaskId} → ${newTaskId}`,
    field: 'id',
    oldValue: oldTaskId,
    newValue: newTaskId,
    user: process.env.USER || undefined,
  });

  // 4. 如果目录名需要改变，先写入新位置再删除旧目录
  if (oldTaskId !== newTaskId) {
    // 创建新目录并写入 meta.json
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    const newMetaPath = path.join(newDir, 'meta.json');
    fs.writeFileSync(newMetaPath, JSON.stringify(task, null, 2), 'utf-8');

    // 复制其他文件（checkpoint.md, contract.json 等）
    const oldFiles = fs.readdirSync(oldDir);
    for (const file of oldFiles) {
      if (file === 'meta.json') continue; // 已写入
      const srcPath = path.join(oldDir, file);
      const dstPath = path.join(newDir, file);
      if (!fs.existsSync(dstPath)) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }

    // 删除旧目录
    try {
      fs.rmSync(oldDir, { recursive: true, force: true });
    } catch {
      // 旧目录删除失败不影响主流程
    }
  } else {
    // ID 没变，只需更新 meta.json
    writeTaskMeta(task, cwd);
  }

  // 5. 更新其他任务中的引用
  updateTaskReferences(oldTaskId, newTaskId, cwd);

  return { success: true, oldId: oldTaskId, newId: newTaskId };
}

/**
 * 更新所有任务中对 oldId 的引用为 newId
 * 涉及: dependencies, parentId, subtaskIds
 */
function updateTaskReferences(oldId: string, newId: string, cwd: string): void {
  if (oldId === newId) return;

  const allIds = getAllTaskIds(cwd);
  for (const tid of allIds) {
    if (tid === oldId || tid === newId) continue; // 跳过自身
    const task = readTaskMeta(tid, cwd);
    if (!task) continue;

    let changed = false;

    // 更新 dependencies
    if (task.dependencies) {
      const idx = task.dependencies.indexOf(oldId);
      if (idx !== -1) {
        task.dependencies[idx] = newId;
        changed = true;
      }
    }

    // 更新 parentId
    if (task.parentId === oldId) {
      task.parentId = newId;
      changed = true;
    }

    // 更新 subtaskIds
    if (task.subtaskIds) {
      const idx = task.subtaskIds.indexOf(oldId);
      if (idx !== -1) {
        task.subtaskIds[idx] = newId;
        changed = true;
      }
    }

    if (changed) {
      task.updatedAt = new Date().toISOString();
      task.history.push({
        timestamp: new Date().toISOString(),
        action: `引用更新: ${oldId} → ${newId}`,
        field: 'reference_update',
        oldValue: oldId,
        newValue: newId,
        user: process.env.USER || undefined,
      });
      writeTaskMeta(task, cwd);
    }
  }
}
