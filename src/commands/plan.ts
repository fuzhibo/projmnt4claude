import prompts from 'prompts';
import * as fs from 'fs';
import {
  readPlan,
  getOrCreatePlan,
  writePlan,
  addTaskToPlan,
  removeTaskFromPlan,
  clearPlan,
  areDependenciesCompleted,
  getExecutableTasks,
} from '../utils/plan';
import { isInitialized, getProjectDir } from '../utils/path';
import { readTaskMeta, getAllTasks, taskExists, getSubtasks } from '../utils/task';
import type { TaskPriority } from '../types/task';

/**
 * 显示执行计划
 */
export function showPlan(json: boolean = false, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const plan = readPlan(cwd);

  if (!plan || plan.tasks.length === 0) {
    console.log('暂无执行计划');
    console.log('');
    console.log('使用 `projmnt4claude plan recommend` 生成推荐计划');
    return;
  }

  if (json) {
    // JSON 格式输出
    const tasks = plan.tasks.map((taskId, index) => {
      const task = readTaskMeta(taskId, cwd);
      return {
        order: index + 1,
        id: taskId,
        title: task?.title || '(未知任务)',
        status: task?.status || 'unknown',
      };
    });

    console.log(JSON.stringify({ ...plan, taskDetails: tasks }, null, 2));
    return;
  }

  // 表格格式输出
  console.log('');
  console.log('执行计划:');
  console.log('='.repeat(60));
  console.log('序号 | 任务ID    | 标题                         | 状态');
  console.log('-----|-----------|------------------------------|------------');

  for (let i = 0; i < plan.tasks.length; i++) {
    const taskId = plan.tasks[i]!;
    const task = readTaskMeta(taskId, cwd);

    const order = String(i + 1).padEnd(4);
    const id = taskId.padEnd(9);
    const title = (task?.title || '(未知任务)').substring(0, 28).padEnd(28);
    const status = task ? formatStatus(task.status) : '❓ 未知';

    console.log(`${order} | ${id} | ${title} | ${status}`);
  }

  console.log('');
  console.log(`共 ${plan.tasks.length} 个任务`);
  console.log(`创建时间: ${plan.createdAt}`);
  console.log(`更新时间: ${plan.updatedAt}`);
}

/**
 * 添加任务到计划
 */
export function addTask(taskId: string, afterId?: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 检查任务是否存在
  if (!taskExists(taskId, cwd)) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  if (afterId && !taskExists(afterId, cwd)) {
    console.error(`错误: 参考任务 '${afterId}' 不存在`);
    process.exit(1);
  }

  const success = addTaskToPlan(taskId, afterId, cwd);

  if (success) {
    console.log(`✅ 已添加任务 ${taskId} 到执行计划${afterId ? ` (在 ${afterId} 之后)` : ''}`);
  } else {
    console.log(`任务 ${taskId} 已在执行计划中`);
  }
}

/**
 * 从计划移除任务
 */
export function removeTask(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const success = removeTaskFromPlan(taskId, cwd);

  if (success) {
    console.log(`✅ 已从执行计划移除任务 ${taskId}`);
  } else {
    console.log(`任务 ${taskId} 不在执行计划中`);
  }
}

/**
 * 清空计划
 */
export async function clearPlanCmd(force: boolean = false, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!force) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '确定要清空执行计划吗？',
      initial: false,
    });

    if (!response.confirm) {
      console.log('已取消');
      return;
    }
  }

  clearPlan(cwd);
  console.log('✅ 执行计划已清空');
}

/**
 * 推荐执行计划
 */
export async function recommendPlan(cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  console.log('正在分析项目任务...\n');

  // 获取可执行的任务
  const executableTasks = getExecutableTasks(cwd);

  if (executableTasks.length === 0) {
    console.log('暂无可执行的任务');
    console.log('');
    console.log('可能的原因:');
    console.log('  - 所有任务已完成');
    console.log('  - 任务存在未完成的依赖');
    return;
  }

  // 获取任务详情并按优先级排序
  const tasksWithMeta = executableTasks
    .map(id => readTaskMeta(id, cwd))
    .filter(t => t !== null)
    .sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = {
        P0: 0,
        P1: 1,
        P2: 2,
        P3: 3,
        Q1: 4,
        Q2: 5,
        Q3: 6,
        Q4: 7,
      };
      return priorityOrder[a!.priority] - priorityOrder[b!.priority];
    });

  // 显示推荐列表
  console.log('推荐执行计划:');
  console.log('='.repeat(60));
  console.log('序号 | 任务ID    | 标题                         | 优先级');
  console.log('-----|-----------|------------------------------|--------');

  for (let i = 0; i < tasksWithMeta.length; i++) {
    const task = tasksWithMeta[i]!;
    const order = String(i + 1).padEnd(4);
    const id = task.id.padEnd(9);
    const title = task.title.substring(0, 28).padEnd(28);
    const priority = formatPriority(task.priority);

    console.log(`${order} | ${id} | ${title} | ${priority}`);

    // 显示子任务进度
    if (task.subtaskIds && task.subtaskIds.length > 0) {
      const subtasks = getSubtasks(task.id, cwd);
      const completed = subtasks.filter(s => s.status === 'resolved' || s.status === 'closed').length;
      console.log(`     └─ 子任务: ${completed}/${subtasks.length} 完成`);
    }
  }

  console.log('');

  // 询问用户确认
  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: '是否将此推荐写入执行计划？',
    initial: true,
  });

  if (response.confirm) {
    const plan = getOrCreatePlan(cwd);
    plan.tasks = tasksWithMeta.map(t => t!.id);
    writePlan(plan, cwd);
    console.log('✅ 执行计划已更新');
  } else {
    console.log('已取消');
  }
}

/**
 * 格式化优先级
 */
function formatPriority(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    P0: '🔴 P0紧急',
    P1: '🟠 P1高',
    P2: '🟡 P2中',
    P3: '🟢 P3低',
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
  };
  return map[priority];
}

/**
 * 格式化状态
 */
function formatStatus(status: string): string {
  const map: Record<string, string> = {
    open: '⬜ 待处理',
    in_progress: '🔵 进行中',
    resolved: '✅ 已解决',
    closed: '⚫ 已关闭',
    reopened: '🔄 已重开',
    abandoned: '❌ 已放弃',
  };
  return map[status] || status;
}
