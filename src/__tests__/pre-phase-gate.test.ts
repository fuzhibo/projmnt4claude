/**
 * PrePhaseGate 单元测试
 *
 * 测试阶段前质量门禁检查器的核心功能:
 * - 阶段进入权限检查
 * - 各阶段规则执行
 * - 门禁决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'path';
import {
  PrePhaseGateChecker,
  createPhaseGateChecker,
  quickPhaseGateCheck,
  validatePhaseEntry,
} from '../utils/pre-phase-gate.js';
import type {
  PrePhaseGateConfig,
  PhaseGateRule,
  ExecutionPhase,
} from '../types/pre-phase-gate.js';
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
    description: '这是一个测试任务的描述，长度足够长以满足要求，包含解决方案部分\n\n## 相关文件\n- src/test.ts',
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

describe('PrePhaseGateChecker', () => {
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
      const checker = new PrePhaseGateChecker(testDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new PrePhaseGateChecker(testDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minQualityScore).toBe(60);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.phaseGates.size).toBe(4);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PrePhaseGateConfig> = {
        enabled: false,
        minQualityScore: 80,
        stopOnFailure: true,
      };

      const checker = new PrePhaseGateChecker(testDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.minQualityScore).toBe(80);
      expect(config.stopOnFailure).toBe(true);
    });
  });

  describe('development 阶段门禁', () => {
    it('状态为 open 的任务应该允许进入 development 阶段', async () => {
      const taskId = 'TASK-test-dev-open';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.allowed).toBe(true);
      // 决策可以是 ALLOW 或 WARN（当有非阻塞规则失败时）
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('状态为 in_progress 的任务应该允许进入 development 阶段', async () => {
      const taskId = 'TASK-test-dev-progress';
      const task = createMockTask({ id: taskId, status: 'in_progress' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.allowed).toBe(true);
      // 决策可以是 ALLOW 或 WARN（当有非阻塞规则失败时）
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('状态为 failed 的任务不应该允许进入 development 阶段', async () => {
      const taskId = 'TASK-test-dev-failed';
      const task = createMockTask({ id: taskId, status: 'failed' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });

    it('状态为 resolved 的任务不应该允许进入 development 阶段', async () => {
      const taskId = 'TASK-test-dev-resolved';
      const task = createMockTask({ id: taskId, status: 'resolved' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });

    it('禁用时应该直接允许', async () => {
      const taskId = 'TASK-test-dev-disabled';
      const task = createMockTask({ id: taskId, status: 'failed' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir, { enabled: false });
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.allowed).toBe(true);
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('任务不存在时应该返回 BLOCK', async () => {
      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry('TASK-non-existent', 'development');

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
      expect(result.failedRules).toBe(1);
    });
  });

  describe('code_review 阶段门禁', () => {
    it('有成功开发报告的任务应该允许进入 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-success';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'code_review', {
        devReport: {
          taskId,
          status: 'success',
          changes: ['src/test.ts'],
          evidence: ['test passed'],
          checkpointsCompleted: ['CP-001', 'CP-002'],
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1000,
        },
      });

      expect(result.allowed).toBe(true);
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('开发失败的任务不应该允许进入 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-failed';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'code_review', {
        devReport: {
          taskId,
          status: 'failed',
          changes: [],
          evidence: [],
          checkpointsCompleted: [],
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1000,
          error: '开发失败',
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });

    it('缺少开发报告的任务不应该允许进入 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-no-report';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'code_review');

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });
  });

  describe('qa 阶段门禁', () => {
    it('代码审核通过的任务应该允许进入 qa 阶段', async () => {
      const taskId = 'TASK-test-qa-pass';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'qa', {
        codeReviewVerdict: {
          taskId,
          result: 'PASS',
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'code_reviewer',
          codeQualityIssues: [],
          failedCheckpoints: [],
        },
      });

      expect(result.allowed).toBe(true);
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('代码审核未通过的任务不应该允许进入 qa 阶段', async () => {
      const taskId = 'TASK-test-qa-nopass';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'qa', {
        codeReviewVerdict: {
          taskId,
          result: 'NOPASS',
          reason: '代码质量问题',
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'code_reviewer',
          codeQualityIssues: [{ file: 'test.ts', line: 1, issue: '格式错误', severity: 'minor' }],
          failedCheckpoints: [],
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });
  });

  describe('evaluation 阶段门禁', () => {
    it('QA通过的任务应该允许进入 evaluation 阶段', async () => {
      const taskId = 'TASK-test-eval-pass';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'evaluation', {
        qaVerdict: {
          taskId,
          result: 'PASS',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'qa_tester',
        },
      });

      expect(result.allowed).toBe(true);
      expect(['ALLOW', 'WARN']).toContain(result.decision);
    });

    it('QA未通过的任务不应该允许进入 evaluation 阶段', async () => {
      const taskId = 'TASK-test-eval-fail';
      const task = createMockTask({ id: taskId });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'evaluation', {
        qaVerdict: {
          taskId,
          result: 'FAIL',
          reason: '测试未通过',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'qa_tester',
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('BLOCK');
    });
  });

  describe('门禁决策', () => {
    it('所有规则通过应该返回 ALLOW', async () => {
      const taskId = 'TASK-test-allow';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(['ALLOW', 'WARN']).toContain(result.decision);
      expect(result.allowed).toBe(true);
    });

    it('阻塞规则失败应该返回 BLOCK', async () => {
      const taskId = 'TASK-test-block';
      const task = createMockTask({ id: taskId, status: 'failed' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');

      expect(result.decision).toBe('BLOCK');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });

  describe('报告生成', () => {
    it('应该生成报告', async () => {
      const taskId = 'TASK-test-report';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');
      const report = checker.generateReport(result);

      expect(report.reportId).toBeDefined();
      expect(report.taskId).toBe(taskId);
      expect(report.targetPhase).toBe('development');
      expect(report.metadata.rulesExecuted).toBe(result.ruleResults.length);
    });

    it('应该格式化结果为字符串', async () => {
      const taskId = 'TASK-test-format';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const checker = new PrePhaseGateChecker(testDir);
      const result = await checker.checkPhaseEntry(taskId, 'development');
      const formatted = checker.formatResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('development');
    });
  });

  describe('便捷函数', () => {
    it('createPhaseGateChecker 应该创建实例', () => {
      const checker = createPhaseGateChecker(testDir);
      expect(checker).toBeInstanceOf(PrePhaseGateChecker);
    });

    it('quickPhaseGateCheck 应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const result = await quickPhaseGateCheck(taskId, 'development', testDir);

      expect(result.taskId).toBe(taskId);
      expect(result.targetPhase).toBe('development');
      expect(result.decision).toBeDefined();
    });

    it('validatePhaseEntry 应该返回验证结果', async () => {
      const taskId = 'TASK-test-validate';
      const task = createMockTask({ id: taskId, status: 'open' });
      createTaskDir(tasksDir, taskId, task);

      const validation = await validatePhaseEntry(taskId, 'development', testDir);

      expect(validation.canEnter).toBe(true);
      expect(Array.isArray(validation.unmetConditions)).toBe(true);
      expect(Array.isArray(validation.suggestedActions)).toBe(true);
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new PrePhaseGateChecker(testDir);

      checker.updateConfig({
        minQualityScore: 90,
        stopOnFailure: true,
      });

      const config = checker.getConfig();
      expect(config.minQualityScore).toBe(90);
      expect(config.stopOnFailure).toBe(true);
    });

    it('应该添加和移除阶段规则', () => {
      const checker = new PrePhaseGateChecker(testDir);

      const newRule: PhaseGateRule = {
        id: 'rule-custom',
        type: 'custom',
        name: '自定义规则',
        description: '测试自定义规则',
        enabled: true,
        blocking: false,
      };

      checker.addPhaseRule('development', newRule);
      const config = checker.getConfig();
      const devConfig = config.phaseGates.get('development');
      expect(devConfig?.rules.some(r => r.id === 'rule-custom')).toBe(true);

      checker.removePhaseRule('development', 'rule-custom');
      const configAfter = checker.getConfig();
      const devConfigAfter = configAfter.phaseGates.get('development');
      expect(devConfigAfter?.rules.some(r => r.id === 'rule-custom')).toBe(false);
    });
  });

  describe('各阶段配置', () => {
    it('应该为所有阶段配置规则', () => {
      const checker = new PrePhaseGateChecker(testDir);
      const config = checker.getConfig();

      expect(config.phaseGates.has('development')).toBe(true);
      expect(config.phaseGates.has('code_review')).toBe(true);
      expect(config.phaseGates.has('qa')).toBe(true);
      expect(config.phaseGates.has('evaluation')).toBe(true);
    });

    it('每个阶段应该有自己的规则集', () => {
      const checker = new PrePhaseGateChecker(testDir);
      const config = checker.getConfig();

      const devRules = config.phaseGates.get('development')?.rules ?? [];
      const crRules = config.phaseGates.get('code_review')?.rules ?? [];
      const qaRules = config.phaseGates.get('qa')?.rules ?? [];
      const evalRules = config.phaseGates.get('evaluation')?.rules ?? [];

      expect(devRules.length).toBeGreaterThan(0);
      expect(crRules.length).toBeGreaterThan(0);
      expect(qaRules.length).toBeGreaterThan(0);
      expect(evalRules.length).toBeGreaterThan(0);
    });
  });
});
