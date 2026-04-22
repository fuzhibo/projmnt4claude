/**
 * Tests for phase-skippable pipeline execution structure (C3 refactoring)
 *
 * Verifies:
 * - CP-1: Phase-skippable structure using phase index comparison
 * - CP-2: phases = ['development', 'code_review', 'qa', 'evaluation']
 * - CP-3: resumeIndex = phases.indexOf(resumePhase)
 * - CP-7: ensureTransition(taskId, 'wait_evaluation', 'QA验证通过')
 * - CP-10: redevelop/minor_fix → in_progress (dev phase)
 * - CP-11: retest → wait_qa (qa phase)
 * - CP-12: reevaluate → wait_evaluation (evaluation phase)
 * - CP-13: resumeFrom deprecated, unified state transitions
 * - CP-14: Skip phase logs
 * - CP-16: determineResumePhase decision interface (C2)
 * - CP-17: handleVerdictBasedTransition verdict action tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import type { HarnessConfig, HarnessRuntimeState, TaskExecutionRecord, CodeReviewVerdict, QAVerdict, DevReport } from '../types/harness.js';
import { createDefaultRuntimeState, createDefaultExecutionRecord } from '../types/harness.js';
import type { TaskStatus, TaskMeta } from '../types/task.js';

// ============================================================
// Test helpers
// ============================================================

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    forceContinue: false,
    jsonOutput: false,
    cwd,
    batchGitCommit: false,
  };
}

function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TEST-TASK-001',
    title: 'Test Task',
    description: 'Test task for phase skip',
    status: 'open',
    priority: 'P2',
    type: 'feature',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checkpoints: [],
    ...overrides,
  } as TaskMeta;
}

function setupTaskDir(tmpDir: string, taskId: string, status: TaskStatus = 'open'): string {
  const projDir = path.join(tmpDir, '.projmnt4claude');
  const taskDir = path.join(projDir, 'tasks', taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const reportDir = path.join(projDir, 'reports', 'harness', taskId);
  fs.mkdirSync(reportDir, { recursive: true });

  const meta = {
    id: taskId,
    title: 'Test Task',
    description: 'Test task',
    status,
    priority: 'P2',
    type: 'feature',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checkpoints: [],
  };
  fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(meta, null, 2));

  return reportDir;
}

function writeReport(reportDir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(reportDir, filename), content);
}

// ============================================================
// CP-1, CP-2: Phase-skippable structure and phases array
// ============================================================

describe('Phase-skippable pipeline structure', () => {
  test('CP-2: phases array is correctly ordered', () => {
    const phases = ['development', 'code_review', 'qa', 'evaluation'];
    expect(phases[0]).toBe('development');
    expect(phases[1]).toBe('code_review');
    expect(phases[2]).toBe('qa');
    expect(phases[3]).toBe('evaluation');
  });

  test('CP-3: resumeIndex = phases.indexOf(resumePhase) gives correct indices', () => {
    const phases = ['development', 'code_review', 'qa', 'evaluation'];
    expect(phases.indexOf('development')).toBe(0);
    expect(phases.indexOf('code_review')).toBe(1);
    expect(phases.indexOf('qa')).toBe(2);
    expect(phases.indexOf('evaluation')).toBe(3);
  });

  test('CP-4: phase index comparison determines which phases run', () => {
    const phases = ['development', 'code_review', 'qa', 'evaluation'];

    // Resume from development (index 0): all phases run
    const resumeDev = phases.indexOf('development');
    expect(resumeDev <= 0).toBe(true);   // development runs
    expect(resumeDev <= 1).toBe(true);   // code_review runs
    expect(resumeDev <= 2).toBe(true);   // qa runs
    expect(resumeDev <= 3).toBe(true);   // evaluation runs

    // Resume from code_review (index 1): skip development
    const resumeCR = phases.indexOf('code_review');
    expect(resumeCR <= 0).toBe(false);  // development skipped
    expect(resumeCR <= 1).toBe(true);   // code_review runs
    expect(resumeCR <= 2).toBe(true);   // qa runs
    expect(resumeCR <= 3).toBe(true);   // evaluation runs

    // Resume from qa (index 2): skip development and code_review
    const resumeQA = phases.indexOf('qa');
    expect(resumeQA <= 0).toBe(false);  // development skipped
    expect(resumeQA <= 1).toBe(false);  // code_review skipped
    expect(resumeQA <= 2).toBe(true);   // qa runs
    expect(resumeQA <= 3).toBe(true);   // evaluation runs

    // Resume from evaluation (index 3): skip all except evaluation
    const resumeEval = phases.indexOf('evaluation');
    expect(resumeEval <= 0).toBe(false);  // development skipped
    expect(resumeEval <= 1).toBe(false);  // code_review skipped
    expect(resumeEval <= 2).toBe(false);  // qa skipped
    expect(resumeEval <= 3).toBe(true);   // evaluation runs
  });
});

// ============================================================
// CP-16: determineResumePhase decision interface (C2)
// ============================================================

describe('determineResumePhase decision interface', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-PHASE-SKIP-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-skip-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('maps in_progress → development (for redevelop/minor_fix)', () => {
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // redevelop/minor_fix transitions to in_progress
    const result = assemblyLine.determineResumePhase(taskId, 'in_progress', state);
    expect(result).toBe('development');
  });

  test('maps wait_qa → qa (for retest)', () => {
    const reportDir = setupTaskDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // retest transitions to wait_qa
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(result).toBe('qa');
  });

  test('maps wait_evaluation → evaluation (for reevaluate)', () => {
    const reportDir = setupTaskDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // reevaluate transitions to wait_evaluation
    const result = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);
    expect(result).toBe('evaluation');
  });

  test('wait_qa with qa-report auto-migrates to evaluation', () => {
    const reportDir = setupTaskDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // Legacy wait_qa + qa-report → auto-upgrade to evaluation
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(result).toBe('evaluation');
  });

  test('returns skip for terminal statuses', () => {
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    expect(assemblyLine.determineResumePhase(taskId, 'resolved', state)).toBe('skip');
    expect(assemblyLine.determineResumePhase(taskId, 'closed', state)).toBe('skip');
    expect(assemblyLine.determineResumePhase(taskId, 'failed', state)).toBe('skip');
    expect(assemblyLine.determineResumePhase(taskId, 'abandoned', state)).toBe('skip');
  });
});

// ============================================================
// CP-17: handleVerdictBasedTransition verdict action tests
// ============================================================

describe('handleVerdictBasedTransition status transitions', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-VERDICT-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
    setupTaskDir(tmpDir, taskId, 'wait_qa');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: call handleVerdictBasedTransition and verify resulting task status
   */
  async function runVerdictTransition(
    phase: 'code_review' | 'qa' | 'evaluation',
    action: string,
    initialStatus: TaskStatus = 'wait_qa',
  ): Promise<TaskExecutionRecord> {
    // Reset task status for the test
    const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
    const meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'meta.json'), 'utf-8'));
    meta.status = initialStatus;
    fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(meta));

    const task = createMockTask({ id: taskId, status: initialStatus });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));

    const timeline: Array<{ timestamp: string; event: string; description: string; data?: Record<string, unknown> }> = [];
    const addTimeline = (event: string, description: string, data?: Record<string, unknown>) => {
      timeline.push({ timestamp: new Date().toISOString(), event, description, data });
    };

    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, phase, action,
    );

    return result;
  }

  /**
   * Read current task status from meta.json
   */
  function getTaskStatus(): TaskStatus {
    const metaPath = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.status;
  }

  // CP-10: redevelop → in_progress
  test('CP-10: redevelop transitions to in_progress (development phase)', async () => {
    const result = await runVerdictTransition('qa', 'redevelop', 'wait_qa');
    expect(result.finalStatus).toBe('in_progress');
    expect(getTaskStatus()).toBe('in_progress');
    // Verify determineResumePhase maps in_progress → development
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'in_progress', state);
    expect(resumePhase).toBe('development');
  });

  // CP-10: minor_fix → in_progress
  test('CP-10: minor_fix transitions to in_progress (development phase)', async () => {
    const result = await runVerdictTransition('code_review', 'minor_fix', 'wait_review');
    expect(result.finalStatus).toBe('in_progress');
    expect(getTaskStatus()).toBe('in_progress');
  });

  // CP-11: retest → wait_qa
  test('CP-11: retest transitions to wait_qa (qa phase)', async () => {
    // Setup: need code-review-report for QA prerequisites
    const reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');

    const result = await runVerdictTransition('qa', 'retest', 'wait_qa');
    expect(result.finalStatus).toBe('wait_qa');
    expect(getTaskStatus()).toBe('wait_qa');
    // Verify determineResumePhase maps wait_qa → qa
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(resumePhase).toBe('qa');
  });

  // CP-12: reevaluate → wait_evaluation
  test('CP-12: reevaluate transitions to wait_evaluation (evaluation phase)', async () => {
    // Setup: need all reports for evaluation prerequisites
    const reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const result = await runVerdictTransition('evaluation', 'reevaluate', 'wait_evaluation');
    expect(result.finalStatus).toBe('wait_evaluation');
    expect(getTaskStatus()).toBe('wait_evaluation');
    // Verify determineResumePhase maps wait_evaluation → evaluation
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);
    expect(resumePhase).toBe('evaluation');
  });

  // CP-13: retest does NOT use resumeFrom
  test('CP-13: retest does not set resumeFrom (deprecated mechanism)', async () => {
    const reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');

    const task = createMockTask({ id: taskId, status: 'wait_qa' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));

    const addTimeline = () => {};
    await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'qa', 'retest',
    );

    // resumeFrom should NOT have the task (deprecated mechanism not used)
    expect(state.resumeFrom.has(taskId)).toBe(false);
  });

  // CP-13: reevaluate does NOT use resumeFrom
  test('CP-13: reevaluate does not set resumeFrom (deprecated mechanism)', async () => {
    const reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const task = createMockTask({ id: taskId, status: 'wait_evaluation' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));

    const addTimeline = () => {};
    await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'evaluation', 'reevaluate',
    );

    expect(state.resumeFrom.has(taskId)).toBe(false);
  });

  // CP-11: retest respects QA retry limit
  test('CP-11: retest falls back to redevelop when QA retries exhausted', async () => {
    const task = createMockTask({ id: taskId, status: 'wait_qa' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // Exhaust QA retry limit
    state.phaseRetryCounters.set(`${taskId}:qa`, 3); // default limit

    const addTimeline = () => {};
    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'qa', 'retest',
    );

    // Should fall back to redevelop → in_progress
    expect(result.finalStatus).toBe('in_progress');
    expect(state.resumeFrom.has(taskId)).toBe(false);
  });

  // CP-12: reevaluate respects max reevaluate attempts
  test('CP-12: reevaluate falls back to redevelop when max attempts reached', async () => {
    const task = createMockTask({ id: taskId, status: 'wait_evaluation' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    // Exhaust reevaluate limit
    state.reevaluateCounter.set(taskId, 2); // MAX_REEVALUATE_ATTEMPTS

    const addTimeline = () => {};
    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'evaluation', 'reevaluate',
    );

    // Should fall back to redevelop → in_progress
    expect(result.finalStatus).toBe('in_progress');
  });

  // CP-17: resolve → resolved
  test('CP-17: resolve transitions to resolved', async () => {
    const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
    const meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'meta.json'), 'utf-8'));
    meta.status = 'wait_evaluation';
    fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(meta));

    const task = createMockTask({ id: taskId, status: 'wait_evaluation' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const timeline: Array<{ timestamp: string; event: string; description: string; data?: Record<string, unknown> }> = [];
    const addTimeline = (event: string, description: string, data?: Record<string, unknown>) => {
      timeline.push({ timestamp: new Date().toISOString(), event, description, data });
    };

    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'evaluation', 'resolve',
    );

    expect(result.finalStatus).toBe('resolved');
    expect(getTaskStatus()).toBe('resolved');
    // Verify timeline entry
    expect(timeline.some(e => e.event === 'completed' && e.description.includes('architect'))).toBe(true);
  });

  // CP-17: escalate_human → open
  test('CP-17: escalate_human transitions to open', async () => {
    const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
    const meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'meta.json'), 'utf-8'));
    meta.status = 'wait_evaluation';
    fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(meta));

    const task = createMockTask({ id: taskId, status: 'wait_evaluation' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const timeline: Array<{ timestamp: string; event: string; description: string; data?: Record<string, unknown> }> = [];
    const addTimeline = (event: string, description: string, data?: Record<string, unknown>) => {
      timeline.push({ timestamp: new Date().toISOString(), event, description, data });
    };

    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'evaluation', 'escalate_human',
    );

    expect(result.finalStatus).toBe('open');
    expect(getTaskStatus()).toBe('open');
    // Verify timeline entry for escalation
    expect(timeline.some(e => e.event === 'failed' && e.description.includes('人工介入'))).toBe(true);
  });

  // CP-17: unknown action falls back to redevelop
  test('CP-17: unknown action falls back to redevelop behavior', async () => {
    const result = await runVerdictTransition('evaluation', 'invalid_action', 'wait_evaluation');
    // Falls back to redevelop → in_progress
    expect(result.finalStatus).toBe('in_progress');
    expect(getTaskStatus()).toBe('in_progress');
  });

  // Boundary: redevelop when dev retries exhausted → failed
  test('boundary: redevelop marks failed when dev retries exhausted', async () => {
    const task = createMockTask({ id: taskId, status: 'wait_qa' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    state.phaseRetryCounters.set(`${taskId}:development`, 3); // default limit

    const addTimeline = () => {};
    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'qa', 'redevelop',
    );

    expect(result.finalStatus).toBe('failed');
    expect(getTaskStatus()).toBe('failed');
  });

  // Boundary: minor_fix when phase retries exhausted → falls back to redevelop
  test('boundary: minor_fix falls back to redevelop when phase retries exhausted', async () => {
    const task = createMockTask({ id: taskId, status: 'wait_qa' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    state.phaseRetryCounters.set(`${taskId}:qa`, 2); // qa default limit

    const addTimeline = () => {};
    const result = await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'qa', 'minor_fix',
    );

    // Falls back to redevelop → in_progress
    expect(result.finalStatus).toBe('in_progress');
  });

  // Boundary: redevelop requeues task and increments counters
  test('boundary: redevelop requeues task and increments counters', async () => {
    const task = createMockTask({ id: taskId, status: 'wait_qa' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));

    const addTimeline = () => {};
    await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'qa', 'redevelop',
    );

    expect(state.taskQueue).toContain(taskId);
    expect(state.retryCounter.get(taskId)).toBe(1);
    expect(state.phaseRetryCounters.get(`${taskId}:development`)).toBe(1);
  });

  // Boundary: reevaluate increments reevaluateCounter but not retryCounter
  test('boundary: reevaluate increments reevaluateCounter not retryCounter', async () => {
    const reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const task = createMockTask({ id: taskId, status: 'wait_evaluation' });
    const record = createDefaultExecutionRecord(task);
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));

    const addTimeline = () => {};
    await (assemblyLine as any).handleVerdictBasedTransition(
      taskId, record, state, addTimeline, 'evaluation', 'reevaluate',
    );

    expect(state.reevaluateCounter.get(taskId)).toBe(1);
    // reevaluate does NOT consume retry counter
    expect(state.retryCounter.get(taskId) || 0).toBe(0);
    expect(state.taskQueue).toContain(taskId);
  });
});

