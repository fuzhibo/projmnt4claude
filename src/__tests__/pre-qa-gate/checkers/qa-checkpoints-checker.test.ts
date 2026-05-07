/**
 * QACheckpointsChecker 单元测试
 *
 * 测试QA检查点定义检查器的核心功能:
 * - 检查点存在性检查
 * - QA检查点识别逻辑
 * - QA检查点状态检查
 * - 配置管理
 * - 结果格式化
 * - 便捷函数
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  QACheckpointsChecker,
  createQACheckpointsChecker,
  quickQACheckpointsCheck,
  batchQACheckpointsCheck,
  formatQACheckpointsResult,
  DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG,
  type QACheckpointsCheckerConfig,
} from '../../../utils/pre-qa-gate/checkers/qa-checkpoints-checker.js';
import type { TaskMeta, CheckpointMetadata } from '../../../types/task.js';

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
    checkpoints: [],
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

function createMockCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-001',
    description: '测试检查点',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('QACheckpointsChecker', () => {
  let testDir: string;
  let tasksDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/qa-checkpoints-test-');
    tasksDir = path.join(testDir, '.projmnt4claude', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

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
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const checker = new QACheckpointsChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new QACheckpointsChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.requireQACheckpoints).toBe(true);
      expect(config.minQACheckpointCount).toBe(1);
      expect(config.qaKeywords).toContain('qa');
      expect(config.qaKeywords).toContain('test');
      expect(config.qaKeywords).toContain('验证');
      expect(config.qaKeywords).toContain('质量');
      expect(config.allowGenericTestCheckpoints).toBe(true);
      expect(config.requireCorrectStatus).toBe(false);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<QACheckpointsCheckerConfig> = {
        enabled: false,
        requireQACheckpoints: false,
        minQACheckpointCount: 3,
        qaKeywords: ['custom-qa'],
      };
      const checker = new QACheckpointsChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.requireQACheckpoints).toBe(false);
      expect(config.minQACheckpointCount).toBe(3);
      expect(config.qaKeywords).toEqual(['custom-qa']);
    });
  });

  describe('任务存在性检查', () => {
    it('任务不存在时应该返回失败', async () => {
      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-nonexistent');

      expect(result.allPassed).toBe(false);
      expect(result.failedCount).toBe(1);
      expect(result.checks[0].checkId).toBe('task-existence');
      expect(result.checks[0].passed).toBe(false);
      expect(result.checks[0].message).toContain('不存在');
    });
  });

  describe('检查点存在性检查', () => {
    it('有检查点时应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-has-checkpoints',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '代码审核检查点' }),
          createMockCheckpoint({ id: 'CP-002', description: 'QA验证检查点' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-has-checkpoints');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-has-checkpoints');

      const checkpointsExistCheck = result.checks.find(c => c.checkId === 'checkpoints-exist');
      expect(checkpointsExistCheck?.passed).toBe(true);
      expect(checkpointsExistCheck?.message).toContain('2 个检查点');
    });

    it('无检查点时应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-no-checkpoints',
        checkpoints: [],
      });

      const taskDir = path.join(tasksDir, 'TASK-no-checkpoints');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-no-checkpoints');

      const checkpointsExistCheck = result.checks.find(c => c.checkId === 'checkpoints-exist');
      expect(checkpointsExistCheck?.passed).toBe(false);
      expect(checkpointsExistCheck?.message).toContain('未定义任何检查点');
    });

    it('checkpoints 字段为 undefined 时应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-undefined-checkpoints',
        checkpoints: undefined,
      });

      const taskDir = path.join(tasksDir, 'TASK-undefined-checkpoints');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-undefined-checkpoints');

      const checkpointsExistCheck = result.checks.find(c => c.checkId === 'checkpoints-exist');
      expect(checkpointsExistCheck?.passed).toBe(false);
    });
  });

  describe('QA检查点识别逻辑', () => {
    it('通过 "qa" 关键词识别QA检查点', async () => {
      const task = createMockTask({
        id: 'TASK-qa-keyword',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证测试' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-qa-keyword');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-qa-keyword');

      expect(result.qaCheckpointCount).toBe(1);
      expect(result.qaCheckpoints[0].id).toBe('CP-001');
    });

    it('通过 "test" 关键词识别QA检查点', async () => {
      const task = createMockTask({
        id: 'TASK-test-keyword',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: 'unit test coverage check' }),
          createMockCheckpoint({ id: 'CP-002', description: '代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-test-keyword');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-test-keyword');

      expect(result.qaCheckpointCount).toBe(1);
      expect(result.qaCheckpoints[0].id).toBe('CP-001');
    });

    it('通过 "验证" 关键词识别QA检查点', async () => {
      const task = createMockTask({
        id: 'TASK-verify-keyword',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '功能验证' }),
          createMockCheckpoint({ id: 'CP-002', description: '代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-verify-keyword');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-verify-keyword');

      expect(result.qaCheckpointCount).toBe(1);
      expect(result.qaCheckpoints[0].id).toBe('CP-001');
    });

    it('通过 "quality" 关键词识别QA检查点', async () => {
      const task = createMockTask({
        id: 'TASK-quality-keyword',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: 'Quality gate check' }),
          createMockCheckpoint({ id: 'CP-002', description: '代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-quality-keyword');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-quality-keyword');

      expect(result.qaCheckpointCount).toBe(1);
      expect(result.qaCheckpoints[0].id).toBe('CP-001');
    });

    it('关键词匹配不区分大小写', async () => {
      const task = createMockTask({
        id: 'TASK-case-insensitive',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: 'QA Verification' }),
          createMockCheckpoint({ id: 'CP-002', description: 'TEST Coverage' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-case-insensitive');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-case-insensitive');

      expect(result.qaCheckpointCount).toBe(2);
    });

    it('无QA相关检查点时返回空列表', async () => {
      const task = createMockTask({
        id: 'TASK-no-qa',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai review] 代码审核' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 架构审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-no-qa');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-no-qa');

      expect(result.qaCheckpointCount).toBe(0);
      expect(result.qaCheckpoints).toEqual([]);
    });

    it('自定义关键词应该生效', async () => {
      const task = createMockTask({
        id: 'TASK-custom-keyword',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '自定义检查' }),
          createMockCheckpoint({ id: 'CP-002', description: '普通检查' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-custom-keyword');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { qaKeywords: ['自定义'] });
      const result = await checker.check('TASK-custom-keyword');

      expect(result.qaCheckpointCount).toBe(1);
      expect(result.qaCheckpoints[0].id).toBe('CP-001');
    });
  });

  describe('QA检查点定义检查', () => {
    it('有足够QA检查点时应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-enough-qa',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-enough-qa');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-enough-qa');

      const qaDefinedCheck = result.checks.find(c => c.checkId === 'qa-checkpoints-defined');
      expect(qaDefinedCheck?.passed).toBe(true);
      expect(qaDefinedCheck?.message).toContain('找到 1 个QA相关检查点');
    });

    it('QA检查点不足时应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-not-enough-qa',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai review] 代码审核' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 架构审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-not-enough-qa');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-not-enough-qa');

      const qaDefinedCheck = result.checks.find(c => c.checkId === 'qa-checkpoints-defined');
      expect(qaDefinedCheck?.passed).toBe(false);
      expect(qaDefinedCheck?.message).toContain('QA检查点不足');
    });

    it('requireQACheckpoints=false 时无QA检查点也应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-no-require-qa',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai review] 代码审核' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-no-require-qa');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { requireQACheckpoints: false });
      const result = await checker.check('TASK-no-require-qa');

      const qaDefinedCheck = result.checks.find(c => c.checkId === 'qa-checkpoints-defined');
      expect(qaDefinedCheck?.passed).toBe(true);
    });

    it('无检查点时应该返回相应消息', async () => {
      const task = createMockTask({
        id: 'TASK-no-cp-for-qa',
        checkpoints: [],
      });

      const taskDir = path.join(tasksDir, 'TASK-no-cp-for-qa');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-no-cp-for-qa');

      const qaDefinedCheck = result.checks.find(c => c.checkId === 'qa-checkpoints-defined');
      expect(qaDefinedCheck?.passed).toBe(false);
      expect(qaDefinedCheck?.message).toContain('未定义任何检查点');
    });
  });

  describe('QA检查点状态检查', () => {
    it('requireCorrectStatus=false 时跳过状态检查', async () => {
      const task = createMockTask({
        id: 'TASK-skip-status',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'failed' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-skip-status');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { requireCorrectStatus: false });
      const result = await checker.check('TASK-skip-status');

      const statusCheck = result.checks.find(c => c.checkId === 'qa-checkpoint-status');
      expect(statusCheck).toBeUndefined();
    });

    it('requireCorrectStatus=true 且无失败检查点时应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-status-ok',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai qa] 集成测试', status: 'pending' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-status-ok');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { requireCorrectStatus: true });
      const result = await checker.check('TASK-status-ok');

      const statusCheck = result.checks.find(c => c.checkId === 'qa-checkpoint-status');
      expect(statusCheck?.passed).toBe(true);
      expect(statusCheck?.message).toContain('状态正常');
    });

    it('requireCorrectStatus=true 且有失败检查点时应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-status-failed',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'failed' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai qa] 集成测试', status: 'completed' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-status-failed');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { requireCorrectStatus: true });
      const result = await checker.check('TASK-status-failed');

      const statusCheck = result.checks.find(c => c.checkId === 'qa-checkpoint-status');
      expect(statusCheck?.passed).toBe(false);
      expect(statusCheck?.message).toContain('存在问题');
    });

    it('无QA检查点时状态检查应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-no-qa-status',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai review] 代码审核', status: 'pending' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-no-qa-status');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir, { requireCorrectStatus: true });
      const result = await checker.check('TASK-no-qa-status');

      const statusCheck = result.checks.find(c => c.checkId === 'qa-checkpoint-status');
      expect(statusCheck?.passed).toBe(true);
      expect(statusCheck?.message).toContain('未找到QA检查点');
    });
  });

  describe('检查结果结构', () => {
    it('检查结果应包含所有必要字段', async () => {
      const task = createMockTask({
        id: 'TASK-structure',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-structure');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-structure');

      expect(result.taskId).toBe('TASK-structure');
      expect(typeof result.allPassed).toBe('boolean');
      expect(Array.isArray(result.checks)).toBe(true);
      expect(typeof result.passedCount).toBe('number');
      expect(typeof result.failedCount).toBe('number');
      expect(Array.isArray(result.qaCheckpoints)).toBe(true);
      expect(typeof result.qaCheckpointCount).toBe('number');
      expect(typeof result.totalCheckpointCount).toBe('number');
      expect(typeof result.duration).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });

    it('每个检查项应包含所有必要字段', async () => {
      const task = createMockTask({
        id: 'TASK-check-fields',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-check-fields');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-check-fields');

      for (const check of result.checks) {
        expect(typeof check.checkId).toBe('string');
        expect(typeof check.name).toBe('string');
        expect(typeof check.passed).toBe('boolean');
        expect(typeof check.message).toBe('string');
        expect(typeof check.duration).toBe('number');
        expect(typeof check.timestamp).toBe('string');
      }
    });

    it('passedCount 和 failedCount 应该正确计算', async () => {
      const task = createMockTask({
        id: 'TASK-count-check',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-count-check');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-count-check');

      const expectedPassed = result.checks.filter(c => c.passed).length;
      const expectedFailed = result.checks.filter(c => !c.passed).length;

      expect(result.passedCount).toBe(expectedPassed);
      expect(result.failedCount).toBe(expectedFailed);
    });

    it('qaCheckpointCount 和 totalCheckpointCount 应该正确', async () => {
      const task = createMockTask({
        id: 'TASK-cp-count',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 代码审核' }),
          createMockCheckpoint({ id: 'CP-003', description: '[ai qa] 集成测试' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-cp-count');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-cp-count');

      expect(result.totalCheckpointCount).toBe(3);
      expect(result.qaCheckpointCount).toBe(2);
    });
  });

  describe('配置管理', () => {
    it('应该能更新配置', () => {
      const checker = new QACheckpointsChecker(testDir);
      checker.updateConfig({ minQACheckpointCount: 5 });

      const config = checker.getConfig();
      expect(config.minQACheckpointCount).toBe(5);
    });

    it('获取配置不应影响原始配置', () => {
      const checker = new QACheckpointsChecker(testDir);
      const config = checker.getConfig();

      config.minQACheckpointCount = 99;

      const config2 = checker.getConfig();
      expect(config2.minQACheckpointCount).toBe(1);
    });
  });

  describe('便捷函数', () => {
    it('createQACheckpointsChecker 应该创建实例', () => {
      const checker = createQACheckpointsChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker).toBeInstanceOf(QACheckpointsChecker);
    });

    it('quickQACheckpointsCheck 应该返回结果', async () => {
      const task = createMockTask({
        id: 'TASK-quick',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-quick');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const result = await quickQACheckpointsCheck('TASK-quick', testDir);
      expect(result).toBeDefined();
      expect(result.taskId).toBe('TASK-quick');
    });

    it('batchQACheckpointsCheck 应该批量检查', async () => {
      const tasks = [
        { id: 'TASK-batch-1', checkpoints: [createMockCheckpoint({ description: '[ai qa] 测试1' })] },
        { id: 'TASK-batch-2', checkpoints: [createMockCheckpoint({ description: '[ai review] 审核' })] },
      ];

      for (const taskData of tasks) {
        const task = createMockTask(taskData);
        const taskDir = path.join(tasksDir, taskData.id);
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));
      }

      const results = await batchQACheckpointsCheck(['TASK-batch-1', 'TASK-batch-2'], testDir);
      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe('TASK-batch-1');
      expect(results[1].taskId).toBe('TASK-batch-2');
    });
  });

  describe('结果格式化', () => {
    it('formatQACheckpointsResult 应该返回格式化字符串', async () => {
      const task = createMockTask({
        id: 'TASK-format',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai review] 代码审核', status: 'pending' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-format');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-format');
      const formatted = formatQACheckpointsResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('TASK-format');
      expect(formatted).toContain('QA检查点定义检查');
      expect(formatted).toContain('检查结果');
    });

    it('通过结果的格式化应该包含通过图标', async () => {
      const task = createMockTask({
        id: 'TASK-format-pass',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'completed' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-format-pass');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-format-pass');
      const formatted = formatQACheckpointsResult(result);

      expect(formatted).toContain('✅');
    });

    it('失败结果的格式化应该包含错误信息', async () => {
      const task = createMockTask({
        id: 'TASK-format-fail',
        checkpoints: [],
      });

      const taskDir = path.join(tasksDir, 'TASK-format-fail');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-format-fail');
      const formatted = formatQACheckpointsResult(result);

      expect(formatted).toContain('❌');
      expect(formatted).toContain('未通过');
    });

    it('格式化应该包含QA检查点详情', async () => {
      const task = createMockTask({
        id: 'TASK-format-details',
        checkpoints: [
          createMockCheckpoint({ id: 'CP-001', description: '[ai qa] 功能验证', status: 'completed' }),
          createMockCheckpoint({ id: 'CP-002', description: '[ai qa] 集成测试', status: 'pending' }),
        ],
      });

      const taskDir = path.join(tasksDir, 'TASK-format-details');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));

      const checker = new QACheckpointsChecker(testDir);
      const result = await checker.check('TASK-format-details');
      const formatted = formatQACheckpointsResult(result);

      expect(formatted).toContain('QA相关检查点');
      expect(formatted).toContain('功能验证');
      expect(formatted).toContain('详细结果');
      expect(formatted).toContain('执行时长');
    });
  });

  describe('默认配置常量', () => {
    it('DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG 应该包含所有必要字段', () => {
      const config = DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG;

      expect(config.enabled).toBe(true);
      expect(config.requireQACheckpoints).toBe(true);
      expect(config.minQACheckpointCount).toBe(1);
      expect(Array.isArray(config.qaKeywords)).toBe(true);
      expect(config.qaKeywords.length).toBeGreaterThan(0);
      expect(config.allowGenericTestCheckpoints).toBe(true);
      expect(config.requireCorrectStatus).toBe(false);
    });

    it('默认关键词应该包含常见QA相关词汇', () => {
      const keywords = DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG.qaKeywords;

      expect(keywords).toContain('qa');
      expect(keywords).toContain('test');
      expect(keywords).toContain('验证');
      expect(keywords).toContain('质量');
      expect(keywords).toContain('quality');
      expect(keywords).toContain('verify');
      expect(keywords).toContain('validation');
      expect(keywords).toContain('验收');
    });
  });
});
