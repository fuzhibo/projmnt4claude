/**
 * 统一测试环境辅助工具
 *
 * 提供测试环境的创建、管理和清理功能，确保测试隔离性
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spyOn } from 'bun:test';

// ============================================================
// 类型定义
// ============================================================

/**
 * 隔离测试环境上下文
 */
export interface IsolatedTestEnv {
  /** 临时目录根路径 */
  readonly tempDir: string;
  /** 任务目录路径 */
  readonly tasksDir: string;
  /** 项目配置目录路径 */
  readonly projectDir: string;
  /** 模拟函数清理句柄 */
  readonly mocks: MockHandles;
  /** 重置测试环境到初始状态 */
  reset: () => void;
  /** 清理并释放资源 */
  cleanup: () => void;
}

/**
 * Mock 函数句柄集合
 */
export interface MockHandles {
  isInitialized: ReturnType<typeof spyOn>;
  getTasksDir: ReturnType<typeof spyOn>;
  getProjectDir: ReturnType<typeof spyOn>;
  restore: () => void;
}

/**
 * 测试环境配置选项
 */
export interface TestEnvOptions {
  /** 是否自动初始化项目结构 */
  autoInit?: boolean;
  /** 自定义临时目录前缀 */
  prefix?: string;
  /** 是否创建任务目录 */
  createTasksDir?: boolean;
  /** 是否创建项目配置目录 */
  createProjectDir?: boolean;
  /** 共享根目录路径 - 如果提供，测试将在此目录下创建子目录 */
  sharedRoot?: string;
}

/**
 * 共享测试环境上下文（用于 beforeAll/afterAll 模式）
 */
export interface SharedTestEnv {
  /** 共享根目录路径 */
  readonly sharedRoot: string;
  /** 创建新的隔离测试环境（在共享根目录下） */
  createIsolatedEnv: (options?: Omit<TestEnvOptions, 'sharedRoot'>) => Promise<IsolatedTestEnv>;
  /** 完全清理共享目录和所有子环境 */
  cleanupAll: () => void;
}

/**
 * 测试环境状态
 */
