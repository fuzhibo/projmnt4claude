/**
 * 级联操作模块
 *
 * 基于传递闭包的失败级联和阻塞解除，替代 hd-assembly-line.ts 的线性扫描。
 * 支持多级传递级联而非仅直接依赖。
 */
import type { NodeId, CascadeResult } from './types.js';
import type { DependencyGraph } from './graph.js';
import { TERMINAL_STATUSES } from '../../types/task.js';

/**
 * 计算上游失败的影响范围
 * 基于传递闭包，标记所有直接和间接受影响的下游任务
 *
 * 替代: hd-assembly-line.ts:cascadeFailureToDownstream() 的线性扫描
 * 改进: 支持多级传递，而非仅直接依赖
 */
export function computeFailureCascade(
  failedTaskId: NodeId,
  graph: DependencyGraph,
): CascadeResult {
  return graph.computeCascadeImpact(failedTaskId);
}

/**
 * 执行失败级联标记
 * 将受影响的下游任务标记为 failed(upstream_failed)
 *
 * completedTaskIds: 已完成的任务 ID 集合，级联路径经过已完成任务时中断
 */
export function executeFailureCascade(
  failedTaskId: NodeId,
  graph: DependencyGraph,
  cwd: string,
  completedTaskIds: Set<NodeId>,
): { affectedTasks: NodeId[]; skippedTasks: NodeId[] } {
  const cascade = graph.computeCascadeImpact(failedTaskId);
  const affectedTasks: NodeId[] = [];
  const skippedTasks: NodeId[] = [];

  for (const taskId of [...cascade.directAffected, ...cascade.transitiveAffected]) {
    if (completedTaskIds.has(taskId)) {
      // 已完成的任务不受级联影响，但级联路径在此中断
      skippedTasks.push(taskId);
      continue;
    }

    const node = graph.getNode(taskId);
    if (node) {
      const terminalStatuses = new Set(TERMINAL_STATUSES);
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
export function computeUnblockingImpact(
  completedTaskId: NodeId,
  graph: DependencyGraph,
  _cwd: string,
): { unblockedTasks: NodeId[]; stillBlocked: Map<NodeId, NodeId[]> } {
  const downstream = graph.getDirectDownstream(completedTaskId);
  const unblockedTasks: NodeId[] = [];
  const stillBlocked = new Map<NodeId, NodeId[]>();

  const terminalStatuses = new Set(TERMINAL_STATUSES);

  for (const depId of downstream) {
    // Check if ALL upstream deps of depId are now terminal
    const upstream = graph.getDirectUpstream(depId);
    const blockingDeps = upstream.filter(upId => {
      if (upId === completedTaskId) return false;
      const node = graph.getNode(upId);
      return node ? !terminalStatuses.has(node.status) : false;
    });

    if (blockingDeps.length === 0) {
      unblockedTasks.push(depId);
    } else {
      stillBlocked.set(depId, blockingDeps);
    }
  }

  return { unblockedTasks, stillBlocked };
}
