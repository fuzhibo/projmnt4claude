import type { AICallOptions, AICallResult } from './types';
import { invokeAgent } from '../headless-agent';

const DEFAULT_TIMEOUT = 120;
const DEFAULT_ALLOWED_TOOLS: string[] = [];

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

  try {
    const result = await invokeAgent(options.prompt, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      allowedTools: options.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
      outputFormat: options.outputFormat,
      cwd: options.cwd,
      dangerouslySkipPermissions: true,
    });

    return {
      output: result.output,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
    };
  } catch (err) {
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
  if (jsonBlockMatch) {
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