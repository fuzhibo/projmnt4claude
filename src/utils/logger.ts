/**
 * 核心日志模块
 *
 * 提供统一的日志记录能力，支持多级别日志、组件标记、AI 成本追踪等。
 * 日志以 JSON Lines 格式存储于 .projmnt4claude/logs/ 目录，按命令和日期命名文件实现每日轮转。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getProjectDir, ensureDir, getLogsDir, getConfigPath } from './path';

/** 日志级别 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 日志条目（JSON Lines 格式） */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component?: string;
  message: string;
  data?: Record<string, unknown>;
}

/** AI 成本汇总（仅记录字段名、耗时、tokens，不含 prompt/result 内容） */
export interface AICostSummary {
  /** 调用字段/功能名称 */
  field: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 输入 tokens */
  inputTokens: number;
  /** 输出 tokens */
  outputTokens: number;
  /** 总 tokens */
  totalTokens: number;
}

/** Bug 报告结果 */
export interface BugReportResult {
  /** Markdown 格式报告 */
  markdown: string;
  /** 压缩附件路径 */
  archivePath: string;
}

/** AI 成本汇总结果 */
export interface CostSummaryResult {
  /** 总调用次数 */
  totalCalls: number;
  /** 总耗时(ms) */
  totalDurationMs: number;
  /** 总输入 tokens */
  totalInputTokens: number;
  /** 总输出 tokens */
  totalOutputTokens: number;
  /** 总 tokens */
  totalTokens: number;
  /** 按字段分组 */
  byField: Record<string, { calls: number; durationMs: number; totalTokens: number }>;
  /** 按命令分组 */
  byCommand: Record<string, { calls: number; durationMs: number; totalTokens: number }>;
}

/** 使用分析结果 */
export interface UsageAnalysisResult {
  /** 命令使用频率 */
  commandFrequency: Record<string, number>;
  /** 常见错误模式 */
  commonErrors: Array<{ message: string; count: number; lastSeen: string }>;
  /** 平均命令耗时(ms) */
  averageDurationMs: number;
  /** AI 使用率 (0-1) */
  aiUsageRate: number;
  /** 总命令数 */
  totalCommands: number;
  /** 总错误数 */
  totalErrors: number;
  /** 总警告数 */
  totalWarnings: number;
}

/** Logger 构造选项 */
export interface LoggerOptions {
  /** 组件标记 */
  component?: string;
  /** 工作目录 */
  cwd?: string;
  /** 关联命令名（用于日志文件命名） */
  command?: string;
}

/** 日志级别优先级映射 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// getLogsDir 已移至 path.ts，通过 import 引入

/**
 * 获取日志文件路径
 * 格式: .projmnt4claude/logs/<command>-YYYYMMDD.log
 */
function getLogFilePath(command: string, cwd: string = process.cwd()): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const logsDir = getLogsDir(cwd);
  ensureDir(logsDir);
  return path.join(logsDir, `${command}-${date}.log`);
}

/**
 * 核心日志类
 *
 * 支持 error/warn/info/debug 四级日志，JSON Lines 格式存储，按命令和日期自动轮转。
 * 通过 child() 方法可创建带组件标记的子 logger，用于区分不同模块的日志来源。
 *
 * @example
 * ```ts
 * const logger = new Logger({ command: 'task' });
 * logger.logCommandStart('task', { action: 'create' });
 * logger.info('创建任务', { taskId: 'TASK-001' });
 * const childLogger = logger.child('validator');
 * childLogger.warn('字段缺失', { field: 'title' });
 * logger.logCommandEnd('task', 0);
 * logger.flush();
 * ```
 */
export class Logger {
  private component?: string;
  private cwd: string;
  private command?: string;
  private buffer: LogEntry[];
  private minLevel: LogLevel;
  private lastWrittenIndex: number;

  constructor(options: LoggerOptions = {}) {
    this.component = options.component;
    this.cwd = options.cwd || process.cwd();
    this.command = options.command;
    this.buffer = [];
    this.minLevel = this.resolveLogLevel();
    this.lastWrittenIndex = 0;
  }

  /**
   * 解析日志级别
   * 优先级: 环境变量 LOG_LEVEL > config.json logging.level > 默认 'info'
   */
  private resolveLogLevel(): LogLevel {
    // 1. 环境变量最高优先级
    const envLevel = process.env.LOG_LEVEL;
    if (envLevel && envLevel in LEVEL_PRIORITY) {
      return envLevel as LogLevel;
    }

    // 2. 从 config.json 读取 logging.level
    try {
      const configPath = getConfigPath(this.cwd);
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as { logging?: { level?: string } };
        const configLevel = config?.logging?.level;
        if (configLevel && configLevel in LEVEL_PRIORITY) {
          return configLevel as LogLevel;
        }
      }
    } catch {
      // 配置读取失败不影响 Logger 初始化
    }

