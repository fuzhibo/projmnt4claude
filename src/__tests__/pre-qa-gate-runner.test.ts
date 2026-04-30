/**
 * PreQAGateRunner 单元测试
 *
 * 测试QA验证阶段前门禁协调器的核心功能:
 * - 规则引擎执行
 * - 结果聚合
 * - 门禁决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  PreQAGateRunner,
  createPreQAGateRunner,
  quickPreQAGateCheck,
  batchPreQAGateCheck,
  DEFAULT_PRE_QA_GATE_RULES,
  DEFAULT_PRE_QA_GATE_RUNNER_CONFIG,
  type PreQAGateRunnerConfig,
  type PreQAGateRule,
  type PreQAGateRuleResult,
  type PreQAGateContext,
} from '../utils/pre-qa-gate/runner.js';
import type { TaskMeta } from '../types/task.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述',
    type: 'feature',
    priority: 'P2',
    status: 'wait_qa',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', name: 'QA验证检查点1', description: '功能测试', status: 'pending' },
      { id: 'CP-002', name: 'QA验证检查点2', description: '回归测试', status: 'pending' },
      { id: 'CP-003', name: '开发检查点', description: '代码实现', status: 'completed' },
    ],
    affected_files: ['src/test.ts'],
    reports: [
      { type: 'code_review', name: '代码审核报告', path: 'reports/code-review.md' },
    ],
    testConfig: {
      type: 'unit',
      coverage: {
        minLines: 80,
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [
      { timestamp: new Date().toISOString(), field: 'status', oldValue: 'wait_review', newValue: 'cr_passed' },
    ],
    createdBy: 'test',
    schemaVersion: 6,
    ...overrides,
  };
}

describe('PreQAGateRunner', () => {
  let testDir: string;
  let tasksDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/pre-qa-gate-test-');
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
      const runner = new PreQAGateRunner(testDir);
      expect(runner).toBeDefined();
      expect(runner.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const runner = new PreQAGateRunner(testDir);
      const config = runner.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.requireCodeReviewPass).toBe(true);
      expect(config.requireQACheckpoints).toBe(true);
      expect(config.requireTestConfig).toBe(true);
      expect(config.requireReviewReport).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PreQAGateRunnerConfig> = {
        enabled: false,
        stopOnFailure: true,
        requireCodeReviewPass: false,
      };

      const runner = new PreQAGateRunner(testDir, customConfig);
      const config = runner.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.stopOnFailure).toBe(true);
      expect(config.requireCodeReviewPass).toBe(false);
    });
  });

  describe('规则执行', () => {
    it('应该执行所有启用规则', async () => {
      const taskId = 'TASK-test-001';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const result = await runner.run(taskId);

      expect(result.ruleResults.length).toBeGreaterThan(0);
      expect(result.passedRules + result.failedRules).toBe(result.ruleResults.length);
    });

    it('当禁用时应该直接通过', async () => {
      const runner = new PreQAGateRunner(testDir, {
        enabled: false,
      });

      const result = await runner.run('TASK-test-001');

      expect(result.decision).toBe('PRE_QA_PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults.length).toBe(0);
    });

    it('任务不存在时应该失败', async () => {
      const runner = new PreQAGateRunner(testDir);
      const result = await runner.run('TASK-non-existent');

      expect(result.decision).toBe('PRE_QA_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.failedRules).toBe(1);
    });
  });

  describe('任务状态规则', () => {
    it('wait_qa状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(true);
    });

    it('cr_passed状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'cr_passed',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(true);
    });

    it('pending状态不应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'pending',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[0]],
      });

      const result = await runner.run(taskId);
      const statusResult = result.ruleResults.find(r => r.ruleId === 'rule-task-status');

      expect(statusResult?.passed).toBe(false);
    });
  });

  describe('代码审核通过规则', () => {
    it('代码审核通过状态应该通过', async () => {
      const taskId = 'TASK-test-cr';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'cr_passed',
        requirementHistory: [
          { timestamp: new Date().toISOString(), field: 'status', oldValue: 'wait_review', newValue: 'cr_passed' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const crResult = result.ruleResults.find(r => r.ruleId === 'rule-code-review-pass');

      expect(crResult?.passed).toBe(true);
    });

    it('qualityGate标记通过应该通过', async () => {
      const taskId = 'TASK-test-cr';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [],
        qualityGate: {
          codeReviewPass: true,
          crPhasePass: true,
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const crResult = result.ruleResults.find(r => r.ruleId === 'rule-code-review-pass');

      expect(crResult?.passed).toBe(true);
    });

    it('无审核记录应该失败', async () => {
      const taskId = 'TASK-test-cr';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'in_progress',
        requirementHistory: [],
        qualityGate: {},
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[1]],
      });

      const result = await runner.run(taskId);
      const crResult = result.ruleResults.find(r => r.ruleId === 'rule-code-review-pass');

      expect(crResult?.passed).toBe(false);
    });
  });

  describe('QA检查点定义规则', () => {
    it('存在QA检查点应该通过', async () => {
      const taskId = 'TASK-test-cp';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', name: '功能测试验证', description: '功能测试', status: 'pending' },
          { id: 'CP-002', name: '开发检查点', description: '代码实现', status: 'completed' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const cpResult = result.ruleResults.find(r => r.ruleId === 'rule-qa-checkpoints-defined');

      expect(cpResult?.passed).toBe(true);
    });

    it('无QA相关检查点应该失败', async () => {
      const taskId = 'TASK-test-cp';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', name: '开发检查点1', description: '代码实现', status: 'completed' },
          { id: 'CP-002', name: '开发检查点2', description: '文档编写', status: 'completed' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const cpResult = result.ruleResults.find(r => r.ruleId === 'rule-qa-checkpoints-defined');

      expect(cpResult?.passed).toBe(false);
    });

    it('无检查点应该失败', async () => {
      const taskId = 'TASK-test-cp';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        checkpoints: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[2]],
      });

      const result = await runner.run(taskId);
      const cpResult = result.ruleResults.find(r => r.ruleId === 'rule-qa-checkpoints-defined');

      expect(cpResult?.passed).toBe(false);
    });
  });

  describe('测试配置就绪规则', () => {
    it('存在testConfig应该通过', async () => {
      const taskId = 'TASK-test-config';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        testConfig: {
          type: 'unit',
          coverage: {
            minLines: 80,
          },
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[3]],
      });

      const result = await runner.run(taskId);
      const configResult = result.ruleResults.find(r => r.ruleId === 'rule-test-config-ready');

      expect(configResult?.passed).toBe(true);
    });

    it('存在harness配置应该通过', async () => {
      const taskId = 'TASK-test-config';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        testConfig: undefined,
        harness: {
          runner: 'bun',
          testCommand: 'bun test',
          coverage: true,
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[3]],
      });

      const result = await runner.run(taskId);
      const configResult = result.ruleResults.find(r => r.ruleId === 'rule-test-config-ready');

      expect(configResult?.passed).toBe(true);
    });

    it('无测试配置应该失败', async () => {
      const taskId = 'TASK-test-config';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        testConfig: undefined,
        harness: undefined,
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[3]],
      });

      const result = await runner.run(taskId);
      const configResult = result.ruleResults.find(r => r.ruleId === 'rule-test-config-ready');

      expect(configResult?.passed).toBe(false);
    });
  });

  describe('审核报告存在性规则', () => {
    it('存在审核报告应该通过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        reports: [
          { type: 'code_review', name: '代码审核报告', path: 'reports/code-review.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[4]],
      });

      const result = await runner.run(taskId);
      const reportResult = result.ruleResults.find(r => r.ruleId === 'rule-review-report-exist');

      expect(reportResult?.passed).toBe(true);
    });

    it('无审核报告应该失败', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        reports: [
          { type: 'other', name: '其他报告', path: 'reports/other.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[4]],
      });

      const result = await runner.run(taskId);
      const reportResult = result.ruleResults.find(r => r.ruleId === 'rule-review-report-exist');

      expect(reportResult?.passed).toBe(false);
    });

    it('无报告配置应该失败', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        reports: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir, {
        rules: [DEFAULT_PRE_QA_GATE_RULES[4]],
      });

      const result = await runner.run(taskId);
      const reportResult = result.ruleResults.find(r => r.ruleId === 'rule-review-report-exist');

      expect(reportResult?.passed).toBe(false);
    });
  });

  describe('门禁决策', () => {
    it('全部通过应该返回PRE_QA_PASS', async () => {
      const taskId = 'TASK-test-decision';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_QA_PASS');
      expect(result.allowed).toBe(true);
    });

    it('阻塞规则失败应该返回PRE_QA_FAIL', async () => {
      const taskId = 'TASK-test-decision';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'pending', // 无效状态
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_QA_FAIL');
      expect(result.allowed).toBe(false);
    });

    it('非阻塞规则失败应该返回PRE_QA_WARN', async () => {
      const taskId = 'TASK-test-decision';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [], // 缺少报告，但非阻塞
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const result = await runner.run(taskId);

      expect(result.decision).toBe('PRE_QA_WARN');
      expect(result.allowed).toBe(true);
    });
  });

  describe('报告生成', () => {
    it('应该生成报告', async () => {
      const taskId = 'TASK-test-report-gen';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const runResult = await runner.run(taskId);
      const report = runner.generateReport(runResult);

      expect(report.reportId).toContain('pre-qa-gate-report');
      expect(report.taskId).toBe(taskId);
      expect(report.result).toBe(runResult);
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.metadata.version).toBe('1.0.0');
    });

    it('报告应包含针对失败规则的建议', async () => {
      const taskId = 'TASK-test-report-gen';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'pending',
        checkpoints: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const runResult = await runner.run(taskId);
      const report = runner.generateReport(runResult);

      expect(report.recommendations.length).toBeGreaterThan(0);
      const hasTaskStatusRecommendation = report.recommendations.some(r =>
        r.includes('任务状态')
      );
      expect(hasTaskStatusRecommendation).toBe(true);
    });

    it('通过时报告应包含正面反馈', async () => {
      const taskId = 'TASK-test-report-gen';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      const runResult = await runner.run(taskId);
      const report = runner.generateReport(runResult);

      const hasPositiveFeedback = report.recommendations.some(r =>
        r.includes('✅') || r.includes('QA验证条件')
      );
      expect(hasPositiveFeedback).toBe(true);
    });
  });

  describe('便捷函数', () => {
    it('createPreQAGateRunner应该创建实例', () => {
      const runner = createPreQAGateRunner(testDir);
      expect(runner).toBeInstanceOf(PreQAGateRunner);
    });

    it('quickPreQAGateCheck应该返回结果', async () => {
      const taskId = 'TASK-test-quick';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const result = await quickPreQAGateCheck(taskId, testDir);

      expect(result.taskId).toBe(taskId);
      expect(result.decision).toBeDefined();
      expect(result.allowed).toBeDefined();
    });

    it('batchPreQAGateCheck应该批量检查', async () => {
      const taskIds = ['TASK-test-001', 'TASK-test-002'];

      for (const taskId of taskIds) {
        const taskDir = path.join(tasksDir, taskId);
        fs.mkdirSync(taskDir, { recursive: true });

        const task = createMockTask({ id: taskId });
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(task)
        );
      }

      const results = await batchPreQAGateCheck(taskIds, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe(taskIds[0]);
      expect(results[1].taskId).toBe(taskIds[1]);
    });
  });

  describe('配置管理', () => {
    it('应该能更新配置', () => {
      const runner = new PreQAGateRunner(testDir);

      runner.updateConfig({
        enabled: false,
        requireCodeReviewPass: false,
      });

      const config = runner.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.requireCodeReviewPass).toBe(false);
    });

    it('应该能添加规则', () => {
      const runner = new PreQAGateRunner(testDir);
      const initialRuleCount = runner.getConfig().rules.length;

      const newRule: PreQAGateRule = {
        id: 'rule-custom-test',
        type: 'custom',
        name: '自定义测试规则',
        description: '测试规则',
        enabled: true,
        priority: 10,
        blocking: false,
      };

      runner.addRule(newRule);

      const config = runner.getConfig();
      expect(config.rules).toHaveLength(initialRuleCount + 1);
      expect(config.rules.some(r => r.id === 'rule-custom-test')).toBe(true);
    });

    it('应该能移除规则', () => {
      const runner = new PreQAGateRunner(testDir);
      const initialRuleCount = runner.getConfig().rules.length;

      runner.removeRule('rule-task-status');

      const config = runner.getConfig();
      expect(config.rules).toHaveLength(initialRuleCount - 1);
      expect(config.rules.some(r => r.id === 'rule-task-status')).toBe(false);
    });

    it('应该能注册自定义规则处理器', async () => {
      const taskId = 'TASK-test-custom';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({ id: taskId });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const runner = new PreQAGateRunner(testDir);
      let customHandlerCalled = false;

      runner.registerRuleHandler('custom', async () => {
        customHandlerCalled = true;
        return {
          ruleId: 'custom',
          passed: true,
          ruleName: '自定义规则',
          message: '自定义处理器执行成功',
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      });

      runner.addRule({
        id: 'rule-custom',
        type: 'custom',
        name: '自定义规则',
        description: '测试自定义处理器',
        enabled: true,
        priority: 100,
        blocking: false,
      });

      await runner.run(taskId);

      expect(customHandlerCalled).toBe(true);
    });
  });
});
