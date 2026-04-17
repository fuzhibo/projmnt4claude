/**
 * analyze-layer2-ai-inference.test.ts
 *
 * Layer 2 AI 辅助推断层测试
 * 覆盖:
 * - CP-23: shouldTriggerAIInference 各条件分支
 * - CP-24: buildStatusInferencePrompt 输出格式验证
 * - CP-25: AI 推断集成测试 (mock headless agent)
 * - CP-26: analyze --fix 端到端测试 (双层检测)
 * - CP-27: Headless 已调用
 * - CP-28: AI 已调用
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// ============== Mock headless-agent before analyze imports ==============
const mockInvokeAgent = mock((_prompt, _options) => Promise.resolve({
    output: JSON.stringify({
        inferredStatus: 'resolved',
        confidence: 0.9,
        reasoning: 'All checkpoints completed',
        suggestion: 'Mark as resolved',
    }),
    success: true,
    provider: 'claude-code',
    durationMs: 1000,
    tokensUsed: 500,
    model: 'claude-sonnet',
}));
mock.module('../utils/headless-agent', () => ({
    invokeAgent: mockInvokeAgent,
}));
import { shouldTriggerAIInference, buildStatusInferencePrompt, runAIStatusInference, detectStatusInferenceIssues, } from '../commands/analyze';
// ============== 辅助函数 ==============
function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-layer2-test-'));
}
function createTask(overrides = {}) {
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
function setupProjectWithTask(cwd, task) {
    const tasksDir = path.join(cwd, '.projmnt4claude', 'tasks', task.id);
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'meta.json'), JSON.stringify(task, null, 2), 'utf-8');
}
function createReportDir(cwd, taskId) {
    const reportDir = path.join(cwd, '.projmnt4claude', 'reports', 'harness', taskId);
    fs.mkdirSync(reportDir, { recursive: true });
    return reportDir;
}
function writeReport(reportDir, fileName, verdict) {
    const content = `# Report\n\n**结果**: ${verdict === 'PASS' ? '✅ PASS' : '❌ NOPASS'}\n`;
    fs.writeFileSync(path.join(reportDir, fileName), content, 'utf-8');
}
// ============== shouldTriggerAIInference (CP-23) ==============
describe('shouldTriggerAIInference', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = createTempDir();
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude'), { recursive: true });
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // CP-2: 终态任务不需要 AI 推断
    test('returns false for terminal statuses', () => {
        for (const status of ['resolved', 'closed', 'abandoned', 'failed']) {
            const task = createTask({ status });
            const result = shouldTriggerAIInference(task, [], tmpDir);
            expect(result).toBe(false);
        }
    });
    test('returns false for resolved task even with rich history', () => {
        const task = createTask({
            status: 'resolved',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
    // Layer 1 已发现问题时不触发 Layer 2
    test('returns false when Layer 1 already found issues', () => {
        const task = createTask({ status: 'in_progress' });
        const layer1Issue = {
            taskId: task.id,
            type: 'report_status_mismatch',
            severity: 'medium',
            message: 'test',
            suggestion: 'test',
        };
        const result = shouldTriggerAIInference(task, [layer1Issue], tmpDir);
        expect(result).toBe(false);
    });
    // CP-3: 有丰富历史记录(≥3条)但无报告文件 → 需要
    test('returns true for non-terminal task with ≥3 history entries and no report dir', () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(true);
    });
    // CP-3: 有历史但报告文件存在 → 不需要
    test('returns false for task with history but report dir exists', () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        setupProjectWithTask(tmpDir, task);
        createReportDir(tmpDir, task.id);
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
    // CP-3: 历史记录不足 3 条 → 不需要
    test('returns false for task with <3 history entries', () => {
        const task = createTask({
            status: 'in_progress',
            history: [
                { timestamp: new Date().toISOString(), action: 'created' },
            ],
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
    // CP-4: open 但有 transitionNotes → 需要
    test('returns true for open task with transitionNotes', () => {
        const task = createTask({
            status: 'open',
            transitionNotes: [
                {
                    timestamp: new Date().toISOString(),
                    fromStatus: 'resolved',
                    toStatus: 'open',
                    note: 'Reopened due to regression',
                    author: 'user',
                },
            ],
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(true);
    });
    // CP-4: open 但无 transitionNotes → 不需要
    test('returns false for open task without transitionNotes', () => {
        const task = createTask({ status: 'open' });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
    // CP-5: in_progress 且创建时间超过 1 天 → 需要
    test('returns true for in_progress task created >1 day ago', () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const task = createTask({
            status: 'in_progress',
            createdAt: twoDaysAgo,
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(true);
    });
    // CP-5: in_progress 但创建时间不超过 1 天 → 不需要
    test('returns false for in_progress task created <1 day ago', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const task = createTask({
            status: 'in_progress',
            createdAt: oneHourAgo,
        });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
    test('returns false for wait_review task created recently', () => {
        const task = createTask({ status: 'wait_review' });
        const result = shouldTriggerAIInference(task, [], tmpDir);
        expect(result).toBe(false);
    });
});
// ============== buildStatusInferencePrompt (CP-24) ==============
describe('buildStatusInferencePrompt', () => {
    test('includes task basic info (CP-7)', () => {
        const task = createTask({
            title: 'Implement AI Inference',
            type: 'feature',
            priority: 'P2',
            status: 'in_progress',
            description: 'Build AI status inference layer',
        });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain(task.id);
        expect(prompt).toContain('Implement AI Inference');
        expect(prompt).toContain('feature');
        expect(prompt).toContain('P2');
        expect(prompt).toContain('in_progress');
        expect(prompt).toContain('Build AI status inference layer');
    });
    test('includes history entries (CP-7)', () => {
        const task = createTask({
            history: [
                { timestamp: '2026-04-10T10:00:00.000Z', action: 'created', field: 'status', oldValue: null, newValue: 'open' },
                { timestamp: '2026-04-10T12:00:00.000Z', action: 'status_change', field: 'status', oldValue: 'open', newValue: 'in_progress' },
            ],
        });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('历史记录');
        expect(prompt).toContain('2 条');
        expect(prompt).toContain('status_change');
    });
    test('includes transition notes (CP-7)', () => {
        const task = createTask({
            transitionNotes: [
                {
                    timestamp: '2026-04-10T14:00:00.000Z',
                    fromStatus: 'resolved',
                    toStatus: 'open',
                    note: 'Regression detected',
                    author: 'user',
                },
            ],
        });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('状态转换记录');
        expect(prompt).toContain('1 条');
        expect(prompt).toContain('resolved');
        expect(prompt).toContain('open');
        expect(prompt).toContain('Regression detected');
    });
    test('includes checkpoint info (CP-7)', () => {
        const now = new Date().toISOString();
        const task = createTask({
            checkpoints: [
                { id: 'CP-1', description: 'Implement function', status: 'completed', createdAt: now, updatedAt: now },
                { id: 'CP-2', description: 'Write tests', status: 'pending', createdAt: now, updatedAt: now },
            ],
        });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('检查点');
        expect(prompt).toContain('2 个');
        expect(prompt).toContain('Implement function');
    });
    test('includes verification info (CP-7)', () => {
        const task = createTask({
            verification: {
                methods: ['unit_test', 'code_review'],
                result: 'passed',
            },
        });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('验证信息');
        expect(prompt).toContain('unit_test');
        expect(prompt).toContain('passed');
    });
    // CP-8: Layer 1 检测结果作为输入
    test('includes Layer 1 findings (CP-8)', () => {
        const task = createTask();
        const layer1Issues = [
            {
                taskId: task.id,
                type: 'report_status_mismatch',
                severity: 'medium',
                message: 'Report shows PASS but status is open',
                suggestion: 'Update status',
            },
        ];
        const prompt = buildStatusInferencePrompt(task, layer1Issues);
        expect(prompt).toContain('Layer 1 检测结果');
        expect(prompt).toContain('1 个问题');
        expect(prompt).toContain('report_status_mismatch');
    });
    // CP-9: 要求输出结构化 JSON
    test('requires structured JSON output (CP-9)', () => {
        const task = createTask();
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('inferredStatus');
        expect(prompt).toContain('confidence');
        expect(prompt).toContain('reasoning');
        expect(prompt).toContain('suggestion');
        expect(prompt).toContain('JSON');
    });
    test('handles task with no history gracefully', () => {
        const task = createTask({ history: [] });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('历史记录: 无');
    });
    test('handles task with no checkpoints gracefully', () => {
        const task = createTask({ checkpoints: [] });
        const prompt = buildStatusInferencePrompt(task, []);
        expect(prompt).toContain('检查点: 无');
    });
});
// ============== runAIStatusInference (CP-25, CP-27, CP-28) ==============
describe('runAIStatusInference', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = createTempDir();
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude'), { recursive: true });
        mockInvokeAgent.mockClear();
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // CP-27: Headless 已调用
    test('calls invokeAgent (Headless) when triggered (CP-27)', async () => {
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(mockInvokeAgent).toHaveBeenCalled();
        expect(mockInvokeAgent.mock.calls.length).toBeGreaterThanOrEqual(1);
        // Verify the prompt contains structured JSON request
        const callArgs = mockInvokeAgent.mock.calls[0];
        expect(callArgs[0]).toContain('inferredStatus');
        expect(callArgs[0]).toContain('confidence');
    });
    // CP-28: AI 已调用 - 返回推断结果
    test('returns parsed AI inference result (CP-28)', async () => {
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).not.toBeNull();
        expect(result.inferredStatus).toBe('resolved');
        expect(result.confidence).toBe(0.9);
        expect(result.reasoning).toBe('All checkpoints completed');
        expect(result.suggestion).toBe('Mark as resolved');
    });
    test('returns null when AI call fails', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: '',
            success: false,
            provider: 'claude-code',
            durationMs: 100,
            tokensUsed: 0,
            model: 'claude-sonnet',
            error: 'timeout',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).toBeNull();
    });
    test('returns null for invalid inferredStatus value', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'invalid_status',
                confidence: 0.9,
                reasoning: 'test',
                suggestion: 'test',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).toBeNull();
    });
    test('handles AI output wrapped in markdown code block', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: '```json\n{"inferredStatus": "wait_review", "confidence": 0.75, "reasoning": "test", "suggestion": "test"}\n```',
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).not.toBeNull();
        expect(result.inferredStatus).toBe('wait_review');
        expect(result.confidence).toBe(0.75);
    });
    test('clamps confidence to 0-1 range', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'resolved',
                confidence: 1.5,
                reasoning: 'test',
                suggestion: 'test',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).not.toBeNull();
        expect(result.confidence).toBe(1);
    });
    test('returns null when output is not valid JSON', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: 'This is not JSON, just plain text.',
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).toBeNull();
    });
    test('returns null when inferredStatus or confidence missing', async () => {
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({ reasoning: 'test' }),
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const task = createTask({ status: 'in_progress' });
        const result = await runAIStatusInference(task, [], tmpDir);
        expect(result).toBeNull();
    });
});
// ============== detectStatusInferenceIssues e2e (CP-26) ==============
describe('detectStatusInferenceIssues', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = createTempDir();
        fs.mkdirSync(path.join(tmpDir, '.projmnt4claude'), { recursive: true });
        mockInvokeAgent.mockClear();
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // CP-15: 先运行 Layer 1 确定性规则
    test('runs Layer 1 deterministic rules first (CP-15)', async () => {
        const task = createTask({ status: 'in_progress' });
        setupProjectWithTask(tmpDir, task);
        const reportDir = createReportDir(tmpDir, task.id);
        writeReport(reportDir, 'dev-report.md', 'PASS');
        const issues = await detectStatusInferenceIssues(task, tmpDir);
        const layer1Issue = issues.find(i => i.type === 'report_status_mismatch');
        expect(layer1Issue).toBeDefined();
        expect(layer1Issue.details?.impliedStatus).toBe('wait_review');
    });
    // CP-16: Layer 1 发现问题时，不触发 Layer 2
    test('skips Layer 2 when Layer 1 found issues (CP-16)', async () => {
        const task = createTask({ status: 'in_progress' });
        setupProjectWithTask(tmpDir, task);
        const reportDir = createReportDir(tmpDir, task.id);
        writeReport(reportDir, 'dev-report.md', 'PASS');
        const issues = await detectStatusInferenceIssues(task, tmpDir);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeUndefined();
    });
    // CP-17: AI 推断在需要时触发
    test('triggers AI inference when needed (CP-17)', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        // CP-27: Headless should have been called
        expect(mockInvokeAgent).toHaveBeenCalled();
        // CP-28: AI inference result should be present
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeDefined();
        expect(aiIssue.details?.inferredStatus).toBe('resolved');
        expect(aiIssue.details?.confidence).toBe(0.9);
        expect(aiIssue.details?.layer).toBe('L2');
    });
    // CP-18: 合并两层结果
    test('merges Layer 1 and Layer 2 results (CP-18)', async () => {
        const task = createTask({
            status: 'open',
            transitionNotes: [
                {
                    timestamp: new Date().toISOString(),
                    fromStatus: 'resolved',
                    toStatus: 'open',
                    note: 'Reopened',
                    author: 'user',
                },
            ],
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'in_progress',
                confidence: 0.75,
                reasoning: 'Based on history analysis',
                suggestion: 'Update to in_progress',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1500,
            tokensUsed: 600,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeDefined();
        expect(aiIssue.details?.inferredStatus).toBe('in_progress');
    });
    // CP-19: 结果标注置信度
    test('annotates confidence in results (CP-19)', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        // Default mock returns confidence 0.9 → severity 'high'
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeDefined();
        expect(aiIssue.severity).toBe('high');
        expect(aiIssue.message).toContain('90%');
    });
    // CP-19: 中等置信度
    test('uses medium severity for confidence 0.6-0.8 (CP-19)', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'resolved',
                confidence: 0.7,
                reasoning: 'Medium confidence',
                suggestion: 'Consider resolving',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1500,
            tokensUsed: 600,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeDefined();
        expect(aiIssue.severity).toBe('medium');
    });
    // AI 禁用时不触发 Layer 2
    test('skips AI when noAi is true', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        const aiOptions = { deepAnalyze: true, noAi: true };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        expect(mockInvokeAgent).not.toHaveBeenCalled();
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeUndefined();
    });
    // AI 返回相同状态时不报告
    test('does not report when AI infers same status', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'in_progress',
                confidence: 0.9,
                reasoning: 'Task is correctly in progress',
                suggestion: 'No change needed',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeUndefined();
    });
    // 低置信度时不报告
    test('does not report when confidence is below 0.6 threshold', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'resolved',
                confidence: 0.4,
                reasoning: 'Low confidence guess',
                suggestion: 'Maybe update status',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeUndefined();
    });
    // CP-26: 完整端到端 - Layer 1 无问题 + Layer 2 AI 推断
    test('full e2e: Layer 1 clean + Layer 2 AI detects stale in_progress (CP-26)', async () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const task = createTask({
            status: 'in_progress',
            createdAt: twoDaysAgo,
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: JSON.stringify({
                inferredStatus: 'open',
                confidence: 0.7,
                reasoning: 'Task in_progress for >1 day with no pipeline activity, likely stale',
                suggestion: 'Reset to open for re-evaluation',
            }),
            success: true,
            provider: 'claude-code',
            durationMs: 3000,
            tokensUsed: 1200,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        // Layer 1: No issues (no report dir, no checkpoint mismatch)
        const layer1Issues = issues.filter(i => ['report_status_mismatch', 'checkpoint_status_mismatch', 'missing_pipeline_evidence'].includes(i.type));
        expect(layer1Issues.length).toBe(0);
        // Layer 2: AI detected stale in_progress
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeDefined();
        expect(aiIssue.details?.inferredStatus).toBe('open');
        expect(aiIssue.severity).toBe('medium'); // confidence 0.7 → medium
        // CP-27/28: Headless was called and AI returned result
        expect(mockInvokeAgent).toHaveBeenCalled();
    });
    // CP-26: AI 返回 null 时不添加 ai_status_inference
    test('handles AI returning null gracefully (CP-26)', async () => {
        const task = createTask({
            status: 'in_progress',
            history: Array.from({ length: 5 }, (_, i) => ({
                timestamp: new Date().toISOString(),
                action: `action_${i}`,
            })),
        });
        mockInvokeAgent.mockResolvedValueOnce({
            output: 'Not valid JSON',
            success: true,
            provider: 'claude-code',
            durationMs: 1000,
            tokensUsed: 500,
            model: 'claude-sonnet',
        });
        const aiOptions = { deepAnalyze: true, noAi: false };
        const issues = await detectStatusInferenceIssues(task, tmpDir, aiOptions);
        const aiIssue = issues.find(i => i.type === 'ai_status_inference');
        expect(aiIssue).toBeUndefined();
    });
});
