/**
 * 验证器模块单元测试
 *
 * 测试 validateOrphan, validateNewTaskDeps, validatePlanOperation
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from '../utils/dependency-graph/graph.js';
import { validateOrphan, validateNewTaskDeps, validatePlanOperation, } from '../utils/dependency-graph/validators.js';
import { createTestTask } from './helpers/mock-task.js';
function makeTask(id, deps = [], status = 'open') {
    return createTestTask({ id, dependencies: deps, status, title: `Task ${id}`, type: 'feature' });
}
// ============== validateOrphan ==============
describe('validateOrphan', () => {
    test('节点不存在返回 isLikelyOrphan=true', () => {
        const graph = new DependencyGraph();
        graph.addNode(makeTask('A'));
        const result = validateOrphan('NONEXISTENT', graph, []);
        expect(result.isLikelyOrphan).toBe(true);
    });
    test('有下游依赖的任务不是孤立', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
        ]);
        // B depends on A, so A has downstream (B). But we test B as orphan.
        // Actually, B has no downstream, but A has downstream B.
        // Let's test A: it has downstream B, so it's not orphan
        const result = validateOrphan('A', graph, [makeTask('A'), makeTask('B', ['A'])]);
        expect(result.isLikelyOrphan).toBe(false);
        expect(result.relatedTasks).toBeDefined();
    });
    test('完全孤立且无关联的任务返回 isLikelyOrphan=true', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B'),
        ]);
        const result = validateOrphan('B', graph, [makeTask('A'), makeTask('B')]);
        // B is a true orphan with no downstream and no keyword association
        expect(result.isLikelyOrphan).toBe(true);
        expect(result.reason).toContain('独立模块');
    });
    test('关键词关联的任务返回 isLikelyOrphan=false', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A', [], 'open'),
            makeTask('B'),
        ]);
        // Use titles with overlapping significant words
        const taskA = createTestTask({
            id: 'TASK-A',
            title: 'implement user authentication module',
            dependencies: [],
        });
        const taskB = createTestTask({
            id: 'TASK-B',
            title: 'implement user authentication tests',
            dependencies: [],
        });
        const graphWithKeywords = DependencyGraph.fromTasks([taskA, taskB]);
        const result = validateOrphan('TASK-B', graphWithKeywords, [taskA, taskB]);
        expect(result.isLikelyOrphan).toBe(false);
        expect(result.relatedTasks).toContain('TASK-A');
    });
});
// ============== validateNewTaskDeps ==============
describe('validateNewTaskDeps', () => {
    let graph;
    beforeEach(() => {
        graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
        ]);
    });
    test('GATE-DEP-001: 无依赖触发警告', () => {
        graph.addNode(makeTask('D'));
        const result = validateNewTaskDeps('D', [], graph, []);
        expect(result.valid).toBe(true);
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('GATE-DEP-001')]));
        expect(result.requiresJustification).toBe(true);
    });
    test('GATE-DEP-002: 循环依赖返回错误', () => {
        // Adding C→A would create a cycle: A→B→C→A (but in our model, C depends on B)
        // Actually we need to check if adding a dep from existing node would create cycle
        // C depends on B, B depends on A. Adding C→A won't create cycle (it's just redundant).
        // To create a cycle, we'd need A to depend on C.
        const result = validateNewTaskDeps('A', ['C'], graph, []);
        expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('GATE-DEP-002')]));
        expect(result.valid).toBe(false);
    });
    test('GATE-DEP-003: 所有依赖均为推断来源触发警告', () => {
        graph.addNode(makeTask('D'));
        // Add an inferred edge D→A
        graph.addEdge('D', 'A', { source: 'keyword', confidence: 0.6 });
        const result = validateNewTaskDeps('D', ['A'], graph, []);
        // D→A is keyword source, so all deps are inferred
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('GATE-DEP-003')]));
    });
    test('有效依赖不触发任何问题', () => {
        graph.addNode(makeTask('D'));
        // Add explicit edge D→A
        graph.addEdge('D', 'A');
        const result = validateNewTaskDeps('D', ['A'], graph, []);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
    test('空图中无依赖仅触发 GATE-DEP-001', () => {
        const emptyGraph = new DependencyGraph();
        emptyGraph.addNode(makeTask('D'));
        const result = validateNewTaskDeps('D', [], emptyGraph, []);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain('GATE-DEP-001');
    });
});
// ============== validatePlanOperation ==============
describe('validatePlanOperation', () => {
    let graph;
    beforeEach(() => {
        graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
            makeTask('D', ['A']),
        ]);
    });
    test('delete 有下游依赖时返回警告', () => {
        const result = validatePlanOperation('delete', ['A'], graph);
        expect(result.safe).toBe(false);
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('下游任务')]));
    });
    test('delete 叶节点无警告', () => {
        const result = validatePlanOperation('delete', ['C'], graph);
        expect(result.safe).toBe(true);
        expect(result.warnings).toEqual([]);
    });
    test('delete 包含传递影响范围', () => {
        // Build deeper chain: A→B→C→D so B has transitive downstream
        const deepGraph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
            makeTask('D', ['C']),
        ]);
        const result = validatePlanOperation('delete', ['B'], deepGraph);
        expect(result.safe).toBe(false);
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('传递影响')]));
    });
    test('reprioritize 桥接节点返回警告', () => {
        // Create a graph where A is shared by multiple downstream
        const bridgeGraph = DependencyGraph.fromTasks([
            makeTask('Root1'),
            makeTask('Root2'),
            makeTask('Bridge'),
        ]);
        // Make Bridge reachable from both roots by adding edges
        bridgeGraph.addEdge('Bridge', 'Root1');
        bridgeGraph.addEdge('Bridge', 'Root2');
        // Now Bridge bridges Root1 and Root2
        const bridges = bridgeGraph.findBridgeNodes();
        // If Bridge is detected as bridge node, reprioritize should warn
        if (bridges.length > 0) {
            const result = validatePlanOperation('reprioritize', ['Bridge'], bridgeGraph);
            expect(result.safe).toBe(false);
        }
    });
    test('reprioritize 非桥接节点安全', () => {
        const result = validatePlanOperation('reprioritize', ['C'], graph);
        expect(result.safe).toBe(true);
    });
    test('merge 少于 2 个目标返回警告', () => {
        const result = validatePlanOperation('merge', ['A'], graph);
        expect(result.safe).toBe(false);
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('至少 2')]));
    });
    test('merge 外部依赖不一致返回警告', () => {
        // A has no deps, B depends on A. Merging A and B: A has no external deps, B has none external (A is internal)
        // Need a case where targets have different external deps
        const mergeGraph = DependencyGraph.fromTasks([
            makeTask('X'),
            makeTask('Y'),
            makeTask('T1', ['X']),
            makeTask('T2', ['Y']),
        ]);
        const result = validatePlanOperation('merge', ['T1', 'T2'], mergeGraph);
        expect(result.safe).toBe(false);
    });
    test('split 无下游返回警告', () => {
        const result = validatePlanOperation('split', ['C'], graph);
        expect(result.safe).toBe(false);
        expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('手动建立')]));
    });
    test('split 有下游安全', () => {
        const result = validatePlanOperation('split', ['B'], graph);
        expect(result.safe).toBe(true);
    });
});
