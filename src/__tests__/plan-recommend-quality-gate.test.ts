/**
 * Plan Recommend 质量门禁集成测试
 *
 * 验证 plan_recommend 阶段的质量门禁检查功能
 * - CP-1: plan_recommend 阶段规则执行
 * - CP-2: 质量门禁检查集成到 recommendPlan
 */

import { describe, it, expect } from 'bun:test';
import { runQualityGate, getRulesForPhase } from '../utils/quality-gate-registry';
import { runPlanQualityGateCheck, formatPlanQualityGateReport } from '../commands/plan';
import type { TaskMeta } from '../types/task';

// 创建完整的 TaskMeta 对象（包含所有必需字段）
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
    // 必需数组字段
    subtaskIds: [],
    discussionTopics: [],
    fileWarnings: [],
    allowedTools: [],
    ...overrides,
  };
}

describe('Plan Recommend 质量门禁集成', () => {
  describe('CP-1: plan_recommend 阶段规则', () => {
    it('plan_recommend 阶段应该包含正确的规则', () => {
      const rules = getRulesForPhase('plan_recommend');
      const ruleIds = rules.map(r => r.id);

      // 验证 plan_recommend 阶段包含核心规则
      expect(ruleIds).toContain('meta-json-valid');
      expect(ruleIds).toContain('checkpoint-array-not-empty');
      expect(ruleIds).toContain('checkpoint-required-prefix');
      expect(ruleIds).toContain('checkpoint-no-duplicate');
      expect(ruleIds).toContain('checkpoint-no-file-path');
      expect(ruleIds).toContain('checkpoint-count-control');
      expect(ruleIds).toContain('basic-fields-valid');
    });

    it('应该对高质量任务通过质量门禁', () => {
      const task = createTestTaskMeta({
        id: 'TASK-test-001',
        priority: 'P2',
        description: '## 问题描述\n这是一个测试任务描述，包含足够的上下文信息。\n\n## 解决方案\n1. 修改文件 A\n2. 更新文件 B\n\n## 相关文件\n- src/utils/test.ts',
        checkpoints: [
          {
            id: 'CP-001',
            description: '[ai review] 实现核心功能',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'CP-002',
            description: '[ai qa] 验证功能正确性',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const result = runQualityGate(task, 'plan_recommend');

      expect(result.phase).toBe('plan_recommend');
      expect(result.taskId).toBe('TASK-test-001');
      expect(result.passed).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('应该对低质量任务（缺少检查点）不通过质量门禁', () => {
      const task = createTestTaskMeta({
        id: 'TASK-test-002',
        priority: 'P0', // P0 任务要求检查点
        description: '## 问题描述\n这是一个测试任务描述。\n\n## 相关文件\n- src/utils/test.ts',
        checkpoints: [], // 缺少检查点
      });

      const result = runQualityGate(task, 'plan_recommend');

      expect(result.phase).toBe('plan_recommend');
      expect(result.taskId).toBe('TASK-test-002');
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.ruleId === 'checkpoint-array-not-empty')).toBe(true);
    });

    it('应该对缺少前缀的检查点任务不通过质量门禁', () => {
      const task = createTestTaskMeta({
        id: 'TASK-test-003',
        priority: 'P2',
        description: '## 问题描述\n这是一个测试任务描述。\n\n## 相关文件\n- src/utils/test.ts',
        checkpoints: [
          {
            id: 'CP-001',
            description: '实现核心功能', // 缺少前缀
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const result = runQualityGate(task, 'plan_recommend');

      expect(result.phase).toBe('plan_recommend');
      // 所有任务都需要检查点前缀
      expect(result.errors.some(e => e.ruleId === 'checkpoint-required-prefix')).toBe(true);
    });

    it('应该对基础字段无效的任务不通过质量门禁', () => {
      const task = createTestTaskMeta({
        id: '',
        title: '',
        description: '',
      });

      const result = runQualityGate(task, 'plan_recommend');

      expect(result.phase).toBe('plan_recommend');
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.ruleId === 'basic-fields-valid')).toBe(true);
    });
  });

  describe('CP-2: 质量门禁结果结构', () => {
    it('应该返回完整的验证结果结构', () => {
      const task = createTestTaskMeta({
        id: 'TASK-test-004',
        priority: 'P2',
        description: '## 问题描述\n这是一个测试任务。\n\n## 相关文件\n- src/utils/test.ts',
        checkpoints: [
          {
            id: 'CP-001',
            description: '[ai review] 实现功能',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const result = runQualityGate(task, 'plan_recommend');

      // 验证结果结构
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('phase');
      expect(result).toHaveProperty('taskId');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('validatedAt');
      expect(result).toHaveProperty('rulesExecuted');
      expect(result).toHaveProperty('rulesSkipped');

      // 验证类型
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.phase).toBe('string');
      expect(typeof result.taskId).toBe('string');
      expect(Array.isArray(result.violations)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(typeof result.validatedAt).toBe('string');
      expect(typeof result.rulesExecuted).toBe('number');
      expect(typeof result.rulesSkipped).toBe('number');
    });

    it('应该记录验证时间戳', () => {
      const task = createTestTaskMeta({
        id: 'TASK-test-005',
        priority: 'P2',
        description: '## 问题描述\n测试描述\n\n## 相关文件\n- src/utils/test.ts',
      });

      const beforeTime = Date.now();
      const result = runQualityGate(task, 'plan_recommend');
      const afterTime = Date.now();

      const validatedTime = new Date(result.validatedAt).getTime();
      expect(validatedTime).toBeGreaterThanOrEqual(beforeTime);
      expect(validatedTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('QualityGatePhase 类型扩展', () => {
    it('plan_recommend 应该是有效的 QualityGatePhase', () => {
      const phases = ['plan_recommend', 'initialization', 'transition', 'execution', 'completion'];

      for (const phase of phases) {
        const rules = getRulesForPhase(phase as any);
        expect(rules).toBeDefined();
        expect(Array.isArray(rules)).toBe(true);
      }
    });

    it('plan_recommend 阶段应该包含核心规则', () => {
      const planRecommendRules = getRulesForPhase('plan_recommend');

      // plan_recommend 专注于核心质量检查，规则数量应该适中
      expect(planRecommendRules.length).toBeGreaterThan(0);
      // 验证包含阻断性和警告性质量门禁规则
      const ruleIds = planRecommendRules.map(r => r.id);
      expect(ruleIds).toContain('plan-cycle-detection');
      expect(ruleIds).toContain('plan-orphan-task');
      expect(ruleIds).toContain('plan-blocked-task');
    });
  });

  describe('CP-3: runPlanQualityGateCheck 函数', () => {
    it('应该返回完整的质量门禁检查结果', () => {
      const tasks = [
        createTestTaskMeta({
          id: 'TASK-test-001',
          priority: 'P2',
          description: '## 问题描述\n这是一个测试任务。\n\n## 相关文件\n- src/utils/test.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ];

      const result = runPlanQualityGateCheck(tasks);

      // 验证结果结构
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('totalTasks');
      expect(result).toHaveProperty('passedCount');
      expect(result).toHaveProperty('failedCount');
      expect(result).toHaveProperty('failedTasks');
      expect(result).toHaveProperty('validationResults');
      expect(result).toHaveProperty('validatedAt');

      // 验证类型
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.totalTasks).toBe('number');
      expect(typeof result.passedCount).toBe('number');
      expect(typeof result.failedCount).toBe('number');
      expect(Array.isArray(result.failedTasks)).toBe(true);
      expect(Array.isArray(result.validationResults)).toBe(true);
      expect(typeof result.validatedAt).toBe('string');
    });

    it('应该正确统计通过和未通过的任务', () => {
      const tasks = [
        createTestTaskMeta({
          id: 'TASK-pass-001',
          priority: 'P2',
          description: '## 问题描述\n这是一个测试任务。\n\n## 相关文件\n- src/utils/test.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
        createTestTaskMeta({
          id: 'TASK-fail-001',
          priority: 'P0',
          description: '## 问题描述\n这是一个P0任务。',
          checkpoints: [], // P0任务缺少检查点，应该失败
        }),
      ];

      const result = runPlanQualityGateCheck(tasks);

      expect(result.totalTasks).toBe(2);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.failedTasks).toContain('TASK-fail-001');
      expect(result.failedTasks).not.toContain('TASK-pass-001');
    });

    it('应该支持指定验证阶段', () => {
      const tasks = [
        createTestTaskMeta({
          id: 'TASK-phase-001',
          priority: 'P2',
          description: '## 问题描述\n测试任务。\n\n## 相关文件\n- src/utils/test.ts',
        }),
      ];

      // 测试 plan_recommend 阶段
      const planResult = runPlanQualityGateCheck(tasks, { phase: 'plan_recommend' });
      expect(planResult.validationResults[0]?.phase).toBe('plan_recommend');

      // 测试 initialization 阶段
      const initResult = runPlanQualityGateCheck(tasks, { phase: 'initialization' });
      expect(initResult.validationResults[0]?.phase).toBe('initialization');
    });

    it('应该正确处理空任务列表', () => {
      const result = runPlanQualityGateCheck([]);

      expect(result.totalTasks).toBe(0);
      expect(result.passedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.passed).toBe(true);
      expect(result.validationResults).toHaveLength(0);
    });

    it('应该支持忽略警告级别的检查', () => {
      const tasks = [
        createTestTaskMeta({
          id: 'TASK-warning-001',
          priority: 'P2',
          description: '## 问题描述\n这是一个孤立任务。\n\n## 相关文件\n- src/utils/test.ts',
          dependencies: [], // 孤立任务可能有警告
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ];

      // 包含警告
      const withWarnings = runPlanQualityGateCheck(tasks, { includeWarnings: true });
      // 不包含警告
      const withoutWarnings = runPlanQualityGateCheck(tasks, { includeWarnings: false });

      // 两者都应该返回结果
      expect(withWarnings).toHaveProperty('passed');
      expect(withoutWarnings).toHaveProperty('passed');
    });
  });

  describe('CP-4: formatPlanQualityGateReport 函数', () => {
    it('应该生成格式化的质量门禁报告', () => {
      const result = runPlanQualityGateCheck([
        createTestTaskMeta({
          id: 'TASK-report-001',
          priority: 'P2',
          description: '## 问题描述\n测试任务。\n\n## 相关文件\n- src/utils/test.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ]);

      const report = formatPlanQualityGateReport(result);

      // 验证报告内容
      expect(report).toContain('Plan 质量门禁检查报告');
      expect(report).toContain('统计摘要');
      expect(report).toContain('总任务数: 1');
      expect(report).toContain('通过: 1');
      expect(report).toContain('验证时间');
    });

    it('应该显示未通过任务的详细信息', () => {
      const result = runPlanQualityGateCheck([
        createTestTaskMeta({
          id: 'TASK-fail-report-001',
          priority: 'P0',
          description: '## 问题描述\nP0任务缺少检查点。',
          checkpoints: [], // 会失败
        }),
      ]);

      const report = formatPlanQualityGateReport(result, { showDetails: true });

      // 验证失败报告内容
      expect(report).toContain('未通过的任务');
      expect(report).toContain('TASK-fail-report-001');
      expect(report).toContain('修复建议');
    });

    it('应该支持紧凑模式', () => {
      const result = runPlanQualityGateCheck([
        createTestTaskMeta({
          id: 'TASK-compact-001',
          priority: 'P2',
          description: '## 问题描述\n测试任务。\n\n## 相关文件\n- src/utils/test.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ]);

      const compactReport = formatPlanQualityGateReport(result, { compact: true });
      const normalReport = formatPlanQualityGateReport(result, { compact: false });

      // 紧凑模式应该使用短分隔符
      expect(compactReport).toContain('---');
      // 正常模式应该使用长分隔符
      expect(normalReport).toContain('━');
    });

    it('应该显示通过状态', () => {
      const passResult = runPlanQualityGateCheck([
        createTestTaskMeta({
          id: 'TASK-pass-report-001',
          priority: 'P2',
          description: '## 问题描述\n测试任务。\n\n## 相关文件\n- src/utils/test.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ]);

      const report = formatPlanQualityGateReport(passResult);

      expect(report).toContain('✅');
      expect(report).toContain('所有任务通过 Plan 质量门禁检查');
    });
  });

  describe('CP-5: --all 模式质量门禁集成', () => {
    it('应该在 --all 模式下执行质量门禁检查', () => {
      // 模拟 --all 模式下的任务列表（包含多种状态的任务）
      const tasks = [
        createTestTaskMeta({
          id: 'TASK-all-001',
          priority: 'P2',
          status: 'open',
          description: '## 问题描述\n测试任务1。\n\n## 相关文件\n- src/utils/test1.ts',
          checkpoints: [
            {
              id: 'CP-001',
              description: '[ai review] 实现功能1',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
        createTestTaskMeta({
          id: 'TASK-all-002',
          priority: 'P1',
          status: 'in_progress',
          description: '## 问题描述\n测试任务2。\n\n## 相关文件\n- src/utils/test2.ts',
          checkpoints: [
            {
              id: 'CP-002',
              description: '[ai review] 实现功能2',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ];

      const result = runPlanQualityGateCheck(tasks);

      // 验证所有任务都经过了质量门禁检查
      expect(result.totalTasks).toBe(2);
      expect(result.validationResults).toHaveLength(2);
      expect(result.validationResults[0]?.taskId).toBe('TASK-all-001');
      expect(result.validationResults[1]?.taskId).toBe('TASK-all-002');
    });
  });
});
