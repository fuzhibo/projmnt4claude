/**
 * 任务数据 Mock 生成器
 * 用于单元测试中生成标准任务数据
 */
/**
 * 创建测试任务元数据
 * 提供合理的默认值，可覆盖
 */
export function createTestTask(overrides) {
    const timestamp = new Date().toISOString();
    const id = overrides?.id || `TASK-test-${Date.now()}`;
    return {
        id,
        title: overrides?.title || `Test Task ${id}`,
        description: overrides?.description || 'A test task for unit testing',
        type: overrides?.type || 'feature',
        priority: overrides?.priority || 'P2',
        status: overrides?.status || 'open',
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
export function createTaskWithCheckpoints(checkpointCount = 3, overrides) {
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
export function createTaskInStatus(status, overrides) {
    return createTestTask({
        status,
        ...overrides,
    });
}
/**
 * 创建特定优先级的任务
 */
export function createTaskWithPriority(priority, overrides) {
    return createTestTask({
        priority,
        ...overrides,
    });
}
/**
 * 创建带依赖的任务
 */
export function createTaskWithDependencies(dependencyIds, overrides) {
    return createTestTask({
        dependencies: dependencyIds,
        ...overrides,
    });
}
/**
 * 任务集合生成器
 */
export function createTaskCollection(count = 5) {
    const tasks = [];
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
export function createTaskChain(length = 3) {
    const tasks = [];
    for (let i = 0; i < length; i++) {
        const dependencies = i > 0 ? [tasks[i - 1].id] : [];
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
    minimal: () => createTestTask({
        title: 'Minimal Task',
        description: '',
    }),
    feature: () => createTestTask({
        type: 'feature',
        title: 'Feature Task',
        priority: 'P2',
    }),
    bug: () => createTestTask({
        type: 'bug',
        title: 'Bug Fix Task',
        priority: 'P1',
    }),
    docs: () => createTestTask({
        type: 'docs',
        title: 'Documentation Task',
        priority: 'P3',
    }),
    inProgress: () => createTaskInStatus('in_progress'),
    completed: () => createTaskInStatus('resolved'),
};
/**
 * 批量生成任务
 */
export function createBatchTasks(options = {}) {
    const count = options.count || 10;
    const tasks = [];
    const priorities = ['P0', 'P1', 'P2', 'P3'];
    const types = ['feature', 'bug', 'docs', 'refactor', 'research'];
    const statuses = ['open', 'in_progress', 'wait_review', 'resolved'];
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
