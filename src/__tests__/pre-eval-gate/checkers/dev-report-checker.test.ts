/**
 * DevReportChecker 单元测试
 *
 * 测试开发报告检查器 (R-EVAL-PRE-002):
 * - dev-report.json 存在时通过
 * - dev-report.json 不存在时失败
 * - 路径解析正确性
 * - 缺少阶段报告时正确报错
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { DevReportChecker } from '../../../utils/pre-eval-gate/checkers/dev-report-checker.js';
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

describe('DevReportChecker', () => {
  const checker = new DevReportChecker();
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/dev-report-checker-test-');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // 辅助函数: 创建 dev-report.json 文件
  function createDevReport(taskId: string, content: object = { version: '1.0.0', taskId, verdict: 'PASS' }): void {
    const outputsDir = path.join(testDir, '.projmnt4claude', 'outputs', taskId);
    fs.mkdirSync(outputsDir, { recursive: true });
    fs.writeFileSync(path.join(outputsDir, 'dev-report.json'), JSON.stringify(content, null, 2));
  }

  describe('基本属性', () => {
    it('应实现 IPreEvalChecker 接口', () => {
      expect(checker.check).toBeFunction();
    });

    it('check 方法应返回 Promise', () => {
      const ctx = createMockContext({ cwd: testDir });
      const result = checker.check(ctx);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('R-EVAL-PRE-002: 开发报告存在性检查', () => {
    it('dev-report.json 存在时应通过', async () => {
      const taskId = 'TASK-exist-001';
      createDevReport(taskId);

      const ctx = createMockContext({
        taskId,
        task: createMockTask({ id: taskId }),
        cwd: testDir,
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-002');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('dev-report.json 存在');
      expect(result.details?.exists).toBe(true);
    });

    it('dev-report.json 不存在时应失败', async () => {
      const taskId = 'TASK-no-report-001';
      // 不创建报告文件

      const ctx = createMockContext({
        taskId,
        task: createMockTask({ id: taskId }),
        cwd: testDir,
      });

      const result = await checker.check(ctx);

      expect(result.ruleId).toBe('R-EVAL-PRE-002');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('ERROR');
      expect(result.message).toContain('dev-report.json 不存在');
      expect(result.message).toContain('开发阶段未生成报告');
      expect(result.details?.exists).toBe(false);
    });
  });

  describe('路径解析', () => {
    it('应正确解析 .projmnt4claude/outputs/{taskId}/dev-report.json 路径', async () => {
      const taskId = 'TASK-path-001';
      createDevReport(taskId);

      const ctx = createMockContext({
        taskId,
        task: createMockTask({ id: taskId }),
        cwd: testDir,
      });

      const result = await checker.check(ctx);

      expect(result.details?.reportPath).toBe(
        path.join(testDir, '.projmnt4claude', 'outputs', taskId, 'dev-report.json')
      );
      expect(result.details?.reportName).toBe('dev-report.json');
    });

    it('不同任务ID应解析不同路径', async () => {
      const taskId1 = 'TASK-aaa-001';
      const taskId2 = 'TASK-bbb-002';
      createDevReport(taskId1);
      // taskId2 不创建报告

      const ctx1 = createMockContext({
        taskId: taskId1,
        task: createMockTask({ id: taskId1 }),
        cwd: testDir,
      });

      const ctx2 = createMockContext({
        taskId: taskId2,
        task: createMockTask({ id: taskId2 }),
        cwd: testDir,
      });

      const result1 = await checker.check(ctx1);
      const result2 = await checker.check(ctx2);

      expect(result1.passed).toBe(true);
      expect(result2.passed).toBe(false);
      expect(result1.details?.reportPath).not.toBe(result2.details?.reportPath);
    });

    it('不同工作目录应影响路径解析', async () => {
      const taskId = 'TASK-cwd-001';
      const dir1 = path.join(testDir, 'dir1');
      const dir2 = path.join(testDir, 'dir2');

      // 只在 dir1 创建报告
      fs.mkdirSync(path.join(dir1, '.projmnt4claude', 'outputs', taskId), { recursive: true });
      fs.writeFileSync(
        path.join(dir1, '.projmnt4claude', 'outputs', taskId, 'dev-report.json'),
        '{}'
      );

      const ctx1 = createMockContext({ taskId, cwd: dir1 });
      const ctx2 = createMockContext({ taskId, cwd: dir2 });

      const result1 = await checker.check(ctx1);
      const result2 = await checker.check(ctx2);

      expect(result1.passed).toBe(true);
      expect(result2.passed).toBe(false);
    });
  });

  describe('详情字段', () => {
    it('通过时应包含完整的详情信息', async () => {
      const taskId = 'TASK-details-001';
      createDevReport(taskId);

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.reportName).toBe('dev-report.json');
      expect(result.details?.reportPath).toContain(taskId);
      expect(result.details?.exists).toBe(true);
    });

    it('失败时应包含完整的详情信息', async () => {
      const taskId = 'TASK-details-002';
      // 不创建报告

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.details).toBeDefined();
      expect(result.details?.reportName).toBe('dev-report.json');
      expect(result.details?.reportPath).toContain(taskId);
      expect(result.details?.exists).toBe(false);
    });
  });

  describe('输出目录不存在', () => {
    it('输出目录不存在时应失败', async () => {
      const taskId = 'TASK-no-dir-001';
      // 不创建任何目录

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('R-EVAL-PRE-002');
      expect(result.details?.exists).toBe(false);
    });
  });

  describe('报告内容无关性', () => {
    it('检查仅关注文件存在性，不关心报告内容', async () => {
      const taskId = 'TASK-content-001';
      // 创建一个空对象的报告
      createDevReport(taskId, {});

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
    });

    it('无效JSON内容的报告文件仍应通过存在性检查', async () => {
      const taskId = 'TASK-invalid-001';
      const outputsDir = path.join(testDir, '.projmnt4claude', 'outputs', taskId);
      fs.mkdirSync(outputsDir, { recursive: true });
      fs.writeFileSync(path.join(outputsDir, 'dev-report.json'), 'not valid json');

      const ctx = createMockContext({ taskId, cwd: testDir });
      const result = await checker.check(ctx);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('R-EVAL-PRE-002');
    });
  });
});
