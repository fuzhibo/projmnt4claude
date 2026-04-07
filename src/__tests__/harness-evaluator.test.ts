import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarnessEvaluator } from '../utils/harness-evaluator.js';
import type { SprintContract, DevReport, HarnessConfig } from '../types/harness.js';
import { createDefaultSprintContract, createDefaultDevReport } from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';

// Helper to create a minimal valid TaskMeta for testing
function createTestTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: overrides.id || 'TASK-bug-P2-test-task-20260403',
    title: 'Test task',
    description: 'Test description',
    type: overrides.type || 'feature',
    priority: overrides.priority || 'P2',
    status: overrides.status || 'in_progress',
    dependencies: overrides.dependencies || [],
    createdAt: overrides.createdAt || '2026-04-03T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-03T00:00:00.000Z',
    history: overrides.history || [],
    ...overrides,
  };
}

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 1,
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

// ============== loadContract validation = ==============

describe('BUG-013-1: loadContract validation', () => {
  let tmpDir: string;
  let evaluator: HarnessEvaluator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-test-'));
    const tasksDir = path.join(tmpDir, '.projmnt4claude', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  function writeContract(taskId: string, data: unknown) {
    const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'contract.json'), JSON.stringify(data));
  }
  test('should return null when contract file does not exist', () => {
    const result = (evaluator as any).loadContract('TASK-nonexistent');
    expect(result).toBeNull();
  });
  test('should load valid contract with all fields', () => {
    writeContract('TASK-test-1', {
      taskId: 'TASK-test-1',
      acceptanceCriteria: ['AC-1', 'AC-2'],
      verificationCommands: ['npm test'],
      checkpoints: ['CP-1', 'CP-2'],
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });
    const result = (evaluator as any).loadContract('TASK-test-1');
    expect(result).not.toBeNull();
    expect(result.taskId).toBe('TASK-test-1');
    expect(result.acceptanceCriteria).toEqual(['AC-1', 'AC-2']);
    expect(result.verificationCommands).toEqual(['npm test']);
    expect(result.checkpoints).toEqual(['CP-1', 'CP-2']);
  });
  test('should normalize contract with empty arrays when file has empty fields', () => {
    writeContract('TASK-empty-arrays', {
      taskId: 'TASK-empty-arrays',
      acceptanceCriteria: [],
      verificationCommands: [],
      checkpoints: [],
    });
    const result = (evaluator as any).loadContract('TASK-empty-arrays');
    expect(result).not.toBeNull();
    expect(result.acceptanceCriteria).toEqual([]);
    expect(result.verificationCommands).toEqual([]);
    expect(result.checkpoints).toEqual([]);
  });
  test('should normalize empty object {} to valid contract with defaults', () => {
    writeContract('TASK-empty-obj', {});
    const result = (evaluator as any).loadContract('TASK-empty-obj');
    // Empty object is valid: taskId falls back to param, other fields get defaults
    expect(result).not.toBeNull();
    expect(result.taskId).toBe('TASK-empty-obj');
    expect(result.acceptanceCriteria).toEqual([]);
  });
  test('should return null for null', () => {
    writeContract('TASK-null', null);
    const result = (evaluator as any).loadContract('TASK-null');
    expect(result).toBeNull();
  });
  test('should return null for string', () => {
    writeContract('TASK-string', '"hello"');
    const result = (evaluator as any).loadContract('TASK-string');
    expect(result).toBeNull();
  });
  test('should return null for number', () => {
    writeContract('TASK-number', '42');
    const result = (evaluator as any).loadContract('TASK-number');
    expect(result).toBeNull();
  });
  test('should return null for array', () => {
    writeContract('TASK-array', '[1,2,3]');
    const result = (evaluator as any).loadContract('TASK-array');
    expect(result).toBeNull();
  });
  test('should return null for invalid JSON', () => {
    const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', 'TASK-bad-json');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'contract.json'), '{not valid json');
    const result = (evaluator as any).loadContract('TASK-bad-json');
    expect(result).toBeNull();
  });
  test('should return null for non-string taskId', () => {
    writeContract('TASK-bad-taskid', { taskId: 12345 });
    const result = (evaluator as any).loadContract('TASK-bad-taskid');
    expect(result).toBeNull();
  });
  test('should normalize non-array fields to empty arrays', () => {
    writeContract('TASK-bad-arrays', {
      taskId: 'TASK-bad-arrays',
      acceptanceCriteria: 'not an array',
      verificationCommands: null,
      checkpoints: 123,
    });
    const result = (evaluator as any).loadContract('TASK-bad-arrays');
    expect(result).not.toBeNull();
    expect(result.acceptanceCriteria).toEqual([]);
    expect(result.verificationCommands).toEqual([]);
    expect(result.checkpoints).toEqual([]);
  });
  test('should filter non-string elements from arrays', () => {
    writeContract('TASK-mixed-array', {
      taskId: 'TASK-mixed-array',
      acceptanceCriteria: ['valid', 123, true, 'also valid'],
      verificationCommands: [1, 2, 3],
      checkpoints: ['cp-1', null, 'cp-2'],
    });
    const result = (evaluator as any).loadContract('TASK-mixed-array');
    expect(result).not.toBeNull();
    expect(result.acceptanceCriteria).toEqual(['valid', 'also valid']);
    expect(result.verificationCommands).toEqual([]);
    expect(result.checkpoints).toEqual(['cp-1', 'cp-2']);
  });
  test('should provide defaults for missing timestamps', () => {
    writeContract('TASK-no-time', { taskId: 'TASK-no-time' });
    const result = (evaluator as any).loadContract('TASK-no-time');
    expect(result).not.toBeNull();
    expect(new Date(result.createdAt).getTime()).not.toBeNaN();
    expect(new Date(result.updatedAt).getTime()).not.toBeNaN();
  });
  test('should use fallback taskId when missing', () => {
    writeContract('TASK-no-taskid-field', {});
    const result = (evaluator as any).loadContract('TASK-no-taskid-field');
    expect(result).not.toBeNull();
    expect(result.taskId).toBe('TASK-no-taskid-field');
  });
});

