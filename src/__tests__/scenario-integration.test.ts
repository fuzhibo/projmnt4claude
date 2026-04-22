/**
 * 场景集成测试 - 使用隔离测试环境
 *
 * 本测试文件演示如何使用 createIsolatedTestEnv 确保测试在隔离环境中运行，
 * 避免测试数据污染实际项目。
 *
 * 覆盖场景:
 * 1. 项目初始化场景
 * 2. 任务创建与管理场景
 * 3. 多任务协作场景
 * 4. 状态转换场景
 * 5. 错误处理场景
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// 隔离测试环境工具
import {
  createIsolatedTestEnv,
  createSharedTestEnv,
  createTaskDir,
  readTaskMeta,
  writeTaskMeta,
  taskExists,
  getAllTaskIds,
  createArchivedTask,
  createTestTasks,
  createTaskDependency,
  createTestLifecycle,
  resetTestEnv,
  type IsolatedTestEnv,
  type SharedTestEnv,
} from '../utils/test-env.js';

// 类型定义
import type { TaskMeta, TaskStatus } from '../types/task.js';
import { createDefaultTaskMeta, normalizeStatus, parseTaskId, generateTaskId } from '../types/task.js';

// ============================================================
// 测试辅助函数
// ============================================================

/**
 * 创建测试任务元数据
 */
function createTestTaskMeta(
  id: string,
  overrides?: Partial<TaskMeta>,
): TaskMeta {
  const task = createDefaultTaskMeta(id, `Test task ${id}`, 'feature', `Description for task ${id}`);
  if (overrides) {
    Object.assign(task, overrides);
  }
  return task;
}

/**
 * 将任务写入磁盘
 */
function writeTaskToDisk(tasksDir: string, task: TaskMeta): void {
  const taskDir = path.join(tasksDir, task.id);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, 'meta.json'),
    JSON.stringify(task, null, 2),
    'utf-8'
  );
}

/**
 * 从磁盘读取任务
 */
function readTaskFromDisk(tasksDir: string, taskId: string): TaskMeta | null {
  const metaPath = path.join(tasksDir, taskId, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================
// 场景 1: 项目初始化场景
// ============================================================

describe('场景 1: 项目初始化', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S1.1: 隔离环境创建临时目录', () => {
    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.statSync(env.tempDir).isDirectory()).toBe(true);
    // 临时目录应该在系统临时目录中
    expect(env.tempDir).toContain('projmnt-test-');
  });

  test('S1.2: 隔离环境创建任务目录', () => {
    expect(fs.existsSync(env.tasksDir)).toBe(true);
    expect(env.tasksDir).toContain('tasks');
    expect(env.tasksDir).toContain('.projmnt4claude');
  });

  test('S1.3: 隔离环境创建项目配置目录', () => {
    expect(fs.existsSync(env.projectDir)).toBe(true);
    expect(env.projectDir).toContain('.projmnt4claude');
  });

  test('S1.4: path 模块 mock 正确返回隔离路径', async () => {
    const pathModule = await import('../utils/path.js');
    expect(pathModule.isInitialized(env.tempDir)).toBe(true);
    expect(pathModule.getTasksDir(env.tempDir)).toBe(env.tasksDir);
    expect(pathModule.getProjectDir(env.tempDir)).toBe(env.projectDir);
  });

  test('S1.5: 不同测试使用不同临时目录', async () => {
    const env2 = await createIsolatedTestEnv();

    // 两个环境应该有不同的临时目录
    expect(env.tempDir).not.toBe(env2.tempDir);
    expect(env.tasksDir).not.toBe(env2.tasksDir);
    expect(env.projectDir).not.toBe(env2.projectDir);

    // 两个目录都应该存在
    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.existsSync(env2.tempDir)).toBe(true);

    env2.cleanup();
  });
});

// ============================================================
// 场景 2: 任务创建与管理场景
// ============================================================