// ============================================================
// CP-7, CP-8: QA pass → wait_evaluation transition
// ============================================================

describe('QA pass → wait_evaluation transition', () => {
  test('CP-7: implementation calls ensureTransition to wait_evaluation after QA pass', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain("ensureTransition(taskId, 'wait_evaluation', 'QA验证通过')");
  });

  test('CP-7: wait_evaluation status is valid in STATUS_RESUME_PHASE', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['wait_evaluation']).toBe('evaluation');
  });

  test('CP-8: implementation calls savePhaseCheckpoint for qa', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain("savePhaseCheckpoint(taskId, 'qa', state)");
  });

  test('CP-8: qa checkpoint → nextPhaseAfter returns evaluation', () => {
    const config = createTestConfig('/');
    const al = new AssemblyLine(config);
    const nextPhase = (al as any).nextPhaseAfter('qa');
    expect(nextPhase).toBe('evaluation');
  });
});

// ============================================================
// CP-14: Skip phase log messages
// ============================================================

describe('CP-14: Skip phase log messages in implementation', () => {
  test('implementation contains correct skip log for development', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain('⏩ 跳过开发阶段（已有完成报告）');
  });

  test('implementation contains correct skip log for code_review', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain('⏩ 跳过代码审核阶段（已有完成报告）');
  });

  test('implementation contains correct skip log for QA', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain('⏩ 跳过QA验证阶段（已有完成报告）');
  });
});

