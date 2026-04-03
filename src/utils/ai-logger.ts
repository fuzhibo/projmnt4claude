/**
 * AI 日志工具
 * 记录 AI API 调用成本和延迟指标
 */

export interface AICostRecord {
  /** 使用的模型 */
  model: string;
  /** 操作名称 */
  operation: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 调用耗时 (ms) */
  durationMs: number;
}

/**
 * 记录 AI API 调用成本
 */
export function logAICost(record: AICostRecord): void {
  const costPerToken = {
    'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000004 },
    default: { input: 0.000003, output: 0.000015 },
  };

  const pricing = costPerToken[record.model as keyof typeof costPerToken] || costPerToken.default;
  const totalCost = record.inputTokens * pricing.input + record.outputTokens * pricing.output;

  // 输出到 stderr，避免干扰 stdout JSON 输出
  if (process.env.PROJMNT4CLAUDE_AI_DEBUG) {
    console.error(`[AI Cost] ${record.operation}: model=${record.model}, tokens=${record.inputTokens}+${record.outputTokens}, cost=$${totalCost.toFixed(6)}, duration=${record.durationMs}ms`);
  }
}
