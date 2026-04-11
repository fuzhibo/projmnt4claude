/**
 * 插件化日志分析框架
 *
 * 提供通用的日志分析基础设施：
 * - LogAnalyzer 接口：分析器契约
 * - LogCollector：日志收集器，从 .projmnt4claude/logs/ 读取并解析日志
 * - LogAnalyzerRegistry：分析器注册表，管理分析器的注册与执行
 * - AnalysisReporter：结果报告器，格式化输出分析结果
 *
 * 三级触发策略：
 * - doctor (规则快速)：仅运行规则分析器
 * - doctor --deep (AI深度)：运行规则 + AI 增强分析
 * - doctor --bug-report (完整报告)：运行所有分析 + 生成报告
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogsDir } from './path.js';
import { Logger, type LogEntry, type LogLevel } from './logger.js';

// ============================================================
// 类型定义
// ============================================================

/** 分析严重级别 */
export type AnalysisSeverity = 'info' | 'warning' | 'error' | 'critical';

/** 分析类别 */
export type AnalysisCategory =
  | 'headless-claude'    // AI 调用日志
  | 'harness-pipeline'   // 流水线执行日志
  | 'api-error'          // API 错误日志
  | 'performance';       // 性能日志

/** 分析策略 */
export type AnalysisStrategy = 'rule' | 'ai' | 'hybrid';

/** 单条分析发现 */
export interface AnalysisFinding {
  /** 分析器名称 */
  analyzer: string;
  /** 严重级别 */
  severity: AnalysisSeverity;
  /** 类别 */
  category: AnalysisCategory;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 相关日志条目（时间戳或索引引用） */
  evidence: string[];
  /** 修复建议 */
  recommendation: string;
  /** 发现时间 */
  detectedAt: string;
}

/** 分析结果 */
export interface AnalysisResult {
  /** 分析器名称 */
  analyzerName: string;
  /** 分析策略 */
  strategy: AnalysisStrategy;
  /** 分析发现 */
  findings: AnalysisFinding[];
  /** 分析统计 */
  stats: {
    /** 扫描的日志条目数 */
    entriesScanned: number;
    /** 发现的问题数 */
    findingsCount: number;
    /** 分析耗时(ms) */
    durationMs: number;
  };
}

/** 分析报告 */
export interface AnalysisReport {
  /** 报告生成时间 */
  generatedAt: string;
  /** 扫描的日志文件数 */
  filesScanned: number;
  /** 总日志条目数 */
  totalEntries: number;
  /** 各分析器结果 */
  results: AnalysisResult[];
  /** 汇总统计 */
  summary: {
    totalFindings: number;
    bySeverity: Record<AnalysisSeverity, number>;
    byCategory: Record<AnalysisCategory, number>;
  };
}

// ============================================================
// LogAnalyzer 接口
// ============================================================

/**
 * 日志分析器接口
 *
 * 所有分析器必须实现此接口。支持规则分析和 AI 分析混合策略。
 */
export interface LogAnalyzer {
  /** 分析器名称 */
  readonly name: string;

  /** 分析类别 */
  readonly category: AnalysisCategory;

  /** 支持的分析策略 */
  readonly supportedStrategies: AnalysisStrategy[];

  /** 执行分析 */
  analyze(
    entries: LogEntry[],
    strategy: AnalysisStrategy,
    context?: AnalysisContext,
  ): Promise<AnalysisResult>;
}

/** 分析上下文，提供额外信息供 AI 分析使用 */
export interface AnalysisContext {
  /** 工作目录 */
  cwd: string;
  /** 是否启用 AI 分析 */
  enableAI: boolean;
  /** 额外参数 */
  extra?: Record<string, unknown>;
}

// ============================================================
// LogCollector 日志收集器
// ============================================================

/**
 * 日志收集器
 *
 * 从 .projmnt4claude/logs/ 读取日志文件并解析为 LogEntry 数组。
 * 支持时间范围过滤、级别过滤和命令过滤。
 */
