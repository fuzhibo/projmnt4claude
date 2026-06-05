/**
 * checkCompletedCheckpoints 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  checkCompletedCheckpoints,
  validateHumanCheckpointCompletion,
  reportFalseSuccessWarnings,
  CheckpointOutputVerifier,
  type FalseSuccessWarning,
  type CheckpointCompletionResult,
} from '../utils/checkpoint-verification.js';
import type { TaskMeta } from '../types/task.js';

// ============================================================
// Helpers
// ============================================================

function createTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: 'Test Task',
    description: 'Test description',
    priority: 'P1',
    status: 'in_progress',
    createdAt: '2026-05-20T00:00:00Z',
    updatedAt: '2026-05-20T00:00:00Z',
    checkpoints: [],
    ...overrides,
  };
}

function createCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'CP-001',
    description: 'Test checkpoint',
    status: 'completed',
    requiresHuman: false,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('checkCompletedCheckpoints', () => {
  describe('empty checkpoints', () => {
    it('should return empty completed list when task has no checkpoints', async () => {
      const task = createTask({ checkpoints: undefined });
      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual([]);
      expect(result.falseSuccesses).toEqual([]);
      expect(result.hasFalseSuccess).toBe(false);
    });

    it('should return empty completed list when checkpoints array is empty', async () => {
      const task = createTask({ checkpoints: [] });
      const result = await checkCompletedCheckpoints(task, []);

      expect(result.completed).toEqual([]);
      expect(result.hasFalseSuccess).toBe(false);
    });

    it('should skip checkpoint IDs not found in task', async () => {
      const task = createTask({
        checkpoints: [createCheckpoint({ id: 'CP-001', status: 'completed' })],
      });
      const result = await checkCompletedCheckpoints(task, ['CP-999']);

      expect(result.completed).toEqual([]);
    });
  });

  describe('human checkpoint validation', () => {
    it('should flag human checkpoint without verification as false success', async () => {
      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: true,
            verification: undefined,
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual([]);
      expect(result.falseSuccesses.length).toBe(1);
      expect(result.falseSuccesses[0].checkpointId).toBe('CP-001');
      expect(result.falseSuccesses[0].requiresHuman).toBe(true);
      expect(result.hasFalseSuccess).toBe(true);
    });

    it('should accept human checkpoint with verification evidence', async () => {
      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: true,
            verification: {
              method: 'manual',
              result: 'passed',
              evidencePath: '/path/to/evidence',
              verifiedAt: '2026-05-20T00:00:00Z',
              verifiedBy: 'reviewer',
              details: {
                type: 'manual_review',
                userConfirmation: 'LGTM',
              },
            },
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual(['CP-001']);
      expect(result.falseSuccesses).toEqual([]);
      expect(result.hasFalseSuccess).toBe(false);
    });

    it('should flag human checkpoint with verification but failed result', async () => {
      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: true,
            verification: {
              method: 'manual',
              result: 'failed',
              evidencePath: '/path/to/evidence',
              verifiedAt: '2026-05-20T00:00:00Z',
              verifiedBy: 'reviewer',
            },
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual([]);
      expect(result.falseSuccesses.length).toBe(1);
    });
  });

  describe('automated checkpoint validation', () => {
    let verifySpy: jest.SpyInstance;

    afterEach(() => {
      if (verifySpy) verifySpy.mockRestore();
    });

    it('should flag automated checkpoint when output verification fails', async () => {
      verifySpy = jest.spyOn(CheckpointOutputVerifier.prototype, 'verify')
        .mockResolvedValue({
          result: 'unverified',
          record: {
            source: 'check_completed',
            result: 'unverified',
            verifiedBy: 'CheckpointOutputVerifier',
            verifiedAt: '2026-05-20T00:00:00Z',
            failureReason: 'Missing output file',
          },
        });

      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: false,
            verification: undefined,
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual([]);
      expect(result.falseSuccesses.length).toBe(1);
      expect(result.falseSuccesses[0].requiresHuman).toBe(false);
    });

    it('should accept automated checkpoint when output verification passes', async () => {
      verifySpy = jest.spyOn(CheckpointOutputVerifier.prototype, 'verify')
        .mockResolvedValue({
          result: 'verified',
          record: {
            source: 'check_completed',
            result: 'verified',
            verifiedBy: 'CheckpointOutputVerifier',
            verifiedAt: '2026-05-20T00:00:00Z',
            evidence: ['Output file exists'],
          },
        });

      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: false,
            verification: undefined,
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001']);

      expect(result.completed).toEqual(['CP-001']);
      expect(result.falseSuccesses).toEqual([]);
    });
  });

  describe('mixed checkpoints', () => {
    it('should handle mix of valid and false-success checkpoints', async () => {
      const task = createTask({
        checkpoints: [
          createCheckpoint({
            id: 'CP-001',
            status: 'completed',
            requiresHuman: true,
            verification: {
              method: 'manual',
              result: 'passed',
              evidencePath: '/path/to/evidence',
              verifiedAt: '2026-05-20T00:00:00Z',
              verifiedBy: 'reviewer',
              details: { type: 'manual_review', userConfirmation: 'OK' },
            },
          }),
          createCheckpoint({
            id: 'CP-002',
            status: 'completed',
            requiresHuman: true,
            verification: undefined,
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001', 'CP-002']);

      expect(result.completed).toEqual(['CP-001']);
      expect(result.falseSuccesses.length).toBe(1);
      expect(result.falseSuccesses[0].checkpointId).toBe('CP-002');
    });

    it('should skip non-completed checkpoints', async () => {
      const task = createTask({
        checkpoints: [
          createCheckpoint({ id: 'CP-001', status: 'pending' }),
          createCheckpoint({
            id: 'CP-002',
            status: 'completed',
            requiresHuman: true,
            verification: {
              method: 'manual',
              result: 'passed',
              evidencePath: '/evidence',
              verifiedAt: '2026-05-20T00:00:00Z',
              verifiedBy: 'reviewer',
              details: { type: 'review', userConfirmation: 'OK' },
            },
          }),
        ],
      });

      const result = await checkCompletedCheckpoints(task, ['CP-001', 'CP-002']);

      expect(result.completed).toEqual(['CP-002']);
    });
  });
});

describe('validateHumanCheckpointCompletion', () => {
  it('should return invalid when no verification record exists', () => {
    const checkpoint = createCheckpoint({ verification: undefined });
    const result = validateHumanCheckpointCompletion(checkpoint);

    expect(result.valid).toBe(false);
    expect(result.missingOutputs).toContain('缺少验证记录');
  });

  it('should return invalid when verification has no evidence', () => {
    const checkpoint = createCheckpoint({
      verification: {
        method: 'manual',
        result: 'passed',
        verifiedAt: '2026-05-20T00:00:00Z',
        verifiedBy: 'reviewer',
      },
    });
    const result = validateHumanCheckpointCompletion(checkpoint);

    expect(result.valid).toBe(false);
    expect(result.missingOutputs).toContain('缺少验证证据');
  });

  it('should return valid when verification has evidence path', () => {
    const checkpoint = createCheckpoint({
      verification: {
        method: 'manual',
        result: 'passed',
        evidencePath: '/path/to/evidence',
        verifiedAt: '2026-05-20T00:00:00Z',
        verifiedBy: 'reviewer',
      },
    });
    const result = validateHumanCheckpointCompletion(checkpoint);

    expect(result.valid).toBe(true);
    expect(result.missingOutputs).toEqual([]);
  });

  it('should return valid when verification has details', () => {
    const checkpoint = createCheckpoint({
      verification: {
        method: 'manual',
        result: 'passed',
        verifiedAt: '2026-05-20T00:00:00Z',
        verifiedBy: 'reviewer',
        details: { type: 'manual_review', userConfirmation: 'LGTM' },
      },
    });
    const result = validateHumanCheckpointCompletion(checkpoint);

    expect(result.valid).toBe(true);
  });

  it('should return invalid when verification result is not passed', () => {
    const checkpoint = createCheckpoint({
      verification: {
        method: 'manual',
        result: 'failed',
        evidencePath: '/path/to/evidence',
        verifiedAt: '2026-05-20T00:00:00Z',
        verifiedBy: 'reviewer',
      },
    });
    const result = validateHumanCheckpointCompletion(checkpoint);

    expect(result.valid).toBe(false);
  });
});

describe('reportFalseSuccessWarnings', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output warnings for false successes', () => {
    const warnings: FalseSuccessWarning[] = [
      {
        checkpointId: 'CP-001',
        description: 'Test checkpoint',
        category: 'code_review',
        requiresHuman: false,
        missingOutputs: ['Missing test file'],
        existingEvidence: [],
      },
    ];

    reportFalseSuccessWarnings(warnings);

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const output = calls.join('\n');
    expect(output).toContain('CP-001');
    expect(output).toContain('假成功检测');
  });

  it('should handle human verification warnings', () => {
    const warnings: FalseSuccessWarning[] = [
      {
        checkpointId: 'CP-002',
        description: 'Manual review checkpoint',
        category: 'ai_review',
        requiresHuman: true,
        missingOutputs: ['缺少验证记录'],
        existingEvidence: [],
      },
    ];

    reportFalseSuccessWarnings(warnings);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const output = calls.join('\n');
    expect(output).toContain('人工验证');
  });

  it('should output nothing when warnings array is empty', () => {
    reportFalseSuccessWarnings([]);

    // Should not produce significant output
    expect(consoleSpy.mock.calls.length).toBe(0);
  });
});
