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
import { normalizeStatus, TERMINAL_STATUSES } from '../types/task';
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
      // Invalid regex, fallback to keyword matching
      console.warn(`⚠️  Invalid regex pattern "${pattern}", falling back to keyword matching`);
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
    console.warn(`⚠️  Invalid regex pattern "${trimmed}", falling back to keyword matching`);
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
      // If regex execution fails, print warning but don't crash
      console.warn(`⚠️  Regex execution failed: ${filter.pattern}, skipping this filter`);
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
      summary: `Found ${chains.length} task chains, ${filteredCount} tasks total, divided into ${batches.length} batches. Three-layer dependency inference: Layer1/2 file path overlap + ${genOptions?.smart ? 'Layer3 AI semantic inference (enabled)' : 'Layer3 AI semantic inference (disabled, use --smart to enable)'}。Sorted by architecture layer within same priority (Layer0→Layer3)`,
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
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const plan = readPlan(cwd);

  if (!plan || plan.tasks.length === 0) {
    console.log('No execution plan');
    console.log('');
    console.log('Use `projmnt4claude plan recommend` to generate a recommended plan');
    return;
  }

  if (json) {
    // JSON 格式输出
    const tasks = plan.tasks.map((taskId, index) => {
      const task = readTaskMeta(taskId, cwd);
      return {
        order: index + 1,
        id: taskId,
        title: task?.title || '(Unknown task)',
        status: task?.status || 'unknown',
      };
    });

    console.log(JSON.stringify({ ...plan, taskDetails: tasks }, null, 2));
    return;
  }

  // Table format output
  console.log('');
  console.log('Execution Plan:');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('No.  | Task ID   | Title                        | Status');
  console.log('-----|-----------|------------------------------|------------');

  for (let i = 0; i < plan.tasks.length; i++) {
    const taskId = plan.tasks[i]!;
    const task = readTaskMeta(taskId, cwd);

    const order = String(i + 1).padEnd(4);
    const id = taskId.padEnd(9);
    const title = (task?.title || '(Unknown task)').substring(0, 28).padEnd(28);
    const status = task ? formatStatus(task.status) : '❓ Unknown';

    console.log(`${order} | ${id} | ${title} | ${status}`);
  }

  console.log('');
  console.log(`Total ${plan.tasks.length} tasks`);
  console.log(`Created: ${plan.createdAt}`);
  console.log(`Updated: ${plan.updatedAt}`);
}

/**
 * 添加任务到计划
 */
export function addTask(taskId: string, afterId?: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // Check if task exists
  if (!taskExists(taskId, cwd)) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  if (afterId && !taskExists(afterId, cwd)) {
    console.error(`Error: Reference task '${afterId}' does not exist`);
    process.exit(1);
  }

  const success = addTaskToPlan(taskId, afterId, cwd);

  if (success) {
    console.log(`✅ Added task ${taskId} to execution plan${afterId ? ` (after ${afterId})` : ''}`);
  } else {
    console.log(`Task ${taskId} is already in the execution plan`);
  }
}

/**
 * 从计划移除任务
 */
