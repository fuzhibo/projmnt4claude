/**
 * task-validation.ts 单元测试
 *
 * 测试覆盖:
 * - validateFieldUpdate (字段更新验证)
 * - validateRelationship (关系操作验证)
 * - validateTaskBeforeWrite (组合验证)
 * - validatedWriteTaskMeta (带验证的写入)
 * - Schema 迁移验证
 * - Checkpoint 操作验证
 * - Backfill 验证
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta } from '../types/task';
import { createDefaultTaskMeta, CURRENT_TASK_SCHEMA_VERSION } from '../types/task';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// Import validation module
const validationUtils = () => import('../utils/task-validation.js');
const taskUtils = () => import('../utils/task.js');

function makeTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    ...createDefaultTaskMeta('TASK-001', 'Test Task'),
    ...overrides,
  };
}

function writeTaskToDisk(taskDir: string, task: TaskMeta): void {
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }
  fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2), 'utf-8');
}

// ============================================================
// CP-1: 字段验证规则测试
// ============================================================

describe('validateFieldUpdate', () => {
  it('验证 priority 字段 - 合法值 P0-P3, Q1-Q4', async () => {
    const { validateFieldUpdate, VALID_PRIORITIES } = await validationUtils();

    // 合法值
    for (const p of VALID_PRIORITIES) {
      const result = validateFieldUpdate('priority', p);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    }

    // 非法值
    const invalidResult = validateFieldUpdate('priority', 'P5');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some(e => e.includes('P5'))).toBe(true);

    const emptyResult = validateFieldUpdate('priority', '');
    expect(emptyResult.valid).toBe(false);
  });

  it('验证 type 字段 - 仅允许合法任务类型', async () => {
    const { validateFieldUpdate, VALID_TYPES } = await validationUtils();

    // 合法值
    for (const t of VALID_TYPES) {
      const result = validateFieldUpdate('type', t);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    }

    // 非法值
    const invalidResult = validateFieldUpdate('type', 'invalid_type');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some(e => e.includes('invalid_type'))).toBe(true);
  });

  it('验证 title 字段 - 非空且长度限制', async () => {
    const { validateFieldUpdate, TITLE_MAX_LENGTH } = await validationUtils();

    // 合法标题
    const validResult = validateFieldUpdate('title', 'Valid Title');
    expect(validResult.valid).toBe(true);

    // 空标题
    const emptyResult = validateFieldUpdate('title', '');
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.some(e => e.includes('不能为空'))).toBe(true);

    // 空白标题
    const whitespaceResult = validateFieldUpdate('title', '   ');
    expect(whitespaceResult.valid).toBe(false);

    // 超长标题
    const longTitle = 'a'.repeat(TITLE_MAX_LENGTH + 1);
    const longResult = validateFieldUpdate('title', longTitle);
    expect(longResult.valid).toBe(false);
    expect(longResult.errors.some(e => e.includes('超过上限'))).toBe(true);

    // 边界值 - 正好等于最大长度
    const maxTitle = 'a'.repeat(TITLE_MAX_LENGTH);
    const maxResult = validateFieldUpdate('title', maxTitle);
    expect(maxResult.valid).toBe(true);
  });

  it('验证 description 字段 - 长度限制', async () => {
    const { validateFieldUpdate, DESCRIPTION_MAX_LENGTH } = await validationUtils();

    // 合法描述
    const validResult = validateFieldUpdate('description', 'Valid description');
    expect(validResult.valid).toBe(true);

    // null/undefined 描述
    const nullResult = validateFieldUpdate('description', null);
    expect(nullResult.valid).toBe(true);

    const undefinedResult = validateFieldUpdate('description', undefined);
    expect(undefinedResult.valid).toBe(true);

    // 超长描述
    const longDesc = 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1);
    const longResult = validateFieldUpdate('description', longDesc);
    expect(longResult.valid).toBe(true); // 描述超长是警告不是错误
    expect(longResult.warnings.some(e => e.includes('超过上限'))).toBe(true);

    // 非字符串描述
    const invalidTypeResult = validateFieldUpdate('description', 123);
    expect(invalidTypeResult.valid).toBe(false);
    expect(invalidTypeResult.errors.some(e => e.includes('字符串'))).toBe(true);
  });

  it('未知字段不触发验证错误', async () => {
    const { validateFieldUpdate } = await validationUtils();

    const result = validateFieldUpdate('unknownField', 'anyValue');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ============================================================
// CP-2: 关系验证规则测试
// ============================================================

describe('validateRelationship', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('验证 parentId - 父任务必须存在', async () => {
    const { validateRelationship } = await validationUtils();
    const { writeTaskMeta } = await taskUtils();

    // 创建父任务
    const parentTask = makeTask({ id: 'TASK-PARENT' });
    writeTaskMeta(parentTask, env.tempDir);

    // 合法 parentId
    const validResult = validateRelationship('TASK-CHILD', { parentId: 'TASK-PARENT' }, env.tempDir);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toEqual([]);

    // 不存在的父任务
    const invalidResult = validateRelationship('TASK-CHILD', { parentId: 'TASK-NONEXIST' }, env.tempDir);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some(e => e.includes('不存在'))).toBe(true);
  });

  it('验证 parentId - 禁止自引用', async () => {
    const { validateRelationship } = await validationUtils();

    const result = validateRelationship('TASK-001', { parentId: 'TASK-001' }, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('自引用'))).toBe(true);
  });

  it('验证 parentId - 禁止循环引用', async () => {
    const { validateRelationship } = await validationUtils();
    const { writeTaskMeta } = await taskUtils();

    // 创建任务链: A -> B -> C
    const taskA = makeTask({ id: 'TASK-A' });
    const taskB = makeTask({ id: 'TASK-B', parentId: 'TASK-A' });
    const taskC = makeTask({ id: 'TASK-C', parentId: 'TASK-B' });

    writeTaskMeta(taskA, env.tempDir);
    writeTaskMeta(taskB, env.tempDir);
    writeTaskMeta(taskC, env.tempDir);

    // 尝试将 A 的 parent 设为 C，形成循环: A -> B -> C -> A
    const result = validateRelationship('TASK-A', { parentId: 'TASK-C' }, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('循环'))).toBe(true);
  });

  it('验证 subtaskIds - 子任务必须存在', async () => {
    const { validateRelationship } = await validationUtils();
    const { writeTaskMeta } = await taskUtils();

    // 创建子任务
    const subtask1 = makeTask({ id: 'TASK-SUB-1' });
    const subtask2 = makeTask({ id: 'TASK-SUB-2' });
    writeTaskMeta(subtask1, env.tempDir);
    writeTaskMeta(subtask2, env.tempDir);

    // 合法 subtaskIds
    const validResult = validateRelationship('TASK-PARENT', { subtaskIds: ['TASK-SUB-1', 'TASK-SUB-2'] }, env.tempDir);
    expect(validResult.valid).toBe(true);

    // 包含不存在的子任务
    const invalidResult = validateRelationship('TASK-PARENT', { subtaskIds: ['TASK-SUB-1', 'TASK-NONEXIST'] }, env.tempDir);
    expect(invalidResult.valid).toBe(true); // 子任务不存在是警告不是错误
    expect(invalidResult.warnings.some(e => e.includes('不存在'))).toBe(true);
  });

  it('验证空 subtaskIds 不触发警告', async () => {
    const { validateRelationship } = await validationUtils();

    const result = validateRelationship('TASK-001', { subtaskIds: [] }, env.tempDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('验证 null parentId 不触发错误', async () => {
    const { validateRelationship } = await validationUtils();

    const result = validateRelationship('TASK-001', { parentId: null }, env.tempDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ============================================================
// CP-3: 组合验证测试
// ============================================================

describe('validateTaskBeforeWrite', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('验证合法任务通过', async () => {
    const { validateTaskBeforeWrite } = await validationUtils();

    const task = makeTask({
      id: 'TASK-001',
      type: 'feature',
      priority: 'P2',
      title: 'Valid Task',
      description: 'Valid description',
    });

    const result = validateTaskBeforeWrite(task, env.tempDir, null);
    expect(result.valid).toBe(true);
  });

  it('验证非法字段返回错误', async () => {
    const { validateTaskBeforeWrite } = await validationUtils();

    const task = makeTask({
      id: 'TASK-001',
      type: 'invalid_type' as TaskMeta['type'],
      priority: 'P5' as TaskMeta['priority'],
      title: '',
    });

    const result = validateTaskBeforeWrite(task, env.tempDir, null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('验证 schema 版本单调递增', async () => {
    const { validateTaskBeforeWrite } = await validationUtils();

    const oldTask = makeTask({ id: 'TASK-001', schemaVersion: 2 });
    const newTask = makeTask({ id: 'TASK-001', schemaVersion: 1 });

    const result = validateTaskBeforeWrite(newTask, env.tempDir, oldTask);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('schemaVersion'))).toBe(true);
  });

  it('验证 schema 版本不超过当前版本', async () => {
    const { validateTaskBeforeWrite } = await validationUtils();

    const oldTask = makeTask({ id: 'TASK-001', schemaVersion: CURRENT_TASK_SCHEMA_VERSION });
    const newTask = makeTask({
      id: 'TASK-001',
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION + 10,
    });

    const result = validateTaskBeforeWrite(newTask, env.tempDir, oldTask);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('超过'))).toBe(true);
  });

  it('验证数组字段不为 null', async () => {
    const { validateTaskBeforeWrite } = await validationUtils();

    const task = makeTask({ id: 'TASK-001' });
    (task as unknown as Record<string, unknown>).dependencies = null;

    const result = validateTaskBeforeWrite(task, env.tempDir, null);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dependencies'))).toBe(true);
  });
});

// ============================================================
// validatedWriteTaskMeta 测试
// ============================================================

describe('validatedWriteTaskMeta', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('带验证的任务写入成功', async () => {
    const { validatedWriteTaskMeta } = await validationUtils();
    const { readTaskMeta } = await taskUtils();

    const task = makeTask({ id: 'TASK-001', title: 'Test' });
    const result = validatedWriteTaskMeta(task, env.tempDir);

    expect(result.validation.valid).toBe(true);

    const read = readTaskMeta('TASK-001', env.tempDir);
    expect(read).not.toBeNull();
    expect(read!.title).toBe('Test');
  });

  it('验证失败仍写入但输出警告', async () => {
    const { validatedWriteTaskMeta } = await validationUtils();
    const { readTaskMeta } = await taskUtils();

    const task = makeTask({
      id: 'TASK-001',
      type: 'invalid_type' as TaskMeta['type'],
    });

    const result = validatedWriteTaskMeta(task, env.tempDir);

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);

    // 验证失败的任务仍然被写入
    const read = readTaskMeta('TASK-001', env.tempDir);
    expect(read).not.toBeNull();
  });
});

// ============================================================
// Checkpoint 验证测试
// ============================================================

describe('validateCheckpointTransition', () => {
  it('验证合法检查点状态转换', async () => {
    const { validateCheckpointTransition } = await validationUtils();

    // pending -> completed
    const r1 = validateCheckpointTransition('pending', 'completed');
    expect(r1.valid).toBe(true);

    // pending -> failed
    const r2 = validateCheckpointTransition('pending', 'failed');
    expect(r2.valid).toBe(true);

    // pending -> skipped
    const r3 = validateCheckpointTransition('pending', 'skipped');
    expect(r3.valid).toBe(true);

    // failed -> pending
    const r4 = validateCheckpointTransition('failed', 'pending');
    expect(r4.valid).toBe(true);

    // 相同状态
    const r5 = validateCheckpointTransition('completed', 'completed');
    expect(r5.valid).toBe(true);
  });

  it('验证非法检查点状态转换', async () => {
    const { validateCheckpointTransition } = await validationUtils();

    // completed -> pending (不允许回退)
    const r1 = validateCheckpointTransition('completed', 'pending');
    expect(r1.valid).toBe(false);

    // skipped -> completed (必须先转回 pending)
    const r2 = validateCheckpointTransition('skipped', 'completed');
    expect(r2.valid).toBe(false);
  });
});

// ============================================================
// Verification Backfill 验证测试
// ============================================================

describe('validateVerificationBackfill', () => {
  it('验证合法的 verification 数据', async () => {
    const { validateVerificationBackfill } = await validationUtils();

    const verification = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'system',
      result: 'passed' as const,
      checkpointCompletionRate: 100,
    };

    const result = validateVerificationBackfill(verification);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('验证缺失必填字段', async () => {
    const { validateVerificationBackfill } = await validationUtils();

    // 缺少 verifiedAt
    const v1 = { verifiedBy: 'system', result: 'passed' as const };
    const r1 = validateVerificationBackfill(v1 as TaskMeta['verification']!);
    expect(r1.valid).toBe(false);
    expect(r1.errors.some(e => e.includes('verifiedAt'))).toBe(true);

    // 缺少 verifiedBy
    const v2 = { verifiedAt: new Date().toISOString(), result: 'passed' as const };
    const r2 = validateVerificationBackfill(v2 as TaskMeta['verification']!);
    expect(r2.valid).toBe(false);
    expect(r2.errors.some(e => e.includes('verifiedBy'))).toBe(true);
  });

  it('验证非法的 result 值', async () => {
    const { validateVerificationBackfill } = await validationUtils();

    const verification = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'system',
      result: 'invalid_result',
    };

    const result = validateVerificationBackfill(verification as TaskMeta['verification']!);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('result'))).toBe(true);
  });

  it('验证 checkpointCompletionRate 范围', async () => {
    const { validateVerificationBackfill } = await validationUtils();

    // 超出范围
    const v1 = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'system',
      result: 'passed' as const,
      checkpointCompletionRate: 150,
    };
    const r1 = validateVerificationBackfill(v1);
    expect(r1.valid).toBe(false);

    // 负数
    const v2 = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'system',
      result: 'passed' as const,
      checkpointCompletionRate: -10,
    };
    const r2 = validateVerificationBackfill(v2);
    expect(r2.valid).toBe(false);

    // 合法边界值
    const v3 = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'system',
      result: 'passed' as const,
      checkpointCompletionRate: 0,
    };
    const r3 = validateVerificationBackfill(v3);
    expect(r3.valid).toBe(true);
  });
});
