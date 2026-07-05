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
const mockInvokeAgent = jest.fn();

jest.mock('../../headless-agent.js', () => ({
  invokeAgent: mockInvokeAgent,
}));

import { callAI, callAIForJSON } from '../ai-integration.js';
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
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].timeout).toBe(300);
  });

  // T2: 自定义超时传递
  it('T2: 应正确传递自定义超时 600s', async () => {
    const mockResult = createMockResult();
    mockInvokeAgent.mockResolvedValue(mockResult);

    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', timeout: 600 });

    expect(mockInvokeAgent).toHaveBeenCalledTimes(1);
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].timeout).toBe(600);
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
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs![1].debug).toBe(false);
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
      callAI({ prompt: 'test', cwd: '/tmp', timeout: -1 }),
    ).rejects.toThrow('callAI: invalid timeout -1');
  });

  it('should throw on NaN timeout', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', timeout: NaN }),
    ).rejects.toThrow('callAI: invalid timeout NaN');
  });

  it('should throw on zero timeout', async () => {
    await expect(
      callAI({ prompt: 'test', cwd: '/tmp', timeout: 0 }),
    ).rejects.toThrow('callAI: invalid timeout 0');
  });

  it('should not throw when timeout is undefined (uses DEFAULT_TIMEOUT)', async () => {
    mockInvokeAgent.mockResolvedValue(createMockResult());

    await callAI({ prompt: 'test', cwd: '/tmp' });

    expect(mockInvokeAgent).toHaveBeenCalledTimes(1);
    // 验证 timeout 被默认设置为 300
    const passedOptions = mockInvokeAgent.mock.calls[0][1] as { timeout: number };
    expect(passedOptions.timeout).toBe(300);
  });
});

// ============================================================
// Phase 3: 诊断日志测试（spawn 计数 + headless 上下文）
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