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

// ============== 任务链分析类型定义 ==============

/**
 * 任务链：具有依赖关系的任务序列
 */
interface TaskChain {
  chainId: string;           // 链 ID（链首任务 ID）
  tasks: TaskMeta[];         // 链中所有任务（按依赖顺序）
  length: number;            // 链长度
  totalReopenCount: number;  // 链中任务总 reopen 次数
  maxPriority: number;       // 链中最高优先级（数字越小越紧急）
  keywords: string[];        // 链涉及的关键字
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
    keywords: string[];
    tasks: Array<{
      order: number;
      id: string;
      title: string;
      priority: string;
      status: string;
      reopenCount: number;
      dependencies: string[];
    }>;
  }>;
  batches: Array<{
    batchId: string;
    priority: string;
    chains: string[];
    tasks: string[];
    parallelizable: boolean;
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

// ============== 任务链分析 ==============

/**
 * 构建任务依赖图并识别任务链
 */
function buildTaskChains(tasks: TaskMeta[], cwd: string): TaskChain[] {
  const taskMap = new Map<string, TaskMeta>();
  const chains: TaskChain[] = [];
  const visited = new Set<string>();

  // 建立任务映射
  for (const task of tasks) {
    taskMap.set(task.id, task);
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

      // 先处理依赖
      for (const depId of task.dependencies) {
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

    chains.push({
      chainId: chainTasks[0]!.id,
      tasks: chainTasks,
      length: chainTasks.length,
      totalReopenCount,
      maxPriority,
      keywords,
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
    // 2. 链长度降序（同优先级下长链优先）
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    // 3. reopen 次数降序
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

    for (const chain of chainsInBucket) {
      chainIds.push(chain.chainId);
      for (const task of chain.tasks) {
        if (!allTasks.includes(task.id)) {
          allTasks.push(task.id);
        }
      }
    }

    batches.push({
      batchId: `batch-${priorityNames[priority] || `L${priority}`}`,
      priority: priorityNames[priority] || `L${priority}`,
      priorityValue: priority,
      chains: chainIds,
      tasks: allTasks,
      parallelizable: chainsInBucket.length > 1,
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

  for (let i = 0; i < Math.min(chains.length, 5); i++) {
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
      keywords: chain.keywords.slice(0, 10),
      tasks: chain.tasks.map((task, idx) => ({
        order: idx + 1,
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        reopenCount: task.reopenCount || 0,
        dependencies: task.dependencies,
      })),
    })),
    batches: batches.map(b => ({
      batchId: b.batchId,
      priority: b.priority,
      chains: b.chains,
      tasks: b.tasks,
      parallelizable: b.parallelizable,
    })),
    batchOrder,
    recommendation: {
      summary: `发现 ${chains.length} 个任务链，共 ${filteredCount} 个任务，分 ${batches.length} 个批次`,
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
  if (options.json) {
    console.log(JSON.stringify(aiOutput, null, 2));
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
    const parallelTag = batch.parallelizable ? ' [可并行]' : '';

    console.log(`📦 批次 ${b + 1}/${batches.length} ${batchIcon} ${batch.priority}${parallelTag}`);
    console.log(`   链数: ${batch.chains.length} | 任务数: ${batch.tasks.length}`);
    console.log('');

    // 显示批次内的链
    const chainsInBatch = sortedChains.filter(c => batch.chains.includes(c.chainId));
    for (let i = 0; i < chainsInBatch.length; i++) {
      const chain = chainsInBatch[i]!;
      const chainLabel = batch.parallelizable ? `[链${i + 1}]` : `[链]`;

      console.log(`   ${chainLabel} ${chain.chainId} (长度:${chain.length} Reopen:${chain.totalReopenCount})`);

      // 显示链中任务（拓扑序）
      for (let j = 0; j < chain.tasks.length; j++) {
        const task = chain.tasks[j]!;
        const prefix = j === chain.tasks.length - 1 ? '      └─' : '      ├─';
        const statusIcon = getStatusIcon(task.status);
        console.log(`${prefix} ${statusIcon} ${task.id}: ${task.title.substring(0, 40)}`);
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
  } else {
    console.log('已取消');
  }
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
    reopened: '🔄',
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
    reopened: '🔄 已重开',
    abandoned: '❌ 已放弃',
  };
  return map[status] || status;
}
