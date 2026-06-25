/**
 * hd-assembly-line-feedback.test.ts - 跨阶段反馈传递与清理测试
 *
 * 测试覆盖：
 * - getAllFailuresForTask 跨阶段聚合
 * - buildRetryContextForPhase 反馈传递
 * - cleanupTaskRuntimeData 终态清理
 */

import { describe, test, expect } from '@jest/globals';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { createDefaultRuntimeState } from '../types/harness.js';
import type { HarnessConfig, HarnessRuntimeState } from '../types/harness.js';

function createTestConfig(cwd = '/tmp/test'): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    forceContinue: false,
    jsonOutput: false,
    cwd,
  };
}

function createStateWithFailures(
  taskId: string,
  phaseFailures: Array<{ phase: string; error: string; timestamp: string }>,
): HarnessRuntimeState {
  const config = createTestConfig();
  const state = createDefaultRuntimeState(config);
  state.failureHistory = new Map();

  for (const failure of phaseFailures) {
    const key = `${taskId}:${failure.phase}`;
    const records = state.failureHistory.get(key) || [];
    records.push({
      attempt: records.length + 1,
      timestamp: failure.timestamp,
      phase: failure.phase,
      error: failure.error,
      errorType: 'test_failure',
      insights: `insight from ${failure.phase}`,
    });
    state.failureHistory.set(key, records);
  }

  return state;
}

function makeLine(cwd = '/tmp/test'): AssemblyLine {
  return new AssemblyLine(createTestConfig(cwd));
}

// ============================================================
// getAllFailuresForTask 跨阶段聚合测试
// ============================================================

describe('getAllFailuresForTask — cross-phase aggregation', () => {
  const line = makeLine();

  test('returns empty array when failureHistory is empty', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    const result = (line as any)['getAllFailuresForTask']('T001', state);
    expect(result).toEqual([]);
  });

  test('returns empty array when failureHistory is undefined', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    state.failureHistory = undefined;
    const result = (line as any)['getAllFailuresForTask']('T001', state);
    expect(result).toEqual([]);
  });

  test('aggregates failures from multiple phases for one task', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'dev failed: lint error', timestamp: '2026-06-25T10:00:00Z' },
      { phase: 'code_review', error: 'cr failed: review rejected', timestamp: '2026-06-25T10:05:00Z' },
    ]);

    const result = (line as any)['getAllFailuresForTask']('T001', state);

    expect(result).toHaveLength(2);
    expect(result[0].phase).toBe('development');
    expect(result[0].error).toContain('lint error');
    expect(result[1].phase).toBe('code_review');
    expect(result[1].error).toContain('review rejected');
  });

  test('only includes failures for the specified taskId', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'T001 dev error', timestamp: '2026-06-25T10:00:00Z' },
    ]);
    state.failureHistory!.set('T002:development', [
      {
        attempt: 1,
        timestamp: '2026-06-25T10:01:00Z',
        phase: 'development',
        error: 'T002 dev error',
        errorType: 'test_failure',
        insights: 'other task',
      },
    ]);

    const result = (line as any)['getAllFailuresForTask']('T001', state);

    expect(result).toHaveLength(1);
    expect(result[0].error).toContain('T001');
  });

  test('sorts failures ascending by timestamp (oldest first)', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'code_review', error: 'third', timestamp: '2026-06-25T11:00:00Z' },
      { phase: 'development', error: 'first', timestamp: '2026-06-25T09:00:00Z' },
      { phase: 'qa', error: 'fourth', timestamp: '2026-06-25T12:00:00Z' },
      { phase: 'development', error: 'second', timestamp: '2026-06-25T10:00:00Z' },
    ]);

    const result = (line as any)['getAllFailuresForTask']('T001', state);

    expect(result).toHaveLength(4);
    expect(result[0].timestamp).toBe('2026-06-25T09:00:00Z');
    expect(result[1].timestamp).toBe('2026-06-25T10:00:00Z');
    expect(result[2].timestamp).toBe('2026-06-25T11:00:00Z');
    expect(result[3].timestamp).toBe('2026-06-25T12:00:00Z');
  });
});

// ============================================================
// buildRetryContextForPhase 反馈传递测试
// ============================================================

