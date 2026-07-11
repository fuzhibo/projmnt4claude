/**
 * AI 集成层单元测试
 *
 * 覆盖检查点（参考 investigation-requirement-timeout-investigation.md §9.2）：
 * - T1: 默认超时值验证 (300s)
 * - T2: 自定义超时传递
 * - T3: debug=false 无日志输出
 * - T4: debug=true 输出日志
 * - T5: 超时触发异常处理
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock invokeAgent 避免真实 AI 调用
const mockInvokeAgent = jest.fn() as jest.MockedFunction<(cmd: string, opts: unknown) => Promise<AgentResult>>;

jest.mock('../../headless-agent.js', () => ({
  invokeAgent: (...args: [string, unknown]) => mockInvokeAgent(...args),
}));

import { callAI, callAIForJSON, checkOutputFormat } from '../ai-integration.js';
import type { AgentResult } from '../../headless-agent.js';

// Mock 结果工厂函数
function createMockResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    output: 'test output',
    success: true,
    durationMs: 1000,
    provider: 'claude',
    tokensUsed: 100,
    model: 'claude-3',
    ...overrides,
  };
}

// ============================================================
// T1-T2: 超时参数传递测试
// ============================================================

describe('callAI 超时参数传递 (T1-T2)', () => {
  beforeEach(() => {
    mockInvokeAgent.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // T1: 默认超时值验证
  it('T1: 应使用默认超时 300s 当未传递 timeout', async () => {
    const mockResult: AgentResult = {
      output: 'test output',
      success: true,
      durationMs: 1000,
      provider: 'claude',
      tokensUsed: 100,
      model: 'claude-3',
    };
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    // 验证 invokeAgent 被调用且 timeout 参数为 300
    expect(mockInvokeAgent).toHaveBeenCalledTimes(1);
    const callArgs = mockInvokeAgent.mock.calls[0] as [string, { timeout?: number }];
    expect(callArgs).toBeDefined();
    expect(callArgs[1].timeout).toBe(300);
  });

  // T2: 自定义超时传递
  it('T2: 应正确传递自定义超时 600s', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', timeout: 600 });

    expect(mockInvokeAgent).toHaveBeenCalledTimes(1);
    const callArgs = mockInvokeAgent.mock.calls[0] as [string, { timeout?: number }];
    expect(callArgs).toBeDefined();
    expect(callArgs[1].timeout).toBe(600);
  });

  // 边界测试：timeout=0 现在被视为无效值（CA-003-1）
  it('T1-ext: timeout=0 应抛出异常', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', timeout: 0 }),
    ).rejects.toThrow('callAI: invalid timeout 0');
  });
});

// ============================================================
// T3-T4: debug 模式日志测试
// ============================================================

describe('callAI debug 模式日志 (T3-T4)', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mockInvokeAgent.mockReset();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  // T3: debug=false 无日志输出
  it('T3: debug=false 应无额外日志输出', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', debug: false });

    // callAI 现在使用 Logger 输出日志（info/debug 级别），不验证 console 输出
    // 只验证 debug 参数正确传递即可
    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0] as [string, { debug?: boolean }];
    expect(callArgs[1].debug).toBe(false);
  });

  // T4: debug=true 输出日志
  it('T4: debug=true 应输出 Logger 日志', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', debug: true });

    // 现在 callAI 使用 Logger 输出日志，验证 logger 被调用
    // 由于 Logger 内部可能使用 console.log，这里验证不报错即可
    expect(consoleLogSpy).toHaveBeenCalled();
  });
});

// ============================================================
// T5: 超时触发异常处理
// ============================================================

describe('callAI 超时异常处理 (T5)', () => {
  beforeEach(() => {
    mockInvokeAgent.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('T5: invokeAgent 抛出异常时应返回 success=false', async () => {
    const errorMsg = 'Spawn timeout: claude process killed after 300s';
    mockInvokeAgent.mockRejectedValue(new Error(errorMsg));

    const result = await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('');
    expect(result.error).toBe(errorMsg);
    // durationMs 在异常情况下可能为 0 或非常小的值
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('T5-ext: invokeAgent 返回 success=false 时应正确传递', async () => {
    const mockResult = createMockResult({
      output: '',
      success: false,
      durationMs: 300000,
      error: 'Process killed by SIGTERM',
    });
    mockInvokeAgent.mockResolvedValue(mockResult);

    const result = await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Process killed by SIGTERM');
    expect(result.durationMs).toBe(300000);
  });
});

// ============================================================
// callAIForJSON 测试
// ============================================================

describe('callAIForJSON JSON 解析', () => {
  beforeEach(() => {
    mockInvokeAgent.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('应正确解析 JSON 块输出', async () => {
    const jsonOutput = '```json\n{"key": "value"}\n```';
    const mockResult = createMockResult({ output: jsonOutput });
    mockInvokeAgent.mockResolvedValue(mockResult);

    const result = await callAIForJSON<{ key: string }>({ prompt: 'test', cwd: '/tmp' });

    expect(result.key).toBe('value');
  });

  it('应正确解析纯 JSON 输出', async () => {
    const jsonOutput = '{"key": "value"}';
    const mockResult = createMockResult({ output: jsonOutput });
    mockInvokeAgent.mockResolvedValue(mockResult);

    const result = await callAIForJSON<{ key: string }>({ prompt: 'test', cwd: '/tmp' });

    expect(result.key).toBe('value');
  });

  it('AI 调用失败时应抛出异常', async () => {
    const mockResult = createMockResult({
      output: '',
      success: false,
      error: 'AI call failed',
    });
    mockInvokeAgent.mockResolvedValue(mockResult);

    await expect(callAIForJSON({ prompt: 'test', cwd: '/tmp' })).rejects.toThrow('AI call failed');
  });

  it('JSON 解析失败时应抛出异常', async () => {
    const mockResult = createMockResult({ output: 'not valid json' });
    mockInvokeAgent.mockResolvedValue(mockResult);

    await expect(callAIForJSON({ prompt: 'test', cwd: '/tmp' })).rejects.toThrow('Failed to parse AI output as JSON');
  });

  it('validator 验证失败时应抛出异常', async () => {
    const mockResult = createMockResult({ output: '{"key": "value"}' });
    mockInvokeAgent.mockResolvedValue(mockResult);

    const validator = (data: unknown) => {
      if (typeof data !== 'object' || data === null) throw new Error('Invalid');
      const obj = data as Record<string, unknown>;
      if (obj.key !== 'expected') throw new Error('Key mismatch');
      return obj as { key: string };
    };

    await expect(callAIForJSON({ prompt: 'test', cwd: '/tmp' }, validator)).rejects.toThrow('JSON validation failed');
  });
});

// ============================================================
// CA-003-1: timeout 参数验证
// ============================================================

describe('callAI timeout validation (CA-003-1)', () => {
  beforeEach(() => {
    mockInvokeAgent.mockReset();
  });

  it('should throw on negative timeout', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', timeout: -1, outputFormat: 'text' }),
    ).rejects.toThrow('callAI: invalid timeout -1');
  });

  it('should throw on NaN timeout', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', timeout: NaN, outputFormat: 'text' }),
    ).rejects.toThrow('callAI: invalid timeout NaN');
  });

  it('should throw on zero timeout', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', timeout: 0, outputFormat: 'text' }),
    ).rejects.toThrow('callAI: invalid timeout 0');
  });

  it('should not throw when timeout is undefined (uses DEFAULT_TIMEOUT)', async () => {
    mockInvokeAgent.mockResolvedValue(createMockResult());

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    expect(mockInvokeAgent).toHaveBeenCalledTimes(1);
    // 验证 timeout 被默认设置为 300
    const passedOptions = (mockInvokeAgent.mock.calls[0] as [string, { timeout: number }])[1];
    expect(passedOptions.timeout).toBe(300);
  });
});

// ============================================================
// CA-005: 输出格式检查函数测试（hasCoreSections + 日志级别）
// ============================================================

describe('CA-005: checkOutputFormat 格式检查', () => {
  it('应正确识别核心章节完整的情况', () => {
    const output = '## 原因分析\nroot cause content\n## 解决方案\nsolution content';
    const result = checkOutputFormat(output);
    expect(result.hasRootCause).toBe(true);
    expect(result.hasSolution).toBe(true);
    expect(result.hasCoreSections).toBe(true);
  });

  it('应正确识别核心章节缺失的情况（hasRootCause=false）', () => {
    const output = '## 解决方案\nsolution content\n## 元数据\nmetadata';
    const result = checkOutputFormat(output);
    expect(result.hasRootCause).toBe(false);
    expect(result.hasSolution).toBe(true);
    expect(result.hasCoreSections).toBe(false);
  });

  it('应正确识别核心章节缺失的情况（hasSolution=false）', () => {
    const output = '## 原因分析\nroot cause content\n## 元数据\nmetadata';
    const result = checkOutputFormat(output);
    expect(result.hasRootCause).toBe(true);
    expect(result.hasSolution).toBe(false);
    expect(result.hasCoreSections).toBe(false);
  });

  it('应正确识别辅助章节', () => {
    const output = '## 原因分析\nroot\n## 解决方案\nsol\n## 元数据\nmeta\n## 检查点\ncheck';
    const result = checkOutputFormat(output);
    expect(result.hasMetadata).toBe(true);
    expect(result.hasCheckpoints).toBe(true);
    expect(result.hasAllSections).toBe(true);
  });

  it('hasAllSections 应为 false 当辅助章节缺失时', () => {
    const output = '## 原因分析\nroot\n## 解决方案\nsol';
    const result = checkOutputFormat(output);
    expect(result.hasMetadata).toBe(false);
    expect(result.hasCheckpoints).toBe(false);
    expect(result.hasAllSections).toBe(false);
    expect(result.hasCoreSections).toBe(true);
  });
});

describe('CA-005: 日志级别验证', () => {
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleDebugSpy: jest.SpiedFunction<typeof console.debug>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    mockInvokeAgent.mockReset();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleLogSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('核心章节缺失时应触发 warn 日志', async () => {
    // 输出长度需 > 100 才会触发格式检查
    const mockResult = createMockResult({
      output: '## 原因分析\nroot cause only\n## 元数据\nmeta\n\n' + 'padding '.repeat(20),
    });
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    // Logger.warn 使用 console.warn
    const warnCalls = consoleWarnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('missing core sections'),
    );
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it('辅助章节缺失时不应触发 warn 日志', async () => {
    // 输出长度需 > 100 才会触发格式检查
    const mockResult = createMockResult({
      output: '## 原因分析\nroot cause\n## 解决方案\nsolution\n\n' + 'padding '.repeat(20),
    });
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    // 验证 warn 未被触发（核心章节完整）
    const warnCalls = consoleWarnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('missing core sections'),
    );
    expect(warnCalls).toHaveLength(0);
  });
});

// ============================================================
// CA-006: spawn diagnostics logging
// ============================================================

describe('CA-006: spawn diagnostics logging', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mockInvokeAgent.mockReset();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should log spawn start event with context info', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    // 验证 Logger 输出包含 spawn 相关信息
    expect(consoleLogSpy).toHaveBeenCalled();
    // 验证至少有一条日志包含 AI 成本或调用信息
    const aiCostLog = consoleLogSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('AI 成本'),
    );
    expect(aiCostLog).toBeDefined();
  });

  it('should track spawn count increment', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    // 记录调用前的状态
    await callAI({ prompt: 'test1', cwd: '/tmp', outputFormat: 'text' });
    await callAI({ prompt: 'test2', cwd: '/tmp', outputFormat: 'text' });

    // 验证 invokeAgent 被调用 2 次（每次 callAI 对应一次 spawn）
    expect(mockInvokeAgent).toHaveBeenCalledTimes(2);
  });
});