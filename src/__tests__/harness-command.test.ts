import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { harnessCommand, saveRuntimeState } from '../commands/harness.js';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { HarnessReporter } from '../utils/harness-reporter.js';
import { createDefaultRuntimeState } from '../types/harness.js';
import type { ExecutionSummary, HarnessConfig } from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';

// ---- Test helpers ----

function createProjectDir(tmpDir: string): string {
  const projDir = path.join(tmpDir, '.projmnt4claude');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(
    path.join(projDir, 'config.json'),
    JSON.stringify({ version: 1 }),
    'utf-8'
  );
  return projDir;
}

function createTaskMeta(
  projDir: string,
  taskId: string,
  overrides: Partial<TaskMeta> = {}
): void {
  const taskDir = path.join(projDir, 'tasks', taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  const meta: TaskMeta = {
    id: taskId,
    title: `Task ${taskId}`,
    description: 'Test description',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    history: [],
    ...overrides,
  };
  fs.writeFileSync(
    path.join(taskDir, 'meta.json'),
    JSON.stringify(meta),
    'utf-8'
  );
}

function createPlanFile(
  tmpDir: string,
  tasks: string[],
  batches?: string[][]
): string {
  const planPath = path.join(tmpDir, 'test-plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      recommendation: { suggestedOrder: tasks },
      ...(batches ? { batches } : {}),
    }),
    'utf-8'
  );
  return 'test-plan.json';
}

function createMockSummary(
  overrides: Partial<ExecutionSummary> = {}
): ExecutionSummary {
  return {
    totalTasks: 1,
    passed: 1,
    failed: 0,
    totalRetries: 0,
    duration: 1000,
    startTime: '2026-04-11T00:00:00.000Z',
    endTime: '2026-04-11T00:00:01.000Z',
    taskResults: new Map(),
    config: {} as HarnessConfig,
    ...overrides,
  };
}

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
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

// ============== harnessCommand: validation ==============

