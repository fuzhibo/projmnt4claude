/**
 * 级联操作模块单元测试
 *
 * 测试 computeFailureCascade, executeFailureCascade, computeUnblockingImpact
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from '../utils/dependency-graph/graph.js';
import {
  computeFailureCascade,
  executeFailureCascade,
  computeUnblockingImpact,
} from '../utils/dependency-graph/cascade.js';
import { createTestTask } from './helpers/mock-task.js';
import type { TaskMeta } from '../types/task.js';

function makeTask(id: string, deps: string[] = [], status: TaskMeta['status'] = 'open'): TaskMeta {
  return createTestTask({ id, dependencies: deps, status, title: `Task ${id}`, type: 'feature' });
}

// ============== computeFailureCascade ==============

describe('computeFailureCascade', () => {
  test('单级级联: 直接下游受影响', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
    ]);
    const result = computeFailureCascade('A', graph);
    expect(result.directAffected).toContain('B');
    expect(result.transitiveAffected).toEqual([]);
  });

  test('多级级联: 传递受影响', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['B']),
      makeTask('D', ['C']),
    ]);
    const result = computeFailureCascade('A', graph);
    expect(result.directAffected).toContain('B');
    expect(result.transitiveAffected).toContain('C');
    expect(result.transitiveAffected).toContain('D');
  });

  test('叶节点无级联', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
    ]);
    const result = computeFailureCascade('B', graph);
    expect(result.directAffected).toEqual([]);
    expect(result.transitiveAffected).toEqual([]);
  });

  test('级联详情包含深度信息', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['B']),
    ]);
    const result = computeFailureCascade('A', graph);
    expect(result.details.get('B')!.depth).toBe(1);
    expect(result.details.get('C')!.depth).toBe(2);
  });

  test('菱形依赖级联不重复', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['A']),
      makeTask('D', ['B', 'C']),
    ]);
    const result = computeFailureCascade('A', graph);
    expect(result.directAffected).toContain('B');
    expect(result.directAffected).toContain('C');
    expect(result.transitiveAffected).toContain('D');
    // D should appear only once
    const dCount = [...result.directAffected, ...result.transitiveAffected].filter(id => id === 'D').length;
    expect(dCount).toBe(1);
  });
});

// ============== executeFailureCascade ==============

describe('executeFailureCascade', () => {
  test('标记所有受影响任务', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['B']),
    ]);
    const result = executeFailureCascade('A', graph, '/tmp/test', new Set());
    expect(result.affectedTasks).toContain('B');
    expect(result.affectedTasks).toContain('C');
  });

  test('已完成任务被跳过', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['B'], 'resolved'),
    ]);
    const result = executeFailureCascade('A', graph, '/tmp/test', new Set(['C']));
    expect(result.affectedTasks).toContain('B');
    expect(result.skippedTasks).toContain('C');
  });

  test('终态任务被跳过', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A'], 'resolved'),
    ]);
    const result = executeFailureCascade('A', graph, '/tmp/test', new Set());
    expect(result.skippedTasks).toContain('B');
    expect(result.affectedTasks).toEqual([]);
  });

  test('叶节点失败不影响其他', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
    ]);
    const result = executeFailureCascade('B', graph, '/tmp/test', new Set());
    expect(result.affectedTasks).toEqual([]);
    expect(result.skippedTasks).toEqual([]);
  });
});

// ============== computeUnblockingImpact ==============

describe('computeUnblockingImpact', () => {
  test('完成根任务解除所有下游阻塞', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A', [], 'resolved'),
      makeTask('B', ['A']),
    ]);
    const result = computeUnblockingImpact('A', graph, '/tmp/test');
    expect(result.unblockedTasks).toContain('B');
    expect(result.stillBlocked.size).toBe(0);
  });

  test('多依赖任务仅部分解除阻塞', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A', [], 'resolved'),
      makeTask('Blocker'),
      makeTask('C', ['A', 'Blocker']),
    ]);
    const result = computeUnblockingImpact('A', graph, '/tmp/test');
    // C still blocked by Blocker
    expect(result.unblockedTasks).toEqual([]);
    expect(result.stillBlocked.has('C')).toBe(true);
    expect(result.stillBlocked.get('C')).toContain('Blocker');
  });

  test('部分依赖完成时仍被阻塞', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A', [], 'resolved'),
      makeTask('B', [], 'open'),
      makeTask('C', ['A', 'B']),
    ]);
    const resultA = computeUnblockingImpact('A', graph, '/tmp/test');
    // C still blocked by B (B is open)
    expect(resultA.stillBlocked.has('C')).toBe(true);
    expect(resultA.stillBlocked.get('C')).toContain('B');
  });

  test('所有依赖都完成时解除阻塞', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A', [], 'resolved'),
      makeTask('B', [], 'resolved'),
      makeTask('C', ['A', 'B']),
    ]);
    // Both A and B are resolved, so completing either one unblocks C
    const resultA = computeUnblockingImpact('A', graph, '/tmp/test');
    expect(resultA.unblockedTasks).toContain('C');
  });

  test('叶节点完成不影响其他', () => {
    const graph = DependencyGraph.fromTasks([
      makeTask('A'),
      makeTask('B', ['A']),
    ]);
    const result = computeUnblockingImpact('B', graph, '/tmp/test');
    expect(result.unblockedTasks).toEqual([]);
    expect(result.stillBlocked.size).toBe(0);
  });

  test('空图返回空结果', () => {
    const graph = new DependencyGraph();
    graph.addNode(makeTask('A'));
    const result = computeUnblockingImpact('A', graph, '/tmp/test');
    expect(result.unblockedTasks).toEqual([]);
    expect(result.stillBlocked.size).toBe(0);
  });
});
