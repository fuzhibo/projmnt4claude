/**
 * checkpoint-executor.ts 单元测试
 *
 * 测试检查点验证执行器
 */

import { executeCheckpointVerification, updateCheckpointResult, checkExpected } from '../utils/checkpoint-executor.js';
import type { CheckpointMetadata } from '../types/task.js';

// Mock SafeCommandExecutor
jest.mock('../utils/safe-command-executor.js', () => ({
  SafeCommandExecutor: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'success',
      stderr: '',
      duration: 100,
      timedOut: false,
      success: true,
    }),
  })),
}));

describe('executeCheckpointVerification', () => {
  it('应执行 commands 并返回结果', async () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-001',
      description: '测试检查点',
      status: 'pending',
      category: 'qa_verification',
      verification: {
        method: 'automated',
        commands: ['echo test'],
        expected: 'PASS',
      },
      requiresHuman: false,
      requiredRole: 'qa_tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = await executeCheckpointVerification(checkpoint);

    expect(result.passed).toBe(true);
    expect(result.commandResults).toHaveLength(1);
    expect(result.commandResults?.[0]?.command).toBe('echo test');
    expect(result.commandResults?.[0]?.passed).toBe(true);
  });

  it('应记录 steps 为待验证项', async () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-002',
      description: '人工验证检查点',
      status: 'pending',
      category: 'qa_verification',
      verification: {
        method: 'automated',
        steps: ['手动验证 UI', '检查日志'],
      },
      requiresHuman: true,
      requiredRole: 'qa_tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = await executeCheckpointVerification(checkpoint);

    expect(result.pendingSteps).toEqual(['手动验证 UI', '检查日志']);
    expect(result.result).toContain('待人工验证');
  });

  it('应处理命令失败', async () => {
    // Override mock for this test
    const { SafeCommandExecutor } = jest.requireMock('../utils/safe-command-executor.js');
    SafeCommandExecutor.mockImplementationOnce(() => ({
      execute: jest.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        duration: 50,
        timedOut: false,
        success: false,
      }),
    }));

    const checkpoint: CheckpointMetadata = {
      id: 'CP-003',
      description: '失败检查点',
      status: 'pending',
      category: 'qa_verification',
      verification: {
        method: 'automated',
        commands: ['exit 1'],
      },
      requiresHuman: false,
      requiredRole: 'qa_tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = await executeCheckpointVerification(checkpoint);

    expect(result.passed).toBe(false);
    expect(result.commandResults?.[0]?.passed).toBe(false);
  });
});

describe('checkExpected', () => {
  it('应在 expected 为空时返回 true', () => {
    expect(checkExpected('any result', '')).toBe(true);
    expect(checkExpected('any result', '   ')).toBe(true);
  });

  it('应匹配包含的关键词', () => {
    expect(checkExpected('success output', 'success')).toBe(true);
    expect(checkExpected('error occurred', 'error')).toBe(true);
  });

  it('应匹配逗号分隔的多个关键词', () => {
    expect(checkExpected('build success, tests pass', 'success, pass')).toBe(true);
    expect(checkExpected('build success', 'success, fail')).toBe(false);
  });

  it('应处理否定匹配', () => {
    expect(checkExpected('all good', 'no error')).toBe(true);
    expect(checkExpected('error found', 'no error')).toBe(false);
    expect(checkExpected('成功完成', '无错误')).toBe(true);
    expect(checkExpected('发现错误', '无错误')).toBe(false);
  });
});

describe('updateCheckpointResult', () => {
  it('应更新检查点的 result 字段', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-001',
      description: '测试',
      status: 'pending',
      category: 'qa_verification',
      verification: { method: 'automated' },
      requiresHuman: false,
      requiredRole: 'qa_tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const execResult = {
      result: 'echo test: PASS (exit=0)',
      passed: true,
      executedAt: '2026-01-01T01:00:00Z',
    };

    const updated = updateCheckpointResult(checkpoint, execResult);

    expect(updated.verification?.result).toBe('echo test: PASS (exit=0)');
    expect(updated.status).toBe('completed');
    expect(updated.verification?.verifiedAt).toBe('2026-01-01T01:00:00Z');
  });

  it('应设置失败状态', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-001',
      description: '测试',
      status: 'pending',
      category: 'qa_verification',
      verification: { method: 'automated' },
      requiresHuman: false,
      requiredRole: 'qa_tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const execResult = {
      result: 'exit 1: FAIL (exit=1)',
      passed: false,
      executedAt: '2026-01-01T01:00:00Z',
    };

    const updated = updateCheckpointResult(checkpoint, execResult);

    expect(updated.status).toBe('failed');
  });
});