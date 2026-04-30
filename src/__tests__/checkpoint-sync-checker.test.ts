/**
 * CheckpointSyncChecker 单元测试
 *
 * 测试检查点同步检查器的核心功能:
 * - 检查点存在性检查
 * - 检查点状态一致性检查
 * - 检查点与任务状态匹配检查
 * - 检查点与报告一致性检查
 * - 过期检查点检测
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  CheckpointSyncChecker,
  createCheckpointSyncChecker,
  quickCheckpointSyncCheck,
  batchCheckpointSyncCheck,
  formatCheckpointSyncResult,
  DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG,
  type CheckpointSyncCheckerConfig,
} from '../utils/pre-cr-gate/checkers/checkpoint-sync-checker.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  const now = new Date().toISOString();
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '测试检查点1', status: 'completed', createdAt: now, updatedAt: now },
      { id: 'CP-002', description: '测试检查点2', status: 'completed', createdAt: now, updatedAt: now },
    ],
    createdAt: now,
    updatedAt: now,
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'test',
    schemaVersion: 6,
    ...overrides,
  };
}

describe('CheckpointSyncChecker', () => {
  let testDir: string;
  let tasksDir: string;
  let reportsDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/checkpoint-sync-checker-test-');
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
      const checker = new CheckpointSyncChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new CheckpointSyncChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.checkStatusConsistency).toBe(true);
      expect(config.checkTaskStatusMatch).toBe(true);
      expect(config.checkReportConsistency).toBe(true);
      expect(config.detectStaleCheckpoints).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<CheckpointSyncCheckerConfig> = {
        enabled: false,
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
      };

      const checker = new CheckpointSyncChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.checkStatusConsistency).toBe(false);
      expect(config.checkTaskStatusMatch).toBe(false);
    });
  });

  describe('检查点存在性检查', () => {
    it('有检查点时应该通过', async () => {
      const taskId = 'TASK-test-existence';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const existenceResult = result.checks.find(c => c.checkId === 'checkpoints-existence');

      expect(existenceResult?.passed).toBe(true);
    });

    it('checkpointPolicy为none时应该通过', async () => {
      const taskId = 'TASK-test-none';
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

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const existenceResult = result.checks.find(c => c.checkId === 'checkpoints-existence');

      expect(existenceResult?.passed).toBe(true);
    });
  });

  describe('检查点状态一致性检查', () => {
    it('所有检查点状态有效应该通过', async () => {
      const taskId = 'TASK-test-status-valid';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-003', description: '检查点3', status: 'skipped', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const statusResult = result.checks.find(c => c.checkId === 'status-consistency');

      expect(statusResult?.passed).toBe(true);
    });
  });

  describe('检查点与任务状态匹配检查', () => {
    it('in_progress状态与pending检查点应该通过', async () => {
      const taskId = 'TASK-test-match';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'in_progress',
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const matchResult = result.checks.find(c => c.checkId === 'task-status-match');

      expect(matchResult?.passed).toBe(true);
    });

    it('resolved状态与未完成检查点应该失败', async () => {
      const taskId = 'TASK-test-resolved';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'resolved',
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const matchResult = result.checks.find(c => c.checkId === 'task-status-match');

      expect(matchResult?.passed).toBe(false);
    });
  });

  describe('检查点与报告一致性检查', () => {
    it('检查点在报告中提及应该通过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 创建包含检查点ID的报告
      const taskReportDir = path.join(reportsDir, taskId);
      fs.mkdirSync(taskReportDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskReportDir, 'dev-report.md'),
        `# Development Report

Completed checkpoint CP-001.
`
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const reportResult = result.checks.find(c => c.checkId === 'report-consistency');

      expect(reportResult?.passed).toBe(true);
    });

    it('报告不存在应该通过（跳过）', async () => {
      const taskId = 'TASK-test-no-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      // 不创建报告

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const reportResult = result.checks.find(c => c.checkId === 'report-consistency');

      expect(reportResult?.passed).toBe(true);
      expect(reportResult?.message).toContain('跳过');
    });
  });

  describe('过期检查点检测', () => {
    it('新检查点不应该被标记为过期', async () => {
      const taskId = 'TASK-test-fresh';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const now = new Date().toISOString();
      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'pending', createdAt: now, updatedAt: now },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
      });
      const result = await checker.check(taskId);
      const staleResult = result.checks.find(c => c.checkId === 'stale-checkpoints');

      expect(staleResult?.passed).toBe(true);
    });

    it('禁用过期检测时应该跳过', async () => {
      const taskId = 'TASK-test-no-stale';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const staleResult = result.checks.find(c => c.checkId === 'stale-checkpoints');

      expect(staleResult).toBeUndefined();
    });
  });

  describe('同步问题收集', () => {
    it('应该收集同步问题', async () => {
      const taskId = 'TASK-test-issues';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'resolved',
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-002', description: '检查点2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);

      expect(result.syncIssues.length).toBeGreaterThan(0);
      expect(result.syncIssues.some(i => i.type === 'status_mismatch')).toBe(true);
    });
  });

  describe('便捷函数', () => {
    it('createCheckpointSyncChecker应该创建实例', () => {
      const checker = createCheckpointSyncChecker(testDir);
      expect(checker).toBeInstanceOf(CheckpointSyncChecker);
    });

    it('quickCheckpointSyncCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const result = await quickCheckpointSyncCheck(taskId, testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });

      expect(result.taskId).toBe(taskId);
    });

    it('batchCheckpointSyncCheck应该批量执行检查', async () => {
      const taskIds = ['TASK-test-batch-1', 'TASK-test-batch-2'];

      for (const taskId of taskIds) {
        const taskDir = path.join(tasksDir, taskId);
        fs.mkdirSync(taskDir, { recursive: true });

        const task = createMockTask({ id: taskId });
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(task)
        );
      }

      const results = await batchCheckpointSyncCheck(taskIds, testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
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

      const checker = new CheckpointSyncChecker(testDir, {
        checkStatusConsistency: false,
        checkTaskStatusMatch: false,
        checkReportConsistency: false,
        detectStaleCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const formatted = formatCheckpointSyncResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('检查点同步检查');
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new CheckpointSyncChecker(testDir);

      checker.updateConfig({
        checkStatusConsistency: false,
        detectStaleCheckpoints: false,
      });

      const config = checker.getConfig();
      expect(config.checkStatusConsistency).toBe(false);
      expect(config.detectStaleCheckpoints).toBe(false);
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.checkStatusConsistency).toBe(true);
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.checkTaskStatusMatch).toBe(true);
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.checkReportConsistency).toBe(true);
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.detectStaleCheckpoints).toBe(true);
    expect(DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG.staleThresholdMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
