/**
 * 依赖图模块公共导出
 */
// 核心类
export { DependencyGraph } from './graph.js';
// 算法函数
export { detectCyclesDFS, wouldCreateCycleBFS, findComponentsUnionFind, topologicalSortDFS, computeTransitiveClosure, breakCycle, detectBridgeNodes, computeDepths, } from './algorithms.js';
// 依赖推断
export { inferDependencies, inferDependenciesBatch, inferredToEdgeMeta, } from './inference.js';
// 级联操作
export { computeFailureCascade, executeFailureCascade, computeUnblockingImpact, } from './cascade.js';
// 验证器
export { validateOrphan, validateNewTaskDeps, validatePlanOperation, } from './validators.js';
// 报告器
export { renderGraphOverview, renderDevelopmentFocus, renderBridgeReport, renderAnomalySummary, } from './reporters.js';
