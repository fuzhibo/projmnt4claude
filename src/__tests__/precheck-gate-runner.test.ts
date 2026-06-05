/**
 * PreCheckGateRunner 单元测试
 *
 * 测试预检测门禁协调器的核心功能:
 * - 规则引擎执行
 * - 结果聚合
 * - 门禁决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import {
  PreCheckGateRunner,
  createGateRunner,
  quickGateCheck,
  batchGateCheck,
  DEFAULT_GATE_RULES,
  DEFAULT_GATE_RUNNER_CONFIG,
  type GateRunnerConfig,
  type GateRule,
  type GateRuleResult,
  type GateContext,
} from '../utils/precheck-gate-runner.js';
import type { TaskMeta } from '../types/task.js';
import {
  createIsolatedTestEnv,
  createTaskDir,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述，长度足够长以满足要求，包含解决方案部分',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '测试检查点1', status: 'pending' },
      { id: 'CP-002', description: '测试检查点2', status: 'pending' },
    ],
    affected_files: ['src/test.ts'],
    initQualityScore: 95,
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

describe('PreCheckGateRunner', () => {
  let env: IsolatedTestEnv;
  let testDir: string;
  let tasksDir: string;

  beforeEach(async () => {
    // 创建隔离测试环境
    env = await createIsolatedTestEnv();
    testDir = env.tempDir;
    tasksDir = env.tasksDir;
  });

  afterEach(() => {
    // 清理测试环境
    env.cleanup();
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const runner = new PreCheckGateRunner(testDir);
      expect(runner).toBeDefined();
      expect(runner.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const runner = new PreCheckGateRunner(testDir);
      const config = runner.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minQualityScore).toBe(60);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.usePrecheckOrchestrator).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<GateRunnerConfig> = {
        enabled: false,
        minQualityScore: 80,
        stopOnFailure: true,
      };

      const runner = new PreCheckGateRunner(testDir, customConfig);
      const config = runner.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.minQualityScore).toBe(80);
      expect(config.stopOnFailure).toBe(true);
    });
  });

  describe('规则执行', () => {
    it('应该执行所有启用规则', async () => {
      const taskId = 'TASK-test-001';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);

      expect(result.ruleResults.length).toBeGreaterThan(0);
      expect(result.passedRules + result.failedRules).toBe(result.ruleResults.length);
    });

    it('当禁用时应该直接通过', async () => {
      const runner = new PreCheckGateRunner(testDir, {
        enabled: false,
      });

      const result = await runner.run('TASK-test-001');

      expect(result.decision).toBe('PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults.length).toBe(0);
    });

    it('任务不存在时应该失败', async () => {
      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run('TASK-non-existent');

      expect(result.decision).toBe('FAIL');
      expect(result.allowed).toBe(false);
      expect(result.failedRules).toBe(1);
    });
  });

  describe('元数据完整性规则', () => {
    it('完整元数据应该通过', async () => {
      const taskId = 'TASK-test-metadata';
      const task = createMockTask({
        id: taskId,
        title: '完整任务',
        description: '这是一个详细的任务描述，包含所有必要信息',
        type: 'feature',
        priority: 'P2',
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const metadataResult = result.ruleResults.find(r => r.ruleId === 'rule-metadata-complete');

      expect(metadataResult?.passed).toBe(true);
    });

    it('缺少标题应该失败', async () => {
      const taskId = 'TASK-test-no-title';
      const task = createMockTask({
        id: taskId,
        title: '',
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const metadataResult = result.ruleResults.find(r => r.ruleId === 'rule-metadata-complete');

      expect(metadataResult?.passed).toBe(false);
      expect(metadataResult?.message).toContain('标题');
    });

    it('描述太短应该失败', async () => {
      const taskId = 'TASK-test-short-desc';
      const task = createMockTask({
        id: taskId,
        description: '短',
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const metadataResult = result.ruleResults.find(r => r.ruleId === 'rule-metadata-complete');

      expect(metadataResult?.passed).toBe(false);
      expect(metadataResult?.message).toContain('描述');
    });
  });

  describe('检查点有效性规则', () => {
    it('有效检查点应该通过', async () => {
      const taskId = 'TASK-test-checkpoints';
      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'pending' },
          { id: 'CP-002', description: '检查点2', status: 'pending' },
        ],
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'rule-checkpoints-valid');

      expect(checkpointResult?.passed).toBe(true);
    });

    it('缺少检查点应该失败', async () => {
      const taskId = 'TASK-test-no-checkpoints';
      const task = createMockTask({
        id: taskId,
        type: 'bug',
        priority: 'P0',
        checkpoints: [],
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'rule-checkpoints-valid');

      expect(checkpointResult?.passed).toBe(false);
    });
  });

  describe('依赖就绪规则', () => {
    it('无依赖应该通过', async () => {
      const taskId = 'TASK-test-no-deps';
      const task = createMockTask({
        id: taskId,
        dependencies: [],
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const depResult = result.ruleResults.find(r => r.ruleId === 'rule-dependencies-ready');

      expect(depResult?.passed).toBe(true);
    });

    it('依赖不存在应该失败', async () => {
      const taskId = 'TASK-test-missing-dep';
      const task = createMockTask({
        id: taskId,
        dependencies: ['TASK-non-existent'],
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const depResult = result.ruleResults.find(r => r.ruleId === 'rule-dependencies-ready');

      expect(depResult?.passed).toBe(false);
    });

    it('完成的依赖应该通过', async () => {
      // 创建依赖任务
      const depId = 'TASK-dep-completed';
      const depTask = createMockTask({
        id: depId,
        status: 'resolved',
      });
      createTaskDir(tasksDir, depId, depTask);

      // 创建主任务
      const taskId = 'TASK-test-with-dep';
      const task = createMockTask({
        id: taskId,
        dependencies: [depId],
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const depResult = result.ruleResults.find(r => r.ruleId === 'rule-dependencies-ready');

      expect(depResult?.passed).toBe(true);
    });
  });

  describe('门禁决策', () => {
    it('所有规则通过应该返回PASS', async () => {
      const taskId = 'TASK-test-pass';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);

      expect(result.decision).toBe('PASS');
      expect(result.allowed).toBe(true);
    });

    it('阻塞规则失败应该返回FAIL', async () => {
      const taskId = 'TASK-test-fail';
      const task = createMockTask({
        id: taskId,
        title: '',
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);

      expect(result.decision).toBe('FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });

    it('非阻塞规则失败应该返回WARN', async () => {
      const taskId = 'TASK-test-warn';
      const task = createMockTask({
        id: taskId,
        description: '短',
        checkpoints: [],
        affected_files: undefined,
        initQualityScore: undefined,
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
        rules: [DEFAULT_GATE_RULES[3]],
        minQualityScore: 100,
      });

      const result = await runner.run(taskId);

      expect(result.decision).toBe('WARN');
      expect(result.warningCount).toBeGreaterThan(0);
    });
  });

  describe('报告生成', () => {
    it('应该生成报告', async () => {
      const taskId = 'TASK-test-report';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);
      const report = runner.generateReport(result);

      expect(report.reportId).toBeDefined();
      expect(report.taskId).toBe(taskId);
      expect(report.metadata.rulesExecuted).toBe(result.ruleResults.length);
    });

    it('失败时应该生成建议', async () => {
      const taskId = 'TASK-test-suggestions';
      const task = createMockTask({
        id: taskId,
        title: '',
      });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);
      const report = runner.generateReport(result);

      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('便捷函数', () => {
    it('createGateRunner应该创建实例', () => {
      const runner = createGateRunner(testDir);
      expect(runner).toBeInstanceOf(PreCheckGateRunner);
    });

    it('quickGateCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const result = await quickGateCheck(taskId, testDir, {
        usePrecheckOrchestrator: false,
      });

      expect(result.taskId).toBe(taskId);
      expect(result.decision).toBeDefined();
    });

    it('batchGateCheck应该批量执行检查', async () => {
      const taskIds = ['TASK-test-batch-1', 'TASK-test-batch-2'];

      for (const taskId of taskIds) {
        const task = createMockTask({ id: taskId });
        createTaskDir(tasksDir, taskId, task);
      }

      const results = await batchGateCheck(taskIds, testDir, {
        usePrecheckOrchestrator: false,
      });

      expect(results.length).toBe(taskIds.length);
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const runner = new PreCheckGateRunner(testDir);

      runner.updateConfig({
        minQualityScore: 90,
        stopOnFailure: true,
      });

      const config = runner.getConfig();
      expect(config.minQualityScore).toBe(90);
      expect(config.stopOnFailure).toBe(true);
    });

    it('应该添加和移除规则', () => {
      const runner = new PreCheckGateRunner(testDir);

      const newRule: GateRule = {
        id: 'rule-custom',
        type: 'custom',
        name: '自定义规则',
        description: '测试自定义规则',
        enabled: true,
        priority: 5,
        blocking: false,
      };

      runner.addRule(newRule);
      expect(runner.getConfig().rules.some(r => r.id === 'rule-custom')).toBe(true);

      runner.removeRule('rule-custom');
      expect(runner.getConfig().rules.some(r => r.id === 'rule-custom')).toBe(false);
    });
  });

  describe('格式化输出', () => {
    it('应该格式化结果为字符串', async () => {
      const taskId = 'TASK-test-format';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const runner = new PreCheckGateRunner(testDir, {
        usePrecheckOrchestrator: false,
      });

      const result = await runner.run(taskId);
      const formatted = runner.formatResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_GATE_RULES应该包含所有内置规则', () => {
    expect(DEFAULT_GATE_RULES.length).toBeGreaterThan(0);
    expect(DEFAULT_GATE_RULES.some(r => r.id === 'rule-metadata-complete')).toBe(true);
    expect(DEFAULT_GATE_RULES.some(r => r.id === 'rule-checkpoints-valid')).toBe(true);
  });

  it('DEFAULT_GATE_RUNNER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_GATE_RUNNER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_GATE_RUNNER_CONFIG.minQualityScore).toBe(60);
  });
});
