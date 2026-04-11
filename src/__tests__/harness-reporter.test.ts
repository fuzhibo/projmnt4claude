import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarnessReporter } from '../utils/harness-reporter.js';
import { saveReport, archiveReportIfExists } from '../utils/harness-helpers.js';
import type {
  HarnessConfig,
  ExecutionSummary,
  TaskExecutionRecord,
  ReviewVerdict,
  DevReport,
  SprintContract,
} from '../types/harness.js';
import {
  createDefaultSprintContract,
  createDefaultDevReport,
  createDefaultExecutionRecord,
} from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';

function createTestTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: overrides.id || 'TASK-bug-P2-test-task-20260410',
    title: 'Test task title for harness reporter',
    description: 'Test description',
    type: overrides.type || 'feature',
    priority: overrides.priority || 'P2',
    status: overrides.status || 'in_progress',
    dependencies: overrides.dependencies || [],
    createdAt: overrides.createdAt || '2026-04-10T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-10T00:00:00.000Z',
    history: overrides.history || [],
    ...overrides,
  };
}

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 300,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd,
    apiRetryAttempts: 3,
    apiRetryDelay: 60,
    batchGitCommit: false,
  };
}

function createTestRecord(overrides: Partial<TaskExecutionRecord> = {}): TaskExecutionRecord {
  const task = createTestTask();
  const record = createDefaultExecutionRecord(task);
  return { ...record, ...overrides };
}

function createTestSummary(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  const config = createTestConfig('/tmp');
  return {
    totalTasks: 2,
    passed: 1,
    failed: 1,
    totalRetries: 0,
    duration: 5000,
    startTime: '2026-04-10T10:00:00.000Z',
    endTime: '2026-04-10T10:00:05.000Z',
    taskResults: new Map(),
    config,
    ...overrides,
  };
}

// ============== formatSummaryReport ==============

