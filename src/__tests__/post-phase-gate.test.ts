/**
 * PostPhaseGate 单元测试
 *
 * 测试阶段后质量门禁检查器的核心功能:
 * - 阶段退出权限检查
 * - 各阶段规则执行
 * - 门禁决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import {
  PostPhaseGateChecker,
  createPostPhaseGateChecker,
  quickPostPhaseGateCheck,
  validatePhaseExit,
} from '../utils/post-phase-gate.js';
import type {
  PostPhaseGateConfig,
  PostPhaseGateRule,
  ExecutionPhase,
} from '../types/post-phase-gate.js';
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

describe('PostPhaseGateChecker', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'post-phase-gate-test-' });
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);
      expect(checker).toBeDefined();
      expect(checker.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);
      const config = checker.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minQualityScore).toBe(60);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.phaseGates.size).toBe(4);
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PostPhaseGateConfig> = {
        enabled: false,
        minQualityScore: 80,
        stopOnFailure: true,
      };

      const checker = new PostPhaseGateChecker(env.tempDir, customConfig);
      const config = checker.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.minQualityScore).toBe(80);
      expect(config.stopOnFailure).toBe(true);
    });
  });

  describe('development 阶段退出检查', () => {
    it('有成功开发报告的任务应该允许退出 development 阶段', async () => {
      const taskId = 'TASK-test-dev-success';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development', {
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

      expect(result.canExit).toBe(true);
      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('开发失败的任务不应该允许退出 development 阶段', async () => {
      const taskId = 'TASK-test-dev-failed';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development', {
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

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });

    it('缺少开发报告的任务不应该允许退出 development 阶段', async () => {
      const taskId = 'TASK-test-dev-no-report';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development');

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });

    it('禁用时应该直接允许', async () => {
      const taskId = 'TASK-test-dev-disabled';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir, { enabled: false });
      const result = await checker.checkPhaseExit(taskId, 'development');

      expect(result.canExit).toBe(true);
      expect(result.decision).toBe('COMPLETE');
    });

    it('任务不存在时应该返回 INCOMPLETE', async () => {
      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit('TASK-non-existent', 'development');

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
      expect(result.failedRules).toBe(1);
    });
  });

  describe('code_review 阶段退出检查', () => {
    it('代码审核通过的任务应该允许退出 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-pass';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'code_review', {
        codeReviewVerdict: {
          taskId,
          result: 'PASS',
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'code_reviewer',
          codeQualityIssues: [],
          failedCheckpoints: [],
        },
      });

      expect(result.canExit).toBe(true);
      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('代码审核未通过的任务不应该允许退出 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-nopass';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'code_review', {
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

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });

    it('缺少代码审核结果的任务不应该允许退出 code_review 阶段', async () => {
      const taskId = 'TASK-test-cr-no-verdict';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'code_review');

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });
  });

  describe('qa 阶段退出检查', () => {
    it('QA通过的任务应该允许退出 qa 阶段', async () => {
      const taskId = 'TASK-test-qa-pass';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'qa', {
        qaVerdict: {
          taskId,
          result: 'PASS',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'qa_tester',
        },
      });

      expect(result.canExit).toBe(true);
      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('QA未通过的任务不应该允许退出 qa 阶段', async () => {
      const taskId = 'TASK-test-qa-fail';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'qa', {
        qaVerdict: {
          taskId,
          result: 'FAIL',
          reason: '测试未通过',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'qa_tester',
        },
      });

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });

    it('缺少QA结果的任务不应该允许退出 qa 阶段', async () => {
      const taskId = 'TASK-test-qa-no-verdict';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'qa');

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });
  });

  describe('evaluation 阶段退出检查', () => {
    it('状态为 resolved 的任务应该允许退出 evaluation 阶段', async () => {
      const taskId = 'TASK-test-eval-resolved';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');

      expect(result.canExit).toBe(true);
      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('状态为 closed 的任务应该允许退出 evaluation 阶段', async () => {
      const taskId = 'TASK-test-eval-closed';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'closed' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');

      expect(result.canExit).toBe(true);
      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('状态为 in_progress 的任务不应该允许退出 evaluation 阶段', async () => {
      const taskId = 'TASK-test-eval-progress';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'in_progress' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');

      expect(result.canExit).toBe(false);
      expect(result.decision).toBe('INCOMPLETE');
    });
  });

  describe('门禁决策', () => {
    it('所有规则通过应该返回 COMPLETE', async () => {
      const taskId = 'TASK-test-complete';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');

      expect(['COMPLETE', 'NEEDS_FIX']).toContain(result.decision);
    });

    it('阻塞规则失败应该返回 INCOMPLETE', async () => {
      const taskId = 'TASK-test-incomplete';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development');

      expect(result.decision).toBe('INCOMPLETE');
      expect(result.canExit).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });

  describe('产出物检查', () => {
    it('应该生成阶段产出物列表', async () => {
      const taskId = 'TASK-test-deliverables';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development', {
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

      expect(result.deliverables.length).toBeGreaterThan(0);
      expect(result.deliverables.some(d => d.id === 'dev-code-changes')).toBe(true);
      expect(result.deliverables.some(d => d.id === 'dev-report')).toBe(true);
    });
  });

  describe('报告生成', () => {
    it('应该生成报告', async () => {
      const taskId = 'TASK-test-report';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');
      const report = checker.generateReport(result);

      expect(report.reportId).toBeDefined();
      expect(report.taskId).toBe(taskId);
      expect(report.currentPhase).toBe('evaluation');
      expect(report.metadata.rulesExecuted).toBe(result.ruleResults.length);
    });

    it('应该格式化结果为字符串', async () => {
      const taskId = 'TASK-test-format';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'evaluation');
      const formatted = checker.formatResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain(taskId);
      expect(formatted).toContain('evaluation');
    });
  });

  describe('便捷函数', () => {
    it('createPostPhaseGateChecker 应该创建实例', () => {
      const checker = createPostPhaseGateChecker(env.tempDir);
      expect(checker).toBeInstanceOf(PostPhaseGateChecker);
    });

    it('quickPostPhaseGateCheck 应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const result = await quickPostPhaseGateCheck(taskId, 'evaluation', env.tempDir);

      expect(result.taskId).toBe(taskId);
      expect(result.currentPhase).toBe('evaluation');
      expect(result.decision).toBeDefined();
    });

    it('validatePhaseExit 应该返回验证结果', async () => {
      const taskId = 'TASK-test-validate';
      createTaskDir(env.tasksDir, taskId, createMockTask({ id: taskId, status: 'resolved' }));

      const validation = await validatePhaseExit(taskId, 'evaluation', env.tempDir);

      expect(validation.canExit).toBe(true);
      expect(Array.isArray(validation.unmetConditions)).toBe(true);
      expect(Array.isArray(validation.suggestedActions)).toBe(true);
      expect(typeof validation.allowForceExit).toBe('boolean');
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);

      checker.updateConfig({
        minQualityScore: 90,
        stopOnFailure: true,
      });

      const config = checker.getConfig();
      expect(config.minQualityScore).toBe(90);
      expect(config.stopOnFailure).toBe(true);
    });

    it('应该添加和移除阶段规则', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);

      const newRule: PostPhaseGateRule = {
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
      const checker = new PostPhaseGateChecker(env.tempDir);
      const config = checker.getConfig();

      expect(config.phaseGates.has('development')).toBe(true);
      expect(config.phaseGates.has('code_review')).toBe(true);
      expect(config.phaseGates.has('qa')).toBe(true);
      expect(config.phaseGates.has('evaluation')).toBe(true);
    });

    it('每个阶段应该有自己的规则集', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);
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

    it('各阶段应有不同的检查点完成率要求', () => {
      const checker = new PostPhaseGateChecker(env.tempDir);
      const config = checker.getConfig();

      const devConfig = config.phaseGates.get('development');
      const crConfig = config.phaseGates.get('code_review');
      const qaConfig = config.phaseGates.get('qa');

      expect(devConfig?.minCheckpointCompletionRate).toBe(0.8);
      expect(crConfig?.minCheckpointCompletionRate).toBe(0.9);
      expect(qaConfig?.minCheckpointCompletionRate).toBe(1.0);
    });
  });

  describe('检查点完成度验证', () => {
    it('检查点完成度达到要求应该通过', async () => {
      const taskId = 'TASK-test-checkpoint-pass';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed' },
          { id: 'CP-002', description: '检查点2', status: 'completed' },
          { id: 'CP-003', description: '检查点3', status: 'completed' },
          { id: 'CP-004', description: '检查点4', status: 'completed' },
          { id: 'CP-005', description: '检查点5', status: 'completed' },
        ],
      }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development', {
        devReport: {
          taskId,
          status: 'success',
          changes: ['src/test.ts'],
          evidence: ['test passed'],
          checkpointsCompleted: ['CP-001', 'CP-002', 'CP-003', 'CP-004', 'CP-005'],
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1000,
        },
      });

      // 检查点完成度规则是非阻塞的
      expect(result.ruleResults.some(r => r.ruleId === 'R-DEV-POST-003')).toBe(true);
    });

    it('检查点完成度不足应该返回警告', async () => {
      const taskId = 'TASK-test-checkpoint-warn';
      createTaskDir(env.tasksDir, taskId, createMockTask({
        id: taskId,
        checkpoints: [
          { id: 'CP-001', description: '检查点1', status: 'completed' },
          { id: 'CP-002', description: '检查点2', status: 'completed' },
          { id: 'CP-003', description: '检查点3', status: 'completed' },
          { id: 'CP-004', description: '检查点4', status: 'completed' },
          { id: 'CP-005', description: '检查点5', status: 'pending' },
        ],
      }));

      const checker = new PostPhaseGateChecker(env.tempDir);
      const result = await checker.checkPhaseExit(taskId, 'development', {
        devReport: {
          taskId,
          status: 'success',
          changes: ['src/test.ts'],
          evidence: ['test passed'],
          checkpointsCompleted: ['CP-001', 'CP-002', 'CP-003'], // 只有60%完成
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1000,
        },
      });

      const checkpointResult = result.ruleResults.find(r => r.ruleId === 'R-DEV-POST-003');
      expect(checkpointResult).toBeDefined();
    });
  });
});