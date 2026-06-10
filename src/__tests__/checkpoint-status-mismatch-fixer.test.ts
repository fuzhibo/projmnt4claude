/**
 * CheckpointStatusMismatchFixer 单元测试
 *
 * 测试覆盖：
 * - 空检查点 → skipped
 * - 所有检查点验证通过 → fixed, completedCount
 * - 自动检查点失败 → fixed, taskReopened, reopenedCount
 * - 人工检查点待验证 → unfixable, humanPendingCount
 * - 混合场景 → 自动失败优先（reopen task）
 */

import { describe, it, expect, beforeEach, afterEach, Reset } from '@jest/globals';
import * as checkpointVerification from '../utils/checkpoint-verification';
import * as taskModule from '../utils/task';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import type { VerificationOutput, VerificationRecord } from '../types/checkpoint-verification';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// ============================================================
// Helpers
// ============================================================

function createTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-001',
    title: 'Test Task',
    status: 'in_progress',
    type: 'feature',
    priority: 'P1',
    checkpoints: [],
    ...overrides,
  };
}

function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-001',
    description: '实现功能',
    status: 'pending',
    ...overrides,
  };
}

function makeVerifiedOutput(evidence: string[] = ['代码变更存在']): VerificationOutput {
  return {
    result: 'verified',
    record: {
      source: 'analyze_fix',
      result: 'verified',
      evidence,
      verifiedBy: 'CheckpointOutputVerifier',
      verifiedAt: new Date().toISOString(),
    },
  };
}

function makeUnverifiedOutput(reason: string = '未找到产出证据'): VerificationOutput {
  return {
    result: 'unverified',
    record: {
      source: 'analyze_fix',
      result: 'unverified',
      failureReason: reason,
      verifiedBy: 'CheckpointOutputVerifier',
      verifiedAt: new Date().toISOString(),
    },
    warnings: ['检查点没有产出证据'],
  };
}

function makeFailedOutput(reason: string = '验证失败'): VerificationOutput {
  return {
    result: 'failed',
    record: {
      source: 'analyze_fix',
      result: 'failed',
      failureReason: reason,
      verifiedBy: 'CheckpointOutputVerifier',
      verifiedAt: new Date().toISOString(),
    },
    warnings: ['验证失败'],
  };
}

function makeSkippedOutput(reason: string = '需要人工确认'): VerificationOutput {
  return {
    result: 'skipped',
    record: {
      source: 'analyze_fix',
      result: 'skipped',
      failureReason: reason,
      verifiedBy: 'CheckpointOutputVerifier',
      verifiedAt: new Date().toISOString(),
    },
  };
}

// ============================================================
// Tests
// ============================================================

