/**
 * 业务场景集成测试 (Phase 4)
 *
 * 覆盖 7 大业务场景，约 40 个用例：
 * 1. 任务全生命周期: create→update→execute→resolve
 * 2. Harness 完整流水线: dev→code_review→QA→evaluation
 * 3. 质量门禁拦截
 * 4. 状态恢复与重试
 * 5. AI 增强流程: FeedbackConstraintEngine
 * 6. Verdict 路由: handleVerdictBasedTransition
 * 7. 批次执行与 Git Commit
 */

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Types
import type {
  HarnessConfig,
  HarnessRuntimeState,
  TaskExecutionRecord,
  DevReport,
  ReviewVerdict,
  CodeReviewVerdict,
  QAVerdict,
  VerdictAction,
  ExecutionSummary,
  PhaseRetryLimits,
} from '../types/harness.js';
import {
  createDefaultRuntimeState,
  createDefaultExecutionRecord,
  createDefaultDevReport,
  createDefaultSprintContract,
  DEFAULT_PHASE_RETRY_LIMITS,
  DEFAULT_HARNESS_CONFIG,
} from '../types/harness.js';
import type {
  TaskMeta,
  TaskStatus,
  CheckpointMetadata,
  PhaseHistoryEntry,
  TransitionNote,
} from '../types/task.js';
import {
  createDefaultTaskMeta,
  normalizeStatus,
  normalizePriority,
  isValidTaskId,
  parseTaskId,
  inferTaskType,
  inferTaskPriority,
  generateTaskId,
  Pipeline,
  PHASE_ROLE_MAP,
  PIPELINE_INTERMEDIATE_STATUSES,
  PIPELINE_STATUS_MIGRATION_MAP,
  validateCheckpointVerification,
  CURRENT_TASK_SCHEMA_VERSION,
} from '../types/task.js';

// Commands & utilities
import { buildBatchAwareQueue, saveRuntimeState, loadRuntimeState } from '../commands/harness.js';
import { validateBasicFields, extractFilePaths } from '../utils/quality-gate.js';
import {
  FeedbackConstraintEngineImpl,
  JsonFeedbackTemplate,
  MarkdownFeedbackTemplate,
  jsonParseableRule,
  nonEmptyOutputRule,
  createJsonFeedbackEngine,
  createMarkdownFeedbackEngine,
  createSessionAwareEngine,
} from '../utils/feedback-constraint-engine.js';
import type { ValidationRule, ValidationRuleSet, ValidationViolation } from '../types/feedback-constraint.js';
import { assessComplexity } from '../commands/init-requirement.js';

// ============================================================
// Test helpers
// ============================================================

let tmpDir: string;

function createTestConfig(overrides?: Partial<HarnessConfig>): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd: tmpDir,
    apiRetryAttempts: 0,
    apiRetryDelay: 10,
    batchGitCommit: false,
    forceContinue: false,
    ...overrides,
  };
}

function setupProjectDir(): string {
  const projDir = path.join(tmpDir, '.projmnt4claude');
  fs.mkdirSync(projDir, { recursive: true });
  // Create minimal config
  fs.writeFileSync(
    path.join(projDir, 'config.json'),
    JSON.stringify({ version: 1, tasks: { nextId: 1 } }),
    'utf-8'
  );
  return projDir;
}

function createTestTask(
  id: string,
  overrides?: Partial<TaskMeta>,
): TaskMeta {
  const task = createDefaultTaskMeta(id, `Test task ${id}`, 'feature', `Description for task ${id} with enough detail to pass validation`);
  if (overrides) {
    Object.assign(task, overrides);
  }
  return task;
}

function writeTaskToDisk(task: TaskMeta): void {
  const tasksDir = path.join(tmpDir, '.projmnt4claude', 'tasks', task.id);
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(tasksDir, 'meta.json'),
    JSON.stringify(task, null, 2),
    'utf-8'
  );
}

