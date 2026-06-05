/**
 * AllCheckpointsFinalChecker 单元测试
 *
 * 测试检查点最终完成检查器 (R-EVAL-POST-006):
 * - 评估未通过时跳过检查 (返回通过)
 * - 评估通过且所有检查点完成时通过
 * - 评估通过但存在未完成检查点时失败
 * - 检查点状态为 completed 或 skipped 视为完成
 * - 未完成检查点列表生成
 */

import { describe, it, expect } from '@jest/globals';
import { AllCheckpointsFinalChecker } from '../../../utils/post-eval-gate/checkers/checkpoints-final-checker.js';
import type {
  PostEvalCheckContext,
  EvalReport,
} from '../../../utils/post-eval-gate/types.js';
import type { TaskMeta } from '../../../types/task.js';
import type { CheckpointMetadata } from '../../../types/task.js';

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

describe('AllCheckpointsFinalChecker', () => {
  const checker = new AllCheckpointsFinalChecker();

  describe('基本属性', () => {
    it('应实现 IPostEvalChecker 接口', () => {
      expect(checker.check).toBeFunction();
    });

    it('check 方法应返回 Promise', () => {
      const ctx = createMockContext();
      const result = checker.check(ctx);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('R-EVAL-POST-006: 检查点全部完成检查', () => {
    describe('评估未通过时跳过检查', () => {
      it('evalReport.result 为 NOPASS 时应返回通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'NOPASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'pending'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('跳过');
      });

      it('evalReport 为 undefined 时应返回通过', async () => {
        const ctx = createMockContext({
          evalReport: undefined,
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'pending'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('跳过');
      });
    });

    describe('评估通过时检查检查点完成', () => {
      it('所有检查点为 completed 时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'completed'),
              createCheckpoint('CP-003', 'completed'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('所有检查点已完成');
      });

      it('所有检查点为 skipped 时应通过', async () => {
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

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('所有检查点已完成');
      });

      it('混合 completed 和 skipped 时应通过', async () => {
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

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('所有检查点已完成');
      });

      it('checkpoints 为空数组时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({ checkpoints: [] }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('所有检查点已完成');
      });

      it('checkpoints 为 undefined 时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({ checkpoints: undefined }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('所有检查点已完成');
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

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('1 个检查点未完成');
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

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('1 个检查点未完成');
      });

      it('多个未完成检查点时应报告正确数量', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          task: createMockTask({
            checkpoints: [
              createCheckpoint('CP-001', 'completed'),
              createCheckpoint('CP-002', 'pending'),
              createCheckpoint('CP-003', 'failed'),
              createCheckpoint('CP-004', 'skipped'),
            ],
          }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('2 个检查点未完成');
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

        expect(result.ruleId).toBe('R-EVAL-POST-006');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('2 个检查点未完成');
      });
    });
  });

  describe('详情字段 (details)', () => {
    it('通过时应包含空 incompleteCheckpoints 列表', async () => {
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
      expect(result.details?.incompleteCheckpoints).toEqual([]);
    });

    it('失败时应包含未完成检查点的 id 和 status', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'PASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'completed'),
            createCheckpoint('CP-002', 'pending'),
            createCheckpoint('CP-003', 'failed'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.incompleteCheckpoints).toEqual([
        { id: 'CP-002', status: 'pending' },
        { id: 'CP-003', status: 'failed' },
      ]);
    });

    it('跳过检查时不应包含 details', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'NOPASS' }),
        task: createMockTask({
          checkpoints: [
            createCheckpoint('CP-001', 'pending'),
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeUndefined();
    });
  });
});
