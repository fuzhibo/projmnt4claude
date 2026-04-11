import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import {
  classifyExitResult,
  isRetryableError,
  parseStructuredResult,
  parseVerdictResult,
  filterCheckpoints,
  getReportDir,
  getReportPath,
  sleep,
  archiveReportIfExists,
  saveReport,
  runHeadlessClaude,
  runHeadlessClaudeWithRetry,
  DEFAULT_TIMEOUT_SECONDS,
  REVIEW_TIMEOUT_RATIO,
  parseDevReport,
  parseCodeReviewReport,
  parseQAReport,
  rebuildPrerequisiteData,
} from '../utils/harness-helpers.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

// Mock child_process - hoisted before imports that use it
mock.module('child_process', () => ({
  spawn: mock(() => {
    throw new Error('spawn not configured');
  }),
}));

// Get reference to the mocked spawn function
import * as child_process from 'child_process';
const spawnMock = child_process.spawn as any;

// ============================================================
// Helper factories
// ============================================================

function createTestTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: overrides.id || 'TASK-test-001',
    title: 'Test Task',
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

function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: overrides.id || 'CP-001',
    description: overrides.description || 'Test checkpoint',
    status: overrides.status || 'pending',
    createdAt: overrides.createdAt || '2026-04-10T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-10T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================
// Constants
// ============================================================

describe('Constants', () => {
  test('DEFAULT_TIMEOUT_SECONDS is 300', () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(300);
  });

  test('REVIEW_TIMEOUT_RATIO is 3', () => {
    expect(REVIEW_TIMEOUT_RATIO).toBe(3);
  });
});

// ============================================================
// classifyExitResult
// ============================================================

describe('classifyExitResult', () => {
  test('returns success for exit code 0', () => {
    const result = classifyExitResult(0, '', 'some output');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.hookWarning).toBeUndefined();
  });

  test('returns success with hookWarning when hook error has output', () => {
    const stderr = 'SessionEnd hook failed with error';
    const result = classifyExitResult(1, stderr, 'task output');
    expect(result.success).toBe(true);
    expect(result.hookWarning).toContain('Hook 错误已忽略');
  });

  test('returns failure when hook error has no output', () => {
    const stderr = 'Hook cancelled';
    const result = classifyExitResult(1, stderr, '  ');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hook 错误导致无输出');
  });

  test('detects "hook ... failed" pattern', () => {
    const stderr = 'error: hook PreToolUse failed unexpectedly';
    const result = classifyExitResult(1, stderr, 'output');
    expect(result.success).toBe(true);
    expect(result.hookWarning).toBeDefined();
  });

  test('returns failure with stderr for non-hook errors', () => {
    const result = classifyExitResult(1, 'something went wrong', 'output');
    expect(result.success).toBe(false);
    expect(result.error).toBe('something went wrong');
  });

  test('returns exit code when no stderr', () => {
    const result = classifyExitResult(42, '', 'output');
    expect(result.success).toBe(false);
    expect(result.error).toContain('进程退出码: 42');
  });

  test('handles null exit code', () => {
    const result = classifyExitResult(null, '', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('进程退出码: null');
  });

  test('truncates long stderr in hook warning', () => {
    const longStderr = 'x'.repeat(500);
    const result = classifyExitResult(1, `hook something failed: ${longStderr}`, 'output');
    expect(result.success).toBe(true);
    expect(result.hookWarning!.length).toBeLessThan(300);
  });

  test('truncates long stderr in hook failure message', () => {
    const longStderr = 'y'.repeat(500);
    const result = classifyExitResult(1, `Hook cancelled: ${longStderr}`, '');
    expect(result.success).toBe(false);
    expect(result.error!.length).toBeLessThan(300);
  });
});

// ============================================================
// isRetryableError
// ============================================================

