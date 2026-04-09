/**
 * 任务数据 Mock 生成器
 * 用于单元测试中生成标准任务数据
 */

import type { TaskMeta, TaskPriority, TaskStatus, TaskType } from '../../types/task';

/**
 * 创建测试任务元数据
 * 提供合理的默认值，可覆盖
 */
export function createTestTask(overrides?: Partial<TaskMeta>): TaskMeta {
  const timestamp = new Date().toISOString();
  const id = overrides?.id || `TASK-test-${Date.now()}`;

  return {
    id,
    title: overrides?.title || `Test Task ${id}`,
    description: overrides?.description || 'A test task for unit testing',
    type: overrides?.type || ('feature' as TaskType),
    priority: overrides?.priority || ('P2' as TaskPriority),
    status: overrides?.status || ('open' as TaskStatus),
    dependencies: overrides?.dependencies || [],
    createdAt: overrides?.createdAt || timestamp,
    updatedAt: overrides?.updatedAt || timestamp,
    history: overrides?.history || [{
      timestamp,
      action: '任务创建',
      field: 'status',
      newValue: 'open',
    }],
    checkpoints: overrides?.checkpoints || [],
    ...overrides,
  };
}

/**
 * 创建带检查点的测试任务
 */
export function createTaskWithCheckpoints(
  checkpointCount: number = 3,
  overrides?: Partial<TaskMeta>
): TaskMeta {
  const task = createTestTask(overrides);
  const checkpoints = [];

  for (let i = 1; i <= checkpointCount; i++) {
    checkpoints.push({
      id: `CP-${String(i).padStart(3, '0')}`,
      description: `Test checkpoint ${i}`,
      status: i === 1 ? 'completed' : 'pending',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  }

  return {
    ...task,
    checkpoints,
  };
}

/**
 * 创建处于特定状态的任务
 */
export function createTaskInStatus(status: TaskStatus, overrides?: Partial<TaskMeta>): TaskMeta {
  return createTestTask({
    status,
    ...overrides,
  });
}

/**
 * 创建特定优先级的任务
 */
export function createTaskWithPriority(
  priority: TaskPriority,
  overrides?: Partial<TaskMeta>
): TaskMeta {
  return createTestTask({
    priority,
    ...overrides,
  });
}

/**
 * 创建带依赖的任务
 */
export function createTaskWithDependencies(
  dependencyIds: string[],
  overrides?: Partial<TaskMeta>
): TaskMeta {
  return createTestTask({
    dependencies: dependencyIds,
    ...overrides,
  });
}

/**
 * 任务集合生成器
 */
export function createTaskCollection(count: number = 5): TaskMeta[] {
  const tasks: TaskMeta[] = [];

  for (let i = 0; i < count; i++) {
    tasks.push(createTestTask({
      id: `TASK-${String(i + 1).padStart(3, '0')}`,
      title: `Test Task ${i + 1}`,
    }));
  }

  return tasks;
}

/**
 * 创建任务链（依赖链）
 */
export function createTaskChain(length: number = 3): TaskMeta[] {
  const tasks: TaskMeta[] = [];

  for (let i = 0; i < length; i++) {
    const dependencies = i > 0 ? [tasks[i - 1]!.id] : [];
    tasks.push(createTestTask({
      id: `TASK-chain-${String(i + 1).padStart(3, '0')}`,
      title: `Chain Task ${i + 1}`,
      dependencies,
    }));
  }

  return tasks;
}

/**
 * Mock 任务模板
 */
export const MOCK_TASK_TEMPLATES = {
  minimal: (): TaskMeta => createTestTask({
    title: 'Minimal Task',
    description: '',
  }),

  feature: (): TaskMeta => createTestTask({
    type: 'feature' as TaskType,
    title: 'Feature Task',
    priority: 'P2' as TaskPriority,
  }),

  bug: (): TaskMeta => createTestTask({
    type: 'bug' as TaskType,
    title: 'Bug Fix Task',
    priority: 'P1' as TaskPriority,
  }),

  docs: (): TaskMeta => createTestTask({
    type: 'docs' as TaskType,
    title: 'Documentation Task',
    priority: 'P3' as TaskPriority,
  }),

  inProgress: (): TaskMeta => createTaskInStatus('in_progress' as TaskStatus),
  completed: (): TaskMeta => createTaskInStatus('resolved' as TaskStatus),
} as const;

/**
 * 批量任务生成选项
 */
export interface BatchTaskOptions {
  count?: number;
  statusDistribution?: Record<TaskStatus, number>;
  priorityDistribution?: Record<TaskPriority, number>;
  typeDistribution?: Record<TaskType, number>;
}

/**
 * 批量生成任务
 */
export function createBatchTasks(options: BatchTaskOptions = {}): TaskMeta[] {
  const count = options.count || 10;
  const tasks: TaskMeta[] = [];

  const priorities: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
  const types: TaskType[] = ['feature', 'bug', 'docs', 'refactor', 'research'];
  const statuses: TaskStatus[] = ['open', 'in_progress', 'wait_review', 'resolved'];

  for (let i = 0; i < count; i++) {
    tasks.push(createTestTask({
      id: `TASK-batch-${String(i + 1).padStart(3, '0')}`,
      title: `Batch Task ${i + 1}`,
      priority: priorities[i % priorities.length],
      type: types[i % types.length],
      status: statuses[i % statuses.length],
    }));
  }

  return tasks;
}
