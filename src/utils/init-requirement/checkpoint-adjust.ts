/**
 * 检查点调整接口
 *
 * 实现用户对非索引字段（commands/steps/expected）的调整能力。
 *
 * @module checkpoint-adjust
 */

import type { TaskMeta } from '../../types/task.js';

/**
 * 调整检查点的 commands/steps/expected
 *
 * 注意：调整后不同步到 checkpoint.md（这些是非索引字段）
 *
 * @param task - 任务元数据
 * @param checkpointId - 检查点 ID
 * @param updates - 更新内容
 * @returns 更新后的任务元数据
 */
export function adjustCheckpointDetails(
  task: TaskMeta,
  checkpointId: string,
  updates: {
    commands?: string[];
    steps?: string[];
    expected?: string;
  }
): TaskMeta {
  const checkpoints = task.checkpoints || [];
  const checkpoint = checkpoints.find(cp => cp.id === checkpointId);

  if (!checkpoint) {
    throw new Error(`检查点不存在: ${checkpointId}`);
  }

  // 更新 verification 字段
  if (!checkpoint.verification) {
    checkpoint.verification = {
      method: 'automated',
    };
  }

  if (updates.commands !== undefined) {
    checkpoint.verification.commands = updates.commands.length > 0 ? updates.commands : undefined;
  }

  if (updates.steps !== undefined) {
    checkpoint.verification.steps = updates.steps.length > 0 ? updates.steps : undefined;
  }

  if (updates.expected !== undefined) {
    checkpoint.verification.expected = updates.expected || undefined;
  }

  // 更新时间戳
  checkpoint.updatedAt = new Date().toISOString();

  // 返回更新后的任务（不可变更新）
  return {
    ...task,
    checkpoints: [...checkpoints],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 批量调整检查点
 *
 * @param task - 任务元数据
 * @param adjustments - 调整项数组
 * @returns 更新后的任务元数据
 */
export function adjustCheckpointDetailsBatch(
  task: TaskMeta,
  adjustments: Array<{
    checkpointId: string;
    updates: {
      commands?: string[];
      steps?: string[];
      expected?: string;
    };
  }>
): TaskMeta {
  let updatedTask = task;

  for (const { checkpointId, updates } of adjustments) {
    updatedTask = adjustCheckpointDetails(updatedTask, checkpointId, updates);
  }

  return updatedTask;
}

/**
 * 重置检查点的 commands/steps/expected 为默认值
 *
 * @param task - 任务元数据
 * @param checkpointId - 检查点 ID
 * @returns 更新后的任务元数据
 */
export function resetCheckpointDetails(
  task: TaskMeta,
  checkpointId: string
): TaskMeta {
  return adjustCheckpointDetails(task, checkpointId, {
    commands: [],
    steps: [],
    expected: '',
  });
}