interface TestEnvState {
  tempDir: string;
  tasksDir: string;
  projectDir: string;
  mocks: MockHandles | null;
  options: Required<TestEnvOptions>;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_OPTIONS: Required<TestEnvOptions> = {
  autoInit: true,
  prefix: 'projmnt-test-',
  createTasksDir: true,
  createProjectDir: true,
  sharedRoot: '',
};

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 生成唯一临时目录名
 */
function generateTempDirName(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp}-${random}`;
}

/**
 * 创建目录（如果不存在）
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 安全删除目录
 */
function safeRemoveDir(dir: string): void {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // 忽略删除错误，可能是权限问题或目录已被删除
      console.warn(`Warning: Failed to remove temp directory ${dir}: ${error}`);
    }
  }
}

/**
 * 创建 path 模块的 mock
 */
async function createPathMocks(state: TestEnvState): Promise<MockHandles> {
  const pathModule = await import('./path.js');

  const isInitializedMock = spyOn(pathModule, 'isInitialized').mockReturnValue(true);
  const getTasksDirMock = spyOn(pathModule, 'getTasksDir').mockReturnValue(state.tasksDir);
  const getProjectDirMock = spyOn(pathModule, 'getProjectDir').mockReturnValue(state.projectDir);

  return {
    isInitialized: isInitializedMock,
    getTasksDir: getTasksDirMock,
    getProjectDir: getProjectDirMock,
    restore: () => {
      isInitializedMock.mockRestore();
      getTasksDirMock.mockRestore();
      getProjectDirMock.mockRestore();
    },
  };
}

/**
 * 初始化测试环境状态
 */
function initState(options: TestEnvOptions = {}): TestEnvState {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // 如果提供了 sharedRoot，在该目录下创建子目录
  const baseDir = mergedOptions.sharedRoot || os.tmpdir();
  const tempDir = fs.mkdtempSync(path.join(baseDir, mergedOptions.prefix));
  const projectDir = path.join(tempDir, '.projmnt4claude');
  const tasksDir = path.join(projectDir, 'tasks');

  // 创建必要的目录结构
  if (mergedOptions.createProjectDir) {
    ensureDir(projectDir);
  }
  if (mergedOptions.createTasksDir) {
    ensureDir(tasksDir);
  }

  return {
    tempDir,
    tasksDir,
    projectDir,
    mocks: null,
    options: mergedOptions,
  };
}

/**
 * 重置测试环境到初始状态
 */
function resetEnv(state: TestEnvState): void {
  // 清理任务目录中的内容（保留目录本身）
  if (fs.existsSync(state.tasksDir)) {
    const entries = fs.readdirSync(state.tasksDir);
    for (const entry of entries) {
      const fullPath = path.join(state.tasksDir, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  // 重置 mock 返回值
  if (state.mocks) {
    state.mocks.isInitialized.mockReturnValue(true);
    state.mocks.getTasksDir.mockReturnValue(state.tasksDir);
    state.mocks.getProjectDir.mockReturnValue(state.projectDir);
  }
}

/**
 * 完全清理测试环境
 */
function cleanupEnv(state: TestEnvState): void {
  // 恢复所有 mock
  if (state.mocks) {
    state.mocks.restore();
    state.mocks = null;
  }

  // 删除临时目录
  safeRemoveDir(state.tempDir);
}

// ============================================================
// 主要 API
// ============================================================

/**
 * 创建隔离的测试环境
 *
 * 创建临时目录，设置 mock，返回环境上下文
 *
 * @example
 * ```typescript
 * let env: IsolatedTestEnv;
 *
 * beforeEach(async () => {
 *   env = await createIsolatedTestEnv();
 * });
 *
 * afterEach(() => {
 *   env.cleanup();
 * });
 * ```
 */
export async function createIsolatedTestEnv(
  options: TestEnvOptions = {}
): Promise<IsolatedTestEnv> {
  const state = initState(options);

  // 创建 mocks
  state.mocks = await createPathMocks(state);

  return {
    get tempDir() { return state.tempDir; },
    get tasksDir() { return state.tasksDir; },
    get projectDir() { return state.projectDir; },
    get mocks() { return state.mocks!; },
    reset: () => resetEnv(state),
    cleanup: () => cleanupEnv(state),
  };
}

/**
 * 重置测试环境
 *
 * 清除所有测试数据，但保留环境结构
 * 适用于需要在同一测试中重置状态的场景
 *
 * @param env - 隔离测试环境上下文，必须是有效的 IsolatedTestEnv 对象
 * @throws {TypeError} 当 env 为 null/undefined 或缺少 reset 方法时抛出
 *
 * @example
 * ```typescript
 * it('should handle multiple tasks', async () => {
 *   // First test case
 *   createTask('TASK-001');
 *   expect(getAllTasks()).toHaveLength(1);
 *
 *   // Reset and second test case
 *   resetTestEnv(env);
 *   expect(getAllTasks()).toHaveLength(0);
 * });
 * ```
 */
export function resetTestEnv(env: IsolatedTestEnv): void {
  // 参数存在性验证
  if (env === null || env === undefined) {
    throw new TypeError(
      'resetTestEnv: 参数 env 不能为 null 或 undefined。' +
      '请确保传入有效的 IsolatedTestEnv 对象（通过 createIsolatedTestEnv 创建）。'
    );
  }

  // 参数类型验证
  if (typeof env !== 'object') {
    throw new TypeError(
      `resetTestEnv: 参数 env 必须是对象类型，但收到 ${typeof env}。` +
      '请确保传入有效的 IsolatedTestEnv 对象。'
    );
  }

  // 必要属性验证
  if (typeof env.reset !== 'function') {
    throw new TypeError(
      'resetTestEnv: 参数 env 必须包含 reset 方法。' +
      '请确保传入通过 createIsolatedTestEnv 创建的有效 IsolatedTestEnv 对象。'
    );
  }

  // 执行重置
  env.reset();
}

// ============================================================
// 共享根目录机制（Phase 2）
// ============================================================

/**
 * 创建共享测试环境
 *
 * 为整个测试套件创建一个共享根目录，所有子测试在其中创建独立子目录。
 * 适用于 beforeAll/afterAll 模式，实现统一清理。
 *
 * @param options - 配置选项
 * @returns 共享测试环境上下文
 *
 * @example
 * ```typescript
 * describe('场景测试', () => {
 *   let sharedEnv: SharedTestEnv;
 *   let env1: IsolatedTestEnv;
 *   let env2: IsolatedTestEnv;
 *
 *   beforeAll(async () => {
 *     sharedEnv = await createSharedTestEnv({ prefix: 'scenario-suite-' });
 *     env1 = await sharedEnv.createIsolatedEnv();
 *     env2 = await sharedEnv.createIsolatedEnv();
 *   });
 *
 *   afterAll(() => {
 *     sharedEnv.cleanupAll();
 *   });
 *
 *   test('测试1', () => {
 *     createTaskDir(env1.tasksDir, 'TASK-001');
 *     expect(taskExists(env1.tasksDir, 'TASK-001')).toBe(true);
 *   });
 * });
 * ```
 */
export async function createSharedTestEnv(
  options: Omit<TestEnvOptions, 'sharedRoot'> = {}
): Promise<SharedTestEnv> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sharedRoot = path.join(os.tmpdir(), `${mergedOptions.prefix}suite-${timestamp}-${random}`);

  // 创建共享根目录
  ensureDir(sharedRoot);

  // 跟踪创建的子环境以便可选的单独清理
  const childEnvs: IsolatedTestEnv[] = [];

  return {
    get sharedRoot() { return sharedRoot; },

    createIsolatedEnv: async (childOptions?: Omit<TestEnvOptions, 'sharedRoot'>): Promise<IsolatedTestEnv> => {
      const env = await createIsolatedTestEnv({
        ...mergedOptions,
        ...childOptions,
        sharedRoot,
      });
      childEnvs.push(env);
      return env;
    },

    cleanupAll: (): void => {
      // 先清理所有子环境的 mocks
      for (const env of childEnvs) {
        try {
          env.mocks?.restore();
        } catch {
          // 忽略已清理的 mock
        }
      }
      childEnvs.length = 0;

      // 删除整个共享根目录
      safeRemoveDir(sharedRoot);
    },
  };
}

// ============================================================
// 便捷工具函数
// ============================================================

/**
 * 创建任务目录并写入元数据文件
 */
export function createTaskDir(
  tasksDir: string,
  taskId: string,
  meta: Record<string, unknown> = {}
): string {
  const taskDir = path.join(tasksDir, taskId);
  ensureDir(taskDir);

  const defaultMeta = {
    id: taskId,
    title: `Test Task ${taskId}`,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const fullMeta = { ...defaultMeta, ...meta };
  fs.writeFileSync(
    path.join(taskDir, 'meta.json'),
    JSON.stringify(fullMeta, null, 2),
    'utf-8'
  );

  return taskDir;
}

/**
 * 读取任务元数据文件
 */
export function readTaskMeta(
  tasksDir: string,
  taskId: string
): Record<string, unknown> | null {
  const metaPath = path.join(tasksDir, taskId, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 写入任务元数据文件
 */
export function writeTaskMeta(
  tasksDir: string,
  taskId: string,
  meta: Record<string, unknown>
): void {
  const taskDir = path.join(tasksDir, taskId);
  ensureDir(taskDir);

  fs.writeFileSync(
    path.join(taskDir, 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );
}

/**
 * 检查任务是否存在
 */
export function taskExists(tasksDir: string, taskId: string): boolean {
  return fs.existsSync(path.join(tasksDir, taskId, 'meta.json'));
}

/**
 * 获取所有任务ID列表
 */
export function getAllTaskIds(tasksDir: string): string[] {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }

  return fs.readdirSync(tasksDir).filter(name => {
    const taskDir = path.join(tasksDir, name);
    const metaPath = path.join(taskDir, 'meta.json');
    return fs.statSync(taskDir).isDirectory() && fs.existsSync(metaPath);
  });
}

/**
 * 创建归档任务（用于测试归档功能）
 */
export function createArchivedTask(
  projectDir: string,
  taskId: string,
  meta: Record<string, unknown> = {}
): string {
  const archiveDir = path.join(projectDir, 'archive', taskId);
  ensureDir(archiveDir);

  const defaultMeta = {
    id: taskId,
    title: `Archived Task ${taskId}`,
    status: 'closed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const fullMeta = { ...defaultMeta, ...meta };
  fs.writeFileSync(
    path.join(archiveDir, 'meta.json'),
    JSON.stringify(fullMeta, null, 2),
    'utf-8'
  );

  return archiveDir;
}

// ============================================================
// 批量测试辅助
// ============================================================

/**
 * 批量创建测试任务
 */
export function createTestTasks(
  tasksDir: string,
  count: number,
  baseMeta: Record<string, unknown> = {}
): string[] {
  const taskIds: string[] = [];

  for (let i = 1; i <= count; i++) {
    const taskId = `TASK-${String(i).padStart(3, '0')}`;
    createTaskDir(tasksDir, taskId, {
      ...baseMeta,
      id: taskId,
      title: `Test Task ${i}`,
    });
    taskIds.push(taskId);
  }

  return taskIds;
}

/**
 * 创建测试任务依赖关系
 */
export function createTaskDependency(
  tasksDir: string,
  parentId: string,
  childId: string
): void {
  const parentMeta = readTaskMeta(tasksDir, parentId);
  if (parentMeta) {
    const deps = (parentMeta.dependencies as string[]) || [];
    if (!deps.includes(childId)) {
      deps.push(childId);
    }
    writeTaskMeta(tasksDir, parentId, {
      ...parentMeta,
      dependencies: deps,
    });
  }
}

// ============================================================
// Jest/Bun 测试框架集成
// ============================================================

/**
 * 创建标准测试生命周期钩子
 *
 * 返回 beforeEach 和 afterEach 处理函数
 *
 * @example
 * ```typescript
 * describe('My Tests', () => {
 *   const { setup, teardown } = createTestLifecycle();
 *
 *   setup();
 *   teardown();
 *
 *   // 或者手动控制
 *   beforeEach(async () => {
 *     await setup();
 *   });
 *
 *   afterEach(() => {
 *     teardown();
 *   });
 * });
 * ```
 */
export function createTestLifecycle(options: TestEnvOptions = {}) {
  let env: IsolatedTestEnv | null = null;

  return {
    /**
     * 设置测试环境（在 beforeEach 中调用）
     */
    setup: async (): Promise<IsolatedTestEnv> => {
      env = await createIsolatedTestEnv(options);
      return env;
    },

    /**
     * 清理测试环境（在 afterEach 中调用）
     */
    teardown: (): void => {
      if (env) {
        env.cleanup();
        env = null;
      }
    },

    /**
     * 获取当前环境（在测试中使用）
     */
    getEnv: (): IsolatedTestEnv => {
      if (!env) {
        throw new Error('Test environment not initialized. Call setup() first.');
      }
      return env;
    },

    /**
     * 重置环境但不清理（用于在同一测试中重置状态）
     */
    reset: (): void => {
      if (env) {
        env.reset();
      }
    },
  };
}
