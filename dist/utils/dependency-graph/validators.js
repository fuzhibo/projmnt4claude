import { extractAffectedFiles } from '../quality-gate.js';
/**
 * 验证孤立任务的合理性
 *
 * 当检测到孤立任务时，检查:
 * 1. 是否有其他任务的推断依赖指向它
 * 2. 任务的受影响文件是否与其他任务有重叠
 * 3. 任务关键词是否与其他任务的标题/描述有关联
 *
 * 如果以上任一为是，则标记为 orphan_suspected（疑似异常孤立）
 */
export function validateOrphan(nodeId, graph, allTasks) {
    const node = graph.getNode(nodeId);
    if (!node) {
        return { isLikelyOrphan: true, reason: '节点不存在于图中' };
    }
    const relatedTasks = [];
    // 1. 检查是否有推断依赖指向该节点
    const downstream = graph.getDirectDownstream(nodeId);
    if (downstream.length > 0) {
        return {
            isLikelyOrphan: false,
            reason: `有 ${downstream.length} 个下游任务依赖此节点`,
            relatedTasks: downstream,
        };
    }
    // 2. 检查文件重叠关联
    const orphanTask = allTasks.find(t => t.id === nodeId);
    if (orphanTask) {
        const orphanFiles = extractAffectedFiles(orphanTask);
        if (orphanFiles.length > 0) {
            const orphanFileSet = new Set(orphanFiles.map(f => f.toLowerCase().replace(/\\/g, '/')));
            for (const task of allTasks) {
                if (task.id === nodeId)
                    continue;
                const taskFiles = extractAffectedFiles(task);
                const hasOverlap = taskFiles.some(f => orphanFileSet.has(f.toLowerCase().replace(/\\/g, '/')));
                if (hasOverlap && !relatedTasks.includes(task.id)) {
                    relatedTasks.push(task.id);
                }
            }
        }
    }
    // 3. 检查任务标题/描述与其他任务的关键词关联
    const nodeTitle = node.title.toLowerCase();
    const nodeWords = new Set(nodeTitle.split(/[\s\-_]+/).filter(w => w.length > 2));
    for (const task of allTasks) {
        if (task.id === nodeId)
            continue;
        const taskTitle = task.title.toLowerCase();
        const taskWords = new Set(taskTitle.split(/[\s\-_]+/).filter(w => w.length > 2));
        // Count overlapping significant words
        let overlapCount = 0;
        for (const word of nodeWords) {
            if (taskWords.has(word)) {
                overlapCount++;
            }
        }
        // If 2+ significant words overlap, likely related
        if (overlapCount >= 2) {
            relatedTasks.push(task.id);
        }
        // Also check if description contains reference
        const description = task.description ?? '';
        if (description && description.toLowerCase().includes(nodeId.toLowerCase())) {
            if (!relatedTasks.includes(task.id)) {
                relatedTasks.push(task.id);
            }
        }
    }
    if (relatedTasks.length > 0) {
        return {
            isLikelyOrphan: false,
            reason: `任务与 ${relatedTasks.length} 个其他任务存在关联（文件/关键词/推断），可能是疑似异常孤立`,
            relatedTasks,
        };
    }
    return {
        isLikelyOrphan: true,
        reason: '任务未发现与其他任务的关联，确认为独立模块',
    };
}
/**
 * 验证新建任务的依赖关系完整性
 * 用于 init-requirement 和 task create 的质量门禁
 *
 * 规则:
 * - GATE-DEP-001: 无依赖 + 非独立模块 → 警告，要求说明独立性理由
 * - GATE-DEP-002: 依赖会导致环 → 错误
 * - GATE-DEP-003: 所有依赖均为推断 → 提示确认
 */
