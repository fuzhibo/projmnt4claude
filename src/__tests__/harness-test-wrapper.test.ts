import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  createHarnessTestContext,
  createHarnessTestLifecycle,
  createTestTasks,
  createTaskDependency,
  createDevReport,
  createCodeReviewReport,
  createQAReport,
  type HarnessTestContext,
} from '../utils/harness-test-wrapper.js';

describe('createHarnessTestContext', () => {
  let ctx: HarnessTestContext;

  beforeEach(async () => {
    ctx = await createHarnessTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ============================================================
  // 基本功能测试
  // ============================================================

  test('should create temp directory', () => {
    expect(fs.existsSync(ctx.tempDir)).toBe(true);
    expect(fs.statSync(ctx.tempDir).isDirectory()).toBe(true);
  });

  test('should create project directory structure', () => {
    expect(fs.existsSync(ctx.projectDir)).toBe(true);
    expect(fs.existsSync(ctx.tasksDir)).toBe(true);
    expect(fs.existsSync(ctx.reportsDir)).toBe(true);
  });

  test('should provide valid harness config', () => {
    expect(ctx.config).toBeDefined();
    expect(ctx.config.cwd).toBe(ctx.tempDir);
    expect(ctx.config.maxRetries).toBe(3);
    expect(ctx.config.timeout).toBe(300);
  });

  test('should provide valid runtime state', () => {
    expect(ctx.runtimeState).toBeDefined();
    expect(ctx.runtimeState.state).toBe('idle');
    expect(ctx.runtimeState.taskQueue).toEqual([]);
    // PROBLEM-2: records field removed from HarnessRuntimeState
    expect('records' in ctx.runtimeState).toBe(false);
  });

  // ============================================================
  // 任务管理测试
  // ============================================================

  describe('task management', () => {
    test('should create task with default meta', () => {
      const taskDir = ctx.createTask('TASK-test-001');

      expect(fs.existsSync(taskDir)).toBe(true);
      expect(ctx.taskExists('TASK-test-001')).toBe(true);

      const meta = ctx.readTask('TASK-test-001');
      expect(meta).not.toBeNull();
      expect(meta?.id).toBe('TASK-test-001');
      expect(meta?.title).toBe('Test Task TASK-test-001');
      expect(meta?.status).toBe('open');
    });

    test('should create task with custom meta', () => {
      ctx.createTask('TASK-test-002', {
        title: 'Custom Task Title',
        priority: 'P0',
        status: 'in_progress',
      });

      const meta = ctx.readTask('TASK-test-002');
      expect(meta?.title).toBe('Custom Task Title');
      expect(meta?.priority).toBe('P0');
      expect(meta?.status).toBe('in_progress');
    });

    test('should update task meta', () => {
      ctx.createTask('TASK-test-003');

      ctx.writeTask('TASK-test-003', {
        id: 'TASK-test-003',
        title: 'Updated Title',
        status: 'resolved',
      });

      const meta = ctx.readTask('TASK-test-003');
      expect(meta?.title).toBe('Updated Title');
      expect(meta?.status).toBe('resolved');
    });

    test('should return null for non-existent task', () => {
      const meta = ctx.readTask('TASK-nonexistent');
      expect(meta).toBeNull();
    });

    test('should return false for non-existent task', () => {
      expect(ctx.taskExists('TASK-nonexistent')).toBe(false);
    });
  });

  // ============================================================
  // 报告管理测试
  // ============================================================

  describe('report management', () => {
    test('should create dev report', () => {
      ctx.createTask('TASK-report-001');
      const reportPath = ctx.createReport('TASK-report-001', 'dev', '# Dev Report');

      expect(fs.existsSync(reportPath)).toBe(true);
      expect(ctx.readReport('TASK-report-001', 'dev')).toBe('# Dev Report');
    });

    test('should create code-review report', () => {
      ctx.createTask('TASK-report-002');
      const reportPath = ctx.createReport('TASK-report-002', 'code-review', '# Code Review Report');

      expect(fs.existsSync(reportPath)).toBe(true);
      expect(ctx.readReport('TASK-report-002', 'code-review')).toBe('# Code Review Report');
    });

    test('should create qa report', () => {
      ctx.createTask('TASK-report-003');
      const reportPath = ctx.createReport('TASK-report-003', 'qa', '# QA Report');

      expect(fs.existsSync(reportPath)).toBe(true);
      expect(ctx.readReport('TASK-report-003', 'qa')).toBe('# QA Report');
    });

    test('should return null for non-existent report', () => {
      const content = ctx.readReport('TASK-nonexistent', 'dev');
      expect(content).toBeNull();
    });
  });

  // ============================================================
  // 重置和清理测试
  // ============================================================

  describe('reset and cleanup', () => {
    test('should reset tasks but keep directory structure', () => {
      ctx.createTask('TASK-reset-001');
      ctx.createReport('TASK-reset-001', 'dev', '# Report');

      ctx.reset();

      expect(ctx.taskExists('TASK-reset-001')).toBe(false);
      expect(fs.existsSync(ctx.tasksDir)).toBe(true);
      expect(fs.existsSync(ctx.reportsDir)).toBe(true);
    });

    test('should allow creating new tasks after reset', () => {
      ctx.createTask('TASK-before');
      ctx.reset();

      ctx.createTask('TASK-after');
      expect(ctx.taskExists('TASK-after')).toBe(true);
    });
  });

  // ============================================================
  // Mock 测试
  // ============================================================

  describe('path module mocks', () => {
    test('should have initialized mocks', () => {
      expect(ctx.mocks).toBeDefined();
      expect(ctx.mocks.isInitialized).toBeDefined();
      expect(ctx.mocks.getTasksDir).toBeDefined();
      expect(ctx.mocks.getProjectDir).toBeDefined();
    });
  });
});

// ============================================================
// 便捷函数测试
// ============================================================

describe('convenience functions', () => {
  describe('createHarnessTestLifecycle', () => {
    const { setup, teardown, getCtx } = createHarnessTestLifecycle();

    beforeEach(setup);
    afterEach(teardown);

    test('should provide context via getCtx', () => {
      const ctx = getCtx();
      expect(ctx).toBeDefined();
      expect(ctx.tempDir).toBeDefined();
      expect(ctx.tasksDir).toBeDefined();
    });

    test('should create tasks in lifecycle context', () => {
      const ctx = getCtx();
      ctx.createTask('TASK-lifecycle-001');
      expect(ctx.taskExists('TASK-lifecycle-001')).toBe(true);
    });
  });

  describe('createTestTasks', () => {
    let ctx: HarnessTestContext;

    beforeEach(async () => {
      ctx = await createHarnessTestContext();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    test('should create multiple tasks', () => {
      const taskIds = createTestTasks(ctx, 3);

      expect(taskIds).toHaveLength(3);
      expect(taskIds).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);

      for (const taskId of taskIds) {
        expect(ctx.taskExists(taskId)).toBe(true);
      }
    });

    test('should create tasks with base meta', () => {
      createTestTasks(ctx, 2, { type: 'bugfix', priority: 'P0' });

      for (let i = 1; i <= 2; i++) {
        const meta = ctx.readTask(`TASK-${String(i).padStart(3, '0')}`);
        expect(meta?.type).toBe('bugfix');
        expect(meta?.priority).toBe('P0');
      }
    });
  });

  describe('createTaskDependency', () => {
    let ctx: HarnessTestContext;

    beforeEach(async () => {
      ctx = await createHarnessTestContext();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    test('should create dependency between tasks', () => {
      ctx.createTask('TASK-parent');
      ctx.createTask('TASK-child');

      createTaskDependency(ctx, 'TASK-parent', 'TASK-child');

      const meta = ctx.readTask('TASK-parent');
      expect(meta?.dependencies).toContain('TASK-child');
    });

    test('should not duplicate dependencies', () => {
      ctx.createTask('TASK-parent');
      ctx.createTask('TASK-child');

      createTaskDependency(ctx, 'TASK-parent', 'TASK-child');
      createTaskDependency(ctx, 'TASK-parent', 'TASK-child');

      const meta = ctx.readTask('TASK-parent');
      const deps = meta?.dependencies as string[];
      expect(deps.filter(d => d === 'TASK-child')).toHaveLength(1);
    });
  });

  describe('report helper functions', () => {
    let ctx: HarnessTestContext;

    beforeEach(async () => {
      ctx = await createHarnessTestContext();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    test('createDevReport should create valid dev report', () => {
      ctx.createTask('TASK-dev-report');
      const reportPath = createDevReport(ctx, 'TASK-dev-report', 'success', {
        checkpoints: ['CP-1', 'CP-2'],
        evidence: ['src/foo.ts'],
      });

      expect(fs.existsSync(reportPath)).toBe(true);

      const content = ctx.readReport('TASK-dev-report', 'dev');
      expect(content).toContain('开发报告');
      expect(content).toContain('TASK-dev-report');
      expect(content).toContain('success');
      expect(content).toContain('CP-1');
      expect(content).toContain('src/foo.ts');
    });

    test('createDevReport should include error section for failed status', () => {
      ctx.createTask('TASK-dev-fail');
      createDevReport(ctx, 'TASK-dev-fail', 'failed', {
        error: 'Build failed',
      });

      const content = ctx.readReport('TASK-dev-fail', 'dev');
      expect(content).toContain('failed');
      expect(content).toContain('Build failed');
    });

    test('createCodeReviewReport should create PASS report', () => {
      ctx.createTask('TASK-cr-pass');
      const reportPath = createCodeReviewReport(ctx, 'TASK-cr-pass', 'PASS');

      expect(fs.existsSync(reportPath)).toBe(true);

      const content = ctx.readReport('TASK-cr-pass', 'code-review');
      expect(content).toContain('代码审核报告');
      expect(content).toContain('✅ PASS');
    });

    test('createCodeReviewReport should create NOPASS report with details', () => {
      ctx.createTask('TASK-cr-fail');
      createCodeReviewReport(ctx, 'TASK-cr-fail', 'NOPASS', {
        reason: 'Code style issues',
        failedCheckpoints: ['CP-style'],
        details: 'Detailed feedback here',
      });

      const content = ctx.readReport('TASK-cr-fail', 'code-review');
      expect(content).toContain('❌ NOPASS');
      expect(content).toContain('Code style issues');
      expect(content).toContain('CP-style');
      expect(content).toContain('Detailed feedback here');
    });

    test('createQAReport should create PASS report', () => {
      ctx.createTask('TASK-qa-pass');
      const reportPath = createQAReport(ctx, 'TASK-qa-pass', 'PASS');

      expect(fs.existsSync(reportPath)).toBe(true);

      const content = ctx.readReport('TASK-qa-pass', 'qa');
      expect(content).toContain('QA 验证报告');
      expect(content).toContain('✅ PASS');
      expect(content).toContain('否'); // 需要人工验证: 否
    });

    test('createQAReport should create NOPASS report with test failures', () => {
      ctx.createTask('TASK-qa-fail');
      createQAReport(ctx, 'TASK-qa-fail', 'NOPASS', {
        reason: 'Tests failed',
        testFailures: ['Test suite A', 'Test suite B'],
        failedCheckpoints: ['CP-test'],
        requiresHuman: true,
      });

      const content = ctx.readReport('TASK-qa-fail', 'qa');
      expect(content).toContain('❌ NOPASS');
      expect(content).toContain('是'); // 需要人工验证: 是
      expect(content).toContain('Test suite A');
      expect(content).toContain('Test suite B');
    });
  });
});

// ============================================================
// 选项配置测试
// ============================================================

describe('options configuration', () => {
  test('should use custom harness config', async () => {
    const ctx = await createHarnessTestContext({
      harnessConfig: {
        maxRetries: 5,
        timeout: 600,
        dryRun: true,
      },
    });

    expect(ctx.config.maxRetries).toBe(5);
    expect(ctx.config.timeout).toBe(600);
    expect(ctx.config.dryRun).toBe(true);

    ctx.cleanup();
  });

  test('should use custom prefix', async () => {
    const ctx = await createHarnessTestContext({
      prefix: 'custom-harness-test-',
    });

    expect(ctx.tempDir).toContain('custom-harness-test-');

    ctx.cleanup();
  });

  test('should create sample tasks when requested', async () => {
    const ctx = await createHarnessTestContext({
      createSampleTasks: true,
    });

    expect(ctx.taskExists('TASK-sample-001')).toBe(true);
    expect(ctx.taskExists('TASK-sample-002')).toBe(true);

    const meta1 = ctx.readTask('TASK-sample-001');
    expect(meta1?.priority).toBe('P1');

    const meta2 = ctx.readTask('TASK-sample-002');
    expect(meta2?.priority).toBe('P0');

    ctx.cleanup();
  });
});
