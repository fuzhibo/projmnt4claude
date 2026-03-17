/**
 * 检查点工具函数
 * 用于检查点 ID 生成、解析、同步等操作
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from './path';
import { readTaskMeta, writeTaskMeta } from './task';
import type { TaskMeta, CheckpointMetadata, CheckpointVerification } from '../types/task';

/**
 * 解析后的检查点信息
 */
export interface ParsedCheckpoint {
  id: string;
  text: string;
  checked: boolean;
  lineIndex: number;  // 在文件中的行号
}

/**
 * 生成检查点ID
 * 优先使用描述关键词生成可读ID，回退到序号格式
 */
export function generateCheckpointId(taskId: string, index: number, description: string): string {
  // 从描述中提取关键词生成 slug
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-') // 保留中文、英文、数字
    .replace(/^-+|-+$/g, '')
    .substring(0, 30);

  // 如果 slug 有效且长度足够，使用描述性 ID
  if (slug && slug.length > 3) {
    return `CP-${slug}`;
  }

  // 回退到序号格式
  return `CP-${String(index + 1).padStart(3, '0')}`;
}

/**
 * 解析 checkpoint.md 文件并分配 ID
 */
export function parseCheckpointsWithIds(taskId: string, cwd: string = process.cwd()): ParsedCheckpoint[] {
  const checkpointPath = path.join(getTasksDir(cwd), taskId, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) {
    return [];
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');
  const checkpoints: ParsedCheckpoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line?.trim() || '';

    if (trimmed.startsWith('- [')) {
      const isChecked = trimmed.includes('[x]') || trimmed.includes('[X]');
      const text = trimmed.replace(/- \[[xX ]\] /, '').trim();

      checkpoints.push({
        id: '',  // 暂时为空，后续分配
        text,
        checked: isChecked,
        lineIndex: i,
      });
    }
  }

  // 分配ID（从meta.json获取或生成）
  const task = readTaskMeta(taskId, cwd);
  const existingCheckpoints = task?.checkpoints || [];

  checkpoints.forEach((cp, index) => {
    // 尝试通过文本匹配找到现有ID
    const existing = existingCheckpoints.find(ec => ec.description === cp.text);
    if (existing) {
      cp.id = existing.id;
    } else {
      cp.id = generateCheckpointId(taskId, index, cp.text);
    }
  });

  return checkpoints;
}

/**
 * 同步 checkpoint.md 到 meta.json
 * 确保检查点元数据与 checkpoint.md 文件保持一致
 */
export function syncCheckpointsToMeta(taskId: string, cwd: string = process.cwd()): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const parsedCheckpoints = parseCheckpointsWithIds(taskId, cwd);
  const existingMeta = task.checkpoints || [];
  const now = new Date().toISOString();

  // 如果没有检查点，清空 meta 中的 checkpoints
  if (parsedCheckpoints.length === 0) {
    if (task.checkpoints && task.checkpoints.length > 0) {
      task.checkpoints = [];
      writeTaskMeta(task, cwd);
    }
    return;
  }

  // 合并现有元数据和新解析的检查点
  const mergedCheckpoints: CheckpointMetadata[] = parsedCheckpoints.map((cp, index) => {
    const existing = existingMeta.find(ec => ec.id === cp.id || ec.description === cp.text);

    return {
      id: cp.id,
      description: cp.text,
      status: cp.checked ? 'completed' : (existing?.status || 'pending'),
      note: existing?.note,
      verification: existing?.verification,
      createdAt: existing?.createdAt || now,
      updatedAt: existing?.updatedAt || now,
    };
  });

  // 检查是否有变化
  const hasChanges = JSON.stringify(task.checkpoints) !== JSON.stringify(mergedCheckpoints);

  if (hasChanges) {
    task.checkpoints = mergedCheckpoints;
    writeTaskMeta(task, cwd);
  }
}

/**
 * 更新检查点状态
 */
export function updateCheckpointStatus(
  taskId: string,
  checkpointId: string,
  status: 'completed' | 'failed' | 'skipped' | 'pending',
  options: {
    note?: string;
    result?: string;
    verifiedBy?: string;
  } = {},
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  // 确保检查点已同步
  syncCheckpointsToMeta(taskId, cwd);

  // 重新读取更新后的任务
  const updatedTask = readTaskMeta(taskId, cwd);
  if (!updatedTask) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const checkpoint = updatedTask.checkpoints?.find(cp => cp.id === checkpointId);
  if (!checkpoint) {
    throw new Error(`检查点 '${checkpointId}' 不存在`);
  }

  // 更新状态
  checkpoint.status = status;
  checkpoint.updatedAt = new Date().toISOString();

  // 更新备注
  if (options.note !== undefined) {
    checkpoint.note = options.note;
  }

  // 更新验证结果
  if (options.result !== undefined) {
    if (!checkpoint.verification) {
      checkpoint.verification = {
        method: 'manual',
      };
    }
    checkpoint.verification.result = options.result;
    checkpoint.verification.verifiedAt = new Date().toISOString();
    checkpoint.verification.verifiedBy = options.verifiedBy || process.env.USER || 'unknown';
  }

  // 同步回 checkpoint.md（更新勾选状态）
  updateCheckpointMd(taskId, checkpointId, status === 'completed', updatedTask, cwd);

  writeTaskMeta(updatedTask, cwd);
}

/**
 * 更新 checkpoint.md 文件的勾选状态
 */
function updateCheckpointMd(
  taskId: string,
  checkpointId: string,
  checked: boolean,
  task: TaskMeta,
  cwd: string = process.cwd()
): void {
  const checkpointPath = path.join(getTasksDir(cwd), taskId, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) return;

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');

  // 找到对应的检查点
  const checkpoint = task.checkpoints?.find(cp => cp.id === checkpointId);

  if (!checkpoint) return;

  // 找到匹配的行并更新
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim().startsWith('- [') && line.includes(checkpoint.description)) {
      lines[i] = line.replace(/- \[[xX ]\] /, checked ? '- [x] ' : '- [ ] ');
      break;
    }
  }

  fs.writeFileSync(checkpointPath, lines.join('\n'), 'utf-8');
}

/**
 * 获取检查点详情
 */
export function getCheckpointDetail(
  taskId: string,
  checkpointId: string,
  cwd: string = process.cwd()
): CheckpointMetadata | null {
  syncCheckpointsToMeta(taskId, cwd);
  const task = readTaskMeta(taskId, cwd);
  return task?.checkpoints?.find(cp => cp.id === checkpointId) || null;
}

/**
 * 列出所有检查点
 */
export function listCheckpoints(
  taskId: string,
  cwd: string = process.cwd()
): CheckpointMetadata[] {
  syncCheckpointsToMeta(taskId, cwd);
  const task = readTaskMeta(taskId, cwd);
  return task?.checkpoints || [];
}

/**
 * 通过描述查找检查点ID
 */
export function findCheckpointIdByDescription(
  taskId: string,
  description: string,
  cwd: string = process.cwd()
): string | null {
  const checkpoints = listCheckpoints(taskId, cwd);
  const found = checkpoints.find(cp =>
    cp.description === description ||
    cp.description.includes(description) ||
    description.includes(cp.description)
  );
  return found?.id || null;
}
