/**
 * APIErrorAnalyzer - API 错误日志分析器
 *
 * 检测 API 调用中的问题：
 * - 连续失败（429/500 错误）
 * - Token 消耗异常
 * - 权限错误
 * - 网络连接问题
 */
import {} from '../log-analyzer.js';
export class APIErrorAnalyzer {
    name = 'api-error-analyzer';
    category = 'api-error';
    supportedStrategies = ['rule', 'ai', 'hybrid'];
    async analyze(entries, strategy, _context) {
        const startTime = Date.now();
        const findings = [];
        // 筛选 API 错误相关日志
        const apiEntries = entries.filter(e => e.level === 'error' || e.level === 'warn' ||
            (e.message && (e.message.includes('API') ||
                e.message.includes('429') ||
                e.message.includes('500') ||
                e.message.includes('token') ||
                e.message.includes('rate limit') ||
                e.message.includes('permission'))));
        // 规则 1: 检测 429 速率限制
        const rateLimits = apiEntries.filter(e => e.message.includes('429') || e.message.includes('rate limit') || e.message.includes('Rate limit'));
        if (rateLimits.length >= 3) {
            findings.push({
                analyzer: this.name,
                severity: 'error',
                category: this.category,
                title: `检测到 ${rateLimits.length} 次 API 速率限制 (429)`,
                description: '频繁触发速率限制会影响任务执行效率',
                evidence: rateLimits.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '降低并发数、增加重试延迟，或联系 API provider 提升配额',
                detectedAt: new Date().toISOString(),
            });
        }
        else if (rateLimits.length >= 1) {
            findings.push({
                analyzer: this.name,
                severity: 'info',
                category: this.category,
                title: `检测到 ${rateLimits.length} 次 API 速率限制`,
                description: '少量速率限制属于正常情况',
                evidence: rateLimits.map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '无需处理，持续关注频率即可',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 2: 检测 500 服务端错误
        const serverErrors = apiEntries.filter(e => e.message.includes('500') || e.message.includes('502') || e.message.includes('503'));
        if (serverErrors.length >= 2) {
            findings.push({
                analyzer: this.name,
                severity: 'warning',
                category: this.category,
                title: `检测到 ${serverErrors.length} 次 API 服务端错误`,
                description: '服务端错误可能表示 API provider 存在稳定性问题',
                evidence: serverErrors.slice(0, 3).map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '配置适当的重试策略，关注 API provider 状态页面',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 3: 检测权限错误
        const authErrors = apiEntries.filter(e => e.message.includes('permission') || e.message.includes('auth') ||
            e.message.includes('401') || e.message.includes('403'));
        if (authErrors.length >= 1) {
            findings.push({
                analyzer: this.name,
                severity: 'critical',
                category: this.category,
                title: `检测到 ${authErrors.length} 次权限/认证错误`,
                description: '权限错误会阻止所有 API 调用，需要立即修复',
                evidence: authErrors.map(e => `[${e.timestamp}] ${e.message}`),
                recommendation: '检查 API key 是否有效、权限配置是否正确',
                detectedAt: new Date().toISOString(),
            });
        }
        // 规则 4: 检测 Token 消耗异常
        const tokenEntries = entries.filter(e => e.data && typeof e.data === 'object' && ('totalTokens' in e.data || 'tokensUsed' in e.data));
        if (tokenEntries.length > 0) {
            const tokenValues = tokenEntries
                .map(e => {
                const d = e.data;
                return Number(d.totalTokens || d.tokensUsed || 0);
            })
                .filter(v => v > 0);
            if (tokenValues.length > 0) {
                const avgTokens = tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length;
                const maxTokens = Math.max(...tokenValues);
                // 单次调用超过 50k token 可能表示 prompt 过长
                if (maxTokens > 50000) {
                    findings.push({
                        analyzer: this.name,
                        severity: 'warning',
                        category: this.category,
                        title: `检测到单次调用消耗 ${maxTokens} tokens`,
                        description: `平均消耗: ${Math.round(avgTokens)} tokens，最大消耗: ${maxTokens} tokens`,
                        evidence: [`平均: ${Math.round(avgTokens)} tokens`, `最大: ${maxTokens} tokens`, `调用次数: ${tokenValues.length}`],
                        recommendation: '优化 prompt 长度，避免在单次调用中传递过多上下文',
                        detectedAt: new Date().toISOString(),
                    });
                }
            }
        }
        return {
            analyzerName: this.name,
            strategy: strategy === 'ai' ? 'ai' : 'rule',
            findings,
            stats: {
                entriesScanned: apiEntries.length,
                findingsCount: findings.length,
                durationMs: Date.now() - startTime,
            },
        };
    }
}
