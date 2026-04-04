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
} from '../utils/plan';
import { isInitialized, getProjectDir } from '../utils/path';
import { readTaskMeta, getAllTasks, taskExists, getSubtasks } from '../utils/task';
import type { TaskMeta, TaskPriority } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { createLogger, type InstrumentationRecord } from '../utils/logger';
import { extractAffectedFiles } from '../utils/quality-gate';
import { classifyFileToLayer, type ArchitectureLayer } from '../utils/ai-metadata';

// ============== 任务链分析类型定义 ==============

/**
 * 任务链：具有依赖关系的任务序列
 */
interface InferredDependency {
  /** 被依赖的任务ID */
  depTaskId: string;
  /** 重叠的文件路径列表 */
  overlappingFiles: string[];
}

interface TaskChain {
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
interface ExecutionBatch {
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

// ============== 关键字提取与过滤 ==============

/**
 * 从用户描述中提取关键字
 */
function extractKeywords(description: string): string[] {
  // 停用词
  const stopWords = new Set([
    '的', '了', '是', '在', '和', '有', '我', '要', '想', '把', '这', '那',
    '对', '就', '也', '都', '会', '能', '可', '上', '下', '中', '来', '去',
    '做', '给', '让', '被', '用', '为', '与', '或', '但', '如', '到', '从',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'want',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'which',
  ]);

  // 分词（简单空格+标点分割）
  const words = description
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));

  // 提取唯一关键字
  return [...new Set(words)];
}

/**
 * 检查任务是否匹配关键字
 */
function taskMatchesKeywords(task: TaskMeta, keywords: string[]): boolean {
  if (keywords.length === 0) return true;

  const searchText = [
    task.id,
    task.title,
    task.description || '',
    task.type,
    task.recommendedRole || '',
    ...task.dependencies,
  ].join(' ').toLowerCase();

  // 至少匹配一个关键字
  return keywords.some(kw => searchText.includes(kw.toLowerCase()));
}

// ============== 文件重叠依赖推断 ==============

/**
 * 从文件路径重叠推断任务间的隐式依赖关系
 *
 * 策略：O(n²) 比较所有任务对的文件路径集合，
 * 有交集则建立推断依赖，方向为后创建的任务依赖先创建的任务（时间序）
 *
 * @returns Map<taskId, InferredDependency[]> 每个任务的推断依赖列表
 */
function inferDependenciesFromFiles(tasks: TaskMeta[]): Map<string, InferredDependency[]> {
  const inferredMap = new Map<string, InferredDependency[]>();

  if (tasks.length === 0) return inferredMap;

  // 预计算每个任务的文件路径集合
  const taskFilesMap = new Map<string, Set<string>>();
  for (const task of tasks) {
    const files = extractAffectedFiles(task);
    // 规范化路径：去掉尾部斜杠、转小写
    const normalized = new Set(files.map(f => f.replace(/\/+$/, '').toLowerCase()));
    taskFilesMap.set(task.id, normalized);
  }

  // 按创建时间排序（升序），用于确定依赖方向
  const sortedByTime = [...tasks].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  // O(n²) 比较所有任务对
  for (let i = 0; i < sortedByTime.length; i++) {
    const laterTask = sortedByTime[i]!;
    const laterFiles = taskFilesMap.get(laterTask.id)!;

    for (let j = 0; j < i; j++) {
      const earlierTask = sortedByTime[j]!;
      const earlierFiles = taskFilesMap.get(earlierTask.id)!;

      // 计算文件交集
      const overlap: string[] = [];
      for (const f of laterFiles) {
        if (earlierFiles.has(f)) {
          overlap.push(f);
        }
      }

      if (overlap.length > 0) {
        // 后创建的任务依赖先创建的任务
        const dep: InferredDependency = {
          depTaskId: earlierTask.id,
          overlappingFiles: overlap,
        };

        const existing = inferredMap.get(laterTask.id);
        if (existing) {
          existing.push(dep);
        } else {
          inferredMap.set(laterTask.id, [dep]);
        }
      }
    }
  }

  return inferredMap;
}

// ============== 架构层级推断 ==============

/**
 * 根据任务涉及文件推断架构层级
 * 使用任务关联文件中最低（最基础）的层级作为该任务的层级
 * Layer0(类型定义) → Layer3(命令入口)，基础层优先执行
 */
