import * as fs from 'fs';
import * as path from 'path';
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
 *
 * SOL-002: 文件优先流程
 * 当 options.outputFile 指定时：
 * 1. 在 prompt 中嵌入文件路径指令，引导 AI 通过 Write 工具写入文件
 * 2. 确保 allowedTools 包含 'Write'
 * 3. 调用后检查文件存在性，读取文件内容返回
 * 4. 返回结果中设置 outputPath
 */
export async function callAI(options: AICallOptions): Promise<AICallResult> {
  const startTime = Date.now();

  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
    throw new Error(`callAI: invalid timeout ${options.timeout} (must be positive finite number)`);
  }

  // 创建 logger 用于记录调试日志
  const logger = createLogger('investigation-requirement', options.cwd, options.debug);
  const aiLogger = logger.child('ai-integration');

  // SOL-002: 文件优先流程 — 在 prompt 中嵌入文件路径指令
  let prompt = options.prompt;
  const outputFile = options.outputFile;
  let effectiveAllowedTools = options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;

  if (outputFile) {
    const filePathInstruction = `\n\n【重要】请将你的完整输出写入以下文件：${outputFile}\n`;
    prompt = prompt + filePathInstruction;

    // 确保 allowedTools 包含 'Write'
    if (!effectiveAllowedTools.includes('Write')) {
      effectiveAllowedTools = [...effectiveAllowedTools, 'Write'];
    }

    aiLogger.debug('SOL-002: 文件优先流程已启用', {
      outputFile,
      allowedTools: effectiveAllowedTools,
    });
  }

  // 调试日志：输出调用参数（SOL-003: 增强）
  aiLogger.info('callAI started', {
    promptPreview: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
    allowedTools: effectiveAllowedTools,
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    outputFormat: options.outputFormat,
    outputFile: outputFile ?? null,
  });

  try {
    // 动态导入避免测试时拉入庞大的依赖树（harness-helpers 等）
    const { invokeAgent } = await import('../headless-agent.js');
    const result: AgentResult = await invokeAgent(prompt, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      allowedTools: effectiveAllowedTools,
      outputFormat: options.outputFormat,
      cwd: options.cwd,
      dangerouslySkipPermissions: true,
      debug: options.debug,
      // SOL-002: 传递 outputFile 到 headless-agent
      outputFile: outputFile,
    });

    // SOL-002: 文件优先流程 — 从文件读取输出
    let finalOutput = result.output;
    let outputPath: string | undefined = undefined;

    if (outputFile && result.success) {
      const absolutePath = path.isAbsolute(outputFile)
        ? outputFile
        : path.join(options.cwd, outputFile);

      aiLogger.debug('SOL-002: 检查输出文件存在性', { absolutePath });

      if (fs.existsSync(absolutePath)) {
        try {
          const fileContent = fs.readFileSync(absolutePath, 'utf-8');
          finalOutput = fileContent;
          outputPath = absolutePath;
          aiLogger.info('SOL-002: 已从文件读取输出', {
            absolutePath,
            contentLength: fileContent.length,
          });
        } catch (readErr) {
          aiLogger.warn('SOL-002: 读取输出文件失败，回退到 stdout', {
            absolutePath,
            error: readErr instanceof Error ? readErr.message : String(readErr),
          });
        }
      } else {
        aiLogger.warn('SOL-002: 输出文件不存在，回退到 stdout', {
          absolutePath,
        });
      }
    }

    // SOL-003: 增强 Headless 输出日志
    aiLogger.info('callAI completed', {
      success: result.success,
      durationMs: result.durationMs,
      outputLength: finalOutput?.length ?? 0,
      outputPath: outputPath ?? null,
      usedFileFlow: !!outputFile,
      outputHash: finalOutput ? simpleHash(finalOutput) : null,
    });

    // LOG-03: 初步格式验证
    if (finalOutput && finalOutput.length > 100) {
      const formatCheck = checkOutputFormat(finalOutput);
      aiLogger.debug('callAI output format check', formatCheck);

      if (!formatCheck.hasAllSections) {
        aiLogger.warn('Headless output missing expected sections', formatCheck);
      }
    }

    // LOG-03: 空输出警告
    if (result.success && (!finalOutput || finalOutput.trim().length === 0)) {
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

    // SOL-003: debug 模式下保存原始输出到文件
    if (options.debug && finalOutput) {
      const debugOutputPath = path.join(options.cwd, 'debug-output.md');
      try {
        fs.writeFileSync(debugOutputPath, finalOutput, 'utf-8');
        aiLogger.info('SOL-003: Raw output saved', { path: debugOutputPath });
      } catch (writeErr) {
        aiLogger.warn('SOL-003: Failed to save debug output', {
          path: debugOutputPath,
          error: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
    }

    return {
      output: finalOutput,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
      // SOL-002: 文件优先流程返回文件路径
      outputPath: outputPath,
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
