/**
 * 阻断性质量门禁规则测试 (QG-PLAN-003)
 *
 * - CP-4: cycle-detection 正确识别循环
 * - CP-5: invalid-dependency 正确识别无效依赖
 * - CP-6: orphan-subtask 正确识别孤儿子任务
 * - CP-12: PHASE_RULES.plan_recommend 更新包含新规则
 */

import { describe, it, expect } from 'bun:test';
import { runQualityGate, getRulesForPhase, PHASE_RULES } from '../utils/quality-gate-registry';
import {
  planCycleDetection,
  planInvalidDependency,
  planOrphanSubtask,
  planOrphanTask,
  planBlockedTask,
  planBridgeNode,
  planInferredOnlyDependency,
} from '../utils/validation-rules/plan-rules';
import type { TaskMeta } from '../types/task';

// 创建测试任务
function createTestTaskMeta(overrides: Partial<TaskMeta> = {}): TaskMeta {
  const now = new Date().toISOString();
  return {
    id: 'TASK-test',
    title: '测试任务',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    description: '## 问题描述\n测试描述\n\n## 相关文件\n- src/test.ts',
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    schemaVersion: 6,
    subtaskIds: [],
    discussionTopics: [],
    fileWarnings: [],
    allowedTools: [],
    ...overrides,
  };
}

describe('阻断性质量门禁规则 (QG-PLAN-003)', () => {
  describe('CP-12: PHASE_RULES.plan_recommend 包含新规则', () => {
    it('plan_recommend 阶段应包含 plan-cycle-detection 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-cycle-detection');
    });

    it('plan_recommend 阶段应包含 plan-invalid-dependency 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-invalid-dependency');
    });

    it('plan_recommend 阶段应包含 plan-orphan-subtask 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-orphan-subtask');
    });

    it('应能通过 getRulesForPhase 获取到新规则', () => {
      const rules = getRulesForPhase('plan_recommend');
      const ruleIds = rules.map(r => r.id);

      expect(ruleIds).toContain('plan-cycle-detection');
      expect(ruleIds).toContain('plan-invalid-dependency');
      expect(ruleIds).toContain('plan-orphan-subtask');
    });
  });

  describe('CP-4: plan-cycle-detection 正确识别循环', () => {
    it('应检测到简单循环依赖 (A→B→A)', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: ['TASK-B'] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = planCycleDetection.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-cycle-detection');
      expect(result?.severity).toBe('error');
      expect(result?.message).toContain('循环依赖');
    });

    it('应检测到复杂循环依赖 (A→B→C→A)', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: ['TASK-C'] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const taskC = createTestTaskMeta({ id: 'TASK-C', dependencies: ['TASK-B'] });
      const allTasks = [taskA, taskB, taskC];

      const result = planCycleDetection.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-cycle-detection');
    });

    it('无循环时应返回 null', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = planCycleDetection.check(taskB, { allTasks });

      expect(result).toBeNull();
    });

    it('无 allTasks 上下文时应返回 null', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A' });

      const result = planCycleDetection.check(taskA);

      expect(result).toBeNull();
    });
  });

  describe('CP-5: plan-invalid-dependency 正确识别无效依赖', () => {
    it('应检测到引用不存在的任务', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: ['TASK-NONEXISTENT']
      });
      const allTasks = [taskA];

      const result = planInvalidDependency.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-invalid-dependency');
      expect(result?.severity).toBe('error');
      expect(result?.message).toContain('TASK-NONEXISTENT');
    });

    it('应检测到多个无效依赖', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: ['TASK-INVALID-1', 'TASK-INVALID-2']
      });
      const allTasks = [taskA];

      const result = planInvalidDependency.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.message).toContain('TASK-INVALID-1');
      expect(result?.message).toContain('TASK-INVALID-2');
    });

    it('有效依赖不应返回违规', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A' });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = planInvalidDependency.check(taskB, { allTasks });

      expect(result).toBeNull();
    });

    it('空依赖列表不应返回违规', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const allTasks = [taskA];

      const result = planInvalidDependency.check(taskA, { allTasks });

      expect(result).toBeNull();
    });
  });

  describe('CP-6: plan-orphan-subtask 正确识别孤儿子任务', () => {
    it('应检测到父任务不存在的子任务', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        parentId: 'TASK-NONEXISTENT-PARENT'
      });
      const allTasks = [taskA];

      const result = planOrphanSubtask.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-orphan-subtask');
      expect(result?.severity).toBe('error');
      expect(result?.message).toContain('TASK-NONEXISTENT-PARENT');
    });

    it('父任务存在时不应返回违规', () => {
      const parent = createTestTaskMeta({ id: 'TASK-PARENT' });
      const child = createTestTaskMeta({
        id: 'TASK-CHILD',
        parentId: 'TASK-PARENT'
      });
      const allTasks = [parent, child];

      const result = planOrphanSubtask.check(child, { allTasks });

      expect(result).toBeNull();
    });

    it('无 parentId 时不应返回违规', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A' });
      const allTasks = [taskA];

      const result = planOrphanSubtask.check(taskA, { allTasks });

      expect(result).toBeNull();
    });

    it('无 allTasks 上下文时应返回 null', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        parentId: 'TASK-PARENT'
      });

      const result = planOrphanSubtask.check(taskA);

      expect(result).toBeNull();
    });
  });

  describe('集成测试: runQualityGate 在 plan_recommend 阶段', () => {
    it('应通过无问题的任务验证', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A' });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = runQualityGate(taskB, 'plan_recommend', { allTasks });

      expect(result.phase).toBe('plan_recommend');
      // cycle-detection 应该通过（无循环）
      const cycleError = result.errors.find(e => e.ruleId === 'plan-cycle-detection');
      expect(cycleError).toBeUndefined();
      // invalid-dependency 应该通过（依赖存在）
      const invalidDepError = result.errors.find(e => e.ruleId === 'plan-invalid-dependency');
      expect(invalidDepError).toBeUndefined();
    });

    it('应检测到循环依赖并返回错误', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: ['TASK-B'] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = runQualityGate(taskA, 'plan_recommend', { allTasks });

      const cycleError = result.errors.find(e => e.ruleId === 'plan-cycle-detection');
      expect(cycleError).toBeDefined();
    });

    it('应检测到无效依赖并返回错误', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: ['TASK-NONEXISTENT']
      });
      const allTasks = [taskA];

      const result = runQualityGate(taskA, 'plan_recommend', { allTasks });

      const invalidDepError = result.errors.find(e => e.ruleId === 'plan-invalid-dependency');
      expect(invalidDepError).toBeDefined();
    });

    it('应检测到孤儿子任务并返回错误', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        parentId: 'TASK-NONEXISTENT-PARENT'
      });
      const allTasks = [taskA];

      const result = runQualityGate(taskA, 'plan_recommend', { allTasks });

      const orphanError = result.errors.find(e => e.ruleId === 'plan-orphan-subtask');
      expect(orphanError).toBeDefined();
    });
  });
});

