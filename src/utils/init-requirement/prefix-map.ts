/**
 * 检查点前缀映射（与 investigation 共享）
 *
 * 定义 PREFIX_MAP 常量和 parseCheckpoint 函数，
 * 确保门禁字段（category/verificationMethod/requiresHuman）对齐。
 *
 * System B 标准前缀: [ai review]/[ai qa]/[human qa]/[script]
 */

// ============================================================
// PREFIX_MAP: 前缀 → 门禁字段映射（仅 System B）
// ============================================================

export const PREFIX_MAP = {
  'ai-review': { category: 'code_review',     method: 'code_review', requiresHuman: false },
  'ai-qa':     { category: 'qa_verification', method: 'automated',   requiresHuman: false },
  'human-qa':  { category: 'qa_verification', method: 'automated',   requiresHuman: true  },
  'script':    { category: 'evaluation',      method: 'automated',   requiresHuman: false },
} as const;

export type CheckpointPrefix = keyof typeof PREFIX_MAP;

export const VALID_PREFIXES: CheckpointPrefix[] = Object.keys(PREFIX_MAP) as CheckpointPrefix[];

// ============================================================
// ParsedCheckpoint 类型
// ============================================================

export interface ParsedCheckpoint {
  prefix: CheckpointPrefix;
  description: string;
  category: string;
  verificationMethod: string | null;
  requiresHuman: boolean;
  warnings: string[];
}

// ============================================================
// 废弃前缀迁移映射
// ============================================================

const MIGRATION_MAP: Record<string, { prefix: CheckpointPrefix; descPrefix: string }> = {
  verify: { prefix: 'ai-qa',    descPrefix: '[ai qa]' },
  test:   { prefix: 'ai-qa',    descPrefix: '[ai qa]' },
  review: { prefix: 'ai-review', descPrefix: '[ai review]' },
  implem: { prefix: 'ai-qa',    descPrefix: '[ai qa] (implementation)' },
  doc:    { prefix: 'script',   descPrefix: '[script] (doc)' },
};

// ============================================================
// parseCheckpoint: 纯函数，解析检查点文本
// ============================================================

/** 从检查点文本解析前缀并映射门禁字段，无匹配返回 null */
export function parseCheckpoint(raw: string): ParsedCheckpoint | null {
  const trimmed = raw.trim();

  // Step 1: 匹配 System B 标准前缀 ([ai review]/[ai qa]/[human qa]/[script])
  const systemBMatch = trimmed.match(/^\[(ai review|ai qa|human qa|script)\]\s*(.+)/i);
  if (systemBMatch) {
    const prefixStr = systemBMatch[1]!.toLowerCase().replace(' ', '-') as CheckpointPrefix;
    const desc = systemBMatch[2]!.trim();
    const attrs = PREFIX_MAP[prefixStr];
    return {
      prefix: prefixStr,
      description: desc,
      category: attrs.category,
      verificationMethod: attrs.method,
      requiresHuman: attrs.requiresHuman,
      warnings: [],
    };
  }

  // Step 2: 兼容废弃的 System A 前缀，发出警告并迁移
  const legacyMatch = trimmed.match(/^\[(verify|test|review|implem|doc)\]\s*(.+)/i);
  if (legacyMatch) {
    const oldPrefix = legacyMatch[1]!.toLowerCase();
    const originalDesc = legacyMatch[2]!.trim();
    const migration = MIGRATION_MAP[oldPrefix];
    if (!migration) return null;
    const attrs = PREFIX_MAP[migration.prefix];

    return {
      prefix: migration.prefix,
      description: `${migration.descPrefix} ${originalDesc}`,
      category: attrs.category,
      verificationMethod: attrs.method,
      requiresHuman: attrs.requiresHuman,
      warnings: [
        `前缀 "[${oldPrefix}]" 已废弃，已自动迁移为 "${migration.descPrefix} ${originalDesc}"`,
      ],
    };
  }

  return null;
}

/** 将任意前缀（System A 或 B）归一化为 System B CheckpointPrefix，未知返回 null */
export function normalizePrefix(raw: string): CheckpointPrefix | null {
  const trimmed = raw.trim().toLowerCase();
  const kebab = trimmed.replace(/\s+/g, '-');
  if (kebab in PREFIX_MAP) return kebab as CheckpointPrefix;
  const migration = MIGRATION_MAP[trimmed];
  return migration?.prefix ?? null;
}
export function hasValidPrefix(text: string): boolean {
  return /^\[(ai review|ai qa|human qa|script)\]/i.test(text);
}

/** 检查字符串是否包含废弃的 System A 前缀 */
export function hasDeprecatedPrefix(text: string): boolean {
  return /^\[(verify|test|review|implem|doc)\]/i.test(text);
}
