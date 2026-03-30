import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getTasksDir, getArchiveDir } from '../utils/path';
import {
  generateNewTaskId,
  readTaskMeta,
  writeTaskMeta,
  getAllTasks,
  taskExists,
} from '../utils/task';
import {
  parseCheckpointsWithIds,
  syncCheckpointsToMeta,
  updateCheckpointStatus,
  getCheckpointDetail,
  listCheckpoints,
} from '../utils/checkpoint';
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
  TaskType,
  TaskHistoryEntry,
  CheckpointMetadata,
} from '../types/task';
import {
  createDefaultTaskMeta,
  isValidTaskId,
} from '../types/task';
import * as crypto from 'crypto';

/**
 * 检查点数据结构
 */
interface CheckpointItem {
  text: string;
  checked: boolean;
}

/**
 * 解析检查点文件
 */
function parseCheckpoints(checkpointPath: string): CheckpointItem[] {
  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');
  const checkpoints: CheckpointItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [')) {
      const isChecked = trimmed.includes('[x]') || trimmed.includes('[X]');
      const text = trimmed.replace(/- \[[xX ]\] /, '').trim();
      checkpoints.push({ text, checked: isChecked });
    }
  }

  return checkpoints;
}

/**
 * 生成检查点确认令牌
 */
function generateCheckpointToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 检查 checkpoint 内容是否为有效（非模板）内容
 * BUG-002: 校验 checkpoints 是否有意义
 * @param checkpointPathOrContent - 文件路径或直接内容字符串
 * @param isContent - 如果为 true，第一个参数是内容字符串而非路径
 */
function hasValidCheckpoints(
  checkpointPathOrContent: string | null,
  isContent: boolean = false
): { valid: boolean; reason: string } {
  let content: string;

  if (isContent && checkpointPathOrContent !== null) {
    // 直接使用传入的内容
    content = checkpointPathOrContent;
  } else if (!isContent && checkpointPathOrContent) {
    // 从文件读取
    if (!fs.existsSync(checkpointPathOrContent)) {
      return { valid: false, reason: 'checkpoint.md 文件不存在' };
    }
    content = fs.readFileSync(checkpointPathOrContent, 'utf-8');
  } else {
    // 无内容
    return { valid: false, reason: '无检查点内容' };
  }

  const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

  if (lines.length === 0) {
    return { valid: false, reason: 'checkpoint.md 中没有检查点项' };
  }

  // 检测模板内容（无意义的默认检查点）
  // 注意：这些模式匹配的是去掉 "- [ ] " 前缀后的纯文本
  const templatePatterns = [
    /^检查点\d+$/u,           // "检查点1", "检查点2" 等
    /^检查点\d*[（(].*[)）]$/u, // "检查点1（请替换...）" 等
    /^checkpoint\s*\d+$/i,    // "checkpoint 1", "checkpoint 2" 等
    /^完成任务?$/u,            // "完成任务"
    /^待填写$/u,               // "待填写"
    /^TODO$/i,                 // "TODO"
    /^\.{3,}$/,                // "..."
    /请替换为.*验收标准/u,     // "请替换为具体验收标准"
    /请替换.*具体/u,           // "请替换为具体..."
    /^CP-\d+$/u,              // "CP-001" 等纯ID形式
  ];

  let templateCount = 0;
  for (const line of lines) {
    const checkText = line.replace(/- \[[xX ]\] /, '').trim();
    for (const pattern of templatePatterns) {
      if (pattern.test(checkText)) {
        templateCount++;
        break;
      }
    }
  }

  // 如果超过一半的检查点是模板内容，则认为无效
  if (templateCount > lines.length / 2) {
    return {
      valid: false,
      reason: `检测到 ${templateCount}/${lines.length} 个检查点为模板内容（如"检查点1"、"完成任务"等），请添加具体的验收标准`
    };
  }

  return { valid: true, reason: '' };
}

/**
 * 默认的 checkpoint.md 内容模板
 */
const DEFAULT_CHECKPOINT_CONTENT = `# {taskId} 检查点

- [ ] 检查点1
- [ ] 检查点2
`;

/**
 * 显示检查点质量错误（阻止创建）
 */
function displayCheckpointError(taskId: string, reason: string): void {
  console.log('');
  console.log('━'.repeat(60));
  console.log('❌  检查点质量错误');
  console.log('━'.repeat(60));
  console.log('');
  console.log(`无法创建任务 ${taskId}: 检查点质量不符合要求`);
  console.log('');
  console.log(`原因: ${reason}`);
  console.log('');
  console.log('📋 高质量检查点对于任务验收至关重要。请先：');
  console.log('');
  console.log('   1. 使用 init-requirement 命令创建任务（推荐）:');
  console.log('      projmnt4claude init-requirement "任务描述"');
  console.log('');
  console.log('   2. 或先创建任务，然后编辑 checkpoint.md 文件');
  console.log('');
  console.log('   3. 使用 --skip-validation 强制创建（不推荐）:');
  console.log('      projmnt4claude task create --title "..." --skip-validation');
  console.log('');
  console.log('━'.repeat(60));
}

/**
 * 显示 checkpoints 质量警告
 */
function displayCheckpointWarning(taskId: string, reason: string, cwd: string): void {
  console.log('');
  console.log('━'.repeat(60));
  console.log('⚠️  检查点质量警告');
  console.log('━'.repeat(60));
  console.log('');
  console.log(`任务 ${taskId} 创建成功，但检查点质量存在问题：`);
  console.log(`   ${reason}`);
  console.log('');
  console.log('📋 高质量检查点对于任务验收至关重要。建议您：');
  console.log('');
  console.log('   1. 编辑 checkpoint.md 文件，添加具体的验收标准');
  console.log(`      文件路径: .projmnt4claude/tasks/${taskId}/checkpoint.md`);
  console.log('');
  console.log('   2. 使用 checkpoint 模板生成功能：');
  console.log(`      projmnt4claude task checkpoint template ${taskId} --apply`);
  console.log('');
  console.log('   3. 或使用 analyze 命令自动生成检查点：');
  console.log(`      projmnt4claude analyze --generate-checkpoints ${taskId}`);
  console.log('');
  console.log('💡 提示: 使用 --skip-validation 可跳过此检查');
  console.log('━'.repeat(60));
}

/**
 * BUG-002: 任务创建时显示检查点质量提醒
 * 不阻止任务创建，但提醒用户需要编辑 checkpoint.md
 */
function displayCheckpointCreationWarning(taskId: string, cwd: string): void {
  console.log('');
  console.log('━'.repeat(60));
  console.log('⚠️  检查点质量提醒');
  console.log('━'.repeat(60));
  console.log('');
  console.log('任务已创建，但检查点目前使用的是默认模板。');
  console.log('📋 高质量检查点对于任务验收至关重要。建议您：');
  console.log('');
  console.log('   1. 编辑 checkpoint.md 文件，添加具体的验收标准：');
  console.log(`      文件路径: .projmnt4claude/tasks/${taskId}/checkpoint.md`);
  console.log('');
  console.log('   2. 使用 analyze 命令自动生成检查点（推荐）：');
  console.log(`      projmnt4claude analyze --generate-checkpoints ${taskId}`);
  console.log('');
  console.log('   3. 使用 checkpoint 模板功能：');
  console.log(`      projmnt4claude task checkpoint template ${taskId} --apply`);
  console.log('');
  console.log('💡 提示: 任务执行/完成时会进行严格校验');
  console.log('━'.repeat(60));
}

/**
 * 创建新任务
 * 支持交互模式和非交互模式
 */
