import * as path from 'path';
import * as fs from 'fs';

/**
 * 获取 .projmnt4claude 目录路径
 */
export function getProjectDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.projmnt4claude');
}

// 别名，保持兼容性
export const getProjDir = getProjectDir;

/**
 * 确保目录存在
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 检查项目是否已初始化
 */
export function isInitialized(cwd: string = process.cwd()): boolean {
  const projectDir = getProjectDir(cwd);
  const configPath = path.join(projectDir, 'config.json');
  return fs.existsSync(configPath);
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'config.json');
}

/**
 * 获取任务目录路径
 */
export function getTasksDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'tasks');
}

/**
 * 获取归档目录路径
 */
export function getArchiveDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'archive');
}

/**
 * 获取工具箱目录路径
 */
export function getToolboxDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'toolbox');
}

/**
 * 获取钩子目录路径
 */
export function getHooksDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'hooks');
}

/**
 * 获取 bin 目录路径
 */
export function getBinDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'bin');
}

/**
 * 获取报告目录路径
 */
export function getReportsDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'reports');
}
