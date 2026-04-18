import prompts from 'prompts';
import * as fs from 'fs';
import {
  readPlan,
  getOrCreatePlan,
  writePlan,
  addTaskToPlan,
  removeTaskFromPlan,
  clearPlan,
  areDependenciesCompleted,
  getExecutableTasks,
  detectMissingSubtasks,
} from '../utils/plan';
import { isInitialized, getProjectDir } from '../utils/path';
import { readTaskMeta, getAllTasks, taskExists, getSubtasks } from '../utils/task';
import { normalizeStatus } from '../types/task';
import type { TaskMeta, TaskPriority } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { createLogger, type InstrumentationRecord } from '../utils/logger';
import { extractAffectedFiles } from '../utils/quality-gate';
import { runQualityGate, type QualityGateValidationResult } from '../utils/quality-gate-registry';
import { classifyFileToLayer, AIMetadataAssistant, type ArchitectureLayer } from '../utils/ai-metadata';
import { withAIEnhancement } from '../utils/ai-helpers';
import { inferDependenciesBatch, type InferredDependency } from '../utils/dependency-engine';
import { detectActiveSnapshot } from '../utils/harness-snapshot.js';
import { topologicalSortDFS, findComponentsUnionFind, DependencyGraph, validatePlanOperation, type EdgeMeta, type GraphNode } from '../utils/dependency-graph';

// Re-export InferredDependency for backward compatibility
export type { InferredDependency };

// ============== Plan Quality Gate Types ==============

/**
 * Plan 质量门禁检查结果
 */
export interface PlanQualityGateCheckResult {
  /** 是否通过所有检查 */
  passed: boolean;
  /** 总任务数 */
  totalTasks: number;
  /** 通过的任务数 */
  passedCount: number;
  /** 未通过的任务数 */
  failedCount: number;
  /** 未通过的任务ID列表 */
  failedTasks: string[];
  /** 详细验证结果 */
  validationResults: QualityGateValidationResult[];
  /** 验证时间戳 */
  validatedAt: string;
}

/**
 * Plan 质量门禁报告选项
 */
export interface PlanQualityGateReportOptions {
  /** 是否紧凑输出 */
  compact?: boolean;
  /** 是否显示详细结果 */
  showDetails?: boolean;
  /** 验证阶段 */
  phase?: string;
}

// ============== 任务链分析类型定义 ==============

export interface TaskChain {
  chainId: string;           // 链 ID（链首任务 ID）
  tasks: TaskMeta[];         // 链中所有任务（按依赖顺序）
  length: number;            // 链长度
  totalReopenCount: number;  // 链中任务总 reopen 次数
  maxPriority: number;       // 链中最高优先级（数字越小越紧急）
  minLayer: ArchitectureLayer; // 链中最低架构层级（基础层）
  minLayerValue: number;     // 层级数值（用于排序，0=Layer0最基础）
  keywords: string[];        // 链涉及的关键字
  /** 推断依赖（通过文件重叠检测），taskId -> 推断信息列表 */
  inferredDependencies?: Map<string, InferredDependency[]>;
}

/**
 * 执行批次：同优先级的任务链归入同一批次
 */
export interface ExecutionBatch {
  batchId: string;            // 批次 ID（如 "batch-P0"）
  priority: string;           // 批次优先级标签（如 "P0", "P1"）
  priorityValue: number;      // 优先级数值（用于排序）
  chains: string[];           // 批次包含的链 ID
  tasks: string[];            // 批次包含的任务 ID（按链内拓扑序）
  parallelizable: boolean;    // 同批次内的不同链是否可并行执行
}

/**
 * AI 友好的推荐结果
 */
interface AIRecommendationOutput {
  /** 子任务缺失告警（仅在有缺失时出现） */
  missingSubtaskWarnings?: Array<{
    parentTaskId: string;
    parentTitle: string;
    missingSubtaskIds: string[];
    expectedCount: number;
    actualCount: number;
  }>;

  query?: string;            // 用户查询（如有）
  keywords?: string[];       // 提取的关键字（如有）
  filterStats: {
    totalTasks: number;
    filteredTasks: number;
    chainCount: number;
  };
  chains: Array<{
    chainId: string;
    length: number;
    totalReopenCount: number;
    maxPriority: string;
    minLayer: string;
    keywords: string[];
    tasks: Array<{
      order: number;
      id: string;
      title: string;
      priority: string;
      status: string;
      reopenCount: number;
      layer: string;
      dependencies: string[];
      inferredDependencies?: Array<{
        depTaskId: string;
        overlappingFiles: string[];
        source: 'file-overlap' | 'ai-semantic' | 'keyword';
        reason?: string;
      }>;
    }>;
  }>;
  batches: Array<{
    batchId: string;
    priority: string;
    chains: string[];
    tasks: string[];
    parallelizable: boolean;
    parallelBlockedBy?: string;
  }>;
  batchOrder: string[][];  // 按批次排列的任务ID二维数组
  recommendation: {
    summary: string;
    topChains: string[];
    suggestedOrder: string[];
  };
}

// ============== 查询解析与过滤 ==============

// 停用词
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '有', '我', '要', '想', '把', '这', '那',
  '对', '就', '也', '都', '会', '能', '可', '上', '下', '中', '来', '去',
  '做', '给', '让', '被', '用', '为', '与', '或', '但', '如', '到', '从',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'want',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'which',
]);

/**
 * 查询过滤器类型
 */
type QueryFilter =
  | { type: 'keywords'; keywords: string[] }
  | { type: 'regex'; pattern: string; flags?: string };

/**
 * 检测查询是否为正则表达式模式
 * 识别常见正则元字符: . * + ? ^ $ | [ ] { } ( ) \\ 等
 */
function isRegexPattern(query: string): boolean {
  // 正则元字符检测模式
  const regexMetaChars = /[.*+?^${}()|\[\]]/;

  // 检查是否包含正则元字符
  if (!regexMetaChars.test(query)) {
    return false;
  }

  // 如果查询以 /.../flags 格式出现，确定是正则
  if (/^\/.*\/[gimsuy]*$/.test(query)) {
    return true;
  }

  // 检查是否有足够的正则特征（不只是偶然的标点）
  // 例如: .* .+ [] () {} ^ $ | 等组合
  const regexPatterns = [
    /\..*[+*?]/,        // .* .+ .?
    /\[.*\]/,           // [...]
    /\(.*\)/,           // (...)
    /\{.*\}/,           // {...}
    /\^|\$/,            // 行首行尾
    /\|/,               // 或操作符
    /\\[dDsSwW]/,       // 字符类转义
    /\\[bB]/,           // 单词边界
  ];

  return regexPatterns.some(pattern => pattern.test(query));
}

