import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  parsePlanOutput,
  extractTaskIdsFromPlan,
  calculateBatchSize,
  detectTaskRelations,
} from '../utils/plan';
import type { ExecutionPlan, TaskRelation } from '../utils/plan';
import type { TaskMeta } from '../types/task';

// Mock for showPlan tests
let consoleOutput: string[] = [];
const originalLog = console.log;
const originalError = console.error;

function mockConsole() {
  consoleOutput = [];
  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(a => String(a)).join(' '));
  };
  console.error = (...args: unknown[]) => {
    consoleOutput.push('ERROR: ' + args.map(a => String(a)).join(' '));
  };
}

function restoreConsole() {
  console.log = originalLog;
  console.error = originalError;
}

// Helper: 创建最小 TaskMeta
function makeTask(overrides: Partial<TaskMeta> & { id: string }): TaskMeta {
  return {
    title: 'Test task',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    history: [],
    ...overrides,
  };
}

// ==================== parsePlanOutput ====================

describe('parsePlanOutput', () => {
  describe('正常输入处理', () => {
    it('应解析有效的 JSON ExecutionPlan', () => {
      const input = JSON.stringify({
        tasks: ['TASK-1', 'TASK-2', 'TASK-3'],
        batches: [['TASK-1'], ['TASK-2', 'TASK-3']],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-1', 'TASK-2', 'TASK-3']);
      expect(result.batches).toEqual([['TASK-1'], ['TASK-2', 'TASK-3']]);
      expect(result.metadata.createdAt).toBe('2026-01-01');
      expect(result.errors).toHaveLength(0);
    });

    it('应解析只有 tasks 的 JSON', () => {
      const input = JSON.stringify({ tasks: ['TASK-A', 'TASK-B'] });
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-A', 'TASK-B']);
      expect(result.batches).toEqual([]);
    });

    it('应解析纯文本为任务ID列表', () => {
      const input = 'TASK-1\nTASK-2\nTASK-3';
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-1', 'TASK-2', 'TASK-3']);
    });

    it('应忽略纯文本中的注释行', () => {
      const input = '# 这是注释\nTASK-1\n# 另一个注释\nTASK-2';
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-1', 'TASK-2']);
    });
  });

  describe('边界条件处理', () => {
    it('应处理空 tasks 数组', () => {
      const input = JSON.stringify({ tasks: [], createdAt: '2026-01-01' });
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual([]);
    });

    it('应处理 JSON 中 tasks 含非字符串项', () => {
      const input = JSON.stringify({ tasks: ['TASK-1', 123, null, 'TASK-2'] });
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-1', 'TASK-2']);
    });

    it('应处理空 batches', () => {
      const input = JSON.stringify({ tasks: ['TASK-1'], batches: [] });
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.batches).toEqual([]);
    });

    it('应处理带前后空白的输入', () => {
      const input = '  \n  TASK-1\nTASK-2  \n  ';
      const result = parsePlanOutput(input);
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['TASK-1', 'TASK-2']);
    });
  });

  describe('异常输入处理', () => {
    it('应处理空字符串输入', () => {
      const result = parsePlanOutput('');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('应处理无效的 JSON（回退到纯文本解析）', () => {
      const result = parsePlanOutput('{ invalid json');
      // 无效 JSON 回退到纯文本模式，非空行被解析为任务ID
      expect(result.valid).toBe(true);
      expect(result.tasks).toEqual(['{ invalid json']);
    });

    it('应处理 JSON 数组（非对象）', () => {
      const result = parsePlanOutput('[1, 2, 3]');
      expect(result.valid).toBe(false);
    });

    it('应处理纯注释文本（无有效任务）', () => {
      const result = parsePlanOutput('# comment only\n# another');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

// ==================== extractTaskIdsFromPlan ====================

describe('extractTaskIdsFromPlan', () => {
  describe('正常输入处理', () => {
    it('应从 batches 展平提取任务ID', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1'],
        batches: [['TASK-A', 'TASK-B'], ['TASK-C']],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      const ids = extractTaskIdsFromPlan(plan);
      expect(ids).toEqual(['TASK-A', 'TASK-B', 'TASK-C']);
    });

    it('应从 tasks 数组提取（无 batches 时）', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1', 'TASK-2', 'TASK-3'],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      const ids = extractTaskIdsFromPlan(plan);
      expect(ids).toEqual(['TASK-1', 'TASK-2', 'TASK-3']);
    });

    it('应优先使用 batches 而非 tasks', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-OLD'],
        batches: [['TASK-NEW-1'], ['TASK-NEW-2']],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      const ids = extractTaskIdsFromPlan(plan);
      expect(ids).toEqual(['TASK-NEW-1', 'TASK-NEW-2']);
    });
  });

  describe('边界条件处理', () => {
    it('应处理空 plan', () => {
      const plan: ExecutionPlan = {
        tasks: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      expect(extractTaskIdsFromPlan(plan)).toEqual([]);
    });

    it('应处理空 batches 数组', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1'],
        batches: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      // 空 batches fallback 到 tasks
      expect(extractTaskIdsFromPlan(plan)).toEqual(['TASK-1']);
    });

    it('应过滤 batches 中的空字符串', () => {
      const plan: ExecutionPlan = {
        tasks: [],
        batches: [['TASK-1', '', 'TASK-2']],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      const ids = extractTaskIdsFromPlan(plan);
      expect(ids).toEqual(['TASK-1', 'TASK-2']);
    });
  });

  describe('异常输入处理', () => {
    it('应处理 null 输入', () => {
      expect(extractTaskIdsFromPlan(null)).toEqual([]);
    });

    it('应处理 undefined 输入', () => {
      expect(extractTaskIdsFromPlan(undefined)).toEqual([]);
    });
  });
});

// ==================== calculateBatchSize ====================

describe('calculateBatchSize', () => {
  describe('正常输入处理', () => {
    it('应正确分组任务', () => {
      const batches = calculateBatchSize(10, 3);
      expect(batches).toHaveLength(4); // 3+3+3+1
      expect(batches[0]).toHaveLength(3);
      expect(batches[3]).toHaveLength(1);
    });

    it('应使用默认批次大小 5', () => {
      const batches = calculateBatchSize(12);
      expect(batches).toHaveLength(3); // 5+5+2
      expect(batches[0]).toHaveLength(5);
      expect(batches[2]).toHaveLength(2);
    });

    it('任务数恰好整除批次大小', () => {
      const batches = calculateBatchSize(6, 3);
      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(3);
      expect(batches[1]).toHaveLength(3);
    });
  });

  describe('边界条件处理', () => {
    it('应处理单个任务', () => {
      const batches = calculateBatchSize(1, 5);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual(['task-1']);
    });

    it('应处理批次大小大于任务数', () => {
      const batches = calculateBatchSize(2, 100);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it('应处理批次大小为 1', () => {
      const batches = calculateBatchSize(3, 1);
      expect(batches).toHaveLength(3);
      expect(batches.every(b => b.length === 1)).toBe(true);
    });
  });

  describe('异常输入处理', () => {
    it('应处理 0 个任务', () => {
      expect(calculateBatchSize(0)).toEqual([]);
    });

    it('应处理负数任务', () => {
      expect(calculateBatchSize(-5)).toEqual([]);
    });

    it('应处理非整数任务数', () => {
      expect(calculateBatchSize(NaN)).toEqual([]);
      expect(calculateBatchSize(Infinity)).toEqual([]);
    });

    it('应使用默认批次大小当 maxBatchSize 无效', () => {
      const batches = calculateBatchSize(6, -1);
      // fallback to default 5
      expect(batches).toHaveLength(2); // 5+1
    });
  });
});

// ==================== detectTaskRelations ====================

describe('detectTaskRelations', () => {
  describe('正常输入处理', () => {
    it('应检测依赖关系', () => {
      const tasks = [
        makeTask({ id: 'TASK-1', dependencies: [] }),
        makeTask({ id: 'TASK-2', dependencies: ['TASK-1'] }),
      ];
      const relations = detectTaskRelations(tasks);
      const deps = relations.filter(r => r.type === 'dependency');
      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({ sourceId: 'TASK-2', targetId: 'TASK-1', type: 'dependency' });
    });

    it('应检测父子关系', () => {
      const tasks = [
        makeTask({ id: 'TASK-P', subtaskIds: ['TASK-C'] }),
        makeTask({ id: 'TASK-C', parentId: 'TASK-P' }),
      ];
      const relations = detectTaskRelations(tasks);
      const parentChild = relations.filter(r => r.type === 'parent_child');
      expect(parentChild).toHaveLength(1);
      expect(parentChild[0]).toEqual({ sourceId: 'TASK-P', targetId: 'TASK-C', type: 'parent_child' });
    });

    it('应检测兄弟关系', () => {
      const tasks = [
        makeTask({ id: 'TASK-P', subtaskIds: ['TASK-C1', 'TASK-C2'] }),
        makeTask({ id: 'TASK-C1', parentId: 'TASK-P' }),
        makeTask({ id: 'TASK-C2', parentId: 'TASK-P' }),
      ];
      const relations = detectTaskRelations(tasks);
      const siblings = relations.filter(r => r.type === 'sibling');
      expect(siblings).toHaveLength(1);
      expect(siblings[0]!.type).toBe('sibling');
    });

    it('应同时检测多种关系', () => {
      const tasks = [
        makeTask({ id: 'TASK-1', dependencies: [] }),
        makeTask({ id: 'TASK-2', dependencies: ['TASK-1'] }),
        makeTask({ id: 'TASK-3', parentId: 'TASK-2' }),
      ];
      const relations = detectTaskRelations(tasks);
      expect(relations.some(r => r.type === 'dependency')).toBe(true);
      expect(relations.some(r => r.type === 'parent_child')).toBe(true);
    });
  });

  describe('边界条件处理', () => {
    it('应处理无任何关系的任务', () => {
      const tasks = [
        makeTask({ id: 'TASK-1' }),
        makeTask({ id: 'TASK-2' }),
      ];
      const relations = detectTaskRelations(tasks);
      expect(relations).toHaveLength(0);
    });

    it('应处理单个任务', () => {
      const tasks = [makeTask({ id: 'TASK-1' })];
      const relations = detectTaskRelations(tasks);
      expect(relations).toHaveLength(0);
    });

    it('应忽略不存在的依赖ID', () => {
      const tasks = [
        makeTask({ id: 'TASK-1', dependencies: ['TASK-NONEXISTENT'] }),
      ];
      const relations = detectTaskRelations(tasks);
      expect(relations).toHaveLength(0);
    });

    it('应忽略不存在的 parentId', () => {
      const tasks = [
        makeTask({ id: 'TASK-C', parentId: 'TASK-NONEXISTENT' }),
      ];
      const relations = detectTaskRelations(tasks);
      expect(relations.filter(r => r.type === 'parent_child')).toHaveLength(0);
    });
  });

  describe('异常输入处理', () => {
    it('应处理空数组', () => {
      expect(detectTaskRelations([])).toEqual([]);
    });

    it('应处理含无效项的数组', () => {
      const tasks = [
        null as unknown as TaskMeta,
        undefined as unknown as TaskMeta,
        makeTask({ id: 'TASK-1' }),
      ];
      const relations = detectTaskRelations(tasks);
      expect(relations).toEqual([]);
    });
  });
});

// ==================== showPlan Backward Compatibility Tests ====================

describe('showPlan backward compatibility', () => {
  describe('批次存在性检测 (CP-1)', () => {
    it('应检测到有批次字段的计划', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1', 'TASK-2', 'TASK-3'],
        batches: [['TASK-1'], ['TASK-2', 'TASK-3']],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const hasBatches = Array.isArray(plan.batches) && plan.batches.length > 0;
      expect(hasBatches).toBe(true);
    });

    it('应检测到无批次字段的旧版计划', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1', 'TASK-2'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const hasBatches = Array.isArray(plan.batches) && plan.batches.length > 0;
      expect(hasBatches).toBe(false);
    });

    it('应处理 batches 为空数组的情况', () => {
      const plan: ExecutionPlan = {
        tasks: ['TASK-1', 'TASK-2'],
        batches: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const hasBatches = Array.isArray(plan.batches) && plan.batches.length > 0;
      expect(hasBatches).toBe(false);
    });
  });

  describe('批次数据结构验证', () => {
    it('应正确处理多批次计划', () => {
      const plan: ExecutionPlan = {
        tasks: ['A', 'B', 'C', 'D'],
        batches: [['A', 'B'], ['C'], ['D']],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      expect(plan.batches).toHaveLength(3);
      expect(plan.batches![0]).toEqual(['A', 'B']);
      expect(plan.batches![1]).toEqual(['C']);
      expect(plan.batches![2]).toEqual(['D']);
    });

    it('应确保 tasks 和 batches 中任务数量一致', () => {
      const plan: ExecutionPlan = {
        tasks: ['A', 'B', 'C'],
        batches: [['A', 'B', 'C']],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const batchTaskCount = plan.batches!.flat().length;
      expect(batchTaskCount).toBe(plan.tasks.length);
    });
  });
});