describe('场景 2: 任务创建与管理', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S2.1: 使用 createTaskDir 创建任务', () => {
    const taskDir = createTaskDir(env.tasksDir, 'TASK-001', {
      title: '测试任务 1',
      status: 'open',
    });

    expect(fs.existsSync(taskDir)).toBe(true);
    expect(fs.existsSync(path.join(taskDir, 'meta.json'))).toBe(true);

    const meta = readTaskMeta(env.tasksDir, 'TASK-001');
    expect(meta?.title).toBe('测试任务 1');
    expect(meta?.status).toBe('open');
  });

  test('S2.2: 使用 writeTaskMeta 写入任务元数据', () => {
    const task: TaskMeta = createTestTaskMeta('TASK-002', {
      title: '自定义任务',
      priority: 'P1',
    });

    writeTaskToDisk(env.tasksDir, task);

    const loaded = readTaskFromDisk(env.tasksDir, 'TASK-002');
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('自定义任务');
    expect(loaded!.priority).toBe('P1');
  });

  test('S2.3: taskExists 检查任务是否存在', () => {
    expect(taskExists(env.tasksDir, 'TASK-NOT-EXIST')).toBe(false);

    createTaskDir(env.tasksDir, 'TASK-003');
    expect(taskExists(env.tasksDir, 'TASK-003')).toBe(true);
  });

  test('S2.4: getAllTaskIds 获取所有任务 ID', () => {
    createTaskDir(env.tasksDir, 'TASK-001');
    createTaskDir(env.tasksDir, 'TASK-002');
    createTaskDir(env.tasksDir, 'TASK-003');

    const ids = getAllTaskIds(env.tasksDir);
    expect(ids).toHaveLength(3);
    expect(ids.sort()).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
  });

  test('S2.5: readTaskMeta 读取不存在的任务返回 null', () => {
    const meta = readTaskMeta(env.tasksDir, 'NON-EXISTENT');
    expect(meta).toBeNull();
  });
});

// ============================================================
// 场景 3: 多任务协作场景
// ============================================================

describe('场景 3: 多任务协作', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S3.1: createTestTasks 批量创建任务', () => {
    const ids = createTestTasks(env.tasksDir, 5, { status: 'open' });

    expect(ids).toHaveLength(5);
    expect(ids).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004', 'TASK-005']);

    // 验证所有任务都创建了
    const allIds = getAllTaskIds(env.tasksDir);
    expect(allIds).toHaveLength(5);
  });

  test('S3.2: createTaskDependency 创建任务依赖关系', () => {
    createTaskDir(env.tasksDir, 'TASK-PARENT');
    createTaskDir(env.tasksDir, 'TASK-CHILD');

    createTaskDependency(env.tasksDir, 'TASK-PARENT', 'TASK-CHILD');

    const parentMeta = readTaskMeta(env.tasksDir, 'TASK-PARENT');
    expect(parentMeta?.dependencies).toContain('TASK-CHILD');
  });

  test('S3.3: 复杂依赖关系图', () => {
    // 创建依赖链: A -> B -> C
    createTaskDir(env.tasksDir, 'TASK-A');
    createTaskDir(env.tasksDir, 'TASK-B');
    createTaskDir(env.tasksDir, 'TASK-C');

    createTaskDependency(env.tasksDir, 'TASK-A', 'TASK-B');
    createTaskDependency(env.tasksDir, 'TASK-B', 'TASK-C');

    const metaA = readTaskMeta(env.tasksDir, 'TASK-A');
    const metaB = readTaskMeta(env.tasksDir, 'TASK-B');

    expect(metaA?.dependencies).toContain('TASK-B');
    expect(metaB?.dependencies).toContain('TASK-C');
  });

  test('S3.4: createArchivedTask 创建归档任务', () => {
    const archiveDir = createArchivedTask(env.projectDir, 'TASK-ARCHIVED', {
      title: '已归档任务',
    });

    expect(fs.existsSync(archiveDir)).toBe(true);
    expect(archiveDir).toContain('archive');

    const meta = readTaskMeta(path.join(env.projectDir, 'archive'), 'TASK-ARCHIVED');
    expect(meta?.status).toBe('closed');
    expect(meta?.title).toBe('已归档任务');
  });
});

