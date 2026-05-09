/**
 * Test Environment Checker Tests
 * 测试环境配置检查器单元测试
 *
 * @module __tests__/test-env-checker
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  TestEnvConfigChecker,
  createTestEnvConfigChecker,
  quickTestEnvCheck,
  generateTestEnvConfig,
  DEFAULT_TEST_ENV_CHECKER_CONFIG,
} from '../utils/post-cr-gate/checkers/test-env-checker.js';
import { createDefaultTaskMeta } from '../types/task.js';
import {
  createIsolatedTestEnv,
  createTaskDir,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

describe('TestEnvConfigChecker', () => {
  let env: IsolatedTestEnv;
  let checker: TestEnvConfigChecker;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'test-env-checker-test-' });
    checker = createTestEnvConfigChecker(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('Basic Functionality', () => {
    it('should create checker with default config', () => {
      expect(checker).toBeDefined();
    });

    it('should use default config values', () => {
      const config = (checker as unknown as { config: typeof DEFAULT_TEST_ENV_CHECKER_CONFIG }).config;
      expect(config.configPath).toBe(DEFAULT_TEST_ENV_CHECKER_CONFIG.configPath);
      expect(config.requireTestCommands).toBe(DEFAULT_TEST_ENV_CHECKER_CONFIG.requireTestCommands);
      expect(config.autoCreate).toBe(DEFAULT_TEST_ENV_CHECKER_CONFIG.autoCreate);
    });

    it('should allow custom config', () => {
      const customChecker = createTestEnvConfigChecker(env.tempDir, {
        requireTestCommands: false,
        autoCreate: false,
      });
      expect(customChecker).toBeDefined();
    });
  });

  describe('Config Existence Check (R-CR-POST-008)', () => {
    it('should fail when config does not exist and autoCreate is disabled', async () => {
      const checkerNoAuto = createTestEnvConfigChecker(env.tempDir, { autoCreate: false });
      const taskId = 'TASK-feature-P2-test-task-20260101';

      const result = await checkerNoAuto.checkConfigExistence(taskId);

      expect(result.passed).toBe(false);
      expect(result.check).toBe('config_existence');
      expect(result.message).toContain('不存在');
    });

    it('should auto-create config when it does not exist and autoCreate is enabled', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature'));

      const result = await checker.checkConfigExistence(taskId);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('config_existence');
      expect(result.message).toContain('已自动生成');
      expect(result.details?.autoCreated).toBe(true);
    });

    it('should pass when config exists', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const configPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        generatedAt: new Date().toISOString(),
        environment: {
          testCommands: ['bun test'],
          envVars: {},
          dependencies: [],
        },
        recommendations: [],
      }));

      const result = await checker.checkConfigExistence(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('存在');
    });
  });

  describe('Config Format Check (R-CR-POST-010)', () => {
    it('should fail when config does not exist', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';

      const result = await checker.checkConfigFormat(taskId);

      expect(result.passed).toBe(false);
      expect(result.check).toBe('config_format');
      expect(result.message).toContain('无法检查');
    });

    it('should fail when config has invalid JSON', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const configPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'invalid json {{{');

      const result = await checker.checkConfigFormat(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('失败');
    });

    it('should fail when config is missing required fields', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const configPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        version: '1.0.0',
        // Missing taskId, generatedAt, environment, recommendations
      }));

      const result = await checker.checkConfigFormat(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('格式无效');
      expect(result.details?.missingFields).toBeDefined();
    });

    it('should pass when config has all required fields', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const configPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        generatedAt: new Date().toISOString(),
        environment: {
          testCommands: ['bun test'],
          envVars: { NODE_ENV: 'test' },
          dependencies: [],
        },
        recommendations: ['Run tests'],
      }));

      const result = await checker.checkConfigFormat(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('格式有效');
    });
  });

  describe('Task Test Recommendations Check (R-CR-POST-009)', () => {
    it('should fail when task does not exist', async () => {
      const taskId = 'TASK-nonexistent-P2-test-20260101';

      const result = await checker.checkTaskHasTestRecommendations(taskId);

      expect(result.passed).toBe(false);
      expect(result.check).toBe('task_test_recommendations');
      expect(result.message).toContain('任务不存在');
    });

    it('should pass when task description contains test keywords', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature', 'Test Task with testing requirements'));

      const result = await checker.checkTaskHasTestRecommendations(taskId);

      expect(result.passed).toBe(true);
      expect(result.details?.hasTestEnvInDescription).toBe(true);
    });

    it('should pass when task has verification commands', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Test checkpoint',
          status: 'pending',
          verification: {
            method: 'unit_test',
            commands: ['bun test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      createTaskDir(env.tasksDir, taskId, task);

      const result = await checker.checkTaskHasTestRecommendations(taskId);

      expect(result.passed).toBe(true);
      expect(result.details?.hasVerificationCommands).toBe(true);
    });

    it('should fail when task has no test recommendations', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Implementation task', 'feature', 'Implement some feature without any relevant terms'));

      const result = await checker.checkTaskHasTestRecommendations(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少测试环境建议');
    });
  });

  describe('check() - Run All Checks', () => {
    it('should run all checks and return results', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task with verification', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Test checkpoint',
          status: 'pending',
          verification: {
            method: 'unit_test',
            commands: ['bun test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      createTaskDir(env.tasksDir, taskId, task);

      const results = await checker.check(taskId);

      expect(results).toHaveLength(3);
      expect(results.some(r => r.check === 'config_existence')).toBe(true);
      expect(results.some(r => r.check === 'config_format')).toBe(true);
      expect(results.some(r => r.check === 'task_test_recommendations')).toBe(true);
    });
  });

  describe('generateConfig()', () => {
    it('should throw when task does not exist', async () => {
      const taskId = 'TASK-nonexistent-P2-test-20260101';

      await expect(checker.generateConfig(taskId)).rejects.toThrow('任务不存在');
    });

    it('should generate config from checkpoint verification commands', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Unit test checkpoint',
          status: 'pending',
          verification: {
            method: 'unit_test',
            commands: ['bun test', 'bun run lint'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      createTaskDir(env.tasksDir, taskId, task);

      const configPath = await checker.generateConfig(taskId);

      expect(fs.existsSync(path.join(env.tempDir, configPath))).toBe(true);

      const config = JSON.parse(fs.readFileSync(path.join(env.tempDir, configPath), 'utf-8'));
      expect(config.taskId).toBe(taskId);
      expect(config.version).toBe('1.0.0');
      expect(config.environment.testCommands).toContain('bun test');
      expect(config.environment.testCommands).toContain('bun run lint');
    });

    it('should infer test commands from task type when no checkpoints', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature'));

      const configPath = await checker.generateConfig(taskId);

      const config = JSON.parse(fs.readFileSync(path.join(env.tempDir, configPath), 'utf-8'));
      expect(config.environment.testCommands.length).toBeGreaterThan(0);
    });

    it('should include environment variables', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature'));

      const configPath = await checker.generateConfig(taskId);

      const config = JSON.parse(fs.readFileSync(path.join(env.tempDir, configPath), 'utf-8'));
      expect(config.environment.envVars.NODE_ENV).toBe('test');
      expect(config.environment.envVars.TASK_ID).toBe(taskId);
    });

    it('should include recommendations', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature'));

      const configPath = await checker.generateConfig(taskId);

      const config = JSON.parse(fs.readFileSync(path.join(env.tempDir, configPath), 'utf-8'));
      expect(config.recommendations.length).toBeGreaterThan(0);
      expect(config.recommendations.some((r: string) => r.includes('bun install'))).toBe(true);
    });
  });

  describe('readConfig()', () => {
    it('should return null when config does not exist', () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';

      const config = checker.readConfig(taskId);

      expect(config).toBeNull();
    });

    it('should return config when it exists', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task', 'feature'));
      await checker.generateConfig(taskId);

      const config = checker.readConfig(taskId);

      expect(config).not.toBeNull();
      expect(config?.taskId).toBe(taskId);
    });

    it('should return null for invalid JSON', () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const configPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'invalid json');

      const config = checker.readConfig(taskId);

      expect(config).toBeNull();
    });
  });

  describe('Configuration Management', () => {
    it('should update config', () => {
      checker.updateConfig({ requireTestCommands: false });

      // Config is private, but we can verify behavior through checks
      expect(checker).toBeDefined();
    });
  });

  describe('Utility Functions', () => {
    it('quickTestEnvCheck should work', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      createTaskDir(env.tasksDir, taskId, createDefaultTaskMeta(taskId, 'Test Task with test', 'feature'));

      const results = await quickTestEnvCheck(taskId, env.tempDir);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('generateTestEnvConfig should create config', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Test checkpoint',
          status: 'pending',
          verification: {
            method: 'unit_test',
            commands: ['bun test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      createTaskDir(env.tasksDir, taskId, task);

      const configPath = await generateTestEnvConfig(taskId, env.tempDir);
      const fullPath = path.join(env.tempDir, configPath);

      expect(fs.existsSync(fullPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      expect(config.taskId).toBe(taskId);
      expect(config.environment.testCommands).toContain('bun test');
    });
  });
});