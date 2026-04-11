/**
 * 图算法模块
 *
 * 提供纯函数形式的图算法，供 DependencyGraph 类调用。
 * 包括：DFS 环检测、BFS 增量环检测、Union-Find 连通分量、
 * 拓扑排序（分层）、传递闭包、环破断、桥接节点检测、深度计算。
 */
import type {
  NodeId,
  EdgeMeta,
  AnomalyAutoFix,
  GraphNode,
  ComponentInfo,
  TopologicalOrderResult,
} from './types.js';

// ============== 环检测 ==============

/**
 * DFS 环检测（全量）
 * 返回所有环的完整路径
 */
export function detectCyclesDFS(adjacency: Map<NodeId, Set<NodeId>>): NodeId[][] {
  const cycles: NodeId[][] = [];
  const visited = new Set<NodeId>();
  const onStack = new Set<NodeId>();
  const path: NodeId[] = [];

  function dfs(node: NodeId): void {
    if (onStack.has(node)) {
      // Found a cycle — extract the cycle path
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    onStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
    }

    path.pop();
    onStack.delete(node);
  }

  for (const nodeId of adjacency.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return cycles;
}

/**
 * BFS 环检测（增量）
 * 检查添加 from→to 边是否会产生环
 * 通过从 to 出发沿反向邻接表搜索是否能到达 from
 */
export function wouldCreateCycleBFS(
  from: NodeId,
  to: NodeId,
  reverseAdj: Map<NodeId, Set<NodeId>>,
): boolean {
  // Adding from→to (from depends on to) creates a cycle if to already depends on from.
  // "to depends on from" means from is downstream of to in the dependency direction.
  // reverseAdj[x] = nodes that depend on x (downstream of x).
  // BFS from from through reverseAdj: check if to is downstream of from,
  // meaning from→...→to exists (to depends on from transitively).
  // If so, adding from→to creates cycle: from→to→...→from.

  const queue: NodeId[] = [from];
  const visited = new Set<NodeId>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const downstream = reverseAdj.get(current);
    if (downstream) {
      for (const next of downstream) {
        if (next === to) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  return false;
}

// ============== 连通分量 ==============

/**
 * Union-Find 数据结构
 */
class UnionFind {
  private parent: Map<NodeId, NodeId>;
  private rank: Map<NodeId, number>;

  constructor(nodeIds: Iterable<NodeId>) {
    this.parent = new Map();
    this.rank = new Map();
    for (const id of nodeIds) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(x: NodeId): NodeId {
    let root = x;
    // Find root
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let current = x;
    while (this.parent.get(current) !== current) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(x: NodeId, y: NodeId): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX) ?? 0;
    const rankY = this.rank.get(rootY) ?? 0;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

/**
 * Union-Find 连通分量
 * 使用无向边视图（将所有有向边视为无向边）
 * 返回每个分量的信息
 */
export function findComponentsUnionFind(
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
  nodes: Map<NodeId, GraphNode>,
): ComponentInfo[] {
  const allNodeIds = new Set<NodeId>(nodes.keys());
  const uf = new UnionFind(allNodeIds);

  // Union all connected nodes (undirected view)
  for (const [from, deps] of adjacency) {
    for (const to of deps.keys()) {
      uf.union(from, to);
    }
  }

  // Group by component root
  const componentMap = new Map<NodeId, NodeId[]>();
  for (const nodeId of allNodeIds) {
    const root = uf.find(nodeId);
    if (!componentMap.has(root)) {
      componentMap.set(root, []);
    }
    componentMap.get(root)!.push(nodeId);
  }

  // Build ComponentInfo for each component
  const components: ComponentInfo[] = [];
  for (const [root, memberIds] of componentMap) {
    // Find root node (in-degree 0 within component)
    const membersInAdj = new Set(memberIds);
    const inDegree = new Map<NodeId, number>();
    for (const id of memberIds) {
      inDegree.set(id, 0);
    }
    for (const id of memberIds) {
      const deps = adjacency.get(id);
      if (deps) {
        for (const dep of deps.keys()) {
          if (membersInAdj.has(dep)) {
            inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
          }
        }
      }
    }

    // Root node = node with no dependencies (out-degree 0 in adjacency = most upstream)
    const rootNodeId = memberIds.find(id => {
      const deps = adjacency.get(id);
      return !deps || deps.size === 0 || ![...deps.keys()].some(d => membersInAdj.has(d));
    }) ?? memberIds[0]!;

    // Find leaves (out-degree 0 within component)
    let leafCount = 0;
    for (const id of memberIds) {
      const deps = adjacency.get(id);
      const hasOutEdgeInComponent = deps && [...deps.keys()].some(dep => membersInAdj.has(dep));
      if (!hasOutEdgeInComponent) {
        leafCount++;
      }
    }

    // Compute depth using BFS from root
    const depth = computeComponentDepth(rootNodeId, adjacency, membersInAdj);

    // Find top priority
    const priorities = ['P0', 'Q1', 'P1', 'Q2', 'P2', 'Q3', 'P3', 'Q4'];
    let topPriority = 'P3';
    for (const id of memberIds) {
      const node = nodes.get(id);
      if (node) {
        if (priorities.indexOf(node.priority) < priorities.indexOf(topPriority)) {
          topPriority = node.priority;
        }
      }
    }

    components.push({
      componentId: root,
      rootId: rootNodeId,
      nodes: memberIds,
      size: memberIds.length,
      depth,
      leafCount,
      bridgeNodes: [],  // Will be filled by bridge detection
      topPriority,
      isInboundBridge: false,
    });
  }

  // Sort by size descending
  components.sort((a, b) => b.size - a.size);
  return components;
}

/**
 * Compute depth of a component via BFS from root
 */
function computeComponentDepth(
  rootId: NodeId,
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
  members: Set<NodeId>,
): number {
  // Build forward edges within component
  // adjacency: key = node, value = nodes it depends on (upstream)
  // For depth, we go from root (in-degree 0) downstream
  // We need reverse edges within component
  const reverseEdges = new Map<NodeId, Set<NodeId>>();
  for (const id of members) {
    reverseEdges.set(id, new Set());
  }
  for (const [from, deps] of adjacency) {
    if (!members.has(from)) continue;
    for (const to of deps.keys()) {
      if (members.has(to)) {
        reverseEdges.get(to)!.add(from);
      }
    }
  }

  // BFS from root following reverseEdges (downstream)
  let maxDepth = 0;
  const visited = new Map<NodeId, number>();
  const queue: Array<[NodeId, number]> = [[rootId, 0]];
  visited.set(rootId, 0);

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    maxDepth = Math.max(maxDepth, depth);
    const downstream = reverseEdges.get(current);
    if (downstream) {
      for (const next of downstream) {
        if (!visited.has(next)) {
          visited.set(next, depth + 1);
          queue.push([next, depth + 1]);
        }
      }
    }
  }

  return maxDepth;
}

// ============== 拓扑排序 ==============

/**
 * DFS 后序拓扑排序（分层）
 * 返回分层结构，同层可并行执行
 */
export function topologicalSortDFS(
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
  nodeIds: Set<NodeId>,
): TopologicalOrderResult {
  // Kahn's algorithm with level tracking
  // Build in-degree map within the node set
  const inDegree = new Map<NodeId, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
  }

  // reverseAdj for Kahn's: key=dep, value=nodes depending on dep
  const reverseInSet = new Map<NodeId, Set<NodeId>>();
  for (const id of nodeIds) {
    reverseInSet.set(id, new Set());
  }

  for (const [from, deps] of adjacency) {
    if (!nodeIds.has(from)) continue;
    for (const to of deps.keys()) {
      if (nodeIds.has(to)) {
        inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
        reverseInSet.get(to)!.add(from);
      }
    }
  }

  // Find all roots (in-degree 0)
  const levels: NodeId[][] = [];
  const order: NodeId[] = [];
  let currentLevel: NodeId[] = [];
  for (const id of nodeIds) {
    if ((inDegree.get(id) ?? 0) === 0) {
      currentLevel.push(id);
    }
  }

  let processedCount = 0;
  while (currentLevel.length > 0) {
    levels.push([...currentLevel]);
    order.push(...currentLevel);
    processedCount += currentLevel.length;

    const nextLevel: NodeId[] = [];
    for (const id of currentLevel) {
      const downstream = reverseInSet.get(id);
      if (downstream) {
        for (const depId of downstream) {
          const newDeg = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            nextLevel.push(depId);
          }
        }
      }
    }
    currentLevel = nextLevel;
  }

  if (processedCount < nodeIds.size) {
    // Cycle detected — find cycles
    const cycles = detectCyclesDFS(buildSimpleAdjacency(adjacency, nodeIds));
    return {
      order,
      levels,
      valid: false,
      cycles,
    };
  }

  return {
    order,
    levels,
    valid: true,
  };
}

/**
 * Build simple adjacency (Map<NodeId, Set<NodeId>>) from weighted adjacency
 */
function buildSimpleAdjacency(
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
  nodeIds?: Set<NodeId>,
): Map<NodeId, Set<NodeId>> {
  const result = new Map<NodeId, Set<NodeId>>();
  for (const [from, deps] of adjacency) {
    if (nodeIds && !nodeIds.has(from)) continue;
    const depSet = new Set<NodeId>();
    for (const to of deps.keys()) {
      if (!nodeIds || nodeIds.has(to)) {
        depSet.add(to);
      }
    }
    result.set(from, depSet);
  }
  return result;
}

// ============== 传递闭包 ==============

/**
 * 传递闭包计算（BFS 逐节点）
 * result.get(a).has(b) means a can reach b via transitive dependencies
 */
export function computeTransitiveClosure(
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
): Map<NodeId, Set<NodeId>> {
  const closure = new Map<NodeId, Set<NodeId>>();

  // Collect all nodes (both sources and targets)
  const allNodes = new Set<NodeId>();
  for (const [from, deps] of adjacency) {
    allNodes.add(from);
    for (const to of deps.keys()) {
      allNodes.add(to);
    }
  }

  // Initialize closure for all nodes
  for (const node of allNodes) {
    closure.set(node, new Set());
  }

  // Build reverse: for each node, what nodes does it depend on (directly)
  const simpleAdj = new Map<NodeId, Set<NodeId>>();
  for (const node of allNodes) {
    if (!simpleAdj.has(node)) simpleAdj.set(node, new Set());
  }
  for (const [from, deps] of adjacency) {
    simpleAdj.set(from, new Set(deps.keys()));
  }

  // For each node, BFS through its dependencies to find all reachable nodes
  for (const startNode of adjacency.keys()) {
    const reachable = new Set<NodeId>();
    const queue: NodeId[] = [];

    // Start from direct dependencies
    const directDeps = simpleAdj.get(startNode);
    if (directDeps) {
      for (const dep of directDeps) {
        if (dep !== startNode) {
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const nextDeps = simpleAdj.get(current);
      if (nextDeps) {
        for (const dep of nextDeps) {
          if (dep !== startNode && !reachable.has(dep)) {
            reachable.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    closure.set(startNode, reachable);
  }

  return closure;
}

// ============== 环破断 ==============

/**
 * 环破断算法
 * 分析环中各边的来源置信度，选择最弱边断开
 */
export function breakCycle(
  cyclePath: NodeId[],
  edges: Map<NodeId, Map<NodeId, EdgeMeta>>,
): AnomalyAutoFix | null {
  if (cyclePath.length < 2) return null;

  // Source priority: lower = prefer to break
  const sourcePriority: Record<string, number> = {
    'ai-semantic': 0,
    'keyword': 1,
    'file-overlap': 2,
    'explicit': 3,
  };

  // Find the weakest edge in the cycle
  let weakestFrom = '';
  let weakestTo = '';
  let weakestScore = Infinity;

  for (let i = 0; i < cyclePath.length - 1; i++) {
    const from = cyclePath[i]!;
    const to = cyclePath[i + 1]!;
    const edgeData = edges.get(from)?.get(to);
    if (!edgeData) continue;

    const priority = sourcePriority[edgeData.source] ?? 0;
    const score = priority * 100 + edgeData.confidence * 100;

    if (score < weakestScore) {
      weakestScore = score;
      weakestFrom = from;
      weakestTo = to;
    }
  }

  // If all edges are explicit with same confidence, need manual intervention
  if (weakestFrom === '' && weakestTo === '') {
    return null;
  }

  return {
    action: 'break_cycle',
    description: `建议断开 ${weakestFrom} → ${weakestTo} 的依赖以打破循环`,
    edgeChanges: [{ from: weakestFrom, to: weakestTo, action: 'remove' }],
  };
}

// ============== 桥接节点检测 ==============

/**
 * 桥接节点检测
 * 对每个非根节点，沿反向边追溯到根节点，
 * 若到达不同的根节点，则标记为桥接节点
 */
export function detectBridgeNodes(
  reverseAdj: Map<NodeId, Set<NodeId>>,
  roots: Set<NodeId>,
): Array<{ nodeId: NodeId; bridgedRoots: NodeId[] }> {
  const bridges: Array<{ nodeId: NodeId; bridgedRoots: NodeId[] }> = [];

  // For each root, BFS through reverseAdj to find all reachable nodes
  // Then check if any non-root node is reachable from multiple roots
  const nodeRoots = new Map<NodeId, Set<NodeId>>();

  for (const root of roots) {
    const visited = new Set<NodeId>();
    const queue: NodeId[] = [root];
    visited.add(root);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!nodeRoots.has(current)) {
        nodeRoots.set(current, new Set());
      }
      nodeRoots.get(current)!.add(root);

      const downstream = reverseAdj.get(current);
      if (downstream) {
        for (const next of downstream) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }
  }

  // Find nodes reachable from 2+ different roots
  for (const [nodeId, reachableRoots] of nodeRoots) {
    if (reachableRoots.size >= 2 && !roots.has(nodeId)) {
      bridges.push({
        nodeId,
        bridgedRoots: [...reachableRoots],
      });
    }
  }

  return bridges;
}

// ============== 深度计算 ==============

/**
 * 最长路径计算（DAG 深度）
 * BFS from roots, compute longest path to each node
 */
export function computeDepths(
  adjacency: Map<NodeId, Map<NodeId, EdgeMeta>>,
  roots: Set<NodeId>,
): Map<NodeId, number> {
  const depths = new Map<NodeId, number>();

  // Build reverseEdges: downstream edges (key depends on → value is depended upon by key)
  // Actually: adjacency[key] = nodes that key depends on (upstream)
  // We need: for depth from roots, roots have depth 0, their children have depth 1, etc.
  // Children in DAG = nodes that depend on a node = reverseAdj

  // Collect all nodes
  const allNodes = new Set<NodeId>();
  for (const [from, deps] of adjacency) {
    allNodes.add(from);
    for (const to of deps.keys()) {
      allNodes.add(to);
    }
  }

  // Build downstream adjacency
  const downstream = new Map<NodeId, Set<NodeId>>();
  for (const id of allNodes) {
    downstream.set(id, new Set());
  }
  for (const [from, deps] of adjacency) {
    for (const to of deps.keys()) {
      downstream.get(to)!.add(from);
    }
  }

  // BFS from roots
  for (const root of roots) {
    depths.set(root, 0);
  }

  // Topological order approach for longest path (using downstream edges)
  const inDegreeDown = new Map<NodeId, number>();
  for (const id of allNodes) {
    inDegreeDown.set(id, 0);
  }
  for (const [, children] of downstream) {
    for (const child of children) {
      inDegreeDown.set(child, (inDegreeDown.get(child) ?? 0) + 1);
    }
  }

  const queue: NodeId[] = [];
  for (const id of allNodes) {
    if ((inDegreeDown.get(id) ?? 0) === 0) {
      queue.push(id);
      if (!depths.has(id)) {
        depths.set(id, 0);
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = downstream.get(current);
    if (children) {
      for (const child of children) {
        const newDepth = (depths.get(current) ?? 0) + 1;
        depths.set(child, Math.max(depths.get(child) ?? 0, newDepth));
        const newDeg = (inDegreeDown.get(child) ?? 1) - 1;
        inDegreeDown.set(child, newDeg);
        if (newDeg === 0) {
          queue.push(child);
        }
      }
    }
  }

  return depths;
}
