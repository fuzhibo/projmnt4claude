/**
 * PhaseHistoryCompleteChecker 单元测试
 *
 * 测试阶段历史完整性检查器 (R-EVAL-PRE-006):
 * - 包含所有必要阶段时通过
 * - 缺少阶段时返回警告
 * - phaseHistory 为空数组时失败
 * - phaseHistory 为 undefined 时失败
 * - 多余阶段不影响通过
 * - 详情字段正确
 */

import { describe, it, expect } from 'bun:test';
import { PhaseHistoryCompleteChecker } from '../../../utils/pre-eval-gate/checkers/phase-history-checker.js';
import type { PreEvalCheckContext } from '../../../utils/pre-eval-gate/types.js';
import type { TaskMeta } from '../../../types/task.js';

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

describe('PhaseHistoryCompleteChecker', () => {
  const checker = new PhaseHistoryCompleteChecker();

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

  describe('R-EVAL-PRE-006: 包含所有必要阶段时通过', () => {
    it('包含 development、code_review、qa 时应通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
            { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-006');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toBe('阶段历史完整');
    });

    it('包含多余阶段不影响通过', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
            { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
            { phase: 'evaluation', role: 'evaluator', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.details?.historyPhases).toEqual(['development', 'code_review', 'qa', 'evaluation']);
    });
  });

  describe('R-EVAL-PRE-006: 缺少阶段时返回警告', () => {
    it('phaseHistory 为空数组时应失败', async () => {
      const ctx = createMockContext({
        task: createMockTask({ phaseHistory: [] }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-006');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('缺少阶段历史');
      expect(result.message).toContain('development');
      expect(result.message).toContain('code_review');
      expect(result.message).toContain('qa');
      expect(result.details?.missingPhases).toEqual(['development', 'code_review', 'qa']);
    });

    it('phaseHistory 为 undefined 时应失败', async () => {
      const ctx = createMockContext({
        task: createMockTask({ phaseHistory: undefined }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.details?.historyPhases).toEqual([]);
      expect(result.details?.missingPhases).toEqual(['development', 'code_review', 'qa']);
    });

    it('缺少单个阶段时应列出该阶段', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('qa');
      expect(result.message).not.toContain('development');
      expect(result.message).not.toContain('code_review');
      expect(result.details?.missingPhases).toEqual(['qa']);
    });

    it('缺少多个阶段时应列出所有缺失阶段', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('code_review');
      expect(result.message).toContain('qa');
      expect(result.details?.missingPhases).toEqual(['code_review', 'qa']);
    });
  });

  describe('详情字段', () => {
    it('通过时应包含完整详情', async () => {
      const ctx = createMockContext({
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
            { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.requiredPhases).toEqual(['development', 'code_review', 'qa']);
      expect(result.details?.historyPhases).toEqual(['development', 'code_review', 'qa']);
      expect(result.details?.missingPhases).toEqual([]);
    });

    it('失败时应包含缺失阶段详情', async () => {
      const ctx = createMockContext({
        task: createMockTask({ phaseHistory: [] }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.requiredPhases).toEqual(['development', 'code_review', 'qa']);
      expect(result.details?.historyPhases).toEqual([]);
      expect(result.details?.missingPhases).toEqual(['development', 'code_review', 'qa']);
    });
  });

  describe('不同任务上下文', () => {
    it('不同任务ID不影响检查逻辑', async () => {
      const ctx = createMockContext({
        taskId: 'TASK-other-999',
        task: createMockTask({
          id: 'TASK-other-999',
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
            { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('R-EVAL-PRE-006');
    });

    it('不同工作目录不影响检查逻辑', async () => {
      const ctx = createMockContext({
        cwd: '/some/other/path',
        task: createMockTask({
          phaseHistory: [
            { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
            { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
            { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
          ],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
    });
  });
});