// ============================================================
// 场景 4: 状态转换场景
// ============================================================

describe('场景 4: 状态转换', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S4.1: 任务状态转换生命周期', () => {
    const taskId = 'TASK-LIFECYCLE';
    createTaskDir(env.tasksDir, taskId, { status: 'open' });

    const statuses: TaskStatus[] = ['in_progress', 'wait_review', 'wait_qa', 'resolved'];

    for (const status of statuses) {
      const meta = readTaskMeta(env.tasksDir, taskId);
      const updatedMeta = { ...meta!, status, updatedAt: new Date().toISOString() };
      writeTaskMeta(env.tasksDir, taskId, updatedMeta);
    }

    const finalMeta = readTaskMeta(env.tasksDir, taskId);
    expect(finalMeta?.status).toBe('resolved');
  });

  test('S4.2: normalizeStatus 处理遗留状态', () => {
    expect(normalizeStatus('pending')).toBe('open');
    expect(normalizeStatus('completed')).toBe('resolved');
    expect(normalizeStatus('cancelled')).toBe('abandoned');
    expect(normalizeStatus('in_progress')).toBe('in_progress');
  });

  test('S4.3: 任务 ID 生成和解析', () => {
    const id = generateTaskId('feature', 'P2', 'add user auth');
    const parsed = parseTaskId(id);

    expect(parsed.valid).toBe(true);
    expect(parsed.type).toBe('feature');
    expect(parsed.priority).toBe('P2');
  });
});

// ============================================================
// 场景 5: 错误处理场景
// ============================================================

describe('场景 5: 错误处理', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S5.1: 读取损坏的元数据文件返回 null', () => {
    const taskDir = path.join(env.tasksDir, 'TASK-CORRUPT');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'meta.json'), 'invalid json {{{', 'utf-8');

    const meta = readTaskMeta(env.tasksDir, 'TASK-CORRUPT');
    expect(meta).toBeNull();
  });

  test('S5.2: 读取不存在的任务目录返回 null', () => {
    const meta = readTaskMeta(env.tasksDir, 'NON-EXISTENT-TASK');
    expect(meta).toBeNull();
  });

  test('S5.3: 任务目录存在但缺少 meta.json', () => {
    fs.mkdirSync(path.join(env.tasksDir, 'TASK-NO-META'), { recursive: true });

    expect(taskExists(env.tasksDir, 'TASK-NO-META')).toBe(false);
    expect(getAllTaskIds(env.tasksDir)).toEqual([]);
  });
});

// ============================================================
// 场景 6: 环境重置和清理
// ============================================================

describe('场景 6: 环境重置和清理', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S6.1: reset 清除任务数据但保留目录结构', () => {
    // 创建一些任务
    createTaskDir(env.tasksDir, 'TASK-001');
    createTaskDir(env.tasksDir, 'TASK-002');

    expect(getAllTaskIds(env.tasksDir)).toHaveLength(2);

    // 重置环境
    env.reset();

    // 任务数据应该被清除
    expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);

    // 但目录结构应该保留
    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.existsSync(env.tasksDir)).toBe(true);
    expect(fs.existsSync(env.projectDir)).toBe(true);
  });

  test('S6.2: cleanup 完全清理临时目录', () => {
    const tempDir = env.tempDir;
    expect(fs.existsSync(tempDir)).toBe(true);

    env.cleanup();

    // 临时目录应该被删除
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  test('S6.3: 重置后 mock 仍然有效', async () => {
    const pathModule = await import('../utils/path.js');

    // 重置环境
    env.reset();

    // mock 应该仍然返回正确的值
    expect(pathModule.getTasksDir(env.tempDir)).toBe(env.tasksDir);
    expect(pathModule.getProjectDir(env.tempDir)).toBe(env.projectDir);
  });
});

// ============================================================
// 场景 7: 使用 createTestLifecycle 便捷模式
// ============================================================