export async function createTask(
  options: {
    title?: string;
    description?: string;
    priority?: string;
    type?: string;
    nonInteractive?: boolean;
    skipValidation?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 非交互模式：使用命令行参数
  if (options.nonInteractive && options.title) {
    const taskType = (options.type || 'feature') as TaskType;
    const taskPriority = normalizePriorityToP(options.priority || 'P2');

    // 生成任务ID (新格式)
    const taskId = generateNewTaskId(cwd, taskType, taskPriority, options.title);

    // BUG-002: 默认模板内容仅作为占位符，不进行质量校验
    // 默认模板本身就是占位符，用户需要在任务创建后编辑它
    const defaultCheckpointContent = `# ${taskId} 检查点\n\n- [ ] 检查点1（请替换为具体验收标准）\n- [ ] 检查点2（请替换为具体验收标准）\n`;

    // 创建任务元数据
    const task = createDefaultTaskMeta(taskId, options.title, taskType);
    if (options.description) {
      task.description = options.description;
    }
    task.priority = taskPriority;

    // 写入任务
    writeTaskMeta(task, cwd);

    // 创建 checkpoint.md
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');
    fs.writeFileSync(checkpointPath, defaultCheckpointContent, 'utf-8');

    console.log(`\n✅ 任务创建成功!`);
    console.log(`   ID: ${taskId}`);
    console.log(`   标题: ${task.title}`);
    console.log(`   优先级: ${formatPriority(task.priority)}`);

    // BUG-002: 校验检查点质量并显示警告（除非使用 --skip-validation）
    if (!options.skipValidation) {
      const validation = hasValidCheckpoints(checkpointPath, false);
      if (!validation.valid) {
        displayCheckpointWarning(taskId, validation.reason, cwd);
      }
    }
    return;
  }

  // 交互式收集任务信息
  const response = await prompts([
    {
      type: 'text',
      name: 'title',
      message: '任务标题',
      validate: (value) => (value.trim().length > 0 ? true : '标题不能为空'),
    },
    {
      type: 'text',
      name: 'description',
      message: '任务描述 (可选，直接回车跳过)',
    },
    {
      type: 'select',
      name: 'priority',
      message: '优先级',
      choices: [
        { title: 'P3 低', value: 'P3' },
        { title: 'P2 中 (默认)', value: 'P2' },
        { title: 'P1 高', value: 'P1' },
        { title: 'P0 紧急', value: 'P0' },
      ],
      initial: 1,
    },
  ]);

  if (!response.title) {
    console.log('已取消创建任务');
    return;
  }

  // 生成任务ID (新格式)
  const taskId = generateNewTaskId(cwd, 'feature', response.priority, response.title);

  // BUG-002: 交互模式 - 默认检查点内容仅作为占位符，不进行质量校验
  const defaultCheckpointContent = `# ${taskId} 检查点\n\n- [ ] 检查点1（请替换为具体验收标准）\n- [ ] 检查点2（请替换为具体验收标准）\n`;

  // 创建任务元数据
  const task = createDefaultTaskMeta(taskId, response.title);
  if (response.description) {
    task.description = response.description;
  }
  task.priority = response.priority as TaskPriority;

  // 写入任务
  writeTaskMeta(task, cwd);

  // 创建 checkpoint.md
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  fs.writeFileSync(checkpointPath, defaultCheckpointContent, 'utf-8');

  console.log(`\n✅ 任务创建成功!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   标题: ${task.title}`);
  console.log(`   优先级: ${formatPriority(task.priority)}`);

  // BUG-002: 交互模式 - 校验检查点质量并显示警告
  if (!options.skipValidation) {
    const validation = hasValidCheckpoints(checkpointPath, false);
    if (!validation.valid) {
      displayCheckpointWarning(taskId, validation.reason, cwd);
    }
  }
}

/**
 * 将优先级规范化为 P0-P3 格式
 */
function normalizePriorityToP(priority: string): TaskPriority {
  const map: Record<string, TaskPriority> = {
    'urgent': 'P0', 'high': 'P1', 'medium': 'P2', 'low': 'P3',
    'P0': 'P0', 'P1': 'P1', 'P2': 'P2', 'P3': 'P3',
    'Q1': 'Q1', 'Q2': 'Q2', 'Q3': 'Q3', 'Q4': 'Q4',
  };
  return map[priority] || 'P2';
}

/**
 * 列出所有任务
 * 支持多种输出格式和过滤选项
 */
export function listTasks(
  options: {
    status?: string;
    priority?: string;
    role?: string;
    needsDiscussion?: boolean;
    fields?: string;
    format?: 'json';
    missingVerification?: boolean;
    group?: 'status' | 'priority' | 'type' | 'role';
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  let tasks = getAllTasks(cwd);

  // 应用过滤
  if (options.status) {
    tasks = tasks.filter(t => t.status === options.status);
  }
  if (options.priority) {
    tasks = tasks.filter(t => t.priority === options.priority);
  }
  if (options.role) {
    tasks = tasks.filter(t => t.recommendedRole === options.role);
  }
  if (options.needsDiscussion) {
    tasks = tasks.filter(t => t.needsDiscussion === true);
  }
  // 新增：筛选缺少验证的任务
  if (options.missingVerification) {
    tasks = tasks.filter(t =>
      (t.status === 'resolved' || t.status === 'closed') && !t.checkpointConfirmationToken
    );
  }

  if (tasks.length === 0) {
    if (options.format === 'json') {
      console.log('[]');
    } else {
      console.log('暂无任务');
    }
    return;
  }

  // 分离父任务和子任务（提前计算，供分组和普通列表使用）
  const parentTasks = tasks.filter(t => !t.parentId);
  const subtaskMap = new Map<string, TaskMeta[]>();
  for (const task of tasks) {
    if (task.parentId) {
      if (!subtaskMap.has(task.parentId)) {
        subtaskMap.set(task.parentId, []);
      }
      subtaskMap.get(task.parentId)!.push(task);
    }
  }

  // 分组显示功能
  if (options.group && options.format !== 'json') {
    displayTasksGrouped(tasks, options.group, subtaskMap);
    return;
  }

  // JSON 格式输出
  if (options.format === 'json') {
    const output = tasks.map(t => {
      if (options.fields) {
        const fields = options.fields.split(',').map(f => f.trim());
        const picked: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in t) {
            picked[f] = t[f as keyof TaskMeta];
          }
        }
        return picked;
      }
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        description: t.description,
        dependencies: t.dependencies,
        recommendedRole: t.recommendedRole,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 表头
  console.log('');
  console.log('ID          | 标题                         | 优先级   | 状态');
  console.log('------------|------------------------------|----------|------------');

  // 任务列表（层级显示）
  for (const task of parentTasks) {
    const id = task.id.padEnd(11);
    const title = task.title.substring(0, 28).padEnd(28);
    const priority = formatPriority(task.priority).padEnd(8);
    const status = formatStatus(task.status);
    const discussionIcon = task.needsDiscussion ? ' 💬' : '';
    const subtaskCount = (task.subtaskIds?.length || subtaskMap.get(task.id)?.length || 0);
    const subtaskIcon = subtaskCount > 0 ? ` [${subtaskCount}子任务]` : '';
    console.log(`${id} | ${title} | ${priority} | ${status}${discussionIcon}${subtaskIcon}`);

    // 显示子任务
    const subtasks = subtaskMap.get(task.id) || [];
    for (const subtask of subtasks) {
      const subId = `  └─ ${subtask.id}`.substring(0, 11).padEnd(11);
      const subTitle = subtask.title.substring(0, 26).padEnd(26);
      const subPriority = formatPriority(subtask.priority).padEnd(8);
      const subStatus = formatStatus(subtask.status);
      console.log(`${subId} | ${subTitle} | ${subPriority} | ${subStatus}`);
    }
  }

  console.log('');
  const totalSubtasks = tasks.filter(t => t.parentId).length;
  console.log(`共 ${parentTasks.length} 个任务${totalSubtasks > 0 ? `, ${totalSubtasks} 个子任务` : ''}`);
}

/**
 * 分组显示任务
 * 支持 status, priority, type, role 分组
 */
function displayTasksGrouped(
  tasks: TaskMeta[],
  groupBy: 'status' | 'priority' | 'type' | 'role',
  subtaskMap: Map<string, TaskMeta[]>
): void {
  // 过滤出父任务用于分组
  const parentTasks = tasks.filter(t => !t.parentId);

  // 按 groupBy 字段分组
  const groups = new Map<string, TaskMeta[]>();

  for (const task of parentTasks) {
    let groupKey: string;
    switch (groupBy) {
      case 'status':
        groupKey = task.status || 'open';
        break;
      case 'priority':
        groupKey = task.priority || 'P2';
        break;
      case 'type':
        groupKey = task.type || 'feature';
        break;
      case 'role':
        groupKey = task.recommendedRole || '未分配';
        break;
      default:
        groupKey = '其他';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(task);
  }

  // 定义分组排序顺序
  const statusOrder = ['open', 'in_progress', 'wait_complete', 'resolved', 'closed', 'reopened', 'abandoned'];
  const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

  // 获取排序后的分组键
  let sortedKeys: string[];
  if (groupBy === 'status') {
    sortedKeys = [...groups.keys()].sort((a, b) => {
      const idxA = statusOrder.indexOf(a);
      const idxB = statusOrder.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
  } else if (groupBy === 'priority') {
    sortedKeys = [...groups.keys()].sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
  } else {
    sortedKeys = [...groups.keys()].sort();
  }

  // 获取分组标题
  const getGroupHeader = (key: string): string => {
    switch (groupBy) {
      case 'status':
        return formatStatus(key);
      case 'priority':
        return formatPriority(key);
      case 'type':
        return `📁 类型: ${key}`;
      case 'role':
        return `👤 角色: ${key}`;
      default:
        return key;
    }
  };

  // 显示分组任务
  console.log('');

  for (const groupKey of sortedKeys) {
    const groupTasks = groups.get(groupKey)!;

    // 分组标题
    console.log('━'.repeat(60));
    console.log(`${getGroupHeader(groupKey)} (${groupTasks.length})`);
    console.log('━'.repeat(60));

    // 表头
    console.log('ID          | 标题                         | 优先级   | 状态');
    console.log('------------|------------------------------|----------|------------');

    // 分组内任务
    for (const task of groupTasks) {
      const id = task.id.padEnd(11);
      const title = task.title.substring(0, 28).padEnd(28);
      const priority = formatPriority(task.priority).padEnd(8);
      const status = formatStatus(task.status);
      const discussionIcon = task.needsDiscussion ? ' 💬' : '';
      const subtaskCount = (task.subtaskIds?.length || subtaskMap.get(task.id)?.length || 0);
      const subtaskIcon = subtaskCount > 0 ? ` [${subtaskCount}子任务]` : '';
      console.log(`${id} | ${title} | ${priority} | ${status}${discussionIcon}${subtaskIcon}`);

      // 显示子任务
      const subtasks = subtaskMap.get(task.id) || [];
      for (const subtask of subtasks) {
        const subId = `  └─ ${subtask.id}`.substring(0, 11).padEnd(11);
        const subTitle = subtask.title.substring(0, 26).padEnd(26);
        const subPriority = formatPriority(subtask.priority).padEnd(8);
        const subStatus = formatStatus(subtask.status);
        console.log(`${subId} | ${subTitle} | ${subPriority} | ${subStatus}`);
      }
    }

    console.log('');
  }

  // 统计信息
  const totalSubtasks = tasks.filter(t => t.parentId).length;
  console.log(`共 ${parentTasks.length} 个任务${totalSubtasks > 0 ? `, ${totalSubtasks} 个子任务` : ''}`);
  console.log(`分组: ${groupBy === 'status' ? '状态' : groupBy === 'priority' ? '优先级' : groupBy === 'type' ? '类型' : '角色'}`);
}

/**
 * 格式化时间为本地可读格式
 */
function formatLocalTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化相对时间
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return formatLocalTime(isoString);
}

/**
 * 显示任务详情
 * 支持多种输出格式：verbose, history, json, compact, panel
 */
export function showTask(
  taskId: string,
  options: {
    verbose?: boolean;
    history?: boolean;
    json?: boolean;
    compact?: boolean;
    checkpoints?: boolean;
    format?: 'panel' | 'classic';
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!isValidTaskId(taskId)) {
    console.error(`错误: 无效的任务ID格式 '${taskId}'`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // JSON 格式输出
  if (options.json) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  // 仅显示历史
  if (options.history) {
    showTaskHistory(taskId, cwd);
    return;
  }

  // 精简输出
  if (options.compact) {
    showTaskCompact(task);
    return;
  }

  // 默认使用新面板格式（除非指定 --format classic 或 --verbose）
  if (options.format !== 'classic' && !options.verbose) {
    showTaskPanel(task, options, cwd);
    return;
  }

  // 经典格式（verbose 模式或指定 classic）
  showTaskClassic(task, options, cwd);
}

/**
 * 精简输出格式
 */
function showTaskCompact(task: TaskMeta): void {
  const statusIcon = getStatusIcon(task.status);
  console.log(`${statusIcon} ${task.id}: ${task.title}`);
  console.log(`   状态: ${formatStatus(task.status)} | 优先级: ${formatPriority(task.priority)}`);
  if (task.description) {
    console.log(`   描述: ${task.description.substring(0, 100)}${task.description.length > 100 ? '...' : ''}`);
  }
  if (task.dependencies.length > 0) {
    console.log(`   依赖: ${task.dependencies.join(', ')}`);
  }
  console.log(`   创建: ${formatRelativeTime(task.createdAt)}`);
}

/**
 * 获取状态图标
 */
function getStatusIcon(status: TaskStatus): string {
  const icons: Record<string, string> = {
    open: '⬜',
    in_progress: '🔄',
    wait_review: '👀',
    wait_qa: '🧪',
    wait_complete: '⏳',
    resolved: '✅',
    closed: '⚫',
    reopened: '🔁',
    abandoned: '❌',
  };
  return icons[status] || '❓';
}

/**
 * 计算字符串的显示宽度（中文字符占2个宽度）
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    // 中文字符范围（包括中文标点）
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 按显示宽度截断字符串
 */
function truncateByDisplayWidth(str: string, maxDisplayWidth: number): string {
  let result = '';
  let currentWidth = 0;
  for (const char of str) {
    const charWidth = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1;
    if (currentWidth + charWidth > maxDisplayWidth) {
      break;
    }
    result += char;
    currentWidth += charWidth;
  }
  return result;
}

/**
 * 按显示宽度填充空格（用于对齐）
 */
function padByDisplayWidth(str: string, targetWidth: number): string {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth >= targetWidth) {
    return str;
  }
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * 新面板格式 - 紧凑美观
 */
function showTaskPanel(
  task: TaskMeta,
  options: { checkpoints?: boolean; verbose?: boolean },
  cwd: string
): void {
  const width = 60;
  const hLine = '─'.repeat(width - 2);
  const statusIcon = getStatusIcon(task.status);

  console.log('');
  console.log(`╭${hLine}╮`);

  // 标题行
  const titleLine = ` ${statusIcon} ${task.id}`;
  console.log(`│${padByDisplayWidth(titleLine, width - 2)}│`);

  // 标题（考虑中文字符宽度截断）
  const maxTitleDisplayWidth = width - 6;
  const displayTitle = truncateByDisplayWidth(task.title, maxTitleDisplayWidth - 3);
  const truncatedTitle = getDisplayWidth(task.title) > maxTitleDisplayWidth ? displayTitle + '...' : task.title;
  console.log(`│   ${padByDisplayWidth(truncatedTitle, width - 5)}│`);

  console.log(`├${hLine}┤`);

  // 状态行：使用简洁格式，一行显示状态、优先级、类型
  const statusMap: Record<string, string> = {
    open: '待处理',
    in_progress: '进行中',
    resolved: '已解决',
    closed: '已关闭',
    reopened: '已重开',
    abandoned: '已放弃',
    wait_review: '待审查',
    wait_qa: '待测试',
    wait_complete: '待完成',
  };
  const priorityMap: Record<string, string> = {
    P0: 'P0紧急',
    P1: 'P1高',
    P2: 'P2中',
    P3: 'P3低',
    Q1: 'Q1',
    Q2: 'Q2',
    Q3: 'Q3',
    Q4: 'Q4',
  };
  const statusText = statusMap[task.status] || task.status;
  const priorityText = priorityMap[task.priority] || task.priority;
  const typeText = task.type || '未指定';
  const statusLine = `状态:${statusText} │ 优先级:${priorityText} │ 类型:${typeText}`;
  console.log(`│ ${padByDisplayWidth(statusLine, width - 4)}│`);

  // 描述（如果有）
  if (task.description) {
    console.log(`├${hLine}┤`);
    const descLines = wrapText(task.description, width - 6);
    for (const line of descLines.slice(0, 3)) {
      console.log(`│ ${padByDisplayWidth(line, width - 4)}│`);
    }
    if (descLines.length > 3) {
      const moreDesc = `... 还有 ${descLines.length - 3} 行`;
      console.log(`│ ${padByDisplayWidth(moreDesc, width - 4)}│`);
    }
  }

  // 检查点进度
  const taskDir = path.join(getTasksDir(cwd), task.id);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (fs.existsSync(checkpointPath)) {
    console.log(`├${hLine}┤`);
    console.log(`│ ${padByDisplayWidth('✅ 检查点', width - 2)}│`);

    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const checkpointLines = content.split('\n').filter(l => l.trim().startsWith('- ['));

    if (checkpointLines.length > 0) {
      const completedCount = checkpointLines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
      const totalCount = checkpointLines.length;
      const percentage = Math.round((completedCount / totalCount) * 100);

      // 可视化进度条 - 使用 Unicode 块字符
      const barWidth = 20;
      const filledWidth = Math.round((completedCount / totalCount) * barWidth);
      const emptyWidth = barWidth - filledWidth;
      const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
      const progressLine = `检查点进度 [${bar}] ${percentage}%`;
      console.log(`│ ${padByDisplayWidth(progressLine, width - 4)}│`);

      // 显示检查点（最多 5 个）
      const displayCount = options.checkpoints ? checkpointLines.length : Math.min(5, checkpointLines.length);
      for (let i = 0; i < displayCount; i++) {
        const l = checkpointLines[i]!;
        const isChecked = l.includes('[x]') || l.includes('[X]');
        const cpIcon = isChecked ? '✅' : '⬜';
        const text = l.replace(/- \[[xX ]\] /, '').trim();
        const maxTextLen = width - 10;
        const displayText = getDisplayWidth(text) > maxTextLen ? truncateByDisplayWidth(text, maxTextLen) + '..' : text;
        console.log(`│  ${padByDisplayWidth(`  ${i + 1}. ${cpIcon} ${displayText}`, width - 3)}│`);
      }

      if (!options.checkpoints && checkpointLines.length > 5) {
        const moreLine = `     ... 还有 ${checkpointLines.length - 5} 个检查点`;
        console.log(`│  ${padByDisplayWidth(moreLine, width - 2)}│`);
      }
    }
  }

  // 附加信息（依赖、角色、分支等）
  const hasExtras = task.dependencies.length > 0 ||
                    task.recommendedRole ||
                    task.branch ||
                    (task.subtaskIds && task.subtaskIds.length > 0) ||
                    task.parentId;

  if (hasExtras) {
    console.log(`├${hLine}┤`);

    if (task.dependencies.length > 0) {
      const deps = task.dependencies.join(', ');
      const maxLen = width - 10;
      const depsText = getDisplayWidth(deps) > maxLen ? truncateByDisplayWidth(deps, maxLen - 2) + '..' : deps;
      const depsLine = `🔗 依赖: ${depsText}`;
      console.log(`│ ${padByDisplayWidth(depsLine, width - 4)}│`);
    }

    if (task.recommendedRole) {
      const roleLine = `👤 角色: ${task.recommendedRole}`;
      console.log(`│ ${padByDisplayWidth(roleLine, width - 4)}│`);
    }

    if (task.branch) {
      const branchLine = `🌿 分支: ${task.branch}`;
      console.log(`│ ${padByDisplayWidth(branchLine, width - 4)}│`);
    }

    if (task.subtaskIds && task.subtaskIds.length > 0) {
      const subtaskLine = `📎 子任务: ${task.subtaskIds.length} 个`;
      console.log(`│ ${padByDisplayWidth(subtaskLine, width - 4)}│`);
    }

    if (task.parentId) {
      const parentLine = `⬆️ 父任务: ${task.parentId}`;
      console.log(`│ ${padByDisplayWidth(parentLine, width - 4)}│`);
    }
  }

  // 时间行 - 合并为更紧凑的一行
  console.log(`├${hLine}┤`);
  const createdTime = formatLocalTime(task.createdAt);
  const updatedTime = formatRelativeTime(task.updatedAt);
  // 合并创建和更新时间到一行显示
  const timeLine = `📅 ${createdTime} · 更新: ${updatedTime}`;
  console.log(`│ ${padByDisplayWidth(timeLine, width - 4)}│`);

  // 重开次数显示（如果有）
  if (task.reopenCount && task.reopenCount > 0) {
    const reopenLine = `   🔁 重开 ${task.reopenCount} 次`;
    console.log(`│ ${padByDisplayWidth(reopenLine, width - 4)}│`);
  }

  console.log(`╰${hLine}╯`);
  console.log('');
}

/**
 * 经典格式 - 详细输出
 */
function showTaskClassic(
  task: TaskMeta,
  options: { verbose?: boolean; checkpoints?: boolean },
  cwd: string
): void {
  const line = '━'.repeat(60);
  const statusIcon = getStatusIcon(task.status);

  console.log('');
  console.log(`${statusIcon} ${task.id}`);
  console.log(line);
  console.log(`  ${task.title}`);
  console.log('');
  console.log(`  状态: ${formatStatus(task.status)}  │  优先级: ${formatPriority(task.priority)}  │  类型: ${task.type || '未指定'}`);

  // 描述
  if (task.description) {
    console.log('');
    console.log('📝 描述:');
    const descLines = task.description.split('\n');
    descLines.forEach(descLine => {
      console.log(`   ${descLine}`);
    });
  }

  // verbose 模式显示更多字段
  if (options.verbose) {
    console.log('');
    console.log(line);
    console.log('📋 详细信息');
    console.log(line);

    if (task.recommendedRole) {
      console.log(`   👤 推荐角色: ${task.recommendedRole}`);
    }

    if (task.branch) {
      console.log(`   🌿 关联分支: ${task.branch}`);
    }

    if (task.dependencies.length > 0) {
      console.log(`   🔗 依赖: ${task.dependencies.join(', ')}`);
    } else {
      console.log(`   🔗 依赖: 无`);
    }

    if (task.subtaskIds && task.subtaskIds.length > 0) {
      console.log(`   📎 子任务: ${task.subtaskIds.join(', ')}`);
    }

    if (task.parentId) {
      console.log(`   ⬆️  父任务: ${task.parentId}`);
    }

    if (task.checkpointConfirmationToken) {
      console.log(`   🔐 验证令牌: ${task.checkpointConfirmationToken}`);
    }
  } else {
    // 标准模式只显示关键字段
    if (task.recommendedRole) {
      console.log(`   👤 推荐角色: ${task.recommendedRole}`);
    }

    if (task.branch) {
      console.log(`   🌿 关联分支: ${task.branch}`);
    }

    if (task.dependencies.length > 0) {
      console.log(`   🔗 依赖: ${task.dependencies.join(', ')}`);
    }
  }

  // 时间信息
  console.log('');
  console.log(line);
  console.log('⏱️  时间信息');
  console.log(line);
  console.log(`   创建: ${formatLocalTime(task.createdAt)} (${formatRelativeTime(task.createdAt)})`);
  console.log(`   更新: ${formatLocalTime(task.updatedAt)} (${formatRelativeTime(task.updatedAt)})`);

  if (task.reopenCount && task.reopenCount > 0) {
    console.log(`   重开次数: ${task.reopenCount}`);
  }

  // 显示需求变更历史（verbose 模式或有变更时）
  if (task.requirementHistory && task.requirementHistory.length > 0) {
    console.log(`   需求变更: ${task.requirementHistory.length} 次`);
    if (options.verbose) {
      console.log('');
      console.log(line);
      console.log('📝 需求变更历史:');
      console.log(line);
      task.requirementHistory.forEach((entry) => {
        const timeStr = formatLocalTime(entry.timestamp);
        console.log(`\n   [v${entry.version}] ${timeStr}`);
        console.log(`      变更原因: ${entry.changeReason}`);
        if (entry.impactAnalysis) {
          console.log(`      影响分析: ${entry.impactAnalysis}`);
        }
        if (entry.relatedIssue) {
          console.log(`      关联Issue: ${entry.relatedIssue}`);
        }
      });
    }
  }

  // 显示检查点
  const taskDir = path.join(getTasksDir(cwd), task.id);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  console.log('');

  // 如果使用 --checkpoints 或 --verbose，显示详细的检查点元数据
  if (options.checkpoints || options.verbose) {
    const checkpointsMeta = listCheckpoints(task.id, cwd);

    if (checkpointsMeta.length > 0) {
      console.log(line);
      console.log('✅ 检查点');
      console.log(line);
      console.log('');

      const completedCount = checkpointsMeta.filter(cp => cp.status === 'completed').length;
      console.log(`   进度: ${completedCount}/${checkpointsMeta.length} 已完成`);
      console.log('');

      checkpointsMeta.forEach((cp, index) => {
        const cpIcon = cp.status === 'completed' ? '✅' :
                       cp.status === 'failed' ? '❌' :
                       cp.status === 'skipped' ? '⏭️' : '⬜';

        console.log(`   ${index + 1}. ${cpIcon} ${cp.description}`);
        if (cp.note) {
          console.log(`      备注: ${cp.note}`);
        }
        if (cp.verification?.result) {
          console.log(`      验证: ${cp.verification.result}`);
        }
      });
    }
  } else if (fs.existsSync(checkpointPath)) {
    // 默认显示 checkpoint.md 内容，格式化输出
    console.log(line);
    console.log('✅ 检查点');
    console.log(line);
    console.log('');

    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const checkpointLines = content.split('\n').filter(l => l.trim().startsWith('- ['));

    if (checkpointLines.length > 0) {
      const completedCount = checkpointLines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
      console.log(`   进度: ${completedCount}/${checkpointLines.length} 已完成`);
      console.log('');

      checkpointLines.forEach((l, index) => {
        const isChecked = l.includes('[x]') || l.includes('[X]');
        const cpIcon = isChecked ? '✅' : '⬜';
        const text = l.replace(/- \[[xX ]\] /, '').trim();
        console.log(`   ${index + 1}. ${cpIcon} ${text}`);
      });
    } else {
      console.log('   暂无检查点');
    }
  }

  // verbose 模式显示历史摘要（最多5条详细记录）
  if (options.verbose && task.history && task.history.length > 0) {
    console.log('');
    console.log(line);
    console.log('📜 变更历史');
    console.log(line);
    console.log('');

    const meaningfulHistory = task.history.filter(entry => {
      if (!entry.field) return true;
      return entry.oldValue !== entry.newValue;
    });

    // 统计摘要
    const statusChanges = meaningfulHistory.filter(e => e.field === 'status').length;
    const priorityChanges = meaningfulHistory.filter(e => e.field === 'priority').length;
    const otherChanges = meaningfulHistory.length - statusChanges - priorityChanges;

    console.log(`   📊 摘要: 共 ${meaningfulHistory.length} 条变更`);
    console.log(`      - 状态变更: ${statusChanges} 次`);
    console.log(`      - 优先级变更: ${priorityChanges} 次`);
    console.log(`      - 其他变更: ${otherChanges} 次`);
    console.log('');

    // 显示最近10条详细记录
    const sortedHistory = [...meaningfulHistory].reverse();
    const maxDisplay = 10;
    const displayHistory = sortedHistory.slice(0, maxDisplay);

    console.log('   最近变更:');
    for (const entry of displayHistory) {
      const timeStr = formatLocalTime(entry.timestamp);
      console.log(`   [${timeStr}] ${entry.action}`);
      if (entry.field && entry.oldValue !== undefined && entry.newValue !== undefined) {
        console.log(`      ${entry.field}: ${entry.oldValue} → ${entry.newValue}`);
      }
    }

    if (sortedHistory.length > maxDisplay) {
      console.log('');
      console.log(`   ... 还有 ${sortedHistory.length - maxDisplay} 条历史记录`);
      console.log(`   使用 --history 选项查看完整历史`);
    }
  }

  console.log('');
}

/**
 * 文本换行辅助函数
 */
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let currentLine = '';
    const words = paragraph.split(' ');

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

/**
 * 更新任务
 * 支持子任务状态同步
 */
export async function updateTask(
  taskId: string,
  options: {
    title?: string;
    priority?: string;
    status?: string;
    description?: string;
    role?: string;
    branch?: string;
    needsDiscussion?: boolean;
    token?: string;
    syncChildren?: boolean;
    noSync?: boolean;
  },
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // P1-003: 检查点双触发机制
  if (options.status === 'resolved') {
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');

    // 第一次调用：没有token
    if (!options.token) {
      // 检查是否有检查点文件
      if (!fs.existsSync(checkpointPath)) {
        // 没有检查点文件，直接更新状态
        task.status = options.status as TaskStatus;
        writeTaskMeta(task, cwd);
        console.log(`✅ 任务 ${taskId} 已更新为已解决状态`);
        return;
      }

      // 有检查点文件，检查是否所有检查点都已完成
      const checkpoints = parseCheckpoints(checkpointPath);
      const uncheckedCheckpoints = checkpoints.filter(cp => !cp.checked);

      if (uncheckedCheckpoints.length > 0) {
        // 有未完成的检查点，显示提醒
        console.log('');
        console.log('━'.repeat(60));
        console.log('⚠️  检查点确认提醒');
        console.log('━'.repeat(60));
        console.log('');
        console.log('在将任务标记为已解决之前，请先完成以下检查点:');
        console.log('');
        uncheckedCheckpoints.forEach((cp, idx) => {
          console.log(`  ${idx + 1}. ${cp.text}`);
        });
        console.log('');
        console.log('━'.repeat(60));
        console.log('完成检查点后，请运行以下命令验证:');
        console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
        console.log('');
        console.log('验证后会生成确认令牌，使用令牌完成任务更新:');
        console.log(`   projmnt4claude task update ${taskId} --status resolved --token <token>`);
        console.log('');
        return;
      }

      // 所有检查点已完成，但没有token，      console.log('');
      console.log('━'.repeat(60));
      console.log('⚠️  检查点确认提醒');
      console.log('━'.repeat(60));
      console.log('');
      console.log('所有检查点已完成，但缺少确认令牌。');
      console.log('');
      console.log('请先运行以下命令验证检查点并获取令牌:');
      console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
      console.log('');
      return;
    }

    // 第二次调用：有token
    if (options.token) {
      // 验证token是否匹配
      if (task.checkpointConfirmationToken !== options.token) {
        console.error('错误: 无效的确认令牌');
        console.log('');
        console.log('请运行以下命令重新获取令牌:');
        console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
        process.exit(1);
      }

      // token匹配，更新状态并清除token
      task.status = options.status as TaskStatus;
      task.checkpointConfirmationToken = undefined;
      writeTaskMeta(task, cwd);
      console.log(`✅ 任务 ${taskId} 已更新为已解决状态`);
      return;
    }
  }

  // 其他状态更新，正常处理
  let updated = false;

  if (options.title) {
    task.title = options.title;
    updated = true;
  }
  if (options.priority) {
    task.priority = options.priority as TaskPriority;
    updated = true;
  }
  if (options.status) {
    const oldStatus = task.status;
    task.status = options.status as TaskStatus;

    // 当状态变为 reopened 时，递增 reopenCount
    if (options.status === 'reopened' && oldStatus !== 'reopened') {
      task.reopenCount = (task.reopenCount || 0) + 1;
      console.log(`📊 任务重开次数: ${task.reopenCount}`);
    }

    updated = true;
  }
  if (options.description !== undefined) {
    task.description = options.description || undefined;
    updated = true;
  }
  if (options.role) {
    task.recommendedRole = options.role;
    updated = true;
  }
  if (options.branch) {
    task.branch = options.branch;
    updated = true;
  }
  if (options.needsDiscussion !== undefined) {
    task.needsDiscussion = options.needsDiscussion;
    updated = true;
  }

  if (!updated) {
    console.log('没有指定要更新的字段');
    return;
  }

  writeTaskMeta(task, cwd);
  console.log(`✅ 任务 ${taskId} 已更新`);

  // P1修复: 子任务状态同步
  if ((options.status === 'resolved' || options.status === 'closed') && !options.noSync) {
    const childTasks = task.subtaskIds || [];

    if (childTasks.length > 0) {
      console.log('');
      console.log(`⚠️  检测到 ${childTasks.length} 个子任务:`);

      // 显示子任务当前状态
      for (const childId of childTasks) {
        const childTask = readTaskMeta(childId, cwd);
        if (childTask) {
          console.log(`   - ${childId} (status: ${childTask.status})`);
        }
      }

      // 如果明确指定了 syncChildren，或者用户交互确认
      if (options.syncChildren) {
        // 自动同步子任务状态
        for (const childId of childTasks) {
          const childTask = readTaskMeta(childId, cwd);
          if (childTask && childTask.status !== 'resolved' && childTask.status !== 'closed') {
            childTask.status = options.status as TaskStatus;

            // 添加历史记录
            if (!childTask.history) {
              childTask.history = [];
            }
            childTask.history.push({
              timestamp: new Date().toISOString(),
              action: `状态同步自父任务 ${taskId}`,
              field: 'status',
              oldValue: childTask.status,
              newValue: options.status,
              reason: '父任务已完成，子任务功能已在父任务中实现',
            });

            writeTaskMeta(childTask, cwd);
            console.log(`   ✅ ${childId} 已同步为 ${options.status}`);
          }
        }
        console.log('');
        console.log(`✅ 已同步 ${childTasks.length} 个子任务的状态`);
      } else {
        console.log('');
        console.log('提示: 使用 --sync-children 参数可自动同步子任务状态');
        console.log(`      projmnt4claude task update ${taskId} --status ${options.status} --sync-children`);
      }
    }
  }
}

/**
 * 提交任务等待验证
 *
 * 将任务状态设置为 wait_complete，等待质量门禁验证
 * 等价于: projmnt4claude task update TASK-xxx --status wait_complete
 */
export async function submitTask(
  taskId: string,
  options: {
    note?: string;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // 检查当前状态是否允许提交
  const allowedStatuses: TaskStatus[] = ['in_progress', 'open'];
  if (!allowedStatuses.includes(task.status)) {
    console.error(`错误: 任务当前状态为 '${task.status}'，只有 ${allowedStatuses.join(', ')} 状态的任务可以提交`);
    process.exit(1);
  }

  const oldStatus = task.status;

  // 更新状态为 wait_complete
  task.status = 'wait_complete' as TaskStatus;

  // 记录历史
  const historyEntry: TaskHistoryEntry = {
    timestamp: new Date().toISOString(),
    action: `提交等待验证: ${oldStatus} -> wait_complete`,
    field: 'status',
    oldValue: oldStatus,
    newValue: 'wait_complete',
    user: process.env.USER || undefined,
  };

  if (options.note) {
    historyEntry.reason = options.note;
  }

  if (!task.history) {
    task.history = [];
  }
  task.history.push(historyEntry);

  writeTaskMeta(task, cwd);

  console.log('');
  console.log('━'.repeat(60));
  console.log('📤 任务已提交等待验证');
  console.log('━'.repeat(60));
  console.log('');
  console.log(`任务ID: ${taskId}`);
  console.log(`标题: ${task.title}`);
  console.log(`状态: ${oldStatus} → wait_complete`);
  console.log('');
  console.log('验证将通过以下方式自动执行:');
  console.log('  1. Claude Code hooks 在后续操作时触发');
  console.log('  2. 运行 projmnt4claude task validate 命令');
  console.log('');
  console.log('验证通过后，任务状态将自动更新为 resolved');
  console.log('');
}

/**
 * 验证 wait_complete 状态的任务
 *
 * 执行验证并更新任务状态
 */
export async function validateTask(
  taskId: string,
  options: {
    executeCommands?: boolean;
    autoResolve?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  // 动态导入避免循环依赖
  const { validateTaskCompletion, generateValidationReport } = await import('../utils/validation.js');

  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  if (task.status !== 'wait_complete') {
    console.error(`错误: 任务状态为 '${task.status}'，只有 wait_complete 状态的任务可以验证`);
    console.log('');
    console.log('提示: 先提交任务等待验证');
    console.log(`      projmnt4claude task submit ${taskId}`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('🔍 开始验证任务');
  console.log('━'.repeat(60));
  console.log('');

  // 执行验证
  const result = await validateTaskCompletion(taskId, cwd, {
    executeCommands: options.executeCommands !== false,
    collectEvidence: true,
  });

  // 输出验证报告
  const report = generateValidationReport(taskId, result);
  console.log(report);

  if (result.valid) {
    if (options.autoResolve !== false) {
      // 自动更新为 resolved
      task.status = 'resolved' as TaskStatus;

      const historyEntry: TaskHistoryEntry = {
        timestamp: new Date().toISOString(),
        action: '验证通过，状态更新为 resolved',
        field: 'status',
        oldValue: 'wait_complete',
        newValue: 'resolved',
        user: process.env.USER || undefined,
      };

      if (!task.history) {
        task.history = [];
      }
      task.history.push(historyEntry);

      writeTaskMeta(task, cwd);
      console.log('✅ 任务状态已更新为 resolved');
    } else {
      console.log('✅ 验证通过，可手动更新状态:');
      console.log(`   projmnt4claude task update ${taskId} --status resolved`);
    }
  } else {
    // 验证失败，返回 in_progress
    task.status = 'in_progress';

    const historyEntry: TaskHistoryEntry = {
      timestamp: new Date().toISOString(),
      action: '验证失败，返回开发状态',
      field: 'status',
      oldValue: 'wait_complete',
      newValue: 'in_progress',
      reason: result.errors.map(e => e.message).join('; '),
      user: process.env.USER || undefined,
    };

    if (!task.history) {
      task.history = [];
    }
    task.history.push(historyEntry);

    writeTaskMeta(task, cwd);
    console.log('❌ 任务已返回 in_progress 状态，请修复问题后重新提交');
  }
}

/**
 * 删除任务（归档）
 */
export async function deleteTask(taskId: string, force: boolean = false, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // 确认删除
  if (!force) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `确定要删除任务 ${taskId} 吗？`,
      initial: false,
    });

    if (!response.confirm) {
      console.log('已取消删除');
      return;
    }
  }

  // 移动到归档目录
  const tasksDir = getTasksDir(cwd);
  const archiveDir = getArchiveDir(cwd);
  const taskPath = path.join(tasksDir, taskId);
  const archivePath = path.join(archiveDir, taskId);

  // 确保归档目录存在
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  // 更新状态为 abandoned
  task.status = 'abandoned';
  writeTaskMeta(task, cwd);

  // 移动目录
  fs.renameSync(taskPath, archivePath);

  console.log(`✅ 任务 ${taskId} 已归档`);
}

/**
 * 添加任务依赖
 */
export function addDependency(taskId: string, depId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const depTask = readTaskMeta(depId, cwd);
  if (!depTask) {
    console.error(`错误: 依赖任务 '${depId}' 不存在`);
    process.exit(1);
  }

  if (task.dependencies.includes(depId)) {
    console.log(`任务 ${taskId} 已依赖 ${depId}`);
    return;
  }

  // 检查循环依赖
  if (wouldCreateCycle(taskId, depId, cwd)) {
    console.error(`错误: 添加依赖 ${depId} 会造成循环依赖`);
    process.exit(1);
  }

  task.dependencies.push(depId);
  writeTaskMeta(task, cwd);

  console.log(`✅ 已添加依赖: ${taskId} -> ${depId}`);
}

/**
 * 移除任务依赖
 */
export function removeDependency(taskId: string, depId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const index = task.dependencies.indexOf(depId);
  if (index === -1) {
    console.log(`任务 ${taskId} 不依赖 ${depId}`);
    return;
  }

  task.dependencies.splice(index, 1);
  writeTaskMeta(task, cwd);

  console.log(`✅ 已移除依赖: ${taskId} -/-> ${depId}`);
}

/**
 * 检查是否会造成循环依赖
 */
function wouldCreateCycle(taskId: string, depId: string, cwd: string): boolean {
  const visited = new Set<string>();
  const queue: string[] = [depId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const task = readTaskMeta(current, cwd);
    if (task) {
      queue.push(...task.dependencies);
    }
  }

  return false;
}

/**
 * 格式化优先级
 * 支持两种格式: P0/P1/P2/P3/Q1-Q4 和 low/medium/high/urgent
 */
function formatPriority(priority: TaskPriority | string): string {
  const map: Record<string, string> = {
    // P0-P3 格式
    P0: '🔴 P0 紧急',
    P1: '🟠 P1 高',
    P2: '🟡 P2 中',
    P3: '🟢 P3 低',
    // Q1-Q4 象限格式
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
    // low-urgent 格式（兼容旧数据）
    low: '🟢 低',
    medium: '🟡 中',
    high: '🟠 高',
    urgent: '🔴 紧急',
  };
  return map[priority] || `❓ ${priority}`;
}

/**
 * 格式化状态
 * 支持所有状态格式
 */
function formatStatus(status: TaskStatus | string): string {
  const map: Record<string, string> = {
    open: '⬜ 待处理',
    in_progress: '🔵 进行中',
    resolved: '✅ 已解决',
    closed: '⚫ 已关闭',
    reopened: '🔄 已重开',
    abandoned: '❌ 已放弃',
    // 兼容旧状态
    pending: '⬜ 待处理',
    completed: '✅ 已完成',
    cancelled: '❌ 已取消',
    reopen: '🔄 已重开',
  };
  return map[status] || `❓ ${status}`;
}

/**
 * 显示状态转换指导 (P2-004)
 * 帮助用户理解任务状态流转
 */
export function showStatusGuide(): void {
  console.log('');
  console.log('━'.repeat(60));
  console.log('📋 任务状态转换指南');
  console.log('━'.repeat(60));
  console.log('');

  console.log('📊 状态说明:');
  console.log('');
  console.log('  ⬜ open        - 待处理，任务已创建等待开始');
  console.log('  🔵 in_progress - 进行中，任务正在执行');
  console.log('  ✅ resolved    - 已解决，任务完成并通过验证');
  console.log('  ⚫ closed      - 已关闭，任务最终确认完成');
  console.log('  🔄 reopened    - 已重开，之前完成的任务发现问题需要重新处理');
  console.log('  ❌ abandoned   - 已放弃，任务不再需要');
  console.log('');

  console.log('━'.repeat(60));
  console.log('🔄 状态转换矩阵:');
  console.log('');

  console.log('  open → in_progress');
  console.log('       └─ 命令: task update <id> --status in_progress');
  console.log('       └─ 说明: 开始执行任务');
  console.log('');

  console.log('  in_progress → resolved');
  console.log('       └─ 命令: task checkpoint <id> -y  或');
  console.log('              task update <id> --status resolved --token <token>');
  console.log('       └─ 说明: 完成所有检查点并验证');
  console.log('');

  console.log('  resolved → closed');
  console.log('       └─ 命令: task update <id> --status closed');
  console.log('       └─ 说明: 最终确认任务完成');
  console.log('');

  console.log('  resolved/closed → reopened');
  console.log('       └─ 命令: task update <id> --status reopened');
  console.log('       └─ 说明: 发现问题需要重新处理');
  console.log('');

  console.log('  任意状态 → abandoned');
  console.log('       └─ 命令: task delete <id>');
  console.log('       └─ 说明: 任务不再需要');
  console.log('');

  console.log('━'.repeat(60));
  console.log('💡 快捷命令:');
  console.log('');
  console.log('  task execute <id>     - 开始执行任务（自动设为 in_progress）');
  console.log('  task checkpoint <id>  - 验证检查点并获取完成令牌');
  console.log('  task complete <id>    - 一键完成任务（P2-005 新增）');
  console.log('');

  console.log('━'.repeat(60));
}

/**
 * 一键完成任务 (P2-005)
 * 自动执行：验证检查点 → 更新状态为 resolved
 */
export async function completeTask(
  taskId: string,
  options: { yes?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`🚀 一键完成任务: ${taskId}`);
  console.log('━'.repeat(60));
  console.log('');

  // 检查检查点
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (fs.existsSync(checkpointPath)) {
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

    if (lines.length > 0) {
      const unchecked = lines.filter(line => !line.includes('[x]') && !line.includes('[X]'));

      if (unchecked.length > 0) {
        console.log('⚠️  发现未完成的检查点:');
        unchecked.forEach((line, idx) => {
          const text = line.replace(/- \[[xX ]\] /, '').trim();
          console.log(`   ${idx + 1}. ${text}`);
        });
        console.log('');

        if (!options.yes) {
          const response = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: '是否标记所有检查点为已完成并继续?',
            initial: false,
          });

          if (!response.proceed) {
            console.log('已取消。请先完成检查点后再试。');
            return;
          }
        }

        // 自动标记所有检查点为已完成
        let newContent = content;
        for (const line of unchecked) {
          newContent = newContent.replace(line, line.replace('[ ]', '[x]'));
        }
        fs.writeFileSync(checkpointPath, newContent, 'utf-8');
        console.log('✅ 已自动标记所有检查点为已完成');
      }
    }
  }

  // 更新任务状态
  task.status = 'resolved' as TaskStatus;
  writeTaskMeta(task, cwd);

  console.log('');
  console.log('━'.repeat(60));
  console.log(`🎉 任务 ${taskId} 已完成！`);
  console.log('');
  console.log(`   标题: ${task.title}`);
  console.log(`   状态: ✅ 已解决`);
  console.log('');
  console.log('━'.repeat(60));

  // CP-FEAT-008-01: 完成说明提示
  if (!options.yes) {
    console.log('');
    console.log('💡 提示: 建议为任务添加完成说明，记录解决方案和经验');
    console.log('');

    const addNote = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '是否添加完成说明?',
      initial: true,
    });

    if (addNote.confirm) {
      const noteResponse = await prompts({
        type: 'text',
        name: 'note',
        message: '请输入完成说明（解决方案、关键决策等）:',
        validate: (value) => value.trim().length > 0 ? true : '说明不能为空',
      });

      if (noteResponse.note) {
        // 添加到历史记录
        if (!task.history) {
          task.history = [];
        }
        task.history.push({
          timestamp: new Date().toISOString(),
          action: '添加完成说明',
          field: 'completionNote',
          newValue: noteResponse.note,
        });

        // 更新任务描述或添加 notes
        const taskDir = path.join(getTasksDir(cwd), taskId);
        const notesDir = path.join(taskDir, 'notes');
        if (!fs.existsSync(notesDir)) {
          fs.mkdirSync(notesDir, { recursive: true });
        }
        const notePath = path.join(notesDir, `completion-${new Date().toISOString().slice(0, 10)}.md`);
        fs.writeFileSync(notePath, `# 完成说明\n\n${noteResponse.note}\n`, 'utf-8');

        writeTaskMeta(task, cwd);
        console.log('');
        console.log('✅ 完成说明已保存');
      }
    }
  }
}

/**
 * 显示任务历史记录 (P2-006)
 * 查看任务的完整变更历史
 */
export function showTaskHistory(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`📜 任务历史: ${taskId}`);
  console.log('━'.repeat(60));
  console.log('');
  console.log(`📌 标题: ${task.title}`);
  console.log(`📊 当前状态: ${formatStatus(task.status)}`);
  console.log('');

  if (!task.history || task.history.length === 0) {
    console.log('暂无历史记录');
    console.log('');
    return;
  }

  console.log('━'.repeat(60));
  console.log('📝 变更历史:');
  console.log('');

  // 过滤并按时间倒序显示（与 showTaskCompactHistory 保持一致）
  const meaningfulHistory = task.history.filter(entry => {
    // 保留没有字段变更的记录（如"添加完成说明"等）
    if (!entry.field) return true;
    // 过滤掉相同值的状态变更
    return entry.oldValue !== entry.newValue;
  });
  const sortedHistory = [...meaningfulHistory].reverse();

  for (const entry of sortedHistory) {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    console.log(`[${timeStr}] ${entry.action}`);

    if (entry.field && entry.oldValue !== undefined && entry.newValue !== undefined) {
      console.log(`         字段: ${entry.field}`);
      console.log(`         旧值: ${entry.oldValue}`);
      console.log(`         新值: ${entry.newValue}`);
    }

    if (entry.reason) {
      console.log(`         原因: ${entry.reason}`);
    }

    if (entry.relatedIssue) {
      console.log(`         关联: ${entry.relatedIssue}`);
    }

    if (entry.verificationDetails) {
      console.log(`         详情: ${entry.verificationDetails}`);
    }

    console.log('');
  }

  console.log('━'.repeat(60));
  console.log(`📊 统计: 共 ${task.history.length} 条历史记录`);
  console.log('');
}

/**
 * 添加历史记录条目
 */
export function addHistoryEntry(
  taskId: string,
  entry: {
    action: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
    reason?: string;
    relatedIssue?: string;
    verificationDetails?: string;
  },
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) return;

  if (!task.history) {
    task.history = [];
  }

  task.history.push({
    timestamp: new Date().toISOString(),
    action: entry.action,
    field: entry.field,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    reason: entry.reason,
    relatedIssue: entry.relatedIssue,
    verificationDetails: entry.verificationDetails,
  });

  writeTaskMeta(task, cwd);
}

/**
 * 执行任务引导 (P-018, P-019, P-020)
 * 显示任务详情、检查点清单，引导用户完成任务
 */
export async function executeTask(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!isValidTaskId(taskId)) {
    console.error(`错误: 无效的任务ID格式 '${taskId}'`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`📋 任务执行引导: ${task.id}`);
  console.log('━'.repeat(60));
  console.log('');

  // P-019: 如果任务状态为 reopened，特别提示用户
  if (task.status === 'reopened') {
    console.log('⚠️  警告: 此任务已被重新打开！');
    console.log('   请仔细调查任务历史，了解之前为什么被关闭后又重新打开。');
    console.log('   建议先查看任务详情和检查点记录。');
    console.log('');
  }

  // 显示任务基本信息
  console.log(`📌 标题: ${task.title}`);
  console.log(`📊 状态: ${formatStatus(task.status)}`);
  console.log(`🎯 优先级: ${formatPriority(task.priority)}`);

  if (task.description) {
    console.log(`📝 描述: ${task.description}`);
  }

  if (task.recommendedRole) {
    console.log(`👤 推荐角色: ${task.recommendedRole}`);
  }

  if (task.branch) {
    console.log(`🌿 关联分支: ${task.branch}`);
  }

  // 检查依赖状态
  if (task.dependencies.length > 0) {
    console.log('');
    console.log('🔗 依赖任务:');
    const depsStatus = task.dependencies.map(depId => {
      const depTask = readTaskMeta(depId, cwd);
      const status = depTask
        ? (depTask.status === 'resolved' || depTask.status === 'closed' ? '✅' : '❌')
        : '❓';
      return `   ${status} ${depId}`;
    });
    console.log(depsStatus.join('\n'));

    // 检查是否有未完成的依赖
    const uncompletedDeps = task.dependencies.filter(depId => {
      const depTask = readTaskMeta(depId, cwd);
      return !depTask || (depTask.status !== 'resolved' && depTask.status !== 'closed');
    });

    if (uncompletedDeps.length > 0) {
      console.log('');
      console.log('⚠️  注意: 存在未完成的依赖任务，建议先完成依赖项。');
    }
  }

  // 读取检查点
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  console.log('');
  console.log('━'.repeat(60));
  console.log('✅ 检查点清单');
  console.log('━'.repeat(60));

  if (fs.existsSync(checkpointPath)) {
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    console.log(content);
  } else {
    console.log('暂无检查点');
  }

  // 工作引导
  console.log('');
  console.log('━'.repeat(60));
  console.log('💡 工作建议');
  console.log('━'.repeat(60));
  console.log('');
  console.log('1. 仔细阅读任务描述和检查点要求');
  console.log('2. 按照检查点逐项完成工作');
  console.log('3. 完成后运行以下命令验证检查点:');
  console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
  console.log('4. 验证后会生成确认令牌，复制令牌');
  console.log('5. 使用令牌完成任务状态更新:');
  console.log(`   projmnt4claude task update ${taskId} --status resolved --token <令牌>`);
  console.log('');

  // 如果任务状态是 open，询问是否开始工作
  if (task.status === 'open') {
    const response = await prompts({
      type: 'confirm',
      name: 'start',
      message: '是否将任务状态更新为"进行中"?',
      initial: true,
    });

    if (response.start) {
      task.status = 'in_progress' as TaskStatus;
      writeTaskMeta(task, cwd);
      console.log(`✅ 任务 ${taskId} 状态已更新为"进行中"`);
    }
  }
}

/**
 * 完成检查点确认 (P-020)
 * 交互式确认检查点，并提示更新状态
 * 支持非交互模式 (--yes)
 */
export async function completeCheckpoint(
  taskId: string,
  options: { yes?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) {
    console.log('暂无检查点文件');
    return;
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

  if (lines.length === 0) {
    console.log('检查点文件中没有找到检查项');
    return;
  }

  console.log('');
  console.log('📋 检查点确认');
  console.log('━'.repeat(60));
  console.log('');

  let allPassed = true;
  const updatedLines: string[] = [];

  for (const line of lines) {
    const isChecked = line.includes('[x]') || line.includes('[X]');
    const checkText = line.replace(/- \[[xX ]\] /, '').trim();

    if (!isChecked) {
      // 非交互模式：假设所有未完成的检查点都已通过
      if (options.yes) {
        updatedLines.push(line.replace('[ ]', '[x]'));
        console.log(`   ✅ ${checkText} (自动确认)`);
      } else {
        // 交互模式：询问用户
        const response = await prompts({
          type: 'confirm',
          name: 'passed',
          message: `检查点: ${checkText}`,
          initial: false,
        });

        if (response.passed) {
          updatedLines.push(line.replace('[ ]', '[x]'));
          console.log(`   ✅ 已通过`);
        } else {
          updatedLines.push(line);
          allPassed = false;
          console.log(`   ❌ 未通过`);
        }
      }
    } else {
      updatedLines.push(line);
    }
  }

  // 更新检查点文件
  let newContent = content;
  for (let i = 0; i < lines.length; i++) {
    newContent = newContent.replace(lines[i]!, updatedLines[i]!);
  }
  fs.writeFileSync(checkpointPath, newContent, 'utf-8');

  console.log('');
  console.log('━'.repeat(60));

  if (allPassed) {
    console.log('🎉 所有检查点已通过！');
    console.log('');
    console.log('建议运行以下命令完成任务:');
    console.log(`   projmnt4claude task update ${taskId} --status resolved`);

    // 非交互模式：自动标记为已解决
    if (options.yes) {
      task.status = 'resolved' as TaskStatus;
      writeTaskMeta(task, cwd);
      console.log(`✅ 任务 ${taskId} 已自动标记为已解决`);
    } else {
      // 交互模式：询问用户
      const response = await prompts({
        type: 'confirm',
        name: 'complete',
        message: '是否立即将任务标记为已解决?',
        initial: true,
      });

      if (response.complete) {
        task.status = 'resolved' as TaskStatus;
        writeTaskMeta(task, cwd);
        console.log(`✅ 任务 ${taskId} 已标记为已解决`);
      }
    }
  } else {
    console.log('⚠️  部分检查点未通过，请继续工作');
  }
}

/**
 * 验证检查点并生成令牌 (P1-003)
 */
export async function verifyCheckpoint(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  const checkpoints = parseCheckpoints(checkpointPath);

  if (checkpoints.length === 0) {
    console.log('暂无检查点');
    return;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`🔍 检查点验证: ${taskId}`);
  console.log('━'.repeat(60));
  console.log('');

  // 显示检查点状态
  const uncheckedCheckpoints = checkpoints.filter(cp => !cp.checked);
  const checkedCheckpoints = checkpoints.filter(cp => cp.checked);

  console.log(`总计: ${checkpoints.length} 个检查点`);
  console.log(`✅ 已通过: ${checkedCheckpoints.length}`);
  console.log(`⏳ 待完成: ${uncheckedCheckpoints.length}`);
  console.log('');

  if (uncheckedCheckpoints.length > 0) {
    console.log('待完成的检查点:');
    uncheckedCheckpoints.forEach((cp, idx) => {
      console.log(`  ${idx + 1}. ${cp.text}`);
    });
    console.log('');
    console.log('⚠️  请先完成所有检查点后再验证');
    return;
  }

  // 所有检查点已通过，生成令牌
  const token = generateCheckpointToken();
  task.checkpointConfirmationToken = token;
  writeTaskMeta(task, cwd);

  console.log('━'.repeat(60));
  console.log('✅ 所有检查点已验证通过！');
  console.log('');
  console.log('🔐 检查点确认令牌已生成:');
  console.log(`   ${token}`);
  console.log('');
  console.log('请使用以下命令完成任务状态更新:');
  console.log(`   projmnt4claude task update ${taskId} --status resolved --token ${token}`);
  console.log('');
}

/**
 * 添加子任务
 */
export async function addSubtask(
  parentId: string,
  title: string,
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 验证父任务存在
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    console.error(`错误: 父任务 ${parentId} 不存在`);
    process.exit(1);
  }

  // 导入工具函数
  const { generateSubtaskId, addSubtaskToParent } = await import('../utils/task');

  // 生成子任务 ID
  const subtaskId = generateSubtaskId(parentId, cwd);

  // 创建子任务元数据
  const subtask = createDefaultTaskMeta(subtaskId, title);
  subtask.parentId = parentId;
  subtask.priority = parentTask.priority;
  subtask.type = parentTask.type;

  // 写入子任务
  writeTaskMeta(subtask, cwd);

  // 创建 checkpoint.md
  const taskDir = path.join(getTasksDir(cwd), subtaskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  fs.writeFileSync(checkpointPath, `# ${subtaskId} 检查点\n\n- [ ] 检查点1\n- [ ] 检查点2\n`, 'utf-8');

  // 关联到父任务
  addSubtaskToParent(parentId, subtaskId, cwd);

  console.log(`\n✅ 子任务创建成功!`);
  console.log(`   子任务 ID: ${subtaskId}`);
  console.log(`   父任务 ID: ${parentId}`);
  console.log(`   标题: ${title}`);
  console.log(`   优先级: ${formatPriority(subtask.priority)}`);
}

/**
 * 状态规范化映射
 */
function normalizeStatus(status: string): TaskStatus {
  const statusMap: Record<string, TaskStatus> = {
    'pending': 'open',
    'reopen': 'reopened',
    'completed': 'closed',
    'cancelled': 'abandoned',
    'blocked': 'open',
    'open': 'open',
    'in_progress': 'in_progress',
    'resolved': 'resolved',
    'closed': 'closed',
    'reopened': 'reopened',
    'abandoned': 'abandoned',
  };
  return statusMap[status] || 'open';
}

/**
 * 同步父任务状态到子任务
 * 用于将已完成父任务的状态同步到所有子任务
 */
export async function syncChildren(
  parentTaskId: string,
  options: { targetStatus?: string; children?: string[] } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('❌ 错误: 项目尚未初始化');
    process.exit(1);
  }

  // 读取父任务
  const parentTask = readTaskMeta(parentTaskId, cwd);
  if (!parentTask) {
    console.error(`❌ 错误: 任务 ${parentTaskId} 不存在`);
    process.exit(1);
  }

  // 获取子任务列表
  const childrenToSync = options.children || parentTask.subtaskIds || [];

  if (childrenToSync.length === 0) {
    console.log(`\n⚠️  任务 ${parentTaskId} 没有子任务，无需同步`);
    return;
  }

  // 确定目标状态
  const targetStatus = options.targetStatus || parentTask.status;

  console.log(`\n📋 同步子任务状态`);
  console.log(`   父任务: ${parentTaskId} (${parentTask.status})`);
  console.log(`   目标状态: ${targetStatus}`);
  console.log(`   子任务数量: ${childrenToSync.length}`);
  console.log('');

  let syncedCount = 0;
  let skippedCount = 0;

  for (const childId of childrenToSync) {
    const childTask = readTaskMeta(childId, cwd);
    if (!childTask) {
      console.log(`   ⚠️  ${childId}: 不存在，跳过`);
      skippedCount++;
      continue;
    }

    const normalizedChildStatus = normalizeStatus(childTask.status);
    const normalizedTargetStatus = normalizeStatus(targetStatus);

    // 如果子任务已经是目标状态，跳过
    if (normalizedChildStatus === normalizedTargetStatus) {
      console.log(`   ⏭️  ${childId}: 已经是 ${childTask.status}，跳过`);
      skippedCount++;
      continue;
    }

    // 如果子任务已关闭/已放弃，跳过（除非强制同步）
    if (normalizedChildStatus === 'closed' || normalizedChildStatus === 'abandoned') {
      console.log(`   ⏭️  ${childId}: 状态为 ${childTask.status}，跳过`);
      skippedCount++;
      continue;
    }

    // 更新子任务状态
    const oldStatus = childTask.status;
    childTask.status = targetStatus as TaskStatus;

    // 添加历史记录
    addHistoryEntry(
      childId,
      {
        action: `状态从 ${oldStatus} 同步为 ${targetStatus}`,
        field: 'status',
        oldValue: oldStatus,
        newValue: targetStatus,
        reason: `父任务 ${parentTaskId} 状态同步`,
      },
      cwd
    );

    writeTaskMeta(childTask, cwd);
    console.log(`   ✅ ${childId}: ${oldStatus} → ${targetStatus}`);
    syncedCount++;
  }

  console.log('');
  console.log(`✅ 同步完成: ${syncedCount} 个子任务已更新, ${skippedCount} 个跳过`);
}

/**
 * 更新检查点状态
 * 命令: task checkpoint <taskId> <checkpointId> <action> [options]
 */
export async function updateCheckpoint(
  taskId: string,
  checkpointId: string,
  action: 'complete' | 'fail' | 'note' | 'show',
  options: {
    result?: string;
    note?: string;
    yes?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // 确保检查点已同步
  syncCheckpointsToMeta(taskId, cwd);

  switch (action) {
    case 'complete':
      updateCheckpointStatus(taskId, checkpointId, 'completed', {
        result: options.result,
        note: options.note,
      }, cwd);
      console.log(`✅ 检查点 ${checkpointId} 已标记为完成`);
      if (options.result) {
        console.log(`   验证结果: ${options.result}`);
      }
      break;

    case 'fail':
      updateCheckpointStatus(taskId, checkpointId, 'failed', {
        note: options.note,
      }, cwd);
      console.log(`❌ 检查点 ${checkpointId} 已标记为失败`);
      if (options.note) {
        console.log(`   备注: ${options.note}`);
      }
      break;

    case 'note':
      if (!options.note) {
        console.error('错误: 使用 note 操作需要提供 --note 参数');
        process.exit(1);
      }
      // 保持当前状态，只更新备注
      const checkpoint = getCheckpointDetail(taskId, checkpointId, cwd);
      if (!checkpoint) {
        console.error(`错误: 检查点 '${checkpointId}' 不存在`);
        process.exit(1);
      }
      updateCheckpointStatus(taskId, checkpointId, checkpoint.status, {
        note: options.note,
      }, cwd);
      console.log(`📝 检查点 ${checkpointId} 备注已更新`);
      console.log(`   备注: ${options.note}`);
      break;

    case 'show':
      const cpDetail = getCheckpointDetail(taskId, checkpointId, cwd);
      if (!cpDetail) {
        console.error(`错误: 检查点 '${checkpointId}' 不存在`);
        process.exit(1);
      }
      displayCheckpointDetail(cpDetail);
      break;

    default:
      console.error(`错误: 未知操作 '${action}'`);
      process.exit(1);
  }
}

/**
 * 列出任务的所有检查点
 */
export async function listTaskCheckpoints(
  taskId: string,
  options: {
    json?: boolean;
    compact?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const checkpoints = listCheckpoints(taskId, cwd);

  if (options.json) {
    console.log(JSON.stringify(checkpoints, null, 2));
    return;
  }

  if (checkpoints.length === 0) {
    console.log('暂无检查点');
    return;
  }

  const separator = options.compact ? '' : '━'.repeat(60);

  if (!options.compact) {
    console.log('');
    console.log(`📋 检查点列表 (${checkpoints.length} 个)`);
    console.log(separator);
  }

  checkpoints.forEach((cp, index) => {
    const statusIcon = cp.status === 'completed' ? '✅' :
                       cp.status === 'failed' ? '❌' :
                       cp.status === 'skipped' ? '⏭️' : '⏳';

    if (options.compact) {
      console.log(`${statusIcon} ${cp.id}: ${cp.description}`);
    } else {
      console.log(`${index + 1}. ${statusIcon} ${cp.id}`);
      console.log(`   描述: ${cp.description}`);
      console.log(`   状态: ${cp.status}`);
      if (cp.note) {
        console.log(`   备注: ${cp.note}`);
      }
      if (cp.verification?.result) {
        console.log(`   验证结果: ${cp.verification.result}`);
      }
      console.log('');
    }
  });

  if (!options.compact) {
    console.log(separator);
  }
}

/**
 * 拆分任务为多个子任务
 * 命令: task split <taskId> --into <count> 或 --titles "title1,title2,..."
 */
export async function splitTask(
  parentId: string,
  options: {
    into?: number;
    titles?: string;
    nonInteractive?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  // 验证父任务存在
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    console.error(`错误: 父任务 ${parentId} 不存在`);
    process.exit(1);
  }

  // 解析子任务标题
  let subtaskTitles: string[] = [];

  if (options.titles) {
    // 从 --titles 参数解析
    subtaskTitles = options.titles.split(',').map(t => t.trim()).filter(t => t.length > 0);
  } else if (options.into && options.into > 0) {
    // 从 --into 参数生成默认标题
    const count = options.into;
    for (let i = 1; i <= count; i++) {
      subtaskTitles.push(`${parentTask.title} - 部分 ${i}`);
    }
  } else {
    // 交互模式：询问用户
    if (options.nonInteractive) {
      console.error('错误: 非交互模式需要指定 --into 或 --titles');
      process.exit(1);
    }

    const response = await prompts({
      type: 'select',
      name: 'mode',
      message: '选择拆分方式:',
      choices: [
        { title: '按数量拆分 (自动生成标题)', value: 'count' },
        { title: '手动输入子任务标题', value: 'titles' },
      ],
    });

    if (!response.mode) {
      console.log('已取消');
      return;
    }

    if (response.mode === 'count') {
      const countResponse = await prompts({
        type: 'number',
        name: 'count',
        message: '拆分为几个子任务?',
        initial: 2,
        min: 2,
        max: 10,
      });

      if (!countResponse.count) {
        console.log('已取消');
        return;
      }

      for (let i = 1; i <= countResponse.count; i++) {
        subtaskTitles.push(`${parentTask.title} - 部分 ${i}`);
      }
    } else {
      const titlesResponse = await prompts({
        type: 'text',
        name: 'titles',
        message: '输入子任务标题 (用逗号分隔):',
        validate: (value) => {
          const titles = value.split(',').map((t: string) => t.trim()).filter((t: string) => t);
          return titles.length >= 2 ? true : '至少需要 2 个子任务';
        },
      });

      if (!titlesResponse.titles) {
        console.log('已取消');
        return;
      }

      subtaskTitles = titlesResponse.titles.split(',').map((t: string) => t.trim()).filter((t: string) => t);
    }
  }

  if (subtaskTitles.length < 2) {
    console.error('错误: 至少需要拆分为 2 个子任务');
    process.exit(1);
  }

  console.log('');
  console.log(`📦 准备拆分任务: ${parentId}`);
  console.log(`   标题: ${parentTask.title}`);
  console.log(`   子任务数量: ${subtaskTitles.length}`);
  console.log('');

  // 导入工具函数
  const { generateSubtaskId, addSubtaskToParent } = await import('../utils/task');

  const createdSubtaskIds: string[] = [];

  // 创建子任务
  for (let i = 0; i < subtaskTitles.length; i++) {
    const title = subtaskTitles[i];

    // 生成子任务 ID
    const subtaskId = generateSubtaskId(parentId, cwd);

    // 创建子任务元数据
    const subtask = createDefaultTaskMeta(subtaskId, title, parentTask.type || 'feature');
    subtask.parentId = parentId;
    subtask.priority = parentTask.priority;
    subtask.description = `从 ${parentId} 拆分的子任务`;

    // 写入子任务
    writeTaskMeta(subtask, cwd);

    // 创建 checkpoint.md
    const taskDir = path.join(getTasksDir(cwd), subtaskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');
    fs.writeFileSync(checkpointPath, `# ${subtaskId} 检查点\n\n- [ ] 完成任务\n`, 'utf-8');

    // 关联到父任务
    addSubtaskToParent(parentId, subtaskId, cwd);

    createdSubtaskIds.push(subtaskId);
    console.log(`   ✅ 创建子任务: ${subtaskId} - ${title}`);
  }

  // 设置子任务之间的依赖关系（链式依赖）
  for (let i = 1; i < createdSubtaskIds.length; i++) {
    const currentId = createdSubtaskIds[i];
    const prevId = createdSubtaskIds[i - 1];

    const currentTask = readTaskMeta(currentId, cwd);
    if (currentTask) {
      currentTask.dependencies.push(prevId);
      writeTaskMeta(currentTask, cwd);
      console.log(`   🔗 设置依赖: ${currentId} 依赖 ${prevId}`);
    }
  }

  console.log('');
  console.log('✅ 任务拆分完成!');
  console.log('');
  console.log('📋 子任务列表:');
  createdSubtaskIds.forEach((id, index) => {
    const depInfo = index > 0 ? ` (依赖: ${createdSubtaskIds[index - 1]})` : '';
    console.log(`   ${index + 1}. ${id}${depInfo}`);
  });
  console.log('');
  console.log('💡 提示: 使用以下命令查看子任务:');
  console.log(`   projmnt4claude task show ${parentId} --checkpoints`);
}

/**
 * 显示检查点详情
 */
function displayCheckpointDetail(checkpoint: CheckpointMetadata): void {
  console.log('');
  console.log(`📋 检查点详情: ${checkpoint.id}`);
  console.log('━'.repeat(60));
  console.log(`描述: ${checkpoint.description}`);
  console.log(`状态: ${checkpoint.status}`);
  console.log(`创建时间: ${checkpoint.createdAt}`);
  console.log(`更新时间: ${checkpoint.updatedAt}`);

  if (checkpoint.note) {
    console.log('');
    console.log('📝 备注:');
    console.log(`   ${checkpoint.note}`);
  }

  if (checkpoint.verification) {
    console.log('');
    console.log('🔍 验证信息:');
    console.log(`   方法: ${checkpoint.verification.method}`);
    if (checkpoint.verification.commands && checkpoint.verification.commands.length > 0) {
      console.log(`   命令: ${checkpoint.verification.commands.join(', ')}`);
    }
    if (checkpoint.verification.expected) {
      console.log(`   期望结果: ${checkpoint.verification.expected}`);
    }
    if (checkpoint.verification.result) {
      console.log(`   实际结果: ${checkpoint.verification.result}`);
    }
    if (checkpoint.verification.verifiedBy) {
      console.log(`   验证者: ${checkpoint.verification.verifiedBy}`);
    }
    if (checkpoint.verification.verifiedAt) {
      console.log(`   验证时间: ${checkpoint.verification.verifiedAt}`);
    }
  }
  console.log('');
}

/**
 * 搜索任务
 * 命令: task search <keyword>
 */
export function searchTasks(
  keyword: string,
  options: {
    status?: string;
    priority?: string;
    json?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const allTasks = getAllTasks(cwd);
  const lowerKeyword = keyword.toLowerCase();

  // 过滤匹配的任务
  const matchedTasks = allTasks.filter(task => {
    // 状态过滤
    if (options.status && task.status !== options.status) {
      return false;
    }
    // 优先级过滤
    if (options.priority && task.priority !== options.priority) {
      return false;
    }
    // 关键词匹配
    const titleMatch = task.title.toLowerCase().includes(lowerKeyword);
    const descMatch = task.description?.toLowerCase().includes(lowerKeyword) || false;
    const idMatch = task.id.toLowerCase().includes(lowerKeyword);
    return titleMatch || descMatch || idMatch;
  });

  if (options.json) {
    console.log(JSON.stringify(matchedTasks, null, 2));
    return;
  }

  if (matchedTasks.length === 0) {
    console.log(`未找到匹配 "${keyword}" 的任务`);
    return;
  }

  console.log('');
  console.log(`🔍 搜索结果: "${keyword}" (${matchedTasks.length} 个匹配)`);
  console.log('━'.repeat(60));
  console.log('');

  matchedTasks.forEach((task, index) => {
    const statusIcon = task.status === 'resolved' || task.status === 'closed' ? '✅' :
                       task.status === 'in_progress' ? '🔄' : '⏳';
    console.log(`${index + 1}. ${statusIcon} ${task.id}`);
    console.log(`   标题: ${task.title}`);
    console.log(`   状态: ${task.status} | 优先级: ${task.priority}`);
    console.log('');
  });
}

/**
 * 统计任务数量
 * 命令: task count [options]
 * 支持按状态、优先级、类型分组统计
 */
export function countTasks(
  options: {
    status?: string;
    priority?: string;
    type?: string;
    groupBy?: 'status' | 'priority' | 'type' | 'role';
    json?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  let tasks = getAllTasks(cwd);

  // 应用过滤
  if (options.status) {
    tasks = tasks.filter(t => t.status === options.status);
  }
  if (options.priority) {
    tasks = tasks.filter(t => t.priority === options.priority);
  }
  if (options.type) {
    tasks = tasks.filter(t => t.type === options.type);
  }

  // Debug: log options
  if (process.env.DEBUG_COUNT) {
    console.error('DEBUG options:', JSON.stringify(options));
  }

  // 分组统计
  if (options.groupBy) {
    const groups = new Map<string, number>();

    for (const task of tasks) {
      let key: string;
      switch (options.groupBy) {
        case 'status':
          key = task.status || 'open';
          break;
        case 'priority':
          key = task.priority || 'P2';
          break;
        case 'type':
          key = task.type || 'feature';
          break;
        case 'role':
          key = task.recommendedRole || '未分配';
          break;
        default:
          key = '其他';
      }

      groups.set(key, (groups.get(key) || 0) + 1);
    }

    if (options.json) {
      const result = Object.fromEntries(groups);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // 格式化输出
    console.log('');
    console.log('━'.repeat(60));
    console.log(`📊 任务统计 (按${options.groupBy === 'status' ? '状态' : options.groupBy === 'priority' ? '优先级' : options.groupBy === 'type' ? '类型' : '角色'}分组)`);
    console.log('━'.repeat(60));
    console.log('');

    // 定义排序顺序
    const statusOrder = ['open', 'in_progress', 'wait_complete', 'resolved', 'closed', 'reopened', 'abandoned'];
    const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

    let sortedKeys: string[];
    if (options.groupBy === 'status') {
      sortedKeys = [...groups.keys()].sort((a, b) => {
        const idxA = statusOrder.indexOf(a);
        const idxB = statusOrder.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
    } else if (options.groupBy === 'priority') {
      sortedKeys = [...groups.keys()].sort((a, b) => {
        const idxA = priorityOrder.indexOf(a);
        const idxB = priorityOrder.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
    } else {
      sortedKeys = [...groups.keys()].sort();
    }

    for (const key of sortedKeys) {
      const count = groups.get(key)!;
      let label: string;

      switch (options.groupBy) {
        case 'status':
          label = formatStatus(key);
          break;
        case 'priority':
          label = formatPriority(key);
          break;
        case 'type':
          label = `📁 ${key}`;
          break;
        case 'role':
          label = `👤 ${key}`;
          break;
        default:
          label = key;
      }

      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${label.padEnd(20)} ${bar} ${count}`);
    }

    console.log('');
    console.log(`总计: ${tasks.length} 个任务`);
    console.log('');
    return;
  }

  // 总体统计
  const statusCounts = new Map<TaskStatus, number>();
  const priorityCounts = new Map<TaskPriority, number>();
  const typeCounts = new Map<string, number>();

  for (const task of tasks) {
    statusCounts.set(task.status, (statusCounts.get(task.status) || 0) + 1);
    priorityCounts.set(task.priority, (priorityCounts.get(task.priority) || 0) + 1);
    if (task.type) {
      typeCounts.set(task.type, (typeCounts.get(task.type) || 0) + 1);
    }
  }

  if (options.json) {
    const result = {
      total: tasks.length,
      byStatus: Object.fromEntries(statusCounts),
      byPriority: Object.fromEntries(priorityCounts),
      byType: Object.fromEntries(typeCounts),
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 格式化输出
  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 任务统计');
  console.log('━'.repeat(60));
  console.log('');

  // 按状态统计
  console.log('📋 按状态:');
  const statusOrder = ['open', 'in_progress', 'wait_complete', 'resolved', 'closed', 'reopened', 'abandoned'];
  for (const status of statusOrder) {
    const count = statusCounts.get(status as TaskStatus) || 0;
    if (count > 0 || status === 'open' || status === 'in_progress' || status === 'resolved') {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${formatStatus(status).padEnd(16)} ${bar} ${count}`);
    }
  }

  console.log('');

  // 按优先级统计
  console.log('🎯 按优先级:');
  const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];
  for (const priority of priorityOrder) {
    const count = priorityCounts.get(priority as TaskPriority) || 0;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${formatPriority(priority).padEnd(16)} ${bar} ${count}`);
    }
  }

  console.log('');

  // 按类型统计
  if (typeCounts.size > 0) {
    console.log('📁 按类型:');
    for (const [type, count] of typeCounts) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${`📁 ${type}`.padEnd(16)} ${bar} ${count}`);
    }
    console.log('');
  }

  // 总计
  console.log('━'.repeat(60));
  console.log(`📌 总计: ${tasks.length} 个任务`);
  console.log('');

  // 完成率
  const completed = (statusCounts.get('resolved') || 0) + (statusCounts.get('closed') || 0);
  const inProgress = statusCounts.get('in_progress') || 0;
  const pending = statusCounts.get('open') || 0;

  if (tasks.length > 0) {
    const completionRate = ((completed / tasks.length) * 100).toFixed(1);
    console.log(`📈 完成率: ${completionRate}% (${completed}/${tasks.length})`);
    console.log(`🔄 进行中: ${inProgress} | ⏳ 待处理: ${pending}`);
    console.log('');
  }
}

/**
 * 批量更新任务状态
 * 命令: task update --status <status> --all
 */
export async function batchUpdateTasks(
  options: {
    status?: string;
    priority?: string;
    all?: boolean;
    yes?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!options.status && !options.priority) {
    console.error('错误: 批量更新需要指定 --status 或 --priority');
    process.exit(1);
  }

  const allTasks = getAllTasks(cwd);

  // 过滤出需要更新的任务（非已完成/已关闭的任务）
  const tasksToUpdate = options.all
    ? allTasks
    : allTasks.filter(t => t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'abandoned');

  if (tasksToUpdate.length === 0) {
    console.log('没有需要更新的任务');
    return;
  }

  console.log('');
  console.log(`📦 批量更新任务`);
  console.log('━'.repeat(60));
  console.log(`   目标任务数: ${tasksToUpdate.length}`);
  if (options.status) {
    console.log(`   新状态: ${options.status}`);
  }
  if (options.priority) {
    console.log(`   新优先级: ${options.priority}`);
  }
  console.log('');

  // 非交互模式或用户确认
  if (!options.yes) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `确认更新 ${tasksToUpdate.length} 个任务?`,
      initial: false,
    });

    if (!response.confirm) {
      console.log('已取消');
      return;
    }
  }

  // 执行批量更新
  let updatedCount = 0;
  for (const task of tasksToUpdate) {
    let updated = false;

    if (options.status) {
      task.status = options.status as TaskStatus;
      updated = true;
    }
    if (options.priority) {
      task.priority = options.priority as TaskPriority;
      updated = true;
    }

    if (updated) {
      writeTaskMeta(task, cwd);
      updatedCount++;
      console.log(`   ✅ ${task.id}`);
    }
  }

  console.log('');
  console.log(`✅ 批量更新完成: ${updatedCount} 个任务已更新`);
}

/**
 * 检查点模板映射
 * CP-FEAT-008-02: 基于任务类型生成检查点模板
 */
const CHECKPOINT_TEMPLATES: Record<string, string[]> = {
  bug: [
    '复现问题',
    '定位根本原因',
    '实现修复',
    '编写测试用例验证修复',
    '验证不影响其他功能',
    '更新相关文档',
  ],
  feature: [
    '理解需求和设计',
    '实现核心功能',
    '编写单元测试',
    '编写集成测试',
    '更新文档',
    '代码审查',
  ],
  research: [
    '明确研究目标',
    '收集相关信息',
    '分析可行性',
    '记录发现和建议',
    '总结结论',
  ],
  docs: [
    '确定文档范围和受众',
    '收集必要信息',
    '编写文档内容',
    '审阅和校对',
    '发布文档',
  ],
  refactor: [
    '分析现有代码结构',
    '设计重构方案',
    '实现重构',
    '确保测试通过',
    '验证功能不变',
    '更新相关文档',
  ],
  test: [
    '确定测试范围',
    '设计测试用例',
    '实现测试代码',
    '运行测试验证',
    '修复失败的测试',
    '更新测试文档',
  ],
};

/**
 * 生成检查点模板
 * 命令: task checkpoint template <taskId> [--type <type>]
 */
export function generateCheckpointTemplate(
  taskId: string,
  options: {
    type?: string;
    apply?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  // 确定任务类型
  const taskType = options.type || task.type || 'feature';

  // 获取模板
  const template = CHECKPOINT_TEMPLATES[taskType] || CHECKPOINT_TEMPLATES.feature;

  console.log('');
  console.log('━'.repeat(60));
  console.log(`📋 检查点模板: ${taskId}`);
  console.log('━'.repeat(60));
  console.log('');
  console.log(`任务类型: ${taskType}`);
  console.log('');
  console.log('建议的检查点:');
  console.log('');

  template.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item}`);
  });

  console.log('');

  if (options.apply) {
    // 应用模板到任务
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');

    let content = `# ${taskId} 检查点\n\n`;
    template.forEach(item => {
      content += `- [ ] ${item}\n`;
    });
    content += '\n';

    fs.writeFileSync(checkpointPath, content, 'utf-8');
    console.log('✅ 检查点模板已应用到任务');
  } else {
    console.log('💡 使用 --apply 参数将模板应用到任务');
  }

  console.log('');
}

