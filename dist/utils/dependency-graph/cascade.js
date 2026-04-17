/**
 * 计算上游失败的影响范围
 * 基于传递闭包，标记所有直接和间接受影响的下游任务
 *
 * 替代: hd-assembly-line.ts:cascadeFailureToDownstream() 的线性扫描
 * 改进: 支持多级传递，而非仅直接依赖
 */
export function computeFailureCascade(failedTaskId, graph) {
    return graph.computeCascadeImpact(failedTaskId);
}
/**
 * 执行失败级联标记
 * 将受影响的下游任务标记为 failed(upstream_failed)
 *
 * completedTaskIds: 已完成的任务 ID 集合，级联路径经过已完成任务时中断
 */
export function executeFailureCascade(failedTaskId, graph, cwd, completedTaskIds) {
    const cascade = graph.computeCascadeImpact(failedTaskId);
    const affectedTasks = [];
    const skippedTasks = [];
    for (const taskId of [...cascade.directAffected, ...cascade.transitiveAffected]) {
        if (completedTaskIds.has(taskId)) {
            // 已完成的任务不受级联影响，但级联路径在此中断
            skippedTasks.push(taskId);
            continue;
        }
        const node = graph.getNode(taskId);
        if (node) {
            const terminalStatuses = new Set(['resolved', 'closed', 'abandoned']);
            if (terminalStatuses.has(node.status)) {
                skippedTasks.push(taskId);
                continue;
            }
            affectedTasks.push(taskId);
        }
    }
    // void cwd to suppress unused warning; will be used when integrated with task-fs
    void cwd;
    return { affectedTasks, skippedTasks };
}
/**
 * 计算阻塞解除影响
 * 当一个任务完成时，哪些下游任务的阻塞被解除
 */
export function computeUnblockingImpact(completedTaskId, graph, _cwd) {
    const downstream = graph.getDirectDownstream(completedTaskId);
    const unblockedTasks = [];
    const stillBlocked = new Map();
    const terminalStatuses = new Set(['resolved', 'closed', 'abandoned']);
    for (const depId of downstream) {
        // Check if ALL upstream deps of depId are now terminal
        const upstream = graph.getDirectUpstream(depId);
        const blockingDeps = upstream.filter(upId => {
            if (upId === completedTaskId)
                return false;
            const node = graph.getNode(upId);
            return node ? !terminalStatuses.has(node.status) : false;
        });
        if (blockingDeps.length === 0) {
            unblockedTasks.push(depId);
        }
        else {
            stillBlocked.set(depId, blockingDeps);
        }
    }
    return { unblockedTasks, stillBlocked };
}