function inferArchitectureLayer(task: TaskMeta): { layer: ArchitectureLayer; layerValue: number } {
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
function buildTaskChains(tasks: TaskMeta[], cwd: string): TaskChain[] {
  const taskMap = new Map<string, TaskMeta>();
  const chains: TaskChain[] = [];
  const visited = new Set<string>();

  // 建立任务映射
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // 推断文件重叠依赖
  const inferredDeps = inferDependenciesFromFiles(tasks);

  /**
   * 获取任务的完整依赖列表（显式 + 推断）
   */
  function getAllDeps(task: TaskMeta): string[] {
    const explicit = new Set(task.dependencies);
    const inferred = inferredDeps.get(task.id);
    if (inferred) {
      for (const dep of inferred) {
        explicit.add(dep.depTaskId);
      }
    }
    return [...explicit];
  }

  /**
   * 从指定任务开始，向下追踪依赖链
   */
  function traceChain(startTask: TaskMeta): TaskMeta[] {
    const chain: TaskMeta[] = [];
    const chainVisited = new Set<string>();

    function dfs(task: TaskMeta) {
      if (chainVisited.has(task.id)) return;
      chainVisited.add(task.id);

      // 先处理依赖（合并显式 + 推断）
      for (const depId of getAllDeps(task)) {
        const depTask = taskMap.get(depId);
        if (depTask && !chainVisited.has(depTask.id)) {
          dfs(depTask);
        }
      }

      // 再添加当前任务
      chain.push(task);
    }

    dfs(startTask);
    return chain;
  }

  // 为每个未被访问的任务构建链
  for (const task of tasks) {
    if (visited.has(task.id)) continue;

    const chainTasks = traceChain(task);

    // 标记为已访问
    for (const t of chainTasks) {
      visited.add(t.id);
    }

    // 计算链的元数据
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

    // 计算链中最低架构层级（基础层优先执行）
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
function sortChains(chains: TaskChain[]): TaskChain[] {
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
function buildBatches(sortedChains: TaskChain[]): ExecutionBatch[] {
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
  query?: string,
  keywords?: string[]
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

  // 构建执行批次
  const batches = buildBatches(chains);
  const batchOrder = batches.map(b => b.tasks);

  return {
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
        batchEntry.parallelBlockedBy = '推断依赖: 文件重叠';
      }
      return batchEntry;
    }),
    batchOrder,
    recommendation: {
      summary: `发现 ${chains.length} 个任务链，共 ${filteredCount} 个任务，分 ${batches.length} 个批次。同优先级内已按架构层级排序（Layer0→Layer3），确保底层变更优先于上层依赖执行`,
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
  options: { query?: string; nonInteractive?: boolean; json?: boolean; all?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
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

  // 0. 过滤任务（默认只推荐 open 状态，--all 排除终态）
  const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'abandoned']);
  const activeTasks = options.all
    ? allTasks.filter(t => !TERMINAL_STATUSES.has(t.status))
    : allTasks.filter(t => t.status === 'open');

  const excludedCount = allTasks.length - activeTasks.length;
  if (excludedCount > 0) {
    const reason = options.all ? '终态(resolved/closed/abandoned)' : '非 open 状态';
    console.log(`已排除 ${excludedCount} 个${reason}任务`);
  }

  // 1. 关键字过滤
  let keywords: string[] = [];
  let filteredTasks = activeTasks;

  if (options.query) {
    keywords = extractKeywords(options.query);
    console.log(`关键字: ${keywords.join(', ')}`);

    filteredTasks = activeTasks.filter(task => taskMatchesKeywords(task, keywords));
    console.log(`过滤结果: ${filteredTasks.length}/${activeTasks.length} 个任务匹配\n`);
  }

  // 1.5 统一可执行过滤（依赖完成检查+状态检查+子任务检查）
  const executableIds = new Set(getExecutableTasks(cwd));
  const beforeExecFilter = filteredTasks.length;
  filteredTasks = filteredTasks.filter(task => executableIds.has(task.id));
  if (beforeExecFilter - filteredTasks.length > 0) {
    console.log(`已排除 ${beforeExecFilter - filteredTasks.length} 个依赖未完成或不可执行的任务`);
  }

  if (filteredTasks.length === 0) {
    const emptyResult = {
      query: options.query,
      keywords,
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
        console.log(`关键字: ${keywords.join(', ')}`);
      }
    }
    // CP-10: 空结果埋点
    logger.logInstrumentation({
      module: 'plan-recommend',
      action: 'recommend_empty',
      input_summary: `query="${inputQuery}", all=${options.all || false}`,
      output_summary: `no_match, active=${activeTasks.length}, filtered=0`,
      ai_used: false,
      ai_enhanced_fields: [],
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: { keywords, excluded: excludedCount },
    });
    logger.flush();
    return;
  }

  // 1. 构建任务链
  console.log('正在分析任务依赖关系...');
  const chains = buildTaskChains(filteredTasks, cwd);

  // 2. 按优先级↑ 链长度↓ reopen↓ 排序
  const sortedChains = sortChains(chains);

  // 3. 生成 AI 友好的输出
  const aiOutput = generateAIOutput(
    sortedChains,
    activeTasks.length,
    filteredTasks.length,
    options.query,
    keywords.length > 0 ? keywords : undefined
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

  // 按批次展示
  const batches = buildBatches(sortedChains);
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const batchIcon = getPriorityIcon(batch.priorityValue);
    const parallelTag = batch.parallelizable
      ? ' [可并行]'
      : batch.chains.length > 1
        ? ' [不可并行: 文件重叠推断依赖]'
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
          const files = [...new Set(inferredDeps.flatMap(d => d.overlappingFiles))].slice(0, 2);
          inferredTag = ` [推断] 文件重叠: ${files.join(', ')}${inferredDeps.flatMap(d => d.overlappingFiles).length > 2 ? '...' : ''}`;
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
  const icons: Record<string, string> = {
    open: '⬜',
    in_progress: '🔵',
    resolved: '✅',
    closed: '⚫',
    abandoned: '❌',
  };
  return icons[status] || '❓';
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
  const map: Record<string, string> = {
    open: '⬜ 待处理',
    in_progress: '🔵 进行中',
    resolved: '✅ 已解决',
    closed: '⚫ 已关闭',
    abandoned: '❌ 已放弃',
  };
  return map[status] || status;
}
