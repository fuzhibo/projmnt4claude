/**
 * Harness 测试包装器
 *
 * 提供 createHarnessTestContext 函数，支持在临时目录中运行 Harness 测试并自动清理产生的任务数据
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spyOn } from 'bun:test';
import type { HarnessConfig, HarnessRuntimeState } from '../types/harness.js';
import { createDefaultRuntimeState } from '../types/harness.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Harness 测试上下文
 */
export interface HarnessTestContext {
  /** 临时目录根路径 */
  readonly tempDir: string;
  /** 任务目录路径 */
  readonly tasksDir: string;
  /** 项目配置目录路径 */
  readonly projectDir: string;
  /** 报告目录路径 */
  readonly reportsDir: string;
  /** Harness 运行时状态 */
  readonly runtimeState: HarnessRuntimeState;
  /** Harness 配置 */
  readonly config: HarnessConfig;
  /** Mock 函数清理句柄 */
  readonly mocks: HarnessMockHandles;
  /** 创建测试任务 */
  createTask: (taskId: string, meta?: Record<string, unknown>) => string;
  /** 读取任务元数据 */
  readTask: (taskId: string) => Record<string, unknown> | null;
  /** 写入任务元数据 */
  writeTask: (taskId: string, meta: Record<string, unknown>) => void;
  /** 检查任务是否存在 */
  taskExists: (taskId: string) => boolean;
  /** 创建测试报告 */
  createReport: (taskId: string, reportType: string, content: string) => string;
  /** 读取测试报告 */
  readReport: (taskId: string, reportType: string) => string | null;
  /** 重置测试环境 */
  reset: () => void;
  /** 清理并释放资源 */
  cleanup: () => void;
}

/**
 * Harness Mock 函数句柄集合
 */
export interface HarnessMockHandles {
  isInitialized: ReturnType<typeof spyOn>;
  getTasksDir: ReturnType<typeof spyOn>;
  getProjectDir: ReturnType<typeof spyOn>;
  restore: () => void;
}

/**
 * Harness 测试选项
 */
export interface HarnessTestOptions {
  /** 是否自动初始化项目结构 */
  autoInit?: boolean;
  /** 自定义临时目录前缀 */
  prefix?: string;
  /** 自定义 Harness 配置 */
  harnessConfig?: Partial<HarnessConfig>;
  /** 是否创建示例任务 */
  createSampleTasks?: boolean;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_OPTIONS: Required<HarnessTestOptions> = {
  autoInit: true,
  prefix: 'harness-test-',
  harnessConfig: {},
  createSampleTasks: false,
};

const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  maxRetries: 3,
  timeout: 300,
  parallel: 1,
  dryRun: false,
  continue: false,
  jsonOutput: false,
  batchGitCommit: false,
  forceContinue: false,
  cwd: process.cwd(),
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
      console.warn(`Warning: Failed to remove temp directory ${dir}: ${error}`);
    }
  }
}

/**
 * 创建 path 模块的 mock
 */
