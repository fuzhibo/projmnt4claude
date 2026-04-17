/**
 * 质量门禁 - 动态上下文支持测试
 *
 * 测试重点:
 * - runQualityGate: 验证可接收 graph 等动态上下文
 * - batchRunQualityGate: 验证可接收并传递动态上下文
 * - 上下文正确传递到规则执行函数
 */

import { describe, it, expect } from 'bun:test';
import {
  runQualityGate,
  batchRunQualityGate,
  QUALITY_GATE_RULES,
  type QualityGatePhase,
} from '../utils/quality-gate-registry.js';
import type { TaskMeta } from '../types/task.js';
import type { QualityGateContext } from '../types/feedback-constraint.js';

// 辅助函数：创建测试任务
function createTestTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TEST-TASK-001',
    title: '测试任务',
    description: '这是一个测试任务描述，用于验证动态上下文传递。',
    type: 'feature',
    status: 'wait_review',
    priority: 'P1',
    dependencies: [],
    subtaskIds: [],
    checkpoints: [
      {
        id: 'CP-001',
        description: '[ai review] 验证功能实现',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'CP-002',
        description: '[ai qa] 运行单元测试',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    history: [],
    discussionTopics: [],
    fileWarnings: [],
    allowedTools: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as TaskMeta;
}

describe('runQualityGate - 动态上下文支持', () => {
  // ========== 基本上下文传递测试 ==========
  describe('基本上下文传递', () => {
    it('应接受并传递 expectedStatus 和 phase 上下文', () => {
      const task = createTestTask({
        id: 'TASK-001',
        status: 'wait_review',
        transitionNotes: [
          {
            fromStatus: 'in_progress',
            toStatus: 'wait_review',
            note: '开发完成，提交审核',
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const context: QualityGateContext = {
        expectedStatus: 'wait_review',
        phase: 'transition',
      };

      const result = runQualityGate(task, 'transition', context);

      // 验证结果包含正确的任务ID和阶段信息
      expect(result.taskId).toBe('TASK-001');
      expect(result.phase).toBe('transition');
      // 由于状态匹配，应该通过验证
      expect(result.passed).toBe(true);
    });

    it('应检测状态不匹配并返回错误', () => {
      const task = createTestTask({
        id: 'TASK-002',
        status: 'in_progress', // 实际状态
      });

      const context: QualityGateContext = {
        expectedStatus: 'wait_review', // 期望状态不同
        phase: 'transition',
      };

      const result = runQualityGate(task, 'transition', context);

      // 状态不匹配，应该失败
      expect(result.passed).toBe(false);
      // 应该包含状态不匹配的错误
      const statusError = result.errors.find(e => e.ruleId === 'status-transition-valid');
      expect(statusError).toBeDefined();
      expect(statusError?.message).toContain('状态不匹配');
    });
  });

  // ========== Graph 上下文测试 ==========
  describe('Graph 上下文支持', () => {
    it('应接受包含 graph 对象的上下文', () => {
      const task = createTestTask({
        id: 'TASK-003',
      });

      // 模拟传递 graph 上下文（用于依赖关系验证等场景）
      const context: QualityGateContext = {
        graph: {
          nodes: [
            { id: 'TASK-003', dependencies: [] },
            { id: 'TASK-004', dependencies: ['TASK-003'] },
          ],
          edges: [{ from: 'TASK-003', to: 'TASK-004' }],
        },
        phase: 'initialization',
      };

      const result = runQualityGate(task, 'initialization', context);

      // 验证执行成功，上下文被接受
      expect(result.taskId).toBe('TASK-003');
      expect(result.phase).toBe('initialization');
    });

    it('应接受包含自定义数据的上下文', () => {
      const task = createTestTask({
        id: 'TASK-004',
      });

      const context: QualityGateContext = {
        customData: { key: 'value', nested: { prop: 123 } },
        flags: ['flag1', 'flag2'],
        timestamp: Date.now(),
      };

      const result = runQualityGate(task, 'initialization', context);

      // 验证执行成功，自定义上下文被接受
      expect(result.taskId).toBe('TASK-004');
    });
  });

  // ========== 空上下文测试 ==========
  describe('空上下文兼容性', () => {
    it('不传上下文时应正常工作', () => {
      const task = createTestTask({
        id: 'TASK-005',
      });

      // 不传 context 参数
      const result = runQualityGate(task, 'initialization');

      expect(result.taskId).toBe('TASK-005');
      expect(result.phase).toBe('initialization');
      // 不应因为缺少上下文而失败
      expect(result.errors.filter(e => e.message.includes('context'))).toHaveLength(0);
    });

    it('传递空对象上下文时应正常工作', () => {
      const task = createTestTask({
        id: 'TASK-006',
      });

      const result = runQualityGate(task, 'initialization', {});

      expect(result.taskId).toBe('TASK-006');
      expect(result.passed).toBe(true);
    });
  });
});

describe('batchRunQualityGate - 动态上下文支持', () => {
  // ========== 批量上下文传递测试 ==========
  describe('批量上下文传递', () => {
    it('应将上下文传递给每个任务的验证', () => {
      const tasks: TaskMeta[] = [
        createTestTask({ id: 'TASK-BATCH-001', status: 'wait_review' }),
        createTestTask({ id: 'TASK-BATCH-002', status: 'wait_review' }),
      ];

      // 为每个任务添加 transitionNotes
      tasks[0]!.transitionNotes = [
        {
          fromStatus: 'in_progress',
          toStatus: 'wait_review',
          note: '完成',
          timestamp: new Date().toISOString(),
        },
      ];
      tasks[1]!.transitionNotes = [
        {
          fromStatus: 'in_progress',
          toStatus: 'wait_review',
          note: '完成',
          timestamp: new Date().toISOString(),
        },
      ];

      const context: QualityGateContext = {
        expectedStatus: 'wait_review',
        phase: 'transition',
        batchId: 'BATCH-001',
      };

      const result = batchRunQualityGate(tasks, 'transition', context);

      expect(result.totalTasks).toBe(2);
      expect(result.passedCount).toBe(2);
      expect(result.allPassed).toBe(true);
    });

    it('应正确处理批量验证中的状态不匹配', () => {
      const tasks: TaskMeta[] = [
        createTestTask({
          id: 'TASK-BATCH-003',
          status: 'wait_review',
          transitionNotes: [
            {
              fromStatus: 'in_progress',
              toStatus: 'wait_review',
              note: '开发完成',
              timestamp: new Date().toISOString(),
            },
          ],
        }),
        createTestTask({
          id: 'TASK-BATCH-004',
          status: 'in_progress', // 状态不匹配
          transitionNotes: [
            {
              fromStatus: 'open',
              toStatus: 'in_progress',
              note: '开始开发',
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      ];

      const context: QualityGateContext = {
        expectedStatus: 'wait_review',
        phase: 'transition',
      };

      const result = batchRunQualityGate(tasks, 'transition', context);

      expect(result.totalTasks).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.allPassed).toBe(false);

      // 验证失败的任务是 TASK-BATCH-004
      const failedResult = result.results.get('TASK-BATCH-004');
      expect(failedResult?.passed).toBe(false);
    });

    it('不传上下文时批量验证应正常工作', () => {
      const tasks: TaskMeta[] = [
        createTestTask({ id: 'TASK-BATCH-005' }),
        createTestTask({ id: 'TASK-BATCH-006' }),
      ];

      // 不传 context 参数
      const result = batchRunQualityGate(tasks, 'initialization');

      expect(result.totalTasks).toBe(2);
      expect(result.allPassed).toBe(true);
    });
  });
});

describe('ValidationRule 接口 - 动态上下文支持', () => {
  it('规则定义应支持动态上下文', () => {
    // 验证现有规则定义中包含支持上下文的规则
    const transitionRule = QUALITY_GATE_RULES['status-transition-valid'];
    expect(transitionRule).toBeDefined();

    // 验证规则可以执行并接收上下文
    const task = createTestTask({
      id: 'TASK-RULE-001',
      status: 'wait_review',
      transitionNotes: [
        {
          fromStatus: 'in_progress',
          toStatus: 'wait_review',
          note: '测试',
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const context: QualityGateContext = {
      expectedStatus: 'wait_review',
    };

    // 调用规则的 check 方法并传递上下文
    const violation = transitionRule.rule.check(task, context);
    expect(violation).toBeNull(); // 应该通过验证
  });

  it('规则应向后兼容（不传上下文）', () => {
    const transitionRule = QUALITY_GATE_RULES['status-transition-valid'];

    const task = createTestTask({
      id: 'TASK-RULE-002',
      status: 'in_progress',
    });

    // 不传上下文时，规则应返回 null（不执行验证）
    const violation = transitionRule.rule.check(task);
    expect(violation).toBeNull();
  });
});