    // 3. 默认 info
    return 'info';
  }

  /**
   * 记录日志条目
   * 添加到缓冲区、输出到控制台、持久化到文件（如果 command 已设置）
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] > LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.component) {
      entry.component = this.component;
    }

    if (data) {
      entry.data = data;
    }

    this.buffer.push(entry);
    this.outputToConsole(level, entry);

    if (this.command) {
      this.writeEntry(entry);
      this.lastWrittenIndex = this.buffer.length;
    }
  }

  /**
   * 输出日志到控制台
   */
  private outputToConsole(level: LogLevel, entry: LogEntry): void {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const prefix = entry.component ? `[${entry.component}] ` : '';
    fn(`${prefix}${entry.message}`);
  }

  /**
   * 写入单条日志到文件（追加模式）
   */
  private writeEntry(entry: LogEntry): void {
    try {
      const filePath = getLogFilePath(this.command!, this.cwd);
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 日志写入失败不中断主流程
    }
  }

  /**
   * 记录 error 级别日志
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  /**
   * 记录 warn 级别日志
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  /**
   * 记录 info 级别日志
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  /**
   * 记录 debug 级别日志
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  /**
   * 创建带组件标记的子 logger
   * 子 logger 继承 cwd 和 command，组件名以冒号层级连接
   *
   * @param component - 组件名称
   * @returns 新的 Logger 实例，带有组合后的组件标记
   */
  child(component: string): Logger {
    return new Logger({
      component: this.component ? `${this.component}:${component}` : component,
      cwd: this.cwd,
      command: this.command,
    });
  }

  /**
   * 记录命令开始
   * 设置当前命令名，并将之前缓冲的条目写入文件，然后记录开始条目
   *
   * @param command - 命令名称（用于日志文件命名）
   * @param args - 命令参数（可选）
   */
  logCommandStart(command: string, args?: Record<string, unknown>): void {
    this.command = command;

    // 将之前缓冲的条目写入文件
    this.flush();

    // 记录命令开始条目
    this.log('info', `命令开始: ${command}`, {
      command,
      ...(args ? { args } : {}),
    });
  }

  /**
   * 记录命令结束
   *
   * @param command - 命令名称
   * @param exitCode - 退出码，默认 0
   */
  logCommandEnd(command: string, exitCode: number = 0): void {
    this.log('info', `命令结束: ${command}`, { command, exitCode });
  }

  /**
   * 记录 AI 调用成本汇总
   * 仅记录字段名、耗时、tokens，不记录 prompt/result 内容，保护敏感数据
   *
   * @param summary - AI 成本汇总信息
   */
  logAICost(summary: AICostSummary): void {
    this.log('info', `AI 成本: ${summary.field}`, {
      aiCost: {
        field: summary.field,
        durationMs: summary.durationMs,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        totalTokens: summary.totalTokens,
      },
    });
  }

  /**
   * 记录模块埋点数据
   * 统一记录格式: {module, action, input_summary, output_summary, ai_used, ai_enhanced_fields, duration_ms, user_edit_count}
   *
   * @param record - 埋点记录
   */
  logInstrumentation(record: InstrumentationRecord): void {
    this.log('info', `埋点: ${record.module}:${record.action}`, {
      instrumentation: record,
    });
  }

  /**
   * 刷新缓冲区，将未持久化的日志条目写入文件
   */
  flush(): void {
    if (!this.command) return;

    for (let i = this.lastWrittenIndex; i < this.buffer.length; i++) {
      const entry = this.buffer[i];
      if (entry) this.writeEntry(entry);
    }
    this.lastWrittenIndex = this.buffer.length;
  }

  /**
   * 读取最近的日志条目（跨所有日志文件，按时间倒序）
   *
   * @param recentCount - 最多读取的条目数，默认 50
   * @returns 日志条目数组，按时间倒序排列
   */
  private readRecentLogEntries(recentCount: number = 50): LogEntry[] {
    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) return [];

    try {
      const files = fs.readdirSync(logsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      const allEntries: LogEntry[] = [];
      for (const file of files) {
        if (allEntries.length >= recentCount) break;
        try {
          const content = fs.readFileSync(path.join(logsDir, file.name), 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              allEntries.push(JSON.parse(line));
            } catch {
              // 跳过无法解析的行
            }
          }
        } catch {
          // 跳过无法读取的文件
        }
      }

      // 按时间倒序排列并截取
      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return allEntries.slice(0, recentCount);
    } catch {
      return [];
    }
  }

  /**
   * 读取所有日志条目（用于汇总分析）
   */
  private readAllLogEntries(): LogEntry[] {
    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) return [];

    try {
      const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
      const allEntries: LogEntry[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              allEntries.push(JSON.parse(line));
            } catch {
              // 跳过无法解析的行
            }
          }
        } catch {
          // 跳过无法读取的文件
        }
      }

      return allEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch {
      return [];
    }
  }

  /**
   * 生成 Bug 报告
   * 读取最近 N 次命令日志，提取错误/警告，生成 Markdown 摘要 + .tar.gz 压缩附件
   *
   * @param recentCount - 读取最近日志条目数量，默认 100
   * @returns Bug 报告结果（Markdown 内容 + 压缩附件路径）
   */
  generateBugReport(recentCount: number = 100): BugReportResult {
    const entries = this.readRecentLogEntries(recentCount);
    const errors = entries.filter(e => e.level === 'error');
    const warnings = entries.filter(e => e.level === 'warn');

    const now = new Date().toISOString();
    const timestamp = now.replace(/[:.]/g, '-').slice(0, 19);

    // 生成 Markdown 报告
    const lines: string[] = [
      `# Bug Report`,
      ``,
      `**生成时间**: ${now}`,
      `**工作目录**: ${this.cwd}`,
      `**平台**: ${process.platform} / ${process.version}`,
      ``,
      `## 概要`,
      ``,
      `- 总日志条目: ${entries.length}`,
      `- 错误数: ${errors.length}`,
      `- 警告数: ${warnings.length}`,
      ``,
    ];

    if (errors.length > 0) {
      lines.push(`## 错误详情`, ``);
      for (const err of errors) {
        const comp = err.component ? ` [${err.component}]` : '';
        lines.push(`### ${err.timestamp}${comp}`, ``);
        lines.push(`\`${err.message}\``, ``);
        if (err.data) {
          lines.push('```json', JSON.stringify(err.data, null, 2), '```', '');
        }
      }
    }

    if (warnings.length > 0) {
      lines.push(`## 警告详情`, ``);
      for (const warn of warnings) {
        const comp = warn.component ? ` [${warn.component}]` : '';
        lines.push(`- **${warn.timestamp}**${comp}: ${warn.message}`);
      }
      lines.push('');
    }

    // 生成压缩附件
    const archivePath = this.compressLogs(
      path.join(getLogsDir(this.cwd), '..', `bug-report-${timestamp}.tar.gz`)
    );

    lines.push(`---`, `*日志压缩附件: ${archivePath}*`);

    return {
      markdown: lines.join('\n'),
      archivePath,
    };
  }

  /**
   * 将日志目录压缩为 .tar.gz 文件
   *
   * @param outputPath - 输出文件路径，默认 .projmnt4claude/logs-archive.tar.gz
   * @returns 压缩文件路径
   */
  compressLogs(outputPath?: string): string {
    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) {
      throw new Error(`日志目录不存在: ${logsDir}`);
    }

    const archivePath = outputPath || path.join(path.dirname(logsDir), 'logs-archive.tar.gz');
    ensureDir(path.dirname(archivePath));

    const parentDir = path.dirname(logsDir);
    const logsDirName = path.basename(logsDir);

    try {
      execSync(`tar -czf "${archivePath}" -C "${parentDir}" "${logsDirName}"`, {
        stdio: 'pipe',
      });
    } catch (err) {
      throw new Error(`日志压缩失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return archivePath;
  }

  /**
   * 清理过期日志文件
   * 删除超过 maxAgeDays 天的日志文件以释放存储空间
   *
   * @param maxAgeDays - 最大保留天数，默认 30 天
   * @returns 删除的文件数量
   */
  cleanupOldLogs(maxAgeDays: number = 30): number {
    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    try {
      const files = fs.readdirSync(logsDir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const filePath = path.join(logsDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {
          // 单个文件处理失败不影响其他文件
        }
      }
    } catch {
      // 目录读取失败不中断主流程
    }

    return deletedCount;
  }

  /**
   * 获取 AI 成本汇总
   * 聚合 AI 调用次数、总耗时、按命令/字段分组统计（仅汇总指标，不含 prompt/result 内容）
   */
  getCostSummary(): CostSummaryResult {
    const entries = this.readAllLogEntries();
    const aiEntries = entries.filter(e => e.data?.aiCost);

    const result: CostSummaryResult = {
      totalCalls: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      byField: {},
      byCommand: {},
    };

    for (const entry of aiEntries) {
      const cost = entry.data!.aiCost as {
        field: string;
        durationMs: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };

      result.totalCalls++;
      result.totalDurationMs += cost.durationMs || 0;
      result.totalInputTokens += cost.inputTokens || 0;
      result.totalOutputTokens += cost.outputTokens || 0;
      result.totalTokens += cost.totalTokens || 0;

      // 按字段分组
      const field = cost.field || 'unknown';
      if (!result.byField[field]) {
        result.byField[field] = { calls: 0, durationMs: 0, totalTokens: 0 };
      }
      result.byField[field].calls++;
      result.byField[field].durationMs += cost.durationMs || 0;
      result.byField[field].totalTokens += cost.totalTokens || 0;

      // 按命令分组（从日志文件名推断或从 data.command 获取）
      const command = (entry.data as Record<string, unknown>)?.command as string || 'unknown';
      if (!result.byCommand[command]) {
        result.byCommand[command] = { calls: 0, durationMs: 0, totalTokens: 0 };
      }
      result.byCommand[command].calls++;
      result.byCommand[command].durationMs += cost.durationMs || 0;
      result.byCommand[command].totalTokens += cost.totalTokens || 0;
    }

    return result;
  }

  /**
   * 分析使用模式
   * 聚合命令使用频率、常见错误模式、平均耗时、AI 使用率
   */
  analyzeUsage(): UsageAnalysisResult {
    const entries = this.readAllLogEntries();

    // 命令频率统计
    const commandFrequency: Record<string, number> = {};
    const commandDurations: Record<string, number[]> = {};
    const commandsWithAI = new Set<string>();
    const errorMessages: Record<string, { count: number; lastSeen: string }> = {};

    let totalCommands = 0;
    let totalErrors = 0;
    let totalWarnings = 0;

    // 跟踪命令开始/结束用于计算耗时
    const commandStarts: Record<string, string> = {}; // command -> timestamp

    for (const entry of entries) {
      const data = entry.data as Record<string, unknown> | undefined;
      const command = (data?.command as string) || 'unknown';

      // 统计命令开始
      if (entry.message?.startsWith('命令开始:')) {
        totalCommands++;
        commandFrequency[command] = (commandFrequency[command] || 0) + 1;
        commandStarts[command] = entry.timestamp;
      }

      // 统计命令结束，计算耗时
      if (entry.message?.startsWith('命令结束:') && commandStarts[command]) {
        const startMs = new Date(commandStarts[command]).getTime();
        const endMs = new Date(entry.timestamp).getTime();
        if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
          if (!commandDurations[command]) commandDurations[command] = [];
          commandDurations[command].push(endMs - startMs);
        }
        delete commandStarts[command];
      }

      // 统计 AI 使用
      if (data?.aiCost) {
        commandsWithAI.add(command);
      }

      // 统计错误
      if (entry.level === 'error') {
        totalErrors++;
        const msg = entry.message;
        if (msg) {
          if (!errorMessages[msg]) {
            errorMessages[msg] = { count: 0, lastSeen: entry.timestamp };
          }
          errorMessages[msg].count++;
          errorMessages[msg].lastSeen = entry.timestamp;
        }
      }

      // 统计警告
      if (entry.level === 'warn') {
        totalWarnings++;
      }
    }

    // 计算平均耗时
    const allDurations = Object.values(commandDurations).flat();
    const averageDurationMs = allDurations.length > 0
      ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
      : 0;

    // 计算AI使用率
    const aiUsageRate = totalCommands > 0
      ? commandsWithAI.size / Object.keys(commandFrequency).length
      : 0;

    // 排序常见错误
    const commonErrors = Object.entries(errorMessages)
      .map(([message, info]) => ({ message, count: info.count, lastSeen: info.lastSeen }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      commandFrequency,
      commonErrors,
      averageDurationMs,
      aiUsageRate: Math.min(aiUsageRate, 1),
      totalCommands,
      totalErrors,
      totalWarnings,
    };
  }
}

/** 埋点记录结构 (CP-6) */
export interface InstrumentationRecord {
  /** 模块名 */
  module: string;
  /** 操作名 */
  action: string;
  /** 输入摘要 */
  input_summary: string;
  /** 输出摘要 */
  output_summary: string;
  /** 是否使用 AI */
  ai_used: boolean;
  /** AI 增强字段列表 */
  ai_enhanced_fields: string[];
  /** 耗时(ms) */
  duration_ms: number;
  /** 用户编辑次数 */
  user_edit_count: number;
  /** 模块专有数据 */
  module_data?: Record<string, unknown>;
}

/**
 * Logger 工厂函数
 * 创建指定命令名的 Logger 实例并记录命令开始
 */
export function createLogger(command: string, cwd?: string): Logger {
  const logger = new Logger({ command, cwd });
  logger.logCommandStart(command);
  return logger;
}
