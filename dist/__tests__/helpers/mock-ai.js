/**
 * AI 调用 Mock 工具
 * 用于测试中模拟 AI 响应和成本计算
 */
/**
 * 模拟 AI 响应
 */
export function mockAIResponse(data, options = {}) {
    const delayMs = options.delayMs ?? 10;
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (options.shouldError) {
                reject(new Error(options.errorMessage || 'AI request failed'));
            }
            else {
                resolve(data);
            }
        }, delayMs);
    });
}
/**
 * 模拟流式 AI 响应
 */
export async function* mockAIStreamResponse(chunks, options = {}) {
    const delayMs = options.delayMs ?? 5;
    if (options.shouldError) {
        throw new Error(options.errorMessage || 'Stream error');
    }
    for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        yield chunk;
    }
}
/**
 * 创建模拟的 AI 成本摘要
 */
export function createMockAICostSummary(overrides) {
    const inputTokens = overrides?.inputTokens ?? 100;
    const outputTokens = overrides?.outputTokens ?? 50;
    return {
        field: overrides?.field ?? 'test-field',
        durationMs: overrides?.durationMs ?? 1000,
        inputTokens,
        outputTokens,
        totalTokens: overrides?.totalTokens ?? (inputTokens + outputTokens),
    };
}
/**
 * AI 客户端 Mock 类
 */
export class MockAIClient {
    responseQueue = [];
    callCount = 0;
    /**
     * 设置下一个响应
     */
    queueResponse(data) {
        this.responseQueue.push({ type: 'success', data });
    }
    /**
     * 设置下一个错误
     */
    queueError(error) {
        this.responseQueue.push({ type: 'error', data: null, error });
    }
    /**
     * 模拟发送消息
     */
    async sendMessage(prompt) {
        this.callCount++;
        const response = this.responseQueue.shift();
        if (!response) {
            return { content: 'Default mock response' };
        }
        if (response.type === 'error') {
            throw response.error;
        }
        return response.data;
    }
    /**
     * 获取调用次数
     */
    getCallCount() {
        return this.callCount;
    }
    /**
     * 重置状态
     */
    reset() {
        this.responseQueue = [];
        this.callCount = 0;
    }
}
/**
 * AI 验证响应模板
 */
export const AI_VERDICT_TEMPLATES = {
    pass: (reason) => ({
        verdict: 'PASS',
        reason: reason || '验证通过',
        details: '所有检查点已完成',
    }),
    nopass: (reason) => ({
        verdict: 'NOPASS',
        reason: reason || '验证未通过',
        issues: ['发现问题1', '发现问题2'],
    }),
    needsReview: () => ({
        verdict: 'NEEDS_REVIEW',
        reason: '需要人工审查',
        checkpoints: ['CP-001', 'CP-002'],
    }),
};
/**
 * 模拟 AI 验证响应
 */
export function mockAIVerdict(verdict, reason) {
    const template = AI_VERDICT_TEMPLATES[verdict.toLowerCase()];
    return template ? template(reason) : AI_VERDICT_TEMPLATES.pass(reason);
}
/**
 * 模拟 AI 检查点生成响应
 */
export function mockAICheckpointResponse(checkpointCount = 5) {
    const checkpoints = [];
    for (let i = 1; i <= checkpointCount; i++) {
        checkpoints.push(`- [ ] 检查点 ${i}: 描述文本`);
    }
    return `# 建议检查点\n\n${checkpoints.join('\n')}`;
}
/**
 * 模拟 AI 代码审查响应
 */
export function mockAICodeReviewResponse(issues = 0) {
    if (issues === 0) {
        return '代码审查通过，无问题发现。';
    }
    const issueList = [];
    for (let i = 1; i <= issues; i++) {
        issueList.push(`${i}. 问题描述 ${i}`);
    }
    return `代码审查发现以下问题:\n${issueList.join('\n')}`;
}
/**
 * 延迟模拟
 */
export function mockDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
