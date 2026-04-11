/**
 * 依赖图模块类型定义
 *
 * 统一任务依赖关系的图抽象，支持 DAG 操作、异常检测和级联分析。
 */
import type { TaskStatus } from '../../types/task.js';

// ============== 图基础类型 ==============

/** 节点 ID 类型 */
export type NodeId = string;

/** 边的来源 */
export type EdgeSource = 'explicit' | 'file-overlap' | 'keyword' | 'ai-semantic';

/** 边的元数据 */
export interface EdgeMeta {
  /** 来源 */
  source: EdgeSource;
  /** 重叠文件（file-overlap 来源时） */
  overlappingFiles?: string[];
  /** 推断原因 */
  reason?: string;
  /** 置信度 0-1 */
  confidence: number;
}

/** 图中的节点 */
export interface GraphNode {
  taskId: NodeId;
  status: TaskStatus;
  priority: string;
  title: string;
  type: string;
}

// ============== 异常类型 ==============

/** 图异常类型 */
export type GraphAnomalyType =
  | 'cycle'                    // 循环依赖
  | 'orphan'                   // 孤立任务（单节点连通分量）
  | 'bridge'                   // 跨树桥接节点（信息性，非异常）
  | 'orphan_suspected'         // 疑似异常孤立（需要确认独立性）
  | 'invalid_ref'              // 无效依赖引用
  | 'redundant_dep'            // 冗余依赖（通过传递闭包可达）
  | 'missing_inferred_dep';    // 缺失推断依赖

/** 图异常 */
export interface GraphAnomaly {
  type: GraphAnomalyType;
  severity: 'info' | 'low' | 'medium' | 'high';
  nodeIds: NodeId[];
  message: string;
  suggestion: string;
  /** 环检测时的环路径 */
  cyclePath?: NodeId[];
  /** 桥接节点连接的根节点 */
  bridgedRoots?: NodeId[];
  /** 自动修复方案 */
  autoFix?: AnomalyAutoFix;
}

/** 自动修复方案 */
export interface AnomalyAutoFix {
  action: 'break_cycle' | 'remove_ref' | 'add_dep' | 'confirm_orphan' | 'remove_redundant' | 'add_inferred';
  description: string;
  /** 需要修改的边 */
  edgeChanges: Array<{ from: NodeId; to: NodeId; action: 'add' | 'remove' }>;
}

// ============== 结构类型 ==============

/** 连通分量信息 */
export interface ComponentInfo {
  componentId: NodeId;
  rootId: NodeId;
  nodes: NodeId[];
  size: number;
  depth: number;
  leafCount: number;
  bridgeNodes: NodeId[];
  topPriority: string;
  isInboundBridge: boolean;
}

/** 图统计信息 */
export interface GraphStatistics {
  totalNodes: number;
  totalEdges: number;
  totalExplicitEdges: number;
  totalInferredEdges: number;
  componentCount: number;
  rootCount: number;
  orphanCount: number;
  bridgeNodeCount: number;
  cycleCount: number;
  avgComponentSize: number;
  maxComponentSize: number;
  componentsBySize: ComponentInfo[];
  anomalySummary: Record<GraphAnomalyType, number>;
}

/** 级联操作结果 */
export interface CascadeResult {
  /** 直接受影响的节点 */
  directAffected: NodeId[];
  /** 传递受影响的节点（间接） */
  transitiveAffected: NodeId[];
  /** 每个受影响节点的详情 */
  details: Map<NodeId, {
    depth: number;
    pathFromSource: NodeId[];
    sourceTaskId: NodeId;
  }>;
}

/** 拓扑排序结果 */
export interface TopologicalOrderResult {
  /** 排序后的任务 ID 列表 */
  order: NodeId[];
  /** 分层信息（同层可并行） */
  levels: NodeId[][];
  /** 是否成功（有环时失败） */
  valid: boolean;
  /** 环路径（valid=false 时） */
  cycles?: NodeId[][];
}

// ============== 构建选项 ==============

/** 图构建选项 */
export interface GraphBuildOptions {
  /** 包含的依赖来源 */
  sources?: EdgeSource[];
  /** 是否计算传递闭包 */
  computeTransitiveClosure?: boolean;
  /** 是否检测异常 */
  detectAnomalies?: boolean;
  /** 过滤终态任务 */
  excludeTerminal?: boolean;
}