describe('isRetryableError', () => {
  test('detects 429 rate limit with future reset time', () => {
    const futureTime = '2099-12-31 23:59:59';
    const output = `API Error: 429 Too Many Requests. Retry after ${futureTime}`;
    const result = isRetryableError(output, '');
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('429');
    expect(result.waitSeconds).toBeGreaterThanOrEqual(60);
  });

  test('detects 429 rate limit in stderr', () => {
    const futureTime = '2099-06-15 12:00:00';
    const result = isRetryableError('', `API Error: 429 rate limited ${futureTime}`);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('429');
  });

  test('429 with past reset time still returns retryable with minimum 60s', () => {
    const pastTime = '2020-01-01 00:00:00';
    const result = isRetryableError(`API Error: 429 ${pastTime}`, '');
    expect(result.retryable).toBe(true);
    expect(result.waitSeconds).toBeGreaterThanOrEqual(60);
  });

  test('detects 500 API error', () => {
    const result = isRetryableError('API Error: 500 Internal Server Error', '');
    expect(result.retryable).toBe(true);
    expect(result.waitSeconds).toBe(30);
    expect(result.reason).toContain('500');
  });

  test('detects 500 in JSON code field', () => {
    const result = isRetryableError('{"code":"500","message":"error"}', '');
    expect(result.retryable).toBe(true);
  });

  test('detects ECONNRESET', () => {
    const result = isRetryableError('Error: ECONNRESET connection reset', '');
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('网络连接错误');
  });

  test('detects ETIMEDOUT', () => {
    const result = isRetryableError('', 'Error: ETIMEDOUT timeout');
    expect(result.retryable).toBe(true);
    expect(result.waitSeconds).toBe(10);
  });

  test('detects ENOTFOUND', () => {
    const result = isRetryableError('Error: ENOTFOUND dns failure', '');
    expect(result.retryable).toBe(true);
  });

  test('detects "network error"', () => {
    const result = isRetryableError('Fatal: network error occurred', '');
    expect(result.retryable).toBe(true);
  });

  test('returns non-retryable for normal output', () => {
    const result = isRetryableError('Task completed successfully', '');
    expect(result.retryable).toBe(false);
  });

  test('returns non-retryable for empty strings', () => {
    const result = isRetryableError('', '');
    expect(result.retryable).toBe(false);
  });
});

// ============================================================
// parseStructuredResult
// ============================================================

describe('parseStructuredResult', () => {
  test('returns null for empty output', () => {
    const result = parseStructuredResult('');
    expect(result.passed).toBeNull();
    expect(result.matchLevel).toBeNull();
  });

  test('returns null for whitespace-only output', () => {
    const result = parseStructuredResult('   \n\t  ');
    expect(result.passed).toBeNull();
    expect(result.matchLevel).toBeNull();
  });

  // Level 1
  test('Level 1: matches EVALUATION_RESULT: PASS', () => {
    const result = parseStructuredResult('Some text\nEVALUATION_RESULT: PASS\nMore text');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(1);
  });

  test('Level 1: matches VERDICT: NOPASS', () => {
    const result = parseStructuredResult('VERDICT: NOPASS');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(1);
  });

  test('Level 1: matches case-insensitively', () => {
    const result = parseStructuredResult('evaluation_result: pass');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(1);
  });

  test('Level 1: matches with Chinese colon', () => {
    const result = parseStructuredResult('EVALUATION_RESULT：PASS');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(1);
  });

  // Level 2
  test('Level 2: matches markdown heading - 评估结果', () => {
    const result = parseStructuredResult('## 评估结果: PASS');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches 审核结果', () => {
    const result = parseStructuredResult('## 审核结果：NOPASS');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches 验证结果', () => {
    const result = parseStructuredResult('## 验证结果: PASS');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches Evaluation Result', () => {
    const result = parseStructuredResult('## Evaluation Result: NOPASS');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches Result label', () => {
    const result = parseStructuredResult('## Result: PASS');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches 审核结果 NOPASS without markdown heading', () => {
    const result = parseStructuredResult('审核结果：NOPASS');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches non-heading Chinese label', () => {
    const result = parseStructuredResult('评估结果：PASS');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches JSON result field with PASS', () => {
    const result = parseStructuredResult('"result": "PASS"');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(2);
  });

  test('Level 2: matches JSON result field with NOPASS', () => {
    const result = parseStructuredResult('"result": "NOPASS"');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(2);
  });

  // Level 3
  test('Level 3: matches standalone PASS keyword', () => {
    const result = parseStructuredResult('The test result is PASS for this check');
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(3);
  });

  test('Level 3: matches standalone NOPASS keyword', () => {
    const result = parseStructuredResult('The check result was NOPASS unfortunately');
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(3);
  });

  // Priority
  test('Level 1 takes priority over Level 2 and 3', () => {
    const output = '## 评估结果: NOPASS\nEVALUATION_RESULT: PASS\nSome PASS keyword';
    const result = parseStructuredResult(output);
    expect(result.passed).toBe(true);
    expect(result.matchLevel).toBe(1);
  });

  test('Level 2 takes priority over Level 3', () => {
    const output = 'Result: NOPASS\nThe test is PASS';
    const result = parseStructuredResult(output);
    expect(result.passed).toBe(false);
    expect(result.matchLevel).toBe(2);
  });

  test('no match when no PASS/NOPASS present', () => {
    const result = parseStructuredResult('Everything looks good, no issues found');
    expect(result.passed).toBeNull();
    expect(result.matchLevel).toBeNull();
  });
});

