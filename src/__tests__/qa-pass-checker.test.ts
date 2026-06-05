/**
 * QAPassChecker 单元测试
 *
 * 测试QA验证通过检查器 (R-EVAL-PRE-001):
 * - QA报告为 PASS 时通过
 * - QA报告为 NOPASS 时失败
 * - QA报告不存在时失败
 * - 上下文缺少 qaReport 时失败
 */

import { describe, it, expect } from '@jest/globals';
import { QAPassChecker } from '../utils/pre-eval-gate/qa-pass-checker.js';
import type { PreEvalCheckContext, QAReport } from '../utils/pre-eval-gate/types.js';
import type { TaskMeta } from '../types/task.js';

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

function createMockQAReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    verdict: 'PASS',
    verifiedAt: '2026-05-06T10:00:00.000Z',
    verifier: 'test-system',
    summary: '所有测试通过',
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

describe('QAPassChecker', () => {
  const checker = new QAPassChecker();

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

  describe('R-EVAL-PRE-001: QA验证通过检查', () => {
    it('QA报告 verdict 为 PASS 时应通过', async () => {
      const ctx = createMockContext({
        qaReport: createMockQAReport({ verdict: 'PASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-001');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toBe('QA验证已通过');
      expect(result.details?.qaVerdict).toBe('PASS');
    });

    it('QA报告 verdict 为 NOPASS 时应失败', async () => {
      const ctx = createMockContext({
        qaReport: createMockQAReport({ verdict: 'NOPASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-001');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('QA验证未通过');
      expect(result.message).toContain('NOPASS');
      expect(result.details?.qaVerdict).toBe('NOPASS');
    });

    it('QA报告不存在时应失败', async () => {
      const ctx = createMockContext({
        qaReport: undefined,
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-001');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('QA验证未通过');
      expect(result.message).toContain('报告不存在');
      expect(result.details?.qaVerdict).toBeUndefined();
    });
  });

  describe('详情字段', () => {
    it('通过时应包含 qaVerdict 和 qaVerifiedAt', async () => {
      const verifiedAt = '2026-05-06T12:00:00.000Z';
      const ctx = createMockContext({
        qaReport: createMockQAReport({ verdict: 'PASS', verifiedAt }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.qaVerdict).toBe('PASS');
      expect(result.details?.qaVerifiedAt).toBe(verifiedAt);
    });

    it('QA报告不存在时 details 应包含 undefined 值', async () => {
      const ctx = createMockContext({
        qaReport: undefined,
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.qaVerdict).toBeUndefined();
      expect(result.details?.qaVerifiedAt).toBeUndefined();
    });
  });

  describe('报告包含 coverage 字段', () => {
    it('QA报告包含 coverage 时不影响检查结果', async () => {
      const ctx = createMockContext({
        qaReport: createMockQAReport({
          verdict: 'PASS',
          coverage: 85,
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('R-EVAL-PRE-001');
    });
  });

  describe('不同任务上下文', () => {
    it('不同任务ID不影响检查逻辑', async () => {
      const ctx = createMockContext({
        taskId: 'TASK-other-999',
        task: createMockTask({ id: 'TASK-other-999' }),
        qaReport: createMockQAReport({
          taskId: 'TASK-other-999',
          verdict: 'PASS',
        }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('R-EVAL-PRE-001');
    });

    it('不同工作目录不影响检查逻辑', async () => {
      const ctx = createMockContext({
        cwd: '/some/other/path',
        qaReport: createMockQAReport({ verdict: 'PASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
    });
  });
});
