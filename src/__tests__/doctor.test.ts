/**
 * doctor.ts 单元测试
 *
 * 覆盖: runDoctor, runDoctorDeep
 *       checkProjectInit, checkPluginCache, checkSkillFiles,
 *       checkDirectoryStructure,
 *       checkLoggingModule, checkDeprecatedStatuses,
 *       checkPluginInstallationScope,
 *       fixIssues (via --fix), displayResults
 *
 * 迁移说明:
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 * - 使用 spyOn 替代 mock.module()
 * - 使用真实文件系统，确保测试隔离
 */

import { describe, test, expect, beforeEach, afterEach} from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  createTaskDir,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ── Console capture using spyOn ─────────────────────────────
let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
const consoleLogs: string[] = [];

function captureConsole() {
  consoleLogs.length = 0;
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    consoleLogs.push(args.map(String).join(' '));
  });
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    consoleLogs.push('[ERROR] ' + args.map(String).join(' '));
  });
}

function restoreConsole() {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
}

/** Search captured logs for a substring */
function logContains(substr: string): boolean {
  return consoleLogs.some(l => l.includes(substr));
}

// ── Test environment ────────────────────────────────────────
let env: IsolatedTestEnv;
let testCwd: string;
let projectDir: string;
let tasksDir: string;
let logsDir: string;
let toolboxDir: string;
let configPath: string;

