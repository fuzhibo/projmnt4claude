/**
 * analyze-fix-pipeline-e2e.test.ts
 *
 * CP-11: E2E test for analyze --fix flow
 * Tests the applyStatusInferenceFix unified fix pipeline end-to-end,
 * exercising all 3 detection rules + fix actions together:
 * - CP-1: reset_to_open (missing_pipeline_evidence)
 * - CP-6: update_status (report_status_mismatch)
 * - CP-7: complete_checkpoints (checkpoint_status_mismatch)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TaskMeta, TaskStatus, CheckpointMetadata } from '../types/task';

// ============== 辅助函数 ==============

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-fix-pipeline-e2e-'));
}

function createTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-feature-P2-test-task-20260411',
    title: 'Test Task',
    description: 'Test description',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    schemaVersion: 4,
    ...overrides,
  };
}

function setupProjectWithTask(cwd: string, task: TaskMeta): void {
  const tasksDir = path.join(cwd, '.projmnt4claude', 'tasks', task.id);
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(tasksDir, 'meta.json'),
    JSON.stringify(task, null, 2),
    'utf-8',
  );
}

function createReportDir(cwd: string, taskId: string): string {
  const reportDir = path.join(cwd, '.projmnt4claude', 'reports', 'harness', taskId);
  fs.mkdirSync(reportDir, { recursive: true });
  return reportDir;
}

function writeReport(reportDir: string, fileName: string, verdict: 'PASS' | 'NOPASS'): void {
  const content = `# Report\n\n**结果**: ${verdict === 'PASS' ? '✅ PASS' : '❌ NOPASS'}\n`;
  fs.writeFileSync(path.join(reportDir, fileName), content, 'utf-8');
}

function initProject(cwd: string): void {
  fs.mkdirSync(path.join(cwd, '.projmnt4claude'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.projmnt4claude', 'config.json'),
    JSON.stringify({ analyze: { autoGenerateCheckpoints: true } }),
    'utf-8',
  );
}

function readTaskFromDisk(cwd: string, taskId: string): TaskMeta | null {
  const metaPath = path.join(cwd, '.projmnt4claude', 'tasks', taskId, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

// ============== E2E Tests ==============

describe('applyStatusInferenceFix E2E', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    initProject(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('applies all 3 fix types in a single pass', async () => {
    // Task A: wait_qa with no prerequisite reports → reset_to_open (CP-1)
    const taskA = createTask({
      id: 'TASK-feature-P2-task-a-20260411',
      status: 'wait_qa',
    });
    setupProjectWithTask(tmpDir, taskA);

    // Task B: in_progress with dev-report PASS → update_status to wait_review (CP-6)
    const taskB = createTask({
      id: 'TASK-feature-P2-task-b-20260411',
      status: 'in_progress',
    });
    setupProjectWithTask(tmpDir, taskB);
    const reportDirB = createReportDir(tmpDir, taskB.id);
    writeReport(reportDirB, 'dev-report.md', 'PASS');

    // Task C: resolved with all pending checkpoints → complete_checkpoints (CP-7)
    const now = new Date().toISOString();
    const taskC = createTask({
      id: 'TASK-feature-P2-task-c-20260411',
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Test A', status: 'pending', createdAt: now, updatedAt: now },
        { id: 'CP-2', description: 'Test B', status: 'pending', createdAt: now, updatedAt: now },
      ] as CheckpointMetadata[],
    });
    setupProjectWithTask(tmpDir, taskC);

    // Run the unified fix pipeline
    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);

    // Verify 3 fixes applied
    const applied = results.filter(r => r.applied);
    expect(applied.length).toBe(3);

    // Verify Task A: reset to open
    const updatedA = readTaskFromDisk(tmpDir, taskA.id);
    expect(updatedA).not.toBeNull();
    expect(updatedA!.status).toBe('open');
    expect(updatedA!.resumeAction).toBe('reset_to_open');
    const fixA = results.find(r => r.taskId === taskA.id && r.action === 'reset_to_open');
    expect(fixA).toBeDefined();
    expect(fixA!.applied).toBe(true);

    // Verify Task B: status updated to wait_review
    const updatedB = readTaskFromDisk(tmpDir, taskB.id);
    expect(updatedB).not.toBeNull();
    expect(updatedB!.status).toBe('wait_review');
    const fixB = results.find(r => r.taskId === taskB.id && r.action === 'update_status');
    expect(fixB).toBeDefined();
    expect(fixB!.applied).toBe(true);

    // Verify Task C: checkpoints completed
    const updatedC = readTaskFromDisk(tmpDir, taskC.id);
    expect(updatedC).not.toBeNull();
    expect(updatedC!.checkpoints!.every(cp => cp.status === 'completed')).toBe(true);
    const fixC = results.find(r => r.taskId === taskC.id && r.action === 'complete_checkpoints');
    expect(fixC).toBeDefined();
    expect(fixC!.applied).toBe(true);
  });

  test('handles project with no issues gracefully', async () => {
    // Task in a healthy state with matching report
    const task = createTask({
      id: 'TASK-feature-P2-healthy-20260411',
      status: 'wait_review',
    });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'PASS');
    // wait_review with dev-report PASS is consistent (dev-report implies wait_review which matches)

    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);

    // No fix actions should be applied
    const applied = results.filter(r => r.applied);
    expect(applied.length).toBe(0);
  });

  test('NOPASS reports do not trigger update_status', async () => {
    const task = createTask({
      id: 'TASK-feature-P2-nopass-20260411',
      status: 'in_progress',
    });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'NOPASS');

    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);

    const updateFix = results.find(r => r.taskId === task.id && r.action === 'update_status');
    // Should not trigger an update_status fix for NOPASS report
    expect(updateFix).toBeUndefined();
  });

  test('mixed checkpoint statuses do not trigger complete_checkpoints', async () => {
    const now = new Date().toISOString();
    const task = createTask({
      id: 'TASK-feature-P2-mixed-cp-20260411',
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Done', status: 'completed', createdAt: now, updatedAt: now },
        { id: 'CP-2', description: 'Pending', status: 'pending', createdAt: now, updatedAt: now },
      ] as CheckpointMetadata[],
    });
    setupProjectWithTask(tmpDir, task);

    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);

    const cpFix = results.find(r => r.taskId === task.id && r.action === 'complete_checkpoints');
    // Mixed statuses should NOT trigger the fix (only triggers when ALL are pending)
    expect(cpFix).toBeUndefined();
  });

  test('terminal statuses are not affected by missing_pipeline_evidence', async () => {
    // Tasks in terminal states should not be flagged
    for (const status of ['resolved', 'closed', 'abandoned', 'failed'] as TaskStatus[]) {
      const task = createTask({
        id: `TASK-feature-P2-${status}-20260411`,
        status,
      });
      setupProjectWithTask(tmpDir, task);
    }

    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);

    const resetFixes = results.filter(r => r.action === 'reset_to_open' && r.applied);
    expect(resetFixes.length).toBe(0);
  });

  test('empty project returns empty results', async () => {
    const { applyStatusInferenceFix } = await import('../commands/analyze-fix-pipeline');
    const results = await applyStatusInferenceFix(tmpDir, true);
    expect(results).toEqual([]);
  });
});

// ============== fixSingleIssue E2E edge cases ==============

describe('fixSingleIssue edge cases', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    initProject(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('report_status_mismatch with missing impliedStatus returns unfixable', async () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);

    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const issue = {
      taskId: task.id,
      type: 'report_status_mismatch' as const,
      severity: 'high' as const,
      message: 'Status mismatch',
      suggestion: 'Fix it',
      details: { reportFile: 'dev-report.md' }, // no impliedStatus
    };
    const result = await fixSingleIssue(issue, tmpDir, true);
    expect(result).toBe('unfixable');
  });

  test('missing_pipeline_evidence with unknown fixAction returns unfixable', async () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);

    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const issue = {
      taskId: task.id,
      type: 'missing_pipeline_evidence' as const,
      severity: 'high' as const,
      message: 'Missing evidence',
      suggestion: 'Reset',
      details: { fixAction: 'unknown_action' },
    };
    const result = await fixSingleIssue(issue, tmpDir, true);
    expect(result).toBe('unfixable');
  });

  test('checkpoint_status_mismatch with no checkpoints returns skipped', async () => {
    const task = createTask({ status: 'resolved' });
    setupProjectWithTask(tmpDir, task);

    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const issue = {
      taskId: task.id,
      type: 'checkpoint_status_mismatch' as const,
      severity: 'medium' as const,
      message: 'Checkpoint mismatch',
      suggestion: 'Complete checkpoints',
      details: {},
    };
    const result = await fixSingleIssue(issue, tmpDir, true);
    expect(result).toBe('skipped');
  });
});
