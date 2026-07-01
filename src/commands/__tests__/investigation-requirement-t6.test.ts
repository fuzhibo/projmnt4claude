/**
 * T6: 参数传递链集成测试
 *
 * 验证 timeout/debug 参数从 CLI → investigationRequirement() → callAI() 的完整传递链
 * 参考 investigation-requirement-timeout-investigation.md §9.2 T6
 *
 * 注意：此测试使用简化的 mock 策略，直接验证 callAI 的参数传递
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// 直接测试 callAI 的参数传递
import { callAI } from '../../utils/investigation/ai-integration';

// Mock invokeAgent
const mockInvokeAgent = jest.fn();

jest.mock('../../utils/headless-agent', () => ({
  invokeAgent: mockInvokeAgent,
}));

// ============================================================
// T6: 参数传递链测试
// ============================================================

describe('T6: 参数传递链集成测试', () => {
  beforeEach(() => {
    mockInvokeAgent.mockReset();

    // 默认 mock 返回成功结果
    mockInvokeAgent.mockResolvedValue({
      output: 'test output',
      success: true,
      durationMs: 1000,
      provider: 'claude',
      tokensUsed: 100,
      model: 'claude-3',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('T6-a: 默认 timeout=undefined 应使用 callAI 内部默认值 300', async () => {
    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].timeout).toBe(300);
  });

  it('T6-b: 自定义 timeout=600 应正确传递到 invokeAgent', async () => {
    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', timeout: 600 });

    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].timeout).toBe(600);
  });

  it('T6-c: debug=true 应正确传递到 invokeAgent', async () => {
    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', debug: true });

    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].debug).toBe(true);
  });

  it('T6-d: debug=false 应正确传递到 invokeAgent', async () => {
    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', debug: false });

    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].debug).toBe(false);
  });

  it('T6-e: timeout 和 debug 同时传递应正确', async () => {
    await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text', timeout: 600, debug: true });

    expect(mockInvokeAgent).toHaveBeenCalled();
    const callArgs = mockInvokeAgent.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![1].timeout).toBe(600);
    expect(callArgs![1].debug).toBe(true);
  });
});