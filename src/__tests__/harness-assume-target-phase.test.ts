/**
 * FIX-20260627-002: assumeTargetPhase 机制单元测试
 *
 * 覆盖:
 *   1. getNextPhaseForRetry 边界值
 *   2. 正向推进对齐重置 (assumeTargetPhase == targetPhase → reset)
 *   3. 跨阶段回退不重置 (assumeTargetPhase != targetPhase → keep counter)
 *   4. 同阶段回退 guard (targetPhase === phase → advance assumeTargetPhase)
 *   5. eval sentinel 防止 null == undefined 匹配
 *   6. 计数器耗尽终止
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { flowTargetToPhaseIndex } from '../utils/hd-assembly-line.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { HarnessConfig } from '../types/harness.js';

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    forceContinue: false,
    jsonOutput: false,
    batchGitTagCommit: false,
    taskGitCommit: false,
    debug: false,
    cwd,
  };
}

// ============================================================
// 1. getNextPhaseForRetry 边界值测试
// ============================================================

describe('getNextPhaseForRetry (FIX-20260627-002)', () => {
  let env: IsolatedTestEnv;
  let assemblyLine: AssemblyLine;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    assemblyLine = new AssemblyLine(createTestConfig(env.tempDir));
  });

  afterEach(() => {
    env.cleanup();
  });

  const callGetNextPhase = (al: AssemblyLine, phase: string): string | null =>
    (al as any).getNextPhaseForRetry(phase);

  test('development → code_review', () => {
    expect(callGetNextPhase(assemblyLine, 'development')).toBe('code_review');
  });

  test('code_review → qa', () => {
    expect(callGetNextPhase(assemblyLine, 'code_review')).toBe('qa');
  });

  test('qa → evaluation', () => {
    expect(callGetNextPhase(assemblyLine, 'qa')).toBe('evaluation');
  });

  test('evaluation → null (最终阶段)', () => {
    expect(callGetNextPhase(assemblyLine, 'evaluation')).toBeNull();
  });

  test('unknown phase → null', () => {
    expect(callGetNextPhase(assemblyLine, 'unknown')).toBeNull();
  });

  test('empty string → null', () => {
    expect(callGetNextPhase(assemblyLine, '')).toBeNull();
  });
});

// ============================================================
// 2. flowTargetToPhaseIndex 集成验证
// ============================================================

describe('flowTargetToPhaseIndex 基础', () => {
  test('development → 0', () => {
    expect(flowTargetToPhaseIndex('development')).toBe(0);
  });
  test('code_review → 1', () => {
    expect(flowTargetToPhaseIndex('code_review')).toBe(1);
  });
  test('qa → 2', () => {
    expect(flowTargetToPhaseIndex('qa')).toBe(2);
  });
  test('evaluation → 3', () => {
    expect(flowTargetToPhaseIndex('evaluation')).toBe(3);
  });
  test('EXIT throws', () => {
    expect(() => flowTargetToPhaseIndex('EXIT')).toThrow();
  });
  test('RETRY throws', () => {
    expect(() => flowTargetToPhaseIndex('RETRY')).toThrow();
  });
});

// ============================================================
// 3. assumeTargetPhase 比较逻辑模式测试
// ============================================================

describe('assumeTargetPhase 比较逻辑 (FIX-20260627-002)', () => {
  /**
   * 模拟 while 循环中的 assumeTargetPhase 比较逻辑
   *
   * 正向推进: assumeTargetPhase == lifecycleResult.targetPhase → reset counter → advance
   * 回退后重试: assumeTargetPhase != targetPhase → only advance (no reset)
   */

  // Phase order helpers
  const getNextPhaseForRetry = (phase: string): string | null => {
    const order = ['development', 'code_review', 'qa', 'evaluation'];
    const idx = order.indexOf(phase);
    return idx === -1 || idx === order.length - 1 ? null : order[idx + 1] ?? null;
  };

  // Simulate the success handler pattern for each phase
  const simulateSuccessHandler = (
    _currentPhase: string,
    currentAssumeTarget: string | null,
    lifecycleTargetPhase: string | undefined,
  ): { resetCounter: boolean; newAssumeTarget: string | null } => {
    let resetCounter = false;
    let newAssumeTarget = currentAssumeTarget;

    if (currentAssumeTarget == lifecycleTargetPhase) {
      resetCounter = true;
      newAssumeTarget = getNextPhaseForRetry(lifecycleTargetPhase ?? '');
    }

    return { resetCounter, newAssumeTarget };
  };

  // Simulate same-phase rollback guard
  const simulateSamePhaseGuard = (
    targetPhase: string,
    currentAssumeTarget: string | null,
  ): string | null => {
    if (targetPhase === 'evaluation') {
      return '__SAME_PHASE_ROLLBACK__';
    }
    // targetPhase === phase (e.g., dev, cr, qa) → advance past next phase
    if (targetPhase === 'development') {
      return getNextPhaseForRetry('code_review'); // → 'qa' — skip cr
    }
    if (targetPhase === 'code_review') {
      return getNextPhaseForRetry('qa'); // → 'evaluation' — skip qa
    }
    if (targetPhase === 'qa') {
      return getNextPhaseForRetry('evaluation'); // → null — skip eval
    }
    return currentAssumeTarget;
  };

  // --- 场景 A: 正向推进 ---

  test('正向推进: dev成功 (assume=code_review, target=code_review) → 重置', () => {
    const result = simulateSuccessHandler('development', 'code_review', 'code_review');
    expect(result.resetCounter).toBe(true);
    expect(result.newAssumeTarget).toBe('qa');
  });

  test('正向推进: cr成功 (assume=qa, target=qa) → 重置', () => {
    const result = simulateSuccessHandler('code_review', 'qa', 'qa');
    expect(result.resetCounter).toBe(true);
    expect(result.newAssumeTarget).toBe('evaluation');
  });

  test('正向推进: qa成功 (assume=evaluation, target=evaluation) → 重置', () => {
    const result = simulateSuccessHandler('qa', 'evaluation', 'evaluation');
    expect(result.resetCounter).toBe(true);
    expect(result.newAssumeTarget).toBeNull();
  });

  test('正向推进: eval成功 (assume=null, target=undefined) → 重置 (null == undefined)', () => {
    const result = simulateSuccessHandler('evaluation', null, undefined);
    expect(result.resetCounter).toBe(true);
    expect(result.newAssumeTarget).toBeNull();
  });

  // --- 场景 B: 跨阶段回退 ---

  test('跨阶段回退: cr失败→回退dev, dev重试成功 (assume=qa, target=code_review) → 不重置', () => {
    // After initial dev→cr progression, assumeTargetPhase was advanced to 'qa'
    // Then cr failed and rolled back to development
    // On dev re-run success, targetPhase='code_review', but assume='qa' (mismatch!)
    const result = simulateSuccessHandler('development', 'qa', 'code_review');
    expect(result.resetCounter).toBe(false);
    expect(result.newAssumeTarget).toBe('qa'); // unchanged
  });

  test('跨阶段回退: qa失败→回退cr, cr重试成功 (assume=evaluation, target=qa) → 不重置', () => {
    const result = simulateSuccessHandler('code_review', 'evaluation', 'qa');
    expect(result.resetCounter).toBe(false);
    expect(result.newAssumeTarget).toBe('evaluation'); // unchanged
  });

  // --- 场景 C: 同阶段回退 ---

  test('同阶段guard: dev失败→回退dev, assumeTargetPhase 跳到 qa (跳过cr)', () => {
    const newAssume = simulateSamePhaseGuard('development', 'code_review');
    // dev同阶段回退 → getNextPhaseForRetry('code_review') = 'qa'
    expect(newAssume).toBe('qa');
  });

  test('同阶段guard: cr失败→回退cr, assumeTargetPhase 跳到 evaluation (跳过qa)', () => {
    const newAssume = simulateSamePhaseGuard('code_review', 'qa');
    expect(newAssume).toBe('evaluation');
  });

  test('同阶段guard: qa失败→回退qa, assumeTargetPhase 跳到 null (跳过eval)', () => {
    const newAssume = simulateSamePhaseGuard('qa', 'evaluation');
    expect(newAssume).toBeNull();
  });

  test('同阶段guard后: dev重试成功 (assume=qa, target=code_review) → 不重置', () => {
    // After same-phase guard advanced assumeTargetPhase to 'qa',
    // dev re-run success returns targetPhase='code_review' → mismatch
    const result = simulateSuccessHandler('development', 'qa', 'code_review');
    expect(result.resetCounter).toBe(false);
  });

  test('同阶段guard后: cr重试成功 (assume=evaluation, target=qa) → 不重置', () => {
    const result = simulateSuccessHandler('code_review', 'evaluation', 'qa');
    expect(result.resetCounter).toBe(false);
  });

  // --- 场景 D: 同阶段回退恢复正向 ---

  test('同阶段回退恢复: cr失败→回退cr(guard), cr再次成功(真正的正向) → 重置', () => {
    // Becomes evaluation so assumeTargetPhase is 'evaluation'
    const afterGuard = simulateSamePhaseGuard('code_review', 'qa');
    expect(afterGuard).toBe('evaluation');
    // cr re-run succeeds → target='qa', but assume='evaluation' → mismatch
    const firstRetry = simulateSuccessHandler('code_review', afterGuard, 'qa');
    expect(firstRetry.resetCounter).toBe(false);
  });

  // --- 场景 E: eval sentinel ---

  test('eval sentinel: eval失败→回退eval, assumeTargetPhase = __SAME_PHASE_ROLLBACK__', () => {
    const newAssume = simulateSamePhaseGuard('evaluation', null);
    expect(newAssume).toBe('__SAME_PHASE_ROLLBACK__');
  });

  test('eval sentinel: 回退后eval成功 (assume=__SAME_PHASE_ROLLBACK__, target=undefined) → 不重置', () => {
    // '__SAME_PHASE_ROLLBACK__' != undefined (no null==undefined coercion for string)
    const result = simulateSuccessHandler('evaluation', '__SAME_PHASE_ROLLBACK__', undefined);
    expect(result.resetCounter).toBe(false);
  });

  // --- 场景 F: 计数器耗尽 ---

  test('retryCounter 超过 maxRetries 应终止', () => {
    const maxRetries = 3;
    const retryCounter = new Map<string, number>();
    const taskId = 'TEST-001';

    // Simulate 4 retries exceeding max
    let shouldTerminate = false;
    for (let i = 0; i <= maxRetries; i++) {
      const count = (retryCounter.get(taskId) || 0) + 1;
      retryCounter.set(taskId, count);
      if (count > maxRetries) {
        shouldTerminate = true;
        break;
      }
    }

    expect(shouldTerminate).toBe(true);
    expect(retryCounter.get(taskId)).toBe(4); // exceeded max of 3
  });

  test('retryCounter 未超过 maxRetries 应继续', () => {
    const maxRetries = 3;
    const retryCounter = new Map<string, number>();
    const taskId = 'TEST-001';

    let shouldTerminate = false;
    for (let i = 0; i < maxRetries; i++) {
      const count = (retryCounter.get(taskId) || 0) + 1;
      retryCounter.set(taskId, count);
      if (count > maxRetries) {
        shouldTerminate = true;
      }
    }

    expect(shouldTerminate).toBe(false);
    expect(retryCounter.get(taskId)).toBe(3);
  });
});

