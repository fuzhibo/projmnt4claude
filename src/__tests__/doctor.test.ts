/**
 * doctor.ts 单元测试
 *
 * 覆盖: runDoctor, runBugReport, runDoctorDeep
 *       checkProjectInit, checkPluginCache, checkSkillFiles,
 *       checkDirectoryStructure,
 *       checkLoggingModule, checkDeprecatedStatuses,
 *       checkPluginInstallationScope,
 *       fixIssues (via --fix), displayResults
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import path from 'path';

// ── Helpers ────────────────────────────────────────────────
const CWD = '/tmp/test-doctor-project';
const PROJECT_DIR = path.join(CWD, '.projmnt4claude');
const TASKS_DIR = path.join(PROJECT_DIR, 'tasks');
const TOOLBOX_DIR = path.join(PROJECT_DIR, 'toolbox');
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');

// ── Console capture ────────────────────────────────────────
const consoleLogs: string[] = [];
const origLog = console.log;
const origError = console.error;

function captureConsole() {
  consoleLogs.length = 0;
  console.log = mock((...args: any[]) => {
    consoleLogs.push(args.map(String).join(' '));
  });
  console.error = mock((...args: any[]) => {
    consoleLogs.push('[ERROR] ' + args.map(String).join(' '));
  });
}

function restoreConsole() {
  console.log = origLog;
  console.error = origError;
}

/** Search captured logs for a substring */
function logContains(substr: string): boolean {
  return consoleLogs.some(l => l.includes(substr));
}

// ── FS state (in-memory) ──────────────────────────────────
let fsState: Record<string, string | null> = {}; // null = directory

function fsReset() {
  fsState = {};
}

function fsSet(filePath: string, content: string) {
  fsState[filePath] = content;
}

function fsMkdir(filePath: string) {
  fsState[filePath] = null;
}

function fsExists(filePath: string): boolean {
  return filePath in fsState;
}

function fsRead(filePath: string): string {
  if (!(filePath in fsState)) throw new Error(`ENOENT: ${filePath}`);
  const v = fsState[filePath];
  if (v === null) throw new Error(`EISDIR: ${filePath}`);
  return v;
}

function fsIsDir(filePath: string): boolean {
  return filePath in fsState && fsState[filePath] === null;
}

function fsReaddir(dirPath: string): string[] {
  const prefix = dirPath + path.sep;
  const entries = new Set<string>();
  for (const key of Object.keys(fsState)) {
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      const first = rest.split(path.sep)[0];
      if (first) entries.add(first);
    }
  }
  return [...entries];
}

function fsStatSize(filePath: string): number {
  const v = fsState[filePath];
  if (v === null) return 0;
  return Buffer.byteLength(v, 'utf-8');
}

// ── Mock functions ─────────────────────────────────────────
const mockIsInitialized = mock((cwd: string) => fsExists(CONFIG_PATH));
const mockGetProjectDir = mock((cwd: string) => PROJECT_DIR);
const mockGetTasksDir = mock((cwd: string) => TASKS_DIR);
const mockGetToolboxDir = mock((cwd: string) => TOOLBOX_DIR);
const mockGetLogsDir = mock((cwd: string) => LOGS_DIR);

const mockGetAllTaskIds = mock((cwd: string) => {
  if (!fsExists(TASKS_DIR)) return [];
  return fsReaddir(TASKS_DIR);
});

const mockReadConfig = mock((cwd: string) => {
  if (!fsExists(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fsRead(CONFIG_PATH));
  } catch {
    return null;
  }
});

const mockWriteConfig = mock((config: any, cwd: string) => {
  fsSet(CONFIG_PATH, JSON.stringify(config, null, 2));
});

const mockEnsureConfigDefaults = mock((config: any) => {
  return {
    ...config,
    logging: config.logging || { level: 'info', maxFiles: 30, recordInputs: true, inputMaxLength: 500 },
    ai: config.ai || { provider: 'claude-code' },
    training: config.training || { exportEnabled: true, outputDir: './training-data' },
  };
});

// ── Mock modules ───────────────────────────────────────────
mock.module('../utils/path', () => ({
  isInitialized: mockIsInitialized,
  getProjectDir: mockGetProjectDir,
  getConfigPath: (cwd: string) => CONFIG_PATH,
  getTasksDir: mockGetTasksDir,
  getToolboxDir: mockGetToolboxDir,
  getLogsDir: mockGetLogsDir,
  getArchiveDir: (cwd: string) => path.join(PROJECT_DIR, 'archive'),
  ensureDir: (dir: string) => { fsMkdir(dir); },
}));

