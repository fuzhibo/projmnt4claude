/**
 * TestConfigChecker 单元测试
 *
 * 测试测试环境配置检查器的核心功能:
 * - 配置存在性检查
 * - 测试类型检查
 * - 覆盖率配置检查
 * - harness 配置检查
 * - 测试文件存在性检查
 * - 配置管理
 * - 结果格式化
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  TestConfigChecker,
  createTestConfigChecker,
  quickTestConfigCheck,
  batchTestConfigCheck,
  formatTestConfigResult,
  DEFAULT_TEST_CONFIG_CHECKER_CONFIG,
  type TestConfigCheckerConfig,
} from '../../../utils/pre-qa-gate/checkers/test-config-checker.js';
import type { TaskMeta, TestConfig, HarnessConfig } from '../../../types/task.js';

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
    createdBy: 'test',
    schemaVersion: 6,
    ...overrides,
  };
}

function createMockTestConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    type: 'unit',
    testFiles: ['src/__tests__/example.test.ts'],
    coverage: {
      minLines: 80,
      minFunctions: 80,
      minBranches: 70,
    },
    ...overrides,
  };
}

function createMockHarnessConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    runner: 'bun',
    testCommand: 'bun test',
    coverage: true,
    timeout: 30000,
    ...overrides,
  };
}

describe('TestConfigChecker', () => {
  let testDir: string;
  let tasksDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/test-config-test-');
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
      const checker = new TestConfigChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new TestConfigChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.requireTestConfig).toBe(false);
      expect(config.requireHarnessConfig).toBe(false);
      expect(config.requireEitherConfig).toBe(true);
      expect(config.checkTestType).toBe(true);
      expect(config.checkTestCommand).toBe(true);
      expect(config.checkCoverageConfig).toBe(false);
      expect(config.minCoveragePercent).toBe(80);
      expect(config.validTestTypes).toContain('unit');
      expect(config.validTestTypes).toContain('integration');
      expect(config.validTestTypes).toContain('e2e');
      expect(config.validateTestFilesExist).toBe(false);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<TestConfigCheckerConfig> = {
        enabled: false,
        requireTestConfig: true,
        minCoveragePercent: 90,
      };
      const checker = new TestConfigChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.requireTestConfig).toBe(true);
      expect(config.minCoveragePercent).toBe(90);
      expect(config.requireHarnessConfig).toBe(false);
    });
  });

  describe('配置存在性检查', () => {
    it('任务不存在时应该返回失败', async () => {
      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-nonexistent');

      expect(result.allPassed).toBe(false);
      expect(result.failedCount).toBe(1);
      expect(result.checks[0].checkId).toBe('task-existence');
    });

    it('同时配置 testConfig 和 harness 应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-test-001',
        testConfig: createMockTestConfig(),
        harness: createMockHarnessConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-001');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-001');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(true);
      expect(configExistsCheck?.message).toContain('已配置 testConfig 和 harness');
    });

    it('仅配置 testConfig 应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-test-002',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-002');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-002');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(true);
      expect(configExistsCheck?.message).toContain('已配置 testConfig');
    });

    it('仅配置 harness 应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-test-003',
        harness: createMockHarnessConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-003');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-003');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(true);
      expect(configExistsCheck?.message).toContain('已配置 harness');
    });

    it('未配置任何测试配置时应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-004',
      });

      const taskDir = path.join(tasksDir, 'TASK-test-004');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-004');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(false);
      expect(configExistsCheck?.message).toContain('未配置 testConfig 或 harness');
    });

    it('requireTestConfig=true 时无 testConfig 应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-005',
        harness: createMockHarnessConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-005');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { requireTestConfig: true });
      const result = await checker.check('TASK-test-005');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(false);
      expect(configExistsCheck?.message).toContain('未配置 testConfig');
    });

    it('requireHarnessConfig=true 时无 harness 应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-006',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-006');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { requireHarnessConfig: true });
      const result = await checker.check('TASK-test-006');

      const configExistsCheck = result.checks.find(c => c.checkId === 'config-exists');
      expect(configExistsCheck?.passed).toBe(false);
      expect(configExistsCheck?.message).toContain('未配置 harness');
    });
  });

  describe('测试类型检查', () => {
    it('有效的测试类型应该通过', async () => {
      const validTypes = ['unit', 'integration', 'e2e', 'benchmark', 'contract', 'performance'];

      for (const testType of validTypes) {
        const taskId = `TASK-test-type-${testType}`;
        const task = createMockTask({
          id: taskId,
          testConfig: createMockTestConfig({ type: testType as any }),
        });

        const taskDir = path.join(tasksDir, taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(task, null, 2)
        );

        const checker = new TestConfigChecker(testDir);
        const result = await checker.check(taskId);

        const testTypeCheck = result.checks.find(c => c.checkId === 'test-type');
        expect(testTypeCheck?.passed).toBe(true);
        expect(testTypeCheck?.message).toContain(`测试类型有效: ${testType}`);
      }
    });

    it('无效的测试类型应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-invalid-type',
        testConfig: createMockTestConfig({ type: 'invalid-type' as any }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-invalid-type');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-invalid-type');

      const testTypeCheck = result.checks.find(c => c.checkId === 'test-type');
      expect(testTypeCheck?.passed).toBe(false);
      expect(testTypeCheck?.message).toContain('无效的测试类型');
    });

    it('未指定测试类型时应该通过（checkTestType=false）', async () => {
      const task = createMockTask({
        id: 'TASK-test-no-type',
        testConfig: createMockTestConfig({ type: undefined }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-no-type');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkTestType: false });
      const result = await checker.check('TASK-test-no-type');

      const testTypeCheck = result.checks.find(c => c.checkId === 'test-type');
      expect(testTypeCheck?.passed).toBe(true);
    });

    it('未指定测试类型时应该失败（checkTestType=true）', async () => {
      const task = createMockTask({
        id: 'TASK-test-no-type-strict',
        testConfig: createMockTestConfig({ type: undefined }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-no-type-strict');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkTestType: true });
      const result = await checker.check('TASK-test-no-type-strict');

      const testTypeCheck = result.checks.find(c => c.checkId === 'test-type');
      expect(testTypeCheck?.passed).toBe(false);
      expect(testTypeCheck?.message).toContain('未指定测试类型');
    });
  });

  describe('覆盖率配置检查', () => {
    it('满足最低覆盖率要求应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-test-coverage-ok',
        testConfig: createMockTestConfig({
          coverage: { minLines: 85 },
        }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-coverage-ok');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkCoverageConfig: true });
      const result = await checker.check('TASK-test-coverage-ok');

      const coverageCheck = result.checks.find(c => c.checkId === 'coverage-config');
      expect(coverageCheck?.passed).toBe(true);
      expect(coverageCheck?.message).toContain('覆盖率配置有效');
    });

    it('低于最低覆盖率要求应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-coverage-low',
        testConfig: createMockTestConfig({
          coverage: { minLines: 50 },
        }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-coverage-low');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkCoverageConfig: true });
      const result = await checker.check('TASK-test-coverage-low');

      const coverageCheck = result.checks.find(c => c.checkId === 'coverage-config');
      expect(coverageCheck?.passed).toBe(false);
      expect(coverageCheck?.message).toContain('覆盖率要求过低');
    });

    it('未配置覆盖率时应该通过（checkCoverageConfig=false）', async () => {
      const task = createMockTask({
        id: 'TASK-test-no-coverage',
        testConfig: createMockTestConfig({ coverage: undefined }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-no-coverage');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkCoverageConfig: false });
      const result = await checker.check('TASK-test-no-coverage');

      const coverageCheck = result.checks.find(c => c.checkId === 'coverage-config');
      expect(coverageCheck?.passed).toBe(true);
    });

    it('未配置覆盖率时应该失败（checkCoverageConfig=true）', async () => {
      const task = createMockTask({
        id: 'TASK-test-no-coverage-strict',
        testConfig: createMockTestConfig({ coverage: undefined }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-no-coverage-strict');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkCoverageConfig: true });
      const result = await checker.check('TASK-test-no-coverage-strict');

      const coverageCheck = result.checks.find(c => c.checkId === 'coverage-config');
      expect(coverageCheck?.passed).toBe(false);
      expect(coverageCheck?.message).toContain('未配置覆盖率要求');
    });
  });

  describe('Harness 配置检查', () => {
    it('完整的 harness 配置应该通过', async () => {
      const task = createMockTask({
        id: 'TASK-test-harness-full',
        harness: createMockHarnessConfig({
          runner: 'bun',
          testCommand: 'bun test',
          coverage: true,
        }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-harness-full');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-test-harness-full');

      const harnessCheck = result.checks.find(c => c.checkId === 'harness-config');
      expect(harnessCheck?.passed).toBe(true);
      expect(harnessCheck?.message).toContain('Harness 配置有效');
    });

    it('缺少 testCommand 应该失败（checkTestCommand=true）', async () => {
      const task = createMockTask({
        id: 'TASK-test-harness-no-cmd',
        harness: createMockHarnessConfig({ testCommand: undefined }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-harness-no-cmd');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { checkTestCommand: true });
      const result = await checker.check('TASK-test-harness-no-cmd');

      const harnessCheck = result.checks.find(c => c.checkId === 'harness-config');
      expect(harnessCheck?.passed).toBe(false);
      expect(harnessCheck?.message).toContain('未配置 testCommand');
    });
  });

  describe('测试文件存在性检查', () => {
    it('所有测试文件存在应该通过', async () => {
      const testFileDir = path.join(testDir, 'src', '__tests__');
      fs.mkdirSync(testFileDir, { recursive: true });
      fs.writeFileSync(path.join(testFileDir, 'example.test.ts'), '');

      const task = createMockTask({
        id: 'TASK-test-files-exist',
        testConfig: createMockTestConfig({
          testFiles: ['src/__tests__/example.test.ts'],
        }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-files-exist');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { validateTestFilesExist: true });
      const result = await checker.check('TASK-test-files-exist');

      const filesCheck = result.checks.find(c => c.checkId === 'test-files-exist');
      expect(filesCheck?.passed).toBe(true);
      expect(filesCheck?.message).toContain('所有测试文件存在');
    });

    it('测试文件不存在应该失败', async () => {
      const task = createMockTask({
        id: 'TASK-test-files-missing',
        testConfig: createMockTestConfig({
          testFiles: ['src/__tests__/nonexistent.test.ts'],
        }),
      });

      const taskDir = path.join(tasksDir, 'TASK-test-files-missing');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { validateTestFilesExist: true });
      const result = await checker.check('TASK-test-files-missing');

      const filesCheck = result.checks.find(c => c.checkId === 'test-files-exist');
      expect(filesCheck?.passed).toBe(false);
      expect(filesCheck?.message).toContain('缺少测试文件');
    });

    it('从 task.files 中提取测试文件', async () => {
      const testFileDir = path.join(testDir, 'src');
      fs.mkdirSync(testFileDir, { recursive: true });
      fs.writeFileSync(path.join(testFileDir, 'utils.spec.ts'), '');

      const task = createMockTask({
        id: 'TASK-test-files-from-task',
        testConfig: createMockTestConfig({ testFiles: [] }),
        files: ['src/utils.spec.ts', 'src/main.ts'],
      });

      const taskDir = path.join(tasksDir, 'TASK-test-files-from-task');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir, { validateTestFilesExist: true });
      const result = await checker.check('TASK-test-files-from-task');

      const filesCheck = result.checks.find(c => c.checkId === 'test-files-exist');
      expect(filesCheck?.passed).toBe(true);
    });
  });

  describe('配置管理', () => {
    it('应该能更新配置', () => {
      const checker = new TestConfigChecker(testDir);
      checker.updateConfig({ minCoveragePercent: 90 });

      const config = checker.getConfig();
      expect(config.minCoveragePercent).toBe(90);
    });

    it('获取配置不应影响原始配置', () => {
      const checker = new TestConfigChecker(testDir);
      const config = checker.getConfig();

      config.minCoveragePercent = 95;

      const config2 = checker.getConfig();
      expect(config2.minCoveragePercent).toBe(80);
    });
  });

  describe('便捷函数', () => {
    it('createTestConfigChecker 应该创建实例', () => {
      const checker = createTestConfigChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker).toBeInstanceOf(TestConfigChecker);
    });

    it('quickTestConfigCheck 应该返回结果', async () => {
      const task = createMockTask({
        id: 'TASK-quick-test',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-quick-test');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const result = await quickTestConfigCheck('TASK-quick-test', testDir);
      expect(result).toBeDefined();
      expect(result.taskId).toBe('TASK-quick-test');
    });

    it('batchTestConfigCheck 应该批量检查', async () => {
      const tasks = [
        { id: 'TASK-batch-1', testConfig: createMockTestConfig() },
        { id: 'TASK-batch-2', harness: createMockHarnessConfig() },
      ];

      for (const taskData of tasks) {
        const task = createMockTask(taskData);
        const taskDir = path.join(tasksDir, taskData.id);
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(task, null, 2)
        );
      }

      const results = await batchTestConfigCheck(['TASK-batch-1', 'TASK-batch-2'], testDir);
      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe('TASK-batch-1');
      expect(results[1].taskId).toBe('TASK-batch-2');
    });
  });

  describe('结果格式化', () => {
    it('formatTestConfigResult 应该返回格式化字符串', async () => {
      const task = createMockTask({
        id: 'TASK-format-test',
        testConfig: createMockTestConfig(),
        harness: createMockHarnessConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-format-test');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-format-test');
      const formatted = formatTestConfigResult(result);

      expect(formatted).toContain('测试环境配置检查');
      expect(formatted).toContain('TASK-format-test');
      expect(formatted).toContain('TestConfig 配置');
      expect(formatted).toContain('Harness 配置');
    });

    it('失败结果的格式化应该包含错误信息', async () => {
      const task = createMockTask({
        id: 'TASK-format-fail',
        testConfig: createMockTestConfig({ type: 'invalid' as any }),
      });

      const taskDir = path.join(tasksDir, 'TASK-format-fail');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-format-fail');
      const formatted = formatTestConfigResult(result);

      expect(formatted).toContain('❌');
      expect(formatted).toContain('未通过');
    });
  });

  describe('默认配置常量', () => {
    it('DEFAULT_TEST_CONFIG_CHECKER_CONFIG 应该包含所有必要字段', () => {
      const config = DEFAULT_TEST_CONFIG_CHECKER_CONFIG;

      expect(config.enabled).toBeDefined();
      expect(config.requireTestConfig).toBeDefined();
      expect(config.requireHarnessConfig).toBeDefined();
      expect(config.requireEitherConfig).toBeDefined();
      expect(config.checkTestType).toBeDefined();
      expect(config.checkTestCommand).toBeDefined();
      expect(config.checkCoverageConfig).toBeDefined();
      expect(config.minCoveragePercent).toBeDefined();
      expect(config.validTestTypes).toBeDefined();
      expect(config.validateTestFilesExist).toBeDefined();

      expect(Array.isArray(config.validTestTypes)).toBe(true);
      expect(config.validTestTypes.length).toBeGreaterThan(0);
    });
  });

  describe('检查结果结构', () => {
    it('检查结果应包含所有必要字段', async () => {
      const task = createMockTask({
        id: 'TASK-structure-test',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-structure-test');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-structure-test');

      expect(result.taskId).toBeDefined();
      expect(result.allPassed).toBeDefined();
      expect(result.checks).toBeDefined();
      expect(result.passedCount).toBeDefined();
      expect(result.failedCount).toBeDefined();
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('每个检查项应包含所有必要字段', async () => {
      const task = createMockTask({
        id: 'TASK-check-structure',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-check-structure');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-check-structure');

      for (const check of result.checks) {
        expect(check.checkId).toBeDefined();
        expect(check.name).toBeDefined();
        expect(check.passed).toBeDefined();
        expect(check.message).toBeDefined();
        expect(check.duration).toBeDefined();
        expect(check.timestamp).toBeDefined();
      }
    });

    it('passedCount 和 failedCount 应该正确计算', async () => {
      const task = createMockTask({
        id: 'TASK-count-test',
        testConfig: createMockTestConfig(),
      });

      const taskDir = path.join(tasksDir, 'TASK-count-test');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check('TASK-count-test');

      const expectedPassed = result.checks.filter(c => c.passed).length;
      const expectedFailed = result.checks.filter(c => !c.passed).length;

      expect(result.passedCount).toBe(expectedPassed);
      expect(result.failedCount).toBe(expectedFailed);
    });
  });

  describe('P11 测试环境配置检查 (R-QA-PRE-003)', () => {
    // 辅助函数：创建 P11 测试环境配置文件
    function createTestEnvConfig(
      taskId: string,
      overrides: Partial<{
        version: string;
        taskId: string;
        environment: { testCommands: string[]; envVars: Record<string, string>; dependencies: string[] };
        recommendations: string[];
        prerequisites: { commands?: string[]; envVars?: string[]; services?: string[] };
      }> = {}
    ): void {
      const outputsDir = path.join(testDir, '.projmnt4claude', 'outputs', taskId);
      fs.mkdirSync(outputsDir, { recursive: true });

      const config = {
        version: '1.0.0',
        taskId: overrides.taskId ?? taskId,
        generatedAt: new Date().toISOString(),
        environment: {
          testCommands: ['bun test', 'bun run build'],
          envVars: { NODE_ENV: 'test' },
          dependencies: [],
        },
        recommendations: ['运行 bun install 安装依赖', '执行 bun test 运行测试'],
        ...overrides,
      };

      fs.writeFileSync(
        path.join(outputsDir, 'tasks_test_env_adv.json'),
        JSON.stringify(config, null, 2)
      );
    }

    it('R-QA-PRE-003: 配置文件存在时应该通过', async () => {
      const taskId = 'TASK-p11-exists';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId);

      const checker = new TestConfigChecker(testDir, { requireTestEnvConfig: true });
      const result = await checker.check(taskId);

      const configExistsCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003');
      expect(configExistsCheck?.passed).toBe(true);
      expect(configExistsCheck?.message).toContain('存在');
    });

    it('R-QA-PRE-003: 配置文件不存在且要求时应该失败', async () => {
      const taskId = 'TASK-p11-missing';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      // 不创建配置文件

      const checker = new TestConfigChecker(testDir, { requireTestEnvConfig: true });
      const result = await checker.check(taskId);

      const configExistsCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003');
      expect(configExistsCheck?.passed).toBe(false);
      expect(configExistsCheck?.message).toContain('不存在');
      expect(configExistsCheck?.severity).toBe('error');
    });

    it('R-QA-PRE-003a: 配置格式有效时应该通过', async () => {
      const taskId = 'TASK-p11-valid-format';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId);

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const formatCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003a-format');
      expect(formatCheck?.passed).toBe(true);
      expect(formatCheck?.message).toContain('格式有效');
    });

    it('R-QA-PRE-003a: 配置格式无效时应该失败', async () => {
      const taskId = 'TASK-p11-invalid-format';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      // 创建缺少必要字段的配置
      const outputsDir = path.join(testDir, '.projmnt4claude', 'outputs', taskId);
      fs.mkdirSync(outputsDir, { recursive: true });
      fs.writeFileSync(
        path.join(outputsDir, 'tasks_test_env_adv.json'),
        JSON.stringify({ version: '1.0.0' }) // 缺少必要字段
      );

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const formatCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003a-format');
      expect(formatCheck?.passed).toBe(false);
      expect(formatCheck?.message).toContain('格式无效');
    });

    it('R-QA-PRE-003a: 任务建议完整时应该通过', async () => {
      const taskId = 'TASK-p11-has-recommendations';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId, {
        recommendations: ['建议1', '建议2'],
        environment: {
          testCommands: ['bun test'],
          envVars: {},
          dependencies: [],
        },
      });

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const recCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003a-recommendations');
      expect(recCheck?.passed).toBe(true);
      expect(recCheck?.message).toContain('完整');
    });

    it('R-QA-PRE-003a: 任务建议缺失时应该失败', async () => {
      const taskId = 'TASK-p11-no-recommendations';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId, {
        recommendations: [], // 空建议
        environment: {
          testCommands: [], // 空测试命令
          envVars: {},
          dependencies: [],
        },
      });

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const recCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003a-recommendations');
      expect(recCheck?.passed).toBe(false);
      expect(recCheck?.message).toContain('不完整');
    });

    it('R-QA-PRE-003a: 任务ID不匹配时应该失败', async () => {
      const taskId = 'TASK-p11-mismatch';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId, { taskId: 'OTHER-TASK-ID' }); // 创建不匹配的任务ID

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const recCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-003a-recommendations');
      expect(recCheck?.passed).toBe(false);
      expect(recCheck?.message).toContain('不匹配');
    });

    it('R-QA-PRE-007: 无 prerequisites 时应该通过', async () => {
      const taskId = 'TASK-p11-no-prereq';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId); // 无 prerequisites

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      const prereqCheck = result.checks.find(c => c.checkId === 'R-QA-PRE-007');
      expect(prereqCheck?.passed).toBe(true);
      expect(prereqCheck?.severity).toBe('info');
    });

    it('反馈信息应该包含 P11 反馈建议', async () => {
      const taskId = 'TASK-p11-feedback';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      // 不创建配置文件，触发反馈

      const checker = new TestConfigChecker(testDir, { requireTestEnvConfig: true });
      const result = await checker.check(taskId);

      expect(result.feedback).toBeDefined();
      expect(result.feedback?.needsP11Feedback).toBe(true);
      expect(result.feedback?.reasons.length).toBeGreaterThan(0);
      expect(result.feedback?.suggestedActions.length).toBeGreaterThan(0);
    });

    it('检查结果应该包含 P11 配置信息', async () => {
      const taskId = 'TASK-p11-config-info';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId);

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.testEnvConfigPath).toBeDefined();
      expect(result.testEnvConfig).toBeDefined();
      expect(result.testEnvConfig?.version).toBe('1.0.0');
      expect(result.testEnvConfig?.taskId).toBe(taskId);
    });

    it('格式化输出应该包含 P11 配置信息', async () => {
      const taskId = 'TASK-p11-format';
      const task = createMockTask({ id: taskId });

      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task, null, 2)
      );

      createTestEnvConfig(taskId);

      const checker = new TestConfigChecker(testDir);
      const result = await checker.check(taskId);
      const formatted = formatTestConfigResult(result);

      expect(formatted).toContain('P11 测试环境配置');
      expect(formatted).toContain('P11 测试环境配置检查');
    });

    it('默认配置应该包含 P11 相关配置项', () => {
      const config = DEFAULT_TEST_CONFIG_CHECKER_CONFIG;

      expect(config.testEnvConfigPath).toBeDefined();
      expect(config.requireTestEnvConfig).toBe(true);
      expect(config.checkConfigFormat).toBe(true);
      expect(config.checkTaskRecommendations).toBe(true);
      expect(config.checkPrerequisites).toBe(true);
      expect(config.enableP11Feedback).toBe(true);
    });
  });
});
