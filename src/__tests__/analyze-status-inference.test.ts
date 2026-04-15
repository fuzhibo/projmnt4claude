/**
 * analyze-status-inference.test.ts
 *
 * CP-10: 状态推断检测规则和修复动作的单元测试
 * 覆盖:
 * - checkReportStatusConsistency (CP-2)
 * - checkCheckpointConsistency (CP-3)
 * - checkMissingPipelineEvidence (CP-4)
 * - fixSingleIssue for report_status_mismatch (CP-6)
 * - fixSingleIssue for checkpoint_status_mismatch (CP-7)
 * - fixSingleIssue for missing_pipeline_evidence (CP-1)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  checkReportStatusConsistency,
  checkCheckpointConsistency,
  checkMissingPipelineEvidence,
} from '../commands/analyze';
import type { TaskMeta, CheckpointMetadata, TaskStatus } from '../types/task';

// ============== 辅助函数 ==============

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-status-inference-test-'));
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

// ============== checkReportStatusConsistency (CP-2) ==============

describe('checkReportStatusConsistency', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when no report directory exists', () => {
    const task = createTask({ status: 'in_progress' });
    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).toBeNull();
  });

  test('returns null when report exists but status is already advanced', () => {
    const task = createTask({ status: 'wait_qa' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'code-review-report.md', 'PASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    // wait_qa is already at or past the implied status for code_review PASS
    expect(result).toBeNull();
  });

  test('returns null for terminal statuses', () => {
    for (const status of ['resolved', 'closed', 'abandoned', 'failed'] as TaskStatus[]) {
      const task = createTask({ status });
      const result = checkReportStatusConsistency(task.id, task, tmpDir);
      expect(result).toBeNull();
    }
  });

  test('detects mismatch: dev-report PASS but task still in_progress', () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'PASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('report_status_mismatch');
    expect(result!.details?.impliedStatus).toBe('wait_review');
    expect(result!.details?.reportFile).toBe('dev-report.md');
  });

  test('detects mismatch: code-review-report PASS but task still wait_review', () => {
    const task = createTask({ status: 'wait_review' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'code-review-report.md', 'PASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('report_status_mismatch');
    expect(result!.details?.impliedStatus).toBe('wait_qa');
  });

  test('detects mismatch: qa-report PASS but task still wait_qa', () => {
    const task = createTask({ status: 'wait_qa' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'qa-report.md', 'PASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('report_status_mismatch');
    expect(result!.details?.impliedStatus).toBe('wait_evaluation');
  });

  test('detects mismatch: review-report PASS but task still wait_evaluation', () => {
    const task = createTask({ status: 'wait_evaluation' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'review-report.md', 'PASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('report_status_mismatch');
    expect(result!.details?.impliedStatus).toBe('resolved');
  });

  test('returns null when report shows NOPASS', () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'NOPASS');

    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).toBeNull();
  });
});

// ============== checkCheckpointConsistency (CP-3) ==============

describe('checkCheckpointConsistency', () => {
  test('returns null for non-resolved tasks', () => {
    const task = createTask({
      status: 'in_progress',
      checkpoints: [
        { id: 'CP-1', description: 'Test', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    });
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).toBeNull();
  });

  test('returns null for resolved task with no checkpoints', () => {
    const task = createTask({ status: 'resolved', checkpoints: [] });
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).toBeNull();
  });

  test('returns null for resolved task with completed checkpoints', () => {
    const task = createTask({
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Test', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    });
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).toBeNull();
  });

  test('detects resolved with all pending checkpoints (legacy)', () => {
    const now = new Date().toISOString();
    const task = createTask({
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Test A', status: 'pending', createdAt: now, updatedAt: now },
        { id: 'CP-2', description: 'Test B', status: 'pending', createdAt: now, updatedAt: now },
        { id: 'CP-3', description: 'Test C', status: 'pending', createdAt: now, updatedAt: now },
      ],
    });
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('checkpoint_status_mismatch');
    expect(result!.details?.totalCheckpoints).toBe(3);
    expect(result!.details?.pendingCheckpoints).toBe(3);
    expect(result!.details?.completedCheckpoints).toBe(0);
  });

  test('returns null for resolved with mixed checkpoint statuses', () => {
    const now = new Date().toISOString();
    const task = createTask({
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Test A', status: 'completed', createdAt: now, updatedAt: now },
        { id: 'CP-2', description: 'Test B', status: 'pending', createdAt: now, updatedAt: now },
      ],
    });
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).toBeNull();
  });

  test('returns null for resolved with undefined checkpoints', () => {
    const task = createTask({ status: 'resolved' });
    delete (task as any).checkpoints;
    const result = checkCheckpointConsistency(task.id, task);
    expect(result).toBeNull();
  });
});

// ============== checkMissingPipelineEvidence (CP-4) ==============

describe('checkMissingPipelineEvidence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null for non-pipeline-intermediate statuses', () => {
    for (const status of ['open', 'in_progress', 'resolved', 'closed', 'abandoned', 'failed'] as TaskStatus[]) {
      const task = createTask({ status });
      const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
      expect(result).toBeNull();
    }
  });

  test('detects wait_review with missing report directory', () => {
    const task = createTask({ status: 'wait_review' });
    const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('missing_pipeline_evidence');
    expect(result!.details?.currentStatus).toBe('wait_review');
    expect(result!.details?.missingReports).toContain('dev-report.md');
    expect(result!.details?.reportDirExists).toBe(false);
    expect(result!.details?.fixAction).toBe('reset_to_open');
  });

  test('detects wait_qa with missing code-review-report', () => {
    const task = createTask({ status: 'wait_qa' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    // No code-review-report.md created

    const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('missing_pipeline_evidence');
    expect(result!.details?.missingReports).toContain('code-review-report.md');
    expect(result!.details?.reportDirExists).toBe(true);
  });

  test('detects wait_evaluation with missing qa-report', () => {
    const task = createTask({ status: 'wait_evaluation' });
    setupProjectWithTask(tmpDir, task);
    createReportDir(tmpDir, task.id);

    const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.details?.missingReports).toContain('qa-report.md');
  });

  test('detects wait_evaluation with missing review-report', () => {
    const task = createTask({ status: 'wait_evaluation' });
    setupProjectWithTask(tmpDir, task);
    createReportDir(tmpDir, task.id);

    const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.details?.missingReports).toContain('review-report.md');
  });

  test('returns null when all required reports exist', () => {
    const task = createTask({ status: 'wait_qa' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'code-review-report.md', 'PASS');

    const result = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(result).toBeNull();
  });
});

// ============== Fix Actions (CP-10) ==============

describe('Fix actions for status inference issues', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    // Initialize .projmnt4claude directory
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.projmnt4claude', 'config.json'),
      JSON.stringify({ analyze: { autoGenerateCheckpoints: true } }),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('report_status_mismatch fix updates task status', async () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'PASS');

    // Create issue
    const issue = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(issue).not.toBeNull();

    // Apply fix
    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const result = await fixSingleIssue(issue!, tmpDir, true);
    expect(result).toBe('fixed');

    // Verify task was updated
    const { readTaskMeta } = await import('../utils/task');
    const updated = readTaskMeta(task.id, tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('wait_review');

    // Verify history entry was added (writeTaskMeta auto-generates with '更新status')
    const lastHistory = updated!.history[updated!.history.length - 1];
    expect(lastHistory?.field).toBe('status');
    expect(lastHistory?.newValue).toBe('wait_review');
  });

  test('checkpoint_status_mismatch fix completes all pending checkpoints', async () => {
    const now = new Date().toISOString();
    const task = createTask({
      status: 'resolved',
      checkpoints: [
        { id: 'CP-1', description: 'Test A', status: 'pending', createdAt: now, updatedAt: now },
        { id: 'CP-2', description: 'Test B', status: 'pending', createdAt: now, updatedAt: now },
      ],
    });
    setupProjectWithTask(tmpDir, task);

    const issue = checkCheckpointConsistency(task.id, task);
    expect(issue).not.toBeNull();

    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const result = await fixSingleIssue(issue!, tmpDir, true);
    expect(result).toBe('fixed');

    const { readTaskMeta } = await import('../utils/task');
    const updated = readTaskMeta(task.id, tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.checkpoints!.every(cp => cp.status === 'completed')).toBe(true);
  });

  test('missing_pipeline_evidence fix resets task to open', async () => {
    const task = createTask({ status: 'wait_qa' });
    setupProjectWithTask(tmpDir, task);
    // No report directory → missing evidence

    const issue = checkMissingPipelineEvidence(task.id, task, tmpDir);
    expect(issue).not.toBeNull();

    const { fixSingleIssue } = await import('../commands/analyze-fix-pipeline');
    const result = await fixSingleIssue(issue!, tmpDir, true);
    expect(result).toBe('fixed');

    const { readTaskMeta } = await import('../utils/task');
    const updated = readTaskMeta(task.id, tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('open');
    expect(updated!.resumeAction).toBe('reset_to_open');
  });

  test('report_status_mismatch fix with NOPASS report does not trigger', async () => {
    const task = createTask({ status: 'in_progress' });
    setupProjectWithTask(tmpDir, task);
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'NOPASS');

    const issue = checkReportStatusConsistency(task.id, task, tmpDir);
    // NOPASS should not create an issue
    expect(issue).toBeNull();
  });

  test('multiple report mismatches: only the first mismatch is reported', () => {
    const task = createTask({ status: 'in_progress' });
    const reportDir = createReportDir(tmpDir, task.id);
    writeReport(reportDir, 'dev-report.md', 'PASS');
    writeReport(reportDir, 'code-review-report.md', 'PASS');

    // Should detect dev-report mismatch first (in_progress should be wait_review at least)
    const result = checkReportStatusConsistency(task.id, task, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.details?.reportFile).toBe('dev-report.md');
  });
});
