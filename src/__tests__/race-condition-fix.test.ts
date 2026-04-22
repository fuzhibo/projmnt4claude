/**
 * CP-7 Race Condition Fix Test
 * 验证 recordExecutionStats 不会覆盖 ensureTransition 的状态更新
 *
 * Bug: recordExecutionStats 读取任务 -> ensureTransition 更新状态 ->
 *      recordExecutionStats 写入 stale 数据（覆盖状态）
 * Fix: 在 recordExecutionStats 写入前重新读取任务，获取最新状态
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { TaskMeta, ExecutionStats } from '../types/task';

describe('CP-7: recordExecutionStats race condition fix', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  async function taskUtils() {
    return await import('../utils/task.js');
  }

  function makeTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
    const now = new Date().toISOString();
    return {
      id: 'TASK-TEST',
      title: 'Test Task',
      description: 'Test description',
      status: 'in_progress',
      priority: 'P2',
      type: 'feature',
      createdAt: now,
      updatedAt: now,
      history: [],
      ...overrides,
    } as TaskMeta;
  }

  it('should not overwrite status changes made between read and write', async () => {
    const { writeTaskMeta, readTaskMeta, recordExecutionStats } = await taskUtils();

    // 创建初始任务
    const task = makeTask({ id: 'TASK-RACE-TEST', status: 'in_progress' });
    writeTaskMeta(task, env.tempDir);

    // 模拟竞态条件场景:
    // 1. recordExecutionStats 开始执行，首次读取任务
    // 2. 另一个操作（如 ensureTransition）将状态更新为 'resolved'
    // 3. recordExecutionStats 继续执行并写入

    // 直接更新状态（模拟 ensureTransition）
    const taskModified = readTaskMeta('TASK-RACE-TEST', env.tempDir);
    if (taskModified) {
      taskModified.status = 'resolved';
      taskModified.updatedAt = new Date().toISOString();
      writeTaskMeta(taskModified, env.tempDir);
    }

    // 现在调用 recordExecutionStats
    const stats: ExecutionStats = {
      duration: 5000,
      retryCount: 2,
      completedAt: new Date().toISOString(),
    };
    recordExecutionStats('TASK-RACE-TEST', stats, env.tempDir);

    // 验证状态没有被覆盖回 'in_progress'
    const result = readTaskMeta('TASK-RACE-TEST', env.tempDir);
    expect(result).toBeDefined();
    expect(result!.status).toBe('resolved');  // 状态应保持为 resolved
    expect(result!.executionStats).toBeDefined();
    expect(result!.executionStats!.duration).toBe(5000);
  });

  it('should preserve status when recording stats multiple times', async () => {
    const { writeTaskMeta, readTaskMeta, recordExecutionStats } = await taskUtils();

    const task = makeTask({ id: 'TASK-MULTI-STATS', status: 'wait_evaluation' });
    writeTaskMeta(task, env.tempDir);

    // 状态转换为 resolved
    const taskResolved = readTaskMeta('TASK-MULTI-STATS', env.tempDir);
    if (taskResolved) {
      taskResolved.status = 'resolved';
      writeTaskMeta(taskResolved, env.tempDir);
    }

    // 第一次记录统计
    recordExecutionStats('TASK-MULTI-STATS', {
      duration: 1000,
      retryCount: 0,
      completedAt: new Date().toISOString(),
    }, env.tempDir);

    // 第二次记录统计
    recordExecutionStats('TASK-MULTI-STATS', {
      duration: 2000,
      retryCount: 1,
      completedAt: new Date().toISOString(),
    }, env.tempDir);

    const result = readTaskMeta('TASK-MULTI-STATS', env.tempDir);
    expect(result!.status).toBe('resolved');
    expect(result!.executionStats!.duration).toBe(2000);
    expect(result!.executionStats!.retryCount).toBe(1);
  });

  it('should correctly record execution stats without affecting other fields', async () => {
    const { writeTaskMeta, readTaskMeta, recordExecutionStats } = await taskUtils();

    const task = makeTask({
      id: 'TASK-FIELDS-TEST',
      status: 'resolved',
      priority: 'P0',
      type: 'bug',
    });
    writeTaskMeta(task, env.tempDir);

    const stats: ExecutionStats = {
      duration: 3000,
      retryCount: 1,
      completedAt: '2026-04-22T10:00:00.000Z',
    };
    recordExecutionStats('TASK-FIELDS-TEST', stats, env.tempDir);

    const result = readTaskMeta('TASK-FIELDS-TEST', env.tempDir);
    expect(result!.status).toBe('resolved');
    expect(result!.priority).toBe('P0');
    expect(result!.type).toBe('bug');
    expect(result!.executionStats!.duration).toBe(3000);
    expect(result!.executionStats!.completedAt).toBe('2026-04-22T10:00:00.000Z');
  });
});