/**
 * 解析查询字符串，返回 QueryFilter
 */
function parseQuery(query: string): QueryFilter {
  // 清理查询字符串
  const trimmed = query.trim();

  // 检查是否为正则模式
  if (!isRegexPattern(trimmed)) {
    // 关键字模式：分词并过滤停用词
    const words = trimmed
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));

    return { type: 'keywords', keywords: [...new Set(words)] };
  }

  // 尝试解析 /pattern/flags 格式
  const slashPattern = /^\/(.*)\/([gimsuy]*)$/;
  const match = trimmed.match(slashPattern);

  if (match) {
    const [, pattern, flags] = match;
    // 验证正则有效性
    try {
      new RegExp(pattern, flags);
      return { type: 'regex', pattern, flags: flags || undefined };
    } catch (e) {
      // 无效正则，回退到关键字匹配
      console.warn(`⚠️  无效的正则表达式 "${pattern}"，回退到关键字匹配`);
      const words = trimmed
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
      return { type: 'keywords', keywords: [...new Set(words)] };
    }
  }

  // 无斜杠格式的正则，尝试直接解析为正则
  try {
    // 尝试用空字符串作为标志验证
    new RegExp(trimmed);
    return { type: 'regex', pattern: trimmed };
  } catch (e) {
    // 无效正则，回退到关键字匹配
    console.warn(`⚠️  无效的正则表达式 "${trimmed}"，回退到关键字匹配`);
    const words = trimmed
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
    return { type: 'keywords', keywords: [...new Set(words)] };
  }
}

/**
 * 构建任务搜索文本
 */
function buildTaskSearchText(task: TaskMeta): string {
  return [
    task.id,
    task.title,
    task.description || '',
    task.type,
    task.recommendedRole || '',
    ...task.dependencies,
  ].join(' ').toLowerCase();
}

/**
 * 统一任务匹配函数
 * 支持关键字匹配和正则匹配两种模式
 */
function taskMatchesFilter(task: TaskMeta, filter: QueryFilter): boolean {
  const searchText = buildTaskSearchText(task);

  if (filter.type === 'keywords') {
    if (filter.keywords.length === 0) return true;
    // 至少匹配一个关键字
    return filter.keywords.some(kw => searchText.includes(kw.toLowerCase()));
  }

  if (filter.type === 'regex') {
    try {
      const regex = new RegExp(filter.pattern, filter.flags || 'i');
      return regex.test(searchText);
    } catch (e) {
      // 如果正则执行失败，打印警告但不崩溃
      console.warn(`⚠️  正则执行失败: ${filter.pattern}，跳过此过滤`);
      return true; // 匹配所有（不过滤）
    }
  }

  return true;
}

/**
 * 从用户描述中提取关键字（向后兼容）
 * @deprecated 使用 parseQuery + taskMatchesFilter 替代
 */