describe('CheckpointStatusMismatchFixer', () => {
  let env: IsolatedTestEnv;
  let verifySpy: jest.SpyInstance;
  let writeTaskMetaCalled: boolean;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifySpy = jest.spyOn(checkpointVerification.CheckpointOutputVerifier.prototype, 'verify');
    writeTaskMetaCalled = false;
    // Use test injection point to track writeTaskMeta calls
    (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__ = {
      ...(globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__,
      writeTaskMeta: (...args: any[]) => {
        writeTaskMetaCalled = true;
      },
    };
  });

  afterEach(() => {
    verifySpy.mockRestore();
    // Clean up test injection point
    delete (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__?.writeTaskMeta;
    env.cleanup();
  });

  describe('empty checkpoints', () => {
    it('should return skipped when task has no checkpoints', async () => {
      const task = createTask({ checkpoints: [] });
      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);

      const result = await fixer.fix(task);

      expect(result.status).toBe('skipped');
      expect(result.completedCount).toBe(0);
      expect(result.reopenedCount).toBe(0);
      expect(result.humanPendingCount).toBe(0);
      expect(result.taskReopened).toBe(false);
      expect(result.humanPendingDetails).toHaveLength(0);
    });

    it('should return skipped when checkpoints is undefined', async () => {
      const task = createTask({ checkpoints: undefined as any });
      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);

      const result = await fixer.fix(task);

      expect(result.status).toBe('skipped');
    });
  });

  describe('all checkpoints verified', () => {
    it('should mark all checkpoints as completed with evidence', async () => {
      const cp1 = createCheckpoint({ id: 'CP-1', description: '实现功能', status: 'pending' });
      const cp2 = createCheckpoint({ id: 'CP-2', description: 'fix bug', status: 'completed' });
      const task = createTask({ checkpoints: [cp1, cp2] });

      verifySpy.mockImplementation(() => Promise.resolve(makeVerifiedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.status).toBe('fixed');
      expect(result.completedCount).toBe(2);
      expect(result.reopenedCount).toBe(0);
      expect(result.humanPendingCount).toBe(0);
      expect(result.taskReopened).toBe(false);

      // Check checkpoints were updated
      expect(task.checkpoints![0].status).toBe('completed');
      expect(task.checkpoints![0].verification?.result).toContain('passed');
      expect(task.checkpoints![0].verification?.verifiedBy).toBe('analyze-fix');
      expect(task.checkpoints![1].status).toBe('completed');
      expect(task.checkpoints![1].verification?.result).toContain('passed');

      // writeTaskMeta called for completed checkpoints
      expect(writeTaskMetaCalled).toBe(true);
    });

    it('should record evidence in verification', async () => {
      const cp = createCheckpoint({ id: 'CP-1', status: 'pending' });
      const task = createTask({ checkpoints: [cp] });

      verifySpy.mockImplementation(() =>
        Promise.resolve(makeVerifiedOutput(['代码变更: src/foo.ts', '测试通过']))
      );

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.completedCount).toBe(1);
      expect(task.checkpoints![0].verification?.evidencePath).toContain('代码变更: src/foo.ts');
      expect(task.checkpoints![0].verification?.evidencePath).toContain('测试通过');
    });
  });

  describe('auto checkpoint failed', () => {
    it('should reopen task and reset checkpoint to pending', async () => {
      const cp = createCheckpoint({ id: 'CP-1', description: '实现功能', status: 'completed', requiresHuman: false });
      const task = createTask({ status: 'resolved', checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeUnverifiedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.status).toBe('fixed');
      expect(result.taskReopened).toBe(true);
      expect(result.reopenedCount).toBe(1);
      expect(result.completedCount).toBe(0);

      // Task reopened
      expect(task.status).toBe('open');

      // Checkpoint reset to pending
      expect(task.checkpoints![0].status).toBe('pending');
      expect(task.checkpoints![0].verification?.result).toBe('failed');
      expect(task.checkpoints![0].note).toContain('假成功');

      // writeTaskMeta called for reopened task
      expect(writeTaskMetaCalled).toBe(true);
    });

    it('should handle failed result same as unverified', async () => {
      const cp = createCheckpoint({ id: 'CP-1', status: 'completed', requiresHuman: false });
      const task = createTask({ status: 'resolved', checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeFailedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.taskReopened).toBe(true);
      expect(result.reopenedCount).toBe(1);
      expect(task.status).toBe('open');
      expect(task.checkpoints![0].status).toBe('pending');
    });

    it('should record failure reason in checkpoint verification', async () => {
      const cp = createCheckpoint({ id: 'CP-1', status: 'completed', requiresHuman: false });
      const task = createTask({ status: 'resolved', checkpoints: [cp] });

      verifySpy.mockImplementation(() =>
        Promise.resolve(makeUnverifiedOutput('未找到代码变更'))
      );

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(task.checkpoints![0].verification?.details?.missingOutputs).toContain('未找到代码变更');
    });
  });

  describe('human checkpoint pending', () => {
    it('should return unfixable for human checkpoint that needs verification', async () => {
      const cp = createCheckpoint({
        id: 'CP-1',
        description: '[ai review] review code',
        status: 'completed',
        requiresHuman: true,
      });
      const task = createTask({ status: 'resolved', checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeUnverifiedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.status).toBe('unfixable');
      expect(result.humanPendingCount).toBe(1);
      expect(result.taskReopened).toBe(false);
      expect(result.completedCount).toBe(0);
      expect(result.reopenedCount).toBe(0);

      // Task status unchanged
      expect(task.status).toBe('resolved');

      // Human pending details
      expect(result.humanPendingDetails[0].checkpointId).toBe('CP-1');
      expect(result.humanPendingDetails[0].description).toContain('review');
    });

    it('should include skipped (review) checkpoints in human pending', async () => {
      const cp = createCheckpoint({
        id: 'CP-1',
        description: '[ai review] review code',
        status: 'pending',
        requiresHuman: true,
      });
      const task = createTask({ checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeSkippedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.humanPendingCount).toBe(1);
      expect(result.humanPendingDetails[0].checkpointId).toBe('CP-1');
    });

    it('should include verification steps and expected result in details', async () => {
      const cp = createCheckpoint({
        id: 'CP-1',
        description: 'review code quality',
        status: 'completed',
        requiresHuman: true,
        verification: {
          method: 'code_review',
          steps: ['检查代码风格', '验证测试覆盖率'],
          expected: '代码审核通过',
        },
      });
      const task = createTask({ checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeUnverifiedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      expect(result.humanPendingDetails[0].verificationSteps).toEqual(['检查代码风格', '验证测试覆盖率']);
      expect(result.humanPendingDetails[0].expectedResult).toBe('代码审核通过');
    });
  });

  describe('mixed scenario', () => {
    it('should reopen task when auto-failed takes precedence over human pending', async () => {
      const cpAuto = createCheckpoint({ id: 'CP-1', description: '实现功能', status: 'completed', requiresHuman: false });
      const cpHuman = createCheckpoint({ id: 'CP-2', description: '[ai review]', status: 'completed', requiresHuman: true });
      const task = createTask({ status: 'resolved', checkpoints: [cpAuto, cpHuman] });

      // Auto checkpoint → unverified, human checkpoint → unverified
      verifySpy.mockImplementation((_ctx: any) => {
        const ctx = _ctx as { checkpointId: string };
        if (ctx.checkpointId === 'CP-1') return Promise.resolve(makeUnverifiedOutput());
        return Promise.resolve(makeUnverifiedOutput());
      });

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      // Auto failed takes precedence → task reopened
      expect(result.status).toBe('fixed');
      expect(result.taskReopened).toBe(true);
      expect(result.reopenedCount).toBe(1);
      expect(result.humanPendingCount).toBe(1);
      expect(task.status).toBe('open');
    });

    it('should handle verified + auto-failed: reopen task, mark verified checkpoint completed', async () => {
      const cpVerified = createCheckpoint({ id: 'CP-1', description: 'fix bug', status: 'pending', requiresHuman: false });
      const cpFailed = createCheckpoint({ id: 'CP-2', description: '实现功能', status: 'completed', requiresHuman: false });
      const task = createTask({ status: 'resolved', checkpoints: [cpVerified, cpFailed] });

      verifySpy.mockImplementation((_ctx: any) => {
        const ctx = _ctx as { checkpointId: string };
        if (ctx.checkpointId === 'CP-1') return Promise.resolve(makeVerifiedOutput());
        return Promise.resolve(makeUnverifiedOutput());
      });

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      // Task reopened due to auto-failed
      expect(result.taskReopened).toBe(true);
      expect(result.reopenedCount).toBe(1);
      // Verified checkpoint still marked completed
      expect(result.completedCount).toBe(1);
      expect(task.checkpoints![0].status).toBe('completed');
      // Failed checkpoint reset
      expect(task.checkpoints![1].status).toBe('pending');
      expect(task.status).toBe('open');
    });

    it('should handle verified + human-pending: no reopen, mark verified completed', async () => {
      const cpVerified = createCheckpoint({ id: 'CP-1', description: 'fix bug', status: 'pending', requiresHuman: false });
      const cpHuman = createCheckpoint({ id: 'CP-2', description: '[ai review]', status: 'completed', requiresHuman: true });
      const task = createTask({ status: 'resolved', checkpoints: [cpVerified, cpHuman] });

      verifySpy.mockImplementation((_ctx: any) => {
        const ctx = _ctx as { checkpointId: string };
        if (ctx.checkpointId === 'CP-1') return Promise.resolve(makeVerifiedOutput());
        return Promise.resolve(makeUnverifiedOutput());
      });

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      // No task reopen (no auto-failed)
      expect(result.taskReopened).toBe(false);
      expect(result.completedCount).toBe(1);
      expect(result.humanPendingCount).toBe(1);
      expect(result.status).toBe('fixed');
      // Task status unchanged
      expect(task.status).toBe('resolved');
    });
  });

  describe('verification source', () => {
    it('should pass analyze_fix as verification source', async () => {
      const cp = createCheckpoint({ id: 'CP-1', status: 'pending' });
      const task = createTask({ checkpoints: [cp] });

      verifySpy.mockImplementation((ctx: any) => {
        expect(ctx.source).toBe('analyze_fix');
        return Promise.resolve(makeVerifiedOutput());
      });

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      await fixer.fix(task);

      expect(verifySpy).toHaveBeenCalled();
    });
  });

  describe('skipped checkpoints (non-human)', () => {
    it('should not count non-human skipped checkpoints as human pending', async () => {
      const cp = createCheckpoint({ id: 'CP-1', description: '实现功能', status: 'pending', requiresHuman: false });
      const task = createTask({ checkpoints: [cp] });

      verifySpy.mockImplementation(() => Promise.resolve(makeSkippedOutput()));

      const fixer = new checkpointVerification.CheckpointStatusMismatchFixer(env.tempDir);
      const result = await fixer.fix(task);

      // Non-human skipped → not counted as human pending
      expect(result.humanPendingCount).toBe(0);
      expect(result.completedCount).toBe(0);
      expect(result.reopenedCount).toBe(0);
      expect(result.status).toBe('skipped');
    });
  });
});