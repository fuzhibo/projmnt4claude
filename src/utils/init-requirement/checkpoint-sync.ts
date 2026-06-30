/**
 * checkpoint.md ↔ meta.json 同步机制
 *
 * 来源：CP-010 数据保护规则
 * 核心：meta.json 为唯一权威数据源，checkpoint.md 为索引
 *
 * 实现：
 * - checkpointMdToMeta: 从 checkpoint.md 生成 meta.json.checkpoints
 * - metaToCheckpointMdIndex: 从 meta.json 同步 checkpoint.md 索引（仅 description）
 * - writeCheckpoint: 检查点写入流程（先 meta.json，再 checkpoint.md）
 * - updateCheckpoint: 检查点更新流程
 * - deleteCheckpoint: 检查点删除流程
 *
 * @module checkpoint-sync
 */

import type { CheckpointMetadata } from '../../types/task.js';
import { parseCheckpointMarkdown } from './checkpoint-parser.js';
import { inferCheckpointMetadataBatch } from './checkpoint-infer.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 任务元数据结构（简化版）
 */
interface TaskMeta {
  checkpoints: CheckpointMetadata[];
}

// ============================================================
// 现有功能：checkpoint.md ↔ meta.json 转换
// ============================================================

/**
 * 从 checkpoint.md 内容生成 CheckpointMetadata 数组
 *
 * @param markdown - checkpoint.md 内容
 * @returns CheckpointMetadata 数组
 */
export function checkpointMdToMeta(markdown: string): CheckpointMetadata[] {
  const blocks = parseCheckpointMarkdown(markdown);
  return inferCheckpointMetadataBatch(blocks);
}

/**
 * 从 meta.json.checkpoints 生成 checkpoint.md 索引内容
 *
 * 注意：只同步 description（索引字段），不同步 commands/steps/expected（非索引字段）
 *
 * @param checkpoints - meta.json.checkpoints 数组
 * @returns checkpoint.md 内容
 */