describe('buildRetryContextForPhase — cross-phase feedback', () => {
  const line = makeLine();

  test('retry context includes failures from all phases', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'dev lint error', timestamp: '2026-06-25T09:00:00Z' },
      { phase: 'code_review', error: 'type safety violation', timestamp: '2026-06-25T09:05:00Z' },
      { phase: 'qa', error: 'test coverage insufficient', timestamp: '2026-06-25T09:10:00Z' },
    ]);

    const result = (line as any)['buildRetryContextForPhase'](
      'T001', 'development', state,
    );

    expect(result).toBeDefined();
    expect(result.failureHistory).toHaveLength(3);
    expect(result.previousErrors).toContain('dev lint error');
    expect(result.previousErrors).toContain('type safety violation');
    expect(result.previousErrors).toContain('test coverage insufficient');
  });

  test('gateFailureDetails comes from most recent failure with gateInfo', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'first error', timestamp: '2026-06-25T09:00:00Z' },
      { phase: 'code_review', error: 'second error - most recent', timestamp: '2026-06-25T09:05:00Z' },
    ]);
    // 为最新失败添加 gateInfo
    const lastKey = 'T001:code_review';
    const lastRecords = state.failureHistory!.get(lastKey)!;
    lastRecords[0].gateInfo = {
      ruleId: 'R-CR-001',
      ruleName: 'Code Review',
      targetPhase: 'development',
      failureDetails: 'type safety violation found',
      suggestions: ['fix types', 'add tests'],
      severity: 'ERROR',
    };

    const result = (line as any)['buildRetryContextForPhase'](
      'T001', 'development', state,
    );

    expect(result.gateFailureDetails).toBeDefined();
    expect(result.gateFailureDetails!.ruleId).toBe('R-CR-001');
    expect(result.gateFailureDetails!.ruleName).toBe('Code Review');
  });

  test('returns undefined when no failures exist', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);

    const result = (line as any)['buildRetryContextForPhase'](
      'T001', 'development', state,
    );

    expect(result).toBeUndefined();
  });
});

// ============================================================
// cleanupTaskRuntimeData 终态清理测试
// ============================================================

describe('cleanupTaskRuntimeData — terminal state cleanup', () => {
  const line = makeLine();

  test('removes failureHistory entries for the task', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'dev error', timestamp: '2026-06-25T09:00:00Z' },
      { phase: 'code_review', error: 'cr error', timestamp: '2026-06-25T09:05:00Z' },
    ]);

    (line as any)['cleanupTaskRuntimeData']('T001', state);

    const prefix = 'T001:';
    const remaining = Array.from(state.failureHistory!.keys()).filter(k => k.startsWith(prefix));
    expect(remaining).toHaveLength(0);
  });

  test('does not remove failureHistory entries for other tasks', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'T001 error', timestamp: '2026-06-25T09:00:00Z' },
    ]);
    state.failureHistory!.set('T002:development', [
      {
        attempt: 1,
        timestamp: '2026-06-25T09:01:00Z',
        phase: 'development',
        error: 'T002 error',
        errorType: 'test_failure',
        insights: 'T002 insight',
      },
    ]);

    (line as any)['cleanupTaskRuntimeData']('T001', state);

    expect(state.failureHistory!.has('T002:development')).toBe(true);
    expect(state.failureHistory!.size).toBe(1);
  });

  test('no-op when failureHistory is empty', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);

    expect(() => {
      (line as any)['cleanupTaskRuntimeData']('T001', state);
    }).not.toThrow();
  });

  test('cleans up taskRetryContexts for the task', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    // 预先设置 taskRetryContexts
    const rtCtx = {
      previousFailureReason: 'test error',
      previousPhase: 'code_review' as const,
      attemptNumber: 2,
      maxRetries: 3,
    };
    (line as any).taskRetryContexts.set('T001', rtCtx);
    expect((line as any).taskRetryContexts.has('T001')).toBe(true);

    (line as any)['cleanupTaskRuntimeData']('T001', state);

    expect((line as any).taskRetryContexts.has('T001')).toBe(false);
  });

  test('cleans up taskFailureReasons for the task', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    state.taskFailureReasons = new Map();
    state.taskFailureReasons.set('T001', {
      taskId: 'T001',
      failedAt: 'qa',
      phase: 'qa',
      reason: 'test failed',
      timestamp: '2026-06-25T09:00:00Z',
      attemptNumber: 1,
    });
    state.taskFailureReasons.set('T002', {
      taskId: 'T002',
      failedAt: 'development',
      phase: 'development',
      reason: 'other error',
      timestamp: '2026-06-25T09:01:00Z',
      attemptNumber: 1,
    });

    (line as any)['cleanupTaskRuntimeData']('T001', state);

    expect(state.taskFailureReasons.has('T001')).toBe(false);
    expect(state.taskFailureReasons.has('T002')).toBe(true);
  });

  test('idempotent: calling cleanup twice does not throw', () => {
    const state = createStateWithFailures('T001', [
      { phase: 'development', error: 'dev error', timestamp: '2026-06-25T09:00:00Z' },
    ]);

    (line as any)['cleanupTaskRuntimeData']('T001', state);
    expect(() => {
      (line as any)['cleanupTaskRuntimeData']('T001', state);
    }).not.toThrow();
  });
});
