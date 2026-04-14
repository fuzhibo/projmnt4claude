/**
 * Batch Update Logger - 批量更新操作日志记录
 *
 * 用于记录 batch-update 命令的详细操作信息，便于追踪和审计
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogsDir, ensureDir } from './path';

/**
 * 操作来源类型
 */
export type OperationSource = 'cli' | 'ide' | 'hook' | 'script' | 'unknown';

/**
 * 批量更新日志条目
 */
export interface BatchUpdateLogEntry {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 操作来源 */
  source: OperationSource;
  /** 命令行参数 */
  commandArgs: string[];
  /** 操作选项 */
  options: {
    status?: string;
    priority?: string;
    all?: boolean;
    yes?: boolean;
  };
  /** 涉及的任务列表 */
  tasks: Array<{
    id: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    oldPriority?: string;
    newPriority?: string;
  }>;
  /** 更新摘要 */
  summary: {
    totalCount: number;
    updatedCount: number;
    filteredCount: number;
  };
  /** 执行上下文信息 */
  context: {
    /** 工作目录 */
    cwd: string;
    /** 用户名 */
    user?: string;
    /** 主机名 */
    hostname?: string;
    /** 进程 ID */
    pid: number;
    /** 父进程 ID */
    ppid: number;
    /** 环境变量指示器 */
    envIndicators: {
      isVscode?: boolean;
      isCursor?: boolean;
      isJetbrains?: boolean;
      isTmux?: boolean;
      isCi?: boolean;
    };
  };
}

/**
 * 检测操作来源
 */
export function detectOperationSource(): OperationSource {
  const env = process.env;

  // 检测 IDE 环境
  if (env.VSCODE_PID || env.VSCODE_CWD || env.TERM_PROGRAM === 'vscode') {
    return 'ide';
  }
  if (env.CURSOR_PATH || env.CURSOR_SHELL_INTEGRATION) {
    return 'ide';
  }
  if (env.JETBRAINS_IDE || env.IDEA_INITIAL_DIRECTORY) {
    return 'ide';
  }

  // 检测 CI/脚本环境
  if (env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.JENKINS_URL) {
    return 'script';
  }

  // 检测 Hook 调用
  if (env.PROJMNT4CLAUDE_HOOK_MODE) {
    return 'hook';
  }

  // 默认 CLI
  if (process.stdin.isTTY) {
    return 'cli';
  }

  return 'unknown';
}

/**
 * 获取环境上下文信息
 */
export function getExecutionContext(cwd: string = process.cwd()): BatchUpdateLogEntry['context'] {
  const env = process.env;

  return {
    cwd,
    user: env.USER || env.USERNAME,
    hostname: env.HOSTNAME || env.COMPUTERNAME,
    pid: process.pid,
    ppid: process.ppid,
    envIndicators: {
      isVscode: !!(env.VSCODE_PID || env.VSCODE_CWD || env.TERM_PROGRAM === 'vscode'),
      isCursor: !!(env.CURSOR_PATH || env.CURSOR_SHELL_INTEGRATION),
      isJetbrains: !!(env.JETBRAINS_IDE || env.IDEA_INITIAL_DIRECTORY),
      isTmux: !!(env.TMUX || env.TMUX_PANE),
      isCi: !!(env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI),
    },
  };
}

/**
 * 生成日志文件路径
 */
export function getBatchUpdateLogPath(cwd: string = process.cwd()): string {
  const logsDir = getLogsDir(cwd);
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(logsDir, `batch-update-${date}.log`);
}

/**
 * 写入批量更新日志
 */
export function writeBatchUpdateLog(
  entry: Omit<BatchUpdateLogEntry, 'timestamp' | 'context' | 'source'>,
  cwd: string = process.cwd()
): void {
  const logsDir = getLogsDir(cwd);
  ensureDir(logsDir);

  const logPath = getBatchUpdateLogPath(cwd);

  const fullEntry: BatchUpdateLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    source: detectOperationSource(),
    context: getExecutionContext(cwd),
  };

  // 追加写入日志文件
  const logLine = JSON.stringify(fullEntry) + '\n';
  fs.appendFileSync(logPath, logLine, 'utf-8');
}

/**
 * 读取批量更新日志
 */
export function readBatchUpdateLogs(
  date?: string,
  cwd: string = process.cwd()
): BatchUpdateLogEntry[] {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const logPath = path.join(getLogsDir(cwd), `batch-update-${targetDate}.log`);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as BatchUpdateLogEntry);
}

/**
 * 格式化日志条目为可读文本
 */
export function formatLogEntry(entry: BatchUpdateLogEntry): string {
  const lines: string[] = [];
  const time = new Date(entry.timestamp).toLocaleString('zh-CN');

  lines.push(`[${time}] Batch Update Operation`);
  lines.push(`  Source: ${entry.source}`);
  lines.push(`  Command: ${entry.commandArgs.join(' ')}`);
  lines.push(`  Options: ${JSON.stringify(entry.options)}`);
  lines.push(`  Context: ${entry.context.cwd} (PID: ${entry.context.pid})`);
  lines.push(`  Summary: ${entry.summary.updatedCount}/${entry.summary.totalCount} tasks updated`);
  lines.push('  Tasks:');

  for (const task of entry.tasks) {
    const statusChange = task.oldStatus !== task.newStatus
      ? `${task.oldStatus} → ${task.newStatus}`
      : task.oldStatus;
    lines.push(`    - ${task.id}: ${statusChange} (${task.title.slice(0, 50)}${task.title.length > 50 ? '...' : ''})`);
  }

  return lines.join('\n');
}

/**
 * 查询特定时间范围内的日志
 */
export function queryBatchUpdateLogs(
  options: {
    startTime?: Date;
    endTime?: Date;
    taskId?: string;
    source?: OperationSource;
  } = {},
  cwd: string = process.cwd()
): BatchUpdateLogEntry[] {
  const logsDir = getLogsDir(cwd);

  if (!fs.existsSync(logsDir)) {
    return [];
  }

  // 获取所有日志文件
  const logFiles = fs.readdirSync(logsDir)
    .filter(f => f.startsWith('batch-update-') && f.endsWith('.log'))
    .map(f => path.join(logsDir, f));

  const allEntries: BatchUpdateLogEntry[] = [];

  for (const logPath of logFiles) {
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as BatchUpdateLogEntry);
    allEntries.push(...entries);
  }

  // 过滤
  return allEntries.filter(entry => {
    const entryTime = new Date(entry.timestamp);

    if (options.startTime && entryTime < options.startTime) {
      return false;
    }
    if (options.endTime && entryTime > options.endTime) {
      return false;
    }
    if (options.source && entry.source !== options.source) {
      return false;
    }
    if (options.taskId && !entry.tasks.some(t => t.id === options.taskId)) {
      return false;
    }

    return true;
  });
}
