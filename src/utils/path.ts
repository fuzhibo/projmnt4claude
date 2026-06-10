import * as path from 'path';
import * as fs from 'fs';

/**
 * 获取 .projmnt4claude 目录路径
 */
export function getProjectDir(cwd: string = process.cwd()): string {
  // 测试注入点：允许测试通过全局变量注入 mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getProjectDir) {
    return testMocks.getProjectDir(cwd);
  }
  return path.join(cwd, '.projmnt4claude');
}

// 别名，保持兼容性
export const getProjDir = getProjectDir;

/**
 * 确保目录存在
 */
export function ensureDir(dir: string): void {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.ensureDir) {
    return testMocks.ensureDir(dir);
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 检查项目是否已初始化
 * 条件：config.json 存在，或者 tasks 目录存在且有有效任务
 */
export function isInitialized(cwd: string = process.cwd()): boolean {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.isInitialized) {
    return testMocks.isInitialized(cwd);
  }
  const projectDir = getProjectDir(cwd);
  const configPath = path.join(projectDir, 'config.json');

  // 条件1: config.json 存在
  if (fs.existsSync(configPath)) {
    return true;
  }

  // 条件2: tasks 目录存在且有有效任务文件
  const tasksDir = path.join(projectDir, 'tasks');
  if (fs.existsSync(tasksDir)) {
    try {
      const taskDirs = fs.readdirSync(tasksDir);
      // 检查是否有任何包含 meta.json 的任务目录
      return taskDirs.some(taskDir => {
        const metaPath = path.join(tasksDir, taskDir, 'meta.json');
        return fs.existsSync(metaPath);
      });
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getConfigPath) {
    return testMocks.getConfigPath(cwd);
  }
  return path.join(getProjectDir(cwd), 'config.json');
}

/**
 * 获取任务目录路径
 */
export function getTasksDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getTasksDir) {
    return testMocks.getTasksDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'tasks');
}

/**
 * 获取归档目录路径
 */
export function getArchiveDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getArchiveDir) {
    return testMocks.getArchiveDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'archive');
}

/**
 * 获取工具箱目录路径
 */
export function getToolboxDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getToolboxDir) {
    return testMocks.getToolboxDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'toolbox');
}

/**
 * 获取 bin 目录路径
 */
export function getBinDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getBinDir) {
    return testMocks.getBinDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'bin');
}

/**
 * 获取报告目录路径
 */
export function getReportsDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getReportsDir) {
    return testMocks.getReportsDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'reports');
}

/**
 * 获取日志目录路径
 */
export function getLogsDir(cwd: string = process.cwd()): string {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.getLogsDir) {
    return testMocks.getLogsDir(cwd);
  }
  return path.join(getProjectDir(cwd), 'logs');
}