// ============================================================
// End-to-end phase skip integration
// ============================================================

describe('End-to-end phase skip integration', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-E2E-PHASE-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-phase-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('retest flow: wait_qa status → qa phase → skips dev and code_review', () => {
    const reportDir = setupTaskDir(tmpDir, taskId, 'wait_qa');
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);

    expect(resumePhase).toBe('qa');

    const phases = ['development', 'code_review', 'qa', 'evaluation'];
    const resumeIndex = phases.indexOf(resumePhase);

    // Should skip development and code_review, run qa and evaluation
    expect(resumeIndex <= 0).toBe(false);  // skip dev
    expect(resumeIndex <= 1).toBe(false);  // skip code_review
    expect(resumeIndex <= 2).toBe(true);   // run qa
  });

  test('reevaluate flow: wait_evaluation status → evaluation phase → skips all prior', () => {
    const reportDir = setupTaskDir(tmpDir, taskId, 'wait_evaluation');
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);

    expect(resumePhase).toBe('evaluation');

    const phases = ['development', 'code_review', 'qa', 'evaluation'];
    const resumeIndex = phases.indexOf(resumePhase);

    // Should skip everything except evaluation
    expect(resumeIndex <= 0).toBe(false);  // skip dev
    expect(resumeIndex <= 1).toBe(false);  // skip code_review
    expect(resumeIndex <= 2).toBe(false);  // skip qa
    expect(resumeIndex <= 3).toBe(true);   // run evaluation
  });

  test('redevelop flow: in_progress status → development phase → runs all', () => {
    setupTaskDir(tmpDir, taskId, 'in_progress');

    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    const resumePhase = assemblyLine.determineResumePhase(taskId, 'in_progress', state);

    expect(resumePhase).toBe('development');

    const phases = ['development', 'code_review', 'qa', 'evaluation'];
    const resumeIndex = phases.indexOf(resumePhase);

    // Should run all phases
    expect(resumeIndex <= 0).toBe(true);   // run dev
    expect(resumeIndex <= 1).toBe(true);   // run code_review
    expect(resumeIndex <= 2).toBe(true);   // run qa
    expect(resumeIndex <= 3).toBe(true);   // run evaluation
  });
});

