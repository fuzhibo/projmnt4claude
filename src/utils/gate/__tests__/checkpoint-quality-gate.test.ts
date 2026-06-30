/**
 * checkpoint-quality-gate 单元测试
 *
 * 测试覆盖:
 * - executeCheckpointQualityGate: 异步门禁（同步+异步验证器）
 * - executeCheckpointQualityGateSync: 同步门禁（仅同步验证器）
 * - validateCheckpointsAfterCreation: 任务创建阶段门禁
 * - executePreDevCheckpointGate: Pre-Dev Gate 阶段门禁
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  executeCheckpointQualityGate,
  executeCheckpointQualityGateSync,
  validateCheckpointsAfterCreation,
  executePreDevCheckpointGate,
} from '../checkpoint-quality-gate.js';
import type { CheckpointMetadata } from '../../../types/task.js';
import * as fs from 'fs';

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

function createValidCodeReviewCheckpoint(): CheckpointMetadata {
  return createCheckpoint({
    // description 含前缀（符合 checkpoint-required-prefix 验证）
    description: '[ai review] 代码质量检查',
    category: 'code_review',
    verification: { method: 'code_review' },
    requiresHuman: false,
  });
}

function createValidQaCheckpoint(method: 'automated' | 'manual' = 'automated'): CheckpointMetadata {
  return createCheckpoint({
    id: 'CP-002',
    description: method === 'automated' ? '[ai qa] 自动化测试' : '[human qa] 人工验证',
    category: 'qa_verification',
    verification: method === 'automated'
      ? { method, commands: ['npm test'] }
      : { method, steps: ['执行人工验证'] },
    requiresHuman: method === 'manual',
  });
}

function createValidEvaluationCheckpoint(): CheckpointMetadata {
  return createCheckpoint({
    id: 'CP-003',
    description: '[script] 运行构建',
    category: 'evaluation',
    verification: {
      method: 'automated',
      commands: ['npm run build'],
    },
    requiresHuman: false,
  });
}

// ============================================================
// executeCheckpointQualityGateSync 测试
// ============================================================

describe('executeCheckpointQualityGateSync', () => {
  test('returns passed=true for empty checkpoints array', () => {
    const result = executeCheckpointQualityGateSync([]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('returns passed=true for valid checkpoints', () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
      createValidQaCheckpoint('automated'),
      createValidEvaluationCheckpoint(),
    ];

    const result = executeCheckpointQualityGateSync(checkpoints);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('returns passed=false for checkpoint missing required prefix', () => {
    const checkpoints = [
      createCheckpoint({
        description: '无前缀检查点',
      }),
    ];

    const result = executeCheckpointQualityGateSync(checkpoints);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]?.ruleId).toBe('checkpoint-required-prefix');
  });

  test('returns passed=false for code_review with wrong method', () => {
    const checkpoints = [
      createCheckpoint({
        description: '[ai review] 代码检查',
        category: 'code_review',
        verification: { method: 'automated' },
        requiresHuman: false,
      }),
    ];

    const result = executeCheckpointQualityGateSync(checkpoints);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.ruleId === 'checkpoint-consistency-validator')).toBe(true);
  });

  test('collects multiple violations', () => {
    const checkpoints = [
      createCheckpoint({
        description: '无前缀检查点',
      }),
      createCheckpoint({
        id: 'CP-002',
        description: '[script] 无命令',
        category: 'evaluation',
        verification: { method: 'automated' },
        requiresHuman: false,
      }),
    ];

    const result = executeCheckpointQualityGateSync(checkpoints);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// executeCheckpointQualityGate 测试（异步）
// ============================================================

describe('executeCheckpointQualityGate', () => {
  let readFileSpy: jest.SpiedFunction<typeof fs.promises.readFile>;

  beforeEach(() => {
    readFileSpy = jest.spyOn(fs.promises, 'readFile');
  });

  afterEach(() => {
    readFileSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('returns passed=true without context (skips async validators)', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
    ];

    const result = await executeCheckpointQualityGate(checkpoints);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('returns passed=false when checkpoint.md not found', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    readFileSpy.mockRejectedValue(new Error('File not found'));

    const result = await executeCheckpointQualityGate(checkpoints, context);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.ruleId === 'checkpoint-sync-validator')).toBe(true);
  });

  test('returns passed=true when checkpoint.md matches meta.json', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    // Mock checkpoint.md content (使用 ## 格式，符合 parseCheckpointMarkdown 解析逻辑)
    const mockCheckpointMd = `# 检查点列表

## [ai review] 代码质量检查`;

    readFileSpy.mockResolvedValue(mockCheckpointMd);

    const result = await executeCheckpointQualityGate(checkpoints, context);
    expect(result.passed).toBe(true);
  });

  test('returns passed=false when checkpoint.md count mismatch', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
      createValidQaCheckpoint(),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    // Mock checkpoint.md with only one checkpoint
    const mockCheckpointMd = `# 检查点列表

- [ai review] 代码质量检查`;

    readFileSpy.mockResolvedValue(mockCheckpointMd);

    const result = await executeCheckpointQualityGate(checkpoints, context);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.ruleId === 'checkpoint-sync-validator')).toBe(true);
  });
});

// ============================================================
// validateCheckpointsAfterCreation 测试
// ============================================================

describe('validateCheckpointsAfterCreation', () => {
  let readFileSpy: jest.SpiedFunction<typeof fs.promises.readFile>;

  beforeEach(() => {
    readFileSpy = jest.spyOn(fs.promises, 'readFile');
  });

  afterEach(() => {
    readFileSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('returns success=true for valid checkpoints', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    readFileSpy.mockResolvedValue(`# 检查点列表\n\n## [ai review] 代码质量检查`);

    const result = await validateCheckpointsAfterCreation(checkpoints, context);
    expect(result.success).toBe(true);
    expect(result.checkpoints).toEqual(checkpoints);
    expect(result.error).toBeUndefined();
    expect(result.violations).toBeUndefined();
    expect(result.retryAllowed).toBeUndefined();
  });

  test('returns success=false with retryAllowed=true for gate failure', async () => {
    const checkpoints = [
      createCheckpoint({
        description: '无前缀检查点',
      }),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    const result = await validateCheckpointsAfterCreation(checkpoints, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('检查点质量门禁失败');
    expect(result.violations?.length).toBeGreaterThan(0);
    expect(result.retryAllowed).toBe(true);
  });
});

// ============================================================
// executePreDevCheckpointGate 测试
// ============================================================

describe('executePreDevCheckpointGate', () => {
  let readFileSpy: jest.SpiedFunction<typeof fs.promises.readFile>;

  beforeEach(() => {
    readFileSpy = jest.spyOn(fs.promises, 'readFile');
  });

  afterEach(() => {
    readFileSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('returns passed=true for valid checkpoints', async () => {
    const checkpoints = [
      createValidCodeReviewCheckpoint(),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    readFileSpy.mockResolvedValue(`# 检查点列表\n\n## [ai review] 代码质量检查`);

    const result = await executePreDevCheckpointGate(checkpoints, context);
    expect(result.passed).toBe(true);
    expect(result.phase).toBe('pre-dev');
    expect(result.violations).toBeUndefined();
  });

  test('returns passed=false with violations for invalid checkpoints', async () => {
    const checkpoints = [
      createCheckpoint({
        description: '无前缀检查点',
      }),
    ];

    const context = {
      taskId: 'TASK-test-001',
      cwd: '/test/workspace',
    };

    const result = await executePreDevCheckpointGate(checkpoints, context);
    expect(result.passed).toBe(false);
    expect(result.phase).toBe('pre-dev');
    expect(result.violations?.length).toBeGreaterThan(0);
  });
});