async function createPathMocks(
  tempDir: string,
  tasksDir: string,
  projectDir: string
): Promise<HarnessMockHandles> {
  const pathModule = await import('./path.js');

  const isInitializedMock = spyOn(pathModule, 'isInitialized').mockReturnValue(true);
  const getTasksDirMock = spyOn(pathModule, 'getTasksDir').mockReturnValue(tasksDir);
  const getProjectDirMock = spyOn(pathModule, 'getProjectDir').mockReturnValue(projectDir);

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

// ============================================================
// 主要 API
// ============================================================

/**
 * 创建 Harness 测试上下文
 *
 * 在临时目录中设置 Harness 测试环境，包括:
 * - 创建临时目录结构
 * - 设置 path 模块 mock
 * - 初始化 Harness 运行时状态
 * - 提供任务和报告管理工具
 *
 * @example
 * ```typescript
 * let ctx: HarnessTestContext;
 *
 * beforeEach(async () => {
 *   ctx = await createHarnessTestContext();
 * });
 *
 * afterEach(() => {
 *   ctx.cleanup();
 * });
 *
 * test('should run harness pipeline', async () => {
 *   ctx.createTask('TASK-001', { title: 'Test Task' });
 *   // Run harness pipeline...
 * });
 * ```
 */
export async function createHarnessTestContext(
  options: HarnessTestOptions = {}
): Promise<HarnessTestContext> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // 创建临时目录
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), mergedOptions.prefix));
  const projectDir = path.join(tempDir, '.projmnt4claude');
  const tasksDir = path.join(projectDir, 'tasks');
  const reportsDir = path.join(projectDir, 'reports', 'harness');

  // 创建必要的目录结构
  if (mergedOptions.autoInit) {
    ensureDir(tasksDir);
    ensureDir(reportsDir);
  }

  // 创建 mocks
  const mocks = await createPathMocks(tempDir, tasksDir, projectDir);

  // 创建 Harness 配置
  const config: HarnessConfig = {
    ...DEFAULT_HARNESS_CONFIG,
    ...mergedOptions.harnessConfig,
    cwd: tempDir,
  };

  // 创建 Harness 运行时状态
  const runtimeState = createDefaultRuntimeState(config);

  // 创建示例任务（如果需要）
  if (mergedOptions.createSampleTasks) {
    createSampleTaskData(tasksDir);
  }

  // 创建任务（内部实现）
  const createTask = (taskId: string, meta: Record<string, unknown> = {}): string => {
    const taskDir = path.join(tasksDir, taskId);
    ensureDir(taskDir);

    const defaultMeta = {
      id: taskId,
      title: `Test Task ${taskId}`,
      type: 'feature',
      priority: 'P2',
      status: 'open',
      checkpoints: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };

    const fullMeta = { ...defaultMeta, ...meta };
    fs.writeFileSync(
      path.join(taskDir, 'meta.json'),
      JSON.stringify(fullMeta, null, 2),
      'utf-8'
    );

    return taskDir;
  };

  // 读取任务（内部实现）
  const readTask = (taskId: string): Record<string, unknown> | null => {
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
  };

  // 写入任务（内部实现）
  const writeTask = (taskId: string, meta: Record<string, unknown>): void => {
    const taskDir = path.join(tasksDir, taskId);
    ensureDir(taskDir);

    fs.writeFileSync(
      path.join(taskDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );
  };

  // 检查任务是否存在（内部实现）
  const taskExists = (taskId: string): boolean => {
    return fs.existsSync(path.join(tasksDir, taskId, 'meta.json'));
  };

  // 创建报告（内部实现）
  const createReport = (taskId: string, reportType: string, content: string): string => {
    const taskReportDir = path.join(reportsDir, taskId);
    ensureDir(taskReportDir);

    const reportPath = path.join(taskReportDir, `${reportType}-report.md`);
    fs.writeFileSync(reportPath, content, 'utf-8');

    return reportPath;
  };

  // 读取报告（内部实现）
  const readReport = (taskId: string, reportType: string): string | null => {
    const reportPath = path.join(reportsDir, taskId, `${reportType}-report.md`);
    if (!fs.existsSync(reportPath)) {
      return null;
    }

    try {
      return fs.readFileSync(reportPath, 'utf-8');
    } catch {
      return null;
    }
  };

  // 重置测试环境
  const reset = (): void => {
    // 清理任务目录中的内容
    if (fs.existsSync(tasksDir)) {
      const entries = fs.readdirSync(tasksDir);
      for (const entry of entries) {
        const fullPath = path.join(tasksDir, entry);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    // 清理报告目录中的内容
    if (fs.existsSync(reportsDir)) {
      const entries = fs.readdirSync(reportsDir);
      for (const entry of entries) {
        const fullPath = path.join(reportsDir, entry);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    // 重置 mock 返回值
    mocks.isInitialized.mockReturnValue(true);
    mocks.getTasksDir.mockReturnValue(tasksDir);
    mocks.getProjectDir.mockReturnValue(projectDir);
  };

  // 完全清理测试环境
  const cleanup = (): void => {
    // 恢复所有 mock
    mocks.restore();

    // 删除临时目录
    safeRemoveDir(tempDir);
  };

  return {
    get tempDir() { return tempDir; },
    get tasksDir() { return tasksDir; },
    get projectDir() { return projectDir; },
    get reportsDir() { return reportsDir; },
    get runtimeState() { return runtimeState; },
    get config() { return config; },
    get mocks() { return mocks; },
    createTask,
    readTask,
    writeTask,
    taskExists,
    createReport,
    readReport,
    reset,
    cleanup,
  };
}

/**
 * 创建示例任务数据
 */
function createSampleTaskData(tasksDir: string): void {
  const sampleTasks = [
    {
      id: 'TASK-sample-001',
      title: 'Sample Task 1',
      type: 'feature',
      priority: 'P1',
      status: 'open',
      checkpoints: [
        { id: 'CP-1', description: 'Implement feature', status: 'pending' },
      ],
    },
    {
      id: 'TASK-sample-002',
      title: 'Sample Task 2',
      type: 'bugfix',
      priority: 'P0',
      status: 'in_progress',
      checkpoints: [
        { id: 'CP-1', description: 'Fix bug', status: 'completed' },
        { id: 'CP-2', description: 'Add test', status: 'pending' },
      ],
    },
  ];

  for (const task of sampleTasks) {
    const taskDir = path.join(tasksDir, task.id);
    ensureDir(taskDir);

    const fullMeta = {
      ...task,
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };

    fs.writeFileSync(
      path.join(taskDir, 'meta.json'),
      JSON.stringify(fullMeta, null, 2),
      'utf-8'
    );
  }
}

// ============================================================
// 便捷工具函数
// ============================================================

/**
 * 创建标准测试生命周期钩子
 *
 * @example
 * ```typescript
 * describe('Harness Tests', () => {
 *   const { setup, teardown, getCtx } = createHarnessTestLifecycle();
 *
 *   beforeEach(setup);
 *   afterEach(teardown);
 *
 *   test('should work', () => {
 *     const ctx = getCtx();
 *     ctx.createTask('TASK-001');
 *     // ...
 *   });
 * });
 * ```
 */
export function createHarnessTestLifecycle(options: HarnessTestOptions = {}) {
  let ctx: HarnessTestContext | null = null;

  return {
    /**
     * 设置测试环境（在 beforeEach 中调用）
     */
    setup: async (): Promise<void> => {
      ctx = await createHarnessTestContext(options);
    },

    /**
     * 清理测试环境（在 afterEach 中调用）
     */
    teardown: (): void => {
      if (ctx) {
        ctx.cleanup();
        ctx = null;
      }
    },

    /**
     * 获取当前上下文（在测试中使用）
     */
    getCtx: (): HarnessTestContext => {
      if (!ctx) {
        throw new Error('Harness test context not initialized. Call setup() first.');
      }
      return ctx;
    },

    /**
     * 重置环境但不清理
     */
    reset: (): void => {
      if (ctx) {
        ctx.reset();
      }
    },
  };
}

/**
 * 批量创建测试任务
 */
export function createTestTasks(
  ctx: HarnessTestContext,
  count: number,
  baseMeta: Record<string, unknown> = {}
): string[] {
  const taskIds: string[] = [];

  for (let i = 1; i <= count; i++) {
    const taskId = `TASK-${String(i).padStart(3, '0')}`;
    ctx.createTask(taskId, {
      ...baseMeta,
      id: taskId,
      title: `Test Task ${i}`,
    });
    taskIds.push(taskId);
  }

  return taskIds;
}

/**
 * 创建任务依赖关系
 */
export function createTaskDependency(
  ctx: HarnessTestContext,
  parentId: string,
  childId: string
): void {
  const parentMeta = ctx.readTask(parentId);
  if (parentMeta) {
    const deps = (parentMeta.dependencies as string[]) || [];
    if (!deps.includes(childId)) {
      deps.push(childId);
    }
    ctx.writeTask(parentId, {
      ...parentMeta,
      dependencies: deps,
    });
  }
}

/**
 * 创建开发阶段报告
 */
export function createDevReport(
  ctx: HarnessTestContext,
  taskId: string,
  status: 'success' | 'failed' = 'success',
  options: {
    checkpoints?: string[];
    evidence?: string[];
    error?: string;
  } = {}
): string {
  const now = new Date().toISOString();
  const { checkpoints = [], evidence = [], error } = options;

  const content = [
    `# 开发报告 - ${taskId}`,
    '',
    `**状态**: ${status}`,
    `**开始时间**: ${now}`,
    `**结束时间**: ${now}`,
    `**耗时**: 60.0s`,
    '',
    '## 完成的检查点',
    ...(checkpoints.length > 0 ? checkpoints.map(cp => `- ${cp}`) : ['- (无)']),
    '',
    '## 证据文件',
    ...(evidence.length > 0 ? evidence.map(e => `- ${e}`) : ['- (无)']),
    '',
    ...(error ? ['## 错误信息', error] : []),
  ].join('\n');

  return ctx.createReport(taskId, 'dev', content);
}

/**
 * 创建代码审核报告
 */
export function createCodeReviewReport(
  ctx: HarnessTestContext,
  taskId: string,
  result: 'PASS' | 'NOPASS' = 'PASS',
  options: {
    reason?: string;
    failedCheckpoints?: string[];
    details?: string;
  } = {}
): string {
  const now = new Date().toISOString();
  const {
    reason = result === 'PASS' ? 'Code review passed.' : 'Code review failed.',
    failedCheckpoints = [],
    details,
  } = options;

  const content = [
    `# 代码审核报告 - ${taskId}`,
    '',
    `**结果**: ${result === 'PASS' ? '✅' : '❌'} ${result}`,
    `**审核时间**: ${now}`,
    `**审核者**: code_reviewer`,
    '',
    '## 原因',
    reason,
    '',
    '## 未通过的检查点',
    ...(failedCheckpoints.length > 0 ? failedCheckpoints.map(cp => `- ${cp}`) : ['- (无)']),
    '',
    ...(details ? ['## 详细反馈', details] : []),
  ].join('\n');

  return ctx.createReport(taskId, 'code-review', content);
}

/**
 * 创建 QA 验证报告
 */
export function createQAReport(
  ctx: HarnessTestContext,
  taskId: string,
  result: 'PASS' | 'NOPASS' = 'PASS',
  options: {
    reason?: string;
    failedCheckpoints?: string[];
    testFailures?: string[];
    requiresHuman?: boolean;
  } = {}
): string {
  const now = new Date().toISOString();
  const {
    reason = result === 'PASS' ? 'QA passed.' : 'QA failed.',
    failedCheckpoints = [],
    testFailures = [],
    requiresHuman = false,
  } = options;

  const content = [
    `# QA 验证报告 - ${taskId}`,
    '',
    `**结果**: ${result === 'PASS' ? '✅' : '❌'} ${result}`,
    `**验证时间**: ${now}`,
    `**验证者**: qa_tester`,
    `**需要人工验证**: ${requiresHuman ? '是' : '否'}`,
    '',
    '## 原因',
    reason,
    '',
    '## 测试失败',
    ...(testFailures.length > 0 ? testFailures.map(tf => `- ${tf}`) : ['- (无)']),
    '',
    '## 未通过的检查点',
    ...(failedCheckpoints.length > 0 ? failedCheckpoints.map(cp => `- ${cp}`) : ['- (无)']),
  ].join('\n');

  return ctx.createReport(taskId, 'qa', content);
}
