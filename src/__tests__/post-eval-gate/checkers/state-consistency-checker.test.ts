/**
 * FinalStateConsistencyChecker 单元测试
 *
 * 测试最终状态一致性检查器 (R-EVAL-POST-005):
 * - 评估未通过时跳过检查 (返回通过)
 * - 评估通过且各阶段结果一致时通过
 * - 评估通过但开发状态不为 success 时失败
 * - 评估通过但代码审核未通过时失败
 * - 评估通过但QA未通过时失败
 * - 多个阶段不一致时生成详细错误列表
 * - 各阶段报告缺失时跳过对应检查
 */

import { describe, it, expect } from 'bun:test';
import { FinalStateConsistencyChecker } from '../../../utils/post-eval-gate/checkers/state-consistency-checker.js';
import type {
  PostEvalCheckContext,
  EvalReport,
  DevReport,
  CodeReviewReport,
  QAReport,
} from '../../../utils/post-eval-gate/types.js';
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

function createMockDevReport(overrides: Partial<DevReport> = {}): DevReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    status: 'success',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCodeReviewReport(overrides: Partial<CodeReviewReport> = {}): CodeReviewReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    result: 'PASS',
    reviewedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockQAReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    verdict: 'PASS',
    verifiedAt: new Date().toISOString(),
    verifier: 'test',
    summary: 'QA验证通过',
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

describe('FinalStateConsistencyChecker', () => {
  const checker = new FinalStateConsistencyChecker();

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

  describe('R-EVAL-POST-005: 最终状态一致性检查', () => {
    describe('评估未通过时跳过检查', () => {
      it('evalReport.result 为 NOPASS 时应返回通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'NOPASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('跳过');
      });

      it('evalReport 为 undefined 时应返回通过', async () => {
        const ctx = createMockContext({
          evalReport: undefined,
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('跳过');
      });
    });

    describe('评估通过且各阶段结果一致时通过', () => {
      it('所有阶段报告结果一致时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'success' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'PASS' }),
          qaReport: createMockQAReport({ verdict: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('最终状态一致');
      });

      it('无各阶段报告时应通过', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('最终状态一致');
      });
    });

    describe('评估通过但开发状态不一致时失败', () => {
      it('开发状态为 failure 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'failure' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'PASS' }),
          qaReport: createMockQAReport({ verdict: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('状态不一致');
        expect(result.message).toContain('开发状态不为 success');
      });

      it('开发状态为 pending 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'pending' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('开发状态不为 success');
      });
    });

    describe('评估通过但代码审核未通过时失败', () => {
      it('代码审核结果为 NOPASS 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'success' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'NOPASS' }),
          qaReport: createMockQAReport({ verdict: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('状态不一致');
        expect(result.message).toContain('代码审核未通过');
      });

      it('代码审核结果为 REJECTED 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'REJECTED' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('代码审核未通过');
      });
    });

    describe('评估通过但QA未通过时失败', () => {
      it('QA结果为 NOPASS 时应失败', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'success' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'PASS' }),
          qaReport: createMockQAReport({ verdict: 'NOPASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('状态不一致');
        expect(result.message).toContain('QA未通过');
      });
    });

    describe('多个阶段不一致时生成详细错误列表', () => {
      it('所有阶段都不一致时应报告所有错误', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'failure' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'NOPASS' }),
          qaReport: createMockQAReport({ verdict: 'NOPASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('状态不一致');
        expect(result.message).toContain('开发状态不为 success');
        expect(result.message).toContain('代码审核未通过');
        expect(result.message).toContain('QA未通过');
      });

      it('两个阶段不一致时应报告两个错误', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'failure' }),
          qaReport: createMockQAReport({ verdict: 'NOPASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('开发状态不为 success');
        expect(result.message).toContain('QA未通过');
        expect(result.message).not.toContain('代码审核未通过');
      });
    });

    describe('部分报告缺失时跳过对应检查', () => {
      it('仅有开发报告时只检查开发状态', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'success' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('最终状态一致');
      });

      it('仅有代码审核报告时只检查审核结果', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          codeReviewReport: createMockCodeReviewReport({ result: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('最终状态一致');
      });

      it('仅有QA报告时只检查QA结果', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          qaReport: createMockQAReport({ verdict: 'PASS' }),
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('最终状态一致');
      });

      it('缺失报告不一致时仍应正确检查已有报告', async () => {
        const ctx = createMockContext({
          evalReport: createMockEvalReport({ result: 'PASS' }),
          devReport: createMockDevReport({ status: 'failure' }),
          // 无 codeReviewReport 和 qaReport
        });

        const result = await checker.check(ctx);

        expect(result.ruleId).toBe('R-EVAL-POST-005');
        expect(result.passed).toBe(false);
        expect(result.severity).toBe('ERROR');
        expect(result.message).toContain('开发状态不为 success');
        expect(result.message).not.toContain('代码审核未通过');
        expect(result.message).not.toContain('QA未通过');
      });
    });
  });

  describe('详情字段 (details)', () => {
    it('通过时应包含空 inconsistencies 列表', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'PASS' }),
        devReport: createMockDevReport({ status: 'success' }),
        codeReviewReport: createMockCodeReviewReport({ result: 'PASS' }),
        qaReport: createMockQAReport({ verdict: 'PASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.inconsistencies).toEqual([]);
    });

    it('失败时应包含不一致项列表', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'PASS' }),
        devReport: createMockDevReport({ status: 'failure' }),
        qaReport: createMockQAReport({ verdict: 'NOPASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.inconsistencies).toEqual([
        '评估通过但开发状态不为 success',
        '评估通过但QA未通过',
      ]);
    });

    it('跳过检查时不应包含 details', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({ result: 'NOPASS' }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeUndefined();
    });
  });
});