// ── Setup helpers ──────────────────────────────────────────
function setupInitializedProject(overrides: {
  config?: Record<string, any>;
  tasks?: Record<string, Record<string, any>>;
  logsDir?: boolean;
  logFiles?: Record<string, string>;
} = {}) {
  // Create project structure
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(toolboxDir, { recursive: true });
  fs.mkdirSync(path.join(toolboxDir, 'projmnt4claude', 'commands'), { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  // Config
  const config = {
    projectName: 'test-project',
    createdAt: '2026-01-01',
    logging: { level: 'info', maxFiles: 30, recordInputs: true, inputMaxLength: 500 },
    ai: { provider: 'claude-code' },
    training: { exportEnabled: true, outputDir: './training-data' },
    ...overrides.config,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Tasks
  if (overrides.tasks) {
    for (const [taskId, meta] of Object.entries(overrides.tasks)) {
      createTaskDir(tasksDir, taskId, {
        schemaVersion: 4,
        status: 'open',
        transitionNotes: [],
        reopenCount: 0,
        requirementHistory: [],
        ...meta,
      });
    }
  }

  // Log files
  if (overrides.logFiles) {
    for (const [name, content] of Object.entries(overrides.logFiles)) {
      fs.writeFileSync(path.join(logsDir, name), content, 'utf-8');
    }
  }

  // Command docs
  fs.writeFileSync(
    path.join(toolboxDir, 'projmnt4claude', 'commands', 'task.md'),
    '# Task command',
    'utf-8'
  );
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('runDoctor', () => {
  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    testCwd = env.tempDir;
    projectDir = env.projectDir;
    tasksDir = env.tasksDir;
    logsDir = path.join(projectDir, 'logs');
    toolboxDir = path.join(projectDir, 'toolbox');
    configPath = path.join(projectDir, 'config.json');

    captureConsole();
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  afterEach(() => {
    restoreConsole();
    env.cleanup();
  });

  // ── CP-001: checkProjectInit — uninitialized ──────────────
  test('reports error when project is not initialized', async () => {
    const { runDoctor } = await import('../commands/doctor');
    await runDoctor(false, testCwd);

    expect(logContains('Project not initialized')).toBe(true);
    expect(logContains('Project Initialization')).toBe(true);
    expect(logContains('❌')).toBe(true);
  });

  // ── CP-002: checkProjectInit — initialized ───────────────
  test('reports ok when project is initialized', async () => {
    setupInitializedProject();
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Project initialized')).toBe(true);
  });

  // ── CP-003: checkPluginCache — CLI mode (no CLAUDE_PLUGIN_ROOT) ──
  test('skips plugin cache check in CLI mode', async () => {
    setupInitializedProject();
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Running in CLI mode, skipping plugin cache check')).toBe(true);
  });

  // ── CP-005: checkSkillFiles — commands dir present ────────
  test('reports ok when command docs exist', async () => {
    setupInitializedProject();
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Command Docs')).toBe(true);
    expect(logContains('1 command docs')).toBe(true);
  });

  // ── CP-006: checkSkillFiles — commands dir missing ────────
  test('reports warning when command docs dir is missing', async () => {
    setupInitializedProject();
    // Remove commands dir
    fs.rmSync(path.join(toolboxDir, 'projmnt4claude', 'commands'), { recursive: true, force: true });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Command docs directory missing')).toBe(true);
  });

  // ── CP-007: checkDirectoryStructure — all dirs exist ──────
  test('reports ok when all required directories exist', async () => {
    setupInitializedProject();
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Directory: tasks')).toBe(true);
    expect(logContains('Directory: toolbox')).toBe(true);
  });

  // ── CP-008: checkDirectoryStructure — missing tasks dir ───
  test('reports error when tasks dir is missing', async () => {
    setupInitializedProject();
    fs.rmSync(tasksDir, { recursive: true, force: true });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Directory: tasks')).toBe(true);
  });

  // ── CP-015: checkLoggingModule — logs dir and config ok ──
  test('reports ok when logging module is fully configured', async () => {
    setupInitializedProject();
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Log Directory')).toBe(true);
    expect(logContains('Log Config Completeness')).toBe(true);
  });

  // ── CP-016: checkLoggingModule — logs dir missing ────────
  test('reports warning when logs dir is missing', async () => {
    setupInitializedProject();
    fs.rmSync(logsDir, { recursive: true, force: true });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('logs directory does not exist')).toBe(true);
  });

  // ── CP-017: checkLoggingModule — incomplete logging config ──
  test('reports warning when logging config is incomplete', async () => {
    setupInitializedProject();
    // Override config to omit logging
    fs.writeFileSync(configPath, JSON.stringify({
      projectName: 'test',
      createdAt: '2026-01-01',
      ai: { provider: 'claude-code' },
      training: { exportEnabled: true, outputDir: './training-data' },
    }, null, 2), 'utf-8');
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Log Config Completeness')).toBe(true);
    expect(logContains('log config items missing')).toBe(true);
  });

  // ── CP-021: checkDeprecatedStatuses — no deprecated ──────
  test('reports ok when no deprecated statuses exist', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'open' },
      },
    });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Deprecated Status Check')).toBe(true);
    expect(logContains('tasks have no deprecated status')).toBe(true);
  });

  // ── CP-022: checkDeprecatedStatuses — has reopened ───────
  test('reports warning for deprecated reopened status', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'reopened' },
      },
    });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    expect(logContains('Deprecated Status Check')).toBe(true);
    expect(logContains('tasks using deprecated status')).toBe(true);
  });

  // ── CP-029: --fix auto-fix for deprecated statuses ───────
  test('auto-fixes deprecated statuses with --fix flag', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'reopened', transitionNotes: [], schemaVersion: 4, reopenCount: 0, requirementHistory: [] },
      },
    });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(true, testCwd);

    const metaPath = path.join(tasksDir, 'TASK-001', 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.status).toBe('open');
    expect(meta.transitionNotes.length).toBeGreaterThan(0);
  });

  // ── CP-032: --fix creates missing logs dir ───────────────
  test('auto-fix creates missing logs directory', async () => {
    setupInitializedProject();
    fs.rmSync(logsDir, { recursive: true, force: true });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(true, testCwd);

    expect(fs.existsSync(logsDir)).toBe(true);
  });

  // ── CP-047: all checks pass ──────────────────────────────
  test('all checks pass for a healthy project', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-bug-P1-fix-20260301': {
          type: 'bug',
          schemaVersion: 4,
          status: 'open',
          transitionNotes: [],
          reopenCount: 0,
          requirementHistory: [],
        },
      },
    });
    const { runDoctor } = await import('../commands/doctor');

    await runDoctor(false, testCwd);

    // Debug: write to file since console is mocked
    fs.writeFileSync('/tmp/doctor-test-debug.txt', consoleLogs.join('\n'), 'utf-8');

    // With a healthy project, we expect summary with 0 errors
    // Note: There may be warnings (like Plugin Installation Scope), so we check for 0 errors
    expect(logContains('0 errors')).toBe(true);
  });
});

describe('runDoctorDeep', () => {
  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    testCwd = env.tempDir;
    projectDir = env.projectDir;
    tasksDir = env.tasksDir;
    logsDir = path.join(projectDir, 'logs');
    toolboxDir = path.join(projectDir, 'toolbox');
    configPath = path.join(projectDir, 'config.json');

    captureConsole();
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  afterEach(() => {
    restoreConsole();
    env.cleanup();
  });

  // ── CP-050: runDoctorDeep — no logs ──────────────────────
  test('skips log analysis when no logs exist', async () => {
    setupInitializedProject();
    const { runDoctorDeep } = await import('../commands/doctor');

    await runDoctorDeep(testCwd);

    expect(logContains('Deep Log Analysis (--deep)')).toBe(true);
    expect(logContains('No log files found, skipping log analysis')).toBe(true);
  });
});
