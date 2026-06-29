/**
 * checkpoint.md 扩展格式解析器
 *
 * 实现从 checkpoint.md 提取 description + commands/steps/expected，
 * 补全推断链断点（CP-002+CP-003+CP-005）。
 *
 * @module checkpoint-parser
 */

import type { CheckpointPrefix } from './prefix-map.js';

/**
 * checkpoint.md 扩展格式块
 */
export interface CheckpointBlock {
  prefix: CheckpointPrefix;
  description: string;
  commands: string[];
  steps: string[];
  expected: string;
}

/**
 * 解析 checkpoint.md 扩展格式，提取 description + commands/steps/expected
 *
 * 支持格式：
 * ```markdown
 * ## [ai review] 文档结构完整性
 * - commands: `npx eslint docs/architecture.md`
 * - steps: 检查文档结构完整性
 * - expected: 无 lint 错误，文档结构完整
 * ```
 *
 * @param markdown - checkpoint.md 内容
 * @returns CheckpointBlock 数组
 */
export function parseCheckpointMarkdown(markdown: string): CheckpointBlock[] {
  const blocks: CheckpointBlock[] = [];

  // 按 ## 分割章节
  const sections = markdown.split(/^## /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');

    // 第一行：[prefix] description
    const headerMatch = lines[0]?.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!headerMatch) continue;

    // 标准化前缀（空格替换为连字符）
    const prefixStr = headerMatch[1]!.toLowerCase().replace(/\s+/g, '-') as CheckpointPrefix;

    // 验证前缀有效性（System B 标准前缀）
    const validPrefixes = ['ai-review', 'ai-qa', 'human-qa', 'script'];
    if (!validPrefixes.includes(prefixStr)) continue;

    const description = headerMatch[2]!.trim();

    // 提取 commands/steps/expected
    let commands: string[] = [];
    let steps: string[] = [];
    let expected = '';

    for (const line of lines.slice(1)) {
      const trimmedLine = line.trim();

      // commands: 支持反引号包裹或逗号分隔
      const cmdMatch = trimmedLine.match(/^- commands:\s*(.+)$/);
      if (cmdMatch) {
        commands = parseListValue(cmdMatch[1]!);
        continue;
      }

      // steps: 支持逗号分隔或"无"
      const stepMatch = trimmedLine.match(/^- steps:\s*(.+)$/);
      if (stepMatch) {
        steps = parseListValue(stepMatch[1]!);
        continue;
      }

      // expected: 单行文本
      const expMatch = trimmedLine.match(/^- expected:\s*(.+)$/);
      if (expMatch) {
        expected = expMatch[1]!.trim();
        continue;
      }
    }

    blocks.push({
      prefix: prefixStr,
      description,
      commands,
      steps,
      expected,
    });
  }

  return blocks;
}

/**
 * 解析列表值（支持反引号包裹或逗号分隔）
 *
 * @param value - 列表值字符串
 * @returns 解析后的数组
 */
function parseListValue(value: string): string[] {
  const trimmed = value.trim();

  // "无" 表示空数组
  if (trimmed === '无' || trimmed === 'none' || trimmed === '') {
    return [];
  }

  // 反引号包裹的命令：`cmd1`, `cmd2`
  const backtickMatches = trimmed.match(/`([^`]+)`/g);
  if (backtickMatches && backtickMatches.length > 0) {
    return backtickMatches.map(m => m.slice(1, -1));
  }

  // 逗号分隔：cmd1, cmd2, cmd3
  if (trimmed.includes(',')) {
    return trimmed.split(',').map(v => v.trim()).filter(Boolean);
  }

  // 单个值
  return [trimmed];
}

/**
 * 生成检查点 ID
 * 格式：CP-{timestamp}-{random}
 */
export function generateCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `CP-${timestamp}-${random}`;
}