/**
 * 任务级 Hook 执行模块
 *
 * 提供统一的 Hook 执行逻辑，支持：
 * - CLI 命令拦截
 * - Claude Code hooks 协作
 * - 验证逻辑调用
 */

import * as path from 'path';
import * as fs from 'fs';
import { getProjectDir } from './path';
import { readTaskMeta, writeTaskMeta, getAllTasks } from './task';
import { validateTaskCompletion, getWaitCompleteTasks, generateValidationReport } from './validation';
import type {
  TaskMeta,
  TaskStatus,
  TaskHookType,
  TaskHookConfig,
  HookExecutionContext,
  HookResult,
  TaskHistoryEntry,
} from '../types/task';

/**
 * 获取任务级 Hook 配置路径
 */
export function getTaskHookConfigPath(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'hooks', 'task-hooks.json');
}

/**
 * 读取任务级 Hook 配置
 */
export function readTaskHookConfig(cwd: string = process.cwd()): TaskHookConfig | null {
  const configPath = getTaskHookConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as TaskHookConfig;
  } catch {
    return null;
  }
}

/**
 * 写入任务级 Hook 配置
 */
export function writeTaskHookConfig(config: TaskHookConfig, cwd: string = process.cwd()): void {
  const hooksDir = path.join(getProjectDir(cwd), 'hooks');
  const configPath = getTaskHookConfigPath(cwd);

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 创建默认任务级 Hook 配置
 */
export function createDefaultTaskHookConfig(): TaskHookConfig {
  return {
    enabled: true,
    hooks: {
      preTaskUpdate: true,
      preTaskComplete: true,
      postTaskUpdate: false,
      postTaskComplete: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 检查 Hook 是否启用
 */
export function isHookEnabled(hookType: TaskHookType, cwd: string = process.cwd()): boolean {
  const config = readTaskHookConfig(cwd);
  if (!config || !config.enabled) {
    return false;
  }
  return config.hooks[hookType as keyof typeof config.hooks] === true;
}

/**
 * 执行任务级 Hook
 */
export async function executeTaskHook(
  context: HookExecutionContext
): Promise<HookResult> {
  const { hookType, taskId, taskData, cwd } = context;

  // 检查 Hook 是否启用
  if (!isHookEnabled(hookType, cwd)) {
    return { success: true, shouldBlock: false };
  }

  // 根据Hook类型执行不同逻辑
  switch (hookType) {
    case 'preTaskUpdate':
      return await executePreTaskUpdate(context);

    case 'preTaskComplete':
      return await executePreTaskComplete(context);

    case 'postTaskUpdate':
      return { success: true, shouldBlock: false };

    case 'postTaskComplete':
      return await executePostTaskComplete(context);

    default:
      return { success: true, shouldBlock: false };
  }
}

/**
 * preTaskUpdate Hook: 任务更新前的验证
 */
async function executePreTaskUpdate(context: HookExecutionContext): Promise<HookResult> {
  const { taskId, oldStatus, newStatus, cwd } = context;

  // 如果状态变更为 resolved 或 closed，触发完成验证
  if (newStatus === 'resolved' || newStatus === 'closed') {
    return await executePreTaskComplete(context);
  }

  return { success: true, shouldBlock: false };
}

/**
 * preTaskComplete Hook: 任务完成前的验证
 */
async function executePreTaskComplete(context: HookExecutionContext): Promise<HookResult> {
  const { taskId, cwd } = context;

  // 执行验证
  const validationResult = await validateTaskCompletion(taskId, cwd);

  if (!validationResult.valid) {
    const errorMessages = validationResult.errors.map(e => e.message);
    return {
      success: false,
      message: '任务验证失败',
      details: errorMessages,
      shouldBlock: true,
    };
  }

  return {
    success: true,
    message: '任务验证通过',
    details: validationResult.evidenceCollected,
    shouldBlock: false,
  };
}

/**
 * postTaskComplete Hook: 任务完成后的处理
 */
async function executePostTaskComplete(context: HookExecutionContext): Promise<HookResult> {
  const { taskId, cwd } = context;

  // 生成验证报告
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    return { success: false, message: '任务不存在' };
  }

  // 可以在这里添加后续处理逻辑，如发送通知等
  return { success: true, shouldBlock: false };
}

/**
 * 带Hook验证的任务状态更新
 *
 * 这是CLI命令应该调用的包装函数，确保验证逻辑被执行
 */
export async function updateTaskStatusWithHooks(
  taskId: string,
  newStatus: TaskStatus,
  options: {
    cwd?: string;
    skipValidation?: boolean;
    validationBypassToken?: string;
    reason?: string;
  } = {}
): Promise<{ success: boolean; error?: string; validationReport?: string }> {
  const cwd = options.cwd || process.cwd();
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    return { success: false, error: `任务 ${taskId} 不存在` };
  }

  const oldStatus = task.status;

  // 如果是完成操作（状态变为 resolved 或 closed）且未跳过验证
  const isCompleting = newStatus === 'resolved' || newStatus === 'closed';

  if (isCompleting && !options.skipValidation) {
    // 检查是否有验证绕过令牌
    if (options.validationBypassToken) {
      if (task.checkpointConfirmationToken !== options.validationBypassToken) {
        return { success: false, error: '无效的验证绕过令牌' };
      }
    } else {
      // 执行Hook验证
      const hookContext: HookExecutionContext = {
        hookType: 'preTaskComplete',
        taskId,
        oldStatus,
        newStatus,
        taskData: task,
        cwd,
      };

      const hookResult = await executeTaskHook(hookContext);

      if (!hookResult.success && hookResult.shouldBlock) {
        const errorMsg = hookResult.details?.join('\n') || hookResult.message || '验证失败';
        return { success: false, error: errorMsg };
      }
    }
  }

  // 更新状态
  task.status = newStatus;

  // 记录历史
  const historyEntry: TaskHistoryEntry = {
    timestamp: new Date().toISOString(),
    action: `状态变更: ${oldStatus} -> ${newStatus}`,
    field: 'status',
    oldValue: oldStatus,
    newValue: newStatus,
    user: process.env.USER || undefined,
  };

  if (options.reason) {
    historyEntry.reason = options.reason;
  }

  if (!task.history) {
    task.history = [];
  }
  task.history.push(historyEntry);

  // 如果是重开，增加 reopenCount
  if (newStatus === 'reopened') {
    task.reopenCount = (task.reopenCount || 0) + 1;
  }

  // 写入任务元数据
  writeTaskMeta(task, cwd);

  return { success: true };
}

/**
 * 兜底验证机制：扫描所有 wait_complete 任务并执行验证
 *
 * 在 Claude Code hooks 触发时调用此函数，确保没有任务遗漏验证
 */
export async function processWaitCompleteTasks(
  cwd: string = process.cwd()
): Promise<{
  processed: number;
  passed: string[];
  failed: Array<{ taskId: string; errors: string[] }>;
}> {
  const pendingTasks = getWaitCompleteTasks(cwd);
  const result = {
    processed: 0,
    passed: [] as string[],
    failed: [] as Array<{ taskId: string; errors: string[] }>,
  };

  for (const task of pendingTasks) {
    const validation = await validateTaskCompletion(task.id, cwd);
    result.processed++;

    if (validation.valid) {
      // 验证通过，更新为 resolved
      await updateTaskStatusWithHooks(task.id, 'resolved', {
        cwd,
        skipValidation: true, // 已经验证过了
        reason: '兜底验证通过，自动更新为 resolved',
      });
      result.passed.push(task.id);
    } else {
      // 验证失败，返回 in_progress
      await updateTaskStatusWithHooks(task.id, 'in_progress', {
        cwd,
        skipValidation: true,
        reason: `验证失败: ${validation.errors.map(e => e.message).join(', ')}`,
      });
      result.failed.push({
        taskId: task.id,
        errors: validation.errors.map(e => e.message),
      });
    }
  }

  return result;
}

/**
 * 生成验证报告并输出到 stderr（供 Claude Code hooks 使用）
 */
export async function reportWaitCompleteValidation(
  cwd: string = process.cwd()
): Promise<void> {
  const result = await processWaitCompleteTasks(cwd);

  if (result.processed === 0) {
    return; // 没有待验证任务
  }

  const lines: string[] = [];
  lines.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 wait_complete 任务验证结果');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (result.passed.length > 0) {
    lines.push(`✅ ${result.passed.length} 个任务验证通过:`);
    result.passed.forEach(id => lines.push(`   - ${id}`));
    lines.push('');
  }

  if (result.failed.length > 0) {
    lines.push(`❌ ${result.failed.length} 个任务验证失败:`);
    result.failed.forEach(f => {
      lines.push(`   - ${f.taskId}:`);
      f.errors.forEach(e => lines.push(`     ${e}`));
    });
    lines.push('');
  }

  // 输出到 stderr，让 Claude Code 可以看到
  process.stderr.write(lines.join('\n'));
}
