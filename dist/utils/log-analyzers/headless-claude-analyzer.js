/**
 * HeadlessClaudeAnalyzer - AI 调用日志分析器
 *
 * 检测 headless Claude 调用中的问题：
 * - 输出格式错误（JSON 解析失败、非预期格式）
 * - 调用失败（超时、进程崩溃、exit code 异常）
 * - 重试过多
 * - Token 消耗异常
 */
import {} from '../log-analyzer.js';
export class HeadlessClaudeAnalyzer {
    name = 'headless-claude-analyzer';
    category = 'headless-claude';
    supportedStrategies = ['rule', 'hybrid'];
    async analyze(entries, strategy, _context) {
        const startTime = Date.now();
        const findings = [];
        // 筛选 AI 调用相关日志
        const aiEntries = entries.filter(e => e.component?.includes('headless') ||
            e.component?.includes('claude-code') ||
            e.component?.includes('feedback-constraint') ||
            (e.message && (e.message.includes('Claude Code') ||
                e.message.includes('invoke') ||
                e.message.includes('AI 调用'))));
        // 规则 1: 检测连续调用失败
        const failedInvokes = aiEntries.filter(e => e.level === 'error' &&
            (e.message.includes('失败') || e.message.includes('failed') || e.message.includes('error')));
        if (failedInvokes.length >= 3) {
            findings.push({
                analyzer: this.name,
                severity: 'error',
                category: this.category,
                title: `检测到 ${failedInvokes.length} 次 AI 调用失败`,
                description: '短时间内多次 AI 调用失败可能表示 API 配置错误、网络问题或服务不可用',
                evidence: failedInvokes.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '检查 API key 配置、网络连接，或查看 AI provider 服务状态',
                detectedAt: new Date().toISOString(),
            });
        }
        else if (failedInvokes.length >= 1) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${failedInvokes.length} 次 AI 调用失败`,
                description: '存在少量 AI 调用失败',
                evidence: failedInvokes.map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '关注失败频率，如果持续增加建议排查',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 2: 检测输出格式错误（JSON 解析失败）
        const jsonErrors = aiEntries.filter(e => e.level === 'error' &&
            (e.message.includes('JSON') || e.message.includes('解析失败') || e.message.includes('parse')));
        if (jsonErrors.length >= 2) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${jsonErrors.length} 次输出格式错误`,
                description: 'AI 输出不符合预期 JSON 格式，FeedbackConstraintEngine 需要多次重试',
                evidence: jsonErrors.slice(0, 3).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '考虑调整 prompt 约束或降低输出复杂度',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 3: 检测超时
        const timeouts = aiEntries.filter(e => e.message.includes('超时') || e.message.includes('timeout') || e.message.includes('ETIMEDOUT'));
        if (timeouts.length >= 2) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${timeouts.length} 次 AI 调用超时`,
                description: '频繁超时可能影响流水线执行效率',
                evidence: timeouts.slice(0, 3).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '考虑增加超时时间或优化 prompt 长度',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 4: 检测重试循环
        const retryEntries = aiEntries.filter(e => e.message.includes('重试') || e.message.includes('retry') || e.message.includes('Retrying'));
        if (retryEntries.length >= 5) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${retryEntries.length} 次重试`,
                description: '大量重试可能表明系统性问题或 prompt 需要优化',
                evidence: retryEntries.slice(0, 3).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '检查重试原因，优化 prompt 或调整 maxRetries 配置',
                detectedAt: new Date().toISOString(),
            });
        }
        return {
            analyzerName: this.name,
            strategy: strategy === 'hybrid' ? 'hybrid' : 'rule',
            findings,
            stats: {
                entriesScanned: aiEntries.length,
                findingsCount: findings.length,
                durationMs: Date.now() - startTime,
            },
        };
    }
}
