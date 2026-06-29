/**
 * 检查点完整推断链
 *
 * 从 CheckpointBlock 生成完整的 CheckpointMetadata，
 * 补全推断链断点（CP-002+CP-003+CP-005）。
 *
 * 推断链路：
 * 1. 从 PREFIX_MAP 推断基础属性（category/method/requiresHuman）
 * 2. 从 CheckpointBlock 提取详细属性（commands/steps/expected）
 * 3. 构建完整 CheckpointMetadata
 *
 * @module checkpoint-infer
 */

import type { CheckpointMetadata, CheckpointCategory, TaskRole, CheckpointVerification } from '../../types/task.js';
import type { CheckpointBlock } from './checkpoint-parser.js';
import { PREFIX_MAP } from './prefix-map.js';
import { generateCheckpointId } from './checkpoint-parser.js';

/**
 * 从 CheckpointBlock 推断完整 CheckpointMetadata
 *
 * @param block - checkpoint.md 解析后的块
 * @returns 完整的 CheckpointMetadata
 */
export function inferCheckpointMetadata(block: CheckpointBlock): CheckpointMetadata {
  // 步骤 1: 从前缀推断基础属性
  const baseAttrs = PREFIX_MAP[block.prefix];

  // 步骤 2: 从 block 提取详细属性构建 verification
  const verification: CheckpointVerification = {
    method: baseAttrs.method as CheckpointVerification['method'],
    commands: block.commands.length > 0 ? block.commands : undefined,
    steps: block.steps.length > 0 ? block.steps : undefined,
    expected: block.expected || undefined,
    result: undefined, // 执行后填充
  };

  // 步骤 3: 构建完整 CheckpointMetadata
  return {
    id: generateCheckpointId(),
    description: block.description,
    status: 'pending',
    category: baseAttrs.category as CheckpointCategory,
    verification,
    requiresHuman: baseAttrs.requiresHuman,
    requiredRole: inferRoleFromCategory(baseAttrs.category),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 从 category 推断 requiredRole
 *
 * @param category - 检查点类别
 * @returns 推断的角色
 */
function inferRoleFromCategory(category: string): TaskRole {
  const roleMap: Record<string, TaskRole> = {
    'code_review': 'code_reviewer',
    'qa_verification': 'qa_tester',
    'evaluation': 'architect',
  };

  return roleMap[category] || 'executor';
}

/**
 * 批量推断检查点元数据
 *
 * @param blocks - CheckpointBlock 数组
 * @returns CheckpointMetadata 数组
 */
export function inferCheckpointMetadataBatch(blocks: CheckpointBlock[]): CheckpointMetadata[] {
  return blocks.map(block => inferCheckpointMetadata(block));
}