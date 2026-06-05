/**
 * EvalReportJsonChecker + EvalResultValidChecker 单元测试
 *
 * R-EVAL-POST-002: 评估报告JSON格式有效 (ERROR级)
 * R-EVAL-POST-003: 评估结果有效 (PASS|NOPASS) (ERROR级)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  EvalReportJsonChecker,
  EvalResultValidChecker,
} from '../../../utils/post-eval-gate/checkers/eval-result-checker.js';
import type {
  PostEvalCheckContext,
  EvalReport,
} from '../../../utils/post-eval-gate/types.js';
import type { TaskMeta } from '../../../types/task.js';

function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '测试任务描述',
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

function createMockContext(overrides: Partial<PostEvalCheckContext> = {}): PostEvalCheckContext {
  return {
    taskId: 'TASK-test-001',
    task: createMockTask(),
    cwd: '/tmp/test',
    ...overrides,
  };
}

function createValidEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    result: 'PASS',
    evaluatedAt: new Date().toISOString(),
    evaluator: 'test-evaluator',
    summary: '测试评估通过',
    evaluationLogs: [],
    ...overrides,
  };
}

describe('EvalReportJsonChecker (R-EVAL-POST-002)', () => {
  const checker = new EvalReportJsonChecker();
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/eval-result-checker-test-');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  function writeReport(taskId: string, content: string | object): void {
    const outputsDir = path.join(testDir, '.projmnt4claude', 'outputs', taskId);
    fs.mkdirSync(outputsDir, { recursive: true });
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(path.join(outputsDir, 'evaluation-report.json'), data);
  }

  describe('基本属性', () => {
    it('应实现 IPostEvalChecker 接口', () => {
      expect(checker.check).toBeFunction();
    });
  });

  describe('JSON格式验证', () => {
    it('合法JSON且包含必要字段时应通过', async () => {
      const taskId = 'TASK-json-ok-001';
      writeReport(taskId, createValidEvalReport({ taskId }));

      const ctx = createMockContext({ taskId, task: createMockTask({ id: taskId }), cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-002');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('JSON格式有效');
    });

    it('无效JSON时应失败', async () => {
      const taskId = 'TASK-json-bad-001';
      writeReport(taskId, '{ invalid json }}}');

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-002');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('JSON格式无效');
      expect(result.details?.parseError).toBe('INVALID_JSON');
    });

    it('文件不存在时应失败', async () => {
      const taskId = 'TASK-json-missing-001';
      // 不创建文件

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-002');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('文件不存在');
      expect(result.details?.parseError).toBe('FILE_NOT_FOUND');
    });

    it('JSON为数组时应失败', async () => {
      const taskId = 'TASK-json-array-001';
      writeReport(taskId, '[]');

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('结构无效');
      expect(result.details?.parseError).toBe('NOT_OBJECT');
    });

    it('JSON为字符串时应失败', async () => {
      const taskId = 'TASK-json-str-001';
      writeReport(taskId, '"just a string"');

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.details?.parseError).toBe('NOT_OBJECT');
    });
  });

  describe('必要字段验证', () => {
    it('缺少单个必要字段时应失败', async () => {
      const taskId = 'TASK-missing-001';
      const report = createValidEvalReport({ taskId });
      const partial = { ...report };
      delete (partial as any).evaluator;
      writeReport(taskId, partial);

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('evaluator');
      expect(result.details?.missingFields).toContain('evaluator');
    });

    it('缺少多个必要字段时应列出所有缺失字段', async () => {
      const taskId = 'TASK-missing-multi-001';
      writeReport(taskId, { version: '1.0.0' });

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      const missing = result.details?.missingFields as string[];
      expect(missing).toContain('taskId');
      expect(missing).toContain('result');
      expect(missing).toContain('evaluatedAt');
      expect(missing).toContain('evaluator');
      expect(missing).toContain('summary');
    });

    it('所有必要字段存在时应通过', async () => {
      const taskId = 'TASK-fields-ok-001';
      writeReport(taskId, {
        version: '1.0.0',
        taskId,
        result: 'PASS',
        evaluatedAt: new Date().toISOString(),
        evaluator: 'test',
        summary: 'ok',
      });

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
    });

    it('包含额外字段时仍应通过', async () => {
      const taskId = 'TASK-extra-001';
      writeReport(taskId, {
        version: '1.0.0',
        taskId,
        result: 'PASS',
        evaluatedAt: new Date().toISOString(),
        evaluator: 'test',
        summary: 'ok',
        recommendations: ['建议1'],
        evaluationLogs: [],
        extraField: '额外字段',
      });

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
    });
  });
});

describe('EvalResultValidChecker (R-EVAL-POST-003)', () => {
  const checker = new EvalResultValidChecker();

  describe('基本属性', () => {
    it('应实现 IPostEvalChecker 接口', () => {
      expect(checker.check).toBeFunction();
    });
  });

  describe('评估结果验证', () => {
    it('result 为 PASS 时应通过', async () => {
      const ctx = createMockContext({
        evalReport: createValidEvalReport({ result: 'PASS' }),
      });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-003');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('PASS');
    });

    it('result 为 NOPASS 时应通过', async () => {
      const ctx = createMockContext({
        evalReport: createValidEvalReport({ result: 'NOPASS' }),
      });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-003');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('NOPASS');
    });

    it('result 为其他值时应失败', async () => {
      const ctx = createMockContext({
        evalReport: createValidEvalReport({ result: 'UNKNOWN' as any }),
      });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('无效');
      expect(result.message).toContain('UNKNOWN');
      expect(result.details?.result).toBe('UNKNOWN');
      expect(result.details?.validResults).toEqual(['PASS', 'NOPASS']);
    });

    it('result 为空字符串时应失败', async () => {
      const ctx = createMockContext({
        evalReport: createValidEvalReport({ result: '' as any }),
      });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.details?.result).toBe('');
    });

    it('result 为小写 pass 时应失败 (大小写敏感)', async () => {
      const ctx = createMockContext({
        evalReport: createValidEvalReport({ result: 'pass' as any }),
      });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.details?.result).toBe('pass');
    });
  });

  describe('报告未加载', () => {
    it('evalReport 为 undefined 时应失败', async () => {
      const ctx = createMockContext({ evalReport: undefined });
      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-POST-003');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('未加载');
    });
  });
});