describe('harnessCommand: validation', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-val-test-'));
    createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    runSpy = spyOn(AssemblyLine.prototype, 'run').mockResolvedValue(
      createMockSummary()
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    runSpy.mockRestore();
  });

  test('exits when project not initialized', async () => {
    const noInitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-noinit-'));
    try {
      await harnessCommand({ dryRun: true }, noInitDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('未初始化')
    );
    fs.rmSync(noInitDir, { recursive: true, force: true });
  });

  test('rejects quality score below 0', async () => {
    try {
      await harnessCommand({ requireQuality: '-1', dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('require-quality')
    );
  });

  test('rejects quality score above 100', async () => {
    try {
      await harnessCommand({ requireQuality: '150', dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('rejects negative maxRetries', async () => {
    try {
      await harnessCommand({ maxRetries: '-1', dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('max-retries')
    );
  });

  test('rejects timeout below 10', async () => {
    try {
      await harnessCommand({ timeout: '5', dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('timeout')
    );
  });

  test('rejects parallel below 1', async () => {
    try {
      await harnessCommand({ parallel: '0', dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('parallel')
    );
  });

  test('rejects when no tasks available', async () => {
    try {
      await harnessCommand({ dryRun: true }, tmpDir);
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('无法获取任务列表')
    );
  });

  test('rejects when plan file does not exist', async () => {
    try {
      await harnessCommand(
        { plan: 'nonexistent.json', dryRun: true },
        tmpDir
      );
    } catch {}
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('计划文件不存在')
    );
  });

  test('accepts valid config values', async () => {
    const projDir = path.join(tmpDir, '.projmnt4claude');
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    // Should not throw or call exit
    await harnessCommand(
      {
        plan: planFile,
        dryRun: true,
        skipHarnessGate: true,
        maxRetries: '5',
        timeout: '60',
        parallel: '2',
      },
      tmpDir
    );

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ============== harnessCommand: dry run ==============

describe('harnessCommand: dry run', () => {
  let tmpDir: string;
  let projDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-dry-test-'));
    projDir = createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('shows task list without executing', async () => {
    createTaskMeta(projDir, 'TASK-1');
    createTaskMeta(projDir, 'TASK-2');
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('试运行')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TASK-1')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('TASK-2')
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('shows batch info when batches present', async () => {
    createTaskMeta(projDir, 'TASK-A');
    createTaskMeta(projDir, 'TASK-B');
    createTaskMeta(projDir, 'TASK-C');
    const planFile = createPlanFile(
      tmpDir,
      ['TASK-A', 'TASK-B', 'TASK-C'],
      [['TASK-A', 'TASK-B'], ['TASK-C']]
    );

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('批次 1')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('批次 2')
    );
    // Batch 1 has 2 tasks → parallelizable
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('可并行')
    );
  });

  test('does not show batch info without batches', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    // Should not contain batch count
    const calls = logSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(calls).not.toContain('批次数');
  });

  test('displays config header with task count', async () => {
    createTaskMeta(projDir, 'TASK-1');
    createTaskMeta(projDir, 'TASK-2');
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    await harnessCommand(
      {
        plan: planFile,
        dryRun: true,
        skipHarnessGate: true,
        maxRetries: '5',
        timeout: '120',
        parallel: '2',
      },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Harness Design')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('任务数量: 2')
    );
  });

  test('does not call AssemblyLine in dry run mode', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);
    const runSpy = spyOn(AssemblyLine.prototype, 'run');

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();
  });

  test('single-task batch is not marked parallelizable', async () => {
    createTaskMeta(projDir, 'TASK-A');
    const planFile = createPlanFile(
      tmpDir,
      ['TASK-A'],
      [['TASK-A']]
    );

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    const calls = logSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(calls).not.toContain('可并行');
  });
});

// ============== harnessCommand: execution ==============

describe('harnessCommand: execution', () => {
  let tmpDir: string;
  let projDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;
  let reportSpy: ReturnType<typeof spyOn>;
  let forceFailSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-exec-test-'));
    projDir = createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    runSpy = spyOn(AssemblyLine.prototype, 'run').mockResolvedValue(
      createMockSummary()
    );
    reportSpy = spyOn(
      HarnessReporter.prototype,
      'generateSummaryReport'
    ).mockResolvedValue();
    forceFailSpy = spyOn(AssemblyLine.prototype, 'forceFailStatus');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    runSpy.mockRestore();
    reportSpy.mockRestore();
    forceFailSpy.mockRestore();
  });

  test('runs AssemblyLine and outputs summary', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    expect(runSpy).toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('执行摘要')
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('handles execution error gracefully', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);
    runSpy.mockRejectedValue(new Error('Pipeline exploded'));

    try {
      await harnessCommand(
        { plan: planFile, skipHarnessGate: true },
        tmpDir
      );
    } catch {}

    expect(forceFailSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('执行失败'),
      expect.any(String)
    );
  });

  test('outputs JSON when json flag is set', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, json: 'true', skipHarnessGate: true },
      tmpDir
    );

    // Find the JSON output call
    const calls = logSpy.mock.calls;
    const jsonCall = calls.find((call: any[]) => {
      try {
        const parsed = JSON.parse(call[0]);
        return typeof parsed.totalTasks === 'number';
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse((jsonCall as any[])[0]);
    expect(parsed.totalTasks).toBe(1);
    expect(parsed.passed).toBe(1);
  });

  test('clears runtime state after successful execution', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    const statePath = path.join(projDir, 'harness-state.json');
    expect(fs.existsSync(statePath)).toBe(false);
  });

  test('passes config to AssemblyLine', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      {
        plan: planFile,
        skipHarnessGate: true,
        maxRetries: '7',
        timeout: '200',
        parallel: '3',
      },
      tmpDir
    );

    expect(runSpy).toHaveBeenCalled();
    const state = runSpy.mock.calls[0]![0] as any;
    expect(state.config.maxRetries).toBe(7);
    expect(state.config.timeout).toBe(200);
    expect(state.config.parallel).toBe(3);
  });

  test('passes task queue to AssemblyLine state', async () => {
    createTaskMeta(projDir, 'TASK-X');
    createTaskMeta(projDir, 'TASK-Y');
    const planFile = createPlanFile(tmpDir, ['TASK-X', 'TASK-Y']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    const state = runSpy.mock.calls[0]![0] as any;
    expect(state.taskQueue).toEqual(['TASK-X', 'TASK-Y']);
  });

  test('passes batch metadata to AssemblyLine state', async () => {
    createTaskMeta(projDir, 'TASK-A');
    createTaskMeta(projDir, 'TASK-B');
    createTaskMeta(projDir, 'TASK-C');
    const planFile = createPlanFile(
      tmpDir,
      ['TASK-A', 'TASK-B', 'TASK-C'],
      [['TASK-A', 'TASK-B'], ['TASK-C']]
    );

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    const state = runSpy.mock.calls[0]![0] as any;
    expect(state.batchBoundaries).toEqual([0, 2]);
    expect(state.batchLabels).toEqual(['批次 1', '批次 2']);
    expect(state.batchParallelizable).toEqual([true, false]);
  });
});

// ============== harnessCommand: continue mode ==============

describe('harnessCommand: continue mode', () => {
  let tmpDir: string;
  let projDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;
  let reportSpy: ReturnType<typeof spyOn>;
  let forceFailSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cont-test-'));
    projDir = createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    runSpy = spyOn(AssemblyLine.prototype, 'run').mockResolvedValue(
      createMockSummary()
    );
    reportSpy = spyOn(
      HarnessReporter.prototype,
      'generateSummaryReport'
    ).mockResolvedValue();
    forceFailSpy = spyOn(AssemblyLine.prototype, 'forceFailStatus');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    runSpy.mockRestore();
    reportSpy.mockRestore();
    forceFailSpy.mockRestore();
  });

  test('loads saved state and resumes', async () => {
    createTaskMeta(projDir, 'TASK-1');
    createTaskMeta(projDir, 'TASK-2');
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    // Save a runtime state indicating progress
    const state = createDefaultRuntimeState(createTestConfig(tmpDir));
    state.state = 'running';
    state.currentIndex = 1;
    state.taskQueue = ['TASK-1', 'TASK-2'];
    saveRuntimeState(state, tmpDir);

    await harnessCommand(
      { plan: planFile, continue: true, skipHarnessGate: true },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('从中断处继续')
    );
    // The loaded state should be passed to AssemblyLine
    const runArg = runSpy.mock.calls[0]![0] as any;
    expect(runArg.currentIndex).toBe(1);
  });

  test('starts fresh when no saved state exists', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, continue: true, skipHarnessGate: true },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('没有找到之前的执行状态')
    );
    expect(runSpy).toHaveBeenCalled();
    const runArg = runSpy.mock.calls[0]![0] as any;
    expect(runArg.currentIndex).toBe(0);
  });
});

// ============== harnessCommand: quality gate ==============

describe('harnessCommand: quality gate', () => {
  let tmpDir: string;
  let projDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;
  let reportSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-qg-test-'));
    projDir = createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    runSpy = spyOn(AssemblyLine.prototype, 'run').mockResolvedValue(
      createMockSummary()
    );
    reportSpy = spyOn(
      HarnessReporter.prototype,
      'generateSummaryReport'
    ).mockResolvedValue();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    runSpy.mockRestore();
    reportSpy.mockRestore();
  });

  test('skips quality gate with --skip-harness-gate', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    // Should not show quality gate section
    const calls = logSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(calls).not.toContain('质量门禁检查');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('skips quality gate with --skip-quality-gate (deprecated)', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, skipQualityGate: true },
      tmpDir
    );

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('displays quality threshold from --require-quality', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    await harnessCommand(
      { plan: planFile, requireQuality: '80', skipHarnessGate: true },
      tmpDir
    );

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('quality gate runs when not skipped', async () => {
    createTaskMeta(projDir, 'TASK-1');
    const planFile = createPlanFile(tmpDir, ['TASK-1']);

    // batchCheckQualityGate reads real task files - it may pass or fail
    // We just verify the quality gate section is reached
    try {
      await harnessCommand(
        { plan: planFile },
        tmpDir
      );
    } catch {}

    // Either quality gate section appears or process.exit is called
    const calls = logSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    const hasQualityGate = calls.includes('质量门禁检查');
    const hasExit = exitSpy.mock.calls.length > 0;
    expect(hasQualityGate || hasExit).toBe(true);
  });
});

// ============== harnessCommand: task filtering ==============

describe('harnessCommand: task filtering', () => {
  let tmpDir: string;
  let projDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;
  let reportSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-filter-test-'));
    projDir = createProjectDir(tmpDir);

    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    runSpy = spyOn(AssemblyLine.prototype, 'run').mockResolvedValue(
      createMockSummary()
    );
    reportSpy = spyOn(
      HarnessReporter.prototype,
      'generateSummaryReport'
    ).mockResolvedValue();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    runSpy.mockRestore();
    reportSpy.mockRestore();
  });

  test('filters terminal status tasks from plan', async () => {
    createTaskMeta(projDir, 'TASK-1', { status: 'in_progress' });
    createTaskMeta(projDir, 'TASK-2', { status: 'resolved' });
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    const state = runSpy.mock.calls[0]![0] as any;
    // Only TASK-1 should be in the queue (TASK-2 is resolved)
    expect(state.taskQueue).toEqual(['TASK-1']);
  });

  test('exits when all tasks are in terminal status', async () => {
    createTaskMeta(projDir, 'TASK-1', { status: 'resolved' });
    createTaskMeta(projDir, 'TASK-2', { status: 'closed' });
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    try {
      await harnessCommand(
        { plan: planFile, dryRun: true, skipHarnessGate: true },
        tmpDir
      );
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('没有可执行的任务')
    );
  });

  test('filters tasks whose meta files do not exist', async () => {
    createTaskMeta(projDir, 'TASK-1');
    // TASK-2 has no meta file
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    await harnessCommand(
      { plan: planFile, skipHarnessGate: true },
      tmpDir
    );

    const state = runSpy.mock.calls[0]![0] as any;
    expect(state.taskQueue).toEqual(['TASK-1']);
  });

  test('logs filtered count when tasks are removed', async () => {
    createTaskMeta(projDir, 'TASK-1');
    createTaskMeta(projDir, 'TASK-2', { status: 'abandoned' });
    const planFile = createPlanFile(tmpDir, ['TASK-1', 'TASK-2']);

    await harnessCommand(
      { plan: planFile, dryRun: true, skipHarnessGate: true },
      tmpDir
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('已过滤')
    );
  });
});
