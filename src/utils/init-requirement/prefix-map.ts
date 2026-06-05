/**
 * 检查点前缀映射（与 investigation 共享）
 *
 * 定义 PREFIX_MAP 常量和 parseCheckpoint 函数，
 * 确保门禁字段（category/verificationMethod/requiresHuman）对齐。
 */

// ============================================================
// PREFIX_MAP: 5 种前缀 → 门禁字段映射
// ============================================================

export const PREFIX_MAP: Record<string, { category: string; method: string; requiresHuman: boolean }> = {
  verify: { category: 'qa_verification', method: 'functional_test', requiresHuman: false },
  test:   { category: 'qa_verification', method: 'unit_test',       requiresHuman: false },
  review: { category: 'code_review',     method: 'code_review',     requiresHuman: true  },
  implem: { category: 'implementation',  method: 'automated',       requiresHuman: false },
  doc:    { category: 'documentation',   method: 'automated',       requiresHuman: false },
};

export type CheckpointPrefix = keyof typeof PREFIX_MAP;

export const VALID_PREFIXES = Object.keys(PREFIX_MAP) as CheckpointPrefix[];

// ============================================================
// ParsedCheckpoint 类型
// ============================================================

export interface ParsedCheckpoint {
  prefix: CheckpointPrefix;
  description: string;
  category: string;
  verificationMethod: string;
  requiresHuman: boolean;
}

// ============================================================
// parseCheckpoint: 纯函数，解析检查点文本
// ============================================================

/** 从检查点文本解析前缀并映射门禁字段，无匹配返回 null */
export function parseCheckpoint(raw: string): ParsedCheckpoint | null {
  const match = raw.match(/^\[(verify|test|review|implem|doc)\]\s*(.+)/);
  if (!match) return null;
  const prefix = match[1] as CheckpointPrefix;
  const mapped = PREFIX_MAP[prefix];
  return {
    prefix,
    description: match[2].trim(),
    category: mapped.category,
    verificationMethod: mapped.method,
    requiresHuman: mapped.requiresHuman,
  };
}

/** 检查字符串是否包含有效的检查点前缀 */
export function hasValidPrefix(text: string): boolean {
  return /^\[(verify|test|review|implem|doc)\]/.test(text);
}