function extractKeywords(description: string): string[] {
  const filter = parseQuery(description);
  if (filter.type === 'keywords') {
    return filter.keywords;
  }
  // 如果是正则模式，提取可能的字面量关键字
  return description
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * 检查任务是否匹配关键字（向后兼容）
 * @deprecated 使用 taskMatchesFilter 替代
 */
function taskMatchesKeywords(task: TaskMeta, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const searchText = buildTaskSearchText(task);
  return keywords.some(kw => searchText.includes(kw.toLowerCase()));
}

// ============== 文件重叠依赖推断 ==============

/**
 * @deprecated Use inferDependenciesBatch from '../utils/dependency-engine' instead (IR-08-03)
 */
export const inferDependenciesFromFiles = inferDependenciesBatch;

// ============== 架构层级推断 ==============

/**
 * 根据任务涉及文件推断架构层级
 * 使用任务关联文件中最低（最基础）的层级作为该任务的层级
 * Layer0(类型定义) → Layer3(命令入口)，基础层优先执行
 */
export function inferArchitectureLayer(task: TaskMeta): { layer: ArchitectureLayer; layerValue: number } {
  const files = extractAffectedFiles(task);
  const layerOrder: Record<ArchitectureLayer, number> = { Layer0: 0, Layer1: 1, Layer2: 2, Layer3: 3 };

  if (files.length === 0) {
    // 无文件信息时从任务描述推断
    const desc = `${task.title} ${task.description || ''}`.toLowerCase();
    if (desc.includes('类型') || desc.includes('type') || desc.includes('接口') || desc.includes('interface')) {
      return { layer: 'Layer0', layerValue: 0 };
    }
    if (desc.includes('命令') || desc.includes('command') || desc.includes('cli')) {
      return { layer: 'Layer3', layerValue: 3 };
    }
    return { layer: 'Layer1', layerValue: 1 };
  }

  // 取所有文件中最低层级（最基础的依赖层）
  let minValue = 3;
  for (const file of files) {
    const fileLayer = classifyFileToLayer(file);
    const value = layerOrder[fileLayer];
    if (value < minValue) {
      minValue = value;
    }
  }

  const layers: ArchitectureLayer[] = ['Layer0', 'Layer1', 'Layer2', 'Layer3'];
  return { layer: layers[minValue]!, layerValue: minValue };
}

// ============== 任务链分析 ==============

/**
 * 构建任务依赖图并识别任务链
 * 合并显式依赖 (task.dependencies) 与推断依赖 (文件重叠)
 */
export function buildTaskChains(
  tasks: TaskMeta[],
  cwd: string,
  precomputedDeps?: Map<string, InferredDependency[]>
): TaskChain[] {
  if (tasks.length === 0) return [];

  const taskMap = new Map<string, TaskMeta>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // 使用预计算依赖或重新推断文件重叠依赖
  const inferredDeps = precomputedDeps || inferDependenciesBatch(tasks);

  // 构建合并邻接表（显式 + 推断依赖）和节点映射，供 dependency-graph 模块使用
  const taskIds = new Set(tasks.map(t => t.id));
  const adjacency = new Map<string, Map<string, EdgeMeta>>();
  const nodesMap = new Map<string, GraphNode>();

  for (const task of tasks) {
    nodesMap.set(task.id, {
      taskId: task.id,
      status: task.status,
      priority: task.priority,
      title: task.title,
      type: task.type,
    });

    const deps = new Map<string, EdgeMeta>();
    // 显式依赖
    for (const depId of task.dependencies) {
      if (taskIds.has(depId)) {
        deps.set(depId, { source: 'explicit', confidence: 1.0 });
      }
    }
    // 推断依赖（去重：不覆盖已有的显式依赖）
    const inferred = inferredDeps.get(task.id);
    if (inferred) {
      for (const d of inferred) {
        if (taskIds.has(d.depTaskId) && !deps.has(d.depTaskId)) {
          deps.set(d.depTaskId, { source: d.source, confidence: 0.5 });
        }
      }
    }
    adjacency.set(task.id, deps);
  }

  // 使用 dependency-graph 模块的 findComponentsUnionFind 替代内联 Union-Find
  const components = findComponentsUnionFind(adjacency, nodesMap);

  // 为每个连通分量构建链（拓扑排序）
  const chains: TaskChain[] = [];

  for (const component of components) {
    // 提取分量内的邻接表，用于拓扑排序
    const componentNodeIds = new Set(component.nodes);
    const componentAdj = new Map<string, Map<string, EdgeMeta>>();
    for (const nodeId of component.nodes) {
      const allDeps = adjacency.get(nodeId);
      const filtered = new Map<string, EdgeMeta>();
      if (allDeps) {
        for (const [depId, meta] of allDeps) {
          if (componentNodeIds.has(depId)) {
            filtered.set(depId, meta);
          }
        }
      }
      componentAdj.set(nodeId, filtered);
    }

    // 使用 dependency-graph 模块的 topologicalSortDFS 进行拓扑排序
    const topoResult = topologicalSortDFS(componentAdj, componentNodeIds);
    const chainTasks = topoResult.order.map(id => taskMap.get(id)!).filter(Boolean);

    const totalReopenCount = chainTasks.reduce(
      (sum, t) => sum + (t.reopenCount || 0),
      0
    );

    const priorityOrder: Record<TaskPriority, number> = {
      P0: 0, P1: 1, P2: 2, P3: 3,
      Q1: 4, Q2: 5, Q3: 6, Q4: 7,
    };
    const maxPriority = Math.min(
      ...chainTasks.map(t => priorityOrder[t.priority] ?? 2)
    );

    const keywords = extractKeywords(
      chainTasks.map(t => `${t.title} ${t.description || ''}`).join(' ')
    );

    const chainLayers = chainTasks.map(t => inferArchitectureLayer(t));
    const minLayerValue = Math.min(...chainLayers.map(cl => cl.layerValue));
    const layerOrder: ArchitectureLayer[] = ['Layer0', 'Layer1', 'Layer2', 'Layer3'];
    const minLayer = layerOrder[minLayerValue]!;

    chains.push({
      chainId: chainTasks[0]!.id,
      tasks: chainTasks,
      length: chainTasks.length,
      totalReopenCount,
      maxPriority,
      minLayer,
      minLayerValue,
      keywords,
      inferredDependencies: inferredDeps,
    });
  }

  return chains;
}

/**
 * 对任务链进行排序
 * 排序优先级：1. 优先级（升序，数字越小越紧急） 2. 链长度（降序） 3. reopen 次数（降序）
 */
export function sortChains(chains: TaskChain[]): TaskChain[] {
  return [...chains].sort((a, b) => {
    // 1. 优先级升序（数字越小越紧急，优先执行）
    if (a.maxPriority !== b.maxPriority) {
      return a.maxPriority - b.maxPriority;
    }
    // 2. 架构层级升序（同优先级下，Layer0 基础层优先于 Layer3 入口层）
    if (a.minLayerValue !== b.minLayerValue) {
      return a.minLayerValue - b.minLayerValue;
    }
    // 3. 链长度降序（同层级下长链优先）
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    // 4. reopen 次数降序
    return b.totalReopenCount - a.totalReopenCount;
  });
}

/**
 * 按优先级分桶构建执行批次
 * 同一优先级桶内的不同链标记为可并行
 */
export function buildBatches(sortedChains: TaskChain[]): ExecutionBatch[] {
  const priorityNames: Record<number, string> = {
    0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3',
    4: 'Q1', 5: 'Q2', 6: 'Q3', 7: 'Q4',
  };

  // 按优先级分桶
  const buckets = new Map<number, TaskChain[]>();
  for (const chain of sortedChains) {
    const existing = buckets.get(chain.maxPriority);
    if (existing) {
      existing.push(chain);
    } else {
      buckets.set(chain.maxPriority, [chain]);
    }
  }

  // 按优先级排序桶
  const sortedPriorities = [...buckets.keys()].sort((a, b) => a - b);

  const batches: ExecutionBatch[] = [];
  for (const priority of sortedPriorities) {
    const chainsInBucket = buckets.get(priority)!;
    const allTasks: string[] = [];
    const chainIds: string[] = [];

    // 收集本桶内所有任务ID集合
    const bucketTaskIds = new Set<string>();
    for (const chain of chainsInBucket) {
      for (const task of chain.tasks) {
        bucketTaskIds.add(task.id);
      }
    }

    // 检查是否有跨链的推断依赖（桶内不同链的任务间有文件重叠）
    let hasCrossChainInferredDep = false;
    for (const chain of chainsInBucket) {
      if (hasCrossChainInferredDep) break;
      const inferredDeps = chain.inferredDependencies;
      if (!inferredDeps) continue;

      // 查找本链任务是否推断依赖了其他链中的任务
      for (const task of chain.tasks) {
        if (hasCrossChainInferredDep) break;
        const deps = inferredDeps.get(task.id);
        if (!deps) continue;
        // 检查被依赖的任务是否在其他链中（即也在桶内但不与本任务同链）
        const myChainTaskIds = new Set(chain.tasks.map(t => t.id));
        for (const dep of deps) {
          if (bucketTaskIds.has(dep.depTaskId) && !myChainTaskIds.has(dep.depTaskId)) {
            hasCrossChainInferredDep = true;
            break;
          }
        }
      }
    }

    for (const chain of chainsInBucket) {
      chainIds.push(chain.chainId);
      for (const task of chain.tasks) {
        if (!allTasks.includes(task.id)) {
          allTasks.push(task.id);
        }
      }
    }

    // parallelizable: 只有多个链且无跨链推断依赖时才为 true
    const parallelizable = chainsInBucket.length > 1 && !hasCrossChainInferredDep;

    batches.push({
      batchId: `batch-${priorityNames[priority] || `L${priority}`}`,
      priority: priorityNames[priority] || `L${priority}`,
      priorityValue: priority,
      chains: chainIds,
      tasks: allTasks,
      parallelizable,
    });
  }

  return batches;
}

/**
 * 生成 AI 友好的输出
 */
function generateAIOutput(
  chains: TaskChain[],
  originalCount: number,
  filteredCount: number,
  batches: ExecutionBatch[],
  query?: string,
  keywords?: string[],
  genOptions?: { smart?: boolean },
  subtaskWarnings?: Array<{ parentTaskId: string; parentTitle: string; missingSubtaskIds: string[]; expectedCount: number; actualCount: number }>
): AIRecommendationOutput {
  const priorityNames: Record<number, string> = {
    0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3',
    4: 'Q1', 5: 'Q2', 6: 'Q3', 7: 'Q4',
  };

  // 构建建议执行顺序（按链分组，链内按依赖顺序）
  const suggestedOrder: string[] = [];
  const topChains: string[] = [];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    topChains.push(chain.chainId);
    for (const task of chain.tasks) {
      if (!suggestedOrder.includes(task.id)) {
        suggestedOrder.push(task.id);
      }
    }
  }

  // CP-3: 使用传入的缓存批次（不再重复计算）
  const batchOrder = batches.map(b => b.tasks);

  return {
    missingSubtaskWarnings: subtaskWarnings && subtaskWarnings.length > 0 ? subtaskWarnings : undefined,
    query,
    keywords,
    filterStats: {
      totalTasks: originalCount,
      filteredTasks: filteredCount,
      chainCount: chains.length,
    },
    chains: chains.map(chain => ({
      chainId: chain.chainId,
      length: chain.length,
      totalReopenCount: chain.totalReopenCount,
      maxPriority: priorityNames[chain.maxPriority] || 'P2',
      minLayer: chain.minLayer,
      keywords: chain.keywords.slice(0, 10),
      tasks: chain.tasks.map((task, idx) => {
        const taskLayerInfo = inferArchitectureLayer(task);
        const taskEntry: AIRecommendationOutput['chains'][number]['tasks'][number] = {
          order: idx + 1,
          id: task.id,
          title: task.title,
          priority: task.priority,
          status: task.status,
          reopenCount: task.reopenCount || 0,
          layer: taskLayerInfo.layer,
          dependencies: task.dependencies,
        };
        // 添加推断依赖信息
        const inferred = chain.inferredDependencies?.get(task.id);
        if (inferred && inferred.length > 0) {
          taskEntry.inferredDependencies = inferred.map(d => ({
            depTaskId: d.depTaskId,
            overlappingFiles: d.overlappingFiles,
            source: d.source,
            reason: d.reason,
          }));
        }
        return taskEntry;
      }),
    })),
    batches: batches.map(b => {
      const batchEntry: AIRecommendationOutput['batches'][number] = {
        batchId: b.batchId,
        priority: b.priority,
        chains: b.chains,
        tasks: b.tasks,
        parallelizable: b.parallelizable,
      };
      if (!b.parallelizable && b.chains.length > 1) {
        batchEntry.parallelBlockedBy = '推断依赖: 文件重叠/AI语义';
      }
      return batchEntry;
    }),
    batchOrder,
    recommendation: {
      summary: `发现 ${chains.length} 个任务链，共 ${filteredCount} 个任务，分 ${batches.length} 个批次。三层依赖推断: Layer1/2 文件路径重叠 + ${genOptions?.smart ? 'Layer3 AI语义推断(已启用)' : 'Layer3 AI语义推断(未启用, --smart 激活)'}。同优先级内已按架构层级排序（Layer0→Layer3）`,
      topChains,
      suggestedOrder,
    },
  };
}