mock.module('../utils/task', () => ({
  getAllTaskIds: mockGetAllTaskIds,
}));

mock.module('../utils/format', () => ({
  SEPARATOR_WIDTH: 60,
}));

mock.module('../utils/logger', () => ({
  Logger: class MockLogger {
    generateBugReport() { return { markdown: '# Bug Report\nAll good', archivePath: '/tmp/report.tar.gz' }; }
    getCostSummary() {
      return { totalCalls: 10, totalDurationMs: 5000, totalTokens: 1000, totalInputTokens: 600, totalOutputTokens: 400, byField: {} };
    }
    analyzeUsage() {
      return { totalCommands: 20, averageDurationMs: 250, aiUsageRate: 0.5, totalErrors: 1, totalWarnings: 2, commandFrequency: { task: 10, plan: 5 }, commonErrors: [{ message: 'timeout', count: 1 }] };
    }
  },
}));

mock.module('./config', () => ({
  readConfig: mockReadConfig,
  writeConfig: mockWriteConfig,
  ensureConfigDefaults: mockEnsureConfigDefaults,
}));

mock.module('../utils/log-analyzer', () => ({
  LogCollector: class MockLogCollector {
    getStats() { return { fileCount: 0, totalSizeKB: 0 }; }
    collectSince() { return []; }
  },
  LogAnalyzerRegistry: class MockLogAnalyzerRegistry {
    analyzers: any[] = [];
    register(a: any) { this.analyzers.push(a); }
    get size() { return this.analyzers.length; }
    getAll() { return this.analyzers; }
    async runAll() { return []; }
  },
  AnalysisReporter: class MockAnalysisReporter {
    buildReport() { return { summary: { totalFindings: 0, bySeverity: {} } }; }
    formatText() { return ''; }
  },
}));

mock.module('../utils/log-analyzers', () => ({
  getBuiltInAnalyzers: () => [{ name: 'error', category: 'health', supportedStrategies: ['rule'] }],
}));

// fs mock — must be last, as it replaces the global fs module
mock.module('fs', () => ({
  existsSync: (p: string) => fsExists(p),
  readFileSync: (p: string) => fsRead(p),
  writeFileSync: (p: string, content: string) => { fsSet(p, content); },
  readdirSync: (p: string) => fsReaddir(p),
  statSync: (p: string) => ({ size: fsStatSize(p), isDirectory: () => fsIsDir(p) }),
  mkdirSync: (p: string) => { fsMkdir(p); },
  copyFileSync: (src: string, dest: string) => { fsSet(dest, fsRead(src)); },
}));

// ── Import SUT ─────────────────────────────────────────────
import { runDoctor, runBugReport, runDoctorDeep } from '../commands/doctor';

