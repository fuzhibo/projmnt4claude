import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import type { HarnessConfig, HarnessRuntimeState } from '../types/harness.js';
import { createDefaultRuntimeState } from '../types/harness.js';
import type { TaskStatus } from '../types/task.js';

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
    apiRetryAttempts: 0,
    apiRetryDelay: 10,
    batchGitCommit: false,
  };
}

function setupReportDir(tmpDir: string, taskId: string): string {
  const projDir = path.join(tmpDir, '.projmnt4claude');
  fs.mkdirSync(projDir, { recursive: true });
  const reportDir = path.join(projDir, 'reports', 'harness', taskId);
  fs.mkdirSync(reportDir, { recursive: true });
  return reportDir;
}

function writeReport(reportDir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(reportDir, filename), content);
}

function createStateWithCheckpoint(
  taskId: string,
  completedPhase: 'development' | 'code_review' | 'qa' | 'evaluation',
): HarnessRuntimeState {
  const config = createTestConfig('/');
  const state = createDefaultRuntimeState(config);
  state.taskPhaseCheckpoints = new Map();
  state.taskPhaseCheckpoints.set(taskId, {
    completedPhase,
    completedAt: new Date().toISOString(),
  });
  return state;
}

function createStateWithoutCheckpoint(): HarnessRuntimeState {
  const config = createTestConfig('/');
  return createDefaultRuntimeState(config);
}

// ============================================================
// STATUS_RESUME_PHASE 映射表测试
// ============================================================

describe('AssemblyLine.STATUS_RESUME_PHASE', () => {
  test('maps open → development', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['open']).toBe('development');
  });

  test('maps in_progress → development', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['in_progress']).toBe('development');
  });

  test('maps wait_review → code_review', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['wait_review']).toBe('code_review');
  });

  test('maps wait_qa → qa', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['wait_qa']).toBe('qa');
  });

  test('maps wait_evaluation → evaluation', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['wait_evaluation']).toBe('evaluation');
  });

  test('maps resolved → skip', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['resolved']).toBe('skip');
  });

  test('maps closed → skip', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['closed']).toBe('skip');
  });

  test('maps failed → skip', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['failed']).toBe('skip');
  });

  test('maps abandoned → skip', () => {
    expect(AssemblyLine.STATUS_RESUME_PHASE['abandoned']).toBe('skip');
  });
});

// ============================================================
// PHASE_PREREQUISITES 前置报告需求测试
// ============================================================

describe('AssemblyLine.PHASE_PREREQUISITES', () => {
  test('development requires no prerequisites', () => {
    expect(AssemblyLine.PHASE_PREREQUISITES['development']).toEqual([]);
  });

  test('code_review requires dev-report.md', () => {
    expect(AssemblyLine.PHASE_PREREQUISITES['code_review']).toEqual(['dev-report.md']);
  });

  test('qa requires dev-report.md + code-review-report.md', () => {
    expect(AssemblyLine.PHASE_PREREQUISITES['qa']).toEqual(['dev-report.md', 'code-review-report.md']);
  });

  test('evaluation requires all three reports', () => {
    expect(AssemblyLine.PHASE_PREREQUISITES['evaluation']).toEqual([
      'dev-report.md',
      'code-review-report.md',
      'qa-report.md',
    ]);
  });
});

// ============================================================
// determineResumePhase 三级优先级决策测试
// ============================================================

