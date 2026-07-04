/**
 * 检查点格式规范
 *
 * 定义模板和解析器共享的检查点格式契约，确保 AI 输出与解析器期望一致。
 *
 * 格式规范：
 * - 完整格式：`- [prefix] 描述 → SOL-NNN`
 * - 简化格式：`- [prefix] 描述`（需从分组标题推断 belongsTo）
 * - 分组标题：`### SOL-NNN 相关检查点` 或 `### SOL-NNN Related Checkpoints`
 */

import type { CheckpointPrefix } from '../init-requirement/prefix-map.js';

/** 有效的检查点前缀（System B 门禁标准） */
export const VALID_CHECKPOINT_PREFIXES: string[] = [
  'ai review',
  'ai qa',
  'human qa',
  'script',
];

/** 标准化前缀映射（处理变体，输出 kebab-case） */
export const PREFIX_NORMALIZE_MAP: Record<string, CheckpointPrefix | null> = {
  // System B 标准 (kebab-case, 规范化输出)
  'ai review': 'ai-review',
  'ai qa': 'ai-qa',
  'human qa': 'human-qa',
  'script': 'script',
  // System A legacy (deprecated, normalize to System B)
  'ai': 'ai-qa',
  'review': 'ai-review',
  'qa': 'ai-qa',
  'human': 'human-qa',
  // Hyphenated variants (already kebab-case)
  'ai-review': 'ai-review',
  'ai-qa': 'ai-qa',
  'human-qa': 'human-qa',
};

/** 检查点格式正则表达式 */
export const CHECKPOINT_REGEX = {
  /** 完整格式：`- [prefix] 描述 → SOL-NNN` */
  full: /^- \[([a-z][a-z\s-]*?)\] (.+?)(?:\s*\(?\s*(?:→|->)\s*(SOL-\d+)\s*\)?)?\s*$/gm,

  /** 简化格式：`- [prefix] 描述`（无 belongsTo） */
  simple: /^- \[([a-z][a-z\s-]*?)\] (.+)$/gm,

  /** 分组标题：`### SOL-NNN 相关检查点` 或 `### SOL-NNN Related Checkpoints` */
  sectionTitle: /^### (SOL-\d+)(?:\s+(?:相关检查点|Related Checkpoints))?$/m,
};

/**
 * 检查点格式工具集
 */
export const CheckpointFormat = {
  /**
   * 生成标准格式的检查点文本
   */
  generate(prefix: CheckpointPrefix, description: string, belongsTo: string): string {
    return `- [${prefix}] ${description} → ${belongsTo}`;
  },

  /**
   * 生成分组标题
   */
  generateSectionTitle(solId: string, language: 'zh' | 'en' = 'zh'): string {
    return language === 'zh'
      ? `### ${solId} 相关检查点`
      : `### ${solId} Related Checkpoints`;
  },

  /**
   * 验证并解析完整格式检查点
   */
  validateFull(checkpoint: string): {
    valid: boolean;
    prefix?: CheckpointPrefix;
    description?: string;
    belongsTo?: string;
  } {
    const re = new RegExp(CHECKPOINT_REGEX.full.source, 'm');
    const match = re.exec(checkpoint);
    if (!match || !match[1] || !match[2] || !match[3]) {
      return { valid: false };
    }

    const normalizedPrefix = this.normalizePrefix(match[1]);
    if (!normalizedPrefix) {
      return { valid: false };
    }

    return {
      valid: true,
      prefix: normalizedPrefix,
      description: match[2].trim(),
      belongsTo: match[3],
    };
  },

  /**
   * 验证并解析简化格式检查点（需配合 context 推断 belongsTo）
   */
  validateSimple(checkpoint: string): {
    valid: boolean;
    prefix?: CheckpointPrefix;
    description?: string;
  } {
    const re = new RegExp(CHECKPOINT_REGEX.simple.source, 'm');
    const match = re.exec(checkpoint);
    if (!match || !match[1] || !match[2]) {
      return { valid: false };
    }

    const normalizedPrefix = this.normalizePrefix(match[1]);
    if (!normalizedPrefix) {
      return { valid: false };
    }

    return {
      valid: true,
      prefix: normalizedPrefix,
      description: match[2].trim(),
    };
  },

  /**
   * 标准化前缀
   */
  normalizePrefix(rawPrefix: string): CheckpointPrefix | null {
    const key = rawPrefix.trim().toLowerCase();
    return PREFIX_NORMALIZE_MAP[key] ?? null;
  },

  /**
   * 从分组标题提取 SOL ID
   */
  extractSolFromTitle(title: string): string | null {
    const match = CHECKPOINT_REGEX.sectionTitle.exec(title);
    return match?.[1] ?? null;
  },

  /**
   * 从上下文推断 belongsTo（查找最近的分组标题）
   */
  inferBelongsToFromContext(sectionMd: string, checkpointIndex: number): string {
    const beforeMatch = sectionMd.substring(0, checkpointIndex);
    const titleMatches = [...beforeMatch.matchAll(new RegExp(CHECKPOINT_REGEX.sectionTitle.source, 'gm'))];
    if (titleMatches.length === 0) return '';
    return titleMatches[titleMatches.length - 1]?.[1] ?? '';
  },

  /**
   * 验证检查点列表格式契约是否满足
   */
  validateContract(checkpointsMd: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const lines = checkpointsMd.split('\n').filter(l => l.trim());
    let currentSection: string | null = null;

    for (const line of lines) {
      // 检查分组标题
      const sectionSol = this.extractSolFromTitle(line);
      if (sectionSol) {
        currentSection = sectionSol;
        continue;
      }

      // 检查检查点格式
      const fullResult = this.validateFull(line);
      if (fullResult.valid) {
        // 完整格式，检查 belongsTo 是否与当前分组一致
        if (currentSection && fullResult.belongsTo !== currentSection) {
          warnings.push(
            `检查点 "${line}" 的 belongsTo (${fullResult.belongsTo}) 与分组标题 (${currentSection}) 不一致`
          );
        }
        continue;
      }

      const simpleResult = this.validateSimple(line);
      if (simpleResult.valid) {
        // 简化格式，检查是否有分组标题
        if (!currentSection) {
          errors.push(
            `简化格式检查点 "${line}" 缺少分组标题无法推断 belongsTo`
          );
        }
        continue;
      }

      // 既不是标题也不是检查点，忽略（可能是其他内容）
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },
};