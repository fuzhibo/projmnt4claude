/**
 * checkpoint.md ↔ meta.json 同步机制
 *
 * 实现：
 * - checkpointMdToMetaJson: 从 checkpoint.md 生成 meta.json.checkpoints
 * - metaJsonToCheckpointMd: 从 meta.json 同步 checkpoint.md 索引（仅 description）
 *
 * @module checkpoint-sync
 */

import type { CheckpointMetadata } from '../../types/task.js';
import { parseCheckpointMarkdown } from './checkpoint-parser.js';
import { inferCheckpointMetadataBatch } from './checkpoint-infer.js';

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
    '> **注意**: commands/steps/expected 为可调整字段，由用户定义或调整。',
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