// ============================================================
// parseVerdictResult
// ============================================================

describe('parseVerdictResult', () => {
  const defaultOptions = {
    resultField: '判定结果',
    reasonField: '原因',
    listField: '问题列表',
    checkpointField: '失败检查点',
  };

  test('parses full structured output with all fields', () => {
    const output = [
      '## 判定结果: PASS',
      '## 原因: All tests passed',
      '## 问题列表: 无',
      '## 失败检查点: 无',
    ].join('\n');
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('All tests passed');
    expect(result.items).toEqual([]);
    expect(result.failedCheckpoints).toEqual([]);
  });

  test('parses NOPASS result with items and checkpoints', () => {
    const output = [
      '## 判定结果: NOPASS',
      '## 原因: Tests failed',
      '## 问题列表:',
      '- Issue 1',
      '- Issue 2',
      '## 失败检查点:',
      '- CP-001',
      '* CP-002',
    ].join('\n');
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Tests failed');
    expect(result.items).toEqual(['Issue 1', 'Issue 2']);
    expect(result.failedCheckpoints).toEqual(['CP-001', 'CP-002']);
  });

  test('treats N/A list as empty', () => {
    const output = [
      '## 判定结果: PASS',
      '## 原因: OK',
      '## 问题列表: N/A',
      '## 失败检查点: 无',
    ].join('\n');
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.items).toEqual([]);
    expect(result.failedCheckpoints).toEqual([]);
  });

  test('parses details field when provided', () => {
    const output = [
      '## 判定结果: PASS',
      '## 原因: OK',
      '## 问题列表: 无',
      '## 失败检查点: 无',
      '## 详细信息: Full details here',
    ].join('\n');
    const result = parseVerdictResult(output, { ...defaultOptions, detailsField: '详细信息' });
    expect(result.details).toBe('Full details here');
  });

  test('details field is empty when options.detailsField not provided', () => {
    const output = [
      '## 判定结果: PASS',
      '## 原因: OK',
      '## 问题列表: 无',
      '## 失败检查点: 无',
    ].join('\n');
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.details).toBe('');
  });

  test('falls back to structured result when no heading match', () => {
    const output = 'EVALUATION_RESULT: PASS';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('结构化关键词匹配');
    expect(result.reason).toContain('级别 1');
  });

  test('falls back with REASON field', () => {
    const output = 'EVALUATION_RESULT: NOPASS\nREASON: Performance regression detected';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Performance regression detected');
  });

  test('falls back with EVALUATION_REASON field', () => {
    const output = 'VERDICT: PASS\nEVALUATION_REASON: Code quality is good';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('Code quality is good');
  });

  test('falls back to reasonField pattern for reason', () => {
    const output = 'VERDICT: NOPASS\n## 原因: Custom reason text';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Custom reason text');
  });

  test('uses default reason when structured result has no reason match', () => {
    const output = 'PASS';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('结构化关键词匹配');
  });

  test('returns default reason when nothing matches', () => {
    const result = parseVerdictResult('No structured output at all', defaultOptions);
    expect(result.reason).toBe('无法解析判定结果');
    expect(result.passed).toBe(true);
  });

  test('parses items with asterisk bullets', () => {
    const output = [
      '## 判定结果: NOPASS',
      '## 原因: Issues found',
      '## 问题列表:',
      '* Item A',
      '* Item B',
      '## 失败检查点: 无',
    ].join('\n');
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.items).toEqual(['Item A', 'Item B']);
  });

  test('REASON captures text until double newline or end', () => {
    const output = 'VERDICT: NOPASS\nREASON: First reason';
    const result = parseVerdictResult(output, defaultOptions);
    expect(result.reason).toBe('First reason');
  });
});

// ============================================================
// filterCheckpoints
// ============================================================

