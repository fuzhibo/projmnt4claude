/**
 * checkpoint-consistency-validator 单元测试
 *
 * 覆盖 CP-004+CP-009+CP-010:
 * - code_review 分类: method=code_review, requiresHuman=false
 * - qa_verification 分类: method=automated/manual, requiresHuman 与 method 一致
 * - evaluation 分类: method=automated, requiresHuman=false
 * - [script] 前缀必须有 commands
 */

import { describe, test, expect } from '@jest/globals';
import { checkpointConsistencyValidator } from '../checkpoint-rules.js';
import type { CheckpointMetadata } from '../../../types/task.js';

// ============================================================
// 辅助函数：创建检查点对象
// ============================================================

function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-001',
    description: '[ai review] 测试检查点',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================
// code_review 分类测试
// ============================================================

describe('checkpointConsistencyValidator - code_review category', () => {
  test('passes when code_review has correct method and requiresHuman=false', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai review] 代码质量检查',
        category: 'code_review',
        verification: { method: 'code_review' },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('fails when code_review has wrong method', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai review] 代码质量检查',
        category: 'code_review',
        verification: { method: 'automated' },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.message).toContain('category=code_review');
    expect(result!.message).toContain('method=automated');
  });

  test('fails when code_review has requiresHuman=true', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai review] 代码质量检查',
        category: 'code_review',
        verification: { method: 'code_review' },
        requiresHuman: true,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('requiresHuman=true');
  });
});

// ============================================================
// qa_verification 分类测试
// ============================================================

describe('checkpointConsistencyValidator - qa_verification category', () => {
  test('passes when qa_verification has method=automated and requiresHuman=false', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai qa] 自动化测试',
        category: 'qa_verification',
        verification: { method: 'automated' },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('passes when qa_verification has method=manual and requiresHuman=true', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[human qa] 人工验证',
        category: 'qa_verification',
        verification: { method: 'manual' },
        requiresHuman: true,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('fails when qa_verification has method=automated but requiresHuman=true', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai qa] 自动化测试',
        category: 'qa_verification',
        verification: { method: 'automated' },
        requiresHuman: true,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('method=automated');
    expect(result!.message).toContain('requiresHuman=true');
  });

  test('fails when qa_verification has method=manual but requiresHuman=false', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[human qa] 人工验证',
        category: 'qa_verification',
        verification: { method: 'manual' },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('method=manual');
    expect(result!.message).toContain('requiresHuman=false');
  });
});

// ============================================================
// evaluation 分类测试
// ============================================================

describe('checkpointConsistencyValidator - evaluation category', () => {
  test('passes when evaluation has method=automated and requiresHuman=false', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行测试',
        category: 'evaluation',
        verification: {
          method: 'automated',
          commands: ['npm test'],  // [script] 前缀必须提供 commands
        },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('fails when evaluation has wrong method', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行测试',
        category: 'evaluation',
        verification: {
          method: 'code_review',
          commands: ['npm test'],
        },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('category=evaluation');
    expect(result!.message).toContain('method=code_review');
  });

  test('fails when evaluation has requiresHuman=true', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行测试',
        category: 'evaluation',
        verification: {
          method: 'automated',
          commands: ['npm test'],
        },
        requiresHuman: true,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('requiresHuman=true');
  });
});

// ============================================================
// [script] 前缀 commands 检查
// ============================================================

describe('checkpointConsistencyValidator - [script] prefix commands check', () => {
  test('passes when [script] has commands', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行构建',
        category: 'evaluation',
        verification: {
          method: 'automated',
          commands: ['npm run build'],
        },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('fails when [script] has no commands', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行构建',
        category: 'evaluation',
        verification: {
          method: 'automated',
        },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('[script]');
    expect(result!.message).toContain('缺少 commands');
  });

  test('fails when [script] has empty commands array', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[script] 运行构建',
        category: 'evaluation',
        verification: {
          method: 'automated',
          commands: [],
        },
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('缺少 commands');
  });
});

// ============================================================
// 边界情况测试
// ============================================================

describe('checkpointConsistencyValidator - edge cases', () => {
  test('returns null for empty checkpoints array', () => {
    const result = checkpointConsistencyValidator.check([]);
    expect(result).toBeNull();
  });

  test('handles checkpoints without category', () => {
    const checkpoints = [
      createCheckpoint({
        description: '无分类检查点',
        verification: { method: 'automated' },
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).toBeNull();
  });

  test('handles checkpoints without verification', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai review] 代码检查',
        category: 'code_review',
        requiresHuman: false,
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    // 没有 verification.method，但 category 是 code_review
    // 应该报错，因为 method 不是 code_review
    expect(result).not.toBeNull();
  });

  test('collects multiple errors in one message', () => {
    const checkpoints = [
      createCheckpoint({
        id: 'CP-001',
        description: '[ai review] 检查点1',
        category: 'code_review',
        verification: { method: 'automated' }, // 错误: method 不是 code_review
        requiresHuman: false,
      }),
      createCheckpoint({
        id: 'CP-002',
        description: '[ai qa] 检查点2',
        category: 'qa_verification',
        verification: { method: 'automated' },
        requiresHuman: true, // 错误: method=automated 但 requiresHuman=true
      }),
    ];

    const result = checkpointConsistencyValidator.check(checkpoints);
    expect(result).not.toBeNull();
    // 验证消息包含两个检查点的 description，而非 ID
    expect(result!.message).toContain('[ai review] 检查点1');
    expect(result!.message).toContain('[ai qa] 检查点2');
  });
});
