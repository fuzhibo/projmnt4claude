/**
 * checkpoint.md 格式规范验证器
 *
 * 来源：CP-002003005 checkpoint.md 格式规范
 *
 * 规范要求：
 * 1. 文件以 `# 检查点列表` 开头
 * 2. 每个检查点以 `## [prefix] description` 格式
 * 3. 支持可选字段：commands、steps、expected
 * 4. [script] 前缀必须有 commands
 * 5. [human qa] 前缀必须有 steps
 * 6-10. 数量和一致性检查
 */

import type { ValidationRule, ValidationViolation, QualityGateContext } from '../../types/feedback-constraint.js';
import type { CheckpointMetadata } from '../../types/task.js';
import { parseCheckpointMarkdown } from '../init-requirement/checkpoint-parser.js';
import { VALID_PREFIXES, type CheckpointPrefix } from '../init-requirement/prefix-map.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 读取 checkpoint.md 文件内容
 *
 * @param taskId - 任务 ID
 * @param cwd - 工作目录
 * @returns checkpoint.md 内容，如果文件不存在则返回 null
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
 * 从 checkpoint.md 提取 description 列表
 */
function extractDescriptionsFromMarkdown(markdown: string): string[] {
  const blocks = parseCheckpointMarkdown(markdown);
  return blocks.map(b => b.description);
}

/**
 * Rule: checkpoint-md-format-validator
 *
 * checkpoint.md 格式规范验证（10 条规则）
 */
export const checkpointMdFormatValidator: ValidationRule = {
  id: 'checkpoint-md-format-validator',
  description: 'checkpoint.md 格式规范验证（CP-002003005）',
  severity: 'error' as const,
  check: (output: unknown, context?: QualityGateContext): ValidationViolation | null => {
    // 异步逻辑通过 Promise 包装，但 ValidationRule.check 是同步的
    // 实际使用时通过 asyncCheck 包装器调用
    // 这里返回 null，实际验证在 asyncCheck 中完成
    return null;
  },
};

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
  const match = description.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return match[2]!.trim();
  }
  return description;
}

/**
 * 异步验证 checkpoint.md 格式
 *
 * @param checkpoints - CheckpointMetadata 数组
 * @param context - 上下文，包含 taskId 和 cwd
 * @returns ValidationViolation 或 null
 */
