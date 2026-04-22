import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBatchAwareQueue,
  saveRuntimeState,
  loadRuntimeState,
} from '../commands/harness.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { HarnessConfig, HarnessRuntimeState } from '../types/harness.js';
import { createDefaultRuntimeState } from '../types/harness.js';

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd,
    batchGitCommit: false,
  };
}

function setupProjectDir(tempDir: string): string {
  const projDir = path.join(tempDir, '.projmnt4claude');
  fs.mkdirSync(projDir, { recursive: true });
  return projDir;
}

function stateFilePath(tempDir: string): string {
  return path.join(tempDir, '.projmnt4claude', 'harness-state.json');
}

// ============== buildBatchAwareQueue ==============

describe('buildBatchAwareQueue', () => {
  test('returns empty batch info when batches is undefined', () => {
    const result = buildBatchAwareQueue(['T1', 'T2', 'T3']);
    expect(result.taskQueue).toEqual(['T1', 'T2', 'T3']);
    expect(result.batchBoundaries).toEqual([]);
    expect(result.batchLabels).toEqual([]);
    expect(result.batchParallelizable).toEqual([]);
  });

  test('returns empty batch info when batches is empty array', () => {
    const result = buildBatchAwareQueue(['T1', 'T2'], []);
    expect(result.batchBoundaries).toEqual([]);
    expect(result.batchLabels).toEqual([]);
    expect(result.batchParallelizable).toEqual([]);
  });

  test('builds single batch with multiple tasks', () => {
    const result = buildBatchAwareQueue(['T1', 'T2', 'T3'], [['T1', 'T2', 'T3']]);
    expect(result.batchBoundaries).toEqual([0]);
    expect(result.batchLabels).toEqual(['批次 1']);
    expect(result.batchParallelizable).toEqual([true]);
  });

  test('builds single batch with single task (not parallelizable)', () => {
    const result = buildBatchAwareQueue(['T1'], [['T1']]);
    expect(result.batchBoundaries).toEqual([0]);
    expect(result.batchLabels).toEqual(['批次 1']);
    expect(result.batchParallelizable).toEqual([false]);
  });

  test('builds multiple batches with correct offset boundaries', () => {
    const result = buildBatchAwareQueue(
      ['T1', 'T2', 'T3', 'T4', 'T5'],
      [['T1', 'T2'], ['T3', 'T4'], ['T5']]
    );
    expect(result.batchBoundaries).toEqual([0, 2, 4]);
    expect(result.batchLabels).toEqual(['批次 1', '批次 2', '批次 3']);
    expect(result.batchParallelizable).toEqual([true, true, false]);
  });

  test('preserves original taskQueue reference', () => {
    const queue = ['A', 'B', 'C'];
    const result = buildBatchAwareQueue(queue, [['A', 'B', 'C']]);
    expect(result.taskQueue).toBe(queue);
  });

  test('labels batches sequentially starting from 1', () => {
    const result = buildBatchAwareQueue(
      ['T1', 'T2', 'T3', 'T4'],
      [['T1'], ['T2'], ['T3'], ['T4']]
    );
    expect(result.batchLabels).toEqual(['批次 1', '批次 2', '批次 3', '批次 4']);
  });

  test('handles batches of varying sizes', () => {
    const result = buildBatchAwareQueue(
      ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
      [['T1', 'T2', 'T3', 'T4', 'T5'], ['T6']]
    );
    expect(result.batchBoundaries).toEqual([0, 5]);
    expect(result.batchParallelizable).toEqual([true, false]);
  });
});

// ============== saveRuntimeState ==============

