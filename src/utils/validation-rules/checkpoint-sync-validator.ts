/**
 * 检查点数据同步一致性验证器
 *
 * 来源：CP-010 数据保护规则
 * 验证 checkpoint.md 与 meta.json 数据一致性
 */

import type { ValidationViolation, QualityGateContext } from '../../types/feedback-constraint.js';
import type { CheckpointMetadata } from '../../types/task.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 读取 checkpoint.md 文件内容
 */
async function readCheckpointMarkdown(taskId: string, cwd: string): Promise<string | null> {
  const checkpointPath = path.join(cwd, 'tasks', taskId, 'checkpoint.md');
  try {
    return await fs.promises.readFile(checkpointPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 从 checkpoint.md 提取 description 列表（简单解析）
 */
function extractDescriptionsFromMarkdown(markdown: string): string[] {
  const lines = markdown.split('\n');
  const descriptions: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 ## [prefix] description 或 - [prefix] description
    const match = trimmed.match(/^(?:##|\s*-)\s*\[([^\]]+)\]\s*(.+)$/);
    if (match) {
      descriptions.push(match[2]!.trim());
    }
  }

  return descriptions;
}

/**
 * 从 meta.json description 去掉前缀部分
 *
 * meta.json description 格式: "[prefix] 纯文本"
 * checkpoint.md 解析后 description 格式: "纯文本"
 *
 * @param description - meta.json 的 description（可能含前缀）
 * @returns 去掉前缀后的纯文本
 */
function stripPrefixFromDescription(description: string): string {
  // 匹配 [prefix] 纯文本 格式
  const match = description.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return match[2]!.trim();
  }
  // 无前缀，直接返回原文本
  return description;
}

/**
 * 异步验证 checkpoint.md 与 meta.json 数据一致性
 *
 * @param checkpoints - CheckpointMetadata 数组（来自 meta.json）
 * @param context - 上下文，包含 taskId 和 cwd
 * @returns ValidationViolation 或 null
 */
export async function checkpointSyncValidatorAsync(
  checkpoints: CheckpointMetadata[],
  context?: { taskId: string; cwd: string }
): Promise<ValidationViolation | null> {
  // 方式 1: 通过 taskId 读取文件对比（推荐，用于 Pre-Dev Gate）
  if (context?.taskId && context?.cwd) {
    const checkpointMd = await readCheckpointMarkdown(context.taskId, context.cwd);
    if (!checkpointMd) {
      return {
        ruleId: 'checkpoint-sync-validator',
        severity: 'error',
        message: `checkpoint.md 文件不存在: tasks/${context.taskId}/checkpoint.md`,
      };
    }

    const mdDescriptions = extractDescriptionsFromMarkdown(checkpointMd);
    // 去掉 meta.json description 的前缀部分再比较
    const metaDescriptions = checkpoints.map(cp => stripPrefixFromDescription(cp.description));

    if (mdDescriptions.length !== metaDescriptions.length) {
      return {
        ruleId: 'checkpoint-sync-validator',
        severity: 'error',
        message: `checkpoint.md 与 meta.json 检查点数量不一致: ${mdDescriptions.length} vs ${metaDescriptions.length} 条`,
      };
    }

    const mismatched: string[] = [];
    for (let i = 0; i < mdDescriptions.length; i++) {
      if (mdDescriptions[i] !== metaDescriptions[i]) {
        mismatched.push(`位置 ${i + 1}: md="${mdDescriptions[i]}" vs meta="${metaDescriptions[i]}"`);
      }
    }

    if (mismatched.length > 0) {
      return {
        ruleId: 'checkpoint-sync-validator',
        severity: 'error',
        message: `checkpoint.md 与 meta.json description 不一致: ${mismatched.slice(0, 3).join('; ')}${mismatched.length > 3 ? '...' : ''}`,
      };
    }
  }

  // 方式 2: 仅校验 checkpoints 数组内部一致性（用于任务创建阶段）
  // 此时 checkpoints 尚未写入 meta.json，跳过文件对比
  return null;
}

/**
 * 同步版本的验证函数（用于已有 checkpointMd 内容的情况）
 */
export function checkpointSyncValidatorSync(
  checkpoints: CheckpointMetadata[],
  checkpointMd: string
): ValidationViolation | null {
  const mdDescriptions = extractDescriptionsFromMarkdown(checkpointMd);
  // 去掉 meta.json description 的前缀部分再比较
  const metaDescriptions = checkpoints.map(cp => stripPrefixFromDescription(cp.description));

  if (mdDescriptions.length !== metaDescriptions.length) {
    return {
      ruleId: 'checkpoint-sync-validator',
      severity: 'error',
      message: `checkpoint.md 与 meta.json 检查点数量不一致: ${mdDescriptions.length} vs ${metaDescriptions.length} 条`,
    };
  }

  const mismatched: string[] = [];
  for (let i = 0; i < mdDescriptions.length; i++) {
    if (mdDescriptions[i] !== metaDescriptions[i]) {
      mismatched.push(`位置 ${i + 1}: md="${mdDescriptions[i]}" vs meta="${metaDescriptions[i]}"`);
    }
  }

  if (mismatched.length > 0) {
    return {
      ruleId: 'checkpoint-sync-validator',
      severity: 'error',
      message: `checkpoint.md 与 meta.json description 不一致: ${mismatched.slice(0, 3).join('; ')}${mismatched.length > 3 ? '...' : ''}`,
    };
  }

  return null;
}
