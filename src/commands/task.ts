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
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
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
 * 创建新任务
 */
export async function createTask(cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
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
        { title: '低', value: 'low' },
        { title: '中 (默认)', value: 'medium' },
        { title: '高', value: 'high' },
        { title: '紧急', value: 'urgent' },
      ],
      initial: 1,
    },
  ]);

  if (!response.title) {
    console.log('已取消创建任务');
    return;
  }

  // 生成任务ID (新格式)
  const taskId = generateNewTaskId(cwd, response.priority, response.title, 'open', '');

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
  fs.writeFileSync(checkpointPath, `# ${taskId} 检查点\n\n- [ ] 检查点1\n- [ ] 检查点2\n`, 'utf-8');

  console.log(`\n✅ 任务创建成功!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   标题: ${task.title}`);
  console.log(`   优先级: ${formatPriority(task.priority)}`);
}

/**
 * 列出所有任务
 */
export function listTasks(options: { status?: string; priority?: string; role?: string; needsDiscussion?: boolean } = {}, cwd: string = process.cwd()): void {
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

  if (tasks.length === 0) {
    console.log('暂无任务');
    return;
  }

  // 分离父任务和子任务
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
 * 显示任务详情
 */
export function showTask(taskId: string, cwd: string = process.cwd()): void {
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
  console.log(`任务: ${task.id}`);
  console.log('='.repeat(50));
  console.log(`标题: ${task.title}`);
  console.log(`状态: ${formatStatus(task.status)}`);
  console.log(`优先级: ${formatPriority(task.priority)}`);

  if (task.description) {
    console.log(`描述: ${task.description}`);
  }

  if (task.recommendedRole) {
    console.log(`推荐角色: ${task.recommendedRole}`);
  }

  if (task.branch) {
    console.log(`关联分支: ${task.branch}`);
  }

  if (task.dependencies.length > 0) {
    console.log(`依赖: ${task.dependencies.join(', ')}`);
  }

  console.log(`创建时间: ${task.createdAt}`);
  console.log(`更新时间: ${task.updatedAt}`);

  // 显示检查点
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  if (fs.existsSync(checkpointPath)) {
    console.log('');
    console.log('检查点:');
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    console.log(content);
  }
}

/**
 * 更新任务
 */
export function updateTask(
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
  },
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
      console.log('⚠️  飀查点确认提醒');
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
    task.status = options.status as TaskStatus;
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
 */
function formatPriority(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    low: '🟢 低',
    medium: '🟡 中',
    high: '🟠 高',
    urgent: '🔴 紧急',
  };
  return map[priority];
}

/**
 * 格式化状态
 */
function formatStatus(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    open: '⬜ 待处理',
    in_progress: '🔵 进行中',
    resolved: '✅ 已解决',
    closed: '⚫ 已关闭',
    reopened: '🔄 已重开',
    abandoned: '❌ 已放弃',
  };
  return map[status];
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
 */
export async function completeCheckpoint(taskId: string, cwd: string = process.cwd()): Promise<void> {
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
  } else {
    console.log('⚠️  部分检查点未通过，请继续工作');
  }
}

/**
 * 生成检查点确认令牌
 */
function generateCheckpointToken(): string {
  return `CP-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * 解析检查点文件，返回检查项列表
 */
function parseCheckpoints(checkpointPath: string): Array<{ text: string; checked: boolean }> {
  if (!fs.existsSync(checkpointPath)) {
    return [];
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

  return lines.map(line => {
    const isChecked = line.includes('[x]') || line.includes('[X]');
    const text = line.replace(/- \[[xX ]\] /, '').trim();
    return { text, checked: isChecked };
  });
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