export function validateNewTaskDeps(taskId, dependencies, graph, _allTasks) {
    const errors = [];
    const warnings = [];
    let requiresJustification = false;
    // GATE-DEP-001: 无依赖任务
    if (dependencies.length === 0) {
        requiresJustification = true;
        warnings.push(`GATE-DEP-001: 任务 ${taskId} 无任何依赖。如果这不是独立模块，请添加相关依赖`);
    }
    // GATE-DEP-002: 环检测
    for (const depId of dependencies) {
        if (graph.hasNode(taskId) && graph.hasNode(depId)) {
            if (graph.wouldCreateCycle(taskId, depId)) {
                errors.push(`GATE-DEP-002: 添加 ${taskId} → ${depId} 依赖会形成循环依赖`);
            }
        }
    }
    // GATE-DEP-003: 检查推断依赖与显式依赖的一致性
    if (dependencies.length > 0) {
        const inferredOnly = dependencies.filter(depId => {
            const meta = graph.getEdgeMeta(taskId, depId);
            return meta && meta.source !== 'explicit';
        });
        if (inferredOnly.length === dependencies.length && dependencies.length > 0) {
            warnings.push(`GATE-DEP-003: 任务 ${taskId} 的所有依赖均为推断来源，建议确认是否需要显式声明`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        requiresJustification,
    };
}
/**
 * 验证计划操作是否破坏依赖关系
 * 用于 plan 命令的 destructive 操作前置检查
 *
 * 规则:
 * 1. 删除任务前检查是否有下游依赖
 * 2. 修改优先级前检查是否影响拓扑排序
 * 3. 合并任务前检查依赖是否一致
 */
export function validatePlanOperation(operation, targetIds, graph) {
    const warnings = [];
    switch (operation) {
        case 'delete': {
            for (const id of targetIds) {
                const downstream = graph.getDirectDownstream(id);
                if (downstream.length > 0) {
                    warnings.push(`删除 ${id} 会影响 ${downstream.length} 个下游任务: ${downstream.join(', ')}`);
                }
                const allDownstream = graph.getAllDownstream(id);
                const transitiveDownstream = allDownstream.filter(d => !downstream.includes(d));
                if (transitiveDownstream.length > 0) {
                    warnings.push(`删除 ${id} 的传递影响范围还包括: ${transitiveDownstream.join(', ')}`);
                }
            }
            break;
        }
        case 'reprioritize': {
            // Check if target is a root or bridge node
            for (const id of targetIds) {
                const bridges = graph.findBridgeNodes();
                const isBridge = bridges.some(b => b.nodeId === id);
                if (isBridge) {
                    warnings.push(`${id} 是桥接节点，修改优先级可能影响多个任务树的调度顺序`);
                }
            }
            break;
        }
        case 'merge': {
            if (targetIds.length < 2) {
                warnings.push('合并操作需要至少 2 个目标任务');
                break;
            }
            // Check if targets have consistent dependencies
            const allDeps = new Set();
            const targetSet = new Set(targetIds);
            for (const id of targetIds) {
                const upstream = graph.getDirectUpstream(id);
                for (const dep of upstream) {
                    if (!targetSet.has(dep)) {
                        allDeps.add(dep);
                    }
                }
            }
            // Each target should depend on roughly the same external deps
            for (const id of targetIds) {
                const upstream = graph.getDirectUpstream(id).filter(d => !targetSet.has(d));
                const externalDeps = new Set(upstream);
                const missing = [...allDeps].filter(d => !externalDeps.has(d));
                if (missing.length > 0) {
                    warnings.push(`${id} 缺少其他合并目标的外部依赖: ${missing.join(', ')}，合并后需确认`);
                }
            }
            break;
        }
        case 'split': {
            for (const id of targetIds) {
                const downstream = graph.getDirectDownstream(id);
                if (downstream.length === 0) {
                    warnings.push(`${id} 没有下游任务，拆分后需手动建立新依赖关系`);
                }
            }
            break;
        }
    }
    return {
        safe: warnings.length === 0,
        warnings,
    };
}
