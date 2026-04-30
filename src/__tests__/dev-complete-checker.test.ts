/**
 * DevCompleteChecker 单元测试
 *
 * 测试开发完成检查器的核心功能:
 * - 任务状态检查
 * - 开发报告检查
 * - 检查点完成检查
 * - 开发产物验证
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  DevCompleteChecker,
  createDevCompleteChecker,
  quickDevCompleteCheck,
  batchDevCompleteCheck,
  formatDevCompleteResult,
  DEFAULT_DEV_COMPLETE_CHECKER_CONFIG,
  type DevCompleteCheckerConfig,
} from '../utils/pre-cr-gate/checkers/dev-complete-checker.js';
import type { TaskMeta } from '../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述，包含解决方案部分',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '测试检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'CP-002', description: '测试检查点2', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    affected_files: ['src/test.ts'],
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

describe('DevCompleteChecker', () => {
  let testDir: string;
  let tasksDir: string;
  let reportsDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/dev-complete-checker-test-');
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
      const checker = new DevCompleteChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new DevCompleteChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.requireDevReport).toBe(true);
      expect(config.requireAllCheckpoints).toBe(true);
      expect(config.allowFailedCheckpoints).toBe(false);
      expect(config.validateArtifacts).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<DevCompleteCheckerConfig> = {
        enabled: false,
        requireDevReport: false,
        requireAllCheckpoints: false,
      };

      const checker = new DevCompleteChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.requireDevReport).toBe(false);
      expect(config.requireAllCheckpoints).toBe(false);
    });
  });

  describe('任务状态检查', () => {
    it('in_progress状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'in_progress',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const statusResult = result.checks.find(c => c.checkId === 'task-status');

      expect(statusResult?.passed).toBe(true);
    });

    it('open状态应该失败', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'open',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const statusResult = result.checks.find(c => c.checkId === 'task-status');

      expect(statusResult?.passed).toBe(false);
    });
  });

  describe('开发报告检查', () => {
    it('报告存在应该通过', async () => {
      const taskId = 'TASK-test-report';
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
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const reportResult = result.checks.find(c => c.checkId === 'dev-report');

      expect(reportResult?.passed).toBe(true);
    });

    it('报告不存在应该失败', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 不创建开发报告

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const reportResult = result.checks.find(c => c.checkId === 'dev-report');

      expect(reportResult?.passed).toBe(false);
    });

    it('禁用报告检查时应该跳过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new DevCompleteChecker(testDir, {
        requireDevReport: false,
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const reportResult = result.checks.find(c => c.checkId === 'dev-report');

      expect(reportResult).toBeUndefined();
    });
  });

  describe('检查点完成检查', () => {
    it('所有检查点完成应该通过', async () => {
      const taskId = 'TASK-test-checkpoints';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const checkpointResult = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointResult?.passed).toBe(true);
    });

    it('存在未完成的检查点应该失败', async () => {
      const taskId = 'TASK-test-checkpoints';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        priority: 'P1', // required checkpoint policy
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const checkpointResult = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointResult?.passed).toBe(false);
    });

    it('checkpointPolicy为none时应该通过', async () => {
      const taskId = 'TASK-test-checkpoints';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpointPolicy: 'none',
        checkpoints: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const checkpointResult = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointResult?.passed).toBe(true);
    });
  });

  describe('开发产物验证', () => {
    it('文件存在应该通过', async () => {
      const taskId = 'TASK-test-artifacts';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      // 创建测试文件
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

      const task = createMockTask({
        id: taskId,
        affected_files: ['src/test.ts'],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir);
      const result = await checker.check(taskId);
      const artifactResult = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactResult?.passed).toBe(true);
    });

    it('文件不存在应该失败', async () => {
      const taskId = 'TASK-test-artifacts';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        affected_files: ['src/non-existent.ts'],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir);
      const result = await checker.check(taskId);
      const artifactResult = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactResult?.passed).toBe(false);
    });

    it('禁用产物验证时应该跳过', async () => {
      const taskId = 'TASK-test-artifacts';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        affected_files: ['src/non-existent.ts'],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const artifactResult = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactResult).toBeUndefined();
    });
  });

  describe('综合检查', () => {
    it('所有检查通过时allPassed应该为true', async () => {
      const taskId = 'TASK-test-pass';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      // 创建测试文件
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

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
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.allPassed).toBe(true);
      expect(result.failedCount).toBe(0);
    });

    it('有检查失败时allPassed应该为false', async () => {
      const taskId = 'TASK-test-fail';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'open', // 会导致任务状态检查失败
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 不创建开发报告，会导致报告检查失败

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);

      expect(result.allPassed).toBe(false);
      expect(result.failedCount).toBeGreaterThan(0);
    });
  });

  describe('便捷函数', () => {
    it('createDevCompleteChecker应该创建实例', () => {
      const checker = createDevCompleteChecker(testDir);
      expect(checker).toBeInstanceOf(DevCompleteChecker);
    });

    it('quickDevCompleteCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
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
        '# Development Report\n\nTest content'
      );

      const result = await quickDevCompleteCheck(taskId, testDir, {
        validateArtifacts: false,
      });

      expect(result.taskId).toBe(taskId);
    });

    it('batchDevCompleteCheck应该批量执行检查', async () => {
      const taskIds = ['TASK-test-batch-1', 'TASK-test-batch-2'];

      for (const taskId of taskIds) {
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
          '# Development Report\n\nTest content'
        );
      }

      const results = await batchDevCompleteCheck(taskIds, testDir, {
        validateArtifacts: false,
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

      // 创建开发报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        '# Development Report\n\nTest content'
      );

      const checker = new DevCompleteChecker(testDir, {
        validateArtifacts: false,
      });
      const result = await checker.check(taskId);
      const formatted = formatDevCompleteResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('开发完成检查');
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new DevCompleteChecker(testDir);

      checker.updateConfig({
        requireDevReport: false,
        requireAllCheckpoints: false,
      });

      const config = checker.getConfig();
      expect(config.requireDevReport).toBe(false);
      expect(config.requireAllCheckpoints).toBe(false);
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_DEV_COMPLETE_CHECKER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_DEV_COMPLETE_CHECKER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_DEV_COMPLETE_CHECKER_CONFIG.requireDevReport).toBe(true);
    expect(DEFAULT_DEV_COMPLETE_CHECKER_CONFIG.requireAllCheckpoints).toBe(true);
    expect(DEFAULT_DEV_COMPLETE_CHECKER_CONFIG.allowFailedCheckpoints).toBe(false);
    expect(DEFAULT_DEV_COMPLETE_CHECKER_CONFIG.validateArtifacts).toBe(true);
  });
});