describe('AssemblyLine.determineResumePhase', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-TASK-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- 优先级1: taskPhaseCheckpoints ---

  test('uses taskPhaseCheckpoints when available and prerequisites met', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');

    const state = createStateWithCheckpoint(taskId, 'development');
    const result = assemblyLine.determineResumePhase(taskId, 'open', state);
    // development checkpoint → next is code_review, prerequisite dev-report exists
    expect(result).toBe('code_review');
  });

  test('falls back to development when taskPhaseCheckpoints points to phase with missing prerequisites', () => {
    // No reports created
    setupReportDir(tmpDir, taskId);

    const state = createStateWithCheckpoint(taskId, 'code_review');
    // code_review checkpoint → next is qa, needs dev+code-review reports → missing
    const result = assemblyLine.determineResumePhase(taskId, 'open', state);
    expect(result).toBe('development');
  });

  test('returns skip when taskPhaseCheckpoints shows evaluation completed', () => {
    const state = createStateWithCheckpoint(taskId, 'evaluation');
    const result = assemblyLine.determineResumePhase(taskId, 'open', state);
    expect(result).toBe('skip');
  });

  // --- 优先级2: STATUS_RESUME_PHASE 状态映射 ---

  test('maps open status to development when no checkpoint', () => {
    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'open', state);
    expect(result).toBe('development');
  });

  test('maps in_progress status to development when no checkpoint', () => {
    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'in_progress', state);
    expect(result).toBe('development');
  });

  test('maps wait_review status to code_review when prerequisites met', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_review', state);
    expect(result).toBe('code_review');
  });

  test('maps wait_qa status to qa when prerequisites met', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(result).toBe('qa');
  });

  test('maps wait_evaluation status to evaluation when prerequisites met', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);
    expect(result).toBe('evaluation');
  });

  // --- 终态返回 skip ---

  test('returns skip for resolved status', () => {
    const state = createStateWithoutCheckpoint();
    expect(assemblyLine.determineResumePhase(taskId, 'resolved', state)).toBe('skip');
  });

  test('returns skip for closed status', () => {
    const state = createStateWithoutCheckpoint();
    expect(assemblyLine.determineResumePhase(taskId, 'closed', state)).toBe('skip');
  });

  test('returns skip for failed status', () => {
    const state = createStateWithoutCheckpoint();
    expect(assemblyLine.determineResumePhase(taskId, 'failed', state)).toBe('skip');
  });

  test('returns skip for abandoned status', () => {
    const state = createStateWithoutCheckpoint();
    expect(assemblyLine.determineResumePhase(taskId, 'abandoned', state)).toBe('skip');
  });

  // --- 优先级3: 前置报告不完整降级 ---

  test('degrades to development when wait_review has no dev-report', () => {
    setupReportDir(tmpDir, taskId); // no reports
    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_review', state);
    expect(result).toBe('development');
  });

  test('degrades to development when wait_qa has no code-review-report', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    // missing code-review-report.md
    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(result).toBe('development');
  });

  test('degrades to development when wait_evaluation has no qa-report', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    // missing qa-report.md
    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);
    expect(result).toBe('development');
  });

  // --- 旧状态迁移: wait_qa + qa-report.md 存在 → wait_evaluation ---

  test('migrates wait_qa to evaluation when qa-report.md exists', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    // wait_qa + qa-report.md exists → migrate to evaluation
    expect(result).toBe('evaluation');
  });

  test('does not migrate wait_qa when qa-report.md is empty', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', ''); // empty

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    // empty qa-report → don't migrate, proceed with qa
    expect(result).toBe('qa');
  });

  test('does not migrate wait_qa when qa-report.md does not exist', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    // no qa-report.md

    const state = createStateWithoutCheckpoint();
    const result = assemblyLine.determineResumePhase(taskId, 'wait_qa', state);
    expect(result).toBe('qa');
  });

  // --- 无 taskPhaseCheckpoints 的场景 ---

  test('handles missing taskPhaseCheckpoints map gracefully', () => {
    const state = createStateWithoutCheckpoint();
    delete (state as unknown as Record<string, unknown>).taskPhaseCheckpoints;
    const result = assemblyLine.determineResumePhase(taskId, 'open', state);
    expect(result).toBe('development');
  });

  // --- checkpoint 指向 qa 阶段且有完整前置报告 ---

  test('resumes at evaluation when checkpoint shows qa completed and all reports exist', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev content');
    writeReport(reportDir, 'code-review-report.md', 'review content');
    writeReport(reportDir, 'qa-report.md', 'qa content');

    const state = createStateWithCheckpoint(taskId, 'qa');
    const result = assemblyLine.determineResumePhase(taskId, 'wait_evaluation', state);
    expect(result).toBe('evaluation');
  });
});

// ============================================================
// validatePrerequisites 测试
// ============================================================

describe('AssemblyLine.validatePrerequisites', () => {
  let tmpDir: string;
  let assemblyLine: AssemblyLine;
  const taskId = 'TEST-TASK-002';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-test-'));
    const config = createTestConfig(tmpDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns true for development (no prerequisites)', () => {
    expect(assemblyLine.validatePrerequisites(taskId, 'development')).toBe(true);
  });

  test('returns true for code_review when dev-report.md exists', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'content');
    expect(assemblyLine.validatePrerequisites(taskId, 'code_review')).toBe(true);
  });

  test('returns false for code_review when dev-report.md missing', () => {
    setupReportDir(tmpDir, taskId);
    expect(assemblyLine.validatePrerequisites(taskId, 'code_review')).toBe(false);
  });

  test('returns false for code_review when dev-report.md is empty', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', '');
    expect(assemblyLine.validatePrerequisites(taskId, 'code_review')).toBe(false);
  });

  test('returns true for qa when both reports exist', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev');
    writeReport(reportDir, 'code-review-report.md', 'review');
    expect(assemblyLine.validatePrerequisites(taskId, 'qa')).toBe(true);
  });

  test('returns false for qa when code-review-report.md missing', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev');
    expect(assemblyLine.validatePrerequisites(taskId, 'qa')).toBe(false);
  });

  test('returns true for evaluation when all three reports exist', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev');
    writeReport(reportDir, 'code-review-report.md', 'review');
    writeReport(reportDir, 'qa-report.md', 'qa');
    expect(assemblyLine.validatePrerequisites(taskId, 'evaluation')).toBe(true);
  });

  test('returns false for evaluation when qa-report.md missing', () => {
    const reportDir = setupReportDir(tmpDir, taskId);
    writeReport(reportDir, 'dev-report.md', 'dev');
    writeReport(reportDir, 'code-review-report.md', 'review');
    expect(assemblyLine.validatePrerequisites(taskId, 'evaluation')).toBe(false);
  });

  test('returns false when report directory does not exist', () => {
    // no .projmnt4claude dir created
    expect(assemblyLine.validatePrerequisites(taskId, 'code_review')).toBe(false);
  });
});
