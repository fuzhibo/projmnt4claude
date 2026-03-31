import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getProjectDir } from '../utils/path';
import { readTaskMeta, getAllTasks, taskExists } from '../utils/task';
import type { TaskMeta } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';

/**
 * 分支信息接口
 */
export interface BranchInfo {
  name: string;
  taskId: string | null;
  isCurrent: boolean;
  lastActivity: string;
  hasUncommittedChanges: boolean;
}

/**
 * 获取 Git 目录路径
 */
function getGitDir(cwd: string = process.cwd()): string | null {
  const gitDir = path.join(cwd, '.git');
  return fs.existsSync(gitDir) ? gitDir : null;
}

/**
 * 检查是否在 Git 仓库中
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  return getGitDir(cwd) !== null;
}

/**
 * 执行 Git 命令
 */
function execGit(args: string[], cwd: string = process.cwd()): { stdout: string; stderr: string; code: number } {
  const { execSync } = require('child_process');
  try {
    const stdout = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout?.toString().trim() || '',
      stderr: err.stderr?.toString().trim() || '',
      code: err.status || 1,
    };
  }
}

/**
 * 获取当前分支名
 */
export function getCurrentBranch(cwd: string = process.cwd()): string | null {
  if (!isGitRepo(cwd)) return null;
  const result = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return result.code === 0 ? result.stdout : null;
}

/**
 * 获取所有分支
 */
export function getAllBranches(cwd: string = process.cwd()): string[] {
  if (!isGitRepo(cwd)) return [];
  const result = execGit(['branch', '--format=%(refname:short)'], cwd);
  return result.code === 0 ? result.stdout.split('\n').filter(b => b) : [];
}

/**
 * 获取任务关联的分支名
 */
export function getTaskBranchName(taskId: string): string {
  return `task/${taskId}`;
}

/**
 * 检查分支是否存在
 */
export function branchExists(branchName: string, cwd: string = process.cwd()): boolean {
  if (!isGitRepo(cwd)) return false;
  const result = execGit(['rev-parse', '--verify', branchName], cwd);
  return result.code === 0;
}

/**
 * 切换到任务关联分支
 */