describe('场景 7: createTestLifecycle 便捷模式', () => {
  const { setup, teardown, getEnv, reset } = createTestLifecycle();

  // 手动调用生命周期函数
  test('S7.1: setup 创建隔离环境', async () => {
    const env = await setup();

    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.existsSync(env.tasksDir)).toBe(true);

    teardown();
  });

  test('S7.2: getEnv 返回当前环境', async () => {
    await setup();
    const env = getEnv();

    expect(fs.existsSync(env.tempDir)).toBe(true);

    teardown();
  });

  test('S7.3: reset 清除任务数据', async () => {
    const env = await setup();
    createTaskDir(env.tasksDir, 'TASK-001');

    expect(getAllTaskIds(env.tasksDir)).toHaveLength(1);

    reset();

    expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);

    teardown();
  });

  test('S7.4: teardown 清理环境', async () => {
    const env = await setup();
    const tempDir = env.tempDir;

    expect(fs.existsSync(tempDir)).toBe(true);

    teardown();

    // 清理后目录应该被删除
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  test('S7.5: getEnv 在未初始化时抛出错误', () => {
    const { getEnv: getEnvUninitialized } = createTestLifecycle();

    expect(() => getEnvUninitialized()).toThrow('Test environment not initialized');
  });
});

// ============================================================
// 场景 8: 并发隔离验证
// ============================================================

describe('场景 8: 并发隔离验证', () => {
  test('S8.1: 同时创建多个隔离环境互相独立', async () => {
    const env1 = await createIsolatedTestEnv();
    const env2 = await createIsolatedTestEnv();
    const env3 = await createIsolatedTestEnv();

    // 在每个环境中创建任务
    createTaskDir(env1.tasksDir, 'ENV1-TASK');
    createTaskDir(env2.tasksDir, 'ENV2-TASK');
    createTaskDir(env3.tasksDir, 'ENV3-TASK');

    // 验证每个环境只能看到自己的任务
    expect(getAllTaskIds(env1.tasksDir)).toEqual(['ENV1-TASK']);
    expect(getAllTaskIds(env2.tasksDir)).toEqual(['ENV2-TASK']);
    expect(getAllTaskIds(env3.tasksDir)).toEqual(['ENV3-TASK']);

    // 清理所有环境
    env1.cleanup();
    env2.cleanup();
    env3.cleanup();
  });

  test('S8.2: 清理一个环境不影响其他环境', async () => {
    const env1 = await createIsolatedTestEnv();
    const env2 = await createIsolatedTestEnv();

    createTaskDir(env1.tasksDir, 'TASK-1');
    createTaskDir(env2.tasksDir, 'TASK-2');

    // 清理 env1
    env1.cleanup();

    // env2 应该仍然可以访问
    expect(fs.existsSync(env2.tempDir)).toBe(true);
    expect(getAllTaskIds(env2.tasksDir)).toEqual(['TASK-2']);

    env2.cleanup();
  });
});

// ============================================================
// 场景 9: 配置选项测试
// ============================================================

describe('场景 9: 配置选项', () => {
  test('S9.1: 自定义前缀', async () => {
    const env = await createIsolatedTestEnv({ prefix: 'custom-scenario-' });

    expect(path.basename(env.tempDir).startsWith('custom-scenario-')).toBe(true);

    env.cleanup();
  });

  test('S9.2: 跳过创建任务目录', async () => {
    const env = await createIsolatedTestEnv({ createTasksDir: false });

    expect(fs.existsSync(env.tempDir)).toBe(true);
    // tasksDir 路径已设置但目录未创建
    expect(fs.existsSync(env.tasksDir)).toBe(false);

    env.cleanup();
  });

  test('S9.3: 跳过创建项目目录', async () => {
    // 注意：如果 createTasksDir 为 true（默认），它会递归创建父目录
    // 所以需要同时设置 createTasksDir: false 才能真正跳过项目目录创建
    const env = await createIsolatedTestEnv({ createProjectDir: false, createTasksDir: false });

    expect(fs.existsSync(env.tempDir)).toBe(true);
    // projectDir 路径已设置但目录未创建
    expect(fs.existsSync(env.projectDir)).toBe(false);

    env.cleanup();
  });
});

