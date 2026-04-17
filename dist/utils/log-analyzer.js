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
import { Logger } from './logger.js';
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
    cwd;
    logger;
    constructor(cwd = process.cwd()) {
        this.cwd = cwd;
        this.logger = new Logger({ component: 'log-collector', cwd });
    }
    /**
     * 收集日志条目
     *
     * @param options - 收集选项
     * @returns 解析后的日志条目数组
     */
    collect(options = {}) {
        const { maxFiles = 10, maxEntries = 5000, startDate, endDate, minLevel, commands, } = options;
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
        const allEntries = [];
        const levelPriority = {
            error: 0, warn: 1, info: 2, debug: 3,
        };
        for (const file of logFiles) {
            const filePath = path.join(logsDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        // 日期过滤
                        if (startDate && entry.timestamp < startDate)
                            continue;
                        if (endDate && entry.timestamp > endDate)
                            continue;
                        // 级别过滤
                        if (minLevel && levelPriority[entry.level] > levelPriority[minLevel])
                            continue;
                        // 命令过滤
                        if (commands && commands.length > 0) {
                            const fileCmd = file.replace(/-\d{8}\.log$/, '');
                            if (!commands.includes(fileCmd))
                                continue;
                        }
                        allEntries.push(entry);
                    }
                    catch {
                        // 跳过无法解析的行
                    }
                }
            }
            catch {
                // 跳过无法读取的文件
            }
        }
        // 限制总数
        return allEntries.slice(0, maxEntries);
    }
    /** 收集特定时间段的日志 */
    collectSince(hours, options = {}) {
        const startDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        return this.collect({ ...options, startDate });
    }
    /** 获取可用的日志文件统计 */
    getStats() {
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
            }
            catch { /* skip */ }
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
// ============================================================
// LogAnalyzerRegistry 分析器注册表
// ============================================================
/**
 * 分析器注册表
 *
 * 管理分析器的注册、查询和批量执行。
 */
export class LogAnalyzerRegistry {
    analyzers = new Map();
    logger;
    constructor(cwd = process.cwd()) {
        this.logger = new Logger({ component: 'log-analyzer-registry', cwd });
    }
    /** 注册分析器 */
    register(analyzer) {
        if (this.analyzers.has(analyzer.name)) {
            this.logger.warn(`分析器 '${analyzer.name}' 已存在，将被覆盖`);
        }
        this.analyzers.set(analyzer.name, analyzer);
        return this;
    }
    /** 注销分析器 */
    unregister(name) {
        return this.analyzers.delete(name);
    }
    /** 获取分析器 */
    get(name) {
        return this.analyzers.get(name);
    }
    /** 获取所有已注册分析器 */
    getAll() {
        return [...this.analyzers.values()];
    }
    /** 按类别获取分析器 */
    getByCategory(category) {
        return this.getAll().filter(a => a.category === category);
    }
    /** 按策略获取分析器 */
    getByStrategy(strategy) {
        return this.getAll().filter(a => a.supportedStrategies.includes(strategy));
    }
    /** 执行所有分析器 */
    async runAll(entries, strategy = 'rule', context) {
        const results = [];
        const applicableAnalyzers = this.getByStrategy(strategy);
        for (const analyzer of applicableAnalyzers) {
            try {
                const result = await analyzer.analyze(entries, strategy, context);
                results.push(result);
            }
            catch (err) {
                this.logger.warn(`分析器 '${analyzer.name}' 执行失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return results;
    }
    /** 已注册分析器数量 */
    get size() {
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
    buildReport(results, filesScanned, totalEntries) {
        const allFindings = results.flatMap(r => r.findings);
        const bySeverity = {};
        const byCategory = {};
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
    formatText(report) {
        const lines = [];
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
        const sevIcons = {
            critical: '🔴', error: '❌', warning: '⚠️', info: 'ℹ️',
        };
        for (const [sev, count] of Object.entries(report.summary.bySeverity)) {
            lines.push(`  ${sevIcons[sev] || '•'} ${sev}: ${count}`);
        }
        lines.push('');
        // 按分析器分组输出
        for (const result of report.results) {
            if (result.findings.length === 0)
                continue;
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
                }
                else if (finding.evidence.length > 3) {
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
    formatJSON(report) {
        return JSON.stringify(report, null, 2);
    }
}
// ============================================================
// 便捷工厂函数
// ============================================================
/** 创建预配置的分析器注册表（注册所有内置分析器） */
export function createDefaultRegistry(cwd = process.cwd()) {
    const registry = new LogAnalyzerRegistry(cwd);
    // 动态导入避免循环依赖
    // 使用时通过 getBuiltInAnalyzers() 获取所有内置分析器
    return registry;
}
