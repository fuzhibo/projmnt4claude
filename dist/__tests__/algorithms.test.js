/**
 * 图算法模块单元测试
 *
 * 测试 detectCyclesDFS, wouldCreateCycleBFS, findComponentsUnionFind,
 * topologicalSortDFS, computeTransitiveClosure, breakCycle,
 * detectBridgeNodes, computeDepths
 */
import { describe, test, expect } from 'bun:test';
import { detectCyclesDFS, wouldCreateCycleBFS, findComponentsUnionFind, topologicalSortDFS, computeTransitiveClosure, breakCycle, detectBridgeNodes, computeDepths, } from '../utils/dependency-graph/algorithms.js';
// ============== 辅助函数 ==============
/** 构建简单邻接表 */
function buildAdjacency(edges) {
    const adj = new Map();
    for (const [from, to] of edges) {
        if (!adj.has(from))
            adj.set(from, new Set());
        adj.get(from).add(to);
        if (!adj.has(to))
            adj.set(to, new Set());
    }
    return adj;
}
/** 构建带元数据的邻接表 */
function buildWeightedAdjacency(edges) {
    const adj = new Map();
    for (const e of edges) {
        if (!adj.has(e.from))
            adj.set(e.from, new Map());
        adj.get(e.from).set(e.to, {
            source: e.meta?.source ?? 'explicit',
            confidence: e.meta?.confidence ?? 1.0,
            ...e.meta,
        });
    }
    return adj;
}
/** 构建节点映射 */
function buildNodes(ids) {
    const nodes = new Map();
    for (const id of ids) {
        nodes.set(id, {
            taskId: id,
            status: 'open',
            priority: 'P2',
            title: `Task ${id}`,
            type: 'feature',
        });
    }
    return nodes;
}
/** 构建反向邻接表 */
function buildReverseAdj(edges) {
    const rev = new Map();
    for (const [from, to] of edges) {
        if (!rev.has(to))
            rev.set(to, new Set());
        rev.get(to).add(from);
        if (!rev.has(from))
            rev.set(from, new Set());
    }
    return rev;
}
// ============== detectCyclesDFS ==============
describe('detectCyclesDFS', () => {
    test('无环 DAG 返回空数组', () => {
        const adj = buildAdjacency([['A', 'B'], ['B', 'C']]);
        const cycles = detectCyclesDFS(adj);
        expect(cycles).toEqual([]);
    });
    test('检测简单环 A→B→A', () => {
        const adj = buildAdjacency([['A', 'B'], ['B', 'A']]);
        const cycles = detectCyclesDFS(adj);
        expect(cycles.length).toBeGreaterThan(0);
        // 环路径应包含 A 和 B
        const cycle = cycles[0];
        expect(cycle).toContain('A');
        expect(cycle).toContain('B');
    });
    test('检测三节点环 A→B→C→A', () => {
        const adj = buildAdjacency([['A', 'B'], ['B', 'C'], ['C', 'A']]);
        const cycles = detectCyclesDFS(adj);
        expect(cycles.length).toBeGreaterThan(0);
        const cycle = cycles[0];
        expect(cycle).toContain('A');
        expect(cycle).toContain('B');
        expect(cycle).toContain('C');
    });
    test('空图返回空数组', () => {
        const adj = new Map();
        const cycles = detectCyclesDFS(adj);
        expect(cycles).toEqual([]);
    });
    test('无边的孤立节点返回空数组', () => {
        const adj = new Map();
        adj.set('A', new Set());
        adj.set('B', new Set());
        const cycles = detectCyclesDFS(adj);
        expect(cycles).toEqual([]);
    });
    test('复杂图中检测多个独立环', () => {
        // 两个独立环: A→B→A 和 C→D→C
        const adj = buildAdjacency([
            ['A', 'B'], ['B', 'A'],
            ['C', 'D'], ['D', 'C'],
        ]);
        const cycles = detectCyclesDFS(adj);
        expect(cycles.length).toBeGreaterThanOrEqual(2);
    });
});
// ============== wouldCreateCycleBFS ==============
describe('wouldCreateCycleBFS', () => {
    test('添加边不形成环返回 false', () => {
        const revAdj = buildReverseAdj([['B', 'C']]);
        expect(wouldCreateCycleBFS('A', 'B', revAdj)).toBe(false);
    });
    test('添加边形成环返回 true', () => {
        // 已有 A→B (A depends on B), reverseAdj[B]={A}
        // 添加 B→A 会形成环 B→A→B
        const revAdj = new Map();
        revAdj.set('A', new Set());
        revAdj.set('B', new Set(['A']));
        expect(wouldCreateCycleBFS('B', 'A', revAdj)).toBe(true);
    });
    test('空反向邻接表返回 false', () => {
        const revAdj = new Map();
        expect(wouldCreateCycleBFS('A', 'B', revAdj)).toBe(false);
    });
});
// ============== findComponentsUnionFind ==============
describe('findComponentsUnionFind', () => {
    test('单连通分量', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
        ]);
        const nodes = buildNodes(['A', 'B', 'C']);
        const components = findComponentsUnionFind(adj, nodes);
        expect(components.length).toBe(1);
        expect(components[0].size).toBe(3);
        expect(components[0].rootId).toBe('C'); // C has no dependencies (most upstream)
    });
    test('两个独立连通分量', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'C', to: 'D' },
        ]);
        const nodes = buildNodes(['A', 'B', 'C', 'D']);
        const components = findComponentsUnionFind(adj, nodes);
        expect(components.length).toBe(2);
    });
    test('孤立节点各自为一个分量', () => {
        const adj = new Map();
        const nodes = buildNodes(['A', 'B', 'C']);
        const components = findComponentsUnionFind(adj, nodes);
        expect(components.length).toBe(3);
        expect(components.every(c => c.size === 1)).toBe(true);
    });
    test('分量按大小降序排列', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
            { from: 'D', to: 'E' },
        ]);
        const nodes = buildNodes(['A', 'B', 'C', 'D', 'E']);
        const components = findComponentsUnionFind(adj, nodes);
        expect(components[0].size).toBeGreaterThanOrEqual(components[1].size);
    });
    test('叶节点计数正确', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'A', to: 'C' },
        ]);
        const nodes = buildNodes(['A', 'B', 'C']);
        const components = findComponentsUnionFind(adj, nodes);
        // B and C have no outgoing edges within component = leaves
        expect(components[0].leafCount).toBe(2);
    });
    test('深度计算正确', () => {
        // A depends on B, B depends on C. Root = C (no deps). Depth = 2 (C→B→A).
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
        ]);
        const nodes = buildNodes(['A', 'B', 'C']);
        const components = findComponentsUnionFind(adj, nodes);
        expect(components[0].depth).toBe(2);
        expect(components[0].rootId).toBe('C');
    });
});
// ============== topologicalSortDFS ==============
describe('topologicalSortDFS', () => {
    test('简单 DAG 拓扑排序', () => {
        const adj = buildWeightedAdjacency([
            { from: 'B', to: 'A' }, // B depends on A
            { from: 'C', to: 'B' }, // C depends on B
        ]);
        const nodeIds = new Set(['A', 'B', 'C']);
        const result = topologicalSortDFS(adj, nodeIds);
        expect(result.valid).toBe(true);
        expect(result.order).toContain('A');
        expect(result.order).toContain('B');
        expect(result.order).toContain('C');
        // A should come before B, B before C
        expect(result.order.indexOf('A')).toBeLessThan(result.order.indexOf('B'));
        expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('C'));
    });
    test('分层信息正确', () => {
        const adj = buildWeightedAdjacency([
            { from: 'B', to: 'A' },
            { from: 'C', to: 'A' },
        ]);
        const nodeIds = new Set(['A', 'B', 'C']);
        const result = topologicalSortDFS(adj, nodeIds);
        expect(result.valid).toBe(true);
        expect(result.levels.length).toBeGreaterThanOrEqual(2);
        // A 在第一层, B 和 C 在第二层
        expect(result.levels[0]).toContain('A');
        expect(result.levels[1]).toContain('B');
        expect(result.levels[1]).toContain('C');
    });
    test('有环时 valid=false 并返回环路径', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
            { from: 'C', to: 'A' },
        ]);
        const nodeIds = new Set(['A', 'B', 'C']);
        const result = topologicalSortDFS(adj, nodeIds);
        expect(result.valid).toBe(false);
        expect(result.cycles).toBeDefined();
        expect(result.cycles.length).toBeGreaterThan(0);
    });
    test('空图返回有效空结果', () => {
        const adj = new Map();
        const nodeIds = new Set();
        const result = topologicalSortDFS(adj, nodeIds);
        expect(result.valid).toBe(true);
        expect(result.order).toEqual([]);
        expect(result.levels).toEqual([]);
    });
});
// ============== computeTransitiveClosure ==============
describe('computeTransitiveClosure', () => {
    test('线性链传递闭包', () => {
        // A→B→C
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
        ]);
        const closure = computeTransitiveClosure(adj);
        expect(closure.get('A').has('B')).toBe(true);
        expect(closure.get('A').has('C')).toBe(true);
        expect(closure.get('B').has('C')).toBe(true);
        expect(closure.get('B').has('A')).toBe(false);
    });
    test('无依赖节点闭包为空', () => {
        const adj = new Map();
        adj.set('A', new Map());
        const closure = computeTransitiveClosure(adj);
        expect(closure.get('A').size).toBe(0);
    });
    test('菱形依赖传递闭包', () => {
        // A→B, A→C, B→D, C→D
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B' },
            { from: 'A', to: 'C' },
            { from: 'B', to: 'D' },
            { from: 'C', to: 'D' },
        ]);
        const closure = computeTransitiveClosure(adj);
        expect(closure.get('A').has('B')).toBe(true);
        expect(closure.get('A').has('C')).toBe(true);
        expect(closure.get('A').has('D')).toBe(true);
        expect(closure.get('B').has('D')).toBe(true);
        expect(closure.get('C').has('D')).toBe(true);
        expect(closure.get('D').size).toBe(0);
    });
});
// ============== breakCycle ==============
describe('breakCycle', () => {
    test('选择最低置信度边断开', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B', meta: { source: 'explicit', confidence: 1.0 } },
            { from: 'B', to: 'C', meta: { source: 'ai-semantic', confidence: 0.7 } },
            { from: 'C', to: 'A', meta: { source: 'keyword', confidence: 0.6 } },
        ]);
        const result = breakCycle(['A', 'B', 'C', 'A'], adj);
        expect(result).not.toBeNull();
        expect(result.action).toBe('break_cycle');
        // ai-semantic (0) has lowest priority, B→C edge
        expect(result.edgeChanges[0].action).toBe('remove');
    });
    test('路径长度 < 2 返回 null', () => {
        const adj = buildWeightedAdjacency([]);
        expect(breakCycle(['A'], adj)).toBeNull();
        expect(breakCycle([], adj)).toBeNull();
    });
    test('所有边都是 explicit 时仍选择最低置信度', () => {
        const adj = buildWeightedAdjacency([
            { from: 'A', to: 'B', meta: { source: 'explicit', confidence: 1.0 } },
            { from: 'B', to: 'A', meta: { source: 'explicit', confidence: 0.8 } },
        ]);
        const result = breakCycle(['A', 'B', 'A'], adj);
        expect(result).not.toBeNull();
        // B→A has lower confidence
        expect(result.edgeChanges[0].to).toBe('A');
        expect(result.edgeChanges[0].from).toBe('B');
    });
});
// ============== detectBridgeNodes ==============
describe('detectBridgeNodes', () => {
    test('单根无桥接', () => {
        const revAdj = buildReverseAdj([['A', 'B']]);
        const roots = new Set(['A']);
        const bridges = detectBridgeNodes(revAdj, roots);
        expect(bridges).toEqual([]);
    });
    test('多根共享下游检测为桥接', () => {
        // Root1 → C, Root2 → C (C is reachable from both roots)
        const revAdj = new Map();
        revAdj.set('Root1', new Set(['C']));
        revAdj.set('Root2', new Set(['C']));
        revAdj.set('C', new Set());
        const roots = new Set(['Root1', 'Root2']);
        const bridges = detectBridgeNodes(revAdj, roots);
        expect(bridges.length).toBe(1);
        expect(bridges[0].nodeId).toBe('C');
        expect(bridges[0].bridgedRoots).toContain('Root1');
        expect(bridges[0].bridgedRoots).toContain('Root2');
    });
    test('无重叠下游返回空', () => {
        const revAdj = new Map();
        revAdj.set('Root1', new Set(['A']));
        revAdj.set('Root2', new Set(['B']));
        revAdj.set('A', new Set());
        revAdj.set('B', new Set());
        const roots = new Set(['Root1', 'Root2']);
        const bridges = detectBridgeNodes(revAdj, roots);
        expect(bridges).toEqual([]);
    });
});
// ============== computeDepths ==============
describe('computeDepths', () => {
    test('根节点深度为 0', () => {
        const adj = buildWeightedAdjacency([
            { from: 'B', to: 'A' },
        ]);
        const roots = new Set(['A']);
        const depths = computeDepths(adj, roots);
        expect(depths.get('A')).toBe(0);
        expect(depths.get('B')).toBe(1);
    });
    test('线性链深度递增', () => {
        // A(0) → B(1) → C(2)
        const adj = buildWeightedAdjacency([
            { from: 'B', to: 'A' },
            { from: 'C', to: 'B' },
        ]);
        const roots = new Set(['A']);
        const depths = computeDepths(adj, roots);
        expect(depths.get('A')).toBe(0);
        expect(depths.get('B')).toBe(1);
        expect(depths.get('C')).toBe(2);
    });
    test('空图返回空映射', () => {
        const adj = new Map();
        const roots = new Set();
        const depths = computeDepths(adj, roots);
        expect(depths.size).toBe(0);
    });
    test('多根时正确计算', () => {
        const adj = buildWeightedAdjacency([
            { from: 'C', to: 'A' },
            { from: 'C', to: 'B' },
        ]);
        const roots = new Set(['A', 'B']);
        const depths = computeDepths(adj, roots);
        expect(depths.get('A')).toBe(0);
        expect(depths.get('B')).toBe(0);
        expect(depths.get('C')).toBe(1);
    });
});