// ── Setup helpers ──────────────────────────────────────────
/** Create a fully-initialized project structure */
function setupInitializedProject(overrides: {
  config?: Record<string, any>;
  tasks?: Record<string, Record<string, any>>;
  logsDir?: boolean;
  logFiles?: Record<string, string>;
} = {}) {
  fsReset();
  // project dir structure
  fsMkdir(PROJECT_DIR);
  fsMkdir(TASKS_DIR);
  fsMkdir(TOOLBOX_DIR);
  fsMkdir(path.join(TOOLBOX_DIR, 'projmnt4claude'));
  fsMkdir(path.join(TOOLBOX_DIR, 'projmnt4claude', 'commands'));
  fsMkdir(LOGS_DIR);

  // config
  const config = {
    projectName: 'test-project',
    createdAt: '2026-01-01',
    logging: { level: 'info', maxFiles: 30, recordInputs: true, inputMaxLength: 500 },
    ai: { provider: 'claude-code' },
    training: { exportEnabled: true, outputDir: './training-data' },
    ...overrides.config,
  };
  fsSet(CONFIG_PATH, JSON.stringify(config));

  // tasks
  if (overrides.tasks) {
    for (const [taskId, meta] of Object.entries(overrides.tasks)) {
      const taskDir = path.join(TASKS_DIR, taskId);
      fsMkdir(taskDir);
      fsSet(path.join(taskDir, 'meta.json'), JSON.stringify({
        schemaVersion: 4,
        status: 'open',
        transitionNotes: [],
        reopenCount: 0,
        requirementHistory: [],
        ...meta,
      }));
    }
  }

  // logs
  if (overrides.logFiles) {
    for (const [name, content] of Object.entries(overrides.logFiles)) {
      fsSet(path.join(LOGS_DIR, name), content);
    }
  }

  // command docs
  fsSet(path.join(TOOLBOX_DIR, 'projmnt4claude', 'commands', 'task.md'), '# Task command');

  mockIsInitialized.mockImplementation(() => fsExists(CONFIG_PATH));
  mockGetAllTaskIds.mockImplementation(() => {
    if (!fsExists(TASKS_DIR)) return [];
    return fsReaddir(TASKS_DIR);
  });
  mockReadConfig.mockImplementation(() => {
    try { return JSON.parse(fsRead(CONFIG_PATH)); } catch { return null; }
  });
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('runDoctor', () => {
  beforeEach(() => {
    captureConsole();
    // Clear env
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  afterEach(() => {
    restoreConsole();
  });

  // ── CP-001: checkProjectInit — uninitialized ──────────────
  test('reports error when project is not initialized', async () => {
    fsReset();
    mockIsInitialized.mockImplementation(() => false);
    mockGetProjectDir.mockImplementation(() => PROJECT_DIR);

    await runDoctor(false, CWD);

    expect(logContains('项目未初始化')).toBe(true);
    expect(logContains('项目初始化')).toBe(true);
    expect(logContains('❌')).toBe(true);
  });

  // ── CP-002: checkProjectInit — initialized ───────────────
  test('reports ok when project is initialized', async () => {
    setupInitializedProject();

    await runDoctor(false, CWD);

    expect(logContains('项目已初始化')).toBe(true);
  });

  // ── CP-003: checkPluginCache — CLI mode (no CLAUDE_PLUGIN_ROOT) ──
  test('skips plugin cache check in CLI mode', async () => {
    setupInitializedProject();
    delete process.env.CLAUDE_PLUGIN_ROOT;

    await runDoctor(false, CWD);

    expect(logContains('CLI 模式运行，跳过插件缓存检查')).toBe(true);
  });

  // ── CP-004: checkPluginCache — plugin mode, missing main file ────
  test('reports error when plugin main file is missing', async () => {
    setupInitializedProject();
    process.env.CLAUDE_PLUGIN_ROOT = '/tmp/fake-plugin-root';

    await runDoctor(false, CWD);

    expect(logContains('主程序文件缺失')).toBe(true);

    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  // ── CP-005: checkSkillFiles — commands dir present ────────
  test('reports ok when command docs exist', async () => {
    setupInitializedProject();

    await runDoctor(false, CWD);

    expect(logContains('命令文档')).toBe(true);
    expect(logContains('1 个命令文档')).toBe(true);
  });

  // ── CP-006: checkSkillFiles — commands dir missing ────────
  test('reports warning when command docs dir is missing', async () => {
    setupInitializedProject();
    // Remove commands dir
    delete fsState[path.join(TOOLBOX_DIR, 'projmnt4claude', 'commands')];

    await runDoctor(false, CWD);

    expect(logContains('命令文档目录缺失')).toBe(true);
  });

  // ── CP-007: checkDirectoryStructure — all dirs exist ──────
  test('reports ok when all required directories exist', async () => {
    setupInitializedProject();

    await runDoctor(false, CWD);

    expect(logContains('目录: tasks')).toBe(true);
    expect(logContains('目录: toolbox')).toBe(true);
  });

  // ── CP-008: checkDirectoryStructure — missing tasks dir ───
  test('reports error when tasks dir is missing', async () => {
    setupInitializedProject();
    delete fsState[TASKS_DIR];

    await runDoctor(false, CWD);

    expect(logContains('目录: tasks')).toBe(true);
  });

  // ── CP-015: checkLoggingModule — logs dir and config ok ──
  test('reports ok when logging module is fully configured', async () => {
    setupInitializedProject();

    await runDoctor(false, CWD);

    expect(logContains('日志目录')).toBe(true);
    expect(logContains('日志配置完整性')).toBe(true);
  });

  // ── CP-016: checkLoggingModule — logs dir missing ────────
  test('reports warning when logs dir is missing', async () => {
    setupInitializedProject();
    delete fsState[LOGS_DIR];

    await runDoctor(false, CWD);

    expect(logContains('logs 目录不存在')).toBe(true);
  });

  // ── CP-017: checkLoggingModule — incomplete logging config ──
  test('reports warning when logging config is incomplete', async () => {
    setupInitializedProject();
    // Override config to omit logging
    fsSet(CONFIG_PATH, JSON.stringify({
      projectName: 'test',
      createdAt: '2026-01-01',
      ai: { provider: 'claude-code' },
      training: { exportEnabled: true, outputDir: './training-data' },
    }));
    mockReadConfig.mockImplementation(() => JSON.parse(fsRead(CONFIG_PATH)));

    await runDoctor(false, CWD);

    expect(logContains('日志配置完整性')).toBe(true);
    expect(logContains('日志配置项缺失')).toBe(true);
  });

  // ── CP-018: checkLoggingModule — oversized log files ─────
  test('reports warning for oversized log files', async () => {
    // Create a file > 10MB
    const bigContent = 'x'.repeat(11 * 1024 * 1024);
    setupInitializedProject({
      logFiles: { 'huge.log': bigContent },
    });

    await runDoctor(false, CWD);

    expect(logContains('日志健康')).toBe(true);
    expect(logContains('超过 10MB')).toBe(true);
  });

  // ── CP-021: checkDeprecatedStatuses — no deprecated ──────
  test('reports ok when no deprecated statuses exist', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'open' },
      },
    });

    await runDoctor(false, CWD);

    expect(logContains('废弃状态检测')).toBe(true);
    expect(logContains('无废弃状态残留')).toBe(true);
  });

  // ── CP-022: checkDeprecatedStatuses — has reopened ───────
  test('reports warning for deprecated reopened status', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'reopened' },
      },
    });

    await runDoctor(false, CWD);

    expect(logContains('废弃状态检测')).toBe(true);
    expect(logContains('使用废弃状态')).toBe(true);
  });

  // ── CP-023: checkDeprecatedStatuses — has needs_human ────
  test('reports warning for deprecated needs_human status', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'needs_human' },
      },
    });

    await runDoctor(false, CWD);

    expect(logContains('废弃状态检测')).toBe(true);
    expect(logContains('使用废弃状态')).toBe(true);
  });

  // ── CP-026: displayResults — summary counts ──────────────
  test('displays summary with error and warning counts', async () => {
    fsReset();
    mockIsInitialized.mockImplementation(() => false);
    mockGetProjectDir.mockImplementation(() => PROJECT_DIR);

    await runDoctor(false, CWD);

    expect(logContains('汇总')).toBe(true);
  });

  // ── CP-027: --fix hint when fixable issues exist ─────────
  test('suggests --fix when fixable issues exist', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'reopened' },
      },
    });

    await runDoctor(false, CWD);

    expect(logContains('--fix')).toBe(true);
  });

  // ── CP-029: --fix auto-fix for deprecated statuses ───────
  test('auto-fixes deprecated statuses with --fix flag', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'reopened', transitionNotes: [], schemaVersion: 4, reopenCount: 0, requirementHistory: [] },
      },
    });

    await runDoctor(true, CWD);

    const metaContent = fsRead(path.join(TASKS_DIR, 'TASK-001', 'meta.json'));
    const meta = JSON.parse(metaContent);
    expect(meta.status).toBe('open');
    expect(meta.transitionNotes.length).toBeGreaterThan(0);
  });

  // ── CP-030: --fix auto-fix for missing transitionNotes ───
  test('auto-fixes missing transitionNotes with --fix flag', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'open', schemaVersion: 4, reopenCount: 0, requirementHistory: [] },
      },
    });

    await runDoctor(true, CWD);

    const metaContent = fsRead(path.join(TASKS_DIR, 'TASK-001', 'meta.json'));
    const meta = JSON.parse(metaContent);
    expect(meta.transitionNotes).toBeDefined();
    expect(Array.isArray(meta.transitionNotes)).toBe(true);
  });

  // ── CP-032: --fix creates missing logs dir ───────────────
  test('auto-fix creates missing logs directory', async () => {
    setupInitializedProject();
    delete fsState[LOGS_DIR];

    await runDoctor(true, CWD);

    expect(fsExists(LOGS_DIR)).toBe(true);
  });

  // ── CP-034: --fix auto-fixes config completeness ────────
  test('auto-fix completes missing logging config', async () => {
    setupInitializedProject();
    // Override config to omit logging/ai/training
    fsSet(CONFIG_PATH, JSON.stringify({
      projectName: 'test',
      createdAt: '2026-01-01',
    }));
    mockReadConfig.mockImplementation(() => JSON.parse(fsRead(CONFIG_PATH)));

    await runDoctor(true, CWD);

    // Verify config was updated via mocked fs.writeFileSync
    const updatedConfig = JSON.parse(fsRead(CONFIG_PATH));
    expect(updatedConfig.logging).toBeDefined();
    expect(updatedConfig.ai).toBeDefined();
    expect(updatedConfig.training).toBeDefined();
  });

  // ── CP-035: checkPluginInstallationScope — no installed_plugins.json ──
  test('returns empty when installed_plugins.json does not exist', async () => {
    setupInitializedProject();

    await runDoctor(false, CWD);

    // No plugin scope warnings
    expect(logContains('插件安装作用域')).toBe(false);
  });

  // ── CP-036: checkPluginInstallationScope — project-scope mismatch ──
  test('warns about project-scope installation mismatch', async () => {
    setupInitializedProject();
    const homeDir = process.env.HOME || '/tmp';
    const pluginsDir = path.join(homeDir, '.claude', 'plugins');
    fsMkdir(pluginsDir);
    fsSet(path.join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      plugins: {
        'projmnt4claude@projmnt4claude': [
          { scope: 'project', projectPath: '/other/project', version: '1.0.0' },
        ],
      },
    }));

    await runDoctor(false, CWD);

    expect(logContains('插件安装作用域')).toBe(true);
    expect(logContains('project-scope')).toBe(true);
  });

  // ── CP-039: checkTaskSpecificationAlignment — no tasks dir ──
  test('reports ok when tasks dir does not exist', async () => {
    setupInitializedProject();
    delete fsState[TASKS_DIR];
    mockGetAllTaskIds.mockImplementation(() => []);

    await runDoctor(false, CWD);

    expect(logContains('任务目录不存在')).toBe(true);
  });

  // ── CP-042: checkDirectoryStructure — archive with abandoned tasks ──
  test('reports warning when abandoned tasks exist but archive dir missing', async () => {
    setupInitializedProject({
      tasks: {
        'TASK-001': { status: 'abandoned' },
      },
    });
    // archive dir not created by default
    const archiveDir = path.join(PROJECT_DIR, 'archive');
    delete fsState[archiveDir];

    await runDoctor(false, CWD);

    expect(logContains('archive')).toBe(true);
    expect(logContains('archive 目录缺失')).toBe(true);
  });

  // ── CP-045: checkLoggingModule — AI config missing ───────
  test('reports warning when AI config is missing', async () => {
    setupInitializedProject();
    // Override config to omit ai
    fsSet(CONFIG_PATH, JSON.stringify({
      projectName: 'test',
      createdAt: '2026-01-01',
      logging: { level: 'info', maxFiles: 30, recordInputs: true, inputMaxLength: 500 },
      training: { exportEnabled: true, outputDir: './training-data' },
    }));
    mockReadConfig.mockImplementation(() => JSON.parse(fsRead(CONFIG_PATH)));

    await runDoctor(false, CWD);

    expect(logContains('AI 配置完整性')).toBe(true);
    expect(logContains('ai.provider 配置缺失')).toBe(true);
  });

  // ── CP-046: checkLoggingModule — training config missing ─
  test('reports warning when training config is missing', async () => {
    setupInitializedProject();
    // Override config to omit training
    fsSet(CONFIG_PATH, JSON.stringify({
      projectName: 'test',
      createdAt: '2026-01-01',
      logging: { level: 'info', maxFiles: 30, recordInputs: true, inputMaxLength: 500 },
      ai: { provider: 'claude-code' },
    }));
    mockReadConfig.mockImplementation(() => JSON.parse(fsRead(CONFIG_PATH)));

    await runDoctor(false, CWD);

    expect(logContains('训练数据配置完整性')).toBe(true);
    expect(logContains('training.* 配置缺失')).toBe(true);
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

    await runDoctor(false, CWD);

    expect(logContains('所有检查通过')).toBe(true);
  });
});

