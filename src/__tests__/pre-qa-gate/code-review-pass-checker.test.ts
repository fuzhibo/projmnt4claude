/**
 * CodeReviewPassChecker 单元测试
 *
 * 测试代码审核通过检查器的核心功能:
 * - 任务状态标记检查
 * - requirementHistory 历史记录检查
 * - qualityGate 标记检查
 * - 审核报告存在性检查
 * - 配置管理
 * - 结果格式化
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  CodeReviewPassChecker,
  createCodeReviewPassChecker,
  quickCodeReviewPassCheck,
  batchCodeReviewPassCheck,
  formatCodeReviewPassResult,
  DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG,
  type CodeReviewPassCheckerConfig,
} from '../../utils/pre-qa-gate/checkers/code-review-pass-checker.js';
import type { TaskMeta } from '../../types/task.js';

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

describe('CodeReviewPassChecker', () => {
  let testDir: string;
  let tasksDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/code-review-pass-test-');
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
      const checker = new CodeReviewPassChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new CodeReviewPassChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.requireStatusMarker).toBe(true);
      expect(config.requireHistoryRecord).toBe(false);
      expect(config.requireQualityGateMarker).toBe(false);
      expect(config.requireReviewReport).toBe(false);
      expect(config.passedStatuses).toContain('cr_passed');
      expect(config.passedStatuses).toContain('wait_qa');
      expect(config.passedStatuses).toContain('qa');
      expect(config.passedStatuses).toContain('qa_passed');
      expect(config.passedStatuses).toContain('completed');
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<CodeReviewPassCheckerConfig> = {
        enabled: false,
        requireStatusMarker: false,
        requireHistoryRecord: true,
        passedStatuses: ['custom_status'],
      };

      const checker = new CodeReviewPassChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.requireStatusMarker).toBe(false);
      expect(config.requireHistoryRecord).toBe(true);
      expect(config.passedStatuses).toEqual(['custom_status']);
    });
  });

  describe('任务状态标记检查 (R-CR-PASS-001)', () => {
    it('wait_qa 状态应该通过', async () => {
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      const statusCheck = result.checks.find(c => c.checkId === 'status-marker');
      expect(statusCheck?.passed).toBe(true);
      expect(statusCheck?.message).toContain('已标记为审核通过');
    });

    it('cr_passed 状态应该通过', async () => {
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      const statusCheck = result.checks.find(c => c.checkId === 'status-marker');
      expect(statusCheck?.passed).toBe(true);
    });

    it('qa 状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'qa',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
    });

    it('completed 状态应该通过', async () => {
      const taskId = 'TASK-test-status';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'completed',
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
    });

    it('in_progress 状态不应该通过', async () => {
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      const statusCheck = result.checks.find(c => c.checkId === 'status-marker');
      expect(statusCheck?.passed).toBe(false);
      expect(statusCheck?.message).toContain('未标记为审核通过');
    });

    it('pending 状态不应该通过', async () => {
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
    });
  });

  describe('历史记录检查 (R-CR-PASS-002)', () => {
    it('requirementHistory 中有审核通过记录应该通过', async () => {
      const taskId = 'TASK-test-history';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'in_progress', // 状态不通过，但历史记录通过
        requirementHistory: [
          { timestamp: new Date().toISOString(), field: 'status', oldValue: 'wait_review', newValue: 'cr_passed' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireStatusMarker: false,
        requireHistoryRecord: true,
      });
      const result = await checker.check(taskId);

      const historyCheck = result.checks.find(c => c.checkId === 'history-record');
      expect(historyCheck?.passed).toBe(true);
      expect(historyCheck?.message).toContain('找到');
    });

    it('无 requirementHistory 应该失败', async () => {
      const taskId = 'TASK-test-history';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireHistoryRecord: true,
      });
      const result = await checker.check(taskId);

      const historyCheck = result.checks.find(c => c.checkId === 'history-record');
      expect(historyCheck?.passed).toBe(false);
      expect(historyCheck?.message).toContain('没有 requirementHistory');
    });

    it('requirementHistory 中无审核通过记录应该失败', async () => {
      const taskId = 'TASK-test-history';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [
          { timestamp: new Date().toISOString(), field: 'title', oldValue: '旧标题', newValue: '新标题' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireHistoryRecord: true,
      });
      const result = await checker.check(taskId);

      const historyCheck = result.checks.find(c => c.checkId === 'history-record');
      expect(historyCheck?.passed).toBe(false);
      expect(historyCheck?.message).toContain('未在 requirementHistory 中找到审核通过记录');
    });
  });

  describe('质量门禁标记检查 (R-CR-PASS-003)', () => {
    it('qualityGate.codeReviewPass 为 true 应该通过', async () => {
      const taskId = 'TASK-test-qg';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        qualityGate: {
          codeReviewPass: true,
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireQualityGateMarker: true,
      });
      const result = await checker.check(taskId);

      const qgCheck = result.checks.find(c => c.checkId === 'quality-gate-marker');
      expect(qgCheck?.passed).toBe(true);
      expect(qgCheck?.message).toContain('已标记');
    });

    it('qualityGate.crPhasePass 为 true 应该通过', async () => {
      const taskId = 'TASK-test-qg';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        qualityGate: {
          crPhasePass: true,
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireQualityGateMarker: true,
      });
      const result = await checker.check(taskId);

      const qgCheck = result.checks.find(c => c.checkId === 'quality-gate-marker');
      expect(qgCheck?.passed).toBe(true);
    });

    it('无 qualityGate 配置应该失败', async () => {
      const taskId = 'TASK-test-qg';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        qualityGate: undefined,
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireQualityGateMarker: true,
      });
      const result = await checker.check(taskId);

      const qgCheck = result.checks.find(c => c.checkId === 'quality-gate-marker');
      expect(qgCheck?.passed).toBe(false);
      expect(qgCheck?.message).toContain('没有 qualityGate');
    });

    it('qualityGate 标记为 false 应该失败', async () => {
      const taskId = 'TASK-test-qg';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        qualityGate: {
          codeReviewPass: false,
          crPhasePass: false,
        },
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireQualityGateMarker: true,
      });
      const result = await checker.check(taskId);

      const qgCheck = result.checks.find(c => c.checkId === 'quality-gate-marker');
      expect(qgCheck?.passed).toBe(false);
      expect(qgCheck?.message).toContain('未标记');
    });
  });

  describe('审核报告检查 (R-CR-PASS-004)', () => {
    it('存在 code_review 类型报告应该通过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [
          { type: 'code_review', name: '代码审核报告', path: 'reports/code-review.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      const reportCheck = result.checks.find(c => c.checkId === 'review-report');
      expect(reportCheck?.passed).toBe(true);
      expect(reportCheck?.message).toContain('找到');
    });

    it('存在 review 类型报告应该通过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [
          { type: 'review', name: '审核报告', path: 'reports/review.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      const reportCheck = result.checks.find(c => c.checkId === 'review-report');
      expect(reportCheck?.passed).toBe(true);
    });

    it('报告名称包含 review 应该通过', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [
          { type: 'other', name: 'Code Review Report', path: 'reports/cr.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      const reportCheck = result.checks.find(c => c.checkId === 'review-report');
      expect(reportCheck?.passed).toBe(true);
    });

    it('无 reports 配置应该失败', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      const reportCheck = result.checks.find(c => c.checkId === 'review-report');
      expect(reportCheck?.passed).toBe(false);
      expect(reportCheck?.message).toContain('没有配置 reports');
    });

    it('无审核相关报告应该失败', async () => {
      const taskId = 'TASK-test-report';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        reports: [
          { type: 'other', name: '其他报告', path: 'reports/other.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      const reportCheck = result.checks.find(c => c.checkId === 'review-report');
      expect(reportCheck?.passed).toBe(false);
      expect(reportCheck?.message).toContain('未找到');
    });
  });

  describe('多维度组合检查', () => {
    it('所有检查都通过时应该返回通过', async () => {
      const taskId = 'TASK-test-all';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [
          { timestamp: new Date().toISOString(), field: 'status', oldValue: 'wait_review', newValue: 'cr_passed' },
        ],
        qualityGate: {
          codeReviewPass: true,
        },
        reports: [
          { type: 'code_review', name: '代码审核报告', path: 'reports/cr.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireStatusMarker: true,
        requireHistoryRecord: true,
        requireQualityGateMarker: true,
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.passedCount).toBe(4);
      expect(result.failedCount).toBe(0);
    });

    it('任一检查失败时应该返回失败', async () => {
      const taskId = 'TASK-test-all';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [], // 这将导致历史记录检查失败
        qualityGate: {
          codeReviewPass: true,
        },
        reports: [
          { type: 'code_review', name: '代码审核报告', path: 'reports/cr.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireStatusMarker: true,
        requireHistoryRecord: true,
        requireQualityGateMarker: true,
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.failedCount).toBeGreaterThan(0);
    });
  });

  describe('任务不存在处理', () => {
    it('任务不存在时应该返回失败', async () => {
      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check('TASK-non-existent');

      expect(result.passed).toBe(false);
      expect(result.checks.length).toBe(1);
      expect(result.checks[0].checkId).toBe('task-existence');
      expect(result.checks[0].passed).toBe(false);
      expect(result.checks[0].message).toContain('不存在');
    });
  });

  describe('配置管理', () => {
    it('应该能更新配置', () => {
      const checker = new CodeReviewPassChecker(testDir);

      checker.updateConfig({
        enabled: false,
        requireStatusMarker: false,
      });

      const config = checker.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.requireStatusMarker).toBe(false);
      // 其他配置应保持不变
      expect(config.requireHistoryRecord).toBe(false);
    });

    it('获取配置不应影响原始配置', () => {
      const checker = new CodeReviewPassChecker(testDir);
      const config = checker.getConfig();

      // 修改返回的配置
      config.enabled = false;

      // 原始配置不应被修改
      const config2 = checker.getConfig();
      expect(config2.enabled).toBe(true);
    });
  });

  describe('便捷函数', () => {
    it('createCodeReviewPassChecker 应该创建实例', () => {
      const checker = createCodeReviewPassChecker(testDir);
      expect(checker).toBeInstanceOf(CodeReviewPassChecker);
    });

    it('quickCodeReviewPassCheck 应该返回结果', async () => {
      const taskId = 'TASK-test-quick';
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

      const result = await quickCodeReviewPassCheck(taskId, testDir);

      expect(result.taskId).toBe(taskId);
      expect(result.passed).toBe(true);
      expect(result.checks).toBeDefined();
    });

    it('batchCodeReviewPassCheck 应该批量检查', async () => {
      const taskIds = ['TASK-test-001', 'TASK-test-002'];

      for (const taskId of taskIds) {
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
      }

      const results = await batchCodeReviewPassCheck(taskIds, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe(taskIds[0]);
      expect(results[1].taskId).toBe(taskIds[1]);
    });
  });

  describe('结果格式化', () => {
    it('formatCodeReviewPassResult 应该返回格式化字符串', async () => {
      const taskId = 'TASK-test-format';
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);
      const formatted = formatCodeReviewPassResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('通过');
      expect(formatted).toContain('检查结果');
    });

    it('失败结果的格式化应该包含错误信息', async () => {
      const taskId = 'TASK-test-format';
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);
      const formatted = formatCodeReviewPassResult(result);

      expect(formatted).toContain('未通过');
      expect(formatted).toContain('失败');
    });

    it('格式化应该包含检查项详情', async () => {
      const taskId = 'TASK-test-format';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [
          { timestamp: new Date().toISOString(), field: 'status', oldValue: 'wait_review', newValue: 'cr_passed' },
        ],
        qualityGate: {
          codeReviewPass: true,
        },
        reports: [
          { type: 'code_review', name: '代码审核报告', path: 'reports/cr.md' },
        ],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireStatusMarker: true,
        requireHistoryRecord: true,
        requireQualityGateMarker: true,
        requireReviewReport: true,
      });
      const result = await checker.check(taskId);
      const formatted = formatCodeReviewPassResult(result);

      expect(formatted).toContain('详细结果');
      expect(formatted).toContain('执行时长');
    });
  });

  describe('默认配置常量', () => {
    it('DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG 应该包含所有必要字段', () => {
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG).toBeDefined();
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.requireStatusMarker).toBe(true);
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.requireHistoryRecord).toBe(false);
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.requireQualityGateMarker).toBe(false);
      expect(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.requireReviewReport).toBe(false);
      expect(Array.isArray(DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG.passedStatuses)).toBe(true);
    });
  });

  describe('检查结果结构', () => {
    it('检查结果应包含所有必要字段', async () => {
      const taskId = 'TASK-test-structure';
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

      expect(result.taskId).toBe(taskId);
      expect(typeof result.passed).toBe('boolean');
      expect(Array.isArray(result.checks)).toBe(true);
      expect(typeof result.passedCount).toBe('number');
      expect(typeof result.failedCount).toBe('number');
      expect(typeof result.duration).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });

    it('每个检查项应包含所有必要字段', async () => {
      const taskId = 'TASK-test-structure';
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

      const checker = new CodeReviewPassChecker(testDir);
      const result = await checker.check(taskId);

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
      const taskId = 'TASK-test-counts';
      const taskDir = path.join(tasksDir, taskId);
      fs.mkdirSync(taskDir, { recursive: true });

      const task = createMockTask({
        id: taskId,
        status: 'wait_qa',
        requirementHistory: [],
      });
      fs.writeFileSync(
        path.join(taskDir, 'meta.json'),
        JSON.stringify(task)
      );

      const checker = new CodeReviewPassChecker(testDir, {
        requireStatusMarker: true,
        requireHistoryRecord: true,
      });
      const result = await checker.check(taskId);

      expect(result.passedCount + result.failedCount).toBe(result.checks.length);
    });
  });
});