describe('HarnessReporter: formatSummaryReport', () => {
  let tmpDir: string;
  let reporter: HarnessReporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reporter-test-'));
    reporter = new HarnessReporter(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('includes statistics overview with correct values', () => {
    const summary = createTestSummary({ totalTasks: 3, passed: 2, failed: 1, totalRetries: 1, duration: 10000 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('总任务数 | 3');
    expect(report).toContain('通过 | 2');
    expect(report).toContain('失败 | 1');
    expect(report).toContain('重试次数 | 1');
    expect(report).toContain('10.0s');
  });

  test('calculates pass rate correctly', () => {
    const summary = createTestSummary({ totalTasks: 4, passed: 3, failed: 1 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('75.0%');
  });

  test('handles zero totalTasks without division by zero', () => {
    const summary = createTestSummary({ totalTasks: 0, passed: 0, failed: 0, duration: 0 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('通过率');
    expect(report).toContain('0%');
  });

  test('shows all-pass conclusion when no failures', () => {
    const summary = createTestSummary({ totalTasks: 2, passed: 2, failed: 0 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('所有任务执行成功');
  });

  test('shows partial failure conclusion', () => {
    const summary = createTestSummary({ totalTasks: 3, passed: 1, failed: 2 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('部分任务失败');
    expect(report).toContain('1/3');
  });

  test('shows total failure conclusion when all failed', () => {
    const summary = createTestSummary({ totalTasks: 2, passed: 0, failed: 2 });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('所有任务执行失败');
  });

  test('includes execution config as JSON', () => {
    const summary = createTestSummary();
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('"maxRetries": 3');
    expect(report).toContain('"timeout": 300');
  });

  test('groups passed and failed tasks correctly', () => {
    const passedRecord = createTestRecord();
    passedRecord.reviewVerdict = {
      taskId: 'TASK-1',
      result: 'PASS',
      reason: 'ok',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: '2026-04-10T00:00:00.000Z',
      reviewedBy: 'evaluator',
    };

    const failedRecord = createTestRecord({ taskId: 'TASK-2', task: createTestTask({ id: 'TASK-2' }) });
    failedRecord.devReport.status = 'failed';
    failedRecord.devReport.error = 'timeout';

    const taskResults = new Map<string, TaskExecutionRecord>();
    taskResults.set('TASK-1', passedRecord);
    taskResults.set('TASK-2', failedRecord);

    const summary = createTestSummary({ taskResults });
    const report = (reporter as any).formatSummaryReport(summary);
    expect(report).toContain('通过的任务');
    expect(report).toContain('失败的任务');
    expect(report).toContain('TASK-bug-P2-test-task-20260410');
    expect(report).toContain('TASK-2');
  });
});

// ============== formatTaskOverview ==============

describe('HarnessReporter: formatTaskOverview', () => {
  let tmpDir: string;
  let reporter: HarnessReporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-task-overview-'));
    reporter = new HarnessReporter(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('includes task metadata (title, type, priority, status)', () => {
    const record = createTestRecord();
    const overview = (reporter as any).formatTaskOverview(record);
    expect(overview).toContain('Test task title for harness reporter');
    expect(overview).toContain('feature');
    expect(overview).toContain('P2');
  });

  test('includes review verdict when present', () => {
    const record = createTestRecord();
    record.reviewVerdict = {
      taskId: 'TASK-1',
      result: 'NOPASS',
      reason: 'missing tests',
      failedCriteria: ['All tests must pass'],
      failedCheckpoints: ['CP-1'],
      reviewedAt: '2026-04-10T00:00:00.000Z',
      reviewedBy: 'evaluator',
    };
    const overview = (reporter as any).formatTaskOverview(record);
    expect(overview).toContain('NOPASS');
    expect(overview).toContain('missing tests');
    expect(overview).toContain('未满足的标准');
    expect(overview).toContain('All tests must pass');
    expect(overview).toContain('未完成的检查点');
    expect(overview).toContain('CP-1');
  });

  test('omits review section when no reviewVerdict', () => {
    const record = createTestRecord();
    record.reviewVerdict = undefined;
    const overview = (reporter as any).formatTaskOverview(record);
    expect(overview).not.toContain('审查阶段');
  });

  test('includes timeline entries', () => {
    const record = createTestRecord();
    record.timeline = [
      { timestamp: '2026-04-10T10:00:00.000Z', event: 'started', description: 'Task started' },
      { timestamp: '2026-04-10T10:01:00.000Z', event: 'completed', description: 'Task completed' },
    ];
    const overview = (reporter as any).formatTaskOverview(record);
    expect(overview).toContain('执行时间线');
    expect(overview).toContain('Task started');
    expect(overview).toContain('Task completed');
  });

  test('includes sprint contract with acceptance criteria and checkpoints', () => {
    const record = createTestRecord();
    record.contract.acceptanceCriteria = ['AC-1: Must work', 'AC-2: Must be fast'];
    record.contract.checkpoints = ['CP-1', 'CP-2'];
    const overview = (reporter as any).formatTaskOverview(record);
    expect(overview).toContain('验收标准');
    expect(overview).toContain('AC-1: Must work');
    expect(overview).toContain('检查点');
    expect(overview).toContain('CP-1');
  });
});

// ============== generateJSONSummary ==============

describe('HarnessReporter: generateJSONSummary', () => {
  let tmpDir: string;
  let reporter: HarnessReporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-json-summary-'));
    reporter = new HarnessReporter(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('produces valid JSON with correct fields', () => {
    const summary = createTestSummary();
    const json = reporter.generateJSONSummary(summary);
    const parsed = JSON.parse(json);
    expect(parsed.totalTasks).toBe(2);
    expect(parsed.passed).toBe(1);
    expect(parsed.failed).toBe(1);
    expect(parsed.duration).toBe(5000);
    expect(parsed.startTime).toBe('2026-04-10T10:00:00.000Z');
    expect(parsed.endTime).toBe('2026-04-10T10:00:05.000Z');
  });

  test('calculates pass rate correctly', () => {
    const summary = createTestSummary({ totalTasks: 4, passed: 3, failed: 1 });
    const json = reporter.generateJSONSummary(summary);
    const parsed = JSON.parse(json);
    expect(parsed.passRate).toBe('75.0%');
  });

  test('handles zero tasks gracefully', () => {
    const summary = createTestSummary({ totalTasks: 0, passed: 0, failed: 0 });
    const json = reporter.generateJSONSummary(summary);
    const parsed = JSON.parse(json);
    expect(parsed.passRate).toBe('0%');
  });

  test('includes per-task summaries with review results', () => {
    const record = createTestRecord();
    record.reviewVerdict = {
      taskId: 'TASK-1',
      result: 'PASS',
      reason: 'all good',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: '2026-04-10T00:00:00.000Z',
      reviewedBy: 'evaluator',
    };
    const taskResults = new Map<string, TaskExecutionRecord>();
    taskResults.set('TASK-1', record);
    const summary = createTestSummary({ taskResults });
    const json = reporter.generateJSONSummary(summary);
    const parsed = JSON.parse(json);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].taskId).toBe('TASK-bug-P2-test-task-20260410');
    expect(parsed.tasks[0].reviewResult).toBe('PASS');
    expect(parsed.tasks[0].reviewReason).toBe('all good');
  });
});

// ============== generateSummaryReport (file write) ==============

describe('HarnessReporter: generateSummaryReport', () => {
  let tmpDir: string;
  let reporter: HarnessReporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-summary-write-'));
    reporter = new HarnessReporter(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes summary report file to disk', async () => {
    const summary = createTestSummary({ totalTasks: 1, passed: 1, failed: 0 });
    await reporter.generateSummaryReport(summary);

    const reportsDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness');
    expect(fs.existsSync(reportsDir)).toBe(true);

    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('summary-') && f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8');
    expect(content).toContain('Harness Design 执行摘要');
    expect(content).toContain('总任务数 | 1');
  });
});

// ============== generateTaskReport (file write) ==============

describe('HarnessReporter: generateTaskReport', () => {
  let tmpDir: string;
  let reporter: HarnessReporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-task-report-'));
    reporter = new HarnessReporter(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes overview.md in task report directory', async () => {
    const record = createTestRecord();
    await reporter.generateTaskReport(record);

    const taskDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', record.taskId);
    expect(fs.existsSync(taskDir)).toBe(true);

    const overviewPath = path.join(taskDir, 'overview.md');
    expect(fs.existsSync(overviewPath)).toBe(true);

    const content = fs.readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('任务概览');
    expect(content).toContain(record.taskId);
  });
});

// ============== saveReport (harness-helpers) ==============

describe('saveReport (harness-helpers)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-save-report-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates directory and writes report file', async () => {
    const reportPath = path.join(tmpDir, 'reports', 'test-report.md');
    await saveReport(reportPath, '# Test Report\nHello world');
    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('# Test Report');
  });

  test('overwrites existing report file', async () => {
    const reportPath = path.join(tmpDir, 'report.md');
    await saveReport(reportPath, 'version 1');
    await saveReport(reportPath, 'version 2');
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toBe('version 2');
  });

  test('archives previous report when overwriting', async () => {
    const reportPath = path.join(tmpDir, 'report.md');
    await saveReport(reportPath, 'original content');
    await saveReport(reportPath, 'new content');

    const archiveDir = path.join(tmpDir, 'archive');
    expect(fs.existsSync(archiveDir)).toBe(true);
    const archivedFiles = fs.readdirSync(archiveDir);
    expect(archivedFiles.length).toBe(1);
    expect(archivedFiles[0]!.endsWith('-report.md')).toBe(true);

    const archivedContent = fs.readFileSync(path.join(archiveDir, archivedFiles[0]!), 'utf-8');
    expect(archivedContent).toBe('original content');
  });

  test('creates nested directories as needed', async () => {
    const reportPath = path.join(tmpDir, 'a', 'b', 'c', 'deep-report.md');
    await saveReport(reportPath, 'deep content');
    expect(fs.existsSync(reportPath)).toBe(true);
  });
});