// ============================================================
// 场景 10: resetTestEnv 错误处理
// ============================================================

describe('场景 10: resetTestEnv 错误处理', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  test('S10.1: resetTestEnv 传入 null 抛出 TypeError', () => {
    // resetTestEnv 已从文件顶部导入
    expect(() => resetTestEnv(null)).toThrow(TypeError);
    expect(() => resetTestEnv(null)).toThrow('参数 env 不能为 null 或 undefined');
  });

  test('S10.2: resetTestEnv 传入 undefined 抛出 TypeError', () => {
    // resetTestEnv 已从文件顶部导入
    expect(() => resetTestEnv(undefined)).toThrow(TypeError);
    expect(() => resetTestEnv(undefined)).toThrow('参数 env 不能为 null 或 undefined');
  });

  test('S10.3: resetTestEnv 传入非对象类型抛出 TypeError', () => {
    // resetTestEnv 已从文件顶部导入
    expect(() => resetTestEnv('string')).toThrow(TypeError);
    expect(() => resetTestEnv(123)).toThrow(TypeError);
    expect(() => resetTestEnv(true)).toThrow(TypeError);
  });

  test('S10.4: resetTestEnv 传入缺少 reset 方法的对象抛出 TypeError', () => {
    // resetTestEnv 已从文件顶部导入
    const invalidEnv = { tempDir: '/tmp', tasksDir: '/tmp/tasks' };
    expect(() => resetTestEnv(invalidEnv)).toThrow(TypeError);
    expect(() => resetTestEnv(invalidEnv)).toThrow('参数 env 必须包含 reset 方法');
  });

  test('S10.5: resetTestEnv 正确调用 env.reset', () => {
    // resetTestEnv 已从文件顶部导入

    // 创建任务
    createTaskDir(env.tasksDir, 'TASK-001');
    expect(getAllTaskIds(env.tasksDir)).toHaveLength(1);

    // 使用 resetTestEnv 重置
    resetTestEnv(env);

    // 验证任务被清除
    expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);

    // 验证目录结构保留
    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.existsSync(env.tasksDir)).toBe(true);
  });
});

// ============================================================
// 场景 11: Phase 2 共享根目录机制
// ============================================================

describe('场景 11: 共享根目录机制 (Phase 2)', () => {
  let sharedEnv: SharedTestEnv;
  let env1: IsolatedTestEnv;
  let env2: IsolatedTestEnv;

  beforeAll(async () => {
    sharedEnv = await createSharedTestEnv({ prefix: 'scenario-suite-' });
    env1 = await sharedEnv.createIsolatedEnv();
    env2 = await sharedEnv.createIsolatedEnv();
  });

  afterAll(() => {
    sharedEnv.cleanupAll();
  });

  test('S11.1: createSharedTestEnv 创建共享根目录', () => {
    expect(fs.existsSync(sharedEnv.sharedRoot)).toBe(true);
    expect(path.basename(sharedEnv.sharedRoot)).toContain('scenario-suite-');
  });

  test('S11.2: 子环境在共享根目录下创建', () => {
    expect(env1.tempDir).toContain(sharedEnv.sharedRoot);
    expect(env2.tempDir).toContain(sharedEnv.sharedRoot);
  });

  test('S11.3: 子环境相互隔离', () => {
    createTaskDir(env1.tasksDir, 'ENV1-TASK');
    createTaskDir(env2.tasksDir, 'ENV2-TASK');

    // 每个环境只能看到自己的任务
    expect(getAllTaskIds(env1.tasksDir)).toEqual(['ENV1-TASK']);
    expect(getAllTaskIds(env2.tasksDir)).toEqual(['ENV2-TASK']);
  });

  test('S11.4: 共享根目录包含所有子环境', () => {
    const entries = fs.readdirSync(sharedEnv.sharedRoot);
    // 应该有两个子目录
    expect(entries).toHaveLength(2);
  });

  test('S11.5: cleanupAll 统一清理所有子环境', async () => {
    // 创建新的共享环境用于此测试
    const testSharedEnv = await createSharedTestEnv({ prefix: 'cleanup-test-' });
    const testEnv1 = await testSharedEnv.createIsolatedEnv();
    const testEnv2 = await testSharedEnv.createIsolatedEnv();

    // 验证目录存在
    expect(fs.existsSync(testSharedEnv.sharedRoot)).toBe(true);
    expect(fs.existsSync(testEnv1.tempDir)).toBe(true);
    expect(fs.existsSync(testEnv2.tempDir)).toBe(true);

    // 统一清理
    testSharedEnv.cleanupAll();

    // 验证整个共享根目录被删除
    expect(fs.existsSync(testSharedEnv.sharedRoot)).toBe(false);
  });

  test('S11.6: 多个子环境可以同时创建和使用', async () => {
    const testSharedEnv = await createSharedTestEnv({ prefix: 'multi-env-test-' });

    // 创建多个子环境
    const envs: IsolatedTestEnv[] = [];
    for (let i = 0; i < 5; i++) {
      const env = await testSharedEnv.createIsolatedEnv();
      envs.push(env);
      createTaskDir(env.tasksDir, `TASK-${i + 1}`);
    }

    // 验证所有环境都在共享根目录下
    for (const env of envs) {
      expect(env.tempDir).toContain(testSharedEnv.sharedRoot);
    }

    // 验证每个环境独立
    for (let i = 0; i < 5; i++) {
      expect(getAllTaskIds(envs[i].tasksDir)).toEqual([`TASK-${i + 1}`]);
    }

    testSharedEnv.cleanupAll();
  });
});

