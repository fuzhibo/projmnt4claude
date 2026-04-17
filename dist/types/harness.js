/**
 * Harness Design 模式相关类型定义
 *
 * 基于 Anthropic 的 Harness Design 模式：
 * - 三代理架构：Planner → Generator → Evaluator
 * - 上下文重置：开发者和评估者之间隔离上下文
 * - Sprint Contract：开发前定义"完成"标准
 */
/**
 * 默认配置
 */
export const DEFAULT_HARNESS_CONFIG = {
    maxRetries: 3,
    timeout: 300,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    apiRetryAttempts: 3,
    apiRetryDelay: 60,
    batchGitCommit: false,
    forceContinue: false,
};
/**
 * 所有有效的 VerdictAction 值
 * 用于 validate_task_data 检测旧任务中是否存在无效的 verdict action
 */
export const VALID_VERDICT_ACTIONS = [
    'resolve',
    'redevelop',
    'minor_fix',
    'retest',
    'reevaluate',
    'escalate_human',
];
/** 默认阶段重试上限 */
export const DEFAULT_PHASE_RETRY_LIMITS = {
    development: 3,
    code_review: 1,
    qa: 2,
    evaluation: 2,
};
/**
 * 创建默认 Sprint Contract
 */
export function createDefaultSprintContract(taskId) {
    const now = new Date().toISOString();
    return {
        taskId,
        acceptanceCriteria: [],
        verificationCommands: [],
        checkpoints: [],
        createdAt: now,
        updatedAt: now,
    };
}
/**
 * 创建默认开发报告
 */
export function createDefaultDevReport(taskId) {
    const now = new Date().toISOString();
    return {
        taskId,
        status: 'pending',
        changes: [],
        evidence: [],
        checkpointsCompleted: [],
        startTime: now,
        endTime: now,
        duration: 0,
    };
}
/**
 * 创建默认执行记录
 */
export function createDefaultExecutionRecord(task) {
    return {
        taskId: task.id,
        task,
        contract: createDefaultSprintContract(task.id),
        devReport: createDefaultDevReport(task.id),
        retryCount: 0,
        finalStatus: task.status,
        timeline: [],
    };
}
/**
 * 创建默认运行时状态
 */
export function createDefaultRuntimeState(config) {
    const now = new Date().toISOString();
    return {
        state: 'idle',
        config,
        taskQueue: [],
        currentIndex: 0,
        records: [],
        startTime: now,
        retryCounter: new Map(),
        updatedAt: now,
        resumeFrom: new Map(),
        reevaluateCounter: new Map(),
        phaseRetryCounters: new Map(),
        batchBoundaries: [],
        batchLabels: [],
        batchParallelizable: [],
        passedTasks: [],
        failedTasks: [],
        retryingTasks: [],
        taskPhaseCheckpoints: new Map(),
    };
}
/**
 * 创建默认状态报告
 */
export function createDefaultStatusReport(sessionId) {
    return {
        sessionId,
        state: 'idle',
        currentPhase: 'idle',
        totalTasks: 0,
        completedTasks: 0,
        progress: 0,
        message: '流水线就绪',
        timestamp: new Date().toISOString(),
        phaseHistory: [],
        passedTasks: [],
        failedTasks: [],
        retryingTasks: [],
        retryCount: 0,
        retryHistory: [],
    };
}