describe('runBugReport', () => {
  beforeEach(() => {
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
  });

  // ── CP-048: runBugReport — uninitialized ─────────────────
  test('exits with error when project not initialized', async () => {
    fsReset();
    mockIsInitialized.mockImplementation(() => false);

    // Mock process.exit to throw
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as any;

    try {
      await runBugReport(CWD);
    } catch (e: any) {
      expect(e.message).toBe('process.exit:1');
    }

    process.exit = origExit;
  });

  // ── CP-049: runBugReport — success ───────────────────────
  test('generates bug report for initialized project', async () => {
    setupInitializedProject();

    await runBugReport(CWD);

    expect(logContains('Bug 报告')).toBe(true);
    expect(logContains('Bug 报告已生成')).toBe(true);
    expect(logContains('AI 成本汇总')).toBe(true);
    expect(logContains('使用分析')).toBe(true);
  });
});

describe('runDoctorDeep', () => {
  beforeEach(() => {
    captureConsole();
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  afterEach(() => {
    restoreConsole();
  });

  // ── CP-050: runDoctorDeep — no logs ──────────────────────
  test('skips log analysis when no logs exist', async () => {
    setupInitializedProject();

    await runDoctorDeep(CWD);

    expect(logContains('深度日志分析')).toBe(true);
    expect(logContains('未找到日志文件')).toBe(true);
  });
});
