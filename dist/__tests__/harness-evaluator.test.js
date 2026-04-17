import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarnessEvaluator } from '../utils/harness-evaluator.js';
import { createDefaultSprintContract, createDefaultDevReport } from '../types/harness.js';
// Helper to create a minimal valid TaskMeta for testing
function createTestTask(overrides = {}) {
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
function createTestConfig(cwd) {
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
    let tmpDir;
    let evaluator;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-test-'));
        const tasksDir = path.join(tmpDir, '.projmnt4claude', 'tasks');
        fs.mkdirSync(tasksDir, { recursive: true });
        evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    function writeContract(taskId, data) {
        const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'contract.json'), JSON.stringify(data));
    }
    test('should return null when contract file does not exist', () => {
        const result = evaluator.loadContract('TASK-nonexistent');
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
        const result = evaluator.loadContract('TASK-test-1');
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
        const result = evaluator.loadContract('TASK-empty-arrays');
        expect(result).not.toBeNull();
        expect(result.acceptanceCriteria).toEqual([]);
        expect(result.verificationCommands).toEqual([]);
        expect(result.checkpoints).toEqual([]);
    });
    test('should normalize empty object {} to valid contract with defaults', () => {
        writeContract('TASK-empty-obj', {});
        const result = evaluator.loadContract('TASK-empty-obj');
        // Empty object is valid: taskId falls back to param, other fields get defaults
        expect(result).not.toBeNull();
        expect(result.taskId).toBe('TASK-empty-obj');
        expect(result.acceptanceCriteria).toEqual([]);
    });
    test('should return null for null', () => {
        writeContract('TASK-null', null);
        const result = evaluator.loadContract('TASK-null');
        expect(result).toBeNull();
    });
    test('should return null for string', () => {
        writeContract('TASK-string', '"hello"');
        const result = evaluator.loadContract('TASK-string');
        expect(result).toBeNull();
    });
    test('should return null for number', () => {
        writeContract('TASK-number', '42');
        const result = evaluator.loadContract('TASK-number');
        expect(result).toBeNull();
    });
    test('should return null for array', () => {
        writeContract('TASK-array', '[1,2,3]');
        const result = evaluator.loadContract('TASK-array');
        expect(result).toBeNull();
    });
    test('should return null for invalid JSON', () => {
        const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', 'TASK-bad-json');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'contract.json'), '{not valid json');
        const result = evaluator.loadContract('TASK-bad-json');
        expect(result).toBeNull();
    });
    test('should return null for non-string taskId', () => {
        writeContract('TASK-bad-taskid', { taskId: 12345 });
        const result = evaluator.loadContract('TASK-bad-taskid');
        expect(result).toBeNull();
    });
    test('should normalize non-array fields to empty arrays', () => {
        writeContract('TASK-bad-arrays', {
            taskId: 'TASK-bad-arrays',
            acceptanceCriteria: 'not an array',
            verificationCommands: null,
            checkpoints: 123,
        });
        const result = evaluator.loadContract('TASK-bad-arrays');
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
        const result = evaluator.loadContract('TASK-mixed-array');
        expect(result).not.toBeNull();
        expect(result.acceptanceCriteria).toEqual(['valid', 'also valid']);
        expect(result.verificationCommands).toEqual([]);
        expect(result.checkpoints).toEqual(['cp-1', 'cp-2']);
    });
    test('should provide defaults for missing timestamps', () => {
        writeContract('TASK-no-time', { taskId: 'TASK-no-time' });
        const result = evaluator.loadContract('TASK-no-time');
        expect(result).not.toBeNull();
        expect(new Date(result.createdAt).getTime()).not.toBeNaN();
        expect(new Date(result.updatedAt).getTime()).not.toBeNaN();
    });
    test('should use fallback taskId when missing', () => {
        writeContract('TASK-no-taskid-field', {});
        const result = evaluator.loadContract('TASK-no-taskid-field');
        expect(result).not.toBeNull();
        expect(result.taskId).toBe('TASK-no-taskid-field');
    });
});
// ============== buildEvaluationPrompt defensive handling = ==============
describe('BUG-013-1: buildEvaluationPrompt defensive array handling', () => {
    let tmpDir;
    let evaluator;
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
        const contract = { ...createDefaultSprintContract(task.id), checkpoints: undefined };
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should not crash when contract.acceptanceCriteria is undefined', () => {
        const task = createTestTask();
        const devReport = createDefaultDevReport(task.id);
        const contract = { ...createDefaultSprintContract(task.id), acceptanceCriteria: undefined };
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should not crash when contract.verificationCommands is undefined', () => {
        const task = createTestTask();
        const devReport = createDefaultDevReport(task.id);
        const contract = { ...createDefaultSprintContract(task.id), verificationCommands: undefined };
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should not crash when devReport.evidence is undefined', () => {
        const task = createTestTask();
        const devReport = { ...createDefaultDevReport(task.id), evidence: undefined };
        const contract = createDefaultSprintContract(task.id);
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should not crash when devReport.checkpointsCompleted is undefined', () => {
        const task = createTestTask();
        const devReport = { ...createDefaultDevReport(task.id), checkpointsCompleted: undefined };
        const contract = createDefaultSprintContract(task.id);
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should not crash when all arrays are undefined simultaneously', () => {
        const task = createTestTask();
        const devReport = {
            ...createDefaultDevReport(task.id),
            evidence: undefined,
            checkpointsCompleted: undefined,
        };
        const contract = {
            ...createDefaultSprintContract(task.id),
            acceptanceCriteria: undefined,
            verificationCommands: undefined,
            checkpoints: undefined,
        };
        expect(() => {
            evaluator.buildEvaluationPrompt(task, devReport, contract);
        }).not.toThrow();
    });
    test('should produce valid prompt with undefined arrays', () => {
        const task = createTestTask();
        const devReport = {
            ...createDefaultDevReport(task.id),
            evidence: undefined,
            checkpointsCompleted: undefined,
        };
        const contract = {
            ...createDefaultSprintContract(task.id),
            checkpoints: undefined,
        };
        const prompt = evaluator.buildEvaluationPrompt(task, devReport, contract);
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
    let evaluator;
    beforeEach(() => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-inference-'));
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
        evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
    });
    function parse(output) {
        return evaluator.parseEvaluationResult(output);
    }
    // --- Level 1: EVALUATION_RESULT structured format ---
    test('should return structured_match for EVALUATION_RESULT: PASS', () => {
        const result = parse('EVALUATION_RESULT: PASS\n' +
            'EVALUATION_REASON: 所有验收标准已满足\n' +
            '## 评估结果: PASS\n' +
            '## 原因: 所有验收标准已满足\n' +
            '## 后续动作: resolve\n');
        expect(result.passed).toBe(true);
        expect(result.inferenceType).toBe('structured_match');
    });
    test('should return structured_match for EVALUATION_RESULT: NOPASS', () => {
        const result = parse('EVALUATION_RESULT: NOPASS\n' +
            'EVALUATION_REASON: 缺少单元测试\n' +
            '## 评估结果: NOPASS\n' +
            '## 原因: 缺少单元测试\n' +
            '## 后续动作: redevelop\n');
        expect(result.passed).toBe(false);
        expect(result.inferenceType).toBe('structured_match');
    });
    // --- Level 2: Markdown heading format (backward compatible) ---
    test('should return explicit_match for standard ## 评估结果: PASS format', () => {
        const result = parse('## 评估结果: PASS\n' +
            '## 原因: 所有验收标准已满足\n' +
            '## 后续动作: resolve\n' +
            '## 失败分类: \n' +
            '## 未满足的标准: \n' +
            '## 未完成的检查点: \n' +
            '## 详细反馈: 实现完整。');
        expect(result.passed).toBe(true);
        expect(result.inferenceType).toBe('explicit_match');
    });
    test('should return explicit_match for standard ## 评估结果: NOPASS format', () => {
        const result = parse('## 评估结果: NOPASS\n' +
            '## 原因: 缺少单元测试\n' +
            '## 后续动作: redevelop\n' +
            '## 失败分类: test_failure\n' +
            '## 未满足的标准: - 所有测试通过\n' +
            '## 未完成的检查点: - CP-1\n' +
            '## 详细反馈: 无测试');
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
        const result = parse('经过审查，所有验收标准均已满足，实现完整正确，代码质量良好。');
        expect(result.passed).toBe(false);
        expect(result.inferenceType).toBe('parse_failure_default');
    });
    test('should return parse_failure_default for Chinese-only negative text without PASS/NOPASS', () => {
        const result = parse('实现未通过审查，存在多个问题，不符合验收标准。');
        expect(result.passed).toBe(false);
        expect(result.inferenceType).toBe('parse_failure_default');
    });
    // --- No contradiction detection (removed Chinese sentiment analysis) ---
    test('should NOT auto-correct NOPASS to PASS based on Chinese sentiment (contradiction detection removed)', () => {
        // Previously: contradiction detection would auto-correct to PASS
        // Now: respects the explicit NOPASS from ## 评估结果: NOPASS
        const result = parse('## 评估结果: NOPASS\n' +
            '## 原因: 代码质量满足要求\n' +
            '所有功能均已实现，代码正确完整，零错误。');
        expect(result.passed).toBe(false);
        expect(result.inferenceType).toBe('explicit_match');
    });
    // --- Unparseable output ---
    test('should return parse_failure_default for completely unparseable output', () => {
        const result = parse('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
            'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.');
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
    let tmpDir;
    let evaluator;
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
            result: 'PASS',
            reason: 'All criteria met',
            failedCriteria: [],
            failedCheckpoints: [],
            reviewedAt: '2026-04-03T00:00:00.000Z',
            reviewedBy: 'harness-evaluator',
            inferenceType: 'explicit_match',
        };
        const devReport = createDefaultDevReport('TASK-test');
        devReport.status = 'success';
        devReport.duration = 1000;
        const report = evaluator.formatReviewReport(verdict, devReport);
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
                result: 'NOPASS',
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
            const report = evaluator.formatReviewReport(verdict, devReport);
            expect(report).toContain(label);
            expect(report).toContain(type);
        }
    });
    test('should not include inference type section when not set', () => {
        const verdict = {
            taskId: 'TASK-test',
            result: 'NOPASS',
            reason: 'dev failed',
            failedCriteria: [],
            failedCheckpoints: [],
            reviewedAt: '2026-04-03T00:00:00.000Z',
            reviewedBy: 'harness-evaluator',
        };
        const devReport = createDefaultDevReport('TASK-test');
        devReport.status = 'failed';
        devReport.duration = 1000;
        const report = evaluator.formatReviewReport(verdict, devReport);
        expect(report).not.toContain('推断类型');
    });
});
// ============== BUG-013-1: formatReviewReport defensive array handling = ==============
describe('BUG-013-1: formatReviewReport defensive array handling', () => {
    let tmpDir;
    let evaluator;
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
            result: 'PASS',
            reason: 'ok',
            failedCriteria: [],
            failedCheckpoints: [],
            reviewedAt: '2026-04-03T00:00:00.000Z',
            reviewedBy: 'harness-evaluator',
        };
    }
    test('should not crash when devReport.evidence is undefined', () => {
        const devReport = { ...createDefaultDevReport('TASK-test'), evidence: undefined };
        expect(() => {
            evaluator.formatReviewReport(makeVerdict(), devReport);
        }).not.toThrow();
    });
    test('should not crash when devReport.checkpointsCompleted is undefined', () => {
        const devReport = { ...createDefaultDevReport('TASK-test'), checkpointsCompleted: undefined };
        expect(() => {
            evaluator.formatReviewReport(makeVerdict(), devReport);
        }).not.toThrow();
    });
    test('should not crash when both arrays are undefined', () => {
        const devReport = {
            ...createDefaultDevReport('TASK-test'),
            evidence: undefined,
            checkpointsCompleted: undefined,
        };
        expect(() => {
            evaluator.formatReviewReport(makeVerdict(), devReport);
        }).not.toThrow();
    });
    test('should report 0 evidence count when evidence is undefined', () => {
        const devReport = { ...createDefaultDevReport('TASK-test'), evidence: undefined };
        const report = evaluator.formatReviewReport(makeVerdict(), devReport);
        expect(report).toContain('证据数量: 0');
    });
    test('should report 0 checkpoints when checkpointsCompleted is undefined', () => {
        const devReport = { ...createDefaultDevReport('TASK-test'), checkpointsCompleted: undefined };
        const report = evaluator.formatReviewReport(makeVerdict(), devReport);
        expect(report).toContain('完成检查点: 0');
    });
});
// ============== BUG-017: 空输出检测 + 日志持久化 ==============
describe('BUG-017: 空输出检测与日志持久化', () => {
    let tmpDir;
    let evaluator;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-empty-'));
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
        evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    function parse(output) {
        return evaluator.parseEvaluationResult(output);
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
        const result = parse(null);
        expect(result.passed).toBe(false);
        expect(result.inferenceType).toBe('empty_output');
    });
    test('should NOT return empty_output for valid output', () => {
        const result = parse('## 评估结果: PASS\n## 原因: ok');
        expect(result.inferenceType).not.toBe('empty_output');
    });
    // --- saveRawEvaluationOutput: file persistence ---
    test('should save raw evaluation output to file', () => {
        evaluator.saveRawEvaluationOutput('TASK-test-raw', 'test output content from Claude', 'some stderr info', true);
        const reportsDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', 'TASK-test-raw');
        expect(fs.existsSync(reportsDir)).toBe(true);
        const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('evaluation-raw-'));
        expect(files.length).toBe(1);
        const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
        expect(content).toContain('test output content from Claude');
        expect(content).toContain('some stderr info');
        expect(content).toContain('TASK-test-raw');
        expect(content).toContain('Success: true');
    });
    test('should save raw output with empty stdout and error stderr', () => {
        evaluator.saveRawEvaluationOutput('TASK-test-empty-raw', '', 'Error: Claude process killed by SIGTERM', false);
        const reportsDir = path.join(tmpDir, '.projmnt4claude', 'reports', 'harness', 'TASK-test-empty-raw');
        const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('evaluation-raw-'));
        expect(files.length).toBe(1);
        const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
        expect(content).toContain('(empty)');
        expect(content).toContain('Claude process killed by SIGTERM');
        expect(content).toContain('Success: false');
        expect(content).toContain('Output length: 0');
    });
    test('should not throw when save directory creation fails gracefully', () => {
        // saveRawEvaluationOutput should silently catch errors
        expect(() => {
            evaluator.saveRawEvaluationOutput('TASK/test\0invalid', 'output', '', true);
        }).not.toThrow();
    });
    // runEvaluationSession was replaced by createSessionAwareEngine integration
    // The stderr field is now propagated through EngineResult.result.stderr
});
// ============== P-2: detectPhantomTasks with plan snapshot ==============
describe('P-2: detectPhantomTasks with plan snapshot', () => {
    let tmpDir;
    let evaluator;
    const runsDir = () => path.join(tmpDir, '.projmnt4claude', 'runs');
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phantom-test-'));
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude', 'tasks'), { recursive: true });
        fs.mkdirSync(runsDir(), { recursive: true });
        evaluator = new HarnessEvaluator(createTestConfig(tmpDir));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // Helper to create a task with specific createdAt
    function createTaskFile(taskId, createdAt, status = 'pending') {
        const taskDir = path.join(tmpDir, '.projmnt4claude', 'tasks', taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        const taskMeta = {
            id: taskId,
            title: `Test ${taskId}`,
            description: 'Test task',
            type: 'feature',
            priority: 'P2',
            status,
            dependencies: [],
            createdAt,
            updatedAt: createdAt,
            history: [],
        };
        fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(taskMeta, null, 2));
        return taskMeta;
    }
    // Helper to create a plan snapshot
    function createPlanSnapshot(tasks, timestamp) {
        const pid = process.pid;
        const ts = timestamp || Date.now();
        const snapshotId = `harness-plan-snapshot-${pid}-${ts}.json`;
        const snapshotPath = path.join(runsDir(), snapshotId);
        const snapshot = {
            snapshotId,
            pid,
            timestamp: new Date(ts).toISOString(),
            path: snapshotPath,
            tasks,
            batches: [tasks],
            batchBoundaries: tasks.length > 0 ? [0, tasks.length] : [0],
            batchLabels: ['Batch 1'],
            batchParallelizable: [false],
            sourcePlanPath: path.join(tmpDir, '.projmnt4claude', 'current-plan.json'),
            taskStatusSnapshot: tasks.reduce((acc, tid) => { acc[tid] = 'pending'; return acc; }, {}),
        };
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
        return snapshot;
    }
    // Helper to create dev report with specific time window
    function createDevReportWithWindow(taskId, startTime, endTime) {
        return {
            taskId,
            status: 'success',
            changes: [],
            evidence: [],
            checkpointsCompleted: [],
            startTime,
            endTime,
            duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
            claudeOutput: '',
        };
    }
    test('CP-1: should exclude tasks in plan snapshot from phantom detection (snapshot mode)', () => {
        const currentTaskId = 'TASK-current';
        const plannedTaskId = 'TASK-planned-in-window';
        const unplannedTaskId = 'TASK-unplanned-in-window';
        // Setup: current task and two tasks created during dev window
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        const inWindowTime = '2026-04-12T15:15:00.000Z';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        createTaskFile(plannedTaskId, inWindowTime); // In plan + in window
        createTaskFile(unplannedTaskId, inWindowTime); // Not in plan + in window
        // Create plan snapshot including plannedTaskId but NOT unplannedTaskId
        createPlanSnapshot([currentTaskId, plannedTaskId]);
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        // Execute
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // Assert: plannedTaskId should be excluded, unplannedTaskId should be detected
        expect(phantomTasks).not.toContain(plannedTaskId);
        expect(phantomTasks).toContain(unplannedTaskId);
        expect(phantomTasks.length).toBe(1);
    });
    test('CP-2: should detect tasks using time window when snapshot not available (fallback mode)', () => {
        const currentTaskId = 'TASK-current';
        const taskInWindow = 'TASK-in-window';
        const taskOutsideWindow = 'TASK-outside-window';
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        createTaskFile(taskInWindow, '2026-04-12T15:15:00.000Z'); // In window
        createTaskFile(taskOutsideWindow, '2026-04-12T16:00:00.000Z'); // Outside window
        // No snapshot created - should use fallback mode
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // In fallback mode, taskInWindow should be detected
        expect(phantomTasks).toContain(taskInWindow);
        expect(phantomTasks).not.toContain(taskOutsideWindow);
        expect(phantomTasks.length).toBe(1);
    });
    test('CP-3: should respect 60-second tolerance boundary', () => {
        const currentTaskId = 'TASK-current';
        // Tasks at exact boundaries (±60s)
        const taskAtStartBoundary = 'TASK-start-boundary';
        const taskAtEndBoundary = 'TASK-end-boundary';
        const taskJustOutsideStart = 'TASK-outside-start';
        const taskJustOutsideEnd = 'TASK-outside-end';
        const devStart = '2026-04-12T15:00:00.000Z'; // 15:00:00
        const devEnd = '2026-04-12T15:30:00.000Z'; // 15:30:00
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        // 14:59:00 = start - 60s (at boundary - should be included in fallback)
        createTaskFile(taskAtStartBoundary, '2026-04-12T14:59:00.000Z');
        // 15:31:00 = end + 60s (at boundary - should be included in fallback)
        createTaskFile(taskAtEndBoundary, '2026-04-12T15:31:00.000Z');
        // 14:58:59 = start - 61s (just outside - should NOT be detected)
        createTaskFile(taskJustOutsideStart, '2026-04-12T14:58:59.000Z');
        // 15:31:01 = end + 61s (just outside - should NOT be detected)
        createTaskFile(taskJustOutsideEnd, '2026-04-12T15:31:01.000Z');
        // No snapshot - fallback mode
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // At boundary - should be detected
        expect(phantomTasks).toContain(taskAtStartBoundary);
        expect(phantomTasks).toContain(taskAtEndBoundary);
        // Just outside boundary - should NOT be detected
        expect(phantomTasks).not.toContain(taskJustOutsideStart);
        expect(phantomTasks).not.toContain(taskJustOutsideEnd);
    });
    test('should always exclude current task from phantom detection', () => {
        const currentTaskId = 'TASK-current-created-in-window';
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        const inWindowTime = '2026-04-12T15:15:00.000Z';
        // Current task created in the dev window
        createTaskFile(currentTaskId, inWindowTime);
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // Current task should never be in phantom list
        expect(phantomTasks).not.toContain(currentTaskId);
        expect(phantomTasks.length).toBe(0);
    });
    test('should exclude all planned tasks even if created during dev window', () => {
        const currentTaskId = 'TASK-current';
        const plannedTasks = [];
        const unplannedTasks = [];
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        const inWindowTime = '2026-04-12T15:15:00.000Z';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        // Create 5 planned tasks and 3 unplanned tasks, all in window
        for (let i = 0; i < 5; i++) {
            const tid = `TASK-planned-${i}`;
            plannedTasks.push(tid);
            createTaskFile(tid, inWindowTime);
        }
        for (let i = 0; i < 3; i++) {
            const tid = `TASK-unplanned-${i}`;
            unplannedTasks.push(tid);
            createTaskFile(tid, inWindowTime);
        }
        // Create snapshot with only planned tasks
        createPlanSnapshot([currentTaskId, ...plannedTasks]);
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // All planned tasks should be excluded
        for (const tid of plannedTasks) {
            expect(phantomTasks).not.toContain(tid);
        }
        // All unplanned tasks should be detected
        for (const tid of unplannedTasks) {
            expect(phantomTasks).toContain(tid);
        }
        expect(phantomTasks.length).toBe(3);
    });
    test('should handle empty plan snapshot', () => {
        const currentTaskId = 'TASK-current';
        const otherTask = 'TASK-other';
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        const inWindowTime = '2026-04-12T15:15:00.000Z';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        createTaskFile(otherTask, inWindowTime);
        // Create empty plan snapshot
        createPlanSnapshot([currentTaskId]); // Only current task in plan
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // otherTask should be detected as phantom (not in plan)
        expect(phantomTasks).toContain(otherTask);
        expect(phantomTasks.length).toBe(1);
    });
    test('should handle corrupt snapshot gracefully (fallback mode)', () => {
        const currentTaskId = 'TASK-current';
        const taskInWindow = 'TASK-in-window';
        const devStart = '2026-04-12T15:00:00.000Z';
        const devEnd = '2026-04-12T15:30:00.000Z';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        createTaskFile(taskInWindow, '2026-04-12T15:15:00.000Z');
        // Create corrupt snapshot file
        const corruptSnapshotPath = path.join(runsDir(), `harness-plan-snapshot-${process.pid}-12345.json`);
        fs.writeFileSync(corruptSnapshotPath, '{invalid json');
        const devReport = createDevReportWithWindow(currentTaskId, devStart, devEnd);
        // Should not throw, should fall back to time window mode
        expect(() => {
            evaluator.detectPhantomTasks(currentTaskId, devReport);
        }).not.toThrow();
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // In fallback mode, task should be detected
        expect(phantomTasks).toContain(taskInWindow);
    });
    test('should handle missing dev report times gracefully', () => {
        const currentTaskId = 'TASK-current';
        const otherTask = 'TASK-other';
        createTaskFile(currentTaskId, '2026-04-12T10:00:00.000Z');
        createTaskFile(otherTask, '2026-04-12T15:15:00.000Z');
        // Dev report with missing times
        const devReport = {
            taskId: currentTaskId,
            status: 'success',
            changes: [],
            evidence: [],
            checkpointsCompleted: [],
            startTime: '', // Missing
            endTime: '', // Missing
            duration: 0,
        };
        const phantomTasks = evaluator.detectPhantomTasks(currentTaskId, devReport);
        // No tasks should be detected when time window is invalid
        expect(phantomTasks.length).toBe(0);
    });
});