describe('filterCheckpoints', () => {
  test('returns empty array when task has no checkpoints', () => {
    const task = createTestTask();
    expect(filterCheckpoints(task, () => true)).toEqual([]);
  });

  test('returns empty array when checkpoints is undefined', () => {
    const task = createTestTask({ checkpoints: undefined });
    expect(filterCheckpoints(task, () => true)).toEqual([]);
  });

  test('filters checkpoints by predicate', () => {
    const cps = [
      createCheckpoint({ id: 'CP-001', status: 'completed' }),
      createCheckpoint({ id: 'CP-002', status: 'pending' }),
      createCheckpoint({ id: 'CP-003', status: 'failed' }),
    ];
    const task = createTestTask({ checkpoints: cps });
    const result = filterCheckpoints(task, cp => cp.status === 'pending' || cp.status === 'failed');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('CP-002');
    expect(result[1].id).toBe('CP-003');
  });

  test('returns all checkpoints when filter always returns true', () => {
    const cps = [
      createCheckpoint({ id: 'CP-001' }),
      createCheckpoint({ id: 'CP-002' }),
    ];
    const task = createTestTask({ checkpoints: cps });
    expect(filterCheckpoints(task, () => true)).toHaveLength(2);
  });

  test('returns empty when filter always returns false', () => {
    const cps = [createCheckpoint({ id: 'CP-001' })];
    const task = createTestTask({ checkpoints: cps });
    expect(filterCheckpoints(task, () => false)).toHaveLength(0);
  });
});

// ============================================================
// getReportDir / getReportPath
// ============================================================

describe('getReportDir / getReportPath', () => {
  test('getReportDir returns correct path', () => {
    const result = getReportDir('TASK-001', '/project');
    expect(result).toContain('reports');
    expect(result).toContain('harness');
    expect(result).toContain('TASK-001');
  });

  test('getReportPath returns correct path with report type', () => {
    const result = getReportPath('TASK-001', 'review', '/project');
    expect(result).toContain('TASK-001');
    expect(result).toContain('review-report.md');
  });

  test('getReportPath contains getReportDir output', () => {
    const dir = getReportDir('TASK-001', '/project');
    const filePath = getReportPath('TASK-001', 'qa', '/project');
    expect(filePath.startsWith(dir)).toBe(true);
  });
});

// ============================================================
// sleep
// ============================================================

describe('sleep', () => {
  test('resolves after specified seconds', async () => {
    const start = Date.now();
    await sleep(0.01); // 10ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================
// archiveReportIfExists
// ============================================================

describe('archiveReportIfExists', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-archive-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does nothing when file does not exist', () => {
    const reportPath = path.join(tmpDir, 'nonexistent.md');
    expect(() => archiveReportIfExists(reportPath)).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'archive'))).toBe(false);
  });

  test('archives existing file to archive subdirectory', () => {
    const reportPath = path.join(tmpDir, 'report.md');
    fs.writeFileSync(reportPath, 'original content');
    archiveReportIfExists(reportPath);
    const archiveDir = path.join(tmpDir, 'archive');
    expect(fs.existsSync(archiveDir)).toBe(true);
    const files = fs.readdirSync(archiveDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('report.md');
  });

  test('preserves original file content in archive', () => {
    const reportPath = path.join(tmpDir, 'report.md');
    fs.writeFileSync(reportPath, 'my report content');
    archiveReportIfExists(reportPath);
    const archiveDir = path.join(tmpDir, 'archive');
    const files = fs.readdirSync(archiveDir);
    const archivedContent = fs.readFileSync(path.join(archiveDir, files[0]!), 'utf-8');
    expect(archivedContent).toBe('my report content');
  });

  test('original file remains after archiving', () => {
    const reportPath = path.join(tmpDir, 'report.md');
    fs.writeFileSync(reportPath, 'content');
    archiveReportIfExists(reportPath);
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  test('handles archive directory already existing', () => {
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(archiveDir);
    const reportPath = path.join(tmpDir, 'report.md');
    fs.writeFileSync(reportPath, 'content');
    archiveReportIfExists(reportPath);
    const files = fs.readdirSync(archiveDir);
    expect(files).toHaveLength(1);
  });
});

// ============================================================
// saveReport
// ============================================================

describe('saveReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-save-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates parent directories and writes file', async () => {
    const reportPath = path.join(tmpDir, 'a', 'b', 'report.md');
    await saveReport(reportPath, '# Report');
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toBe('# Report');
  });

  test('overwrites existing content', async () => {
    const reportPath = path.join(tmpDir, 'report.md');
    await saveReport(reportPath, 'v1');
    await saveReport(reportPath, 'v2');
    expect(fs.readFileSync(reportPath, 'utf-8')).toBe('v2');
  });

  test('throws on write failure', async () => {
    const readOnlyDir = path.join(tmpDir, 'readonly');
    fs.mkdirSync(readOnlyDir);
    fs.chmodSync(readOnlyDir, 0o444);
    const reportPath = path.join(readOnlyDir, 'sub', 'report.md');
    try {
      await saveReport(reportPath, 'content');
    } catch (error) {
      expect((error as Error).message).toContain('保存报告失败');
    } finally {
      fs.chmodSync(readOnlyDir, 0o755);
    }
  });
});