export function metaToCheckpointMdIndex(checkpoints: CheckpointMetadata[]): string {
  const lines = [
    '# 检查点列表',
    '',
    '> **注意**: 此文件为索引文件，请勿手动编辑。',
    '> 检查点数据存储在 meta.json 中，通过 CLI 命令修改。',
    '',
  ];

  // 按前缀分组
  const groupedCheckpoints = groupByPrefix(checkpoints);

  for (const [prefix, cps] of Object.entries(groupedCheckpoints)) {
    for (const cp of cps) {
      // 只同步 description（索引）
      lines.push(`## [${formatPrefix(prefix)}] ${cp.description}`);

      // 非索引字段不写入索引文件
      // 用户应手动添加或在 checkpoint.md 扩展格式中定义
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 从 CheckpointMetadata 推断前缀
 *
 * @param checkpoint - 检查点元数据
 * @returns 前缀字符串
 */
function inferPrefixFromCheckpoint(checkpoint: CheckpointMetadata): string {
  const { category, requiresHuman } = checkpoint;

  // 根据 category 和 requiresHuman 推断前缀
  if (category === 'code_review') {
    return 'ai-review';
  }

  if (category === 'qa_verification') {
    return requiresHuman ? 'human-qa' : 'ai-qa';
  }

  if (category === 'evaluation') {
    return 'script';
  }

  // 默认返回 ai-qa
  return 'ai-qa';
}

/**
 * 按前缀分组检查点
 *
 * @param checkpoints - 检查点数组
 * @returns 按前缀分组的对象
 */
function groupByPrefix(checkpoints: CheckpointMetadata[]): Record<string, CheckpointMetadata[]> {
  const groups: Record<string, CheckpointMetadata[]> = {};

  for (const cp of checkpoints) {
    const prefix = inferPrefixFromCheckpoint(cp);
    if (!groups[prefix]) {
      groups[prefix] = [];
    }
    groups[prefix]!.push(cp);
  }

  return groups;
}

/**
 * 格式化前缀（连字符转空格）
 *
 * @param prefix - 前缀
 * @returns 格式化后的前缀
 */
function formatPrefix(prefix: string): string {
  return prefix.replace(/-/g, ' ');
}

// ============================================================
// 新增：数据保护规则（CP-010）
// ============================================================

/**
 * 加载任务元数据
 *
 * @param taskId - 任务 ID
 * @param cwd - 工作目录
 * @returns TaskMeta 对象
 */
export async function loadTaskMeta(taskId: string, cwd: string): Promise<TaskMeta> {
  const metaPath = path.join(cwd, 'tasks', taskId, 'meta.json');
  try {
    const content = await fs.promises.readFile(metaPath, 'utf-8');
    return JSON.parse(content) as TaskMeta;
  } catch (error) {
    throw new Error(`无法加载任务元数据: ${metaPath} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 保存任务元数据
 *
 * @param taskId - 任务 ID
 * @param meta - TaskMeta 对象
 * @param cwd - 工作目录
 */
export async function saveTaskMeta(taskId: string, meta: TaskMeta, cwd: string): Promise<void> {
  const metaPath = path.join(cwd, 'tasks', taskId, 'meta.json');
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * 从 meta.json 同步到 checkpoint.md
 *
 * @param taskId - 任务 ID
 * @param cwd - 工作目录
 */
export async function syncCheckpointMarkdown(taskId: string, cwd: string): Promise<void> {
  const meta = await loadTaskMeta(taskId, cwd);
  const checkpoints = meta.checkpoints || [];

  // 生成 checkpoint.md 内容（仅索引）
  const lines = [
    '# 检查点列表',
    '',
    '> **注意**: 此文件为索引文件，请勿手动编辑。',
    '> 检查点数据存储在 meta.json 中，通过 CLI 命令修改。',
    '',
    ...checkpoints.map(cp => `- [${cp.id}] ${cp.description}`),
  ];

  const checkpointPath = path.join(cwd, 'tasks', taskId, 'checkpoint.md');
  await fs.promises.writeFile(checkpointPath, lines.join('\n'), 'utf-8');
}

/**
 * 检查点写入流程
 * 核心：先写入 meta.json，再同步到 checkpoint.md
 *
 * @param taskId - 任务 ID
 * @param checkpoint - CheckpointMetadata 对象
 * @param cwd - 工作目录
 */
export async function writeCheckpoint(
  taskId: string,
  checkpoint: CheckpointMetadata,
  cwd: string
): Promise<void> {
  // Step 1: 写入 meta.json（权威源）
  const meta = await loadTaskMeta(taskId, cwd);
  meta.checkpoints.push(checkpoint);
  await saveTaskMeta(taskId, meta, cwd);

  // Step 2: 同步到 checkpoint.md（索引）
  await syncCheckpointMarkdown(taskId, cwd);
}

/**
 * 检查点更新流程
 * 核心：先更新 meta.json，再同步到 checkpoint.md
 *
 * @param taskId - 任务 ID
 * @param checkpointId - 检查点 ID
 * @param updates - 更新的字段
 * @param cwd - 工作目录
 */
export async function updateCheckpoint(
  taskId: string,
  checkpointId: string,
  updates: Partial<CheckpointMetadata>,
  cwd: string
): Promise<void> {
  // Step 1: 更新 meta.json（权威源）
  const meta = await loadTaskMeta(taskId, cwd);
  const checkpoint = meta.checkpoints.find(cp => cp.id === checkpointId);
  if (!checkpoint) {
    throw new Error(`检查点不存在: ${checkpointId}`);
  }
  Object.assign(checkpoint, updates);
  checkpoint.updatedAt = new Date().toISOString();
  await saveTaskMeta(taskId, meta, cwd);

  // Step 2: 同步到 checkpoint.md（索引）
  await syncCheckpointMarkdown(taskId, cwd);
}

/**
 * 检查点删除流程
 * 核心：先从 meta.json 删除，再同步到 checkpoint.md
 *
 * @param taskId - 任务 ID
 * @param checkpointId - 检查点 ID
 * @param cwd - 工作目录
 */
export async function deleteCheckpoint(
  taskId: string,
  checkpointId: string,
  cwd: string
): Promise<void> {
  // Step 1: 从 meta.json 删除（权威源）
  const meta = await loadTaskMeta(taskId, cwd);
  meta.checkpoints = meta.checkpoints.filter(cp => cp.id !== checkpointId);
  await saveTaskMeta(taskId, meta, cwd);

  // Step 2: 同步到 checkpoint.md（索引）
  await syncCheckpointMarkdown(taskId, cwd);
}

/**
 * 批量写入检查点
 *
 * @param taskId - 任务 ID
 * @param checkpoints - CheckpointMetadata 数组
 * @param cwd - 工作目录
 */
export async function writeCheckpointsBatch(
  taskId: string,
  checkpoints: CheckpointMetadata[],
  cwd: string
): Promise<void> {
  // Step 1: 写入 meta.json（权威源）
  const meta = await loadTaskMeta(taskId, cwd);
  meta.checkpoints = checkpoints;
  await saveTaskMeta(taskId, meta, cwd);

  // Step 2: 同步到 checkpoint.md（索引）
  await syncCheckpointMarkdown(taskId, cwd);
}

/**
 * 读取 checkpoint.md 内容
 *
 * @param taskId - 任务 ID
 * @param cwd - 工作目录
 * @returns checkpoint.md 内容，如果文件不存在则返回 null
 */
export async function readCheckpointMarkdown(taskId: string, cwd: string): Promise<string | null> {
  const checkpointPath = path.join(cwd, 'tasks', taskId, 'checkpoint.md');
  try {
    return await fs.promises.readFile(checkpointPath, 'utf-8');
  } catch {
    return null;
  }
}
