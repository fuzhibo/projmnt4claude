import { describe, test, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { HarnessExecutor } from '../utils/harness-executor.js';
import * as harnessHelpers from '../utils/harness-helpers.js';
import * as promptTemplates from '../utils/prompt-templates.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { HarnessConfig, SprintContract, DevReport, RetryContext } from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';

// ============================================================
// Mocks - Jest hoists jest.mock() before imports that use them
// ============================================================

const mockAgentInvoke = jest.fn<(prompt: string, options: any) => Promise<any>>();

// Note: jest.mock() is hoisted before imports — same behavior as Bun's mock.module().
// jest.restoreAllMocks() restores function-level mocks (mockAgentInvoke).
// Module-level mocks persist for the file's lifetime (Jest design).

jest.mock('../utils/headless-agent.js', () => ({
  getAgent: () => ({ invoke: mockAgentInvoke }),
  buildEffectiveTools: () => ({ tools: ['Read', 'Edit', 'Write'], skipPermissions: true }),
}));

// Note: role-prompts is mocked via jest.mock() because it's imported
// transitively by headless-agent. spyOn requires the module to be imported
// first, but the import chain depends on the mock being in place.
jest.mock('../utils/role-prompts.js', () => ({
  getDevRoleTemplate: () => ({
    roleDeclaration: 'You are an executor.',
    extraInstructions: ['Follow coding standards'],
  }),
}));

// Note: prompt-templates is NOT mocked via mock.module() to avoid global pollution
// Instead, we use spyOn in beforeEach/afterEach for isolated mocking

// ============================================================
// Helpers
// ============================================================

function createConfig(tempDir: string, overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 300,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd: tempDir,
    forceContinue: false,
    ...overrides,
  };
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
    verificationCommands: ['npm test'],
    // checkpoints removed from SprintContract - now accessed from TaskMeta.checkpoints
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
  let env: IsolatedTestEnv;
  let loadPromptTemplateSpy: jest.SpyInstance;
  let resolveTemplateSpy: jest.SpyInstance;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();

    // Use spyOn for prompt-templates to allow restoration in afterEach
    // This prevents global pollution of mock.module()
    loadPromptTemplateSpy = jest.spyOn(promptTemplates, 'loadPromptTemplate').mockReturnValue('{title}\n{taskId}\n{descriptionSection}');
    resolveTemplateSpy = jest.spyOn(promptTemplates, 'resolveTemplate').mockImplementation((_tpl: string, vars: Record<string, string>) => {
      return Object.entries(vars).reduce((t, [k, v]) => t.replace(`{${k}}`, v || ''), _tpl);
    });
  });

  afterEach(() => {
    env.cleanup();
    mockAgentInvoke.mockClear();
    loadPromptTemplateSpy.mockRestore();
    resolveTemplateSpy.mockRestore();
  });

  // ============================================================
  // CP-001: execute() 正常输入 - 成功路径
  // ============================================================
  describe('execute() - success path', () => {
    test('returns success report when agent succeeds', async () => {
      const config = createConfig(env.tempDir);
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
      expect(report.duration).toBeGreaterThanOrEqual(0);
      expect(report.startTime).toBeTruthy();
      expect(report.endTime).toBeTruthy();
    });

    test('collects evidence and checkpoints on success', async () => {
      const config = createConfig(env.tempDir);
      const task = createTask({
        checkpoints: [
          {
            id: 'CP-001',
            description: 'CP1',
            status: 'completed',
            createdAt: '',
            updatedAt: '',
            // 添加验证证据，使其通过兜底验证
            verification: {
              method: 'automated',
              result: 'passed',
              evidencePath: 'proof.txt',
              verifiedAt: '2026-05-20T00:00:00Z',
              verifiedBy: 'test',
              details: { type: 'automated' },
            },
          },
          { id: 'CP-002', description: 'CP2', status: 'pending', createdAt: '', updatedAt: '' },
        ],
      });
      const contract = createContract(); // checkpoints now in task.checkpoints
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
      const config = createConfig(env.tempDir, { timeout: 600 });
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
      const config = createConfig(env.tempDir, { timeout: 300 });
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
      const config = createConfig(env.tempDir);
      const task = createTask(); // no checkpoints
      const contract = createContract(); // checkpoints removed from SprintContract
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
      const task = createTask({ description: '', dependencies: [] });
      const contract = createContract({ acceptanceCriteria: [] }); // checkpoints removed from SprintContract
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
      const config = createConfig(env.tempDir);
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

      expect(capturedPrompt).toContain('Retry Context (Previous Failure Info)');
      expect(capturedPrompt).toContain('Tests did not cover the module');
      expect(capturedPrompt).toContain('QA Validation');
      expect(capturedPrompt).toContain('This is attempt #2');
    });

    test('injects retry context with partial progress', async () => {
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
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
      expect(content).toContain('Development Report');
      expect(content).toContain(task.id);
    });

    test('report includes error section on failure', async () => {
      const config = createConfig(env.tempDir);
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
      expect(content).toContain('Error Information');
      expect(content).toContain('Build error');
    });

    test('calls archiveReportIfExists before saving', async () => {
      const config = createConfig(env.tempDir);
      const task = createTask();
      const contract = createContract();
      setupProjectDir(config.cwd, task.id);

      mockAgentInvoke.mockResolvedValue({
        output: 'done', success: true, durationMs: 100, exitCode: 0,
      });

      const archiveSpy = jest.spyOn(harnessHelpers, 'archiveReportIfExists').mockImplementation(() => {});

      const executor = new HarnessExecutor(config);
      await executor.execute(task, contract);

      expect(archiveSpy).toHaveBeenCalled();
      archiveSpy.mockRestore();
    });
  });

  // ============================================================
  // collectEvidence() - internal
  // ============================================================
  describe('collectEvidence() - internal', () => {
    test('returns empty array when evidence dir does not exist', async () => {
      const config = createConfig(env.tempDir);
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
      const config = createConfig(env.tempDir);
      const executor = new HarnessExecutor(config);
      expect(executor).toBeInstanceOf(HarnessExecutor);
    });
  });
});

// ============================================================
// Cleanup: Restore function-level mocks after all tests
// Note: mock.module() mocks persist for the file's lifetime and
// cannot be restored via jest.restoreAllMocks() (Bun design limitation).
// Process isolation (batched-test-runner) prevents cross-file pollution.
// ============================================================
afterAll(() => {
  jest.restoreAllMocks();
});
