/**
 * gateCheckAndFix 核心算法单元测试
 *
 * 覆盖检查点 §3.6, §3.7, §3.8：
 * - 3.6 gateCheckAndFix：门禁失败→AI修正→对齐→重试闭环、失败归档清理
 * - 3.7 对齐验证：三层次（原因/方案/检查点）对齐检查、未对齐→注入 issues→重新修正
 * - 3.8 清理：失败任务移至 archive/、meta.json 历史记录
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { gateCheckAndFix } from '../gate-check-fix.js';
import type { GateDependencies, ConversionState } from '../types.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../test-env.js';

let env: IsolatedTestEnv;
let tempDir: string;

beforeEach(async () => {
  env = await createIsolatedTestEnv({ prefix: 'gate-check-test-' });
  tempDir = env.tempDir;
});

afterEach(() => {
  env.cleanup();
  jest.restoreAllMocks();
});

// ============================================================
// §3.6 gateCheckAndFix 核心算法测试
// ============================================================

describe('gateCheckAndFix (§3.6)', () => {
  test('门禁 PASS + 对齐 PASS → 返回 { passed: true }', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'All checks passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir },
      mockDeps,
    );

    expect(result.passed).toBe(true);
    expect(result.taskId).toBe('TASK-001');
    expect(result.attempt).toBe(1);
  });

  test('门禁 FAIL → AI 修正 → 再检查 → PASS (happy path, 1 次修正)', async () => {
    let fixCalled = false;
    let callCount = 0;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => {
        callCount++;
        // First call: fail, after fix: pass
        return {
          taskId: 'TASK-001', passed: callCount > 1, summary: callCount > 1 ? 'Passed' : 'Gate failed',
          ruleResults: callCount > 1 ? [] : [{ ruleId: 'R-001', ruleName: 'Missing checkpoints', ruleType: 'test_env_check', passed: false, severity: 'error', checkResults: [{ checkId: 'C-001', checkName: 'Check', ruleId: 'R-001', passed: false, severity: 'error', message: 'Missing checkpoints', duration: 10, timestamp: new Date().toISOString() }], duration: 100, timestamp: new Date().toISOString() }],
          checks: [],
          passedCount: callCount > 1 ? 1 : 0,
          failedCount: callCount > 1 ? 0 : 1,
          warningCount: 0,
          blockingFailures: callCount > 1 ? 0 : 1,
          duration: 100, timestamp: new Date().toISOString(),
          recommendations: [],
        };
      }),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 70 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => {
        fixCalled = true;
        return { output: '{"checkpoints":[]}', success: true, durationMs: 100 };
      }),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 3 },
      mockDeps,
    );

    expect(fixCalled).toBe(true);
    expect(result.passed).toBe(true);
  });

  test('门禁 PASS + 对齐 FAIL → 进入修正循环', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: false, detail: 'solution mismatch' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Solution does not match root cause'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('达到 maxRetry → 任务移至 archive + conversion-status 标记 failed + 返回 cleanedUp', async () => {
    let archiveCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: false, summary: 'Always fails',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false, score: { totalScore: 40 }, suggestions: ['Fix checkpoints'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'fail' },
          solutionAlignment: { passed: false, detail: 'fail' },
          checkpointAlignment: { passed: false, detail: 'fail' },
        },
        issues: ['All failed'],
      })),
      moveTaskToArchive: jest.fn(() => { archiveCalled = true; }),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
    expect(archiveCalled).toBe(true);
  });

  test('修正后 taskId 不变 (Update 非 Rebuild)', async () => {
    let fixCalled = false;
    const originalTaskId = 'TASK-001';

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: originalTaskId, passed: false, summary: 'Gate failed',
        ruleResults: [{ ruleId: 'R-001', passed: false, message: 'Missing checkpoints' }],
        duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 70 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: originalTaskId, title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => {
        fixCalled = true;
        return { output: `{"id":"${originalTaskId}","title":"Fixed"}`, success: true, durationMs: 100 };
      }),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: originalTaskId, reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 2 },
      mockDeps,
    );

    expect(result.taskId).toBe(originalTaskId);
  });

  test('修正后 writeTaskMeta 被调用，history 条目自动生成', async () => {
    let writeMetaCallCount = 0;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCallCount++; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: false, detail: 'solution mismatch' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Solution mismatch'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    // writeTaskMeta should be called when injecting alignment issues
    expect(writeMetaCallCount).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// §3.7 对齐验证三层次测试
// ============================================================

describe('Alignment Verification Three Levels (§3.7)', () => {
  test('rootCauseAlignment failure → 注入 issues → 重新修正', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'Root cause mismatch: task missing CA-001' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Root cause mismatch: task missing CA-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('solutionAlignment failure → 注入 issues → 重新修正', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: false, detail: 'Solution SOL-001 not linked to CA-001' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Solution SOL-001 not linked to CA-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('checkpointAlignment failure → 注入 issues → 重新修正', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: false, detail: 'Missing checkpoint for SOL-001' },
        },
        issues: ['Missing checkpoint for SOL-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('all three levels pass → aligned: true', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'Task CA matches report CA-001' },
          solutionAlignment: { passed: true, detail: 'Task SOL matches report SOL-001' },
          checkpointAlignment: { passed: true, detail: 'All checkpoints present' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir },
      mockDeps,
    );

    expect(result.passed).toBe(true);
  });
});

// ============================================================
// §3.8 清理测试
// ============================================================

describe('Archive Cleanup (§3.8)', () => {
  test('失败任务移至 archive/ 目录', async () => {
    const taskDir = join(tempDir, '.projmnt4claude', 'tasks', 'TASK-001');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'meta.json'), JSON.stringify({ id: 'TASK-001', status: 'pending' }));

    let archiveDest: string | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: false, summary: 'Always fails',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false, score: { totalScore: 40 }, suggestions: ['Fix checkpoints'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', status: 'pending' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'fail' },
          solutionAlignment: { passed: false, detail: 'fail' },
          checkpointAlignment: { passed: false, detail: 'fail' },
        },
        issues: ['All failed'],
      })),
      moveTaskToArchive: jest.fn((taskId: string, cwd: string) => {
        const src = join(cwd, '.projmnt4claude', 'tasks', taskId);
        const dest = join(cwd, '.projmnt4claude', 'archive', taskId);
        mkdirSync(join(cwd, '.projmnt4claude', 'archive'), { recursive: true });
        mkdirSync(dest, { recursive: true });
        if (existsSync(src)) {
          const meta = join(src, 'meta.json');
          if (existsSync(meta)) {
            writeFileSync(join(dest, 'meta.json'), JSON.stringify({ id: taskId, status: 'failed' }));
            rmSync(src, { recursive: true, force: true });
          }
        }
        archiveDest = dest;
      }),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
    expect(archiveDest).not.toBeNull();
    expect(existsSync(join(tempDir, '.projmnt4claude', 'archive', 'TASK-001', 'meta.json'))).toBe(true);
    expect(existsSync(join(tempDir, '.projmnt4claude', 'tasks', 'TASK-001'))).toBe(false);
  });

  test('conversion-status 记录 lastError + lastAttemptAt', async () => {
    let recordedError: string | null = null;
    let recordedTime: string | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: false, summary: 'Gate failed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false, score: { totalScore: 40 }, suggestions: ['Fix'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'fail' },
          solutionAlignment: { passed: false, detail: 'fail' },
          checkpointAlignment: { passed: false, detail: 'fail' },
        },
        issues: ['All failed'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn((
        _investigationDir: string,
        _reportPath: string,
        _state: ConversionState,
        detail?: { lastError?: string; lastAttemptAt?: string },
      ) => {
        recordedError = detail?.lastError ?? null;
        recordedTime = detail?.lastAttemptAt ?? null;
      }),
    };

    await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(recordedError).not.toBeNull();
    expect(recordedTime).not.toBeNull();
  });

  test('isResumed parameter is passed through to runPreDevGate', async () => {
    let resumedValue: boolean | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async (params) => {
        resumedValue = params.isResumed;
        return {
          taskId: 'TASK-001', passed: true, summary: 'All checks passed',
          ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
        };
      }),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, isResumed: true },
      mockDeps,
    );

    expect(resumedValue).toBe(true);
  });

  test('qualityGate failure below threshold triggers AI fix', async () => {
    let fixCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Pre-dev passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false, score: { totalScore: 40 }, suggestions: ['Improve coverage'],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => {
        fixCalled = true;
        return { output: '{}', success: true, durationMs: 100 };
      }),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 2 },
      mockDeps,
    );

    expect(fixCalled).toBe(true);
  });

  test('all three alignment levels fail simultaneously', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'root cause mismatch' },
          solutionAlignment: { passed: false, detail: 'solution mismatch' },
          checkpointAlignment: { passed: false, detail: 'checkpoint mismatch' },
        },
        issues: ['Root cause mismatch', 'Solution mismatch', 'Checkpoint mismatch'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('dependency check failure triggers failure path', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true, score: { totalScore: 80 }, suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(result.passed).toBe(false);
  });
});