export function removeTask(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // CP-16: Pre-delete dependency check
  const allTasks = getAllTasks(cwd);
  const depGraph = DependencyGraph.fromTasks(allTasks);
  const opValidation = validatePlanOperation('delete', [taskId], depGraph);
  if (opValidation.warnings.length > 0) {
    console.log('📋 Pre-delete dependency check:');
    for (const w of opValidation.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
  }

  const success = removeTaskFromPlan(taskId, cwd);

  if (success) {
    console.log(`✅ Removed task ${taskId} from execution plan`);
  } else {
    console.log(`Task ${taskId} is not in the execution plan`);
  }
}

/**
 * 清空计划
 */
export async function clearPlanCmd(force: boolean = false, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  if (!force) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to clear the execution plan?',
      initial: false,
    });

    if (!response.confirm) {
      console.log('Cancelled');
      return;
    }
  }

  clearPlan(cwd);
  console.log('✅ Execution plan cleared');
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
  options: {
    query?: string;
    nonInteractive?: boolean;
    json?: boolean;
    all?: boolean;
    smart?: boolean;
    strictSubtaskCoverage?: boolean;
    strictQualityGate?: boolean;
    qualityThreshold?: number;
    skipQualityGate?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // CP-1: Detect active pipeline to prevent plan modification during execution
  const activeCheck = detectActiveSnapshot(cwd);
  if (activeCheck.hasActive) {
    console.error('❌ Error: Active pipeline detected');
    console.error(`   ${activeCheck.message}`);
    console.error('   Please wait for the pipeline to complete or use `projmnt4claude harness --continue` to resume');
    console.error('   To force create a new plan, stop the running pipeline process first');
    process.exit(1);
  }

  console.log('Analyzing project tasks...\n');

  // CP-4: Module logging + instrumentation initialization
  const logger = createLogger('plan-recommend', cwd);
  const startTime = Date.now();
  const inputQuery = options.query || '';
  let recommendationAccepted = false;
  let suggestedOrder: string[] = [];

  // Get all tasks (not just executable, for building complete dependency graph)
  const allTasks = getAllTasks(cwd);

  // CP-2: Quality detection rules - failed task retry confirmation
  const failedTasks = allTasks.filter(t => normalizeStatus(t.status) === 'failed');
  if (failedTasks.length > 0) {
    console.log('⚠️  Quality check: Found failed tasks:');
    for (const task of failedTasks) {
      console.log(`   ❌ ${task.id}: ${task.title.substring(0, 50)}`);
    }
    console.log('');
    console.log('💡 Constraint hints:');
    console.log('   • To retry failed tasks, check the failure reason and fix first');
    console.log('   • Use `projmnt4claude task update <id> --status open` to reset status and retry');
    console.log('   • Or manually add failed tasks to the plan after `plan recommend`');
    console.log('');

    // Non-interactive mode: show warning but don't block execution
    if (options.nonInteractive || !process.stdout.isTTY) {
      console.log('   (Non-interactive mode: continuing, but note the failed tasks above)');
      console.log('');
    }
  }

  // CP-4: Separate in_progress tasks for special display
  const inProgressTasks = allTasks.filter(t => normalizeStatus(t.status) === 'in_progress');

  // 0. Filter tasks (default: only recommend open status, --all excludes terminal states)
  // CP-9: Use normalizeStatus for standardized status comparison
  const TERMINAL_STATUSES_SET = new Set(TERMINAL_STATUSES);
  const activeTasks = options.all
    ? allTasks.filter(t => !TERMINAL_STATUSES_SET.has(normalizeStatus(t.status)))
    : allTasks.filter(t => normalizeStatus(t.status) === 'open');

  const excludedCount = allTasks.length - activeTasks.length;
  if (excludedCount > 0) {
    const reason = options.all ? 'terminal (resolved/closed/abandoned)' : 'non-open status';
    console.log(`Excluded ${excludedCount} ${reason} tasks`);
  }

  // CP-8: Display in-progress tasks (special marker)
  if (inProgressTasks.length > 0) {
    console.log('🔵 In-progress tasks:');
    for (const t of inProgressTasks) {
      console.log(`   ${t.id}: ${t.title.substring(0, 60)}`);
    }
    console.log('');
  }

  // Exclude in_progress tasks to avoid confusion in dependency chains
  const chainEligibleTasks = activeTasks.filter(t => normalizeStatus(t.status) !== 'in_progress');

  // Subtask missing detection (always run, --strict-subtask-coverage treats as error)
  const missingSubtaskWarnings = detectMissingSubtasks(cwd);
  if (missingSubtaskWarnings.length > 0) {
    const label = options.strictSubtaskCoverage ? '❌ ERR' : '⚠️  WARN';
    console.log(`${label} Subtask missing detection (${missingSubtaskWarnings.length} parent tasks affected):`);
    for (const w of missingSubtaskWarnings) {
      console.log(`   ${label} Parent task ${w.parentTaskId} ("${w.parentTitle.substring(0, 30)}"): missing ${w.missingSubtaskIds.length}/${w.expectedCount} subtasks`);
      for (const missingId of w.missingSubtaskIds) {
        console.log(`      - ${missingId} does not exist`);
      }
    }
    console.log('');

    if (options.strictSubtaskCoverage) {
      console.error('❌ --strict-subtask-coverage: Missing subtasks detected, aborting recommendation. Please create missing subtasks or clean up invalid subtaskIds.');
      process.exit(1);
    }
  }

  // 1. Query filter (supports keywords and regex)
  let filter: QueryFilter = { type: 'keywords', keywords: [] };
  let filteredTasks = chainEligibleTasks;

  if (options.query) {
    filter = parseQuery(options.query);

    if (filter.type === 'regex') {
      console.log(`Regex mode: /${filter.pattern}/${filter.flags || ''}`);
    } else {
      console.log(`Keywords: ${filter.keywords.join(', ')}`);
    }

    filteredTasks = chainEligibleTasks.filter(task => taskMatchesFilter(task, filter));
    console.log(`Filter result: ${filteredTasks.length}/${chainEligibleTasks.length} tasks match\n`);
  }

  // Bug1 fix: --all mode skips dependency filtering, shows all tasks
  if (!options.all) {
    const executableIds = new Set(getExecutableTasks(cwd));
    const beforeExecFilter = filteredTasks.length;
    filteredTasks = filteredTasks.filter(task => executableIds.has(task.id));
    if (beforeExecFilter - filteredTasks.length > 0) {
      console.log(`Excluded ${beforeExecFilter - filteredTasks.length} tasks with incomplete dependencies or not executable`);
    }
  }

  // ========== Quality Gate Check (plan_recommend phase) - QG-PLAN-005 ==========
  // CP-1: --all mode also runs quality gate check
  // CP-2: --skip-quality-gate skips quality gate check
  if (!options.skipQualityGate && filteredTasks.length > 0) {
    console.log('Running quality gate check...');

    // Use new runPlanQualityGateCheck function for quality gate check
    const qualityGateResult = runPlanQualityGateCheck(filteredTasks, {
      phase: 'plan_recommend',
      includeWarnings: true,
    });

    // Use formatPlanQualityGateReport to format output report
    if (!qualityGateResult.passed) {
      console.log(formatPlanQualityGateReport(qualityGateResult, {
        compact: false,
        showDetails: true,
        phase: 'plan_recommend',
      }));

      // CP-3: --strict-quality-gate aborts on failure (both interactive and non-interactive)
      if (options.strictQualityGate) {
        console.error('❌ Quality gate check failed (--strict-quality-gate mode), aborting plan recommendation');
        console.error(`   Failed tasks: ${qualityGateResult.failedTasks.join(', ')}`);
        console.error('   Fix the issues or use --skip-quality-gate to skip quality check (not recommended)');
        process.exit(1);
      }

      // Non-interactive mode: exit directly
      if (options.nonInteractive || !process.stdout.isTTY) {
        console.error('❌ Quality gate check failed, aborting plan recommendation');
        console.error(`   Failed tasks: ${qualityGateResult.failedTasks.join(', ')}`);
        console.error('   Use --skip-quality-gate to skip quality check (not recommended)');
        process.exit(1);
      }

      // Interactive mode: ask user
      const { continueAnyway } = await prompts({
        type: 'confirm',
        name: 'continueAnyway',
        message: `${qualityGateResult.failedCount} tasks failed quality gate, continue?`,
        initial: false,
      });

      if (!continueAnyway) {
        console.log('Cancelled');
        return;
      }
      console.log('');
    } else {
      // Check passed, show concise success message
      console.log(`✅ Quality gate check passed (${qualityGateResult.passedCount}/${qualityGateResult.totalTasks})`);
      console.log('');
    }
  }
  // ========== Quality Gate Check End ==========

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
        summary: 'No matching tasks',
        topChains: [],
        suggestedOrder: [],
      },
    };

    if (options.json) {
      console.log(JSON.stringify(emptyResult, null, 2));
    } else {
      console.log('No matching tasks');
      if (options.query) {
        console.log(`Query: "${options.query}"`);
        const displayKeywords = filter.type === 'keywords' ? filter.keywords : [filter.pattern];
        console.log(`Keywords: ${displayKeywords.join(', ')}`);
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

  // CP-1: Infer dependencies first, then build chains (ensure AI deps affect chain structure)
  console.log('Analyzing task dependencies...');
  const fileOverlapDeps = inferDependenciesBatch(filteredTasks);

  // CP-6: --smart runs AI semantic inference before chain building, merge into dep graph
  let mergedDeps = fileOverlapDeps;
  if (options.smart) {
    console.log('Analyzing semantic dependencies via AI...');
    const semanticResult = await withAIEnhancement({
      enabled: true,
      aiCall: () => new AIMetadataAssistant(cwd).inferSemanticDependencies(filteredTasks, { cwd }),
      fallback: { dependencies: [], aiUsed: false },
      operationName: 'Semantic dependency inference',
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
      console.log(`  AI found ${semanticResult.dependencies.length} semantic dependencies`);
    } else {
      console.log('  AI found no additional semantic dependencies');
    }
  }

  // 构建任务链（使用合并后的依赖图）
  const chains = buildTaskChains(filteredTasks, cwd, mergedDeps);

  // 2. Sort by priority↑, chain length↓, reopen↓
  const sortedChains = sortChains(chains);

  // CP-3/CP-7: buildBatches called once, result cached for reuse
  const cachedBatches = buildBatches(sortedChains);

  // 3. Generate AI-friendly output (pass cached batches)
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

  // JSON format output (AI-friendly)
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

  // Human-readable format output
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 Task chain analysis results (grouped by batch)');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // Statistics summary
  console.log('📊 Statistics summary:');
  console.log(`   Total tasks: ${aiOutput.filterStats.totalTasks}`);
  console.log(`   Matched tasks: ${aiOutput.filterStats.filteredTasks}`);
  console.log(`   Task chains: ${aiOutput.filterStats.chainCount}`);
  console.log(`   Batches: ${aiOutput.batches.length}`);
  console.log('');

  // Display by batch (use cached batches, no recalculation)
  const batches = cachedBatches;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const batchIcon = getPriorityIcon(batch.priorityValue);
    const parallelTag = batch.parallelizable
      ? ' [Parallel]'
      : batch.chains.length > 1
        ? ' [Not parallel: inferred deps]'
        : '';

    console.log(`📦 Batch ${b + 1}/${batches.length} ${batchIcon} ${batch.priority}${parallelTag}`);
    console.log(`   Chains: ${batch.chains.length} | Tasks: ${batch.tasks.length}`);
    console.log('');

    // Display chains in batch
    const chainsInBatch = sortedChains.filter(c => batch.chains.includes(c.chainId));
    for (let i = 0; i < chainsInBatch.length; i++) {
      const chain = chainsInBatch[i]!;
      const chainLabel = batch.parallelizable ? `[Chain${i + 1}]` : `[Chain]`;

      console.log(`   ${chainLabel} ${chain.chainId} (${chain.minLayer} Length:${chain.length} Reopen:${chain.totalReopenCount})`);

      // Display tasks in chain (topological order)
      for (let j = 0; j < chain.tasks.length; j++) {
        const task = chain.tasks[j]!;
        const prefix = j === chain.tasks.length - 1 ? '      └─' : '      ├─';
        const statusIcon = getStatusIcon(task.status);

        // Display inferred dependency annotations
        const inferredDeps = chain.inferredDependencies?.get(task.id);
        let inferredTag = '';
        if (inferredDeps && inferredDeps.length > 0) {
          const fileOverlapDeps = inferredDeps.filter(d => d.source !== 'ai-semantic');
          const aiSemanticDeps = inferredDeps.filter(d => d.source === 'ai-semantic');

          if (fileOverlapDeps.length > 0) {
            const files = [...new Set(fileOverlapDeps.flatMap(d => d.overlappingFiles))].slice(0, 2);
            inferredTag = ` [Inferred:file overlap] ${files.join(', ')}${fileOverlapDeps.flatMap(d => d.overlappingFiles).length > 2 ? '...' : ''}`;
          }
          if (aiSemanticDeps.length > 0) {
            const reasons = aiSemanticDeps.map(d => d.reason || 'Semantic relation').slice(0, 2);
            inferredTag += ` [Inferred:AI semantic] ${reasons.join('; ')}`;
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

  // Recommendation summary
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('💡 Recommendation summary:');
  console.log(`   ${aiOutput.recommendation.summary}`);
  console.log(`   Priority chains: ${aiOutput.recommendation.topChains.slice(0, 3).join(', ')}`);
  console.log('');

  // Non-interactive mode or non-TTY detected
  const isNonInteractive = options.nonInteractive || !process.stdout.isTTY;

  if (isNonInteractive) {
    const plan = getOrCreatePlan(cwd);
    plan.tasks = aiOutput.recommendation.suggestedOrder;
    plan.batches = aiOutput.batchOrder;
    writePlan(plan, cwd);
    console.log('✅ Execution plan updated (non-interactive mode)');
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

  // Interactive mode: ask user for confirmation
  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Write the recommended task order to the execution plan?',
    initial: true,
  });

  if (response.confirm) {
    const plan = getOrCreatePlan(cwd);
    plan.tasks = aiOutput.recommendation.suggestedOrder;
    plan.batches = aiOutput.batchOrder;
    writePlan(plan, cwd);
    console.log('✅ Execution plan updated');
    recommendationAccepted = true;
  } else {
    console.log('Cancelled');
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
 * Get priority icon
 */
function getPriorityIcon(priority: number): string {
  const icons: Record<number, string> = {
    0: '🔴', 1: '🟠', 2: '🟡', 3: '🟢',
    4: '📊', 5: '📊', 6: '📊', 7: '📊',
  };
  return icons[priority] || '⚪';
}

/**
 * Get status icon
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
 * Format priority
 */
function formatPriority(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    P0: '🔴 P0 Urgent',
    P1: '🟠 P1 High',
    P2: '🟡 P2 Medium',
    P3: '🟢 P3 Low',
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
  };
  return map[priority];
}

/**
 * Format status
 */
function formatStatus(status: string): string {
  const normalized = normalizeStatus(status);
  const map: Record<string, string> = {
    open: '⬜ Open',
    in_progress: '🔵 In Progress',
    resolved: '✅ Resolved',
    closed: '⚫ Closed',
    abandoned: '❌ Abandoned',
    failed: '❌ Failed',
  };
  return map[normalized] || status;
}

// ============== Plan Quality Gate Functions (QG-PLAN-005) ==============

/**
 * Execute Plan quality gate check
 *
 * Performs quality gate validation for tasks at plan_recommend phase, checking for:
 * - Circular dependencies
 * - Invalid dependencies
 * - Orphan subtasks
 * - Isolated tasks (warning)
 * - Blocked tasks (warning)
 * - Bridge nodes (warning)
 * - Inferred-only dependencies (warning)
 *
 * @param tasks - Tasks to validate
 * @param options - Optional configuration
 * @returns Quality gate check result
 *
 * @example
 * ```typescript
 * const tasks = getAllTasks(cwd);
 * const result = runPlanQualityGateCheck(tasks);
 * if (!result.passed) {
 *   console.log('Failed tasks:', result.failedTasks);
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
 * Format Plan quality gate report
 *
 * Formats quality gate check results into a readable string report, supporting compact and detailed modes.
 *
 * @param result - Quality gate check result
 * @param options - Report options
 * @returns Formatted report string
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
  lines.push(`${statusIcon} Plan Quality Gate Check Report [${phase}]`);
  lines.push(separator);
  lines.push('');

  // Statistics summary
  lines.push('📊 Statistics Summary:');
  lines.push(`   Total tasks: ${result.totalTasks}`);
  lines.push(`   ✅ Passed: ${result.passedCount}`);
  lines.push(`   ❌ Failed: ${result.failedCount}`);
  lines.push('');

  // Failed tasks list
  if (result.failedTasks.length > 0) {
    lines.push(separator);
    lines.push(`❌ Failed Tasks (${result.failedTasks.length}):`);
    lines.push('');

    if (showDetails) {
      for (const taskResult of result.validationResults) {
        if (!taskResult.passed) {
          lines.push(`   ${taskResult.taskId}:`);

          // Show errors
          if (taskResult.errors.length > 0) {
            for (const error of taskResult.errors) {
              lines.push(`      ❌ ${error.message}`);
            }
          }

          // Show warnings
          if (taskResult.warnings.length > 0) {
            for (const warning of taskResult.warnings) {
              lines.push(`      ⚠️  ${warning.message}`);
            }
          }
          lines.push('');
        }
      }
    } else {
      // Compact mode: only list task IDs
      for (const taskId of result.failedTasks) {
        lines.push(`   - ${taskId}`);
      }
      lines.push('');
    }
  }

  // Validation details
  if (showDetails && result.validationResults.length > 0) {
    const hasViolations = result.validationResults.some(
      r => r.violations.length > 0
    );

    if (hasViolations) {
      lines.push(separator);
      lines.push('📋 Detailed Violation Info:');
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

  // Conclusion
  if (result.passed) {
    lines.push('✅ All tasks passed Plan quality gate check!');
  } else {
    lines.push(`⚠️  ${result.failedCount} tasks failed quality gate, recommend fixing before running plan recommend`);
    lines.push('');
    lines.push('💡 Fix Suggestions:');
    lines.push('   • Check circular dependencies: ensure no cycles in task dependencies');
    lines.push('   • Check invalid dependencies: ensure dependent task IDs exist and are valid');
    lines.push('   • Check orphan subtasks: ensure parentId points to existing task');
    lines.push('   • Use `projmnt4claude analyze --fix` to auto-fix some issues');
  }

  lines.push('');
  lines.push(`🕐 Validated at: ${result.validatedAt}`);
  lines.push(separator);
  lines.push('');

  return lines.join('\n');
}
