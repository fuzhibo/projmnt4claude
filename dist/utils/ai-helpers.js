/**
 * AI 增强调用统一封装
 *
 * 将分散在 init-requirement、analyze、plan 等命令中的 try-catch + fallback + 日志模式
 * 统一收敛为 withAIEnhancement<T> 泛型函数。
 */
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
export async function withAIEnhancement(options) {
    if (!options.enabled)
        return options.fallback;
    try {
        return await options.aiCall();
    }
    catch (err) {
        options.logger?.warn(`AI ${options.operationName}失败，使用规则引擎结果`, {
            error: err instanceof Error ? err.message : String(err),
        });
        return options.fallback;
    }
}