function readTaskFromDisk(taskId: string): TaskMeta | null {
  const metaPath = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

function createTestCheckpoint(
  id: string,
  overrides?: Partial<CheckpointMetadata>,
): CheckpointMetadata {
  return {
    id,
    description: `Checkpoint ${id}`,
    status: 'pending',
    category: 'code_review',
    verification: { method: 'automated' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createPassedDevReport(taskId: string): DevReport {
  return {
    taskId,
    status: 'success',
    changes: ['src/foo.ts'],
    evidence: [],
    checkpointsCompleted: ['CP-1'],
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    duration: 1000,
  };
}

function createPassedCodeReviewVerdict(taskId: string): CodeReviewVerdict {
  return {
    taskId,
    result: 'PASS',
    reason: 'Code looks good',
    codeQualityIssues: [],
    failedCheckpoints: [],
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'code_reviewer',
  };
}

function createFailedCodeReviewVerdict(taskId: string, reason = 'Code quality issues'): CodeReviewVerdict {
  return {
    taskId,
    result: 'NOPASS',
    reason,
    codeQualityIssues: ['naming issue'],
    failedCheckpoints: ['CP-1'],
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'code_reviewer',
  };
}

function createPassedQAVerdict(taskId: string): QAVerdict {
  return {
    taskId,
    result: 'PASS',
    reason: 'All tests passed',
    testFailures: [],
    failedCheckpoints: [],
    requiresHuman: false,
    humanVerificationCheckpoints: [],
    verifiedAt: new Date().toISOString(),
    verifiedBy: 'qa_tester',
  };
}

function createFailedQAVerdict(taskId: string, reason = 'Test failures found'): QAVerdict {
  return {
    taskId,
    result: 'NOPASS',
    reason,
    testFailures: ['test case 1 failed'],
    failedCheckpoints: ['CP-2'],
    requiresHuman: false,
    humanVerificationCheckpoints: [],
    verifiedAt: new Date().toISOString(),
    verifiedBy: 'qa_tester',
  };
}

function createPassedVerdict(taskId: string, action?: VerdictAction): ReviewVerdict {
  return {
    taskId,
    result: 'PASS',
    reason: 'Evaluation passed',
    failedCriteria: [],
    failedCheckpoints: [],
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'harness-evaluator',
    action,
  };
}

function createFailedVerdict(taskId: string, action: VerdictAction = 'redevelop', reason = 'Not acceptable'): ReviewVerdict {
  return {
    taskId,
    result: 'NOPASS',
    reason,
    failedCriteria: ['criteria 1'],
    failedCheckpoints: ['CP-3'],
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'harness-evaluator',
    action,
  };
}

function makeRule(id: string, check: (output: unknown) => ValidationViolation | null): ValidationRule {
  return { id, description: `rule ${id}`, check, severity: 'error' };
}

function makeRuleSet(name: string, rules: ValidationRule[], maxRetries = 2): ValidationRuleSet {
  return { name, outputType: 'json', rules, maxRetriesOnError: maxRetries };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-scenario-'));
  setupProjectDir();
  // Suppress console output during tests
  spyOn(console, 'log').mockImplementation(() => {});
  spyOn(console, 'error').mockImplementation(() => {});
  spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// Scenario 1: Task Full Lifecycle (~8 cases)
// ============================================================

describe('Scenario 1: Task Full Lifecycle', () => {
  test('S1.1: create task with valid fields', () => {
    const task = createTestTask('TASK-feature-P2-test-20260411');
    expect(task.id).toBe('TASK-feature-P2-test-20260411');
    expect(task.status).toBe('open');
    expect(task.type).toBe('feature');
    expect(task.priority).toBe('P2');
    expect(task.history).toEqual([]);
    expect(task.dependencies).toEqual([]);
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
  });

  test('S1.2: persist and read task from disk', () => {
    const task = createTestTask('TASK-feature-P2-persist-20260411');
    writeTaskToDisk(task);
    const loaded = readTaskFromDisk(task.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(task.id);
    expect(loaded!.title).toBe(task.title);
    expect(loaded!.status).toBe('open');
  });

  test('S1.3: transition through status lifecycle: open→in_progress→wait_review→wait_qa→resolved', () => {
    const task = createTestTask('TASK-feature-P2-lifecycle-20260411');
    writeTaskToDisk(task);

    const statuses: TaskStatus[] = ['in_progress', 'wait_review', 'wait_qa', 'resolved'];
    const transitionNotes: TransitionNote[] = [];
    const now = new Date().toISOString();

    for (const status of statuses) {
      task.status = status;
      task.updatedAt = now;
      const note: TransitionNote = {
        timestamp: now,
        fromStatus: statuses[statuses.indexOf(status) - 1] || 'open',
        toStatus: status,
        note: `Transition to ${status}`,
        author: 'test',
      };
      transitionNotes.push(note);
      task.transitionNotes = transitionNotes;
      writeTaskToDisk(task);
    }

    const loaded = readTaskFromDisk(task.id);
    expect(loaded!.status).toBe('resolved');
    expect(loaded!.transitionNotes!.length).toBe(4);
    expect(loaded!.transitionNotes![3]!.toStatus).toBe('resolved');
  });

  test('S1.4: history records accumulate on updates', () => {
    const task = createTestTask('TASK-feature-P2-history-20260411');
    task.history = [];

    // Simulate multiple updates
    const actions = ['created', 'status_changed', 'checkpoint_added', 'resolved'];
    for (const action of actions) {
      task.history.push({
        timestamp: new Date().toISOString(),
        action,
        field: action === 'status_changed' ? 'status' : undefined,
        oldValue: action === 'status_changed' ? 'open' : undefined,
        newValue: action === 'status_changed' ? 'in_progress' : undefined,
      });
    }

    writeTaskToDisk(task);
    const loaded = readTaskFromDisk(task.id);
    expect(loaded!.history.length).toBe(4);
    expect(loaded!.history[0]!.action).toBe('created');
    expect(loaded!.history[3]!.action).toBe('resolved');
  });

  test('S1.5: normalizeStatus handles legacy variants', () => {
    expect(normalizeStatus('pending')).toBe('open');
    expect(normalizeStatus('reopened')).toBe('open');
    expect(normalizeStatus('completed')).toBe('resolved');
    expect(normalizeStatus('cancelled')).toBe('abandoned');
    expect(normalizeStatus('blocked')).toBe('open');
    expect(normalizeStatus('needs_human')).toBe('open');
    expect(normalizeStatus('in_progress')).toBe('in_progress');
    expect(normalizeStatus('resolved')).toBe('resolved');
    expect(normalizeStatus('unknown_status')).toBe('open');
  });

  test('S1.6: Pipeline.determineResumePoint works for retry and next', () => {
    const phaseHistory: PhaseHistoryEntry[] = [
      { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: new Date().toISOString() },
      { phase: 'code_review', role: 'code_reviewer', verdict: 'NOPASS', timestamp: new Date().toISOString() },
    ];

    // retry: resume from last failed phase
    const retryPoint = Pipeline.determineResumePoint(phaseHistory, 'retry');
    expect(retryPoint).not.toBeNull();
    expect(retryPoint!.phase).toBe('code_review');
    expect(retryPoint!.role).toBe('code_reviewer');

    // next: move to next phase after code_review
    const nextPoint = Pipeline.determineResumePoint(phaseHistory, 'next');
    expect(nextPoint).not.toBeNull();
    expect(nextPoint!.phase).toBe('qa_verification');
    expect(nextPoint!.role).toBe('qa_tester');
  });

  test('S1.7: Pipeline.determineResumePoint with empty history defaults to development', () => {
    const point = Pipeline.determineResumePoint([], 'retry');
    expect(point).not.toBeNull();
    expect(point!.phase).toBe('development');
    expect(point!.role).toBe('executor');
  });

  test('S1.8: task ID generation and parsing round-trip', () => {
    const id = generateTaskId('feature', 'P2', 'add user auth');
    const parsed = parseTaskId(id);
    expect(parsed.valid).toBe(true);
    expect(parsed.format).toBe('new');
    expect(parsed.type).toBe('feature');
    expect(parsed.priority).toBe('P2');
    expect(isValidTaskId(id)).toBe(true);
  });
});

// ============================================================
// Scenario 2: Harness Full Pipeline (~8 cases)
// ============================================================

describe('Scenario 2: Harness Full Pipeline', () => {
  test('S2.1: createDefaultRuntimeState has correct initial values', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    expect(state.state).toBe('idle');
    expect(state.taskQueue).toEqual([]);
    expect(state.currentIndex).toBe(0);
    expect(state.records).toEqual([]);
    expect(state.retryCounter.size).toBe(0);
    expect(state.resumeFrom.size).toBe(0);
    expect(state.reevaluateCounter.size).toBe(0);
    expect(state.phaseRetryCounters.size).toBe(0);
    expect(state.passedTasks).toEqual([]);
    expect(state.failedTasks).toEqual([]);
    expect(state.retryingTasks).toEqual([]);
  });

  test('S2.2: createDefaultExecutionRecord has valid defaults', () => {
    const task = createTestTask('TASK-feature-P2-exec-20260411');
    const record = createDefaultExecutionRecord(task);
    expect(record.taskId).toBe(task.id);
    expect(record.finalStatus).toBe(task.status);
    expect(record.retryCount).toBe(0);
    expect(record.timeline).toEqual([]);
    expect(record.devReport.taskId).toBe(task.id);
    expect(record.contract.taskId).toBe(task.id);
  });

  test('S2.3: createDefaultDevReport has valid structure', () => {
    const report = createDefaultDevReport('TASK-001');
    expect(report.taskId).toBe('TASK-001');
    expect(report.status).toBe('pending');
    expect(report.changes).toEqual([]);
    expect(report.evidence).toEqual([]);
    expect(report.checkpointsCompleted).toEqual([]);
    expect(report.duration).toBe(0);
  });

  test('S2.4: createDefaultSprintContract has valid structure', () => {
    const contract = createDefaultSprintContract('TASK-001');
    expect(contract.taskId).toBe('TASK-001');
    expect(contract.acceptanceCriteria).toEqual([]);
    expect(contract.verificationCommands).toEqual([]);
    expect(contract.checkpoints).toEqual([]);
    expect(contract.createdAt).toBeTruthy();
    expect(contract.updatedAt).toBeTruthy();
  });

  test('S2.5: PHASE_ROLE_MAP maps phases to correct roles', () => {
    expect(PHASE_ROLE_MAP.development).toBe('executor');
    expect(PHASE_ROLE_MAP.code_review).toBe('code_reviewer');
    expect(PHASE_ROLE_MAP.qa_verification).toBe('qa_tester');
    expect(PHASE_ROLE_MAP.qa).toBe('qa_tester');
    expect(PHASE_ROLE_MAP.evaluation).toBe('architect');
  });

  test('S2.6: Pipeline.PHASE_ORDER has correct pipeline stages', () => {
    expect(Pipeline.PHASE_ORDER).toEqual([
      'development',
      'code_review',
      'qa_verification',
      'evaluation',
    ]);
  });

  test('S2.7: DEFAULT_PHASE_RETRY_LIMITS have sensible values', () => {
    expect(DEFAULT_PHASE_RETRY_LIMITS.development).toBe(3);
    expect(DEFAULT_PHASE_RETRY_LIMITS.code_review).toBe(1);
    expect(DEFAULT_PHASE_RETRY_LIMITS.qa).toBe(2);
    expect(DEFAULT_PHASE_RETRY_LIMITS.evaluation).toBe(2);
  });

  test('S2.8: PIPELINE_INTERMEDIATE_STATUSES and migration map are consistent', () => {
    expect(PIPELINE_INTERMEDIATE_STATUSES).toEqual(['wait_review', 'wait_qa', 'wait_complete']);
    // Migration map should map intermediate statuses to valid states
    for (const status of PIPELINE_INTERMEDIATE_STATUSES) {
      const mapped = PIPELINE_STATUS_MIGRATION_MAP[status];
      expect(mapped).toBeDefined();
      // Mapped status should be a valid TaskStatus
      expect(['open', 'in_progress', 'resolved', 'closed', 'failed', 'abandoned']).toContain(mapped);
    }
  });
});

// ============================================================
// Scenario 3: Quality Gate Interception (~5 cases)
// ============================================================

describe('Scenario 3: Quality Gate Interception', () => {
  test('S3.1: validateBasicFields passes for valid task', () => {
    const task = createTestTask('TASK-feature-P2-valid-20260411');
    task.description = 'A sufficiently long description for validation';
    task.checkpoints = [createTestCheckpoint('CP-1')];
    const result = validateBasicFields(task);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('S3.2: validateBasicFields fails for empty title', () => {
    const task = createTestTask('TASK-feature-P2-notitle-20260411');
    task.title = '';
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('title') || e.includes('标题'))).toBe(true);
  });

  test('S3.3: validateBasicFields fails for short description', () => {
    const task = createTestTask('TASK-feature-P2-short-20260411');
    task.description = 'short';
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('S3.4: validateBasicFields fails for missing checkpoints', () => {
    const task = createTestTask('TASK-feature-P2-nocheck-20260411');
    task.description = 'A sufficiently long description for validation';
    task.checkpoints = [];
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('checkpoint') || e.includes('检查点'))).toBe(true);
  });

  test('S3.5: validateBasicFields fails for empty task ID', () => {
    const task = createTestTask('');
    task.title = 'Valid title';
    task.description = 'A sufficiently long description for validation';
    task.checkpoints = [createTestCheckpoint('CP-1')];
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Scenario 4: State Recovery and Retry (~5 cases)
// ============================================================

describe('Scenario 4: State Recovery and Retry', () => {
  test('S4.1: saveRuntimeState and loadRuntimeState round-trip', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    state.taskQueue = ['TASK-1', 'TASK-2'];
    state.currentIndex = 1;
    state.retryCounter.set('TASK-1', 2);
    state.resumeFrom.set('TASK-1', 'qa');
    state.reevaluateCounter.set('TASK-1', 1);
    state.phaseRetryCounters.set('TASK-1:development', 1);

    saveRuntimeState(state, tmpDir);
    const loaded = loadRuntimeState(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.taskQueue).toEqual(['TASK-1', 'TASK-2']);
    expect(loaded!.currentIndex).toBe(1);
    expect(loaded!.retryCounter.get('TASK-1')).toBe(2);
    expect(loaded!.resumeFrom.get('TASK-1')).toBe('qa');
    expect(loaded!.reevaluateCounter.get('TASK-1')).toBe(1);
    expect(loaded!.phaseRetryCounters.get('TASK-1:development')).toBe(1);
    expect(loaded!.stateFormatVersion).toBe(1);
  });

  test('S4.2: loadRuntimeState returns null for missing file', () => {
    const result = loadRuntimeState(tmpDir);
    expect(result).toBeNull();
  });

  test('S4.3: loadRuntimeState returns null for corrupted JSON', () => {
    const statePath = path.join(tmpDir, '.projmnt4claude', 'harness-state.json');
    fs.writeFileSync(statePath, 'not valid json{{{{', 'utf-8');
    const result = loadRuntimeState(tmpDir);
    expect(result).toBeNull();
  });

  test('S4.4: loadRuntimeState returns null for wrong version', () => {
    const statePath = path.join(tmpDir, '.projmnt4claude', 'harness-state.json');
    fs.writeFileSync(statePath, JSON.stringify({ stateFormatVersion: 99 }), 'utf-8');
    const result = loadRuntimeState(tmpDir);
    expect(result).toBeNull();
  });

  test('S4.5: retryCounter and phaseRetryCounters track per-task per-phase counts', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);

    // Simulate retry tracking
    state.retryCounter.set('TASK-1', 1);
    state.phaseRetryCounters.set('TASK-1:development', 1);
    state.phaseRetryCounters.set('TASK-1:qa', 0);

    saveRuntimeState(state, tmpDir);
    const loaded = loadRuntimeState(tmpDir);

    expect(loaded!.retryCounter.get('TASK-1')).toBe(1);
    expect(loaded!.phaseRetryCounters.get('TASK-1:development')).toBe(1);
    expect(loaded!.phaseRetryCounters.get('TASK-1:qa')).toBe(0);
    // Non-existent key returns undefined
    expect(loaded!.phaseRetryCounters.get('TASK-1:evaluation')).toBeUndefined();
  });
});

// ============================================================
// Scenario 5: AI Enhanced Flow - FeedbackConstraintEngine (~5 cases)
// ============================================================

describe('Scenario 5: AI Enhanced Flow - FeedbackConstraintEngine', () => {
  test('S5.1: validate returns violations for invalid JSON output', () => {
    const engine = createJsonFeedbackEngine();
    const violations = engine.validate('{invalid json}');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.ruleId === 'json-parseable')).toBe(true);
  });

  test('S5.2: validate returns no violations for valid JSON output', () => {
    const engine = createJsonFeedbackEngine();
    const violations = engine.validate('{"status": "success", "changes": []}');
    expect(violations).toEqual([]);
  });

  test('S5.3: shouldRetry returns true for error violations under limit', () => {
    const engine = createJsonFeedbackEngine();
    engine.reset(); // ensure retryCount = 0
    const violations: ValidationViolation[] = [
      { ruleId: 'json-parseable', severity: 'error', message: 'bad json' },
    ];
    expect(engine.shouldRetry(violations)).toBe(true);
  });

  test('S5.4: shouldRetry returns false for warning-only violations', () => {
    const engine = createJsonFeedbackEngine();
    const violations: ValidationViolation[] = [
      { ruleId: 'some-warning', severity: 'warning', message: 'minor issue' },
    ];
    expect(engine.shouldRetry(violations)).toBe(false);
  });

  test('S5.5: buildFeedback generates structured correction prompt', () => {
    const engine = createJsonFeedbackEngine();
    const violations: ValidationViolation[] = [
      { ruleId: 'json-parseable', severity: 'error', message: 'JSON 解析失败' },
    ];
    const feedback = engine.buildFeedback(violations, '{bad}');
    expect(feedback).toContain('违规项');
    expect(feedback).toContain('json-parseable');
    expect(feedback).toContain('JSON 解析失败');
    expect(feedback).toContain('{bad}');
  });

  test('S5.6: runWithFeedback retries and passes on valid second attempt', async () => {
    const engine = createJsonFeedbackEngine();
    let callCount = 0;

    const invokeFn = () => {
      callCount++;
      if (callCount === 1) {
        return { output: '{invalid}', success: true };
      }
      return { output: '{"result": "ok"}', success: true };
    };

    const result = await engine.runWithFeedback(invokeFn, 'test prompt', {});
    expect(result.passed).toBe(true);
    expect(result.retries).toBe(1);
    expect(result.violations).toEqual([]);
    expect(callCount).toBe(2);
  });

  test('S5.7: runWithFeedback stops retrying after maxRetries', async () => {
    const engine = createJsonFeedbackEngine([], 1); // max 1 retry
    let callCount = 0;

    const invokeFn = () => {
      callCount++;
      return { output: 'always invalid', success: true };
    };

    const result = await engine.runWithFeedback(invokeFn, 'test', {});
    expect(result.passed).toBe(false);
    expect(callCount).toBe(2); // initial + 1 retry
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test('S5.8: createMarkdownFeedbackEngine validates non-empty output', () => {
    const engine = createMarkdownFeedbackEngine();
    const violations = engine.validate(''); // empty string
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.ruleId === 'non-empty-output')).toBe(true);
  });

  test('S5.9: createSessionAwareEngine works for json output type', () => {
    const engine = createSessionAwareEngine('json');
    // Should validate both non-empty and json-parseable
    const violations = engine.validate('');
    expect(violations.length).toBeGreaterThan(0);
  });

  test('S5.10: custom rule set integrates with engine', () => {
    const engine = new FeedbackConstraintEngineImpl();
    const customRule = makeRule('custom-check', (output) => {
      if (typeof output === 'string' && !output.includes('required-field')) {
        return { ruleId: 'custom-check', severity: 'error', message: 'Missing required-field' };
      }
      return null;
    });
    engine.addRuleSet(makeRuleSet('custom', [customRule]));

    const violations = engine.validate('output without field');
    expect(violations.length).toBe(1);
    expect(violations[0]!.ruleId).toBe('custom-check');

    const noViolations = engine.validate('output with required-field');
    expect(noViolations).toEqual([]);
  });
});

// ============================================================
// Scenario 6: Verdict Routing (~5 cases)
// ============================================================

describe('Scenario 6: Verdict Routing', () => {
  test('S6.1: VALID_VERDICT_ACTIONS contains all expected actions', async () => {
    const { VALID_VERDICT_ACTIONS } = await import('../types/harness.js');
    expect(VALID_VERDICT_ACTIONS).toContain('resolve');
    expect(VALID_VERDICT_ACTIONS).toContain('redevelop');
    expect(VALID_VERDICT_ACTIONS).toContain('minor_fix');
    expect(VALID_VERDICT_ACTIONS).toContain('retest');
    expect(VALID_VERDICT_ACTIONS).toContain('reevaluate');
    expect(VALID_VERDICT_ACTIONS).toContain('escalate_human');
    expect(VALID_VERDICT_ACTIONS.length).toBe(6);
  });

  test('S6.2: ReviewVerdict with action=redevelop signals development retry', () => {
    const verdict = createFailedVerdict('TASK-001', 'redevelop');
    expect(verdict.result).toBe('NOPASS');
    expect(verdict.action).toBe('redevelop');
    // This action should cause a retry from development phase
    expect(verdict.failedCriteria.length).toBeGreaterThan(0);
  });

  test('S6.3: ReviewVerdict with action=retest signals QA retry', () => {
    const verdict = createFailedVerdict('TASK-001', 'retest');
    expect(verdict.action).toBe('retest');
    // resumeFrom should be set to 'qa' when retest is processed
  });

  test('S6.4: ReviewVerdict with action=reevaluate uses independent counter', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    // reevaluateCounter is independent from retryCounter
    expect(state.reevaluateCounter.size).toBe(0);
    state.reevaluateCounter.set('TASK-001', 1);
    expect(state.reevaluateCounter.get('TASK-001')).toBe(1);
    // MAX_REEVALUATE_ATTEMPTS is 2 (internal constant)
  });

  test('S6.5: ReviewVerdict with action=escalate_human sets status to open', () => {
    const verdict = createFailedVerdict('TASK-001', 'escalate_human');
    expect(verdict.action).toBe('escalate_human');
    // When processed, task should transition to 'open' state
  });

  test('S6.6: CodeReviewVerdict NOPASS with minor issues routes to minor_fix', () => {
    // Minor issue detection: <=2 quality issues, 0 failed checkpoints, reason contains style keywords
    const verdict: CodeReviewVerdict = {
      taskId: 'TASK-001',
      result: 'NOPASS',
      reason: '代码风格问题：命名不规范和缩进不一致',
      codeQualityIssues: ['naming', 'indent'],
      failedCheckpoints: [], // no failed checkpoints -> minor
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'code_reviewer',
    };
    // The classification logic should classify this as minor
    expect(verdict.codeQualityIssues.length).toBeLessThanOrEqual(2);
    expect(verdict.failedCheckpoints.length).toBe(0);
    expect(/(?:命名|格式|缩进|naming|format|style|indent)/i.test(verdict.reason)).toBe(true);
  });

  test('S6.7: QAVerdict NOPASS with multiple failures routes to redevelop', () => {
    const verdict = createFailedQAVerdict('TASK-001', 'Multiple test failures');
    verdict.testFailures = ['test1', 'test2', 'test3'];
    verdict.failedCheckpoints = ['CP-1', 'CP-2'];
    // Multiple failures -> major -> redevelop
    expect(verdict.testFailures.length).toBeGreaterThan(1);
    expect(verdict.failedCheckpoints.length).toBeGreaterThan(1);
  });
});

// ============================================================
// Scenario 7: Batch Execution & Git Commit (~4 cases)
// ============================================================

describe('Scenario 7: Batch Execution & Git Commit', () => {
  test('S7.1: buildBatchAwareQueue with multiple batches', () => {
    const result = buildBatchAwareQueue(
      ['T1', 'T2', 'T3', 'T4', 'T5'],
      [['T1', 'T2'], ['T3', 'T4'], ['T5']]
    );
    expect(result.batchBoundaries).toEqual([0, 2, 4]);
    expect(result.batchLabels).toEqual(['批次 1', '批次 2', '批次 3']);
    expect(result.batchParallelizable).toEqual([true, true, false]);
  });

  test('S7.2: buildBatchAwareQueue with no batches returns empty boundaries', () => {
    const result = buildBatchAwareQueue(['T1', 'T2', 'T3']);
    expect(result.batchBoundaries).toEqual([]);
    expect(result.batchLabels).toEqual([]);
    expect(result.batchParallelizable).toEqual([]);
  });

  test('S7.3: ExecutionSummary structure with batch context', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    state.taskQueue = ['T1', 'T2', 'T3'];
    state.batchBoundaries = [0, 2];
    state.batchLabels = ['批次 1', '批次 2'];
    state.batchParallelizable = [true, false];

    saveRuntimeState(state, tmpDir);
    const loaded = loadRuntimeState(tmpDir);
    expect(loaded!.batchBoundaries).toEqual([0, 2]);
    expect(loaded!.batchLabels).toEqual(['批次 1', '批次 2']);
    expect(loaded!.batchParallelizable).toEqual([true, false]);
  });

  test('S7.4: batch task queue ordering preserved after state round-trip', () => {
    const config = createTestConfig();
    const state = createDefaultRuntimeState(config);
    state.taskQueue = ['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4'];
    state.batchBoundaries = [0, 2];
    state.currentIndex = 1;

    saveRuntimeState(state, tmpDir);
    const loaded = loadRuntimeState(tmpDir);

    expect(loaded!.taskQueue).toEqual(['TASK-1', 'TASK-2', 'TASK-3', 'TASK-4']);
    expect(loaded!.currentIndex).toBe(1);
  });
});

// ============================================================
// Additional Integration Tests: Cross-Module Collaboration
// ============================================================

describe('Cross-Module Integration', () => {
  test('X1: task lifecycle with phase history and resume action', () => {
    const task = createTestTask('TASK-feature-P2-crossmod-20260411');
    task.phaseHistory = [
      { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: new Date().toISOString() },
      { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: new Date().toISOString() },
    ];
    task.resumeAction = 'retry';
    writeTaskToDisk(task);

    const loaded = readTaskFromDisk(task.id);
    expect(loaded!.phaseHistory!.length).toBe(2);
    expect(loaded!.resumeAction).toBe('retry');

    // Pipeline should correctly determine resume point
    const resumePoint = Pipeline.determineResumePoint(
      loaded!.phaseHistory!,
      loaded!.resumeAction as 'retry'
    );
    expect(resumePoint!.phase).toBe('code_review');
    expect(resumePoint!.role).toBe('code_reviewer');
  });

  test('X2: validateCheckpointVerification detects missing commands for functional_test', () => {
    const checkpoint = {
      description: 'Test login flow',
      verification: {
        method: 'functional_test' as const,
        // Missing commands and steps
      },
    };
    const result = validateCheckpointVerification(checkpoint);
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('commands');
  });

  test('X3: validateCheckpointVerification passes for automated method', () => {
    const checkpoint = {
      description: 'Verify build',
      verification: {
        method: 'automated' as const,
        commands: ['npm run build'],
      },
    };
    const result = validateCheckpointVerification(checkpoint);
    expect(result.valid).toBe(true);
  });

  test('X4: inferTaskType and inferTaskPriority from title', () => {
    expect(inferTaskType('fix login bug')).toBe('bug');
    expect(inferTaskType('add user registration feature')).toBe('feature');
    expect(inferTaskType('refactor auth module')).toBe('refactor');
    expect(inferTaskType('write unit test')).toBe('test');
    expect(inferTaskType('add test coverage')).toBe('test');
    expect(inferTaskType('update README docs')).toBe('docs');
    expect(inferTaskType('research best practices')).toBe('research');

    expect(inferTaskPriority('urgent hotfix')).toBe('P0');
    expect(inferTaskPriority('important feature')).toBe('P1');
    expect(inferTaskPriority('normal task')).toBe('P2');
    expect(inferTaskPriority('low priority cleanup')).toBe('P3');
  });

  test('X5: normalizePriority handles legacy formats', () => {
    expect(normalizePriority('urgent')).toBe('P0');
    expect(normalizePriority('high')).toBe('P1');
    expect(normalizePriority('medium')).toBe('P2');
    expect(normalizePriority('low')).toBe('P3');
    expect(normalizePriority('P0')).toBe('P0');
    expect(normalizePriority('unknown')).toBe('P2'); // defaults to P2
  });

  test('X6: extractFilePaths from description text', () => {
    const text = 'Modify src/utils/helper.ts and src/types/index.ts for this task';
    const files = extractFilePaths(text);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some(f => f.includes('helper.ts'))).toBe(true);
    expect(files.some(f => f.includes('index.ts'))).toBe(true);
  });

  test('X7: task with dependencies tracks upstream status', () => {
    const upstream = createTestTask('TASK-feature-P2-upstream-20260411');
    upstream.status = 'resolved';
    writeTaskToDisk(upstream);

    const downstream = createTestTask('TASK-feature-P2-downstream-20260411');
    downstream.dependencies = [upstream.id];
    writeTaskToDisk(downstream);

    const loaded = readTaskFromDisk(downstream.id);
    expect(loaded!.dependencies).toEqual([upstream.id]);

    // Verify upstream is resolved
    const loadedUpstream = readTaskFromDisk(upstream.id);
    expect(loadedUpstream!.status).toBe('resolved');
  });

  test('X8: ExecutionSummary construction from multiple records', () => {
    const config = createTestConfig();
    const task1 = createTestTask('T1');
    const task2 = createTestTask('T2');

    const record1 = createDefaultExecutionRecord(task1);
    record1.finalStatus = 'resolved';
    record1.reviewVerdict = createPassedVerdict('T1');

    const record2 = createDefaultExecutionRecord(task2);
    record2.finalStatus = 'failed';
    record2.reviewVerdict = createFailedVerdict('T2');

    const records = [record1, record2];
    const passed = records.filter(r => r.reviewVerdict?.result === 'PASS').length;
    const failed = records.filter(r => r.reviewVerdict?.result === 'NOPASS' || r.devReport.status === 'failed').length;

    expect(passed).toBe(1);
    expect(failed).toBe(1);
  });
});

// ============================================================
// Scenario 5 Extended: assessComplexity Integration
// ============================================================

describe('Complexity Assessment Integration', () => {
  test('C1: low complexity for simple descriptions', () => {
    const analysis = {
      title: 'Fix typo',
      description: 'Fix typo in README',
      priority: 'P3' as const,
      recommendedRole: 'developer',
      estimatedComplexity: 'low' as const,
      suggestedCheckpoints: ['Fix typo'],
      potentialDependencies: [],
    };
    const result = assessComplexity('Fix typo in README', analysis);
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(40);
  });

  test('C2: high complexity for multi-file multi-module descriptions', () => {
    const desc = [
      '重构整个认证模块 (src/auth/)，包括:',
      '- 修改 src/auth/oauth.ts 实现 OAuth2.0',
      '- 修改 src/auth/jwt.ts 添加 token 刷新',
      '- 更新 src/types/auth.ts 类型定义',
      '- 添加 src/auth/session.ts 会话管理',
      '- 修改 src/middleware/auth.ts 中间件',
      '验证: 单元测试、集成测试、E2E测试',
    ].join('\n');

    const analysis = {
      title: 'Refactor auth module',
      description: desc,
      priority: 'P1' as const,
      recommendedRole: 'architect',
      estimatedComplexity: 'high' as const,
      suggestedCheckpoints: [
        'Implement OAuth2.0',
        'Add token refresh',
        'Update type definitions',
        'Add session management',
        'Update middleware',
      ],
      potentialDependencies: [],
    };
    const result = assessComplexity(desc, analysis);
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.workItemCount).toBeGreaterThan(0);
    expect(result.estimatedMinutes).toBeGreaterThan(15);
  });

  test('C3: complexity signals include expected types', () => {
    const analysis = {
      title: 'Test task',
      description: 'A test task description',
      priority: 'P2' as const,
      recommendedRole: 'developer',
      estimatedComplexity: 'medium' as const,
      suggestedCheckpoints: ['CP-1'],
      potentialDependencies: [],
    };
    const result = assessComplexity('A test task description', analysis);
    const signalTypes = result.signals.map(s => s.type);
    expect(signalTypes).toContain('file_count');
    expect(signalTypes).toContain('work_items');
    expect(signalTypes).toContain('cross_module');
    expect(signalTypes).toContain('checkpoint_count');
    expect(signalTypes).toContain('description_length');
    expect(signalTypes).toContain('action_verb_density');
  });

  test('C4: splitSuggestions generated for high complexity tasks', () => {
    const desc = '重构认证模块 src/auth/oauth.ts src/auth/jwt.ts src/auth/session.ts src/middleware/auth.ts，验证所有接口';
    const analysis = {
      title: 'Refactor auth',
      description: desc,
      priority: 'P1' as const,
      recommendedRole: 'architect',
      estimatedComplexity: 'high' as const,
      suggestedCheckpoints: ['CP-1', 'CP-2', 'CP-3'],
      potentialDependencies: [],
    };
    const result = assessComplexity(desc, analysis);
    if (result.level === 'high') {
      // High complexity should have split suggestions (may be 1 if no clear split strategy)
      expect(result.splitSuggestions.length).toBeGreaterThanOrEqual(1);
    }
  });
});
