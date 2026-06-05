/**
 * AllCheckpointsCompletedChecker 单元测试
 *
 * 测试检查点完成检查器 (R-EVAL-PRE-005):
 * - 无检查点时通过
 * - 所有检查点 completed 时通过
 * - 所有检查点 skipped 时通过
 * - requiresHuman 检查点被排除（不阻塞）
 * - pending 检查点阻塞
 * - 未完成检查点列表生成
 * - 混合状态正确处理
 */

import { describe, it, expect } from '@jest/globals';
import { AllCheckpointsCompletedChecker } from '../../../utils/pre-eval-gate/checkers/all-checkpoints-completed-checker.js';
import type { PreEvalCheckContext } from '../../../utils/pre-eval-gate/types.js';
import type { TaskMeta, CheckpointMetadata } from '../../../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述',
    type: 'feature',
    priority: 'P2',
    status: 'wait_evaluation',
    dependencies: [],
    checkpoints: [],
    files: [],
    phaseHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'cli',
    schemaVersion: 6,
    ...overrides,
  };
}

function createMockContext(overrides: Partial<PreEvalCheckContext> = {}): PreEvalCheckContext {
  return {
    taskId: 'TASK-test-001',
    task: createMockTask(),
    cwd: '/tmp/test',
    ...overrides,
  };
}

function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-001',
    description: '测试检查点',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AllCheckpointsCompletedChecker', () => {
  const checker = new AllCheckpointsCompletedChecker();

  describe('基本属性', () => {
    it('应实现 IPreEvalChecker 接口', () => {
      expect(checker.check).toBeFunction();
    });

    it('check 方法应返回 Promise', () => {
      const ctx = createMockContext();
      const result = checker.check(ctx);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('R-EVAL-PRE-005: 无检查点时通过', () => {
    it('checkpoints 为空数组时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({ checkpoints: [] }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-005');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toBe('所有检查点已完成');
    });

    it('checkpoints 为 undefined 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({ checkpoints: undefined }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.totalCheckpoints).toBe(0);
    });
  });

  describe('CP-001: 所有检查点已完成时通过', () => {
    it('所有检查点 completed 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'completed' }),
            createCheckpoint({ id: 'CP-003', status: 'completed' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.message).toBe('所有检查点已完成');
      expect(result.details?.completedCount).toBe(3);
      expect(result.details?.incompleteCount).toBe(0);
    });

    it('所有检查点 skipped 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'skipped' }),
            createCheckpoint({ id: 'CP-002', status: 'skipped' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.skippedCount).toBe(2);
      expect(result.details?.incompleteCount).toBe(0);
    });

    it('混合 completed 和 skipped 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'skipped' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.completedCount).toBe(1);
      expect(result.details?.skippedCount).toBe(1);
    });
  });

  describe('CP-002: 排除 requiresHuman 检查点', () => {
    it('仅 requiresHuman 检查点 pending 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'pending', requiresHuman: true }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.humanVerificationCount).toBe(1);
      expect(result.details?.humanVerificationIds).toEqual(['CP-002']);
      expect(result.details?.incompleteCount).toBe(0);
    });

    it('多个 requiresHuman 检查点均被排除', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'pending', requiresHuman: true }),
            createCheckpoint({ id: 'CP-003', status: 'pending', requiresHuman: true }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.humanVerificationCount).toBe(2);
      expect(result.details?.humanVerificationIds).toEqual(['CP-002', 'CP-003']);
    });

    it('requiresHuman + completed 检查点均被排除，仅普通 pending 阻塞', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'pending', requiresHuman: true }),
            createCheckpoint({ id: 'CP-003', status: 'pending' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('CP-003');
      expect(result.message).not.toContain('CP-002');
      expect(result.details?.incompleteIds).toEqual(['CP-003']);
      expect(result.details?.humanVerificationIds).toEqual(['CP-002']);
    });
  });

  describe('CP-003: 未完成检查点列表生成', () => {
    it('单个 pending 检查点时应列出 ID', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'pending' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toBe('1 个检查点未完成: CP-001');
      expect(result.details?.incompleteIds).toEqual(['CP-001']);
      expect(result.details?.incompleteCount).toBe(1);
    });

    it('多个未完成检查点时应列出所有 ID（含 failed）', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'pending' }),
            createCheckpoint({ id: 'CP-003', status: 'failed' }),
            createCheckpoint({ id: 'CP-004', status: 'pending' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('3 个检查点未完成');
      expect(result.message).toContain('CP-002');
      expect(result.message).toContain('CP-003');
      expect(result.message).toContain('CP-004');
      expect(result.details?.incompleteIds).toEqual(['CP-002', 'CP-003', 'CP-004']);
      expect(result.details?.incompleteCount).toBe(3);
    });

    it('details 应包含完整统计', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'skipped' }),
            createCheckpoint({ id: 'CP-003', status: 'pending', requiresHuman: true }),
            createCheckpoint({ id: 'CP-004', status: 'pending' }),
            createCheckpoint({ id: 'CP-005', status: 'failed' }),
          ],
        }),
      });

      const result = await checker.check(ctx);
      const details = result.details as Record<string, unknown>;

      expect(details.totalCheckpoints).toBe(5);
      expect(details.completedCount).toBe(1);
      expect(details.skippedCount).toBe(1);
      expect(details.humanVerificationCount).toBe(1);
      expect(details.incompleteCount).toBe(2);
      expect(details.incompleteIds).toEqual(['CP-004', 'CP-005']);
      expect(details.humanVerificationIds).toEqual(['CP-003']);
    });
  });

  describe('CP-004: 阻塞评估阶段进入', () => {
    it('有 pending 检查点时 severity 为 ERROR', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'pending' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
    });

    it('有 failed 检查点时 severity 为 ERROR', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'failed' }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
    });

    it('全部通过时不应阻塞', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          checkpoints: [
            createCheckpoint({ id: 'CP-001', status: 'completed' }),
            createCheckpoint({ id: 'CP-002', status: 'skipped' }),
            createCheckpoint({ id: 'CP-003', status: 'pending', requiresHuman: true }),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
    });
  });
});
