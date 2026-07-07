/**
 * 模板-解析器共享契约规范 (SOL-001)
 *
 * 本文件是 investigation 报告格式契约的**单一真相源**：
 * - prompt-templates/i18n/{zh,en}.ts 通过引用此处常量生成模板
 * - investigation/report-parser.ts 通过引用此处常量解析报告
 *
 * 任何章节标题、字段标签、编号格式的变更必须在此文件统一修改，
 * 模板与解析器会自动保持一致，杜绝契约断裂。
 *
 * 关联文档: docs/investigation-init-requirement/SOL-001-template-parser-contract-design.md
 */

// ============================================================
// 章节标题契约
// ============================================================

/**
 * 报告标准章节标题（中英双语）
 *
 * 模板使用：在输出格式中作为 `## {title}` 二级标题
 * 解析器使用：通过 extractSection(md, zh, en) 定位章节内容
 */
export const REPORT_SECTIONS = {
  metadata: { zh: '元数据', en: 'Metadata' },
  rootCauseAnalysis: { zh: '原因分析', en: 'Root Cause Analysis' },
  solutions: { zh: '解决方案', en: 'Solutions' },
  checkpoints: { zh: '检查点覆盖清单', en: 'Checkpoint Checklist' },
  assessment: { zh: '评估', en: 'Assessment' },
} as const;

export type ReportSectionKey = keyof typeof REPORT_SECTIONS;

// ============================================================
// 编号格式契约
// ============================================================

/** 原因分析编号前缀 */
export const CA_PREFIX = 'CA-';

/** 解决方案编号前缀 */
export const SOL_PREFIX = 'SOL-';

/** CA-NNN 完整编号校验正则（NNN 至少 3 位数字） */
export const CA_FORMAT = /^CA-\d{3,}$/;

/** SOL-NNN 完整编号校验正则（NNN 至少 3 位数字） */
export const SOL_FORMAT = /^SOL-\d{3,}$/;

/**
 * 构造 CA-NNN 形式编号
 * @param n 数字或已格式化的数字串（如 1 / '001'）
 */
export function buildCaId(n: number | string): string {
  const digits = typeof n === 'number' ? String(n).padStart(3, '0') : n;
  return `${CA_PREFIX}${digits}`;
}

/**
 * 构造 SOL-NNN 形式编号
 * @param n 数字或已格式化的数字串（如 1 / '001'）
 */
export function buildSolId(n: number | string): string {
  const digits = typeof n === 'number' ? String(n).padStart(3, '0') : n;
  return `${SOL_PREFIX}${digits}`;
}

/**
 * 构造解析器使用的章节内 CA 标题正则：`### (CA-\d+): (.+)`
 * 使用 \d+ 而非 \d{3,} 以兼容历史报告中可能存在的 1-2 位编号
 * 注意：宽松解析（\d+）与严格校验（CA_FORMAT 的 \d{3,}）的分工——
 *       解析器容忍旧格式，但模板仅输出 ≥3 位的规范格式
 */
export function buildCaHeadingRegex(): RegExp {
  return new RegExp(`### (${CA_PREFIX}\\d+): (.+)`, 'g');
}

/**
 * 构造解析器使用的章节内 SOL 标题正则：`### (SOL-\d+): (.+)`
 * 使用 \d+ 而非 \d{3,} 以兼容历史报告中可能存在的 1-2 位编号
 * 注意：宽松解析（\d+）与严格校验（SOL_FORMAT 的 \d{3,}）的分工——
 *       解析器容忍旧格式，但模板仅输出 ≥3 位的规范格式
 */
export function buildSolHeadingRegex(): RegExp {
  return new RegExp(`### (${SOL_PREFIX}\\d+): (.+)`, 'g');
}

// ============================================================
// 元数据字段标签契约
// ============================================================

/**
 * 元数据字段标签（中英双语）
 *
 * 模板使用：`- **{label}**: {value}`
 * 解析器使用：extractField(md, zh, en)
 */
export const METADATA_FIELDS = {
  requirementSource: { zh: '需求来源', en: 'Requirement Source' },
  investigationDate: { zh: '调查时间', en: 'Investigation Date' },
  investigationDir: { zh: '调查目录', en: 'Investigation Dir' },
  language: { zh: '语言', en: 'Language' },
  parentReport: { zh: '父报告', en: 'Parent Report' },
  dependsOn: { zh: '依赖子报告', en: 'Depends On' },
} as const;

export type MetadataFieldKey = keyof typeof METADATA_FIELDS;

// ============================================================
// 解决方案字段标签契约
// ============================================================

/**
 * 解决方案条目内嵌字段标签（中英双语）
 *
 * 模板使用：`- {label}: {value}`
 * 解析器使用：extractInlineField(body, zh, en)
 */
export const SOLUTION_FIELDS = {
  correspondsTo: { zh: '对应原因', en: 'Corresponds To' },
  files: { zh: '涉及文件', en: 'Files' },
  expectedChanges: { zh: '预期变更', en: 'Expected Changes' },
} as const;

export type SolutionFieldKey = keyof typeof SOLUTION_FIELDS;

// ============================================================
// 评估字段标签契约
// ============================================================

/**
 * 评估字段标签（中英双语）
 *
 * 模板使用：`- {label}: {value}`
 * 解析器使用：extractInlineField(sectionMd, zh, en)
 */
export const ASSESSMENT_FIELDS = {
  complexity: { zh: '复杂度', en: 'Complexity' },
  impactScope: { zh: '影响范围', en: 'Impact Scope' },
  estimatedMinutes: { zh: '预估工时', en: 'Estimated Minutes' },
} as const;

export type AssessmentFieldKey = keyof typeof ASSESSMENT_FIELDS;

// ============================================================
// 评估字段值域契约
// ============================================================

/**
 * 评估字段值域常量
 *
 * 解析器使用：validateImpactScope() 中英文映射与回退值
 */
export const ASSESSMENT_VALUES = {
  impactScope: {
    options: ['有限', '中等', '广泛'] as const,
    enMapping: {
      limited: '有限',
      medium: '中等',
      moderate: '中等',
      wide: '广泛',
      broad: '广泛',
      extensive: '广泛',
    } as const,
    fallback: '中等' as const,
  },
  complexity: {
    options: ['low', 'medium', 'high'] as const,
    zhMapping: {
      低: 'low',
      中: 'medium',
      高: 'high',
    } as const,
    fallback: 'medium' as const,
  },
} as const;
