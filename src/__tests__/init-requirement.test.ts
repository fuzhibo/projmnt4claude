/**
 * init-requirement.ts 单元测试
 *
 * 覆盖范围:
 * - assessComplexity: 复杂度评估算法 (10 tests)
 * - initRequirement: 需求创建主流程 (5 tests, Mock AI + fs)
 * - 质量门禁验证
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// ============== Mock Setup ==============

const mockIsInitialized = mock(() => true);
const mockGetTasksDir = mock(() => '/test/.projmnt4claude/tasks');
const mockGetAllTasks = mock(() => []);
const mockReadTaskMeta = mock((id: string) => ({
  id,
  title: 'Test Task',
  description: 'Test description',
  checkpoints: [],
  status: 'open',
}));
const mockWriteTaskMeta = mock(() => {});
const mockGenerateNewTaskId = mock(() => 'TASK-test-001');
const mockAddSubtaskToParent = mock(() => {});
const mockCreateTask = mock(() => Promise.resolve({ id: 'TASK-test-001', title: 'Test Task', priority: 'P2' }));
const mockHasValidCheckpoints = mock(() => ({ valid: true }));
const mockDisplayCheckpointWarning = mock(() => {});
const mockSyncCheckpoints = mock(() => {});
const mockFilterLowQuality = mock((cps: string[]) => ({ kept: cps, removed: [] as string[], reasons: new Map<string, string>() }));
const mockWithAI = mock((opts: any) => Promise.resolve({ aiUsed: false }));
const mockInferDeps = mock(() => []);

const mockCheckQualityGate = mock(() => Promise.resolve({
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

// Simple extractFilePaths mock matching common file path patterns
const mockExtractFilePaths = mock((desc: string) => {
  const matches = desc.match(/(?:src|lib|test|tests)\/[^\s,;，；\n"'`)}\]]+(?:\.ts|\.js|\.tsx|\.jsx|\.json|\.py)/g);
  return matches ? [...new Set(matches)] : [];
});

// Logger mock
const mockLogger = {
  logInstrumentation: mock(() => {}),
  logAICost: mock(() => {}),
  flush: mock(() => {}),
};
const mockCreateLogger = mock(() => mockLogger);

// Mock modules (bun:test hoists these above imports)
mock.module('prompts', () => ({
  default: mock(() => Promise.resolve({ confirm: true })),
}));

mock.module('fs', () => ({
  writeFileSync: mock(() => {}),
  existsSync: mock(() => false),
  rmSync: mock(() => {}),
  readdirSync: mock((_p: string, opts?: any) => {
    // detectRoleFromProject scans src/ for directories
    if (typeof _p === 'string' && _p.includes('src')) {
      return [{ name: 'commands', isDirectory: () => true }, { name: 'utils', isDirectory: () => true }];
    }
    return [];
  }),
  statSync: mock(() => ({ isFile: () => false, isDirectory: () => true })),
  mkdirSync: mock(() => {}),
  readFileSync: mock(() => ''),
}));

mock.module('../utils/path', () => ({
  isInitialized: mockIsInitialized,
  getTasksDir: mockGetTasksDir,
}));

mock.module('../utils/task', () => ({
  getAllTasks: mockGetAllTasks,
  readTaskMeta: mockReadTaskMeta,
  writeTaskMeta: mockWriteTaskMeta,
  generateNewTaskId: mockGenerateNewTaskId,
  addSubtaskToParent: mockAddSubtaskToParent,
}));

mock.module('../commands/task', () => ({
  createTask: mockCreateTask,
  hasValidCheckpoints: mockHasValidCheckpoints,
  displayCheckpointCreationWarning: mockDisplayCheckpointWarning,
}));

mock.module('../utils/quality-gate', () => ({
  checkQualityGate: mockCheckQualityGate,
  extractFilePaths: mockExtractFilePaths,
  extractAffectedFiles: mock(() => []),
  DEFAULT_QUALITY_GATE_CONFIG: { minQualityScore: 60 },
}));

mock.module('../utils/ai-helpers', () => ({
  withAIEnhancement: mockWithAI,
}));

mock.module('../utils/checkpoint', () => ({
  syncCheckpointsToMeta: mockSyncCheckpoints,
  filterLowQualityCheckpoints: mockFilterLowQuality,
}));

mock.module('../utils/logger', () => ({
  createLogger: mockCreateLogger,
}));

mock.module('../utils/dependency-engine', () => ({
  inferDependencies: mockInferDeps,
}));

// Import after mocks (bun hoists mock.module above imports)
import { assessComplexity, initRequirement } from '../commands/init-requirement';

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

function resetMocks() {
  mockIsInitialized.mockReturnValue(true);
  mockCheckQualityGate.mockReturnValue(Promise.resolve({
    passed: true,
    score: { totalScore: 85, descriptionScore: 80, checkpointScore: 90, relatedFilesScore: 85, solutionScore: 85 },
    suggestions: [],
    taskId: 'TASK-test-001',
    requiresConfirmation: false,
    missingFields: [],
    affectedFiles: [],
    changeSize: 'small',
    errorViolations: [],
    warningViolations: [],
  }));
  mockCreateTask.mockReturnValue(Promise.resolve({ id: 'TASK-test-001', title: 'Test Task', priority: 'P2' }));
  mockReadTaskMeta.mockImplementation((id: string) => ({
    id, title: 'Test Task', description: 'Test', checkpoints: [], status: 'open',
  }));
  mockGetAllTasks.mockReturnValue([]);
}

// process.exit interception
const origExit = process.exit;
let exitCode: number | null = null;

// ============== assessComplexity ==============

describe('assessComplexity', () => {

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
    const result = assessComplexity('修改 src/a.ts 和 src/b.ts', makeAnalysis());
    const sig = result.signals.find(s => s.type === 'file_count');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(16); // 2 * 8 = 16
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

  test('简单任务不生成拆分建议', () => {
    const result = assessComplexity('修复 src/button.ts 中的拼写错误', makeAnalysis());
    expect(result.splitSuggestions).toHaveLength(0);
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

  beforeEach(() => {
    resetMocks();
    exitCode = null;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as any;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  test('非交互+无AI模式成功创建任务', async () => {
    await initRequirement('添加用户登录功能', '/test', {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(mockCreateTask).toHaveBeenCalled();
  });

  test('空描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('', '/test');
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('纯空格描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('   \t\n  ', '/test');
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('单字符描述调用 process.exit(1)', async () => {
    try {
      await initRequirement('修', '/test');
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('两字符描述正常创建任务', async () => {
    await initRequirement('修复', '/test', {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(mockCreateTask).toHaveBeenCalled();
    expect(exitCode).toBeNull();
  });

  test('项目未初始化时调用 process.exit(1)', async () => {
    mockIsInitialized.mockReturnValue(false);
    try {
      await initRequirement('测试描述', '/test');
      expect.unreachable('Should have exited');
    } catch (e: any) {
      expect(e.message).toContain('process.exit(1)');
    }
    expect(exitCode).toBe(1);
  });

  test('质量门禁: --require-quality 阻止低质量任务', async () => {
    mockCheckQualityGate.mockReturnValue(Promise.resolve({
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
      await initRequirement('简单描述', '/test', {
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
    expect(mockCreateTask).toHaveBeenCalled();
  });

  test('质量门禁: 低于默认阈值时警告但不阻止', async () => {
    mockCheckQualityGate.mockReturnValue(Promise.resolve({
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
    await initRequirement('添加一个按钮', '/test', {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
    });
    expect(mockCreateTask).toHaveBeenCalled();
    expect(exitCode).toBeNull();
  });

  test('自动拆分: 高复杂度任务触发子任务创建', async () => {
    const desc = [
      '大规模重构:',
      'src/types/auth.ts src/utils/auth.ts src/commands/login.ts',
      'src/commands/logout.ts src/middleware/auth-check.ts src/services/token-service.ts',
      '需要修改所有模块、系统和服务组件',
    ].join('\n');
    await initRequirement(desc, '/test', {
      nonInteractive: true,
      noAI: true,
      noPlan: true,
      skipValidation: true,
      autoSplit: true,
    });
    // createTask called for the parent task at minimum
    expect(mockCreateTask).toHaveBeenCalled();
    // If complexity is high enough, writeTaskMeta is also called for subtasks
    // The exact number depends on the split suggestions generated
  });
});