// ============================================================
// runHeadlessClaude (mocked spawn)
// ============================================================

describe('runHeadlessClaude', () => {
  function setupMockSpawn(options: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    spawnError?: Error;
  }) {
    const child = new EventEmitter() as any;
    child.stdin = { write: (..._args: any[]) => {}, end: () => {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    spawnMock.mockImplementation(() => {
      setTimeout(() => {
        if (options.spawnError) {
          child.emit('error', options.spawnError);
          return;
        }
        if (options.stdout) {
          child.stdout.emit('data', Buffer.from(options.stdout));
        }
        if (options.stderr) {
          child.stderr.emit('data', Buffer.from(options.stderr));
        }
        child.emit('close', options.exitCode ?? 0);
      }, 5);
      return child;
    });

    return child;
  }

  beforeEach(() => {
    spawnMock.mockClear();
  });

  test('returns success on exit code 0', async () => {
    setupMockSpawn({ exitCode: 0, stdout: 'task output' });
    const result = await runHeadlessClaude({
      prompt: 'test prompt',
      allowedTools: ['Read', 'Write'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe('task output');
  });

  test('passes allowed tools and flags to spawn', async () => {
    setupMockSpawn({ exitCode: 0, stdout: '' });
    await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
      dangerouslySkipPermissions: true,
      outputFormat: 'json',
    });
    expect(spawnMock).toHaveBeenCalledWith('claude', expect.arrayContaining([
      '--allowedTools', 'Read',
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'json',
    ]), expect.any(Object));
  });

  test('passes session options to spawn', async () => {
    setupMockSpawn({ exitCode: 0, stdout: '' });
    await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
      sessionId: 'sess-123',
      resumeSession: true,
      forkSession: true,
    });
    expect(spawnMock).toHaveBeenCalledWith('claude', expect.arrayContaining([
      '--session-id', 'sess-123',
      '--resume',
      '--fork-session',
    ]), expect.any(Object));
  });

  test('writes prompt to stdin', async () => {
    const child = setupMockSpawn({ exitCode: 0, stdout: '' });
    // Override stdin.write to track calls
    const writes: string[] = [];
    child.stdin.write = (data: string) => { writes.push(data); };
    child.stdin.end = () => {};
    await runHeadlessClaude({
      prompt: 'hello world',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(writes).toContain('hello world');
  });

  test('returns failure on non-zero exit with stderr', async () => {
    setupMockSpawn({ exitCode: 1, stderr: 'error occurred', stdout: '' });
    const result = await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('error occurred');
  });

  test('handles spawn error gracefully', async () => {
    setupMockSpawn({ spawnError: new Error('command not found') });
    const result = await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('command not found');
    expect(result.output).toBe('');
    expect(result.stderr).toBe('');
  });

  test('includes stderr in result', async () => {
    setupMockSpawn({ exitCode: 0, stderr: 'warning message' });
    const result = await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.stderr).toBe('warning message');
  });

  test('handles hook error with output as success', async () => {
    setupMockSpawn({
      exitCode: 1,
      stderr: 'SessionEnd hook failed',
      stdout: 'actual output',
    });
    const result = await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.success).toBe(true);
    expect(result.hookWarning).toBeDefined();
  });

  test('handles synchronous spawn throw', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn crashed');
    });
    const result = await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('spawn crashed');
  });

  test('does not pass session flags when not provided', async () => {
    setupMockSpawn({ exitCode: 0, stdout: '' });
    await runHeadlessClaude({
      prompt: 'test',
      allowedTools: ['Read'],
      timeout: 30,
      cwd: '/tmp',
    });
    const callArgs = spawnMock.mock.calls[0] as [string, string[], any];
    const args = callArgs[1];
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--fork-session');
  });
});

// ============================================================
// runHeadlessClaudeWithRetry
// ============================================================

