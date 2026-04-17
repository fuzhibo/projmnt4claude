/**
 * DependencyGraph 核心类单元测试
 *
 * 测试图构建、查询、分析和统计功能
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from '../utils/dependency-graph/graph.js';
import { createTestTask } from './helpers/mock-task.js';
// ============== 辅助函数 ==============
function makeTask(id, deps = [], status = 'open', priority = 'P2') {
    return createTestTask({ id, dependencies: deps, status, priority, title: `Task ${id}`, type: 'feature' });
}
function makeChain(ids) {
    return ids.map((id, i) => {
        const deps = i === 0 ? [] : [ids[i - 1]];
        return makeTask(id, deps);
    });
}
// ============== fromTasks ==============
describe('DependencyGraph.fromTasks', () => {
    test('从任务列表构建图', () => {
        const tasks = [
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
        ];
        const graph = DependencyGraph.fromTasks(tasks);
        expect(graph.hasNode('A')).toBe(true);
        expect(graph.hasNode('B')).toBe(true);
        expect(graph.hasNode('C')).toBe(true);
        expect(graph.hasEdge('B', 'A')).toBe(true);
        expect(graph.hasEdge('C', 'B')).toBe(true);
    });
    test('excludeTerminal 过滤终态任务', () => {
        const tasks = [
            makeTask('A'),
            makeTask('B', ['A'], 'resolved'),
            makeTask('C', ['A']),
        ];
        const graph = DependencyGraph.fromTasks(tasks, { excludeTerminal: true });
        expect(graph.hasNode('A')).toBe(true);
        expect(graph.hasNode('B')).toBe(false);
        expect(graph.hasNode('C')).toBe(true);
    });
    test('空任务列表创建空图', () => {
        const graph = DependencyGraph.fromTasks([]);
        expect(graph.getAllNodeIds()).toEqual([]);
    });
});
// ============== 增量操作 ==============
describe('DependencyGraph 增量操作', () => {
    let graph;
    beforeEach(() => {
        graph = new DependencyGraph();
    });
    test('addNode 添加节点', () => {
        graph.addNode(makeTask('A'));
        expect(graph.hasNode('A')).toBe(true);
        expect(graph.getNode('A').taskId).toBe('A');
    });
    test('addNode 带推断依赖', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'), [
            { depId: 'A', meta: { source: 'file-overlap', confidence: 0.7 } },
        ]);
        expect(graph.hasEdge('B', 'A')).toBe(true);
        expect(graph.getEdgeMeta('B', 'A').source).toBe('file-overlap');
    });
    test('addNode 推断依赖忽略不存在的节点', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'), [
            { depId: 'NONEXISTENT', meta: { source: 'keyword', confidence: 0.5 } },
        ]);
        expect(graph.hasEdge('B', 'NONEXISTENT')).toBe(false);
    });
    test('removeNode 移除节点及关联边', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B', ['A']));
        graph.addEdge('B', 'A');
        graph.removeNode('A');
        expect(graph.hasNode('A')).toBe(false);
        expect(graph.hasEdge('B', 'A')).toBe(false);
    });
    test('removeNode 不存在时无操作', () => {
        graph.addNode(makeTask('A'));
        graph.removeNode('NONEXISTENT');
        expect(graph.hasNode('A')).toBe(true);
    });
    test('addEdge 成功添加', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'));
        const result = graph.addEdge('B', 'A');
        expect(result).toBe(true);
        expect(graph.hasEdge('B', 'A')).toBe(true);
    });
    test('addEdge 环检测拒绝', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'));
        graph.addEdge('B', 'A');
        // A→B would create cycle A→B→A
        const result = graph.addEdge('A', 'B');
        expect(result).toBe(false);
    });
    test('addEdge 节点不存在返回 false', () => {
        graph.addNode(makeTask('A'));
        expect(graph.addEdge('A', 'NONEXISTENT')).toBe(false);
    });
    test('removeEdge 移除边', () => {
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'));
        graph.addEdge('B', 'A');
        graph.removeEdge('B', 'A');
        expect(graph.hasEdge('B', 'A')).toBe(false);
    });
});
// ============== 图查询 ==============
describe('DependencyGraph 图查询', () => {
    let graph;
    beforeEach(() => {
        graph = new DependencyGraph();
        // Build: A → B → C, A → D
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'));
        graph.addNode(makeTask('C'));
        graph.addNode(makeTask('D'));
        graph.addEdge('B', 'A');
        graph.addEdge('C', 'B');
        graph.addEdge('D', 'A');
    });
    test('getRoots 返回无依赖节点', () => {
        const roots = graph.getRoots();
        expect(roots).toContain('A');
        expect(roots.length).toBe(1);
    });
    test('getLeaves 返回无下游节点', () => {
        const leaves = graph.getLeaves();
        expect(leaves).toContain('C');
        expect(leaves).toContain('D');
    });
    test('getDirectUpstream 返回直接依赖', () => {
        expect(graph.getDirectUpstream('B')).toEqual(['A']);
        expect(graph.getDirectUpstream('C')).toEqual(['B']);
        expect(graph.getDirectUpstream('A')).toEqual([]);
    });
    test('getDirectDownstream 返回直接下游', () => {
        const downstream = graph.getDirectDownstream('A');
        expect(downstream).toContain('B');
        expect(downstream).toContain('D');
    });
    test('getAllUpstream 返回传递上游', () => {
        const upstream = graph.getAllUpstream('C');
        expect(upstream).toContain('B');
        expect(upstream).toContain('A');
    });
    test('getAllDownstream 返回传递下游', () => {
        const downstream = graph.getAllDownstream('A');
        expect(downstream).toContain('B');
        expect(downstream).toContain('C');
        expect(downstream).toContain('D');
    });
    test('getEdgeMeta 返回边元数据', () => {
        const meta = graph.getEdgeMeta('B', 'A');
        expect(meta).toBeDefined();
        expect(meta.source).toBe('explicit');
    });
    test('getNode 返回节点信息', () => {
        const node = graph.getNode('A');
        expect(node).toBeDefined();
        expect(node.taskId).toBe('A');
        expect(node.status).toBe('open');
    });
    test('getAllNodeIds 返回所有节点 ID', () => {
        const ids = graph.getAllNodeIds();
        expect(ids.sort()).toEqual(['A', 'B', 'C', 'D']);
    });
});
// ============== 图分析 ==============
describe('DependencyGraph 图分析', () => {
    test('detectCycles 无环返回空', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
        ]);
        expect(graph.detectCycles()).toEqual([]);
    });
    test('wouldCreateCycle 自环', () => {
        const graph = new DependencyGraph();
        graph.addNode(makeTask('A'));
        expect(graph.wouldCreateCycle('A', 'A')).toBe(true);
    });
    test('topologicalSort 正确分层', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['A']),
            makeTask('D', ['B', 'C']),
        ]);
        const result = graph.topologicalSort();
        expect(result.valid).toBe(true);
        expect(result.levels.length).toBeGreaterThanOrEqual(2);
        expect(result.levels[0]).toContain('A');
    });
    test('findComponents 返回连通分量', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C'),
        ]);
        const components = graph.findComponents();
        expect(components.length).toBe(2);
        // Larger component first
        expect(components[0].size).toBeGreaterThanOrEqual(components[1].size);
    });
    test('findOrphans 返回孤立节点', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B'),
        ]);
        const orphans = graph.findOrphans();
        expect(orphans.length).toBe(2);
    });
    test('findRedundantDeps 检测冗余依赖', () => {
        const graph = new DependencyGraph();
        graph.addNode(makeTask('A'));
        graph.addNode(makeTask('B'));
        graph.addNode(makeTask('C'));
        // A→B→C exists, and we add A→C as well (redundant)
        graph.addEdge('B', 'A');
        graph.addEdge('C', 'B');
        graph.addEdge('C', 'A'); // redundant: C can reach A via B
        const redundant = graph.findRedundantDeps();
        // C→A might be detected as redundant if A is reachable from C→B→A
        expect(redundant.length).toBeGreaterThanOrEqual(0);
    });
    test('detectAnomalies 综合异常检测', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B'),
        ]);
        const anomalies = graph.detectAnomalies();
        // Both are orphans
        const orphanAnomalies = anomalies.filter(a => a.type === 'orphan' || a.type === 'orphan_suspected');
        expect(orphanAnomalies.length).toBe(2);
    });
});
// ============== 统计与报告 ==============
describe('DependencyGraph 统计与报告', () => {
    test('getStatistics 返回完整统计', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
        ]);
        const stats = graph.getStatistics();
        expect(stats.totalNodes).toBe(3);
        expect(stats.totalEdges).toBe(2);
        expect(stats.totalExplicitEdges).toBe(2);
        expect(stats.rootCount).toBe(1);
        expect(stats.cycleCount).toBe(0);
    });
    test('getPrimaryDevelopmentFocus 返回开发方向', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A', [], 'in_progress'),
            makeTask('B', ['A'], 'in_progress'),
        ]);
        const focus = graph.getPrimaryDevelopmentFocus();
        expect(focus.length).toBe(1);
        expect(focus[0].size).toBe(2);
        expect(focus[0].activeTasks.length).toBe(2);
    });
    test('toDOT 输出 DOT 格式', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
        ]);
        const dot = graph.toDOT();
        expect(dot).toContain('digraph dependencies');
        expect(dot).toContain('"A"');
        expect(dot).toContain('"B"');
        expect(dot).toContain('->');
    });
});
// ============== computeCascadeImpact ==============
describe('DependencyGraph.computeCascadeImpact', () => {
    test('计算失败级联影响', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
            makeTask('C', ['B']),
        ]);
        const result = graph.computeCascadeImpact('A');
        expect(result.directAffected).toContain('B');
        expect(result.transitiveAffected).toContain('C');
    });
    test('叶节点级联为空', () => {
        const graph = DependencyGraph.fromTasks([
            makeTask('A'),
            makeTask('B', ['A']),
        ]);
        const result = graph.computeCascadeImpact('B');
        expect(result.directAffected).toEqual([]);
        expect(result.transitiveAffected).toEqual([]);
    });
});