/**
 * 显示执行计划
 */
export function showPlan(json: boolean = false, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const plan = readPlan(cwd);

  if (!plan || plan.tasks.length === 0) {
    console.log('暂无执行计划');
    console.log('');
    console.log('使用 `projmnt4claude plan recommend` 生成推荐计划');
    return;
  }

  if (json) {
    // JSON 格式输出
    const tasks = plan.tasks.map((taskId, index) => {
      const task = readTaskMeta(taskId, cwd);
      return {
        order: index + 1,
        id: taskId,
        title: task?.title || '(未知任务)',
        status: task?.status || 'unknown',
      };
    });

    console.log(JSON.stringify({ ...plan, taskDetails: tasks }, null, 2));
    return;
  }

  // 表格格式输出
  console.log('');
  console.log('执行计划:');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('序号 | 任务ID    | 标题                         | 状态');
  console.log('-----|-----------|------------------------------|------------');

  for (let i = 0; i < plan.tasks.length; i++) {
    const taskId = plan.tasks[i]!;
    const task = readTaskMeta(taskId, cwd);

    const order = String(i + 1).padEnd(4);
    const id = taskId.padEnd(9);
    const title = (task?.title || '(未知任务)').substring(0, 28).padEnd(28);
    const status = task ? formatStatus(task.status) : '❓ 未知';

    console.log(`${order} | ${id} | ${title} | ${status}`);
  }

  console.log('');
  console.log(`共 ${plan.tasks.length} 个任务`);
  console.log(`创建时间: ${plan.createdAt}`);
  console.log(`更新时间: ${plan.updatedAt}`);
}

/**
 * 添加任务到计划
 */
export function addTask(taskId: string, afterId?: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 检查任务是否存在
  if (!taskExists(taskId, cwd)) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  if (afterId && !taskExists(afterId, cwd)) {
    console.error(`错误: 参考任务 '${afterId}' 不存在`);
    process.exit(1);
  }

  const success = addTaskToPlan(taskId, afterId, cwd);

  if (success) {
    console.log(`✅ 已添加任务 ${taskId} 到执行计划${afterId ? ` (在 ${afterId} 之后)` : ''}`);
  } else {
    console.log(`任务 ${taskId} 已在执行计划中`);
  }
}

/**
 * 从计划移除任务
 */
export function removeTask(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // CP-16: 删除前依赖关系检查
  const allTasks = getAllTasks(cwd);
  const depGraph = DependencyGraph.fromTasks(allTasks);
  const opValidation = validatePlanOperation('delete', [taskId], depGraph);
  if (opValidation.warnings.length > 0) {
    console.log('📋 删除前依赖检查:');
    for (const w of opValidation.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
  }

  const success = removeTaskFromPlan(taskId, cwd);

  if (success) {
    console.log(`✅ 已从执行计划移除任务 ${taskId}`);
  } else {
    console.log(`任务 ${taskId} 不在执行计划中`);
  }
}

/**
 * 清空计划
 */
export async function clearPlanCmd(force: boolean = false, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!force) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '确定要清空执行计划吗？',
      initial: false,
    });

    if (!response.confirm) {
      console.log('已取消');
      return;
    }
  }

  clearPlan(cwd);
  console.log('✅ 执行计划已清空');
}