describe('警告性质量门禁规则 (QG-PLAN-004)', () => {
  describe('CP-7: plan-orphan-task 孤立任务检测', () => {
    it('应检测到孤立任务（无依赖且不被依赖）', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: [] });
      const allTasks = [taskA, taskB];

      const result = planOrphanTask.check(taskA, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-orphan-task');
      expect(result?.severity).toBe('warning');
      expect(result?.message).toContain('孤立任务');
    });

    it('有被依赖的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB];

      const result = planOrphanTask.check(taskA, { allTasks });

      expect(result).toBeNull();
    });

    it('有依赖的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: ['TASK-B'] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: [] });
      const allTasks = [taskA, taskB];

      const result = planOrphanTask.check(taskA, { allTasks });

      expect(result).toBeNull();
    });

    it('有子任务的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: [],
        subtaskIds: ['TASK-CHILD']
      });
      const allTasks = [taskA];

      const result = planOrphanTask.check(taskA, { allTasks });

      expect(result).toBeNull();
    });
  });

  describe('CP-8: plan-blocked-task 被阻塞任务检测', () => {
    it('应检测到所有依赖都未完成的任务', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', status: 'open' });
      const taskB = createTestTaskMeta({
        id: 'TASK-B',
        dependencies: ['TASK-A'],
        status: 'open'
      });
      const allTasks = [taskA, taskB];

      const result = planBlockedTask.check(taskB, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-blocked-task');
      expect(result?.severity).toBe('warning');
      expect(result?.message).toContain('被阻塞');
    });

    it('依赖已完成的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', status: 'resolved' });
      const taskB = createTestTaskMeta({
        id: 'TASK-B',
        dependencies: ['TASK-A'],
        status: 'open'
      });
      const allTasks = [taskA, taskB];

      const result = planBlockedTask.check(taskB, { allTasks });

      expect(result).toBeNull();
    });

    it('已完成的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', status: 'open' });
      const taskB = createTestTaskMeta({
        id: 'TASK-B',
        dependencies: ['TASK-A'],
        status: 'resolved'
      });
      const allTasks = [taskA, taskB];

      const result = planBlockedTask.check(taskB, { allTasks });

      expect(result).toBeNull();
    });

    it('无依赖的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const allTasks = [taskA];

      const result = planBlockedTask.check(taskA, { allTasks });

      expect(result).toBeNull();
    });
  });

  describe('CP-9: plan-bridge-node 桥接节点检测', () => {
    it('应检测到桥接节点（被多个任务依赖且检查点少）', () => {
      const bridgeTask = createTestTaskMeta({
        id: 'TASK-BRIDGE',
        dependencies: ['TASK-A'],
        checkpoints: []
      });
      const taskA = createTestTaskMeta({ id: 'TASK-A' });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-BRIDGE'] });
      const taskC = createTestTaskMeta({ id: 'TASK-C', dependencies: ['TASK-BRIDGE'] });
      const allTasks = [taskA, bridgeTask, taskB, taskC];

      const result = planBridgeNode.check(bridgeTask, { allTasks });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-bridge-node');
      expect(result?.severity).toBe('warning');
    });

    it('检查点充足的桥接任务不应返回警告', () => {
      const bridgeTask = createTestTaskMeta({
        id: 'TASK-BRIDGE',
        dependencies: ['TASK-A'],
        checkpoints: [
          { id: 'CP-1', description: '[ai review] 步骤1', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-2', description: '[ai review] 步骤2', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'CP-3', description: '[ai qa] 步骤3', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ]
      });
      const taskA = createTestTaskMeta({ id: 'TASK-A' });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-BRIDGE'] });
      const taskC = createTestTaskMeta({ id: 'TASK-C', dependencies: ['TASK-BRIDGE'] });
      const allTasks = [taskA, bridgeTask, taskB, taskC];

      const result = planBridgeNode.check(bridgeTask, { allTasks });

      expect(result).toBeNull();
    });

    it('无依赖的任务不应被识别为桥接节点', () => {
      const taskA = createTestTaskMeta({ id: 'TASK-A', dependencies: [] });
      const taskB = createTestTaskMeta({ id: 'TASK-B', dependencies: ['TASK-A'] });
      const taskC = createTestTaskMeta({ id: 'TASK-C', dependencies: ['TASK-A'] });
      const allTasks = [taskA, taskB, taskC];

      const result = planBridgeNode.check(taskA, { allTasks });

      expect(result).toBeNull();
    });
  });

  describe('CP-10: plan-inferred-only-dependency 仅推断依赖检测', () => {
    it('应检测到只有推断依赖的任务', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: ['TASK-B']
      });

      const result = planInferredOnlyDependency.check(taskA, { hasExplicitDeps: false });

      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe('plan-inferred-only-dependency');
      expect(result?.severity).toBe('warning');
    });

    it('有显式依赖的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: ['TASK-B']
      });

      const result = planInferredOnlyDependency.check(taskA, { hasExplicitDeps: true });

      expect(result).toBeNull();
    });

    it('无依赖的任务不应返回警告', () => {
      const taskA = createTestTaskMeta({
        id: 'TASK-A',
        dependencies: []
      });

      const result = planInferredOnlyDependency.check(taskA, { hasExplicitDeps: false });

      expect(result).toBeNull();
    });
  });

  describe('CP-11: PHASE_RULES.plan_recommend 包含警告性规则', () => {
    it('plan_recommend 阶段应包含 plan-orphan-task 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-orphan-task');
    });

    it('plan_recommend 阶段应包含 plan-blocked-task 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-blocked-task');
    });

    it('plan_recommend 阶段应包含 plan-bridge-node 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-bridge-node');
    });

    it('plan_recommend 阶段应包含 plan-inferred-only-dependency 规则', () => {
      expect(PHASE_RULES.plan_recommend).toContain('plan-inferred-only-dependency');
    });

    it('应能通过 getRulesForPhase 获取到警告性规则', () => {
      const rules = getRulesForPhase('plan_recommend');
      const ruleIds = rules.map(r => r.id);

      expect(ruleIds).toContain('plan-orphan-task');
      expect(ruleIds).toContain('plan-blocked-task');
      expect(ruleIds).toContain('plan-bridge-node');
      expect(ruleIds).toContain('plan-inferred-only-dependency');
    });
  });
});