describe('runHeadlessClaudeWithRetry', () => {
  function setupMockSpawnSequence(results: Array<{
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  }>) {
    let callIndex = 0;
    spawnMock.mockImplementation(() => {
      const opts = results[Math.min(callIndex, results.length - 1)];
      callIndex++;
      const child = new EventEmitter() as any;
      child.stdin = { write: (..._args: any[]) => {}, end: () => {} };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
        if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
        child.emit('close', opts.exitCode ?? 0);
      }, 5);
      return child;
    });
  }

  beforeEach(() => {
    spawnMock.mockClear();
  });

  test('returns success on first attempt', async () => {
    setupMockSpawnSequence([{ exitCode: 0, stdout: 'done' }]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 3, baseDelay: 0.01 },
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('done');
  });

  test('retries on 500 error and succeeds', async () => {
    setupMockSpawnSequence([
      { exitCode: 1, stdout: 'API Error: 500 server error', stderr: '' },
      { exitCode: 0, stdout: 'success', stderr: '' },
    ]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 3, baseDelay: 0.01 },
    );
    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  test('retries on network error and succeeds', async () => {
    setupMockSpawnSequence([
      { exitCode: 1, stdout: 'ECONNRESET connection lost', stderr: '' },
      { exitCode: 0, stdout: 'recovered', stderr: '' },
    ]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 2, baseDelay: 0.01 },
    );
    expect(result.success).toBe(true);
  });

  test('stops retrying on non-retryable error', async () => {
    setupMockSpawnSequence([
      { exitCode: 1, stdout: 'syntax error in code', stderr: '' },
    ]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 3, baseDelay: 0.01 },
    );
    expect(result.success).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test('returns last failure after max attempts exhausted', async () => {
    setupMockSpawnSequence([
      { exitCode: 1, stdout: 'API Error: 500 first', stderr: '' },
      { exitCode: 1, stdout: 'API Error: 500 second', stderr: '' },
      { exitCode: 1, stdout: 'API Error: 500 final', stderr: '' },
    ]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 2, baseDelay: 0.01 }, // first + 2 retries = 3 total
    );
    expect(result.success).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  test('retries on 429 rate limit', async () => {
    const futureTime = '2099-12-31 23:59:59';
    setupMockSpawnSequence([
      { exitCode: 1, stdout: `API Error: 429 ${futureTime}`, stderr: '' },
      { exitCode: 0, stdout: 'success', stderr: '' },
    ]);
    const result = await runHeadlessClaudeWithRetry(
      { prompt: 'test', allowedTools: ['Read'], timeout: 30, cwd: '/tmp' },
      { maxAttempts: 3, baseDelay: 0.01 },
    );
    expect(result.success).toBe(true);
  });
});

// ============================================================
// parseDevReport
// ============================================================

describe('parseDevReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-dev-report-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses normal dev-report.md', () => {
    const report = [
      '# 开发报告 - TASK-test-001',
      '',
      '**状态**: success',
      '**开始时间**: 2026-04-08T05:18:59.074Z',
      '**结束时间**: 2026-04-08T05:22:07.174Z',
      '**耗时**: 188.1s',
      '',
      '## 完成的检查点',
      '- CP-1',
      '- CP-2',
      '',
      '## 证据文件',
      '- src/foo.ts',
      '- src/bar.ts',
      '',
      '## Claude 输出',
      '```',
      'done',
      '```',
    ].join('\n');
    const filePath = path.join(tmpDir, 'dev-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseDevReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('TASK-test-001');
    expect(result!.status).toBe('success');
    expect(result!.duration).toBe(188100);
    expect(result!.startTime).toBe('2026-04-08T05:18:59.074Z');
    expect(result!.endTime).toBe('2026-04-08T05:22:07.174Z');
    expect(result!.checkpointsCompleted).toEqual(['CP-1', 'CP-2']);
    expect(result!.evidence).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(result!.error).toBeUndefined();
  });

  test('parses failed dev-report with error', () => {
    const report = [
      '# 开发报告 - TASK-test-002',
      '',
      '**状态**: failed',
      '**开始时间**: 2026-04-08T05:00:00.000Z',
      '**结束时间**: 2026-04-08T05:01:30.000Z',
      '**耗时**: 90.0s',
      '',
      '## 错误信息',
      'Build failed: TypeScript compilation error',
    ].join('\n');
    const filePath = path.join(tmpDir, 'dev-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseDevReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('failed');
    expect(result!.error).toBe('Build failed: TypeScript compilation error');
    expect(result!.checkpointsCompleted).toEqual([]);
    expect(result!.evidence).toEqual([]);
  });

  test('parses dev-report with empty checkpoint/evidence sections', () => {
    const report = [
      '# 开发报告 - TASK-test-003',
      '',
      '**状态**: success',
      '**开始时间**: 2026-04-08T05:00:00.000Z',
      '**结束时间**: 2026-04-08T05:01:00.000Z',
      '**耗时**: 60.0s',
      '',
      '## 完成的检查点',
      '- (无)',
      '',
      '## 证据文件',
      '无',
    ].join('\n');
    const filePath = path.join(tmpDir, 'dev-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseDevReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.checkpointsCompleted).toEqual([]);
    expect(result!.evidence).toEqual([]);
  });

  test('returns null for non-existent file', () => {
    const result = parseDevReport(path.join(tmpDir, 'nonexistent.md'));
    expect(result).toBeNull();
  });

  test('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'dev-report.md');
    fs.writeFileSync(filePath, '');
    const result = parseDevReport(filePath);
    expect(result).toBeNull();
  });

  test('returns null for whitespace-only file', () => {
    const filePath = path.join(tmpDir, 'dev-report.md');
    fs.writeFileSync(filePath, '   \n\t\n   ');
    const result = parseDevReport(filePath);
    expect(result).toBeNull();
  });
});

