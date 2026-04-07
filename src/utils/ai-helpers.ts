/**
 * AI 增强调用统一封装
 *
 * 将分散在 init-requirement、analyze、plan 等命令中的 try-catch + fallback + 日志模式
 * 统一收敛为 withAIEnhancement<T> 泛型函数。
 */

import type { Logger } from './logger';

/** withAIEnhancement 选项 */
export interface AIEnhancementOptions<T> {
  /** 是否启用 AI 调用（由 --no-ai / --smart 等标志控制） */
  enabled: boolean;
  /** 要执行的异步 AI 调用 */
  aiCall: () => Promise<T>;
  /** AI 被禁用或失败时返回的回退值 */
  fallback: T;
  /** 操作名称，用于日志记录 */
  operationName: string;
  /** Logger 实例，不提供则失败时静默回退 */
  logger?: Logger;
}

/**
 * 统一 AI 增强调用封装
 *
 * 封装 try-catch、fallback 和日志逻辑，确保所有 AI 增强调用行为一致：
 * - enabled 为 false 时直接返回 fallback
 * - AI 调用成功时返回结果
 * - AI 调用失败时记录 warn 日志并返回 fallback
 *
 * @example
 * ```ts
 * const result = await withAIEnhancement({
 *   enabled: !noAI,
 *   aiCall: () => new AIMetadataAssistant(cwd).enhanceRequirement(desc, { cwd }),
 *   fallback: { aiUsed: false, ... },
 *   operationName: '需求增强',
 *   logger,
 * });
 * if (result.aiUsed) { /* process AI result *\/ }
 * ```
 */
export async function withAIEnhancement<T>(options: AIEnhancementOptions<T>): Promise<T> {
  if (!options.enabled) return options.fallback;

  try {
    return await options.aiCall();
  } catch (err) {
    options.logger?.warn(`AI ${options.operationName}失败，使用规则引擎结果`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return options.fallback;
  }
}
