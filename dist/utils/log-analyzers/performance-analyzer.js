/**
 * PerformanceAnalyzer - 性能日志分析器
 *
 * 检测执行性能问题：
 * - 执行耗时异常（过长）
 * - 超时率过高
 * - 命令执行缓慢
 * - 资源使用异常
 */
import {} from '../log-analyzer.js';
export class PerformanceAnalyzer {
    name = 'performance-analyzer';
    category = 'performance';
    supportedStrategies = ['rule', 'hybrid'];
    /** 慢操作阈值(ms) */
    SLOW_THRESHOLD_MS = 60_000; // 1 分钟
    /** 极慢操作阈值(ms) */
    VERY_SLOW_THRESHOLD_MS = 300_000; // 5 分钟
    async analyze(entries, strategy, _context) {
        const startTime = Date.now();
        const findings = [];
        // 筛选性能相关日志（含 durationMs 的日志）
        const perfEntries = entries.filter(e => e.data && typeof e.data === 'object' && 'durationMs' in e.data);
        // 同时筛选超时相关日志
        const timeoutEntries = entries.filter(e => e.message.includes('超时') || e.message.includes('timeout') || e.message.includes('timed out'));
        // 规则 1: 检测慢操作
        const slowOps = perfEntries.filter(e => {
            const duration = Number(e.data?.durationMs || 0);
            return duration > this.SLOW_THRESHOLD_MS;
        });
        const verySlowOps = slowOps.filter(e => {
            const duration = Number(e.data?.durationMs || 0);
            return duration > this.VERY_SLOW_THRESHOLD_MS;
        });
        if (verySlowOps.length >= 1) {
            findings.push({
                analyzer: this.name,
                severity: 'error',
                category: this.category,
                title: `检测到 ${verySlowOps.length} 个极慢操作 (>5min)`,
                description: '超过5分钟的操作严重影响效率',
                evidence: verySlowOps.slice(0, 3).map(e => {
                    const duration = Number(e.data?.durationMs || 0);
                    return `[${e.timestamp}] ${e.message} (${(duration / 1000).toFixed(1)}s)`;
                }),
                recommendation: '拆分复杂任务、优化 prompt 长度或增加超时配置',
                detectedAt: new Date().toISOString(),
            });
        }
        else if (slowOps.length >= 3) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${slowOps.length} 个慢操作 (>1min)`,
                description: '多个操作超过1分钟，可能影响流水线整体效率',
                evidence: slowOps.slice(0, 3).map(e => {
                    const duration = Number(e.data?.durationMs || 0);
                    return `[${e.timestamp}] ${e.message} (${(duration / 1000).toFixed(1)}s)`;
                }),
                recommendation: '关注耗时最长的操作，考虑优化或拆分',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 2: 检测超时率
        if (timeoutEntries.length >= 3) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${timeoutEntries.length} 次超时`,
                description: '频繁超时可能表示任务复杂度过高或资源配置不足',
                evidence: timeoutEntries.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '检查超时配置，适当增加 timeout 或降低任务复杂度',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 3: 检测错误率
        const errorEntries = entries.filter(e => e.level === 'error');
        const totalEntries = entries.length;
        if (totalEntries > 10) {
            const errorRate = errorEntries.length / totalEntries;
            if (errorRate > 0.2) {
                findings.push({
                    analyzer: this.name,
                    severity: 'error',
                    category: this.category,
                    title: `错误率过高: ${(errorRate * 100).toFixed(1)}% (${errorEntries.length}/${totalEntries})`,
                    description: '超过20%的日志条目为错误级别',
                    evidence: [`总条目: ${totalEntries}`, `错误条目: ${errorEntries.length}`],
                    recommendation: '排查主要错误来源，优先解决高频错误',
                    detectedAt: new Date().toISOString(),
                });
            }
            else if (errorRate > 0.1) {
                findings.push({
                    analyzer: this.name,
                    severity: 'warning',
                    category: this.category,
                    title: `错误率偏高: ${(errorRate * 100).toFixed(1)}%`,
                    description: '超过10%的日志条目为错误级别',
                    evidence: [`总条目: ${totalEntries}`, `错误条目: ${errorEntries.length}`],
                    recommendation: '关注错误趋势',
                    detectedAt: new Date().toISOString(),
                });
            }
        }
        // 规则 4: 检测高频操作模式（同一操作短时间内大量执行）
        const messageCounts = {};
        for (const e of entries) {
            const key = e.message.slice(0, 80);
            messageCounts[key] = (messageCounts[key] || 0) + 1;
        }
        const highFreqMessages = Object.entries(messageCounts)
            .filter(([, count]) => count > 50)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        if (highFreqMessages.length > 0) {
            findings.push({
                analyzer: this.name,
                severity: 'info',
                category: this.category,
                title: '检测到高频操作模式',
                description: '某些操作在短时间内被大量执行',
                evidence: highFreqMessages.map(([msg, count]) => `"${msg}...": ${count} 次`),
                recommendation: '检查是否存在不必要的重复操作或循环',
                detectedAt: new Date().toISOString(),
            });
        }
        return {
            analyzerName: this.name,
            strategy: strategy === 'hybrid' ? 'hybrid' : 'rule',
            findings,
            stats: {
                entriesScanned: entries.length,
                findingsCount: findings.length,
                durationMs: Date.now() - startTime,
            },
        };
    }
}