// ============================================================
// parseCodeReviewReport
// ============================================================

describe('parseCodeReviewReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-cr-report-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses PASS code review report', () => {
    const report = [
      '# 代码审核报告 - TASK-test-001',
      '',
      '**结果**: ✅ PASS',
      '**审核时间**: 2026-04-08T05:22:07.182Z',
      '**审核者**: code_reviewer',
      '',
      '## 原因',
      'Code looks good, all checks pass.',
      '',
      '## 代码质量问题',
      '- (无)',
      '',
      '## 未通过的检查点',
      '- (无)',
    ].join('\n');
    const filePath = path.join(tmpDir, 'code-review-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseCodeReviewReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('TASK-test-001');
    expect(result!.result).toBe('PASS');
    expect(result!.reason).toContain('Code looks good');
    expect(result!.failedCheckpoints).toEqual([]);
  });

  test('parses NOPASS code review report with failed checkpoints', () => {
    const report = [
      '# 代码审核报告 - TASK-test-002',
      '',
      '**结果**: ❌ NOPASS',
      '**审核时间**: 2026-04-08T05:22:07.182Z',
      '**审核者**: code_reviewer',
      '',
      '## 原因',
      'Code quality issues found.',
      '',
      '## 未通过的检查点',
      '- CP-1',
      '- CP-3',
      '',
      '## 详细反馈',
      'Detailed feedback here.',
    ].join('\n');
    const filePath = path.join(tmpDir, 'code-review-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseCodeReviewReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.result).toBe('NOPASS');
    expect(result!.failedCheckpoints).toEqual(['CP-1', 'CP-3']);
    expect(result!.details).toBe('Detailed feedback here.');
  });

  test('returns null for non-existent file', () => {
    const result = parseCodeReviewReport(path.join(tmpDir, 'nonexistent.md'));
    expect(result).toBeNull();
  });

  test('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'code-review-report.md');
    fs.writeFileSync(filePath, '');
    const result = parseCodeReviewReport(filePath);
    expect(result).toBeNull();
  });

  test('returns null when result field is missing', () => {
    const report = [
      '# 代码审核报告 - TASK-test-003',
      '',
      '**审核时间**: 2026-04-08T05:22:07.182Z',
      '',
      '## 原因',
      'Some reason',
    ].join('\n');
    const filePath = path.join(tmpDir, 'code-review-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseCodeReviewReport(filePath);
    expect(result).toBeNull();
  });
});

// ============================================================
// parseQAReport
// ============================================================

describe('parseQAReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-qa-report-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses PASS QA report', () => {
    const report = [
      '# QA 验证报告 - TASK-test-001',
      '',
      '**结果**: ✅ PASS',
      '**验证时间**: 2026-04-08T05:24:03.284Z',
      '**验证者**: qa_tester',
      '**需要人工验证**: 否',
      '',
      '## 原因',
      'All tests pass.',
      '',
      '## 测试失败',
      '- (无)',
      '',
      '## 未通过的检查点',
      '- (无)',
    ].join('\n');
    const filePath = path.join(tmpDir, 'qa-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseQAReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('TASK-test-001');
    expect(result!.result).toBe('PASS');
    expect(result!.reason).toContain('All tests pass');
    expect(result!.failedCheckpoints).toEqual([]);
  });

  test('parses NOPASS QA report with failures', () => {
    const report = [
      '# QA 验证报告 - TASK-test-002',
      '',
      '**结果**: ❌ NOPASS',
      '**验证时间**: 2026-04-08T05:30:00.000Z',
      '**验证者**: qa_tester',
      '**需要人工验证**: 是',
      '',
      '## 原因',
      'Some tests failed.',
      '',
      '## 测试失败',
      '- Test suite A failed',
      '',
      '## 未通过的检查点',
      '- CP-QA-1',
    ].join('\n');
    const filePath = path.join(tmpDir, 'qa-report.md');
    fs.writeFileSync(filePath, report);
    const result = parseQAReport(filePath);
    expect(result).not.toBeNull();
    expect(result!.result).toBe('NOPASS');
    expect(result!.failedCheckpoints).toEqual(['CP-QA-1']);
  });

  test('returns null for non-existent file', () => {
    const result = parseQAReport(path.join(tmpDir, 'nonexistent.md'));
    expect(result).toBeNull();
  });

  test('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'qa-report.md');
    fs.writeFileSync(filePath, '');
    const result = parseQAReport(filePath);
    expect(result).toBeNull();
  });
});

