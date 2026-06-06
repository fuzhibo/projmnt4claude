/**
 * EvalLogsChecker 单元测试
 *
 * 测试评估日志检查器 (R-EVAL-POST-004):
 * - evaluationLogs 非空时通过
 * - evaluationLogs 为空数组时返回警告
 * - evaluationLogs 不存在时返回警告
 * - 评估报告未加载时返回警告
 * - 日志条目缺少必要字段时返回警告
 * - 日志条目有效时通过
 */

import { describe, it, expect } from '@jest/globals';
import { EvalLogsChecker } from '../../../utils/post-eval-gate/checkers/eval-logs-checker.js';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  EvalReport,
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
    evaluationLogs: ['日志1', '日志2'],
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

describe('EvalLogsChecker', () => {
  const checker = new EvalLogsChecker();

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

  describe('R-EVAL-POST-004: 评估日志非空检查', () => {
    it('evaluationLogs 非空时应通过', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: ['日志条目1', '日志条目2'],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('评估日志完整');
      expect(result.details?.logCount).toBe(2);
    });

    it('evaluationLogs 为空数组时应返回警告', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('评估日志为空');
      expect(result.details?.logCount).toBe(0);
    });
  });

  describe('评估报告未加载', () => {
    it('evalReport 为 undefined 时应返回警告', async () => {
      const ctx = createMockContext({
        evalReport: undefined,
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('评估报告未加载');
      expect(result.details?.logCount).toBe(0);
    });
  });

  describe('日志条目有效性验证', () => {
    it('所有日志条目有效时应通过', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [
            { timestamp: '2026-01-01T00:00:00Z', message: '开始评估' },
            { timestamp: '2026-01-01T00:01:00Z', message: '评估完成' },
          ] as unknown as string[],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('评估日志完整');
      expect(result.details?.invalidEntries).toEqual([]);
    });

    it('日志条目缺少 timestamp 时应返回警告', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [
            { message: '缺少时间戳' },
          ] as unknown as string[],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('无效条目');
      expect(result.details?.invalidEntries).toEqual([
        { index: 0, missingFields: ['timestamp'] },
      ]);
    });

    it('日志条目缺少 message 时应返回警告', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [
            { timestamp: '2026-01-01T00:00:00Z' },
          ] as unknown as string[],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('无效条目');
      expect(result.details?.invalidEntries).toEqual([
        { index: 0, missingFields: ['message'] },
      ]);
    });

    it('日志条目缺少所有必要字段时应返回警告', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [
            { someOtherField: 'value' },
          ] as unknown as string[],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.message).toContain('无效条目');
      expect((result.details?.invalidEntries as Array<{ index: number; missingFields: string[] }>)[0].missingFields).toContain('timestamp');
      expect((result.details?.invalidEntries as Array<{ index: number; missingFields: string[] }>)[0].missingFields).toContain('message');
    });

    it('多条日志中部分无效时应报告所有无效条目', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [
            { timestamp: '2026-01-01T00:00:00Z', message: '有效条目' },
            { message: '缺少时间戳' },
            { timestamp: '2026-01-01T00:02:00Z' },
          ] as unknown as string[],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-004');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('WARNING');
      expect(result.details?.invalidEntries).toEqual([
        { index: 1, missingFields: ['timestamp'] },
        { index: 2, missingFields: ['message'] },
      ]);
      expect(result.details?.logCount).toBe(3);
    });
  });

  describe('详情字段', () => {
    it('通过时应包含 logCount 和空 invalidEntries', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: ['log1', 'log2', 'log3'],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.logCount).toBe(3);
      expect(result.details?.invalidEntries).toEqual([]);
    });

    it('失败时应包含 logCount 和 invalidEntries', async () => {
      const ctx = createMockContext({
        evalReport: createMockEvalReport({
          evaluationLogs: [],
        }),
      });

      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.logCount).toBe(0);
      expect(result.details?.invalidEntries).toEqual([]);
    });
  });
});