/**
 * 推荐执行计划（增强版）
 * 支持关键字过滤、任务链分析、AI 友好的 JSON 输出
 *
 * @param options.query - 可选的用户描述/查询，用于关键字过滤
 * @param options.nonInteractive - 非交互模式
 * @param options.json - JSON 格式输出
 */
export async function recommendPlan(
  options: { query?: string; nonInteractive?: boolean; json?: boolean; all?: boolean; smart?: boolean; strictSubtaskCoverage?: boolean; requireQuality?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // CP-1: 检测活跃流水线，防止在流水线执行期间修改计划
  const activeCheck = detectActiveSnapshot(cwd);
  if (activeCheck.hasActive) {
    console.error('❌ 错误: 检测到正在运行的流水线');
    console.error(`   ${activeCheck.message}`);
    console.error('   请等待流水线完成或使用 `projmnt4claude harness --continue` 恢复');
    console.error('   如需强制创建新计划，请先停止正在运行的流水线进程');
    process.exit(1);
  }

  console.log('正在分析项目任务...\n');

  // CP-4: 模块日志 + 埋点初始化
  const logger = createLogger('plan-recommend', cwd);
  const startTime = Date.now();
  const inputQuery = options.query || '';
  let recommendationAccepted = false;
  let suggestedOrder: string[] = [];

  // 获取所有任务（不仅仅是可执行的，用于构建完整的依赖图）
  const allTasks = getAllTasks(cwd);

  // CP-2: 质量检测规则 - failed 任务重试确认
  const failedTasks = allTasks.filter(t => normalizeStatus(t.status) === 'failed');
  if (failedTasks.length > 0) {
    console.log('⚠️  质量检测: 发现以下 failed 状态任务:');
    for (const task of failedTasks) {
      console.log(`   ❌ ${task.id}: ${task.title.substring(0, 50)}`);
    }
    console.log('');
    console.log('💡 约束提示:');
    console.log('   • 如需重试 failed 任务，请先查看失败原因并修复');
    console.log('   • 使用 `projmnt4claude task update <id> --status open` 重置状态后重试');
    console.log('   • 或在 `plan recommend` 后手动将 failed 任务加入计划');
    console.log('');

    // 非交互模式下直接提示，但不阻止执行
    if (options.nonInteractive || !process.stdout.isTTY) {
      console.log('   (非交互模式: 继续执行，但请注意上述 failed 任务)');
      console.log('');
    }
  }

  // CP-4: 分离 in_progress 任务，单独展示
  const inProgressTasks = allTasks.filter(t => normalizeStatus(t.status) === 'in_progress');

  // 0. 过滤任务（默认只推荐 open 状态，--all 排除终态）
  // CP-9: 使用 normalizeStatus 确保状态比较标准化
  const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'abandoned', 'failed']);
  const activeTasks = options.all
    ? allTasks.filter(t => !TERMINAL_STATUSES.has(normalizeStatus(t.status)))
    : allTasks.filter(t => normalizeStatus(t.status) === 'open');

  const excludedCount = allTasks.length - activeTasks.length;
  if (excludedCount > 0) {
    const reason = options.all ? '终态(resolved/closed/abandoned)' : '非 open 状态';
    console.log(`已排除 ${excludedCount} 个${reason}任务`);
  }

  // CP-8: 展示进行中的任务（特殊标识）
  if (inProgressTasks.length > 0) {
    console.log('🔵 进行中的任务:');
    for (const t of inProgressTasks) {
      console.log(`   ${t.id}: ${t.title.substring(0, 60)}`);
    }
    console.log('');
  }

  // 排除 in_progress 任务，避免放入依赖链中造成混淆
  const chainEligibleTasks = activeTasks.filter(t => normalizeStatus(t.status) !== 'in_progress');

  // 子任务缺失检测（始终运行，--strict-subtask-coverage 时作为错误级别）
  const missingSubtaskWarnings = detectMissingSubtasks(cwd);
  if (missingSubtaskWarnings.length > 0) {
    const label = options.strictSubtaskCoverage ? '❌ ERR' : '⚠️  WARN';
    console.log(`${label} 子任务缺失检测 (${missingSubtaskWarnings.length} 个父任务受影响):`);
    for (const w of missingSubtaskWarnings) {
      console.log(`   ${label} 父任务 ${w.parentTaskId} ("${w.parentTitle.substring(0, 30)}"): 缺失 ${w.missingSubtaskIds.length}/${w.expectedCount} 个子任务`);
      for (const missingId of w.missingSubtaskIds) {
        console.log(`      - ${missingId} 不存在`);
      }
    }
    console.log('');

    if (options.strictSubtaskCoverage) {
      console.error('❌ --strict-subtask-coverage: 检测到缺失子任务，中止推荐。请先创建缺失的子任务或清理无效的 subtaskIds。');
      process.exit(1);
    }
  }

  // 1. 查询过滤（支持关键字和正则表达式）
  let filter: QueryFilter = { type: 'keywords', keywords: [] };
  let filteredTasks = chainEligibleTasks;

  if (options.query) {
    filter = parseQuery(options.query);

    if (filter.type === 'regex') {
      console.log(`正则模式: /${filter.pattern}/${filter.flags || ''}`);
    } else {
      console.log(`关键字: ${filter.keywords.join(', ')}`);
    }

    filteredTasks = chainEligibleTasks.filter(task => taskMatchesFilter(task, filter));
    console.log(`过滤结果: ${filteredTasks.length}/${chainEligibleTasks.length} 个任务匹配\n`);
  }

  // Bug1 fix: --all 模式跳过依赖过滤，显示全部任务
  if (!options.all) {
    const executableIds = new Set(getExecutableTasks(cwd));
    const beforeExecFilter = filteredTasks.length;
    filteredTasks = filteredTasks.filter(task => executableIds.has(task.id));
    if (beforeExecFilter - filteredTasks.length > 0) {
      console.log(`已排除 ${beforeExecFilter - filteredTasks.length} 个依赖未完成或不可执行的任务`);
    }
  }

  // ========== 质量门禁检查 (plan_recommend 阶段) - QG-PLAN-005 ==========
  // CP-1: --all 模式也执行质量门禁检查
  if (options.requireQuality !== false && filteredTasks.length > 0) {
    console.log('正在执行质量门禁检查...');

    // 使用新的 runPlanQualityGateCheck 函数执行质量门禁检查
    const qualityGateResult = runPlanQualityGateCheck(filteredTasks, {
      phase: 'plan_recommend',
      includeWarnings: true,
    });

    // 使用 formatPlanQualityGateReport 格式化输出报告
    if (!qualityGateResult.passed) {
      console.log(formatPlanQualityGateReport(qualityGateResult, {
        compact: false,
        showDetails: true,
        phase: 'plan_recommend',
      }));

      // 非交互模式下直接退出
      if (options.nonInteractive || !process.stdout.isTTY) {
        console.error('❌ 质量门禁检查未通过，中止计划推荐');
        console.error(`   未通过任务: ${qualityGateResult.failedTasks.join(', ')}`);
        console.error('   使用 --no-quality-gate 跳过质量检查（不推荐）');
        process.exit(1);
      }

      // 交互模式下询问用户
      const { continueAnyway } = await prompts({
        type: 'confirm',
        name: 'continueAnyway',
        message: `${qualityGateResult.failedCount} 个任务未通过质量门禁，是否继续？`,
        initial: false,
      });

      if (!continueAnyway) {
        console.log('已取消');
        return;
      }
      console.log('');
    } else {
      // 检查通过，显示简洁的成功消息
      console.log(`✅ 质量门禁检查通过 (${qualityGateResult.passedCount}/${qualityGateResult.totalTasks})`);
      console.log('');
    }
  }
  // ========== 质量门禁检查结束 ==========

  if (filteredTasks.length === 0) {
    const emptyResult = {
      missingSubtaskWarnings: missingSubtaskWarnings.length > 0 ? missingSubtaskWarnings : undefined,
      query: options.query,
      keywords: filter.type === 'keywords' ? filter.keywords : [filter.pattern],
      filterStats: {
        totalTasks: activeTasks.length,
        filteredTasks: 0,
        chainCount: 0,
      },
      chains: [],
      batches: [],
      batchOrder: [],
      recommendation: {
        summary: '没有匹配的任务',
        topChains: [],
        suggestedOrder: [],
      },
    };

    if (options.json) {
      console.log(JSON.stringify(emptyResult, null, 2));
    } else {
      console.log('没有匹配的任务');
      if (options.query) {
        console.log(`查询: "${options.query}"`);
        const displayKeywords = filter.type === 'keywords' ? filter.keywords : [filter.pattern];
        console.log(`关键字: ${displayKeywords.join(', ')}`);
      }
    }
    // CP-10: 空结果埋点
    const logKeywords = filter.type === 'keywords' ? filter.keywords : [filter.pattern];
    logger.logInstrumentation({
      module: 'plan-recommend',
      action: 'recommend_empty',
      input_summary: `query="${inputQuery}", all=${options.all || false}`,
      output_summary: `no_match, active=${activeTasks.length}, filtered=0`,
      ai_used: false,
      ai_enhanced_fields: [],
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: { keywords: logKeywords, excluded: excludedCount },
    });
    logger.flush();
    return;
  }

  // CP-1: 先推断依赖，再构建链（确保 AI 依赖影响链结构）
  console.log('正在分析任务依赖关系...');
  const fileOverlapDeps = inferDependenciesBatch(filteredTasks);

  // CP-6: --smart 时在链构建前运行 AI 语义推断，合并到依赖图
  let mergedDeps = fileOverlapDeps;
  if (options.smart) {
    console.log('正在通过 AI 分析语义依赖关系...');
    const semanticResult = await withAIEnhancement({
      enabled: true,
      aiCall: () => new AIMetadataAssistant(cwd).inferSemanticDependencies(filteredTasks, { cwd }),
      fallback: { dependencies: [], aiUsed: false },
      operationName: '语义依赖推断',
    });

    if (semanticResult.aiUsed && semanticResult.dependencies.length > 0) {
      mergedDeps = new Map(fileOverlapDeps);
      for (const aiDep of semanticResult.dependencies) {
        const existing = mergedDeps.get(aiDep.taskId) || [];
        const alreadyInferred = existing.some(e => e.depTaskId === aiDep.depTaskId);
        if (!alreadyInferred) {
          existing.push({
            depTaskId: aiDep.depTaskId,
            overlappingFiles: [],
            source: 'ai-semantic' as const,
            reason: aiDep.reason,
          });
          mergedDeps.set(aiDep.taskId, existing);
        }
      }
      console.log(`  AI 发现 ${semanticResult.dependencies.length} 条语义依赖`);
    } else {
      console.log('  AI 未发现额外语义依赖');
    }
  }

  // 构建任务链（使用合并后的依赖图）
  const chains = buildTaskChains(filteredTasks, cwd, mergedDeps);

  // 2. 按优先级↑ 链长度↓ reopen↓ 排序
  const sortedChains = sortChains(chains);

  // CP-3/CP-7: buildBatches 仅调用一次，结果缓存复用
  const cachedBatches = buildBatches(sortedChains);

  // 3. 生成 AI 友好的输出（传入缓存批次）
  const keywordsForOutput = filter.type === 'keywords'
    ? (filter.keywords.length > 0 ? filter.keywords : undefined)
    : [filter.pattern];
  const aiOutput = generateAIOutput(
    sortedChains,
    activeTasks.length,
    filteredTasks.length,
    cachedBatches,
    options.query,
    keywordsForOutput,
    { smart: options.smart },
    missingSubtaskWarnings
  );

  // JSON 格式输出（AI 友好）
  suggestedOrder = aiOutput.recommendation.suggestedOrder;
  if (options.json) {
    console.log(JSON.stringify(aiOutput, null, 2));
    // CP-10: JSON 输出埋点
    logger.logInstrumentation({
      module: 'plan-recommend',
      action: 'recommend_json',
      input_summary: `query="${inputQuery}", all=${options.all || false}`,
      output_summary: `chains=${chains.length}, tasks=${filteredTasks.length}, batches=${aiOutput.batches.length}`,
      ai_used: false,
      ai_enhanced_fields: [],
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: {
        hit_rate: filteredTasks.length / activeTasks.length,
        suggested_order: suggestedOrder.slice(0, 5),
      },
    });
    logger.flush();
    return;
  }

  // 人类可读格式输出
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 任务链分析结果（按批次分组）');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 统计摘要
  console.log('📊 统计摘要:');
  console.log(`   总任务数: ${aiOutput.filterStats.totalTasks}`);
  console.log(`   匹配任务: ${aiOutput.filterStats.filteredTasks}`);
  console.log(`   任务链数: ${aiOutput.filterStats.chainCount}`);
  console.log(`   批次数: ${aiOutput.batches.length}`);
  console.log('');

  // 按批次展示（使用缓存批次，不再重复计算）
  const batches = cachedBatches;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const batchIcon = getPriorityIcon(batch.priorityValue);
    const parallelTag = batch.parallelizable
      ? ' [可并行]'
      : batch.chains.length > 1
        ? ' [不可并行: 推断依赖]'
        : '';

    console.log(`📦 批次 ${b + 1}/${batches.length} ${batchIcon} ${batch.priority}${parallelTag}`);
    console.log(`   链数: ${batch.chains.length} | 任务数: ${batch.tasks.length}`);
    console.log('');

    // 显示批次内的链
    const chainsInBatch = sortedChains.filter(c => batch.chains.includes(c.chainId));
    for (let i = 0; i < chainsInBatch.length; i++) {
      const chain = chainsInBatch[i]!;
      const chainLabel = batch.parallelizable ? `[链${i + 1}]` : `[链]`;

      console.log(`   ${chainLabel} ${chain.chainId} (${chain.minLayer} 长度:${chain.length} Reopen:${chain.totalReopenCount})`);

      // 显示链中任务（拓扑序）
      for (let j = 0; j < chain.tasks.length; j++) {
        const task = chain.tasks[j]!;
        const prefix = j === chain.tasks.length - 1 ? '      └─' : '      ├─';
        const statusIcon = getStatusIcon(task.status);

        // 显示推断依赖标注
        const inferredDeps = chain.inferredDependencies?.get(task.id);
        let inferredTag = '';
        if (inferredDeps && inferredDeps.length > 0) {
          const fileOverlapDeps = inferredDeps.filter(d => d.source !== 'ai-semantic');
          const aiSemanticDeps = inferredDeps.filter(d => d.source === 'ai-semantic');

          if (fileOverlapDeps.length > 0) {
            const files = [...new Set(fileOverlapDeps.flatMap(d => d.overlappingFiles))].slice(0, 2);
            inferredTag = ` [推断:文件重叠] ${files.join(', ')}${fileOverlapDeps.flatMap(d => d.overlappingFiles).length > 2 ? '...' : ''}`;
          }
          if (aiSemanticDeps.length > 0) {
            const reasons = aiSemanticDeps.map(d => d.reason || '语义关联').slice(0, 2);
            inferredTag += ` [推断:AI语义] ${reasons.join('; ')}`;
          }
        }

        console.log(`${prefix} ${statusIcon} ${task.id}: ${task.title.substring(0, 40)}${inferredTag}`);
      }
      console.log('');
    }

    if (b < batches.length - 1) {
      console.log('   ─────────────────────────────────');
      console.log('');
    }
  }

  // 推荐摘要
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('💡 推荐摘要:');
  console.log(`   ${aiOutput.recommendation.summary}`);
  console.log(`   优先任务链: ${aiOutput.recommendation.topChains.slice(0, 3).join(', ')}`);
  console.log('');

  // 非交互模式或检测到非 TTY
  const isNonInteractive = options.nonInteractive || !process.stdout.isTTY;

  if (isNonInteractive) {
    const plan = getOrCreatePlan(cwd);
    plan.tasks = aiOutput.recommendation.suggestedOrder;
    plan.batches = aiOutput.batchOrder;
    writePlan(plan, cwd);
    console.log('✅ 执行计划已更新 (非交互模式)');
    // CP-10: 非交互模式埋点
    logger.logInstrumentation({
      module: 'plan-recommend',
      action: 'recommend_auto',
      input_summary: `query="${inputQuery}", all=${options.all || false}`,
      output_summary: `chains=${chains.length}, tasks=${filteredTasks.length}, accepted=true`,
      ai_used: false,
      ai_enhanced_fields: [],
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: {
        hit_rate: filteredTasks.length / activeTasks.length,
        suggested_order: aiOutput.recommendation.suggestedOrder.slice(0, 5),
      },
    });
    logger.flush();
    return;
  }

  // 交互模式：询问用户确认
  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: '是否将推荐的任务顺序写入执行计划？',
    initial: true,
  });

  if (response.confirm) {
    const plan = getOrCreatePlan(cwd);
    plan.tasks = aiOutput.recommendation.suggestedOrder;
    plan.batches = aiOutput.batchOrder;
    writePlan(plan, cwd);
    console.log('✅ 执行计划已更新');
    recommendationAccepted = true;
  } else {
    console.log('已取消');
  }

  // CP-10: 交互模式埋点（推荐命中率 + 用户跳过率 + 排序偏差）
  logger.logInstrumentation({
    module: 'plan-recommend',
    action: response.confirm ? 'recommend_accept' : 'recommend_skip',
    input_summary: `query="${inputQuery}", all=${options.all || false}`,
    output_summary: `chains=${chains.length}, tasks=${filteredTasks.length}, accepted=${response.confirm}`,
    ai_used: false,
    ai_enhanced_fields: [],
    duration_ms: Date.now() - startTime,
    user_edit_count: response.confirm ? 0 : 1,
    module_data: {
      hit_rate: filteredTasks.length / activeTasks.length,
      skip_rate: response.confirm ? 0 : 1,
      suggested_order: suggestedOrder.slice(0, 5),
      accepted: recommendationAccepted,
    },
  });
  logger.flush();
}