export async function checkoutTaskBranch(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  if (!taskExists(taskId, cwd)) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 无法读取任务元数据`);
    process.exit(1);
  }

  // 确定分支名
  const branchName = task.branch || getTaskBranchName(taskId);

  // 检查是否有未提交的更改
  const statusResult = execGit(['status', '--porcelain'], cwd);
  if (statusResult.stdout && !statusResult.stdout.includes('nothing to commit')) {
    console.log('⚠️  检测到未提交的更改');
    const response = await prompts({
      type: 'select',
      name: 'action',
      message: '如何处理未提交的更改?',
      choices: [
        { title: '暂存 (stash)', value: 'stash' },
        { title: '提交', value: 'commit' },
        { title: '放弃更改', value: 'discard' },
        { title: '取消', value: 'cancel' },
      ],
    });

    if (response.action === 'cancel' || !response.action) {
      console.log('已取消');
      return;
    }

    switch (response.action) {
      case 'stash':
        execGit(['stash', 'push', '-m', `WIP: ${taskId}`], cwd);
        console.log('✅ 更改已暂存');
        break;
      case 'commit':
        const commitMsg = await prompts({
          type: 'text',
          name: 'message',
          message: '提交消息',
          initial: `WIP: ${task.title}`,
        });
        execGit(['add', '-A'], cwd);
        execGit(['commit', '-m', commitMsg.message || `WIP: ${task.title}`], cwd);
        console.log('✅ 更改已提交');
        break;
      case 'discard':
        const confirm = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: '确定要放弃所有未提交的更改吗?',
          initial: false,
        });
        if (!confirm.confirm) {
          console.log('已取消');
          return;
        }
        execGit(['checkout', '--', '.'], cwd);
        console.log('✅ 更改已放弃');
        break;
    }
  }

  // 检查分支是否存在
  if (!branchExists(branchName, cwd)) {
    console.log(`分支 '${branchName}' 不存在`);
    const response = await prompts({
      type: 'confirm',
      name: 'create',
      message: '是否创建新分支?',
      initial: true,
    });

    if (response.create) {
      // 从当前分支创建新分支
      const currentBranch = getCurrentBranch(cwd);
      const result = execGit(['checkout', '-b', branchName], cwd);
      if (result.code !== 0) {
        console.error(`错误: 无法创建分支 - ${result.stderr}`);
        process.exit(1);
      }

      // 更新任务元数据
      task.branch = branchName;
      const tasksDir = path.join(getProjectDir(cwd), 'tasks', taskId);
      const metaPath = path.join(tasksDir, 'meta.json');
      fs.writeFileSync(metaPath, JSON.stringify(task, null, 2), 'utf-8');

      console.log(`✅ 已创建并切换到分支 '${branchName}'`);
    } else {
      console.log('已取消');
      return;
    }
  } else {
    // 切换到现有分支
    const result = execGit(['checkout', branchName], cwd);
    if (result.code !== 0) {
      console.error(`错误: 无法切换分支 - ${result.stderr}`);
      process.exit(1);
    }
    console.log(`✅ 已切换到分支 '${branchName}'`);
  }
}

/**
 * 显示分支状态
 */
export function showBranchStatus(cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🌿 分支状态');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  const currentBranch = getCurrentBranch(cwd);
  const allBranches = getAllBranches(cwd);
  const tasks = getAllTasks(cwd);

  console.log(`当前分支: ${currentBranch || '未知'}`);
  console.log('');

  // 查找任务关联的分支
  const taskBranches = new Map<string, TaskMeta>();
  for (const task of tasks) {
    if (task.branch) {
      taskBranches.set(task.branch, task);
    }
    // 也检查默认命名模式
    const defaultBranch = getTaskBranchName(task.id);
    if (!taskBranches.has(defaultBranch)) {
      taskBranches.set(defaultBranch, task);
    }
  }

  console.log('本地分支:');
  console.log('');

  for (const branch of allBranches) {
    const isCurrent = branch === currentBranch;
    const prefix = isCurrent ? '* ' : '  ';
    const taskInfo = taskBranches.get(branch);

    if (taskInfo) {
      console.log(`${prefix}${branch} → 任务: ${taskInfo.id} (${taskInfo.title.substring(0, 30)})`);
    } else {
      console.log(`${prefix}${branch}`);
    }
  }

  console.log('');

  // 显示未关联任务的分支
  const untrackedBranches = allBranches.filter(b => !taskBranches.has(b) && !b.startsWith('task/'));
  if (untrackedBranches.length > 0) {
    console.log('未关联任务的分支:');
    for (const branch of untrackedBranches) {
      console.log(`  - ${branch}`);
    }
    console.log('');
  }

  // 检查是否有未提交的更改
  const statusResult = execGit(['status', '--porcelain'], cwd);
  if (statusResult.stdout) {
    console.log('⚠️  有未提交的更改');
    console.log('');
  }

  console.log('━'.repeat(SEPARATOR_WIDTH));
}

/**
 * 创建任务分支
 */
export async function createTaskBranch(taskId: string, branchName?: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  if (!taskExists(taskId, cwd)) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error('错误: 无法读取任务元数据');
    process.exit(1);
  }

  const finalBranchName = branchName || getTaskBranchName(taskId);

  if (branchExists(finalBranchName, cwd)) {
    console.error(`错误: 分支 '${finalBranchName}' 已存在`);
    process.exit(1);
  }

  const result = execGit(['checkout', '-b', finalBranchName], cwd);
  if (result.code !== 0) {
    console.error(`错误: 无法创建分支 - ${result.stderr}`);
    process.exit(1);
  }

  // 更新任务元数据
  task.branch = finalBranchName;
  const tasksDir = path.join(getProjectDir(cwd), 'tasks', taskId);
  const metaPath = path.join(tasksDir, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(task, null, 2), 'utf-8');

  console.log(`✅ 已创建并切换到分支 '${finalBranchName}'`);
}

/**
 * 删除任务分支
 */
export async function deleteTaskBranch(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const branchName = task.branch || getTaskBranchName(taskId);
  const currentBranch = getCurrentBranch(cwd);

  if (!branchExists(branchName, cwd)) {
    console.log(`分支 '${branchName}' 不存在`);
    return;
  }

  // 如果当前在要删除的分支上，先切换到主分支
  if (branchName === currentBranch) {
    const mainBranch = 'main';
    const fallbackBranch = 'master';
    const targetBranch = branchExists(mainBranch, cwd) ? mainBranch : (branchExists(fallbackBranch, cwd) ? fallbackBranch : null);

    if (!targetBranch) {
      console.error('错误: 无法找到主分支来切换');
      process.exit(1);
    }

    execGit(['checkout', targetBranch], cwd);
    console.log(`已切换到 '${targetBranch}'`);
  }

  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: `确定要删除分支 '${branchName}' 吗?`,
    initial: false,
  });

  if (!response.confirm) {
    console.log('已取消');
    return;
  }

  const result = execGit(['branch', '-D', branchName], cwd);
  if (result.code !== 0) {
    console.error(`错误: 无法删除分支 - ${result.stderr}`);
    process.exit(1);
  }

  // 清除任务元数据中的分支引用
  if (task.branch === branchName) {
    task.branch = undefined;
    const tasksDir = path.join(getProjectDir(cwd), 'tasks', taskId);
    const metaPath = path.join(tasksDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(task, null, 2), 'utf-8');
  }

  console.log(`✅ 分支 '${branchName}' 已删除`);
}

/**
 * 合并任务分支
 */
export async function mergeTaskBranch(taskId: string, message?: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const branchName = task.branch || getTaskBranchName(taskId);

  if (!branchExists(branchName, cwd)) {
    console.error(`错误: 分支 '${branchName}' 不存在`);
    process.exit(1);
  }

  // 获取主分支
  const mainBranch = branchExists('main', cwd) ? 'main' : (branchExists('master', cwd) ? 'master' : null);
  if (!mainBranch) {
    console.error('错误: 无法找到主分支');
    process.exit(1);
  }

  // 切换到主分支
  execGit(['checkout', mainBranch], cwd);

  // 合并
  const mergeMessage = message || `Merge task/${taskId}: ${task.title}`;
  const result = execGit(['merge', '--no-ff', branchName, '-m', mergeMessage], cwd);

  if (result.code !== 0) {
    console.error(`错误: 合并失败 - ${result.stderr}`);
    console.log('');
    console.log('可能需要手动解决冲突后运行:');
    console.log('  git add .');
    console.log('  git commit');
    process.exit(1);
  }

  console.log(`✅ 分支 '${branchName}' 已合并到 '${mainBranch}'`);
}

/**
 * 推送任务分支
 */
export function pushTaskBranch(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`错误: 任务 '${taskId}' 不存在`);
    process.exit(1);
  }

  const branchName = task.branch || getTaskBranchName(taskId);

  if (!branchExists(branchName, cwd)) {
    console.error(`错误: 分支 '${branchName}' 不存在`);
    process.exit(1);
  }

  const result = execGit(['push', '-u', 'origin', branchName], cwd);

  if (result.code !== 0) {
    console.error(`错误: 推送失败 - ${result.stderr}`);
    process.exit(1);
  }

  console.log(`✅ 分支 '${branchName}' 已推送到远程`);
}

/**
 * 同步分支状态
 */
export function syncBranch(taskId?: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化');
    process.exit(1);
  }

  if (!isGitRepo(cwd)) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  console.log('正在同步分支状态...');

  // 拉取远程更新
  const fetchResult = execGit(['fetch', '--all'], cwd);
  if (fetchResult.code !== 0) {
    console.error(`错误: 获取远程更新失败 - ${fetchResult.stderr}`);
    process.exit(1);
  }

  if (taskId) {
    // 同步特定任务的分支
    const task = readTaskMeta(taskId, cwd);
    if (!task) {
      console.error(`错误: 任务 '${taskId}' 不存在`);
      process.exit(1);
    }

    const branchName = task.branch || getTaskBranchName(taskId);
    const currentBranch = getCurrentBranch(cwd);

    if (currentBranch === branchName) {
      const pullResult = execGit(['pull'], cwd);
      if (pullResult.code !== 0) {
        console.error(`错误: 拉取更新失败 - ${pullResult.stderr}`);
        process.exit(1);
      }
      console.log(`✅ 分支 '${branchName}' 已同步`);
    } else {
      console.log(`当前不在分支 '${branchName}' 上，跳过同步`);
    }
  } else {
    // 同步当前分支
    const pullResult = execGit(['pull'], cwd);
    if (pullResult.code !== 0) {
      console.error(`错误: 拉取更新失败 - ${pullResult.stderr}`);
      process.exit(1);
    }
    console.log('✅ 当前分支已同步');
  }
}
