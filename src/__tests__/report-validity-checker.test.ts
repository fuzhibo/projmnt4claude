/**
 * ReportValidityChecker 单元测试
 *
 * 测试报告有效性检查器的核心功能:
 * - 报告存在性检查
 * - 报告内容完整性检查
 * - 报告章节结构检查
 * - 报告与任务一致性检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ReportValidityChecker,
  createReportValidityChecker,
  quickReportValidityCheck,
  batchReportValidityCheck,
  formatReportValidityResult,
  DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG,
  DEFAULT_REPORT_TYPES,
  type ReportValidityCheckerConfig,
} from '../utils/pre-cr-gate/checkers/report-validity-checker.js';
import type { TaskMeta } from '../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'test',
    schemaVersion: 6,
    ...overrides,
  };
}

describe('ReportValidityChecker', () => {
  let testDir: string;
  let tasksDir: string;
  let reportsDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/report-validity-checker-test-');
    tasksDir = path.join(testDir, '.projmnt4claude', 'tasks');
    reportsDir = path.join(testDir, '.projmnt4claude', 'reports', 'harness');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    // 创建项目配置
    const configDir = path.join(testDir, '.projmnt4claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        version: '1.0.0',
        projectName: 'test-project',
      })
    );
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const checker = new ReportValidityChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new ReportValidityChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minContentLength).toBe(100);
      expect(config.requireSections).toBe(true);
      expect(config.validateTaskConsistency).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<ReportValidityCheckerConfig> = {
        enabled: false,
        minContentLength: 200,
        requireSections: false,
      };

      const checker = new ReportValidityChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.minContentLength).toBe(200);
      expect(config.requireSections).toBe(false);
    });
  });

  describe('报告存在性检查', () => {
    it('dev报告存在应该通过', async () => {
      const taskId = 'TASK-test-report-exists';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\n## 总结\nTest content'
      );

      const checker = new ReportValidityChecker(testDir, {
        requireSections: false,
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const existsResult = result.checks.find(c => c.checkId === 'report-exists-dev');

      expect(existsResult?.passed).toBe(true);
    });

    it('dev报告不存在应该通过（非必需）', async () => {
      const taskId = 'TASK-test-report-missing';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 不创建报告

      const checker = new ReportValidityChecker(testDir, {
        reportTypes: ['qa'], // 使用非必需报告类型
        requireSections: false,
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const existsResult = result.checks.find(c => c.checkId === 'report-exists-qa');

      expect(existsResult?.passed).toBe(true); // QA报告不是必需的，所以通过
    });
  });

  describe('报告内容完整性检查', () => {
    it('内容长度足够应该通过', async () => {
      const taskId = 'TASK-test-content';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建足够长的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\n' + 'A'.repeat(200)
      );

      const checker = new ReportValidityChecker(testDir, {
        requireSections: false,
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const contentResult = result.checks.find(c => c.checkId === 'report-content-dev');

      expect(contentResult?.passed).toBe(true);
    });

    it('内容长度不足应该失败', async () => {
      const taskId = 'TASK-test-content-short';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建短报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        'Short'
      );

      const checker = new ReportValidityChecker(testDir, {
        minContentLength: 100,
        requireSections: false,
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const contentResult = result.checks.find(c => c.checkId === 'report-content-dev');

      expect(contentResult?.passed).toBe(false);
    });

    it('空内容应该失败', async () => {
      const taskId = 'TASK-test-content-empty';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建空报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '   '
      );

      const checker = new ReportValidityChecker(testDir, {
        requireSections: false,
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const contentResult = result.checks.find(c => c.checkId === 'report-content-dev');

      expect(contentResult?.passed).toBe(false);
    });
  });

  describe('报告章节结构检查', () => {
    it('包含所有必需章节应该通过', async () => {
      const taskId = 'TASK-test-sections';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建包含所有章节的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report

## 总结
Summary content

## 变更
Changes content

## 测试
Test content

More content here to meet minimum length requirements.
`
      );

      const checker = new ReportValidityChecker(testDir, {
        requiredSections: ['## 总结', '## 变更', '## 测试'],
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const sectionsResult = result.checks.find(c => c.checkId === 'report-sections-dev');

      expect(sectionsResult?.passed).toBe(true);
    });

    it('缺少必需章节应该失败', async () => {
      const taskId = 'TASK-test-sections-missing';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建缺少章节的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report

## 总结
Summary content

More content here to meet minimum length requirements.
More content here to meet minimum length requirements.
More content here to meet minimum length requirements.
`
      );

      const checker = new ReportValidityChecker(testDir, {
        requiredSections: ['## 总结', '## 变更', '## 测试'],
        validateTaskConsistency: false,
      });
      const result = await checker.check(taskId);
      const sectionsResult = result.checks.find(c => c.checkId === 'report-sections-dev');

      expect(sectionsResult?.passed).toBe(false);
    });
  });

  describe('报告与任务一致性检查', () => {
    it('包含任务ID应该通过', async () => {
      const taskId = 'TASK-test-consistency';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        title: '测试任务一致性',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建包含任务ID的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report for ${taskId}

## 总结
This report is for task ${taskId}.
Test content to meet minimum length requirements.
More content here to meet minimum length requirements.
More content here to meet minimum length requirements.
`
      );

      const checker = new ReportValidityChecker(testDir, {
        requireSections: false,
        validateTaskConsistency: true,
      });
      const result = await checker.check(taskId);
      const consistencyResult = result.checks.find(c => c.checkId === 'report-consistency-dev');

      expect(consistencyResult?.passed).toBe(true);
    });

    it('不包含任务ID应该失败', async () => {
      const taskId = 'TASK-test-consistency-missing';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        title: '测试任务一致性',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建不包含任务ID的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report

## 总结
This is a generic report without task ID.
Test content to meet minimum length requirements.
More content here to meet minimum length requirements.
More content here to meet minimum length requirements.
`
      );

      const checker = new ReportValidityChecker(testDir, {
        requireSections: false,
        validateTaskConsistency: true,
      });
      const result = await checker.check(taskId);
      const consistencyResult = result.checks.find(c => c.checkId === 'report-consistency-dev');

      expect(consistencyResult?.passed).toBe(false);
    });
  });

  describe('综合检查', () => {
    it('所有检查通过时allPassed应该为true', async () => {
      const taskId = 'TASK-test-pass';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建完整的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report for ${taskId}

## 总结
This report is for task ${taskId}.
More content here to meet minimum length requirements.
More content here to meet minimum length requirements.
More content here to meet minimum length requirements.

## 变更
Changes made in this task.
More content here.

## 测试
Tests performed for this task.
More content here.
`
      );

      const checker = new ReportValidityChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.allPassed).toBe(true);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('便捷函数', () => {
    it('createReportValidityChecker应该创建实例', () => {
      const checker = createReportValidityChecker(testDir);
      expect(checker).toBeInstanceOf(ReportValidityChecker);
    });

    it('quickReportValidityCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content with sufficient length to pass the minimum content length check.'
      );

      const result = await quickReportValidityCheck(taskId, testDir, {
        requireSections: false,
        validateTaskConsistency: false,
      });

      expect(result.taskId).toBe(taskId);
    });

    it('batchReportValidityCheck应该批量执行检查', async () => {
      const taskIds = ['TASK-test-batch-1', 'TASK-test-batch-2'];

      for (const taskId of taskIds) {
        const taskDir = path.join(tasksDir, taskId);
        fs.mkdirSync(taskDir, { recursive: true });

        const task = createMockTask({ id: taskId });
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(task)
        );

        // 创建报告
        const taskReportDir = path.join(reportsDir, taskId);
        fs.mkdirSync(taskReportDir, { recursive: true });
        fs.writeFileSync(
          path.join(taskReportDir, 'dev-report.md'),
          '# Development Report\n\nTest content with sufficient length to pass the minimum content length check.'
        );
      }

      const results = await batchReportValidityCheck(taskIds, testDir, {
        requireSections: false,
        validateTaskConsistency: false,
      });

      expect(results.length).toBe(taskIds.length);
    });
  });

  describe('格式化输出', () => {
    it('应该格式化结果为字符串', async () => {
      const taskId = 'TASK-test-format';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new ReportValidityChecker(testDir);
      const result = await checker.check(taskId);
      const formatted = formatReportValidityResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('报告有效性检查');
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new ReportValidityChecker(testDir);

      checker.updateConfig({
        minContentLength: 500,
        requireSections: false,
      });

      const config = checker.getConfig();
      expect(config.minContentLength).toBe(500);
      expect(config.requireSections).toBe(false);
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG.minContentLength).toBe(100);
    expect(DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG.requireSections).toBe(true);
    expect(DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG.validateTaskConsistency).toBe(true);
  });

  it('DEFAULT_REPORT_TYPES应该包含所有报告类型', () => {
    expect(DEFAULT_REPORT_TYPES.length).toBeGreaterThan(0);
    expect(DEFAULT_REPORT_TYPES.some(r => r.type === 'dev')).toBe(true);
    expect(DEFAULT_REPORT_TYPES.some(r => r.type === 'code-review')).toBe(true);
    expect(DEFAULT_REPORT_TYPES.some(r => r.type === 'qa')).toBe(true);
  });
});