describe('saveRuntimeState', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    setupProjectDir(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  test('creates harness-state.json file', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    saveRuntimeState(state, env.tempDir);

    expect(fs.existsSync(stateFilePath(env.tempDir))).toBe(true);
  });

  test('writes valid JSON with pretty formatting', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    saveRuntimeState(state, env.tempDir);

    const content = fs.readFileSync(stateFilePath(env.tempDir), 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    expect(content).toContain('  "');
  });

  test('includes stateFormatVersion 2', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.stateFormatVersion).toBe(2);
  });

  test('preserves scalar fields', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.state = 'running';
    state.currentIndex = 5;
    state.taskQueue = ['T1', 'T2'];
    state.passedTasks = ['T1'];
    state.failedTasks = ['T2'];
    state.retryingTasks = ['T3'];

    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.state).toBe('running');
    expect(data.currentIndex).toBe(5);
    expect(data.taskQueue).toEqual(['T1', 'T2']);
    expect(data.passedTasks).toEqual(['T1']);
    expect(data.failedTasks).toEqual(['T2']);
    expect(data.retryingTasks).toEqual(['T3']);
  });

  test('serializes Maps to plain objects', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.retryCounter.set('TASK-1', 2);
    state.resumeFrom.set('TASK-2', 'development');
    state.reevaluateCounter.set('TASK-3', 1);
    state.phaseRetryCounters.set('TASK-1:development', 3);

    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.retryCounter).toEqual({ 'TASK-1': 2 });
    expect(data.resumeFrom).toEqual({ 'TASK-2': 'development' });
    expect(data.reevaluateCounter).toEqual({ 'TASK-3': 1 });
    expect(data.phaseRetryCounters).toEqual({ 'TASK-1:development': 3 });
  });

  test('serializes empty Maps as empty objects', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);

    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.retryCounter).toEqual({});
    expect(data.resumeFrom).toEqual({});
    expect(data.reevaluateCounter).toEqual({});
    expect(data.phaseRetryCounters).toEqual({});
  });

  test('serializes taskPhaseCheckpoints to plain objects', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.taskPhaseCheckpoints.set('TASK-1', {
      completedPhase: 'development',
      completedAt: '2026-04-11T10:00:00.000Z',
    });
    state.taskPhaseCheckpoints.set('TASK-2', {
      completedPhase: 'qa',
      completedAt: '2026-04-11T11:30:00.000Z',
    });

    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.taskPhaseCheckpoints).toEqual({
      'TASK-1': { completedPhase: 'development', completedAt: '2026-04-11T10:00:00.000Z' },
      'TASK-2': { completedPhase: 'qa', completedAt: '2026-04-11T11:30:00.000Z' },
    });
  });

  test('preserves batch metadata', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.batchBoundaries = [0, 3];
    state.batchLabels = ['批次 1', '批次 2'];
    state.batchParallelizable = [true, false];

    saveRuntimeState(state, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.batchBoundaries).toEqual([0, 3]);
    expect(data.batchLabels).toEqual(['批次 1', '批次 2']);
    expect(data.batchParallelizable).toEqual([true, false]);
  });

  test('overwrites existing state file', () => {
    const config = createTestConfig(env.tempDir);
    const state1 = createDefaultRuntimeState(config);
    state1.currentIndex = 3;
    saveRuntimeState(state1, env.tempDir);

    const state2 = createDefaultRuntimeState(config);
    state2.currentIndex = 7;
    saveRuntimeState(state2, env.tempDir);

    const data = JSON.parse(fs.readFileSync(stateFilePath(env.tempDir), 'utf-8'));
    expect(data.currentIndex).toBe(7);
  });
});

// ============== loadRuntimeState ==============

