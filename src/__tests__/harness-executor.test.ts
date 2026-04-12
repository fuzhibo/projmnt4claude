import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarnessExecutor } from '../utils/harness-executor.js';
import type { HarnessConfig, SprintContract, DevReport, RetryContext } from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';

// ============================================================
// Mocks - must be hoisted before imports that use them
// ============================================================

const mockAgentInvoke = mock<(prompt: string, options: any) => Promise<any>>();

mock.module('../utils/headless-agent.js', () => ({
  getAgent: () => ({ invoke: mockAgentInvoke }),
  buildEffectiveTools: () => ({ tools: ['Read', 'Edit', 'Write'], skipPermissions: true }),
}));

mock.module('../utils/role-prompts.js', () => ({
  getDevRoleTemplate: () => ({
    roleDeclaration: 'You are an executor.',
    extraInstructions: ['Follow coding standards'],
  }),
}));

mock.module('../utils/prompt-templates.js', () => ({
  loadPromptTemplate: () => '{title}\n{taskId}\n{descriptionSection}',
  resolveTemplate: (_tpl: string, vars: Record<string, string>) => {
    return Object.entries(vars).reduce((t, [k, v]) => t.replace(`{${k}}`, v || ''), _tpl);
  },
}));

const mockArchiveReport = mock(() => {});
mock.module('../utils/harness-helpers.js', () => ({
  archiveReportIfExists: mockArchiveReport,
}));

// ============================================================
// Helpers
// ============================================================

function createConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-exec-test-'));
  const config: HarnessConfig = {
    maxRetries: 3,
    timeout: 300,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd: tmpDir,
    apiRetryAttempts: 3,
    apiRetryDelay: 60,
    batchGitCommit: false,
    forceContinue: false,
    ...overrides,
  };
  // 如果 overrides 覆盖了 cwd，清理未使用的 tmpDir 防止泄漏
  if (config.cwd !== tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return config;
}

function createTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: overrides.id || 'TASK-exec-test-001',
    title: overrides.title || 'Executor Test Task',
    type: overrides.type || 'feature',
    priority: overrides.priority || 'P2',
    status: 'in_progress',
    dependencies: [],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

function createContract(overrides: Partial<SprintContract> = {}): SprintContract {
  return {
    taskId: 'TASK-exec-test-001',
    acceptanceCriteria: ['All tests pass'],
    verificationCommands: ['bun test'],
    checkpoints: ['CP-001', 'CP-002'],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    ...overrides,
  };
}