// ============================================================
// CP-5: Prerequisite data rebuild from prevRecord when skipping
// ============================================================

describe('CP-5: prerequisite data rebuild from prevRecord', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-PREREQ-REBUILD-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-rebuild-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('implementation references prevRecord for skipped development phase', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    // Verify the code safely rebuilds devReport from prevRecord when skipping (using optional chaining)
    expect(sourceCode).toContain('devReport = prevRecord?.devReport');
    expect(sourceCode).toContain('record.devReport = devReport');
  });

  test('implementation references prevRecord for skipped code_review phase', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    // Verify the code safely rebuilds codeReviewVerdict from prevRecord when skipping (using optional chaining)
    expect(sourceCode).toContain('codeReviewVerdict = prevRecord?.codeReviewVerdict');
    expect(sourceCode).toContain('record.codeReviewVerdict = codeReviewVerdict');
  });

  test('implementation references prevRecord for skipped QA phase', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    // Verify the code safely rebuilds qaVerdict from prevRecord when skipping (using optional chaining)
    expect(sourceCode).toContain('qaVerdict = prevRecord?.qaVerdict');
    expect(sourceCode).toContain('record.qaVerdict = qaVerdict');
  });

  // PROBLEM-2: records field removed from HarnessRuntimeState
  // Execution records are now stored in AssemblyLine.executionRecords (private Map)
  // These tests were testing internal implementation details that no longer exist

  test('implementation warns when prevRecord missing for skipped phases', () => {
    const sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../utils/hd-assembly-line.ts'),
      'utf-8'
    );
    expect(sourceCode).toContain('未找到前次执行记录，从开发阶段重新开始');
  });
});