describe('loadRuntimeState', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    setupProjectDir(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns null when state file does not exist', () => {
    const result = loadRuntimeState(env.tempDir);
    expect(result).toBeNull();
  });

  test('loads valid state and restores Map fields', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.retryCounter.set('TASK-1', 2);
    state.resumeFrom.set('TASK-2', 'qa');
    state.reevaluateCounter.set('TASK-3', 1);
    state.phaseRetryCounters.set('TASK-1:development', 3);
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.retryCounter).toBeInstanceOf(Map);
    expect(loaded!.retryCounter.get('TASK-1')).toBe(2);
    expect(loaded!.resumeFrom).toBeInstanceOf(Map);
    expect(loaded!.resumeFrom.get('TASK-2')).toBe('qa');
    expect(loaded!.reevaluateCounter).toBeInstanceOf(Map);
    expect(loaded!.reevaluateCounter.get('TASK-3')).toBe(1);
    expect(loaded!.phaseRetryCounters).toBeInstanceOf(Map);
    expect(loaded!.phaseRetryCounters.get('TASK-1:development')).toBe(3);
  });

  test('preserves scalar fields through round-trip', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.state = 'running';
    state.currentIndex = 4;
    state.taskQueue = ['T1', 'T2', 'T3'];
    state.passedTasks = ['T1'];
    state.failedTasks = ['T2'];
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded!.state).toBe('running');
    expect(loaded!.currentIndex).toBe(4);
    expect(loaded!.taskQueue).toEqual(['T1', 'T2', 'T3']);
    expect(loaded!.passedTasks).toEqual(['T1']);
    expect(loaded!.failedTasks).toEqual(['T2']);
  });

  test('preserves batch metadata through round-trip', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.batchBoundaries = [0, 3, 7];
    state.batchLabels = ['批次 1', '批次 2', '批次 3'];
    state.batchParallelizable = [true, true, false];
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded!.batchBoundaries).toEqual([0, 3, 7]);
    expect(loaded!.batchLabels).toEqual(['批次 1', '批次 2', '批次 3']);
    expect(loaded!.batchParallelizable).toEqual([true, true, false]);
  });

  test('handles empty Map fields', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.retryCounter.size).toBe(0);
    expect(loaded!.resumeFrom.size).toBe(0);
    expect(loaded!.reevaluateCounter.size).toBe(0);
    expect(loaded!.phaseRetryCounters.size).toBe(0);
  });

  test('handles state with missing optional Map fields in JSON', () => {
    // Write a minimal valid state file without Map data
    const config = createTestConfig(env.tempDir);
    const statePath = stateFilePath(env.tempDir);
    fs.writeFileSync(statePath, JSON.stringify({
      stateFormatVersion: 1,
      state: 'idle',
      config,
      taskQueue: [],
      currentIndex: 0,
      records: [],
      startTime: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      // Missing retryCounter, resumeFrom, etc.
    }, null, 2), 'utf-8');

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.retryCounter).toBeInstanceOf(Map);
    expect(loaded!.retryCounter.size).toBe(0);
    expect(loaded!.resumeFrom).toBeInstanceOf(Map);
    expect(loaded!.resumeFrom.size).toBe(0);
  });

  test('round-trips config correctly', () => {
    const config = createTestConfig(env.tempDir);
    config.maxRetries = 5;
    config.timeout = 120;
    config.parallel = 3;
    const state = createDefaultRuntimeState(config);
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded!.config.maxRetries).toBe(5);
    expect(loaded!.config.timeout).toBe(120);
    expect(loaded!.config.parallel).toBe(3);
    expect(loaded!.config.cwd).toBe(env.tempDir);
  });

  test('restores taskPhaseCheckpoints as Map', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    state.taskPhaseCheckpoints.set('TASK-1', {
      completedPhase: 'development',
      completedAt: '2026-04-11T10:00:00.000Z',
    });
    state.taskPhaseCheckpoints.set('TASK-2', {
      completedPhase: 'evaluation',
      completedAt: '2026-04-11T12:00:00.000Z',
    });
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded!.taskPhaseCheckpoints).toBeInstanceOf(Map);
    expect(loaded!.taskPhaseCheckpoints.size).toBe(2);
    expect(loaded!.taskPhaseCheckpoints.get('TASK-1')).toEqual({
      completedPhase: 'development',
      completedAt: '2026-04-11T10:00:00.000Z',
    });
    expect(loaded!.taskPhaseCheckpoints.get('TASK-2')).toEqual({
      completedPhase: 'evaluation',
      completedAt: '2026-04-11T12:00:00.000Z',
    });
  });

  test('adds empty taskPhaseCheckpoints when loading v1 state', () => {
    const config = createTestConfig(env.tempDir);
    const statePath = stateFilePath(env.tempDir);
    fs.writeFileSync(statePath, JSON.stringify({
      stateFormatVersion: 1,
      state: 'idle',
      config,
      taskQueue: ['T1'],
      currentIndex: 0,
      records: [],
      startTime: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      retryCounter: {},
      resumeFrom: {},
      reevaluateCounter: {},
      phaseRetryCounters: {},
    }, null, 2), 'utf-8');

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.taskPhaseCheckpoints).toBeInstanceOf(Map);
    expect(loaded!.taskPhaseCheckpoints.size).toBe(0);
  });

  test('round-trips taskPhaseCheckpoints through save/load', () => {
    const config = createTestConfig(env.tempDir);
    const state = createDefaultRuntimeState(config);
    const phases: Array<'development' | 'code_review' | 'qa' | 'evaluation'> = ['development', 'code_review', 'qa', 'evaluation'];
    phases.forEach((phase, i) => {
      state.taskPhaseCheckpoints.set(`TASK-${i + 1}`, {
        completedPhase: phase,
        completedAt: new Date(Date.now() + i * 60000).toISOString(),
      });
    });
    saveRuntimeState(state, env.tempDir);

    const loaded = loadRuntimeState(env.tempDir);
    expect(loaded!.taskPhaseCheckpoints.size).toBe(4);
    phases.forEach((phase, i) => {
      const cp = loaded!.taskPhaseCheckpoints.get(`TASK-${i + 1}`);
      expect(cp).not.toBeUndefined();
      expect(cp!.completedPhase).toBe(phase);
    });
  });
});