function setupProjectDir(cwd: string, taskId: string) {
  const projectDir = path.join(cwd, '.projmnt4claude');
  const taskDir = path.join(projectDir, 'tasks', taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  return projectDir;
}

// ============================================================
// execute() - 开发阶段执行
// ============================================================

describe('HarnessExecutor', () => {
  let tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs = [];
    mockAgentInvoke.mockClear();
    mockArchiveReport.mockClear();
  });

  // ============================================================
  // CP-001: execute() 正常输入 - 成功路径
  // ============================================================
  describe('execute() - success path', () => {
    test('returns success report when agent succeeds', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'Development completed successfully',
        success: true,
        durationMs: 5000,
        exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.status).toBe('success');
      expect(report.taskId).toBe(task.id);
      expect(report.claudeOutput).toBe('Development completed successfully');
      expect(report.duration).toBeGreaterThan(0);
      expect(report.startTime).toBeTruthy();
      expect(report.endTime).toBeTruthy();
    });

    test('collects evidence and checkpoints on success', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask({
        checkpoints: [
          { id: 'CP-001', description: 'CP1', status: 'completed', createdAt: '', updatedAt: '' },
          { id: 'CP-002', description: 'CP2', status: 'pending', createdAt: '', updatedAt: '' },
        ],
      });
      const contract = createContract({ checkpoints: ['CP-001', 'CP-002'] });
      const projectDir = setupProjectDir(config.cwd, task.id);

      // Create evidence files
      const evidenceDir = path.join(projectDir, 'evidence', task.id);
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'proof.txt'), 'evidence');

      mockAgentInvoke.mockResolvedValue({
        output: 'done',
        success: true,
        durationMs: 1000,
        exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.evidence).toHaveLength(1);
      expect(report.evidence[0]).toContain('proof.txt');
      expect(report.checkpointsCompleted).toEqual(['CP-001']);
    });
  });

  // ============================================================
  // CP-002: execute() 边界条件 - timeout override
  // ============================================================
  describe('execute() - boundary conditions', () => {
    test('uses timeoutOverride instead of config.timeout', async () => {
      const config = createConfig({ timeout: 600 });
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done',
        success: true,
        durationMs: 100,
        exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract, 120); // 120 seconds override

      // Agent should be called with timeout=120
      const callOpts = mockAgentInvoke.mock.calls[0]![1] as any;
      expect(callOpts.timeout).toBe(120);
    });

    test('falls back to config.timeout when no override', async () => {
      const config = createConfig({ timeout: 300 });
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done',
        success: true,
        durationMs: 100,
        exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      const callOpts = mockAgentInvoke.mock.calls[0]![1] as any;
      expect(callOpts.timeout).toBe(300);
    });

    test('handles task with no checkpoints', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask(); // no checkpoints
      const contract = createContract({ checkpoints: [] });
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done',
        success: true,
        durationMs: 100,
        exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.checkpointsCompleted).toEqual([]);
    });
  });

  // ============================================================
  // CP-003: execute() 异常输入 - 失败/超时/异常
  // ============================================================
  describe('execute() - error handling', () => {
    test('returns failed status when agent returns failure', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: '',
        success: false,
        durationMs: 2000,
        exitCode: 1,
        error: 'Build failed',
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.status).toBe('failed');
      expect(report.error).toBe('Build failed');
    });

    test('returns timeout status when exit code is 124', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'partial output',
        success: false,
        durationMs: 300000,
        exitCode: 124,
        error: 'timed out',
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.status).toBe('timeout');
      expect(report.error).toContain('timed out');
    });

    test('returns failed status when agent throws exception', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockRejectedValue(new Error('spawn crashed'));

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.status).toBe('failed');
      expect(report.error).toBe('spawn crashed');
    });

    test('handles non-Error thrown values', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockRejectedValue('string error');

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.status).toBe('failed');
      expect(report.error).toBe('string error');
    });
  });

  // ============================================================
  // CP-004: buildDevPrompt() 正常输入
  // ============================================================
  describe('buildDevPrompt() - internal', () => {
    test('includes task title and description in prompt', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask({
        title: 'Add auth feature',
        description: 'Implement JWT authentication',
      });
      const contract = createContract({
        acceptanceCriteria: ['Token validation works'],
        checkpoints: ['CP-001'],
      });
      setupProjectDir(config.cwd, task.id);

      let capturedPrompt = '';
      mockAgentInvoke.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { output: 'done', success: true, durationMs: 100, exitCode: 0 };
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      expect(capturedPrompt).toContain('Add auth feature');
      expect(capturedPrompt).toContain('Implement JWT authentication');
    });
  });

  // ============================================================
  // CP-005: buildDevPrompt() 边界条件 - 最小任务
  // ============================================================
  describe('buildDevPrompt() - minimal task', () => {
    test('handles task with no description and no dependencies', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask({ description: '', dependencies: [] });
      const contract = createContract({ acceptanceCriteria: [], checkpoints: [] });
      setupProjectDir(config.cwd, task.id);

      let capturedPrompt = '';
      mockAgentInvoke.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { output: 'done', success: true, durationMs: 100, exitCode: 0 };
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      // Should not throw and prompt should be generated
      expect(capturedPrompt).toContain(task.id);
    });
  });

  // ============================================================
  // CP-006: buildDevPrompt() 异常 - 重试上下文注入
  // ============================================================
  describe('buildDevPrompt() - retry context', () => {
    test('injects retry context into prompt when provided', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      const retryCtx: RetryContext = {
        attemptNumber: 2,
        previousPhase: 'qa',
        previousFailureReason: 'Tests did not cover the module',
      };

      let capturedPrompt = '';
      mockAgentInvoke.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { output: 'done', success: true, durationMs: 100, exitCode: 0 };
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract, undefined, retryCtx);

      expect(capturedPrompt).toContain('重试上下文');
      expect(capturedPrompt).toContain('Tests did not cover the module');
      expect(capturedPrompt).toContain('QA 验证');
      expect(capturedPrompt).toContain('第 2 次尝试');
    });

    test('injects retry context with partial progress', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      const retryCtx: RetryContext = {
        attemptNumber: 3,
        previousPhase: 'development',
        previousFailureReason: 'Incomplete implementation',
        partialProgress: {
          completedCheckpoints: ['CP-001', 'CP-003'],
        },
      };

      let capturedPrompt = '';
      mockAgentInvoke.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { output: 'done', success: true, durationMs: 100, exitCode: 0 };
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract, undefined, retryCtx);

      expect(capturedPrompt).toContain('CP-001');
      expect(capturedPrompt).toContain('CP-003');
    });

    test('injects upstream failure info into prompt', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      const retryCtx: RetryContext = {
        attemptNumber: 1,
        previousFailureReason: 'Dependency failed',
        upstreamFailureInfo: {
          taskId: 'TASK-upstream-001',
          reason: 'Build error in dependency',
          failedAt: '2026-04-10T10:00:00Z',
        },
      };

      let capturedPrompt = '';
      mockAgentInvoke.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { output: 'done', success: true, durationMs: 100, exitCode: 0 };
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract, undefined, retryCtx);

      expect(capturedPrompt).toContain('TASK-upstream-001');
      expect(capturedPrompt).toContain('Build error in dependency');
    });
  });

  // ============================================================
  // extractAcceptanceCriteria() - internal via buildOrLoadContract
  // ============================================================
  describe('buildOrLoadContract() - internal', () => {
    test('creates new contract with acceptance criteria from description', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask({
        description: '- [ ] Implement feature A\n- [ ] Add unit tests\n- [ ] Update docs',
      });
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      // Contract should be updated with criteria extracted from description
      expect(report.status).toBe('success');
    });

    test('loads existing contract from file', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      setupProjectDir(config.cwd, task.id);

      // Write existing contract
      const existingContract = createContract({
        acceptanceCriteria: ['Existing criteria'],
        verificationCommands: ['npm test'],
      });
      const contractPath = path.join(
        config.cwd, '.projmnt4claude', 'tasks', task.id, 'contract.json'
      );
      fs.writeFileSync(contractPath, JSON.stringify(existingContract));

      const passedContract = createContract(); // empty, will be overwritten
      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, passedContract);

      // The passed contract should be overwritten with loaded data
      expect(passedContract.acceptanceCriteria).toEqual(['Existing criteria']);
    });
  });

  // ============================================================
  // Dev report persistence
  // ============================================================
  describe('saveDevReport() - internal', () => {
    test('saves dev report to file system', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      const reportPath = path.join(
        config.cwd, '.projmnt4claude', 'reports', 'harness', task.id, 'dev-report.md'
      );
      expect(fs.existsSync(reportPath)).toBe(true);
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('开发报告');
      expect(content).toContain(task.id);
    });

    test('report includes error section on failure', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: '', success: false, durationMs: 100, exitCode: 1, error: 'Build error',
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      const reportPath = path.join(
        config.cwd, '.projmnt4claude', 'reports', 'harness', task.id, 'dev-report.md'
      );
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('错误信息');
      expect(content).toContain('Build error');
    });

    test('calls archiveReportIfExists before saving', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      expect(mockArchiveReport).toHaveBeenCalled();
    });
  });

  // ============================================================
  // collectEvidence() - internal
  // ============================================================
  describe('collectEvidence() - internal', () => {
    test('returns empty array when evidence dir does not exist', async () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);
      // No evidence directory created

      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const executor = new HarnessExecutor(config);
      const report = await executor.execute(task, contract);

      expect(report.evidence).toEqual([]);
    });
  });

  // ============================================================
  // Constructor
  // ============================================================
  describe('constructor', () => {
    test('stores config', () => {
      const config = createConfig();
      tmpDirs.push(config.cwd);
      const executor = new HarnessExecutor(config);
      expect(executor).toBeInstanceOf(HarnessExecutor);
    });
  });
});