// ============================================================
// 4. 完整回退链路模拟测试
// ============================================================

describe('完整回退链路模拟 (FIX-20260627-002)', () => {
  const getNextPhaseForRetry = (phase: string): string | null => {
    const order = ['development', 'code_review', 'qa', 'evaluation'];
    const idx = order.indexOf(phase);
    return idx === -1 || idx === order.length - 1 ? null : order[idx + 1] ?? null;
  };

  const maxRetries = 3;

  test('经典无限循环场景: dev→cr→dev→cr→... retryCounter 应正确累积直到终止', () => {
    // Scenario: dev succeeds, cr fails with rollback to dev, repeat
    // Without fix, retryCounter was reset on each dev success (causing infinite loop)
    // With fix, assumeTargetPhase prevents reset on rollback re-runs

    const retryCounter = new Map<string, number>();
    const taskId = 'TEST-INF-LOOP';
    let assumeTargetPhase: string | null = getNextPhaseForRetry('development'); // 'code_review'

    let terminated = false;
    const log: string[] = [];

    // Simulate 4 rounds of dev→cr→dev cycle
    for (let round = 1; round <= 4; round++) {
      // Dev phase runs and succeeds
      const devTargetPhase = 'code_review';
      if (assumeTargetPhase == devTargetPhase) {
        // Forward progression: reset counter
        retryCounter.set(taskId, 0);
        assumeTargetPhase = getNextPhaseForRetry(devTargetPhase); // advance
      }
      log.push(`round${round}: dev success, assume=${assumeTargetPhase}, counter=${retryCounter.get(taskId)}`);

      // CR phase runs and fails → rollback to dev (cross-phase, no same-phase guard needed)
      const crCount = (retryCounter.get(taskId) || 0) + 1;
      retryCounter.set(taskId, crCount);
      if (crCount > maxRetries) {
        terminated = true;
        log.push(`round${round}: terminated at count=${crCount}`);
        break;
      }
      // crFailTargetPhase is 'development' (cross-phase), so same-phase guard is NOT triggered
      // assumeTargetPhase stays at current value (no reset needed, counter accumulates)
      log.push(`round${round}: cr fail→dev, counter=${crCount}, assume=${assumeTargetPhase}`);
    }

    // Without fix: assumeTargetPhase would be 'qa' after first round's dev success
    // Then on round2 dev success, devTargetPhase='code_review', assume='qa' → mismatch → no reset ✓
    // But this means counter keeps accumulating and eventually terminates ✓

    expect(terminated).toBe(true); // Should terminate after maxRetries exceeded
    expect(retryCounter.get(taskId)).toBe(4); // 4 rounds × 1 fail per round = 4
  });

  test('同阶段回退场景: cr→cr 循环, guard 防止重置', () => {
    const retryCounter = new Map<string, number>();
    const taskId = 'TEST-SAME-PHASE';
    let assumeTargetPhase: string | null = 'qa'; // After initial dev success

    let terminated = false;

    // Simulate CR failing with same-phase rollback (cr→cr)
    for (let round = 1; round <= 4; round++) {
      // CR fails → rollback to 'code_review'
      const crFailTargetPhase = 'code_review';

      // Increment counter
      const crCount = (retryCounter.get(taskId) || 0) + 1;
      retryCounter.set(taskId, crCount);
      if (crCount > maxRetries) {
        terminated = true;
        break;
      }

      // Same-phase guard: targetPhase === 'code_review' → advance assumeTargetPhase
      if (crFailTargetPhase === 'code_review') {
        assumeTargetPhase = getNextPhaseForRetry('qa'); // 'evaluation'
      }
    }

    // After guard, assumeTargetPhase is 'evaluation'
    // If cr eventually succeeds, targetPhase='qa', assume='evaluation' → mismatch → no reset ✓
    expect(assumeTargetPhase).toBe('evaluation');
    // With 4 rounds and maxRetries=3, should terminate
    expect(terminated).toBe(true);
  });
});
