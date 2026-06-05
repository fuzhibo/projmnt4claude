/**
 * init-requirement.ts 单元测试
 *
 * 覆盖范围:
 * - assessComplexity: 复杂度评估算法 (10 tests)
 * - initRequirement: 需求创建主流程 (5 tests + fs)
 * - 质量门禁验证
 *
 * 迁移说明:
 * - 使用 spyOn 替代 mock.module() 避免 global 污染
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 * - 在 beforeEach 中创建 spy，在 afterEach 中 mockRestore
 */

import { describe, test, expect,  beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  createTaskDir,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== Import modules for spyOn ==============

import * as pathUtils from '../utils/path';
import * as taskUtils from '../utils/task';
import * as checkpointUtils from '../utils/checkpoint';
import * as qualityGateUtils from '../utils/quality-gate';
import * as aiHelpers from '../utils/ai-helpers';
import * as loggerUtils from '../utils/logger';
import * as dependencyEngine from '../utils/dependency-engine';
import * as taskCommand from '../commands/task';

// Import the module under test (after other imports for spyOn)
import { assessComplexity, initRequirement } from '../commands/init-requirement';

// ============== Console capture using spyOn ==============

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

function logContains(substr: string): boolean {
  return consoleLogs.some(l => l.includes(substr));
}

// ============== Test environment ==============

let env: IsolatedTestEnv;
let testCwd: string;
let tasksDir: string;

// ============== Spies for module mocking ==============

let isInitializedSpy: jest.SpyInstance;
let getTasksDirSpy: jest.SpyInstance;
let getAllTasksSpy: jest.SpyInstance;
let readTaskMetaSpy: jest.SpyInstance;
let writeTaskMetaSpy: jest.SpyInstance;
let generateNewTaskIdSpy: jest.SpyInstance;
let addSubtaskToParentSpy: jest.SpyInstance;
let createTaskSpy: jest.SpyInstance;
let hasValidCheckpointsSpy: jest.SpyInstance;
let displayCheckpointWarningSpy: jest.SpyInstance;
let syncCheckpointsSpy: jest.SpyInstance;
let filterLowQualitySpy: jest.SpyInstance;
let checkQualityGateSpy: jest.SpyInstance;
let extractFilePathsSpy: jest.SpyInstance;
let withAISpy: jest.SpyInstance;
let inferDepsSpy: jest.SpyInstance;
let createLoggerSpy: jest.SpyInstance;

// ============== Helpers ==============

function makeAnalysis(overrides: Record<string, any> = {}) {
  return {
    title: '测试任务',
    description: '测试描述',
    priority: 'P2',
    recommendedRole: 'developer',
    estimatedComplexity: 'medium' as const,
    suggestedCheckpoints: [] as string[],
    potentialDependencies: [] as string[],
    ...overrides,
  };
}

function setupProjectWithTask(taskId: string, taskMeta: Partial<any> = {}) {
  const projectDir = path.join(testCwd, '.projmnt4claude');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });

  // Create config
  const configPath = path.join(projectDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    projectName: 'test-project',
    createdAt: '2026-01-01',
  }), 'utf-8');

  // Create task directory
  createTaskDir(tasksDir, taskId, {
    schemaVersion: 6,
    status: 'open',
    transitionNotes: [],
    reopenCount: 0,
    requirementHistory: [],
    ...taskMeta,
  });
}

// process.exit interception
const origExit = process.exit;
let exitCode: number | null = null;

function setupExitInterception() {
  exitCode = null;
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as any;
}

function restoreExit() {
  process.exit = origExit;
}

// ============== assessComplexity ==============