export async function checkpointMdFormatValidatorAsync(
  checkpoints: CheckpointMetadata[],
  context?: { taskId: string; cwd: string }
): Promise<ValidationViolation | null> {
  if (!context?.taskId || !context?.cwd) {
    return null;
  }

  const checkpointMd = await readCheckpointMarkdown(context.taskId, context.cwd);
  if (!checkpointMd) {
    return {
      ruleId: 'checkpoint-md-format-validator',
      severity: 'error',
      message: `checkpoint.md 文件不存在: tasks/${context.taskId}/checkpoint.md`,
    };
  }

  const errors: string[] = [];

  // 规则 1: 文件必须以 `# 检查点列表` 开头
  const trimmedMd = checkpointMd.trim();
  if (!trimmedMd.startsWith('# 检查点列表') && !trimmedMd.startsWith('# Checkpoints')) {
    errors.push('文件必须以 "# 检查点列表" 或 "# Checkpoints" 开头');
  }

  // 解析所有检查点块
  const blocks = parseCheckpointMarkdown(checkpointMd);

  for (const block of blocks) {
    // 规则 2: prefix 必须是 System B 前缀
    if (!VALID_PREFIXES.includes(block.prefix as CheckpointPrefix)) {
      errors.push(`[${block.prefix}] 不是有效的 System B 前缀（应为 ${VALID_PREFIXES.join('/')}）`);
    }

    // 规则 3: description 不能为空
    if (!block.description || block.description.trim().length === 0) {
      errors.push(`[${block.prefix}] description 不能为空`);
    }

    // 规则 4: [script] 前缀必须有 commands
    if (block.prefix === 'script' && (!block.commands || block.commands.length === 0)) {
      errors.push(`[script] ${block.description}: 必须有 commands`);
    }

    // 规则 5: [human qa] 前缀必须有 steps
    if (block.prefix === 'human-qa' && (!block.steps || block.steps.length === 0)) {
      errors.push(`[human qa] ${block.description}: 必须有 steps`);
    }

    // 规则 6: commands 格式验证（如果存在）
    if (block.commands && block.commands.length > 0) {
      for (const cmd of block.commands) {
        if (cmd.trim().length === 0) {
          errors.push(`[${block.prefix}] ${block.description}: commands 包含空命令`);
        }
      }
    }

    // 规则 7: steps 格式验证（如果存在）
    if (block.steps && block.steps.length > 0) {
      for (const step of block.steps) {
        if (step.trim().length === 0) {
          errors.push(`[${block.prefix}] ${block.description}: steps 包含空步骤`);
        }
      }
    }

    // 规则 8: expected 建议存在（非强制，warning 级别）
    // 注：expected 为建议字段，不纳入 A 类门禁
  }

  // 规则 9: 检查点数量一致性
  if (blocks.length !== checkpoints.length) {
    errors.push(`checkpoint.md 检查点数量(${blocks.length})与 meta.json(${checkpoints.length})不一致`);
  }

  // 规则 10: description 一致性
  const mdDescriptions = blocks.map(b => b.description);
  const metaDescriptions = checkpoints.map(cp => stripPrefixFromDescription(cp.description));
  const mismatched: string[] = [];
  for (let i = 0; i < Math.min(mdDescriptions.length, metaDescriptions.length); i++) {
    if (mdDescriptions[i] !== metaDescriptions[i]) {
      mismatched.push(`位置 ${i + 1}: md="${mdDescriptions[i]}" vs meta="${metaDescriptions[i]}"`);
    }
  }
  if (mismatched.length > 0) {
    errors.push(`checkpoint.md 与 meta.json description 不一致: ${mismatched.slice(0, 3).join('; ')}${mismatched.length > 3 ? '...' : ''}`);
  }

  if (errors.length === 0) return null;

  return {
    ruleId: 'checkpoint-md-format-validator',
    severity: 'error',
    message: `checkpoint.md 格式规范错误: ${errors.join('; ')}`,
  };
}

/**
 * 同步版本的验证函数（用于已有 checkpointMd 内容的情况）
 */
export function validateCheckpointMarkdownContent(
  checkpointMd: string,
  checkpoints: CheckpointMetadata[]
): ValidationViolation | null {
  const errors: string[] = [];

  // 规则 1: 文件必须以 `# 检查点列表` 开头
  const trimmedMd = checkpointMd.trim();
  if (!trimmedMd.startsWith('# 检查点列表') && !trimmedMd.startsWith('# Checkpoints')) {
    errors.push('文件必须以 "# 检查点列表" 或 "# Checkpoints" 开头');
  }

  // 解析所有检查点块
  const blocks = parseCheckpointMarkdown(checkpointMd);

  for (const block of blocks) {
    // 规则 2: prefix 必须是 System B 前缀
    if (!VALID_PREFIXES.includes(block.prefix as CheckpointPrefix)) {
      errors.push(`[${block.prefix}] 不是有效的 System B 前缀`);
    }

    // 规则 3: description 不能为空
    if (!block.description || block.description.trim().length === 0) {
      errors.push(`[${block.prefix}] description 不能为空`);
    }

    // 规则 4: [script] 前缀必须有 commands
    if (block.prefix === 'script' && (!block.commands || block.commands.length === 0)) {
      errors.push(`[script] ${block.description}: 必须有 commands`);
    }

    // 规则 5: [human qa] 前缀必须有 steps
    if (block.prefix === 'human-qa' && (!block.steps || block.steps.length === 0)) {
      errors.push(`[human qa] ${block.description}: 必须有 steps`);
    }
  }

  // 规则 9: 检查点数量一致性
  if (blocks.length !== checkpoints.length) {
    errors.push(`checkpoint.md 检查点数量(${blocks.length})与 meta.json(${checkpoints.length})不一致`);
  }

  if (errors.length === 0) return null;

  return {
    ruleId: 'checkpoint-md-format-validator',
    severity: 'error',
    message: `checkpoint.md 格式规范错误: ${errors.join('; ')}`,
  };
}
