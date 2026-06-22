/**
 * 检查点前缀映射（与 investigation 共享）
 *
 * 定义 PREFIX_MAP 常量和 parseCheckpoint 函数，
 * 确保门禁字段（category/verificationMethod/requiresHuman）对齐。
 *
 * System A (旧): [verify]/[test]/[review]/[implem]/[doc]
 * System B (新): [ai review]/[ai qa]/[human qa]/[script]
 */

import { inferCheckpointAttributesFromPrefix } from '../validation-rules/checkpoint-rules.js';

// ============================================================
// PREFIX_MAP: 前缀 → 门禁字段映射
// ============================================================

export const PREFIX_MAP: Record<string, { category: string; method: string; requiresHuman: boolean }> = {
  // System A (旧前缀，向后兼容)
  verify: { category: 'qa_verification', method: 'functional_test', requiresHuman: false },
  test:   { category: 'qa_verification', method: 'unit_test',       requiresHuman: false },
  review: { category: 'code_review',     method: 'code_review',     requiresHuman: true  },
  implem: { category: 'implementation',  method: 'automated',       requiresHuman: false },
  doc:    { category: 'documentation',   method: 'automated',       requiresHuman: false },
  // System B (新前缀)
  'ai-review': { category: 'code_review',     method: 'code_review',     requiresHuman: false },
  'ai-qa':     { category: 'qa_verification', method: 'automated',       requiresHuman: false },
  'human-qa':  { category: 'qa_verification', method: 'automated',       requiresHuman: true  },
  script:      { category: 'evaluation',      method: 'automated',       requiresHuman: false },
};

export type CheckpointPrefix = keyof typeof PREFIX_MAP;

export const VALID_PREFIXES = Object.keys(PREFIX_MAP) as CheckpointPrefix[];

// ============================================================
// ParsedCheckpoint 类型
// ============================================================

export interface ParsedCheckpoint {
  prefix: CheckpointPrefix | null;
  description: string;
  category: string;
  verificationMethod: string | null;
  requiresHuman: boolean;
}

// ============================================================
// parseCheckpoint: 纯函数，解析检查点文本
// ============================================================

/** 从检查点文本解析前缀并映射门禁字段，无匹配返回 null */
export function parseCheckpoint(raw: string): ParsedCheckpoint | null {
  // Step 1: 尝试 System B 前缀 ([ai review]/[ai qa]/[human qa]/[script])
  const systemBMatch = raw.match(/^\[(ai review|ai qa|human qa|script)\]\s*(.+)/);
  if (systemBMatch) {
    const prefix = systemBMatch[1]!;
    const desc = systemBMatch[2]!.trim();
    const attrs = inferCheckpointAttributesFromPrefix(`[${prefix}] ${desc}`);
    return {
      prefix: prefix.replace(' ', '-') as CheckpointPrefix,
      description: desc,
      category: attrs.category || 'qa_verification',
      verificationMethod: attrs.verificationMethod || null,
      requiresHuman: attrs.requiresHuman ?? false,
    };
  }

  // Step 2: 兼容 System A 旧前缀 ([verify]/[test]/[review]/[implem]/[doc])
  const legacyMatch = raw.match(/^\[(verify|test|review|implem|doc)\]\s*(.+)/);
  if (!legacyMatch) return null;
  const prefix = legacyMatch[1] as CheckpointPrefix;
  const mapped = PREFIX_MAP[prefix]!;
  return {
    prefix,
    description: legacyMatch[2]!.trim(),
    category: mapped.category,
    verificationMethod: mapped.method,
    requiresHuman: mapped.requiresHuman,
  };
}

/** 检查字符串是否包含有效的检查点前缀（System A + System B） */
export function hasValidPrefix(text: string): boolean {
  return /^\[(verify|test|review|implem|doc|ai review|ai qa|human qa|script)\]/.test(text);
}