// ============== buildEvaluationPrompt defensive handling = ==============

describe('BUG-013-1: buildEvaluationPrompt defensive array handling', () => {
  let tmpDir: string;
  let evaluator: HarnessEvaluator;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-test-'));
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  test('should not crash when contract.checkpoints is undefined', () => {
    const task = createTestTask();
    const devReport = createDefaultDevReport(task.id);
    const contract = { ...createDefaultSprintContract(task.id), checkpoints: undefined as any };
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should not crash when contract.acceptanceCriteria is undefined', () => {
    const task = createTestTask();
    const devReport = createDefaultDevReport(task.id);
    const contract = { ...createDefaultSprintContract(task.id), acceptanceCriteria: undefined as any };
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should not crash when contract.verificationCommands is undefined', () => {
    const task = createTestTask();
    const devReport = createDefaultDevReport(task.id);
    const contract = { ...createDefaultSprintContract(task.id), verificationCommands: undefined as any };
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should not crash when devReport.evidence is undefined', () => {
    const task = createTestTask();
    const devReport = { ...createDefaultDevReport(task.id), evidence: undefined as any };
    const contract = createDefaultSprintContract(task.id);
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should not crash when devReport.checkpointsCompleted is undefined', () => {
    const task = createTestTask();
    const devReport = { ...createDefaultDevReport(task.id), checkpointsCompleted: undefined as any };
    const contract = createDefaultSprintContract(task.id);
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should not crash when all arrays are undefined simultaneously', () => {
    const task = createTestTask();
    const devReport = {
      ...createDefaultDevReport(task.id),
      evidence: undefined as any,
      checkpointsCompleted: undefined as any,
    };
    const contract = {
      ...createDefaultSprintContract(task.id),
      acceptanceCriteria: undefined as any,
      verificationCommands: undefined as any,
      checkpoints: undefined as any,
    };
    expect(() => {
      (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    }).not.toThrow();
  });
  test('should produce valid prompt with undefined arrays', () => {
    const task = createTestTask();
    const devReport = {
      ...createDefaultDevReport(task.id),
      evidence: undefined as any,
      checkpointsCompleted: undefined as any,
    };
    const contract = {
      ...createDefaultSprintContract(task.id),
      checkpoints: undefined as any,
    };
    const prompt = (evaluator as any).buildEvaluationPrompt(task, devReport, contract);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('架构评估任务');
  });
});

// ============== createDefaultSprintContract ==============

describe('createDefaultSprintContract', () => {
  test('should create contract with empty arrays', () => {
    const contract = createDefaultSprintContract('TASK-test');
    expect(contract.taskId).toBe('TASK-test');
    expect(contract.acceptanceCriteria).toEqual([]);
    expect(contract.verificationCommands).toEqual([]);
    expect(contract.checkpoints).toEqual([]);
    expect(contract.createdAt).toBeTruthy();
    expect(contract.updatedAt).toBeTruthy();
  });
});

// ============== BUG-013-3: parseEvaluationResult inference type tracking = ==============

describe('BUG-013-3: parseEvaluationResult inference type tracking', () => {
  let evaluator: HarnessEvaluator;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-inference-'));
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });

  function parse(output: string) {
    return (evaluator as any).parseEvaluationResult(output);
  }

  // --- Level 1: EVALUATION_RESULT structured format ---

  test('should return structured_match for EVALUATION_RESULT: PASS', () => {
    const result = parse(
      'EVALUATION_RESULT: PASS\n' +
      'EVALUATION_REASON: 所有验收标准已满足\n' +
      '## 评估结果: PASS\n' +
      '## 原因: 所有验收标准已满足\n' +
      '## 后续动作: resolve\n'
    );
    expect(result.passed).toBe(true);
    expect(result.inferenceType).toBe('structured_match');
  });

  test('should return structured_match for EVALUATION_RESULT: NOPASS', () => {
    const result = parse(
      'EVALUATION_RESULT: NOPASS\n' +
      'EVALUATION_REASON: 缺少单元测试\n' +
      '## 评估结果: NOPASS\n' +
      '## 原因: 缺少单元测试\n' +
      '## 后续动作: redevelop\n'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('structured_match');
  });

  // --- Level 2: Markdown heading format (backward compatible) ---

  test('should return explicit_match for standard ## 评估结果: PASS format', () => {
    const result = parse(
      '## 评估结果: PASS\n' +
      '## 原因: 所有验收标准已满足\n' +
      '## 后续动作: resolve\n' +
      '## 失败分类: \n' +
      '## 未满足的标准: \n' +
      '## 未完成的检查点: \n' +
      '## 详细反馈: 实现完整。'
    );
    expect(result.passed).toBe(true);
    expect(result.inferenceType).toBe('explicit_match');
  });

  test('should return explicit_match for standard ## 评估结果: NOPASS format', () => {
    const result = parse(
      '## 评估结果: NOPASS\n' +
      '## 原因: 缺少单元测试\n' +
      '## 后续动作: redevelop\n' +
      '## 失败分类: test_failure\n' +
      '## 未满足的标准: - 所有测试通过\n' +
      '## 未完成的检查点: - CP-1\n' +
      '## 详细反馈: 无测试'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('explicit_match');
  });

  test('should return explicit_match for loose format "Evaluation Result: PASS"', () => {
    const result = parse('Evaluation Result: PASS\nAll criteria met.');
    expect(result.passed).toBe(true);
    expect(result.inferenceType).toBe('explicit_match');
  });

  test('should return explicit_match for JSON format', () => {
    const result = parse('{"result": "PASS", "reason": "ok"}');
    expect(result.passed).toBe(true);
    expect(result.inferenceType).toBe('explicit_match');
  });

  // --- Level 3: PASS/NOPASS keyword ---

  test('should return explicit_match for bare PASS keyword', () => {
    const result = parse('The task is PASS. Everything looks good.');
    expect(result.passed).toBe(true);
    expect(result.inferenceType).toBe('explicit_match');
  });

  // --- No match: Chinese-only output without PASS/NOPASS ---

  test('should return parse_failure_default for Chinese-only positive text without PASS/NOPASS', () => {
    const result = parse(
      '经过审查，所有验收标准均已满足，实现完整正确，代码质量良好。'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('parse_failure_default');
  });

  test('should return parse_failure_default for Chinese-only negative text without PASS/NOPASS', () => {
    const result = parse(
      '实现未通过审查，存在多个问题，不符合验收标准。'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('parse_failure_default');
  });

  // --- No contradiction detection (removed Chinese sentiment analysis) ---

  test('should NOT auto-correct NOPASS to PASS based on Chinese sentiment (contradiction detection removed)', () => {
    // Previously: contradiction detection would auto-correct to PASS
    // Now: respects the explicit NOPASS from ## 评估结果: NOPASS
    const result = parse(
      '## 评估结果: NOPASS\n' +
      '## 原因: 代码质量满足要求\n' +
      '所有功能均已实现，代码正确完整，零错误。'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('explicit_match');
  });

  // --- Unparseable output ---

  test('should return parse_failure_default for completely unparseable output', () => {
    const result = parse(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
    );
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('parse_failure_default');
    expect(result.reason).toContain('无法解析');
  });

  test('should return parse_failure_default for text with "passed" (not PASS keyword)', () => {
    // "passed" does not match \bPASS\b (word boundary regex)
    const result = parse('The code passed the review successfully.');
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('parse_failure_default');
  });

  test('should return parse_failure_default for Chinese positive keyword without PASS/NOPASS', () => {
    const result = parse('审查通过，实现良好。');
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('parse_failure_default');
  });

  test('should always have inferenceType set (never undefined)', () => {
    const outputs = [
      '## 评估结果: PASS\n## 原因: ok',
      '不通过，未满足标准',
      'random gibberish text',
      '## 评估结果: NOPASS\n## 原因: bad\n但实际内容全是正向评价，满足所有标准',
    ];
    for (const output of outputs) {
      const result = parse(output);
      expect(result.inferenceType).toBeDefined();
      expect(typeof result.inferenceType).toBe('string');
      expect(result.inferenceType.length).toBeGreaterThan(0);
    }
  });
});

// ============== BUG-013-3: formatReviewReport includes inference type = ==============

describe('BUG-013-3: formatReviewReport inference type annotation', () => {
  let tmpDir: string;
  let evaluator: HarnessEvaluator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-report-'));
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('should include inference type in review report', () => {
    const verdict = {
      taskId: 'TASK-test',
      result: 'PASS' as const,
      reason: 'All criteria met',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: '2026-04-03T00:00:00.000Z',
      reviewedBy: 'harness-evaluator',
      inferenceType: 'explicit_match' as const,
    };
    const devReport = createDefaultDevReport('TASK-test');
    devReport.status = 'success';
    devReport.duration = 1000;

    const report = (evaluator as any).formatReviewReport(verdict, devReport);
    expect(report).toContain('推断类型');
    expect(report).toContain('explicit_match');
    expect(report).toContain('明确匹配');
  });

  test('should include different inference type labels correctly', () => {
    const types = [
      { type: 'structured_match', label: '结构化匹配' },
      { type: 'explicit_match', label: '明确匹配' },
      { type: 'content_inference', label: '内容推断' },
      { type: 'prior_stage_inference', label: '前置阶段推断' },
      { type: 'parse_failure_default', label: '解析失败默认' },
      { type: 'empty_output', label: '空输出' },
    ];
    for (const { type, label } of types) {
      const verdict = {
        taskId: 'TASK-test',
        result: 'NOPASS' as const,
        reason: 'test',
        failedCriteria: [],
        failedCheckpoints: [],
        reviewedAt: '2026-04-03T00:00:00.000Z',
        reviewedBy: 'harness-evaluator',
        inferenceType: type,
      };
      const devReport = createDefaultDevReport('TASK-test');
      devReport.status = 'success';
      devReport.duration = 1000;

      const report = (evaluator as any).formatReviewReport(verdict, devReport);
      expect(report).toContain(label);
      expect(report).toContain(type);
    }
  });

  test('should not include inference type section when not set', () => {
    const verdict = {
      taskId: 'TASK-test',
      result: 'NOPASS' as const,
      reason: 'dev failed',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: '2026-04-03T00:00:00.000Z',
      reviewedBy: 'harness-evaluator',
    };
    const devReport = createDefaultDevReport('TASK-test');
    devReport.status = 'failed';
    devReport.duration = 1000;

    const report = (evaluator as any).formatReviewReport(verdict, devReport);
    expect(report).not.toContain('推断类型');
  });
});

// ============== BUG-013-1: formatReviewReport defensive array handling = ==============

describe('BUG-013-1: formatReviewReport defensive array handling', () => {
  let tmpDir: string;
  let evaluator: HarnessEvaluator;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-report-def-'));
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeVerdict() {
    return {
      taskId: 'TASK-test',
      result: 'PASS' as const,
      reason: 'ok',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: '2026-04-03T00:00:00.000Z',
      reviewedBy: 'harness-evaluator',
    };
  }

  test('should not crash when devReport.evidence is undefined', () => {
    const devReport = { ...createDefaultDevReport('TASK-test'), evidence: undefined as any };
    expect(() => {
      (evaluator as any).formatReviewReport(makeVerdict(), devReport);
    }).not.toThrow();
  });

  test('should not crash when devReport.checkpointsCompleted is undefined', () => {
    const devReport = { ...createDefaultDevReport('TASK-test'), checkpointsCompleted: undefined as any };
    expect(() => {
      (evaluator as any).formatReviewReport(makeVerdict(), devReport);
    }).not.toThrow();
  });

  test('should not crash when both arrays are undefined', () => {
    const devReport = {
      ...createDefaultDevReport('TASK-test'),
      evidence: undefined as any,
      checkpointsCompleted: undefined as any,
    };
    expect(() => {
      (evaluator as any).formatReviewReport(makeVerdict(), devReport);
    }).not.toThrow();
  });

  test('should report 0 evidence count when evidence is undefined', () => {
    const devReport = { ...createDefaultDevReport('TASK-test'), evidence: undefined as any };
    const report = (evaluator as any).formatReviewReport(makeVerdict(), devReport);
    expect(report).toContain('证据数量: 0');
  });

  test('should report 0 checkpoints when checkpointsCompleted is undefined', () => {
    const devReport = { ...createDefaultDevReport('TASK-test'), checkpointsCompleted: undefined as any };
    const report = (evaluator as any).formatReviewReport(makeVerdict(), devReport);
    expect(report).toContain('完成检查点: 0');
  });
});

// ============== BUG-017: 空输出检测 + 日志持久化 ==============

describe('BUG-017: 空输出检测与日志持久化', () => {
  let tmpDir: string;
  let evaluator: HarnessEvaluator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-empty-'));
    fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
    evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parse(output: string) {
    return (evaluator as any).parseEvaluationResult(output);
  }

  // --- parseEvaluationResult: empty input handling ---

  test('should return empty_output inference type for empty string', () => {
    const result = parse('');
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('empty_output');
    expect(result.reason).toContain('为空');
  });

  test('should return empty_output inference type for whitespace-only string', () => {
    const result = parse('   \n\t  \n  ');
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('empty_output');
    expect(result.reason).toContain('为空');
  });

  test('should return empty_output inference type for null-like input', () => {
    const result = parse(null as any);
    expect(result.passed).toBe(false);
    expect(result.inferenceType).toBe('empty_output');
  });

  test('should NOT return empty_output for valid output', () => {
    const result = parse('## 评估结果: PASS\n## 原因: ok');
    expect(result.inferenceType).not.toBe('empty_output');
  });

  // --- saveRawEvaluationOutput: file persistence ---

  test('should save raw evaluation output to file', () => {
    (evaluator as any).saveRawEvaluationOutput(
      'TASK-test-raw',
      'test output content from Claude',
      'some stderr info',
      true
    );

    const reportsDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', 'TASK-test-raw');
    expect(fs.existsSync(reportsDir)).toBe(true);

    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('evaluation-raw-'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8');
    expect(content).toContain('test output content from Claude');
    expect(content).toContain('some stderr info');
    expect(content).toContain('TASK-test-raw');
    expect(content).toContain('Success: true');
  });

  test('should save raw output with empty stdout and error stderr', () => {
    (evaluator as any).saveRawEvaluationOutput(
      'TASK-test-empty-raw',
      '',
      'Error: Claude process killed by SIGTERM',
      false
    );

    const reportsDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', 'TASK-test-empty-raw');
    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('evaluation-raw-'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8');
    expect(content).toContain('(empty)');
    expect(content).toContain('Claude process killed by SIGTERM');
    expect(content).toContain('Success: false');
    expect(content).toContain('Output length: 0');
  });

  test('should not throw when save directory creation fails gracefully', () => {
    // saveRawEvaluationOutput should silently catch errors
    expect(() => {
      (evaluator as any).saveRawEvaluationOutput(
        'TASK/test\0invalid',
        'output',
        '',
        true
      );
    }).not.toThrow();
  });

  // --- runEvaluationSession return type includes stderr ---

  test('runEvaluationSession return type should include stderr field', () => {
    // Verify the method signature accepts and propagates stderr
    const method = (evaluator as any).runEvaluationSession;
    expect(typeof method).toBe('function');
    // The return type is enforced at compile time; we verify the method exists
  });
});