// ============================================================
// 场景 12: 共享根目录与现有测试模式集成
// ============================================================

describe('场景 12: 共享根目录与现有模式集成', () => {
  test('S12.1: 共享根目录支持 createTasksDir: false 选项', async () => {
    const sharedEnv = await createSharedTestEnv({ prefix: 'skip-tasks-test-' });
    const env = await sharedEnv.createIsolatedEnv({ createTasksDir: false });

    expect(fs.existsSync(env.tempDir)).toBe(true);
    expect(fs.existsSync(env.tasksDir)).toBe(false);

    sharedEnv.cleanupAll();
  });

  test('S12.2: 共享根目录支持自定义前缀', async () => {
    const sharedEnv = await createSharedTestEnv({ prefix: 'custom-prefix-' });
    const env = await sharedEnv.createIsolatedEnv({ prefix: 'child-' });

    // 子目录使用自定义前缀
    expect(path.basename(env.tempDir)).toContain('child-');

    sharedEnv.cleanupAll();
  });

  test('S12.3: 混合使用共享根目录和独立隔离环境', async () => {
    // 创建共享环境
    const sharedEnv = await createSharedTestEnv({ prefix: 'mixed-test-' });
    const sharedChildEnv = await sharedEnv.createIsolatedEnv();

    // 创建独立隔离环境
    const isolatedEnv = await createIsolatedTestEnv({ prefix: 'independent-' });

    // 两者都正常工作
    createTaskDir(sharedChildEnv.tasksDir, 'SHARED-TASK');
    createTaskDir(isolatedEnv.tasksDir, 'ISOLATED-TASK');

    expect(getAllTaskIds(sharedChildEnv.tasksDir)).toEqual(['SHARED-TASK']);
    expect(getAllTaskIds(isolatedEnv.tasksDir)).toEqual(['ISOLATED-TASK']);

    // 清理
    sharedEnv.cleanupAll();
    isolatedEnv.cleanup();
  });

  test('S12.4: 共享环境子目录可以使用 reset 方法', async () => {
    const sharedEnv = await createSharedTestEnv({ prefix: 'reset-test-' });
    const env = await sharedEnv.createIsolatedEnv();

    createTaskDir(env.tasksDir, 'TASK-001');
    expect(getAllTaskIds(env.tasksDir)).toHaveLength(1);

    // 重置单个环境
    env.reset();

    // 任务被清除但目录保留
    expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);
    expect(fs.existsSync(env.tempDir)).toBe(true);

    sharedEnv.cleanupAll();
  });
});