// ============================================================
// rebuildPrerequisiteData
// ============================================================

describe('rebuildPrerequisiteData', () => {
  let tmpDir: string;
  let reportDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-prereq-'));
    reportDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', 'TASK-test-001');
    fs.mkdirSync(reportDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDevReport(): void {
    const report = [
      '# 开发报告 - TASK-test-001',
      '',
      '**状态**: success',
      '**开始时间**: 2026-04-08T05:00:00.000Z',
      '**结束时间**: 2026-04-08T05:01:00.000Z',
      '**耗时**: 60.0s',
      '',
      '## 完成的检查点',
      '- CP-1',
    ].join('\n');
    fs.writeFileSync(path.join(reportDir, 'dev-report.md'), report);
  }

  function writeCodeReviewReport(): void {
    const report = [
      '# 代码审核报告 - TASK-test-001',
      '',
      '**结果**: ✅ PASS',
      '**审核时间**: 2026-04-08T05:02:00.000Z',
      '**审核者**: code_reviewer',
      '',
      '## 原因',
      'Code review passed.',
      '',
      '## 未通过的检查点',
      '- (无)',
    ].join('\n');
    fs.writeFileSync(path.join(reportDir, 'code-review-report.md'), report);
  }

  function writeQAReport(): void {
    const report = [
      '# QA 验证报告 - TASK-test-001',
      '',
      '**结果**: ✅ PASS',
      '**验证时间**: 2026-04-08T05:03:00.000Z',
      '**验证者**: qa_tester',
      '**需要人工验证**: 否',
      '',
      '## 原因',
      'QA passed.',
      '',
      '## 未通过的检查点',
      '- (无)',
    ].join('\n');
    fs.writeFileSync(path.join(reportDir, 'qa-report.md'), report);
  }

  test('development phase returns null prerequisites', () => {
    const result = rebuildPrerequisiteData('TASK-test-001', 'development', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.devReport).toBeNull();
    expect(result!.codeReviewVerdict).toBeNull();
    expect(result!.qaVerdict).toBeNull();
  });

  test('code_review phase requires only dev-report', () => {
    writeDevReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'code_review', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.devReport).not.toBeNull();
    expect(result!.devReport!.status).toBe('success');
    expect(result!.codeReviewVerdict).toBeNull();
    expect(result!.qaVerdict).toBeNull();
  });

  test('code_review phase returns null when dev-report is missing', () => {
    const result = rebuildPrerequisiteData('TASK-test-001', 'code_review', tmpDir);
    expect(result).toBeNull();
  });

  test('qa phase requires dev-report and code-review-report', () => {
    writeDevReport();
    writeCodeReviewReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'qa', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.devReport).not.toBeNull();
    expect(result!.codeReviewVerdict).not.toBeNull();
    expect(result!.codeReviewVerdict!.result).toBe('PASS');
    expect(result!.qaVerdict).toBeNull();
  });

  test('qa phase returns null when code-review-report is missing', () => {
    writeDevReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'qa', tmpDir);
    expect(result).toBeNull();
  });

  test('evaluation phase requires all three reports', () => {
    writeDevReport();
    writeCodeReviewReport();
    writeQAReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'evaluation', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.devReport).not.toBeNull();
    expect(result!.codeReviewVerdict).not.toBeNull();
    expect(result!.qaVerdict).not.toBeNull();
    expect(result!.qaVerdict!.result).toBe('PASS');
  });

  test('evaluation phase returns null when qa-report is missing', () => {
    writeDevReport();
    writeCodeReviewReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'evaluation', tmpDir);
    expect(result).toBeNull();
  });

  test('unknown phase returns null', () => {
    writeDevReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'unknown_phase', tmpDir);
    expect(result).toBeNull();
  });

  test('qa_verification alias works like qa', () => {
    writeDevReport();
    writeCodeReviewReport();
    const result = rebuildPrerequisiteData('TASK-test-001', 'qa_verification', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.codeReviewVerdict).not.toBeNull();
  });

  test('non-existent task returns null', () => {
    const result = rebuildPrerequisiteData('TASK-nonexistent-999', 'code_review', tmpDir);
    expect(result).toBeNull();
  });
});