export class LogCollector {
  private cwd: string;
  private logger: Logger;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.logger = new Logger({ component: 'log-collector', cwd });
  }

  /**
   * 收集日志条目
   *
   * @param options - 收集选项
   * @returns 解析后的日志条目数组
   */
  collect(options: LogCollectOptions = {}): LogEntry[] {
    const {
      maxFiles = 10,
      maxEntries = 5000,
      startDate,
      endDate,
      minLevel,
      commands,
    } = options;

    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) {
      return [];
    }

    // 读取并排序日志文件（最新优先）
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, maxFiles);

    const allEntries: LogEntry[] = [];
    const levelPriority: Record<LogLevel, number> = {
      error: 0, warn: 1, info: 2, debug: 3,
    };

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry: LogEntry = JSON.parse(line);

            // 日期过滤
            if (startDate && entry.timestamp < startDate) continue;
            if (endDate && entry.timestamp > endDate) continue;

            // 级别过滤
            if (minLevel && levelPriority[entry.level] > levelPriority[minLevel]) continue;

            // 命令过滤
            if (commands && commands.length > 0) {
              const fileCmd = file.replace(/-\d{8}\.log$/, '');
              if (!commands.includes(fileCmd)) continue;
            }

            allEntries.push(entry);
          } catch {
            // 跳过无法解析的行
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    // 限制总数
    return allEntries.slice(0, maxEntries);
  }

  /** 收集特定时间段的日志 */
  collectSince(hours: number, options: Omit<LogCollectOptions, 'startDate' | 'endDate'> = {}): LogEntry[] {
    const startDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return this.collect({ ...options, startDate });
  }

  /** 获取可用的日志文件统计 */
  getStats(): { fileCount: number; totalSizeKB: number; oldestFile: string | null; newestFile: string | null } {
    const logsDir = getLogsDir(this.cwd);
    if (!fs.existsSync(logsDir)) {
      return { fileCount: 0, totalSizeKB: 0, oldestFile: null, newestFile: null };
    }

    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
    let totalSizeKB = 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(logsDir, f));
        totalSizeKB += stat.size / 1024;
      } catch { /* skip */ }
    }

    const sorted = files.sort();
    return {
      fileCount: files.length,
      totalSizeKB: Math.round(totalSizeKB),
      oldestFile: sorted[0] || null,
      newestFile: sorted[sorted.length - 1] || null,
    };
  }
}

/** 日志收集选项 */
export interface LogCollectOptions {
  /** 最大读取文件数（默认 10） */
  maxFiles?: number;
  /** 最大条目数（默认 5000） */
  maxEntries?: number;
  /** 起始时间 ISO 字符串 */
  startDate?: string;
  /** 结束时间 ISO 字符串 */
  endDate?: string;
  /** 最低日志级别 */
  minLevel?: LogLevel;
  /** 按命令过滤 */
  commands?: string[];
}

// ============================================================
// LogAnalyzerRegistry 分析器注册表
// ============================================================

/**
 * 分析器注册表
 *
 * 管理分析器的注册、查询和批量执行。
 */
export class LogAnalyzerRegistry {
  private analyzers = new Map<string, LogAnalyzer>();
  private logger: Logger;

  constructor(cwd: string = process.cwd()) {
    this.logger = new Logger({ component: 'log-analyzer-registry', cwd });
  }

  /** 注册分析器 */
  register(analyzer: LogAnalyzer): this {
    if (this.analyzers.has(analyzer.name)) {
      this.logger.warn(`分析器 '${analyzer.name}' 已存在，将被覆盖`);
    }
    this.analyzers.set(analyzer.name, analyzer);
    return this;
  }

  /** 注销分析器 */
  unregister(name: string): boolean {
    return this.analyzers.delete(name);
  }

  /** 获取分析器 */
  get(name: string): LogAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  /** 获取所有已注册分析器 */
  getAll(): LogAnalyzer[] {
    return [...this.analyzers.values()];
  }

  /** 按类别获取分析器 */
  getByCategory(category: AnalysisCategory): LogAnalyzer[] {
    return this.getAll().filter(a => a.category === category);
  }

