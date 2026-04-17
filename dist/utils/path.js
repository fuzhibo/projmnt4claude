import * as path from 'path';
import * as fs from 'fs';
/**
 * 获取 .projmnt4claude 目录路径
 */
export function getProjectDir(cwd = process.cwd()) {
    return path.join(cwd, '.projmnt4claude');
}
// 别名，保持兼容性
export const getProjDir = getProjectDir;
/**
 * 确保目录存在
 */
export function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
/**
 * 检查项目是否已初始化
 * 条件：config.json 存在，或者 tasks 目录存在且有有效任务
 */
export function isInitialized(cwd = process.cwd()) {
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
        }
        catch {
            return false;
        }
    }
    return false;
}
/**
 * 获取配置文件路径
 */
export function getConfigPath(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'config.json');
}
/**
 * 获取任务目录路径
 */
export function getTasksDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'tasks');
}
/**
 * 获取归档目录路径
 */
export function getArchiveDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'archive');
}
/**
 * 获取工具箱目录路径
 */
export function getToolboxDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'toolbox');
}
/**
 * 获取 bin 目录路径
 */
export function getBinDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'bin');
}
/**
 * 获取报告目录路径
 */
export function getReportsDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'reports');
}
/**
 * 获取日志目录路径
 */
export function getLogsDir(cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'logs');
}
