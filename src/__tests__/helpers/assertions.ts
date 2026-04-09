/**
 * 自定义断言工具
 * 用于测试中提供更友好的错误信息
 */

import type { TaskMeta, CheckpointMetadata } from '../../types/task';

/**
 * 断言错误类
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * 断言值存在（非 null/undefined）
 */
export function assertExists<T>(
  value: T | null | undefined,
  message = 'Expected value to exist'
): asserts value is T {
  if (value === null || value === undefined) {
    throw new AssertionError(message);
  }
}

/**
 * 断言任务有效
 */
export function assertValidTask(
  task: TaskMeta,
  message = 'Invalid task'
): void {
  if (!task.id) {
    throw new AssertionError(`${message}: missing id`);
  }
  if (!task.title) {
    throw new AssertionError(`${message}: missing title`);
  }
  if (!task.status) {
    throw new AssertionError(`${message}: missing status`);
  }
}

/**
 * 断言检查点有效
 */
export function assertValidCheckpoint(
  checkpoint: CheckpointMetadata,
  message = 'Invalid checkpoint'
): void {
  if (!checkpoint.id) {
    throw new AssertionError(`${message}: missing id`);
  }
  if (!checkpoint.description) {
    throw new AssertionError(`${message}: missing description`);
  }
  if (!checkpoint.status) {
    throw new AssertionError(`${message}: missing status`);
  }
}

/**
 * 断言字符串匹配正则
 */
export function assertMatches(
  value: string,
  pattern: RegExp,
  message = `Expected string to match ${pattern.source}`
): void {
  if (!pattern.test(value)) {
    throw new AssertionError(`${message}: got "${value}"`);
  }
}

/**
 * 断言数组包含元素
 */
export function assertContains<T>(
  array: T[],
  element: T,
  message = 'Expected array to contain element'
): void {
  if (!array.includes(element)) {
    throw new AssertionError(`${message}: ${JSON.stringify(element)} not in [${array.map(String).join(', ')}]`);
  }
}

/**
 * 断言对象有特定键
 */
export function assertHasKey<K extends string>(
  obj: object,
  key: K,
  message = `Expected object to have key "${String(key)}"`
): asserts obj is Record<K, unknown> {
  if (!(key in obj)) {
    throw new AssertionError(message);
  }
}

/**
 * 断言字符串以特定前缀开头
 */
export function assertStartsWith(
  value: string,
  prefix: string,
  message = `Expected string to start with "${prefix}"`
): void {
  if (!value.startsWith(prefix)) {
    throw new AssertionError(`${message}: got "${value}"`);
  }
}

/**
 * 断言字符串以特定后缀结尾
 */
export function assertEndsWith(
  value: string,
  suffix: string,
  message = `Expected string to end with "${suffix}"`
): void {
  if (!value.endsWith(suffix)) {
    throw new AssertionError(`${message}: got "${value}"`);
  }
}

/**
 * 断言数字在范围内
 */
export function assertInRange(
  value: number,
  min: number,
  max: number,
  message = `Expected number to be in range [${min}, ${max}]`
): void {
  if (value < min || value > max) {
    throw new AssertionError(`${message}: got ${value}`);
  }
}

/**
 * 断言日期有效
 */
export function assertValidDate(
  value: string | Date,
  message = 'Expected valid date'
): void {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) {
    throw new AssertionError(`${message}: "${value}"`);
  }
}

/**
 * 断言数组长度
 */
export function assertLength<T>(
  array: T[],
  expected: number,
  message = `Expected array length to be ${expected}`
): void {
  if (array.length !== expected) {
    throw new AssertionError(`${message}: got ${array.length}`);
  }
}

/**
 * 断言任务状态转换有效
 */
export function assertValidStatusTransition(
  from: string,
  to: string,
  allowedTransitions: Record<string, string[]>
): void {
  const allowed = allowedTransitions[from];
  if (!allowed || !allowed.includes(to)) {
    throw new AssertionError(
      `Invalid status transition from "${from}" to "${to}". Allowed: [${allowed?.join(', ') ?? 'none'}]`
    );
  }
}

/**
 * 断言任务依赖关系有效（无循环依赖）
 */
export function assertNoCircularDependencies(
  tasks: TaskMeta[],
  message = 'Circular dependency detected'
): void {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(taskId: string, path: string[]): void {
    if (stack.has(taskId)) {
      const cycle = [...path, taskId].join(' -> ');
      throw new AssertionError(`${message}: ${cycle}`);
    }

    if (visited.has(taskId)) {
      return;
    }

    visited.add(taskId);
    stack.add(taskId);

    const task = taskMap.get(taskId);
    if (task?.dependencies) {
      for (const depId of task.dependencies) {
        visit(depId, [...path, taskId]);
      }
    }

    stack.delete(taskId);
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      visit(task.id, []);
    }
  }
}

/**
 * 断言工具集合
 */
export const Assertions = {
  exists: assertExists,
  validTask: assertValidTask,
  validCheckpoint: assertValidCheckpoint,
  matches: assertMatches,
  contains: assertContains,
  hasKey: assertHasKey,
  startsWith: assertStartsWith,
  endsWith: assertEndsWith,
  inRange: assertInRange,
  validDate: assertValidDate,
  length: assertLength,
  validStatusTransition: assertValidStatusTransition,
  noCircularDependencies: assertNoCircularDependencies,
};