/**
 * 获取优先级图标
 */
function getPriorityIcon(priority: number): string {
  const icons: Record<number, string> = {
    0: '🔴', 1: '🟠', 2: '🟡', 3: '🟢',
    4: '📊', 5: '📊', 6: '📊', 7: '📊',
  };
  return icons[priority] || '⚪';
}

/**
 * 获取状态图标
 */
function getStatusIcon(status: string): string {
  const normalized = normalizeStatus(status);
  const icons: Record<string, string> = {
    open: '⬜',
    in_progress: '🔵',
    resolved: '✅',
    closed: '⚫',
    abandoned: '❌',
    failed: '❌',
  };
  return icons[normalized] || '❓';
}

/**
 * 格式化优先级
 */
function formatPriority(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    P0: '🔴 P0紧急',
    P1: '🟠 P1高',
    P2: '🟡 P2中',
    P3: '🟢 P3低',
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
  };
  return map[priority];
}

/**
 * 格式化状态
 */
function formatStatus(status: string): string {
  const normalized = normalizeStatus(status);
  const map: Record<string, string> = {
    open: '⬜ 待处理',
    in_progress: '🔵 进行中',
    resolved: '✅ 已解决',
    closed: '⚫ 已关闭',
    abandoned: '❌ 已放弃',
    failed: '❌ 已失败',
  };
  return map[normalized] || status;
}

