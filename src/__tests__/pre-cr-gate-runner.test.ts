/**
 * PreCRGateRunner 单元测试
 *
 * 测试代码审核前门禁协调器的核心功能:
 * - 规则引擎执行
 * - 结果聚合
 * - 门禁决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import {
  PreCRGateRunner,
  createPreCRGateRunner,
  quickPreCRGateCheck,
  batchPreCRGateCheck,
  DEFAULT_PRE_CR_GATE_RULES,
  DEFAULT_PRE_CR_GATE_RUNNER_CONFIG,
  type PreCRGateRunnerConfig,
  type PreCRGateRule,
  type PreCRGateRuleResult,
  type PreCRGateContext,
} from '../utils/pre-cr-gate/runner.js';
import type { TaskMeta } from '../types/task.js';
import {
  createIsolatedTestEnv,
  createTaskDir,
  writeTaskMeta,
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
    status: 'in_progress',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '测试检查点1', status: 'completed' },
      { id: 'CP-002', description: '测试检查点2', status: 'completed' },
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

describe('PreCRGateRunner', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'pre-cr-gate-test-' });
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const runner = new PreCRGateRunner(env.tempDir);
      expect(runner).toBeDefined();
      expect(runner.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const runner = new PreCRGateRunner(env.tempDir);
      const config = runner.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minQualityScore).toBe(70);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.requireAllCheckpoints).toBe(true);
      expect(config.requireArtifacts).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PreCRGateRunnerConfig> = {
        enabled: false,
        minQualityScore: 80,
        stopOnFailure: true,
      };

      const runner = new PreCRGateRunner(env.tempDir, customConfig);
      const config = runner.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.minQualityScore).toBe(80);
      expect(config.stopOnFailure).toBe(true);
    });
  });

  describe('规则执行', () => {
    it('应该执行所有启用规则', async () => {
      const taskId = 'TASK-test-001';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);

      expect(result.ruleResults.length).toBeGreaterThan(0);
      expect(result.passedRules + result.failedRules).toBe(result.ruleResults.length);
    });

    it('当禁用时应该直接通过', async () => {
      const runner = new PreCRGateRunner(env.tempDir, {
        enabled: false,
      });

      const result = await runner.run('TASK-test-001');

      expect(result.decision).toBe('PRE_CR_PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults.length).toBe(0);
    });

    it('任务不存在时应该失败', async () => {
      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run('TASK-non-existent');

      expect(result.decision).toBe('PRE_CR_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.failedRules).toBe(1);
    });
  });

  describe('任务状态规则', () => {
    it('in_progress状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        status: 'in_progress',
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(true);
    });

    it('wait_review状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        status: 'wait_review',
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(true);
    });

    it('open状态应该失败', async () => {
      const taskId = 'TASK-test-status';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        status: 'open',
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(false);
      expect(statusResult?.message).toContain('in_progress 或 wait_review');
    });
  });

  describe('检查点完成规则', () => {
    it('所有检查点完成应该通过', async () => {
      const taskId = 'TASK-test-checkpoints';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed' },
          { id: 'CP-002', description: '检查点2', status: 'completed' },
        ],
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'rule-checkpoints-complete');

      expect(checkpointResult?.passed).toBe(true);
    });

    it('存在未完成的检查点应该失败', async () => {
      const taskId = 'TASK-test-checkpoints';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        priority: 'P1', // required checkpoint policy
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed' },
          { id: 'CP-002', description: '检查点2', status: 'pending' },
        ],
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'rule-checkpoints-complete');

      expect(checkpointResult?.passed).toBe(false);
      expect(checkpointResult?.message).toContain('未完成');
    });

    it('checkpointPolicy为none时应该通过', async () => {
      const taskId = 'TASK-test-checkpoints';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        checkpointPolicy: 'none',
        checkpoints: [],
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'rule-checkpoints-complete');

      expect(checkpointResult?.passed).toBe(true);
    });
  });

  describe('开发产物规则', () => {
    it('文件存在应该通过', async () => {
      const taskId = 'TASK-test-artifacts';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        affected_files: ['src/test.ts'],
      }));

      // 创建测试文件
      const srcDir = path.join(env.tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const artifactResult = result.ruleResults.find(r => r.ruleId === 'rule-artifacts-exist');

      expect(artifactResult?.passed).toBe(true);
    });

    it('文件不存在应该警告（非阻塞）', async () => {
      const taskId = 'TASK-test-artifacts';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        affected_files: ['src/non-existent.ts'],
      }));

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const artifactResult = result.ruleResults.find(r => r.ruleId === 'rule-artifacts-exist');

      // artifacts_exist 是非阻塞规则，应该返回警告
      expect(artifactResult?.passed).toBe(false);
      expect(artifactResult?.message).toContain('不存在');
    });
  });

  describe('门禁决策', () => {
    it('所有规则通过应该返回PRE_CR_PASS', async () => {
      const taskId = 'TASK-test-pass';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      // 创建测试文件
      const srcDir = path.join(env.tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_CR_PASS');
      expect(result.allowed).toBe(true);
    });

    it('阻塞规则失败应该返回PRE_CR_FAIL', async () => {
      const taskId = 'TASK-test-fail';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        status: 'open', // 阻塞规则失败
      }));

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_CR_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });

    it('非阻塞规则失败应该返回PRE_CR_WARN', async () => {
      const taskId = 'TASK-test-warn';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        initQualityScore: 50, // 质量分数不足
        affected_files: ['src/test.ts'],
      }));

      // 创建测试文件以满足产物检查
      const srcDir = path.join(env.tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

      const runner = new PreCRGateRunner(env.tempDir, {
        rules: [DEFAULT_PRE_CR_GATE_RULES[3]], // 仅使用质量分数规则
        minQualityScore: 70,
      });

      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_CR_WARN');
      expect(result.warningCount).toBeGreaterThan(0);
    });
  });

  describe('报告生成', () => {
    it('应该生成报告', async () => {
      const taskId = 'TASK-test-report';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);
      const report = runner.generateReport(result);

      expect(report.reportId).toBeDefined();
      expect(report.taskId).toBe(taskId);
      expect(report.metadata.rulesExecuted).toBe(result.ruleResults.length);
    });

    it('失败时应该生成建议', async () => {
      const taskId = 'TASK-test-suggestions';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        status: 'open',
      }));

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);
      const report = runner.generateReport(result);

      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('通过时应该生成正面反馈', async () => {
      const taskId = 'TASK-test-success';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      // 创建测试文件以满足产物检查
      const srcDir = path.join(env.tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, 'test.ts'), 'export const test = 1;');

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);
      const report = runner.generateReport(result);

      const hasPositiveFeedback = report.recommendations.some(r =>
        r.includes('满足代码审核条件') || r.includes('✅')
      );
      expect(hasPositiveFeedback).toBe(true);
    });
  });

  describe('便捷函数', () => {
    it('createPreCRGateRunner应该创建实例', () => {
      const runner = createPreCRGateRunner(env.tempDir);
      expect(runner).toBeInstanceOf(PreCRGateRunner);
    });

    it('quickPreCRGateCheck应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const result = await quickPreCRGateCheck(taskId, env.tempDir);

      expect(result.taskId).toBe(taskId);
      expect(result.decision).toBeDefined();
    });

    it('batchPreCRGateCheck应该批量执行检查', async () => {
      const taskIds = ['TASK-test-batch-1', 'TASK-test-batch-2'];

      for (const taskId of taskIds) {
        createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));
      }

      const results = await batchPreCRGateCheck(taskIds, env.tempDir);

      expect(results.length).toBe(taskIds.length);
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const runner = new PreCRGateRunner(env.tempDir);

      runner.updateConfig({
        minQualityScore: 90,
        stopOnFailure: true,
      });

      const config = runner.getConfig();
      expect(config.minQualityScore).toBe(90);
      expect(config.stopOnFailure).toBe(true);
    });

    it('应该添加和移除规则', () => {
      const runner = new PreCRGateRunner(env.tempDir);

      const newRule: PreCRGateRule = {
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
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const runner = new PreCRGateRunner(env.tempDir);
      const result = await runner.run(taskId);
      const formatted = runner.formatResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('代码审核前门禁检查');
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_PRE_CR_GATE_RULES应该包含所有内置规则', () => {
    expect(DEFAULT_PRE_CR_GATE_RULES.length).toBeGreaterThan(0);
    expect(DEFAULT_PRE_CR_GATE_RULES.some(r => r.id === 'rule-task-status')).toBe(true);
    expect(DEFAULT_PRE_CR_GATE_RULES.some(r => r.id === 'rule-checkpoints-complete')).toBe(true);
    expect(DEFAULT_PRE_CR_GATE_RULES.some(r => r.id === 'rule-artifacts-exist')).toBe(true);
    expect(DEFAULT_PRE_CR_GATE_RULES.some(r => r.id === 'rule-quality-score')).toBe(true);
  });

  it('DEFAULT_PRE_CR_GATE_RUNNER_CONFIG应该包含默认配置', () => {
    expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG.minQualityScore).toBe(70);
    expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG.requireAllCheckpoints).toBe(true);
    expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG.requireArtifacts).toBe(true);
  });
});