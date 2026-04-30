/**
 * PrerequisitesChecker 单元测试
 *
 * 测试审核前置条件检查器的核心功能:
 * - 任务状态检查
 * - 检查点完成检查
 * - 依赖任务状态检查
 * - 开发产物检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  PrerequisitesChecker,
  createPrerequisitesChecker,
  quickPrerequisitesCheck,
  batchPrerequisitesCheck,
  validateCheckpointForReview,
  formatPrerequisitesResult,
  DEFAULT_PREREQUISITES_CHECKER_CONFIG,
  type PrerequisitesCheckerConfig,
} from '../utils/pre-cr-gate/checkers/prerequisites-checker.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述，长度足够长以满足要求',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '测试检查点1', status: 'completed' },
      { id: 'CP-002', description: '测试检查点2', status: 'completed' },
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

function createMockCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-test',
    description: '测试检查点',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PrerequisitesChecker', () => {
  let testDir: string;
  let tasksDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/prerequisites-checker-test-');
    tasksDir = path.join(testDir, '.projmnt4claude', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

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
      const checker = new PrerequisitesChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new PrerequisitesChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.requireAllCheckpoints).toBe(true);
      expect(config.requireAllCheckpointsPassed).toBe(true);
      expect(config.checkDependencies).toBe(true);
      expect(config.checkArtifacts).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PrerequisitesCheckerConfig> = {
        enabled: false,
        requireAllCheckpoints: false,
        checkDependencies: false,
      };

      const checker = new PrerequisitesChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.requireAllCheckpoints).toBe(false);
      expect(config.checkDependencies).toBe(false);
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const statusCheck = result.checks.find(c => c.checkId === 'task-status');

      expect(statusCheck?.passed).toBe(true);
      expect(statusCheck?.message).toContain('符合要求');
    });

    it('wait_review状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_review',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const statusCheck = result.checks.find(c => c.checkId === 'task-status');

      expect(statusCheck?.passed).toBe(true);
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const statusCheck = result.checks.find(c => c.checkId === 'task-status');

      expect(statusCheck?.passed).toBe(false);
      expect(statusCheck?.message).toContain('不符合要求');
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
          createMockCheckpoint({ id: 'CP-001', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', status: 'completed' }),
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const checkpointCheck = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointCheck?.passed).toBe(true);
      expect(checkpointCheck?.details?.completionRate).toBe(1);
    });

    it('存在未完成的检查点应该失败', async () => {
      const taskId = 'TASK-test-checkpoints';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        priority: 'P1',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', status: 'pending' }),
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const checkpointCheck = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointCheck?.passed).toBe(false);
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const checkpointCheck = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointCheck?.passed).toBe(true);
      expect(checkpointCheck?.message).toContain('跳过');
    });

    it('存在失败的检查点应该失败', async () => {
      const taskId = 'TASK-test-checkpoints';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', status: 'failed' }),
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir, {
        allowFailedCheckpoints: false,
      });
      const result = await checker.check(taskId);
      const checkpointCheck = result.checks.find(c => c.checkId === 'checkpoints');

      expect(checkpointCheck?.passed).toBe(false);
    });
  });

  describe('依赖任务状态检查', () => {
    it('无依赖应该通过', async () => {
      const taskId = 'TASK-test-no-deps';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        dependencies: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const depCheck = result.checks.find(c => c.checkId === 'dependencies');

      expect(depCheck?.passed).toBe(true);
      expect(depCheck?.message).toContain('无依赖');
    });

    it('依赖不存在应该失败', async () => {
      const taskId = 'TASK-test-missing-dep';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        dependencies: ['TASK-non-existent'],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const depCheck = result.checks.find(c => c.checkId === 'dependencies');

      expect(depCheck?.passed).toBe(false);
      expect(depCheck?.message).toContain('不存在');
    });

    it('已完成的依赖应该通过', async () => {
      // 创建依赖任务
      const depId = 'TASK-dep-completed';
      const depDir = path.join(tasksDir, depId);
      fs.mkdirSync(depDir, { recursive: true });

      const depTask = createMockTask({
        id: depId,
        status: 'resolved',
      });
      fs.writeFileSync(
        path.join(depDir, 'meta.json'),
        JSON.stringify(depTask)
      );

      // 创建主任务
      const taskId = 'TASK-test-with-dep';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        dependencies: [depId],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const depCheck = result.checks.find(c => c.checkId === 'dependencies');

      expect(depCheck?.passed).toBe(true);
    });

    it('未完成的依赖应该失败', async () => {
      // 创建依赖任务
      const depId = 'TASK-dep-in-progress';
      const depDir = path.join(tasksDir, depId);
      fs.mkdirSync(depDir, { recursive: true });

      const depTask = createMockTask({
        id: depId,
        status: 'in_progress',
      });
      fs.writeFileSync(
        path.join(depDir, 'meta.json'),
        JSON.stringify(depTask)
      );

      // 创建主任务
      const taskId = 'TASK-test-with-dep';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        dependencies: [depId],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const depCheck = result.checks.find(c => c.checkId === 'dependencies');

      expect(depCheck?.passed).toBe(false);
    });
  });

  describe('开发产物检查', () => {
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const artifactCheck = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactCheck?.passed).toBe(true);
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const artifactCheck = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactCheck?.passed).toBe(false);
      expect(artifactCheck?.message).toContain('缺少');
    });

    it('未配置文件应该跳过', async () => {
      const taskId = 'TASK-test-artifacts';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        affected_files: [],
        files: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const artifactCheck = result.checks.find(c => c.checkId === 'artifacts');

      expect(artifactCheck?.passed).toBe(true);
      expect(artifactCheck?.message).toContain('跳过');
    });
  });

  describe('检查结果', () => {
    it('所有检查通过应该返回allPassed为true', async () => {
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.allPassed).toBe(true);
      expect(result.failedCount).toBe(0);
    });

    it('有检查失败应该返回allPassed为false', async () => {
      const taskId = 'TASK-test-fail';
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

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.allPassed).toBe(false);
      expect(result.failedCount).toBeGreaterThan(0);
    });
  });

  describe('便捷函数', () => {
    it('createPrerequisitesChecker应该创建实例', () => {
      const checker = createPrerequisitesChecker(testDir);
      expect(checker).toBeInstanceOf(PrerequisitesChecker);
    });

    it('quickPrerequisitesCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const result = await quickPrerequisitesCheck(taskId, testDir);

      expect(result.taskId).toBe(taskId);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('batchPrerequisitesCheck应该批量执行检查', async () => {
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

      const results = await batchPrerequisitesCheck(taskIds, testDir);

      expect(results.length).toBe(taskIds.length);
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new PrerequisitesChecker(testDir);

      checker.updateConfig({
        requireAllCheckpoints: false,
        checkDependencies: false,
      });

      const config = checker.getConfig();
      expect(config.requireAllCheckpoints).toBe(false);
      expect(config.checkDependencies).toBe(false);
    });
  });

  describe('工具函数', () => {
    it('validateCheckpointForReview应该验证检查点', () => {
      const validCheckpoint = createMockCheckpoint({
        status: 'completed',
        requiredRole: 'code_reviewer',
      });

      const result = validateCheckpointForReview(validCheckpoint);
      expect(result.valid).toBe(true);
    });

    it('validateCheckpointForReview应该拒绝未完成的检查点', () => {
      const invalidCheckpoint = createMockCheckpoint({
        status: 'pending',
        requiredRole: 'code_reviewer',
      });

      const result = validateCheckpointForReview(invalidCheckpoint);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('未完成');
    });

    it('formatPrerequisitesResult应该格式化结果', async () => {
      const taskId = 'TASK-test-format';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new PrerequisitesChecker(testDir);
      const result = await checker.check(taskId);
      const formatted = formatPrerequisitesResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('审核前置条件检查');
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_PREREQUISITES_CHECKER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_PREREQUISITES_CHECKER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_PREREQUISITES_CHECKER_CONFIG.requireAllCheckpoints).toBe(true);
    expect(DEFAULT_PREREQUISITES_CHECKER_CONFIG.checkDependencies).toBe(true);
    expect(DEFAULT_PREREQUISITES_CHECKER_CONFIG.checkArtifacts).toBe(true);
  });
});
