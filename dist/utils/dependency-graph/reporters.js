/**
 * 生成依赖图可视化文本
 * 用于 status 命令
 */
export function renderGraphOverview(graph) {
    const stats = graph.getStatistics();
    const lines = [];
    lines.push('依赖关系概览');
    lines.push(`├── 任务树: ${stats.componentCount} 个 (最大: ${stats.maxComponentSize} 个任务)`);
    lines.push(`├── 孤立任务: ${stats.orphanCount} 个`);
    lines.push(`├── 桥接节点: ${stats.bridgeNodeCount} 个`);
    lines.push(`├── 循环依赖: ${stats.cycleCount} 个`);
    lines.push(`├── 显式依赖: ${stats.totalExplicitEdges} 条`);
    lines.push(`├── 推断依赖: ${stats.totalInferredEdges} 条`);
    lines.push(`└── 总节点数: ${stats.totalNodes}`);
    return lines.join('\n');
}
/**
 * 生成主开发方向报告
 * 按连通分量大小排序，识别当前最活跃的开发方向
 */
export function renderDevelopmentFocus(graph) {
    const focus = graph.getPrimaryDevelopmentFocus();
    if (focus.length === 0) {
        return '无活跃开发方向';
    }
    const lines = [];
    lines.push(`主开发方向: ${focus[0].description}`);
    lines.push(`├── Root: ${focus[0].rootNode}`);
    lines.push(`├── 活跃任务: ${focus[0].activeTasks.length} 个`);
    if (focus.length > 1) {
        lines.push(`└── 其他方向: ${focus.length - 1} 个`);
        for (let i = 1; i < Math.min(focus.length, 4); i++) {
            const f = focus[i];
            lines.push(`    ├── ${f.description} (root: ${f.rootNode})`);
        }
        if (focus.length > 4) {
            lines.push(`    └── ... 以及 ${focus.length - 4} 个其他方向`);
        }
    }
    return lines.join('\n');
}
/**
 * 生成桥接节点报告
 * 列出所有连接多个任务树的关键节点
 */
export function renderBridgeReport(bridges) {
    if (bridges.length === 0) {
        return '未检测到桥接节点';
    }
    const lines = [];
    lines.push(`桥接节点 (${bridges.length} 个):`);
    for (const bridge of bridges) {
        lines.push(`├── ${bridge.nodeId} — 连接 ${bridge.bridgedRoots.length} 棵任务树: ${bridge.bridgedRoots.join(', ')}`);
    }
    // Replace last ├── with └──
    const lastIdx = lines.length - 1;
    if (lines[lastIdx].startsWith('├──')) {
        lines[lastIdx] = '└' + lines[lastIdx].slice(1);
    }
    return lines.join('\n');
}
/**
 * 生成异常摘要报告
 * 用于 analyze 命令
 */
export function renderAnomalySummary(anomalies) {
    if (anomalies.length === 0) {
        return '未检测到依赖关系异常';
    }
    const lines = [];
    lines.push(`依赖关系异常 (${anomalies.length} 个):`);
    // Group by severity
    const high = anomalies.filter(a => a.severity === 'high');
    const medium = anomalies.filter(a => a.severity === 'medium');
    const low = anomalies.filter(a => a.severity === 'low');
    const info = anomalies.filter(a => a.severity === 'info');
    if (high.length > 0) {
        lines.push(`├── 高严重度 (${high.length}):`);
        for (const a of high) {
            lines.push(`│   ├── [${a.type}] ${a.message}`);
        }
    }
    if (medium.length > 0) {
        lines.push(`├── 中严重度 (${medium.length}):`);
        for (const a of medium) {
            lines.push(`│   ├── [${a.type}] ${a.message}`);
        }
    }
    if (low.length > 0) {
        lines.push(`├── 低严重度 (${low.length}):`);
        for (const a of low) {
            lines.push(`│   ├── [${a.type}] ${a.message}`);
        }
    }
    if (info.length > 0) {
        lines.push(`└── 信息 (${info.length}):`);
        for (let i = 0; i < info.length; i++) {
            const a = info[i];
            const prefix = i === info.length - 1 ? '    └──' : '    ├──';
            lines.push(`${prefix} [${a.type}] ${a.message}`);
        }
    }
    return lines.join('\n');
}
