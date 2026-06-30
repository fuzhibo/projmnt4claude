/**
 * 检查点数据保护规则
 *
 * 来源：CP-010 数据保护规则
 * 核心：meta.json 为唯一权威数据源，checkpoint.md 为索引
 */

/**
 * 检查点数据保护规则配置
 */
export const CHECKPOINT_PROTECTION_RULES = {
  /**
   * 规则 1: 单向同步原则
   * meta.json → checkpoint.md（仅索引）
   */
  SYNC_DIRECTION: 'meta_to_checkpoint',

  /**
   * 规则 2: 权威数据源原则
   * 所有修改必须先写入 meta.json
   */
  AUTHORITATIVE_SOURCE: 'meta.json',

  /**
   * 规则 3: 索引简化原则
   * checkpoint.md 只包含 description
   */
  INDEX_SIMPLIFICATION: true,

  /**
   * 规则 4: 编辑保护原则
   * 禁止直接编辑 checkpoint.md，必须通过 CLI
   */
  EDIT_PROTECTION: true,
} as const;

/**
 * 检查点保护规则类型
 */
export type CheckpointProtectionRule = keyof typeof CHECKPOINT_PROTECTION_RULES;

/**
 * 检查点保护规则值类型
 */
export type CheckpointProtectionConfig = typeof CHECKPOINT_PROTECTION_RULES;