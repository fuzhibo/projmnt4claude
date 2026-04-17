/**
 * 自定义断言工具
 * 用于测试中提供更友好的错误信息
 */
/**
 * 断言错误类
 */
export class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}
/**
 * 断言值存在（非 null/undefined）
 */
export function assertExists(value, message = 'Expected value to exist') {
    if (value === null || value === undefined) {
        throw new AssertionError(message);
    }
}
/**
 * 断言任务有效
 */
export function assertValidTask(task, message = 'Invalid task') {
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
export function assertValidCheckpoint(checkpoint, message = 'Invalid checkpoint') {
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
export function assertMatches(value, pattern, message = `Expected string to match ${pattern.source}`) {
    if (!pattern.test(value)) {
        throw new AssertionError(`${message}: got "${value}"`);
    }
}
/**
 * 断言数组包含元素
 */
export function assertContains(array, element, message = 'Expected array to contain element') {
    if (!array.includes(element)) {
        throw new AssertionError(`${message}: ${JSON.stringify(element)} not in [${array.map(String).join(', ')}]`);
    }
}
/**
 * 断言对象有特定键
 */
export function assertHasKey(obj, key, message = `Expected object to have key "${String(key)}"`) {
    if (!(key in obj)) {
        throw new AssertionError(message);
    }
}
/**
 * 断言字符串以特定前缀开头
 */
export function assertStartsWith(value, prefix, message = `Expected string to start with "${prefix}"`) {
    if (!value.startsWith(prefix)) {
        throw new AssertionError(`${message}: got "${value}"`);
    }
}
/**
 * 断言字符串以特定后缀结尾
 */
export function assertEndsWith(value, suffix, message = `Expected string to end with "${suffix}"`) {
    if (!value.endsWith(suffix)) {
        throw new AssertionError(`${message}: got "${value}"`);
    }
}
/**
 * 断言数字在范围内
 */
export function assertInRange(value, min, max, message = `Expected number to be in range [${min}, ${max}]`) {
    if (value < min || value > max) {
        throw new AssertionError(`${message}: got ${value}`);
    }
}
/**
 * 断言日期有效
 */
export function assertValidDate(value, message = 'Expected valid date') {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(date.getTime())) {
        throw new AssertionError(`${message}: "${value}"`);
    }
}
/**
 * 断言数组长度
 */
export function assertLength(array, expected, message = `Expected array length to be ${expected}`) {
    if (array.length !== expected) {
        throw new AssertionError(`${message}: got ${array.length}`);
    }
}
/**
 * 断言任务状态转换有效
 */
export function assertValidStatusTransition(from, to, allowedTransitions) {
    const allowed = allowedTransitions[from];
    if (!allowed || !allowed.includes(to)) {
        throw new AssertionError(`Invalid status transition from "${from}" to "${to}". Allowed: [${allowed?.join(', ') ?? 'none'}]`);
    }
}
/**
 * 断言任务依赖关系有效（无循环依赖）
 */
export function assertNoCircularDependencies(tasks, message = 'Circular dependency detected') {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set();
    const stack = new Set();
    function visit(taskId, path) {
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
