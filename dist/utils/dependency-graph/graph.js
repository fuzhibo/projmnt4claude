import { detectCyclesDFS, wouldCreateCycleBFS, findComponentsUnionFind, topologicalSortDFS, computeTransitiveClosure, breakCycle, detectBridgeNodes, computeDepths, } from './algorithms.js';
const DEFAULT_EDGE_META = {
    source: 'explicit',
    confidence: 1.0,
};
export class DependencyGraph {
    // ============== 内部数据结构 ==============
    /** 节点映射 */
    nodes;
    /** 正向邻接表: node → 它依赖的节点 → 边元数据 */
    adjacency;
    /** 反向邻接表: node → 依赖它的节点集合 */
    reverseAdj;
    /** 传递闭包（懒计算） */
    _transitiveClosure;
    /** 构建选项 */
    options;
    // ============== 构造函数 ==============
    constructor(options) {
        this.nodes = new Map();
        this.adjacency = new Map();
        this.reverseAdj = new Map();
        this.options = options ?? {};
    }
    // ============== 构建与更新 ==============
    /**
     * 从任务列表构建完整依赖图
     */
    static fromTasks(tasks, options) {
        const graph = new DependencyGraph(options);
        const sources = options?.sources;
        const excludeTerminal = options?.excludeTerminal;
        const terminalStatuses = new Set(['resolved', 'closed', 'abandoned']);
        // Add all nodes first
        for (const task of tasks) {
            if (excludeTerminal && terminalStatuses.has(task.status))
                continue;
            graph.addNode(task);
        }
        // Add edges from explicit dependencies
        for (const task of tasks) {
            if (excludeTerminal && terminalStatuses.has(task.status))
                continue;
            for (const depId of task.dependencies) {
                if (!graph.hasNode(depId))
                    continue;
                graph.addEdge(task.id, depId, {
                    source: 'explicit',
                    confidence: 1.0,
                });
            }
        }
        // Compute transitive closure if requested
        if (options?.computeTransitiveClosure) {
            graph.getTransitiveClosure();
        }
        return graph;
    }
    /**
     * 增量添加节点（任务创建时调用）
     */
    addNode(task, inferredDeps) {
        const graphNode = {
            taskId: task.id,
            status: task.status,
            priority: task.priority,
            title: task.title,
            type: task.type,
        };
        this.nodes.set(task.id, graphNode);
        // Ensure adjacency entries exist
        if (!this.adjacency.has(task.id)) {
            this.adjacency.set(task.id, new Map());
        }
        if (!this.reverseAdj.has(task.id)) {
            this.reverseAdj.set(task.id, new Set());
        }
        // Add inferred dependencies if provided
        if (inferredDeps) {
            for (const { depId, meta } of inferredDeps) {
                if (this.nodes.has(depId)) {
                    this.addEdgeInternal(task.id, depId, meta);
                }
            }
        }
        this.invalidateClosure();
    }
    /**
     * 移除节点及关联边
     */
    removeNode(taskId) {
        if (!this.nodes.has(taskId))
            return;
        // Remove all edges pointing to this node
        const upstream = this.adjacency.get(taskId);
        if (upstream) {
            for (const depId of upstream.keys()) {
                const reverseSet = this.reverseAdj.get(depId);
                if (reverseSet) {
                    reverseSet.delete(taskId);
                }
            }
        }
        // Remove all edges from nodes that depend on this node
        const downstream = this.reverseAdj.get(taskId);
        if (downstream) {
            for (const depNodeId of downstream) {
                const deps = this.adjacency.get(depNodeId);
                if (deps) {
                    deps.delete(taskId);
                }
            }
        }
        // Remove the node itself
        this.nodes.delete(taskId);
        this.adjacency.delete(taskId);
        this.reverseAdj.delete(taskId);
        this.invalidateClosure();
    }
    /**
     * 添加边（含环检测）
     * 返回是否成功（环检测失败时返回 false）
     */
    addEdge(from, to, meta) {
        if (!this.nodes.has(from) || !this.nodes.has(to))
            return false;
        // Cycle detection
        if (this.wouldCreateCycle(from, to)) {
            return false;
        }
        this.addEdgeInternal(from, to, meta ?? { ...DEFAULT_EDGE_META });
        this.invalidateClosure();
        return true;
    }
    /**
     * 移除边
     */
    removeEdge(from, to) {
        const deps = this.adjacency.get(from);
        if (deps) {
            deps.delete(to);
        }
        const reverseSet = this.reverseAdj.get(to);
        if (reverseSet) {
            reverseSet.delete(from);
        }
        this.invalidateClosure();
    }
    // ============== 图查询 ==============
    /**
     * 获取所有根节点（入度为 0）
     */
    getRoots() {
        const roots = [];
        for (const [nodeId] of this.nodes) {
            // A root has no incoming edges = no one depends on it
            // Wait: in our model, adjacency[node] = nodes that node depends on
            // reverseAdj[node] = nodes that depend on node
            // Root = node with no dependencies = adjacency[node].size === 0
            const deps = this.adjacency.get(nodeId);
            if (!deps || deps.size === 0) {
                roots.push(nodeId);
            }
        }
        return roots;
    }
    /**
     * 获取所有叶节点（出度为 0，即无人依赖它）
     */
    getLeaves() {
        const leaves = [];
        for (const [nodeId] of this.nodes) {
            const reverseSet = this.reverseAdj.get(nodeId);
            if (!reverseSet || reverseSet.size === 0) {
                leaves.push(nodeId);
            }
        }
        return leaves;
    }
    /**
     * 获取直接上游（当前任务依赖的任务）
     */
    getDirectUpstream(taskId) {
        const deps = this.adjacency.get(taskId);
        return deps ? [...deps.keys()] : [];
    }
    /**
     * 获取直接下游（依赖当前任务的任务）
     */
    getDirectDownstream(taskId) {
        const downstream = this.reverseAdj.get(taskId);
        return downstream ? [...downstream] : [];
    }
    /**
     * 获取所有上游（传递闭包）
     */
    getAllUpstream(taskId) {
        const closure = this.getTransitiveClosure();
        const reachable = closure.get(taskId);
        return reachable ? [...reachable] : [];
    }
    /**
     * 获取所有下游（传递闭包）
     */
    getAllDownstream(taskId) {
        // Downstream via reverseAdj transitive
        const result = [];
        const closure = this.getTransitiveClosure();
        // closure.get(a).has(b) means a depends (transitively) on b
        // So downstream of X = nodes Y where closure.get(Y).has(X)
        // This is expensive; use BFS on reverseAdj instead
        const visited = new Set();
        const queue = [taskId];
        visited.add(taskId);
        while (queue.length > 0) {
            const current = queue.shift();
            const downstream = this.reverseAdj.get(current);
            if (downstream) {
                for (const next of downstream) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        result.push(next);
                        queue.push(next);
                    }
                }
            }
        }
        return result;
    }
    /**
     * 获取边的元数据
     */
    getEdgeMeta(from, to) {
        return this.adjacency.get(from)?.get(to);
    }
    /**
     * 节点是否存在
     */
    hasNode(taskId) {
        return this.nodes.has(taskId);
    }
    /**
     * 边是否存在
     */
    hasEdge(from, to) {
        return this.adjacency.get(from)?.has(to) ?? false;
    }
    /**
     * 获取节点信息
     */
    getNode(taskId) {
        return this.nodes.get(taskId);
    }
    /**
     * 获取所有节点 ID
     */
    getAllNodeIds() {
        return [...this.nodes.keys()];
    }
    // ============== 图分析 ==============
    /**
     * 检测环 — 返回所有环的路径
     */
    detectCycles() {
        const simpleAdj = this.toSimpleAdjacency();
        return detectCyclesDFS(simpleAdj);
    }
    /**
     * 检查添加边是否会创建环
     */
    wouldCreateCycle(from, to) {
        if (from === to)
            return true;
        if (!this.nodes.has(from) || !this.nodes.has(to))
            return false;
        return wouldCreateCycleBFS(from, to, this.reverseAdj);
    }
    /**
     * 拓扑排序（分层）
     */
    topologicalSort() {
        const nodeIds = new Set(this.nodes.keys());
        return topologicalSortDFS(this.adjacency, nodeIds);
    }
    /**
     * 查找连通分量
     */
    findComponents() {
        const components = findComponentsUnionFind(this.adjacency, this.nodes);
        // Enrich with bridge node info
        const roots = new Set(this.getRoots());
        const bridges = detectBridgeNodes(this.reverseAdj, roots);
        const bridgeMap = new Map();
        for (const b of bridges) {
            bridgeMap.set(b.nodeId, b.bridgedRoots);
        }
        for (const comp of components) {
            comp.bridgeNodes = comp.nodes.filter(id => bridgeMap.has(id));
            comp.isInboundBridge = comp.nodes.some(id => {
                const bridgedRoots = bridgeMap.get(id);
                return bridgedRoots && bridgedRoots.some(r => !comp.nodes.includes(r));
            });
        }
        return components;
    }
    /**
     * 检测桥接节点
     */
    findBridgeNodes() {
        const roots = new Set(this.getRoots());
        const bridges = detectBridgeNodes(this.reverseAdj, roots);
        return bridges.map(b => {
            const pathsFromRoots = new Map();
            for (const root of b.bridgedRoots) {
                const path = this.findPath(root, b.nodeId);
                pathsFromRoots.set(root, path);
            }
            return {
                nodeId: b.nodeId,
                bridgedRoots: b.bridgedRoots,
                pathsFromRoots,
            };
        });
    }
    /**
     * 检测孤立任务
     */
    findOrphans() {
        const components = this.findComponents();
        const orphans = components.filter(c => c.size === 1);
        // Check if any node has inferred dependencies pointing to the orphan
        return orphans.map(comp => {
            const nodeId = comp.nodes[0];
            const node = this.nodes.get(nodeId);
            // Check if any edge points to this orphan
            const isInboundBridgeTarget = this.reverseAdj.get(nodeId)?.size === 0;
            // Actually check if any node outside the component has an inferred edge to it
            let hasInboundInferred = false;
            for (const [fromId, deps] of this.adjacency) {
                if (fromId === nodeId)
                    continue;
                const edge = deps.get(nodeId);
                if (edge && edge.source !== 'explicit') {
                    hasInboundInferred = true;
                    break;
                }
            }
            return {
                nodeId,
                node,
                isInboundBridgeTarget: hasInboundInferred,
            };
        });
    }
    /**
     * 检测冗余依赖
     * A→B→C 存在时，如果 A→C 也存在，则 A→C 为冗余
     */
    findRedundantDeps() {
        const redundant = [];
        for (const [nodeId, deps] of this.adjacency) {
            for (const depId of deps.keys()) {
                // Check if depId is reachable from nodeId via other deps
                const otherDeps = [...deps.keys()].filter(d => d !== depId);
                for (const otherDep of otherDeps) {
                    const path = this.findPathThroughDep(otherDep, depId);
                    if (path) {
                        redundant.push({
                            from: nodeId,
                            to: depId,
                            viaPath: [nodeId, ...path],
                        });
                        break;
                    }
                }
            }
        }
        return redundant;
    }
    // ============== 级联操作 ==============
    /**
     * 计算失败级联影响范围
     */
    computeCascadeImpact(failedTaskId) {
        const directAffected = this.getDirectDownstream(failedTaskId);
        const allDownstream = this.getAllDownstream(failedTaskId);
        const transitiveAffected = allDownstream.filter(id => !directAffected.includes(id));
        const details = new Map();
        // BFS from failed task to compute depths and paths
        const visited = new Map();
        const queue = [];
        const downstreamSet = new Set(allDownstream);
        downstreamSet.add(failedTaskId);
        for (const depId of directAffected) {
            const entry = [depId, 1, [failedTaskId, depId], depId];
            queue.push(entry);
            visited.set(depId, { depth: 1, path: [failedTaskId, depId], source: depId });
        }
        while (queue.length > 0) {
            const [current, depth, path, source] = queue.shift();
            details.set(current, {
                depth,
                pathFromSource: path,
                sourceTaskId: source,
            });
            const nextDownstream = this.reverseAdj.get(current);
            if (nextDownstream) {
                for (const next of nextDownstream) {
                    if (!visited.has(next)) {
                        visited.set(next, {
                            depth: depth + 1,
                            path: [...path, next],
                            source,
                        });
                        queue.push([next, depth + 1, [...path, next], source]);
                    }
                }
            }
        }
        return {
            directAffected,
            transitiveAffected,
            details,
        };
    }
    // ============== 异常检测 ==============
    /**
     * 全面异常检测
     */
    detectAnomalies() {
        const anomalies = [];
        // 1. Cycle detection
        const cycles = this.detectCycles();
        for (const cyclePath of cycles) {
            const autoFix = breakCycle(cyclePath, this.adjacency);
            anomalies.push({
                type: 'cycle',
                severity: 'high',
                nodeIds: cyclePath,
                message: `检测到循环依赖: ${cyclePath.join(' → ')}`,
                suggestion: autoFix
                    ? autoFix.description
                    : '需要人工处理循环依赖',
                cyclePath,
                autoFix: autoFix ?? undefined,
            });
        }
        // 2. Orphan detection
        const orphans = this.findOrphans();
        for (const orphan of orphans) {
            const isSuspected = orphan.isInboundBridgeTarget;
            anomalies.push({
                type: isSuspected ? 'orphan_suspected' : 'orphan',
                severity: isSuspected ? 'medium' : 'info',
                nodeIds: [orphan.nodeId],
                message: `孤立任务: ${orphan.node.title ?? orphan.nodeId}`,
                suggestion: isSuspected
                    ? '该任务可能有隐含的依赖关系，请确认是否独立'
                    : '该任务为独立模块，无需处理',
            });
        }
        // 3. Invalid references
        for (const [nodeId, deps] of this.adjacency) {
            for (const depId of deps.keys()) {
                if (!this.nodes.has(depId)) {
                    anomalies.push({
                        type: 'invalid_ref',
                        severity: 'medium',
                        nodeIds: [nodeId],
                        message: `任务 ${nodeId} 依赖不存在的任务 ${depId}`,
                        suggestion: `移除无效依赖引用: ${depId}`,
                        autoFix: {
                            action: 'remove_ref',
                            description: `移除 ${nodeId} 对 ${depId} 的无效引用`,
                            edgeChanges: [{ from: nodeId, to: depId, action: 'remove' }],
                        },
                    });
                }
            }
        }
        // 4. Redundant dependencies
        const redundantDeps = this.findRedundantDeps();
        for (const rd of redundantDeps) {
            anomalies.push({
                type: 'redundant_dep',
                severity: 'low',
                nodeIds: [rd.from, rd.to],
                message: `冗余依赖: ${rd.from} → ${rd.to} (可通过 ${rd.viaPath.join(' → ')} 达到)`,
                suggestion: `可移除直接依赖 ${rd.from} → ${rd.to}`,
            });
        }
        // 5. Missing inferred dependencies
        // Detect nodes with inferred edges (non-explicit source) that aren't in explicit deps
        for (const [nodeId, deps] of this.adjacency) {
            const missingInferred = [];
            for (const [depId, meta] of deps) {
                if (meta.source !== 'explicit') {
                    missingInferred.push(depId);
                }
            }
            if (missingInferred.length > 0) {
                anomalies.push({
                    type: 'missing_inferred_dep',
                    severity: 'low',
                    nodeIds: [nodeId, ...missingInferred],
                    message: `任务 ${nodeId} 有 ${missingInferred.length} 个推断依赖未显式声明: ${missingInferred.join(', ')}`,
                    suggestion: `建议将推断依赖添加到显式依赖列表: ${missingInferred.join(', ')}`,
                    autoFix: {
                        action: 'add_dep',
                        description: `添加 ${missingInferred.length} 个推断依赖到 ${nodeId}`,
                        edgeChanges: missingInferred.map(depId => ({
                            from: nodeId,
                            to: depId,
                            action: 'add',
                        })),
                    },
                });
            }
        }
        return anomalies;
    }
    // ============== 统计与报告 ==============
    /**
     * 生成图统计信息
     */
    getStatistics() {
        let totalEdges = 0;
        let totalExplicitEdges = 0;
        let totalInferredEdges = 0;
        for (const [, deps] of this.adjacency) {
            for (const [depId, meta] of deps) {
                // Only count edges to existing nodes
                if (this.nodes.has(depId)) {
                    totalEdges++;
                    if (meta.source === 'explicit') {
                        totalExplicitEdges++;
                    }
                    else {
                        totalInferredEdges++;
                    }
                }
            }
        }
        const components = this.findComponents();
        const roots = this.getRoots();
        const orphans = this.findOrphans();
        const bridges = this.findBridgeNodes();
        const cycles = this.detectCycles();
        const anomalies = this.detectAnomalies();
        const anomalySummary = {
            cycle: 0,
            orphan: 0,
            bridge: 0,
            orphan_suspected: 0,
            invalid_ref: 0,
            redundant_dep: 0,
            missing_inferred_dep: 0,
        };
        for (const a of anomalies) {
            anomalySummary[a.type]++;
        }
        const maxComponentSize = components.length > 0 ? components[0].size : 0;
        return {
            totalNodes: this.nodes.size,
            totalEdges,
            totalExplicitEdges,
            totalInferredEdges,
            componentCount: components.length,
            rootCount: roots.length,
            orphanCount: orphans.length,
            bridgeNodeCount: bridges.length,
            cycleCount: cycles.length,
            avgComponentSize: this.nodes.size > 0
                ? this.nodes.size / components.length
                : 0,
            maxComponentSize,
            componentsBySize: components,
            anomalySummary,
        };
    }
    /**
     * 生成主开发方向分析
     */
    getPrimaryDevelopmentFocus() {
        const components = this.findComponents();
        const activeStatuses = new Set(['open', 'in_progress', 'wait_review', 'wait_qa']);
        return components
            .filter(c => c.size > 1)
            .map(comp => {
            const activeTasks = comp.nodes.filter(id => {
                const node = this.nodes.get(id);
                return node && activeStatuses.has(node.status);
            });
            return {
                componentId: comp.componentId,
                rootNode: comp.rootId,
                size: comp.size,
                description: comp.nodes.length > 0
                    ? `连通分量 (${comp.size} 个任务, ${activeTasks.length} 个活跃)`
                    : '空分量',
                activeTasks,
            };
        });
    }
    /**
     * 导出为 DOT 格式
     */
    toDOT() {
        const lines = ['digraph dependencies {', '  rankdir=LR;'];
        // Node styles by status
        for (const [id, node] of this.nodes) {
            const color = this.getStatusColor(node.status);
            const label = node.title ? node.title.replace(/"/g, '\\"') : id;
            lines.push(`  "${id}" [label="${label}" color="${color}"];`);
        }
        // Edges
        for (const [from, deps] of this.adjacency) {
            for (const [to, meta] of deps) {
                if (!this.nodes.has(to))
                    continue;
                const style = meta.source === 'explicit' ? 'solid' : 'dashed';
                const label = meta.source === 'explicit' ? '' : ` [label="${meta.source}" style=${style}]`;
                lines.push(`  "${from}" -> "${to}"${label};`);
            }
        }
        lines.push('}');
        return lines.join('\n');
    }
    // ============== 私有方法 ==============
    addEdgeInternal(from, to, meta) {
        if (!this.adjacency.has(from)) {
            this.adjacency.set(from, new Map());
        }
        this.adjacency.get(from).set(to, meta);
        if (!this.reverseAdj.has(to)) {
            this.reverseAdj.set(to, new Set());
        }
        this.reverseAdj.get(to).add(from);
    }
    invalidateClosure() {
        this._transitiveClosure = undefined;
    }
    getTransitiveClosure() {
        if (!this._transitiveClosure) {
            this._transitiveClosure = computeTransitiveClosure(this.adjacency);
        }
        return this._transitiveClosure;
    }
    toSimpleAdjacency() {
        const result = new Map();
        for (const [from, deps] of this.adjacency) {
            const depSet = new Set();
            for (const to of deps.keys()) {
                if (this.nodes.has(to)) {
                    depSet.add(to);
                }
            }
            result.set(from, depSet);
        }
        return result;
    }
    findPath(from, to) {
        // BFS to find shortest path from from to to in reverse direction
        // (from is a root, to is the target; we follow reverseAdj)
        const visited = new Set([from]);
        const queue = [[from, [from]]];
        while (queue.length > 0) {
            const [current, path] = queue.shift();
            if (current === to)
                return path;
            const downstream = this.reverseAdj.get(current);
            if (downstream) {
                for (const next of downstream) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        queue.push([next, [...path, next]]);
                    }
                }
            }
        }
        return [];
    }
    findPathThroughDep(intermediate, target) {
        // Check if target is reachable from intermediate via adjacency
        const visited = new Set();
        const queue = [intermediate];
        visited.add(intermediate);
        while (queue.length > 0) {
            const current = queue.shift();
            const deps = this.adjacency.get(current);
            if (deps) {
                for (const depId of deps.keys()) {
                    if (depId === target)
                        return [intermediate, target];
                    if (!visited.has(depId) && this.nodes.has(depId)) {
                        visited.add(depId);
                        queue.push(depId);
                    }
                }
            }
        }
        // Simpler approach: just check reachability
        // Redo with path tracking
        return this.isReachable(intermediate, target) ? [intermediate, target] : null;
    }
    isReachable(from, to) {
        const visited = new Set([from]);
        const queue = [from];
        while (queue.length > 0) {
            const current = queue.shift();
            const deps = this.adjacency.get(current);
            if (deps) {
                for (const depId of deps.keys()) {
                    if (depId === to)
                        return true;
                    if (!visited.has(depId) && this.nodes.has(depId)) {
                        visited.add(depId);
                        queue.push(depId);
                    }
                }
            }
        }
        return false;
    }
    getStatusColor(status) {
        switch (status) {
            case 'open': return 'white';
            case 'in_progress': return 'blue';
            case 'wait_review': return 'orange';
            case 'wait_qa': return 'yellow';
            case 'wait_evaluation': return 'yellow';
            case 'resolved': return 'green';
            case 'closed': return 'gray';
            case 'failed': return 'red';
            case 'abandoned': return 'gray';
            default: return 'black';
        }
    }
}