// ============== Plan 质量门禁函数 (QG-PLAN-005) ==============

/**
 * 执行 Plan 质量门禁检查
 *
 * 对任务列表执行 plan_recommend 阶段的质量门禁验证，检查是否存在：
 * - 循环依赖
 * - 无效依赖
 * - 孤儿子任务
 * - 孤立任务（警告）
 * - 被阻塞任务（警告）
 * - 桥接节点（警告）
 * - 仅推断依赖（警告）
 *
 * @param tasks - 要验证的任务列表
 * @param options - 可选配置
 * @returns 质量门禁检查结果
 *
 * @example
 * ```typescript
 * const tasks = getAllTasks(cwd);
 * const result = runPlanQualityGateCheck(tasks);
 * if (!result.passed) {
 *   console.log('未通过任务:', result.failedTasks);
 * }
 * ```
 */
export function runPlanQualityGateCheck(
  tasks: TaskMeta[],
  options: {
    /** 验证阶段，默认 'plan_recommend' */
    phase?: 'plan_recommend' | 'initialization';
    /** 是否包含警告级别问题 */
    includeWarnings?: boolean;
  } = {}
): PlanQualityGateCheckResult {
  const phase = options.phase || 'plan_recommend';
  const includeWarnings = options.includeWarnings !== false;

  const validationResults: QualityGateValidationResult[] = [];
  let passedCount = 0;
  let failedCount = 0;
  const failedTasks: string[] = [];

  // 执行质量门禁验证
  for (const task of tasks) {
    const result = runQualityGate(task, phase);
    validationResults.push(result);

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
      failedTasks.push(task.id);
    }
  }

  // 确定是否通过（错误级别必须全部通过，警告可选）
  const hasBlockingErrors = validationResults.some(
    r => !r.passed && r.errors.length > 0
  );

  // 如果需要检查警告，则任何警告也视为未通过
  const passed = includeWarnings
    ? failedCount === 0
    : !hasBlockingErrors;

  return {
    passed,
    totalTasks: tasks.length,
    passedCount,
    failedCount,
    failedTasks,
    validationResults,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * 格式化 Plan 质量门禁报告
 *
 * 将质量门禁检查结果格式化为可读的字符串报告，支持紧凑模式和详细模式。
 *
 * @param result - 质量门禁检查结果
 * @param options - 报告选项
 * @returns 格式化后的报告字符串
 *
 * @example
 * ```typescript
 * const result = runPlanQualityGateCheck(tasks);
 * const report = formatPlanQualityGateReport(result, { showDetails: true });
 * console.log(report);
 * ```
 */
export function formatPlanQualityGateReport(
  result: PlanQualityGateCheckResult,
  options: PlanQualityGateReportOptions = {}
): string {
  const { compact = false, showDetails = true, phase = 'plan_recommend' } = options;
  const lines: string[] = [];
  const separator = compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  const statusIcon = result.passed ? '✅' : '❌';

  lines.push('');
  lines.push(separator);
  lines.push(`${statusIcon} Plan 质量门禁检查报告 [${phase}]`);
  lines.push(separator);
  lines.push('');

  // 统计摘要
  lines.push('📊 统计摘要:');
  lines.push(`   总任务数: ${result.totalTasks}`);
  lines.push(`   ✅ 通过: ${result.passedCount}`);
  lines.push(`   ❌ 未通过: ${result.failedCount}`);
  lines.push('');

  // 未通过的任务列表
  if (result.failedTasks.length > 0) {
    lines.push(separator);
    lines.push(`❌ 未通过的任务 (${result.failedTasks.length}):`);
    lines.push('');

    if (showDetails) {
      for (const taskResult of result.validationResults) {
        if (!taskResult.passed) {
          lines.push(`   ${taskResult.taskId}:`);

          // 显示错误
          if (taskResult.errors.length > 0) {
            for (const error of taskResult.errors) {
              lines.push(`      ❌ ${error.message}`);
            }
          }

          // 显示警告
          if (taskResult.warnings.length > 0) {
            for (const warning of taskResult.warnings) {
              lines.push(`      ⚠️  ${warning.message}`);
            }
          }
          lines.push('');
        }
      }
    } else {
      // 简洁模式：只列出任务ID
      for (const taskId of result.failedTasks) {
        lines.push(`   - ${taskId}`);
      }
      lines.push('');
    }
  }

  // 验证详情
  if (showDetails && result.validationResults.length > 0) {
    const hasViolations = result.validationResults.some(
      r => r.violations.length > 0
    );

    if (hasViolations) {
      lines.push(separator);
      lines.push('📋 详细违规信息:');
      lines.push('');

      for (const taskResult of result.validationResults) {
        if (taskResult.violations.length > 0) {
          lines.push(`   ${taskResult.taskId}:`);
          for (const violation of taskResult.violations) {
            const icon = violation.severity === 'error' ? '❌' : '⚠️';
            lines.push(`      ${icon} [${violation.ruleId}] ${violation.message}`);
          }
          lines.push('');
        }
      }
    }
  }

  lines.push(separator);

  // 结论
  if (result.passed) {
    lines.push('✅ 所有任务通过 Plan 质量门禁检查！');
  } else {
    lines.push(`⚠️  ${result.failedCount} 个任务未通过质量门禁，建议修复后再执行 plan recommend`);
    lines.push('');
    lines.push('💡 修复建议:');
    lines.push('   • 检查循环依赖：确保任务依赖关系无循环');
    lines.push('   • 检查无效依赖：确保依赖的任务ID存在且有效');
    lines.push('   • 检查孤儿子任务：确保 parentId 指向的任务存在');
    lines.push('   • 使用 `projmnt4claude analyze --fix` 自动修复部分问题');
  }

  lines.push('');
  lines.push(`🕐 验证时间: ${result.validatedAt}`);
  lines.push(separator);
  lines.push('');

  return lines.join('\n');
}
