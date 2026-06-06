/**
 * TaskClosableChecker 单元测试
 *
 * 测试任务可关闭检查器 (R-EVAL-POST-007):
 * - 评估通过且所有检查点完成时通过
 * - 评估未通过时失败
 * - 存在未完成检查点时失败
 * - 两个条件同时不满足时失败并报告两个原因
 * - 边界条件: 空检查点、undefined 检查点、混合状态
 */

import { describe, it, expect } from '@jest/globals';
import { TaskClosableChecker } from '../../../utils/post-eval-gate/checkers/task-closable-checker.js';
import type {
  PostEvalCheckContext,
  EvalReport,
} from '../../../utils/post-eval-gate/types.js';
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

function createMockEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    result: 'PASS',
    evaluatedAt: new Date().toISOString(),
    evaluator: 'test',
    summary: '测试评估',
    evaluationLogs: ['日志1'],
    ...overrides,
  };
}

function createMockContext(overrides: Partial<PostEvalCheckContext> = {}): PostEvalCheckContext {
  return {
    taskId: 'TASK-test-001',
    task: createMockTask(),
    cwd: '/tmp/test',
    ...overrides,
  };
}

function createCheckpoint(id: string, status: CheckpointMetadata['status']): CheckpointMetadata {
  return {
    id,
    description: `检查点 ${id}`,
    status,
  };
}

describe('TaskClosableChecker', () => {
  const checker = new TaskClosableChecker();

  describe('基本属性', () => {
    it('应实现 IPostEvalChecker 接口', () => {
      expect(checker.check).toBeInstanceOf(Function);
    });

    it('check 方法应返回 Promise', () => {
      const ctx = createMockContext();
      const result = checker.check(ctx);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('R-EVAL-POST-007: 任务可关闭检查', () => {
    describe('两个条件都满足时通过', () => {
      it('评估通过且所有检查点 completed 时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('任务可标记为完成');
      });

      it('评估通过且所有检查点 skipped 时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'skipped'),
              createCheckpoint('CP-002', 'skipped'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('任务可标记为完成');
      });

      it('评估通过且混合 completed/skipped 检查点时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'skipped'),
              createCheckpoint('CP-003', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('任务可标记为完成');
      });

      it('评估通过且无检查点时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({ checkpoints: [] }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('任务可标记为完成');
      });

      it('评估通过且 checkpoints 为 undefined 时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({ checkpoints: undefined }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('任务可标记为完成');
      });
    });

    describe('评估未通过时失败', () => {
      it('evalReport.result 为 NOPASS 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'NOPASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('评估未通过');
      });

      it('evalReport 为 undefined 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: undefined,
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('评估未通过');
      });
    });

    describe('存在未完成检查点时失败', () => {
      it('存在 pending 状态检查点时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'pending'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('存在未完成的检查点');
      });

      it('存在 failed 状态检查点时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'failed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('存在未完成的检查点');
      });

      it('所有检查点都未完成时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'pending'),
              createCheckpoint('CP-002', 'pending'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('存在未完成的检查点');
      });
    });

    describe('两个条件同时不满足时报告两个原因', () => {
      it('评估未通过且存在未完成检查点时应同时报告两个原因', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'NOPASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'pending'),
              createCheckpoint('CP-002', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('评估未通过');
        expect(result.message).toContain('存在未完成的检查点');
      });

      it('evalReport 为 undefined 且存在未完成检查点时应同时报告两个原因', async () => {
        const ctx = createMockContext({
          evalReport: undefined,
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'failed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-007');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('评估未通过');
        expect(result.message).toContain('存在未完成的检查点');
      });
    });
  });

  describe('详情字段 (details)', () => {
    it('通过时 details.closable 应为 true', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'PASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'completed'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.closable).toBe(true);
      expect(result.details?.evalPassed).toBe(true);
      expect(result.details?.allCheckpointsDone).toBe(true);
    });

    it('评估未通过时 details 应反映失败原因', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'NOPASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'completed'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.closable).toBe(false);
      expect(result.details?.evalPassed).toBe(false);
      expect(result.details?.allCheckpointsDone).toBe(true);
    });

    it('检查点未完成时 details 应反映失败原因', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'PASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'pending'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.closable).toBe(false);
      expect(result.details?.evalPassed).toBe(true);
      expect(result.details?.allCheckpointsDone).toBe(false);
    });

    it('两个条件都不满足时 details 应反映两个失败原因', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'NOPASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'pending'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.closable).toBe(false);
      expect(result.details?.evalPassed).toBe(false);
      expect(result.details?.allCheckpointsDone).toBe(false);
    });
  });
});
