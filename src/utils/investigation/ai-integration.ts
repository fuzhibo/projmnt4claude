import type { AICallOptions, AICallResult } from './types';
import type { AgentResult } from '../headless-agent.js';
import { createLogger } from '../logger.js';

const DEFAULT_TIMEOUT = 300;
const DEFAULT_ALLOWED_TOOLS: string[] = [];

/**
 * LOG-02: 简单哈希函数（用于追踪输出内容）
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * LOG-03: 输出格式检查函数
 */
function checkOutputFormat(output: string): {
  hasMetadata: boolean;
  hasRootCause: boolean;
  hasSolution: boolean;
  hasCheckpoints: boolean;
  hasAllSections: boolean;
} {
  const hasMetadata = output.includes('元数据') || output.includes('Metadata');
  const hasRootCause = output.includes('原因分析') || output.includes('Root Cause');
  const hasSolution = output.includes('解决方案') || output.includes('Solutions');
  const hasCheckpoints = output.includes('检查点') || output.includes('Checkpoint');

  return {
    hasMetadata,
    hasRootCause,
    hasSolution,
    hasCheckpoints,
    hasAllSections: hasMetadata && hasRootCause && hasSolution,
  };
}

// 测试注入点：允许测试通过全局变量注入 mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTestMock(name: string): any {
  return (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__?.[name];
}

/**
 * 统一的 AI 调用入口
 *
 * 内部复用 invokeAgent → runHeadlessClaude 接口。
 */
export async function callAI(options: AICallOptions): Promise<AICallResult> {
  const startTime = Date.now();

  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
    throw new Error(`callAI: invalid timeout ${options.timeout} (must be positive finite number)`);
  }

  // 创建 logger 用于记录调试日志
  const logger = createLogger('investigation-requirement', options.cwd, options.debug);
  const aiLogger = logger.child('ai-integration');

  // 调试日志：输出调用参数
  aiLogger.debug('callAI invoked', {
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    cwd: options.cwd,
    outputFormat: options.outputFormat,
    promptLength: options.prompt.length,
  });

  try {
    // 动态导入避免测试时拉入庞大的依赖树（harness-helpers 等）
    const { invokeAgent } = await import('../headless-agent.js');
    const result: AgentResult = await invokeAgent(options.prompt, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      allowedTools: options.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
      outputFormat: options.outputFormat,
      cwd: options.cwd,
      dangerouslySkipPermissions: true,
      debug: options.debug,
    });

    // 调试日志：输出返回结果（LOG-02/03: Headless 输出日志）
    aiLogger.debug('callAI result', {
      success: result.success,
      durationMs: result.durationMs,
      outputLength: result.output?.length ?? 0,
      // LOG-02: 输出内容预览（前 500 字符）
      outputPreview: result.output ? result.output.substring(0, 500) : null,
      // LOG-02: 输出内容哈希（用于追踪）
      outputHash: result.output ? simpleHash(result.output) : null,
      // LOG-02: 错误信息（如果失败）
      error: result.error,
    });

    // LOG-03: 初步格式验证
    if (result.output && result.output.length > 100) {
      const formatCheck = checkOutputFormat(result.output);
      aiLogger.debug('callAI output format check', formatCheck);

      if (!formatCheck.hasAllSections) {
        aiLogger.warn('Headless output missing expected sections', formatCheck);
      }
    }

    // LOG-03: 空输出警告
    if (result.success && (!result.output || result.output.trim().length === 0)) {
      aiLogger.warn('Headless returned empty output', {
        success: result.success,
        durationMs: result.durationMs,
      });
    }

    // 记录 AI 成本
    if (result.tokensUsed && result.tokensUsed > 0) {
      aiLogger.logAICost({
        field: 'callAI',
        durationMs: result.durationMs,
        inputTokens: 0, // tokensUsed is total, split not available
        outputTokens: result.tokensUsed,
        totalTokens: result.tokensUsed,
      });
    }

    return {
      output: result.output,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
    };
  } catch (err) {
    // LOG-02: 增强异常详情
    aiLogger.error('callAI exception', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startTime,
    });

    return {
      output: '',
      success: false,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 带 JSON 解析的 AI 调用
 *
 * 自动处理 JSON 解析错误，返回解析后的对象。
 */
export async function callAIForJSON<T>(
  options: Omit<AICallOptions, 'outputFormat'>,
  validator?: (data: unknown) => T,
): Promise<T> {
  // 测试注入点
  const testMock = getTestMock('callAIForJSON');
  if (testMock) {
    return testMock(options, validator);
  }

  const result = await callAI({ ...options, outputFormat: 'text' });

  if (!result.success) {
    throw new Error(`AI call failed: ${result.error}`);
  }

  const output = result.output.trim();

  // 提取 JSON 块
  let jsonStr = output;
  const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonStr = output.substring(start, end + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseErr) {
    throw new Error(
      `Failed to parse AI output as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\nOutput: ${output.substring(0, 500)}`,
    );
  }

  if (validator) {
    try {
      return validator(parsed);
    } catch (validationErr) {
      throw new Error(
        `JSON validation failed: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
      );
    }
  }

  return parsed as T;
}
