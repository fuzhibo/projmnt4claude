/**
 * AI 日志工具
 * 记录 AI API 调用成本和延迟指标
 *
 * @deprecated 请迁移到 Logger（src/utils/logger.ts）的 logAICost 方法。
 * Logger 提供结构化 JSON Lines 日志、组件标记、成本聚合等完整能力。
 * 此模块将在未来版本移除。
 */
/**
 * 记录 AI API 调用成本
 * @deprecated 请使用 Logger.logAICost() 替代
 */
export function logAICost(record) {
    const costPerToken = {
        'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000004 },
        default: { input: 0.000003, output: 0.000015 },
    };
    const pricing = costPerToken[record.model] || costPerToken.default;
    const totalCost = record.inputTokens * pricing.input + record.outputTokens * pricing.output;
    // 输出到 stderr，避免干扰 stdout JSON 输出
    if (process.env.PROJMNT4CLAUDE_AI_DEBUG) {
        console.error(`[AI Cost] ${record.operation}: model=${record.model}, tokens=${record.inputTokens}+${record.outputTokens}, cost=$${totalCost.toFixed(6)}, duration=${record.durationMs}ms`);
    }
}