describe('assessComplexity', () => {
  // assessComplexity is a pure function, no mocking needed

  test('简单描述返回低复杂度', () => {
    const result = assessComplexity('修复登录按钮的CSS样式问题', makeAnalysis());
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(20);
    expect(result.estimatedMinutes).toBeGreaterThanOrEqual(5);
  });

  test('中等复杂度: 多工作项+检查点', () => {
    const desc = '添加用户注册功能:\n- 创建注册表单\n- 验证输入字段\n- 保存到数据库';
    const result = assessComplexity(desc, makeAnalysis({
      suggestedCheckpoints: ['验证注册表单', '验证数据保存'],
    }));
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.workItemCount).toBeGreaterThanOrEqual(3);
  });

  test('多文件描述返回高复杂度', () => {
    const desc = [
      '重构认证系统:',
      'src/types/auth.ts',
      'src/utils/auth.ts',
      'src/commands/login.ts',
      'src/commands/logout.ts',
      'src/middleware/auth-check.ts',
      'src/services/token-service.ts',
    ].join('\n');
    const result = assessComplexity(desc, makeAnalysis({
      estimatedComplexity: 'high',
      suggestedCheckpoints: Array(10).fill('检查点'),
    }));
    expect(result.level).toBe('high');
    expect(result.fileCount).toBeGreaterThanOrEqual(4);
  });

  test('预估超过15分钟强制标记为高复杂度', () => {
    const desc = '涉及文件: src/a.ts src/b.ts src/c.ts src/d.ts';
    const result = assessComplexity(desc, makeAnalysis());
    expect(result.estimatedMinutes).toBeGreaterThanOrEqual(17);
    expect(result.level).toBe('high');
  });

  test('文件数量信号: 每文件8分上限30', () => {
    // Note: assessComplexity uses the real extractFilePaths, which extracts file paths
    // from the description. The weight is capped at 30.
    const result = assessComplexity('修改 src/a.ts 和 src/b.ts', makeAnalysis());
    const sig = result.signals.find(s => s.type === 'file_count');
    expect(sig).toBeDefined();
    // 2 files * 8 = 16, but extractFilePaths may find more patterns
    expect(sig!.weight).toBeGreaterThanOrEqual(16);
    expect(sig!.weight).toBeLessThanOrEqual(30);
  });

  test('工作项信号: 列表项和动作短语', () => {
    const desc = [
      '任务:',
      '- 修复登录bug',
      '- 创建注册页面',
      '- 添加验证逻辑',
      '- 实现密码重置',
      '- 配置邮件服务',
    ].join('\n');
    const result = assessComplexity(desc, makeAnalysis());
    expect(result.workItemCount).toBeGreaterThanOrEqual(4);
    const sig = result.signals.find(s => s.type === 'work_items');
    expect(sig!.weight).toBeGreaterThanOrEqual(20);
  });

  test('跨模块引用增加复杂度权重', () => {
    const desc = '集成用户模块、订单系统和支付模块，修改 src/auth.ts, src/order.ts, src/payment.ts';
    const result = assessComplexity(desc, makeAnalysis());
    const sig = result.signals.find(s => s.type === 'cross_module');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThan(0);
  });

  test('检查点数量信号: 每检查点4分上限15', () => {
    const cps = ['CP1', 'CP2', 'CP3', 'CP4', 'CP5'];
    const result = assessComplexity('简单任务', makeAnalysis({ suggestedCheckpoints: cps }));
    const sig = result.signals.find(s => s.type === 'checkpoint_count');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(Math.min(5 * 4, 15)); // 15 (capped)
  });


  test('评分不超过100', () => {
    const desc = [
      '巨型重构:',
      'src/a.ts src/b.ts src/c.ts src/d.ts src/e.ts src/f.ts src/g.ts src/h.ts',
      '- 修复模块A',
      '- 创建模块B',
      '- 重构模块C',
      '- 迁移模块D',
      '- 集成模块E',
      '- 更新模块F',
      '- 增强模块G',
      '- 部署模块H',
    ].join('\n');
    const result = assessComplexity(desc, makeAnalysis({
      suggestedCheckpoints: Array(20).fill('检查点'),
    }));
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ============== initRequirement ==============

describe('initRequirement', () => {

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    testCwd = env.tempDir;
    tasksDir = path.join(testCwd, '.projmnt4claude', 'tasks');

    captureConsole();
    setupExitInterception();

    // Setup spies for path utils
    isInitializedSpy = jest.spyOn(pathUtils, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = jest.spyOn(pathUtils, 'getTasksDir').mockReturnValue(tasksDir);

    // Setup spies for task utils
    getAllTasksSpy = jest.spyOn(taskUtils, 'getAllTasks').mockReturnValue([]);
    readTaskMetaSpy = jest.spyOn(taskUtils, 'readTaskMeta').mockImplementation((id: string) => ({
      id,
      title: 'Test Task',
      description: 'Test description',
      checkpoints: [],
      status: 'open',
    }));
    writeTaskMetaSpy = jest.spyOn(taskUtils, 'writeTaskMeta').mockImplementation(() => {});
    generateNewTaskIdSpy = jest.spyOn(taskUtils, 'generateNewTaskId').mockReturnValue('TASK-test-001');
    addSubtaskToParentSpy = jest.spyOn(taskUtils, 'addSubtaskToParent').mockImplementation(() => {});

    // Setup spies for task command
    createTaskSpy = jest.spyOn(taskCommand, 'createTask').mockReturnValue(Promise.resolve({
      id: 'TASK-test-001',
      title: 'Test Task',
      priority: 'P2',
    }));
    hasValidCheckpointsSpy = jest.spyOn(taskCommand, 'hasValidCheckpoints').mockReturnValue({ valid: true });
    displayCheckpointWarningSpy = jest.spyOn(taskCommand, 'displayCheckpointCreationWarning').mockImplementation(() => {});

    // Setup spies for quality gate
    checkQualityGateSpy = jest.spyOn(qualityGateUtils, 'checkQualityGate').mockReturnValue(Promise.resolve({
      passed: true,
      score: { totalScore: 85, descriptionScore: 80, checkpointScore: 90, relatedFilesScore: 85, solutionScore: 85 },
      suggestions: [] as any[],
      taskId: 'TASK-test-001',
      requiresConfirmation: false,
      missingFields: [] as string[],
      affectedFiles: [] as string[],
      changeSize: 'small' as const,
      errorViolations: [] as any[],
      warningViolations: [] as any[],
    }));
    extractFilePathsSpy = jest.spyOn(qualityGateUtils, 'extractFilePaths').mockImplementation((desc: string) => {
      const matches = desc.match(/(?:src|lib|test|tests)\/[^\s,;，；\n"'`)}\]]+(?:\.ts|\.js|\.tsx|\.jsx|\.json|\.py)/g);
      return matches ? [...new Set(matches)] : [];
    });

    // Setup spies for checkpoint utils
    syncCheckpointsSpy = jest.spyOn(checkpointUtils, 'syncCheckpointsToMeta').mockImplementation(() => {});
    filterLowQualitySpy = jest.spyOn(checkpointUtils, 'filterLowQualityCheckpoints').mockImplementation((cps: string[]) => ({
      kept: cps,
      removed: [] as string[],
      reasons: new Map<string, string>(),
    }));

    // Setup spies for AI helpers
    withAISpy = jest.spyOn(aiHelpers, 'withAIEnhancement').mockReturnValue(Promise.resolve({ aiUsed: false }));

    // Setup spies for dependency engine
    inferDepsSpy = jest.spyOn(dependencyEngine, 'inferDependencies').mockReturnValue([]);

    // Setup spies for logger
    const mockLogger = {
      logInstrumentation: jest.fn(() => {}),
      logAICost: jest.fn(() => {}),
      flush: jest.fn(() => {}),
    };
    createLoggerSpy = jest.spyOn(loggerUtils, 'createLogger').mockReturnValue(mockLogger as any);

    // Setup project structure
    setupProjectWithTask('TASK-test-001');
  });

  afterEach(() => {
    restoreConsole();
    restoreExit();

    // Restore all spies
    isInitializedSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    getAllTasksSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    generateNewTaskIdSpy.mockRestore();
    addSubtaskToParentSpy.mockRestore();
    createTaskSpy.mockRestore();
    hasValidCheckpointsSpy.mockRestore();
    displayCheckpointWarningSpy.mockRestore();
    checkQualityGateSpy.mockRestore();
    extractFilePathsSpy.mockRestore();
    syncCheckpointsSpy.mockRestore();
    filterLowQualitySpy.mockRestore();
    withAISpy.mockRestore();
    inferDepsSpy.mockRestore();
    createLoggerSpy.mockRestore();

    env.cleanup();
  });

  test('非交互+无AI模式成功创建任务', async () => {
    await initRequirement('添加用户登录功能', testCwd, {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(createTaskSpy).toHaveBeenCalled();
  });

  test('空描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('', testCwd);
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('纯空格描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('   \t\n  ', testCwd);
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('单字符描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('修', testCwd);
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('两字符描述正常创建任务', async () => {
    await initRequirement('修复', testCwd, {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(createTaskSpy).toHaveBeenCalled();
    expect(exitCode).toBeNull();
  });

  test('项目未初始化时调用 process.exit(1)', async () => {
    isInitializedSpy.mockReturnValue(false);
    try {
      await initRequirement('测试描述', testCwd);
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('质量门禁: --require-quality 阻止低质量任务', async () => {
    checkQualityGateSpy.mockReturnValue(Promise.resolve({
      passed: false,
      score: { totalScore: 45, descriptionScore: 40, checkpointScore: 50, relatedFilesScore: 45, solutionScore: 40 },
      suggestions: [
        { category: 'description', priority: 'high', message: '描述不完整', action: '补充问题描述' },
      ],
      taskId: 'TASK-test-001',
      requiresConfirmation: false,
      missingFields: ['description'],
      affectedFiles: [],
      changeSize: 'medium',
      errorViolations: [],
      warningViolations: [],
    }));
    try {
      await initRequirement('简单描述', testCwd, {
        nonInteractive: true,
        noAI: true,
        noPlan: true,
        skipValidation: true,
        requireQuality: 60,
      });
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
    // Task was created but blocked by quality gate
    expect(createTaskSpy).toHaveBeenCalled();
  });

  test('质量门禁: 低于默认阈值时警告但不阻止', async () => {
    checkQualityGateSpy.mockReturnValue(Promise.resolve({
      passed: false,
      score: { totalScore: 55, descriptionScore: 50, checkpointScore: 60, relatedFilesScore: 55, solutionScore: 50 },
      suggestions: [
        { category: 'checkpoint', priority: 'medium', message: '检查点不足', action: '添加更多检查点' },
      ],
      taskId: 'TASK-test-001',
      requiresConfirmation: false,
      missingFields: [],
      affectedFiles: [],
      changeSize: 'small',
      errorViolations: [],
      warningViolations: [],
    }));
    // No requireQuality → quality warning but no exit
    await initRequirement('添加一个按钮', testCwd, {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(createTaskSpy).toHaveBeenCalled();
    expect(exitCode).toBeNull();
  });

});