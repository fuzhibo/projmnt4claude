import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { RetryHandler } from '../utils/harness-retry.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { HarnessConfig, ReviewVerdict } from '../types/harness.js';

function createTestConfig(cwd: string, maxRetries = 3): HarnessConfig {
  return {
    maxRetries,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd,
    apiRetryAttempts: 0,
    apiRetryDelay: 10,
    batchGitCommit: false,
  };
}

function createReviewVerdict(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return {
    taskId: 'TASK-test',
    result: 'NOPASS',
    reason: 'test reason',
    failedCriteria: [],
    failedCheckpoints: [],
    reviewedAt: '2026-04-10T00:00:00.000Z',
    reviewedBy: 'harness-evaluator',
    ...overrides,
  };
}

// ============== shouldRetry ==============

describe('RetryHandler: shouldRetry', () => {
  let env: IsolatedTestEnv;
  let handler: RetryHandler;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    handler = new RetryHandler(createTestConfig(env.tempDir, 3));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns true when task has 0 attempts (not in counter)', async () => {
    const counter = new Map<string, number>();
    const result = await handler.shouldRetry('TASK-1', counter);
    expect(result).toBe(true);
  });

  test('returns true when attempts < maxRetries', async () => {
    const counter = new Map<string, number>([['TASK-1', 1]]);
    const result = await handler.shouldRetry('TASK-1', counter);
    expect(result).toBe(true);
  });

  test('returns false when attempts >= maxRetries', async () => {
    const counter = new Map<string, number>([['TASK-1', 3]]);
    const result = await handler.shouldRetry('TASK-1', counter);
    expect(result).toBe(false);
  });

  test('returns false when attempts exceed maxRetries', async () => {
    const counter = new Map<string, number>([['TASK-1', 5]]);
    const result = await handler.shouldRetry('TASK-1', counter);
    expect(result).toBe(false);
  });

  test('handles multiple tasks independently', async () => {
    const counter = new Map<string, number>([['TASK-A', 3], ['TASK-B', 1]]);
    const resultA = await handler.shouldRetry('TASK-A', counter);
    const resultB = await handler.shouldRetry('TASK-B', counter);
    expect(resultA).toBe(false);
    expect(resultB).toBe(true);
  });
});

// ============== formatRetryStatus ==============

describe('RetryHandler: formatRetryStatus', () => {
  let env: IsolatedTestEnv;
  let handler: RetryHandler;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    handler = new RetryHandler(createTestConfig(env.tempDir, 3));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('shows remaining retries when attempts < maxRetries', () => {
    const counter = new Map<string, number>([['TASK-1', 1]]);
    const status = handler.formatRetryStatus('TASK-1', counter);
    expect(status).toBe('剩余重试机会: 2/3');
  });

  test('shows full remaining retries for task not in counter', () => {
    const counter = new Map<string, number>();
    const status = handler.formatRetryStatus('TASK-1', counter);
    expect(status).toBe('剩余重试机会: 3/3');
  });

  test('shows exhausted retries when attempts >= maxRetries', () => {
    const counter = new Map<string, number>([['TASK-1', 3]]);
    const status = handler.formatRetryStatus('TASK-1', counter);
    expect(status).toBe('已用完所有重试机会 (3/3)');
  });

  test('shows exhausted retries when attempts exceed maxRetries', () => {
    const counter = new Map<string, number>([['TASK-1', 5]]);
    const status = handler.formatRetryStatus('TASK-1', counter);
    expect(status).toBe('已用完所有重试机会 (5/3)');
  });

  test('shows 1 remaining when attempts = maxRetries - 1', () => {
    const counter = new Map<string, number>([['TASK-1', 2]]);
    const status = handler.formatRetryStatus('TASK-1', counter);
    expect(status).toBe('剩余重试机会: 1/3');
  });
});

// ============== getNextRetryDelay ==============

describe('RetryHandler: getNextRetryDelay', () => {
  let env: IsolatedTestEnv;
  let handler: RetryHandler;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    handler = new RetryHandler(createTestConfig(env.tempDir));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns baseDelay for attempt 0', () => {
    expect(handler.getNextRetryDelay(0)).toBe(2000);
  });

  test('doubles delay for attempt 1', () => {
    expect(handler.getNextRetryDelay(1)).toBe(4000);
  });

  test('continues exponential growth for attempt 2', () => {
    expect(handler.getNextRetryDelay(2)).toBe(8000);
  });

  test('caps at maxDelay (30000ms)', () => {
    expect(handler.getNextRetryDelay(10)).toBe(30000);
  });
});

// ============== getRetryRecommendation ==============

describe('RetryHandler: getRetryRecommendation', () => {
  let env: IsolatedTestEnv;
  let handler: RetryHandler;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    handler = new RetryHandler(createTestConfig(env.tempDir));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('recommends retry for transient API errors (429)', () => {
    const verdict = createReviewVerdict({
      reason: 'API Error: 429 rate limit exceeded at 2026-04-10 12:00:00',
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.shouldRetry).toBe(true);
    expect(rec.reason).toContain('临时性错误');
  });

  test('recommends retry for server errors (500)', () => {
    const verdict = createReviewVerdict({
      reason: 'API Error: 500 internal server error',
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.shouldRetry).toBe(true);
  });

  test('recommends retry for fixable issues (failed criteria)', () => {
    const verdict = createReviewVerdict({
      reason: 'some logic issue',
      failedCriteria: ['All tests must pass'],
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.shouldRetry).toBe(true);
    expect(rec.reason).toContain('可修复');
  });

  test('recommends retry for fixable issues (failed checkpoints)', () => {
    const verdict = createReviewVerdict({
      reason: 'checkpoint not met',
      failedCheckpoints: ['CP-1'],
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.shouldRetry).toBe(true);
    expect(rec.suggestions.length).toBeGreaterThan(0);
  });

  test('does not recommend retry for non-retryable errors', () => {
    const verdict = createReviewVerdict({
      reason: 'implementation fundamentally wrong',
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.shouldRetry).toBe(false);
    expect(rec.reason).toContain('无法通过重试解决');
    expect(rec.suggestions).toContain('需要人工介入分析问题');
  });

  test('includes suggestion about acceptance criteria when criteria fail', () => {
    const verdict = createReviewVerdict({
      reason: 'criteria not met',
      failedCriteria: ['AC-1'],
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.suggestions).toContain('检查未满足的验收标准，确保完全理解需求');
  });

  test('includes suggestion about checkpoints when checkpoints fail', () => {
    const verdict = createReviewVerdict({
      reason: 'checkpoints not met',
      failedCheckpoints: ['CP-1'],
    });
    const rec = handler.getRetryRecommendation(verdict);
    expect(rec.suggestions).toContain('验证检查点配置是否正确');
  });
});