  /** 按策略获取分析器 */
  getByStrategy(strategy: AnalysisStrategy): LogAnalyzer[] {
    return this.getAll().filter(a => a.supportedStrategies.includes(strategy));
  }

  /** 执行所有分析器 */
  async runAll(
    entries: LogEntry[],
    strategy: AnalysisStrategy = 'rule',
    context?: AnalysisContext,
  ): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];
    const applicableAnalyzers = this.getByStrategy(strategy);

    for (const analyzer of applicableAnalyzers) {
      try {
        const result = await analyzer.analyze(entries, strategy, context);
        results.push(result);
      } catch (err) {
        this.logger.warn(`分析器 '${analyzer.name}' 执行失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results;
  }

  /** 已注册分析器数量 */
  get size(): number {
    return this.analyzers.size;
  }
}

// ============================================================
// AnalysisReporter 结果报告器
// ============================================================

/**
 * 分析结果报告器
 *
 * 将 AnalysisReport 格式化为可读文本或 JSON。
 */
export class AnalysisReporter {
  /**
   * 生成分析报告
   */
  buildReport(
    results: AnalysisResult[],
    filesScanned: number,
    totalEntries: number,
  ): AnalysisReport {
    const allFindings = results.flatMap(r => r.findings);

    const bySeverity = {} as Record<AnalysisSeverity, number>;
    const byCategory = {} as Record<AnalysisCategory, number>;

    for (const f of allFindings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      filesScanned,
      totalEntries,
      results,
      summary: {
        totalFindings: allFindings.length,
        bySeverity,
        byCategory,
      },
    };
  }

  /**
   * 格式化为可读文本
   */
  formatText(report: AnalysisReport): string {
    const lines: string[] = [];

    lines.push(`📊 日志分析报告`);
    lines.push(`生成时间: ${report.generatedAt}`);
    lines.push(`扫描文件: ${report.filesScanned} 个 | 日志条目: ${report.totalEntries} 条`);
    lines.push('');

    if (report.summary.totalFindings === 0) {
      lines.push('✅ 未发现异常');
      return lines.join('\n');
    }

    // 汇总
    lines.push('## 汇总');
    const sevIcons: Record<AnalysisSeverity, string> = {
      critical: '🔴', error: '❌', warning: '⚠️', info: 'ℹ️',
    };
    for (const [sev, count] of Object.entries(report.summary.bySeverity)) {
      lines.push(`  ${sevIcons[sev as AnalysisSeverity] || '•'} ${sev}: ${count}`);
    }
    lines.push('');

    // 按分析器分组输出
    for (const result of report.results) {
      if (result.findings.length === 0) continue;

      lines.push(`## ${result.analyzerName} (${result.strategy})`);
      lines.push(`  扫描: ${result.stats.entriesScanned} 条 | 发现: ${result.stats.findingsCount} 个问题 | 耗时: ${result.stats.durationMs}ms`);
      lines.push('');

      for (const finding of result.findings) {
        lines.push(`  ${sevIcons[finding.severity]} [${finding.severity.toUpperCase()}] ${finding.title}`);
        lines.push(`    ${finding.description}`);
        if (finding.recommendation) {
          lines.push(`    💡 建议: ${finding.recommendation}`);
        }
        if (finding.evidence.length > 0 && finding.evidence.length <= 3) {
          lines.push(`    证据: ${finding.evidence.join(', ')}`);
        } else if (finding.evidence.length > 3) {
          lines.push(`    证据: ${finding.evidence.slice(0, 3).join(', ')} ... (+${finding.evidence.length - 3})`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化为 JSON
   */
  formatJSON(report: AnalysisReport): string {
    return JSON.stringify(report, null, 2);
  }
}

// ============================================================
// 便捷工厂函数
// ============================================================

/** 创建预配置的分析器注册表（注册所有内置分析器） */
export function createDefaultRegistry(
  cwd: string = process.cwd(),
): LogAnalyzerRegistry {
  const registry = new LogAnalyzerRegistry(cwd);
  // 动态导入避免循环依赖
  // 使用时通过 getBuiltInAnalyzers() 获取所有内置分析器
  return registry;
}
