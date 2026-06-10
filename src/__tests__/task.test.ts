/**
 * task.ts 单元测试
 *
 * 测试重点:
 * - hasValidCheckpoints: 检查点内容有效性校验
 * - displayCheckpointVerificationWarnings: 验证命令缺失警告
 * - displayCheckpointCreationWarning: 创建时检查点质量提醒
 * - generateCheckpointTemplate: 检查点模板生成
 * - createTask: 任务创建（非交互模式）
 * - updateTask: 任务更新（状态/优先级/重开等）
 * - completeTask: 一键完成任务
 *
 * 迁移说明:
 * - 使用测试注入点替代 jest.mock，兼容 SWC 编译的 ESM
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== Test Injection Point Setup ==============
// 使用测试注入点替代 jest.mock，兼容 SWC 编译的 ESM

function setupMocks(mocks: Record<string, any>) {
  (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__ = {
    ...(globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__,
    ...mocks,
  };
}

function clearMocks() {
  (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__ = {};
}

// ============== hasValidCheckpoints ==============

describe('hasValidCheckpoints', () => {
  let hasValidCheckpoints: typeof import('../commands/task.js')['hasValidCheckpoints'];
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    hasValidCheckpoints = mod.hasValidCheckpoints;
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // --- Content mode (isContent=true) ---

  it('returns invalid for null content', async () => {
    const result = hasValidCheckpoints(null, false, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Validation error');
  });

  it('returns invalid for null content with isContent=true', async () => {
    const result = hasValidCheckpoints(null, true, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Validation error');
  });

  it('returns invalid for content with no checkpoint items', async () => {
    const result = hasValidCheckpoints('# Title\nSome text without checkboxes', true, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No checkpoint items in checkpoint.md');
  });

  it('returns valid for content with meaningful checkpoints', async () => {
    const content = `# TASK-001 检查点\n- [ ] 验证用户登录功能正常\n- [ ] 确认数据库迁移成功\n- [ ] API 响应格式符合规范`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('');
  });

  it('returns invalid when majority are template checkpoints (Checkpoint1, Checkpoint2)', async () => {
    const content = `# TASK-001 Checkpoints\n- [ ] Checkpoint1\n- [ ] Checkpoint2\n- [ ] Verify the feature`;
    // 2/3 are template → majority
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('template content');
  });

  it('returns valid when minority are template checkpoints', async () => {
    const content = `# TASK-001 Checkpoints\n- [ ] Checkpoint1\n- [ ] Verify login functionality\n- [ ] Confirm API is working\n- [ ] Update documentation`;
    // 1/4 are template → minority
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(true);
  });

  it('detects "完成Task" template pattern', async () => {
    const content = `# TASK-001 Checkpoints\n- [ ] 完成Task\n- [ ] 完成Task`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "待填写" template pattern', async () => {
    const content = `# TASK-001 Checkpoints\n- [ ] 待填写\n- [ ] 待填写`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "TODO" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] TODO\n- [ ] TODO`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "..." template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] ...\n- [ ] ...`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "checkpoint N" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] checkpoint 1\n- [ ] checkpoint 2`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "CP-001" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] CP-001\n- [ ] CP-002`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('detects "请替换为具体验收标准" pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 检查点1（请替换为具体验收标准）\n- [ ] 检查点2（请替换为具体验收标准）`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('template content');
  });

  it('detects "请替换.*具体" pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 请替换为具体的验收标准\n- [ ] 请替换为具体的检查内容`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(false);
  });

  // --- File mode (isContent=false) ---

  it('returns invalid when checkpoint file does not exist', async () => {
    const result = hasValidCheckpoints(path.join(env.tempDir, 'nonexistent.md'), false, env.tempDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('checkpoint.md file does not exist');
  });

  it('reads from file when isContent=false and file exists', async () => {
    const cpPath = path.join(env.tempDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, `# TASK-001 检查点\n- [ ] 验证功能A\n- [ ] 确认功能B正常`);
    const result = hasValidCheckpoints(cpPath, false, env.tempDir);
    expect(result.valid).toBe(true);
  });

  it('reads from file and detects template content', async () => {
    const cpPath = path.join(env.tempDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, `# TASK-001 Checkpoints\n- [ ] Checkpoint1\n- [ ] Checkpoint2`);
    const result = hasValidCheckpoints(cpPath, false, env.tempDir);
    expect(result.valid).toBe(false);
  });

  it('handles exact 50% template threshold (not majority)', async () => {
    // 1 out of 2 is exactly half → NOT majority → should be valid
    const content = `# TASK-001 检查点\n- [ ] 检查点1\n- [ ] 验证功能正常`;
    const result = hasValidCheckpoints(content, true, env.tempDir);
    expect(result.valid).toBe(true);
  });
});

// ============== displayCheckpointVerificationWarnings ==============

describe('displayCheckpointVerificationWarnings', () => {
  let displayCheckpointVerificationWarnings: typeof import('../commands/task.js')['displayCheckpointVerificationWarnings'];
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    displayCheckpointVerificationWarnings = mod.displayCheckpointVerificationWarnings;
    consoleSpy = jest.spyOn(console, 'log');
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await env.cleanup();
  });

  it('does not output anything when warnings array is empty', () => {
    displayCheckpointVerificationWarnings([]);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('displays warnings for missing verification commands', () => {
    displayCheckpointVerificationWarnings([
      'Checkpoint "Verify Login" uses functional_test but missing commands or steps',
    ], env.tempDir);
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('Missing Checkpoint Verification Commands');
    expect(output).toContain('1 checkpoints missing automated verification commands');
    expect(output).toContain('Verify Login');
  });

  it('displays multiple warnings', () => {
    displayCheckpointVerificationWarnings([
      'Checkpoint "A" missing commands',
      'Checkpoint "B" missing commands',
      'Checkpoint "C" missing commands',
    ], env.tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('3 checkpoints missing automated verification commands');
  });
});

// ============== displayCheckpointCreationWarning ==============

describe('displayCheckpointCreationWarning', () => {
  let displayCheckpointCreationWarning: typeof import('../commands/task.js')['displayCheckpointCreationWarning'];
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    displayCheckpointCreationWarning = mod.displayCheckpointCreationWarning;
    consoleSpy = jest.spyOn(console, 'log');
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await env.cleanup();
  });

  it('displays checkpoint quality reminder with task ID', () => {
    displayCheckpointCreationWarning('TASK-feature-P2-test-20260411', env.tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('Checkpoint Quality Reminder');
    expect(output).toContain('TASK-feature-P2-test-20260411');
    expect(output).toContain('checkpoint.md');
  });

  it('mentions analyze command for auto-generation', () => {
    displayCheckpointCreationWarning('TASK-001', env.tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('analyze');
    expect(output).toContain('--generate-checkpoints');
  });
});

// ============== generateCheckpointTemplate ==============

describe('generateCheckpointTemplate', () => {
  let generateCheckpointTemplate: typeof import('../commands/task.js')['generateCheckpointTemplate'];
  let env: IsolatedTestEnv;
  let consoleSpy: ReturnType<typeof jest.spyOn>;

  const mockTask = {
    id: 'TASK-feature-P2-test-20260411',
    title: 'Test Task',
    type: 'feature' as const,
    priority: 'P2' as const,
    status: 'open' as const,
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    generateCheckpointTemplate = mod.generateCheckpointTemplate;

    env = await createIsolatedTestEnv();

    // Create task directory
    const taskDir = path.join(env.tasksDir, 'TASK-feature-P2-test-20260411');
    fs.mkdirSync(taskDir, { recursive: true });

    // Configure mock via test injection point
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });

    consoleSpy = jest.spyOn(console, 'log');
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    clearMocks();
    await env.cleanup();
  });

  it('exits if project not initialized', async () => {
    setupMocks({
      isInitialized: () => false,
      readTaskMeta: () => ({ ...mockTask }),
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      generateCheckpointTemplate('TASK-001');
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    setupMocks({
      readTaskMeta: () => null,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      generateCheckpointTemplate('TASK-NONEXIST');
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('displays bug template for bug type', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask, type: 'bug' }),
    });
    generateCheckpointTemplate('TASK-bug-P1-fix-20260411');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('复现问题');
    expect(output).toContain('定位根本原因');
    expect(output).toContain('实现修复');
  });

  it('displays feature template by default', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });
    generateCheckpointTemplate('TASK-feature-P2-test-20260411');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('理解需求和设计');
    expect(output).toContain('实现核心功能');
    expect(output).toContain('编写单元测试');
  });

  it('displays research template', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });
    generateCheckpointTemplate('TASK-001', { type: 'research' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('明确研究目标');
    expect(output).toContain('收集相关信息');
  });

  it('displays docs template', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });
    generateCheckpointTemplate('TASK-001', { type: 'docs' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('确定文档范围和受众');
  });

  it('displays refactor template', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });
    generateCheckpointTemplate('TASK-001', { type: 'refactor' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('分析现有代码结构');
    expect(output).toContain('设计重构方案');
  });

  it('displays test template', () => {
    setupMocks({
      readTaskMeta: () => ({ ...mockTask }),
    });
    generateCheckpointTemplate('TASK-001', { type: 'test' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('确定测试范围');
    expect(output).toContain('设计测试用例');
  });
});

// ============== createTask (non-interactive mode) ==============

describe('createTask', () => {
  let createTask: typeof import('../commands/task.js')['createTask'];
  let env: IsolatedTestEnv;
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    createTask = mod.createTask;

    env = await createIsolatedTestEnv();

    // Configure mocks via test injection points
    setupMocks({
      taskExists: () => false,
      generateNewTaskId: () => 'TASK-feature-P2-test-20260411',
      writeTaskMeta: () => {},
      syncCheckpointsToMeta: () => {},
      getAllTasks: () => [],
      filterLowQualityCheckpoints: (cps: string[]) => ({
        kept: cps,
        removed: [],
        reasons: new Map(),
      }),
    });

    // Pre-create the task directory (normally writeTaskMeta creates it)
    const defaultTaskDir = path.join(env.tasksDir, 'TASK-feature-P2-test-20260411');
    fs.mkdirSync(defaultTaskDir, { recursive: true });

    consoleSpy = jest.spyOn(console, 'log');
    consoleErrorSpy = jest.spyOn(console, 'error');
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    clearMocks();
    await env.cleanup();
  });

  it('exits if project not initialized', async () => {
    setupMocks({
      isInitialized: () => false,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({ title: 'Test', nonInteractive: true }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('creates task with title and default type in non-interactive mode', async () => {
    const result = await createTask({
      title: 'Add login feature',
      nonInteractive: true,
      skipValidation: true,
    }, env.tempDir);

    expect(result.title).toBe('Add login feature');
    expect(result.status).toBe('open');
  });

  it('creates task with specified type', async () => {
    const result = await createTask({
      title: 'Fix login bug',
      type: 'bug',
      priority: 'P1',
      nonInteractive: true,
      skipValidation: true,
    }, env.tempDir);

    expect(result.title).toBe('Fix login bug');
    expect(result.priority).toBe('P1');
  });

  it('creates task with custom ID when id option provided', async () => {
    // Pre-create directory for custom ID
    fs.mkdirSync(path.join(env.tasksDir, 'TASK-custom-id'), { recursive: true });
    const result = await createTask({
      title: 'Test',
      id: 'TASK-custom-id',
      nonInteractive: true,
      skipValidation: true,
    }, env.tempDir);

    expect(result.id).toBe('TASK-custom-id');
  });

  it('rejects invalid custom task ID', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({
        title: 'Test',
        id: 'invalid id with spaces',
        nonInteractive: true,
      }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('rejects duplicate task ID', async () => {
    setupMocks({
      taskExists: () => true,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({
        title: 'Test',
        id: 'TASK-existing',
        nonInteractive: true,
      }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('writes checkpoint.md file with suggested checkpoints', async () => {
    await createTask({
      title: 'Test',
      description: 'A test task description',
      nonInteractive: true,
      skipValidation: true,
      suggestedCheckpoints: ['验证功能A', '确认功能B'],
    }, env.tempDir);

    const cpPath = path.join(env.tasksDir, 'TASK-feature-P2-test-20260411', 'checkpoint.md');
    expect(fs.existsSync(cpPath)).toBe(true);
    const content = fs.readFileSync(cpPath, 'utf-8');
    expect(content).toContain('验证功能A');
    expect(content).toContain('确认功能B');
  });

  it('adds creation history entry', async () => {
    const result = await createTask({
      title: 'Test',
      nonInteractive: true,
      skipValidation: true,
    }, env.tempDir);

    expect(result.history.length).toBeGreaterThan(0);
    const createEntry = result.history.find(h => h.action === 'TaskCreated');
    expect(createEntry).toBeDefined();
    expect(createEntry!.newValue).toBe('open');
  });
});

// ============== updateTask ==============

describe('updateTask', () => {
  let updateTask: typeof import('../commands/task.js')['updateTask'];
  let env: IsolatedTestEnv;
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  const baseTask = (): import('../types/task').TaskMeta => ({
    id: 'TASK-feature-P2-test-20260411',
    title: 'Test Task',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  });

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    updateTask = mod.updateTask;
    env = await createIsolatedTestEnv();

    // Configure mocks via test injection points
    setupMocks({
      readTaskMeta: () => null,
      writeTaskMeta: () => {},
    });

    consoleSpy = jest.spyOn(console, 'log');
    consoleErrorSpy = jest.spyOn(console, 'error');
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    clearMocks();
    await env.cleanup();
  });

  it('exits if project not initialized', async () => {
    setupMocks({
      isInitialized: () => false,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask('TASK-001', { title: 'New Title' }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    setupMocks({
      readTaskMeta: () => null,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask('TASK-NONEXIST', { title: 'New' }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('updates task title', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { title: 'Updated Title' }, env.tempDir);
    expect(task.title).toBe('Updated Title');
  });

  it('updates task priority', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { priority: 'P0' }, env.tempDir);
    expect(task.priority).toBe('P0');
  });

  it('updates task status to in_progress', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { status: 'in_progress' }, env.tempDir);
    expect(task.status).toBe('in_progress');
  });

  it('handles reopened status: maps to open + increments reopenCount', async () => {
    const task = baseTask();
    task.status = 'resolved';
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { status: 'reopened' }, env.tempDir);
    expect(task.status).toBe('open');
    expect(task.reopenCount).toBe(1);
    // Should have transitionNotes
    expect(task.transitionNotes!.length).toBeGreaterThan(0);
    // Should have history entry
    const reopenEntry = task.history.find(h => h.action.includes('TaskReopen'));
    expect(reopenEntry).toBeDefined();
  });

  it('increments reopenCount on multiple reopens', async () => {
    const task = baseTask();
    task.status = 'resolved';
    task.reopenCount = 2;
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { status: 'reopened' }, env.tempDir);
    expect(task.reopenCount).toBe(3);
  });

  it('clears failureReason when reopening from failed status', async () => {
    const task = baseTask();
    task.status = 'failed';
    (task as any).failureReason = 'timeout';
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { status: 'reopened' }, env.tempDir);
    expect((task as any).failureReason).toBeUndefined();
  });

  it('updates task description', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { description: 'New description' }, env.tempDir);
    expect(task.description).toBe('New description');
  });

  it('updates recommended role', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { role: 'executor' }, env.tempDir);
    expect(task.recommendedRole).toBe('executor');
  });

  it('updates branch', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, { branch: 'feature/login' }, env.tempDir);
    expect(task.branch).toBe('feature/login');
  });

  it('shows "no updates" when no fields specified', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    await updateTask(task.id, {}, env.tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('No fields specified for update');
  });

  it('requires token for resolved status when checkpoints exist', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    setupMocks({
      readTaskMeta: () => task,
    });

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(env.tasksDir, task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [ ] unchecked item');

    await updateTask(task.id, { status: 'resolved' }, env.tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('Checkpoint Confirmation Reminder');
  });

  it('resolves directly when no checkpoint file exists', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    setupMocks({
      readTaskMeta: () => task,
    });
    // No checkpoint file created → should resolve directly

    await updateTask(task.id, { status: 'resolved' }, env.tempDir);
    expect(task.status).toBe('resolved');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('updated to resolved status');
  });

  it('rejects invalid token for resolved status', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    task.checkpointConfirmationToken = 'valid-token';
    setupMocks({
      readTaskMeta: () => task,
    });

    // Create checkpoint with all checked items
    const cpDir = path.join(env.tasksDir, task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [x] checked item');

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask(task.id, { status: 'resolved', token: 'wrong-token' }, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('accepts valid token for resolved status', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    task.checkpointConfirmationToken = 'valid-token';
    setupMocks({
      readTaskMeta: () => task,
    });

    const cpDir = path.join(env.tasksDir, task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [x] checked item');

    await updateTask(task.id, { status: 'resolved', token: 'valid-token' }, env.tempDir);
    expect(task.status).toBe('resolved');
    expect(task.checkpointConfirmationToken).toBeUndefined();
  });
});

// ============== reopenTask ==============

describe('reopenTask', () => {
  let reopenTask: typeof import('../commands/task.js')['reopenTask'];
  let env: IsolatedTestEnv;
  let consoleSpy: ReturnType<typeof jest.spyOn>;

  const baseTask = (): import('../types/task').TaskMeta => ({
    id: 'TASK-feature-P2-test-20260411',
    title: 'Test Task',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  });

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    const mod = await import('../commands/task.js');
    reopenTask = mod.reopenTask;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Configure mocks via test injection points
    setupMocks({
      readTaskMeta: () => null,
      writeTaskMeta: () => {},
    });
  });

  afterEach(async () => {
    await env.cleanup();
    consoleSpy.mockRestore();
    clearMocks();
  });

  it('reopens resolved task with all options', async () => {
    const task = baseTask();
    task.status = 'resolved';
    task.reopenCount = 0;
    setupMocks({
      readTaskMeta: () => task,
    });

    await reopenTask(task.id, {
      enhancement: true,
      failedCheckpoints: 'CP-1,CP-2',
      qaFeedback: 'QA found issues',
    }, env.tempDir);

    expect(task.status).toBe('open');
    expect(task.reopenCount).toBe(1);
    expect(task.reopenRecords).toHaveLength(1);
    expect(task.reopenRecords![0].enhancementRequest).toBe(true);
    expect(task.reopenRecords![0].failedCheckpoints).toEqual(['CP-1', 'CP-2']);
    expect(task.reopenRecords![0].qaFeedback).toBe('QA found issues');
    expect(task.transitionNotes).toHaveLength(1);
    expect(task.transitionNotes![0].note).toContain('[Enhancement]');
    expect(task.transitionNotes![0].note).toContain('[Failed CPs: CP-1, CP-2]');
  });

  it('reopens closed task without options', async () => {
    const task = baseTask();
    task.status = 'closed';
    setupMocks({
      readTaskMeta: () => task,
    });

    await reopenTask(task.id, {}, env.tempDir);

    expect(task.status).toBe('open');
    expect(task.reopenCount).toBe(1);
    expect(task.reopenRecords).toHaveLength(1);
    expect(task.reopenRecords![0].enhancementRequest).toBe(false);
  });

  it('reopens failed task and clears failureReason', async () => {
    const task = baseTask();
    task.status = 'failed';
    (task as any).failureReason = 'timeout';
    setupMocks({
      readTaskMeta: () => task,
    });

    await reopenTask(task.id, {}, env.tempDir);

    expect(task.status).toBe('open');
    expect((task as any).failureReason).toBeUndefined();
  });

  it('increments reopenCount on multiple reopens', async () => {
    const task = baseTask();
    task.status = 'resolved';
    task.reopenCount = 2;
    task.reopenRecords = [{ timestamp: '2024-01-01', reason: 'First reopen' }];
    setupMocks({
      readTaskMeta: () => task,
    });

    await reopenTask(task.id, {}, env.tempDir);

    expect(task.reopenCount).toBe(3);
    expect(task.reopenRecords).toHaveLength(2);
  });

  it('exits if task does not exist', async () => {
    setupMocks({
      readTaskMeta: () => null,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    try {
      await reopenTask('NON-EXISTENT', {}, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task status is not reopenable', async () => {
    const task = baseTask();
    task.status = 'open';
    setupMocks({
      readTaskMeta: () => task,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    try {
      await reopenTask(task.id, {}, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ============== completeTask ==============

describe('completeTask', () => {
  let completeTask: typeof import('../commands/task.js')['completeTask'];
  let env: IsolatedTestEnv;
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  const baseTask = (): import('../types/task').TaskMeta => ({
    id: 'TASK-feature-P2-test-20260411',
    title: 'Test Task',
    type: 'feature',
    priority: 'P2',
    status: 'in_progress',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  });

  beforeEach(async () => {
    const mod = await import('../commands/task.js');
    completeTask = mod.completeTask;
    env = await createIsolatedTestEnv();

    // Configure mocks via test injection points
    setupMocks({
      readTaskMeta: () => null,
      writeTaskMeta: () => {},
    });

    consoleSpy = jest.spyOn(console, 'log');
    consoleErrorSpy = jest.spyOn(console, 'error');
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    clearMocks();
    await env.cleanup();
  });

  it('exits if project not initialized', async () => {
    setupMocks({
      isInitialized: () => false,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await completeTask('TASK-001', {}, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    setupMocks({
      readTaskMeta: () => null,
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await completeTask('TASK-NONEXIST', {}, env.tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('completes task and sets status to resolved', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });

    // No checkpoint file → no unchecked checkpoints
    await completeTask(task.id, { yes: true }, env.tempDir);

    expect(task.status).toBe('resolved');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('Completed');
  });

  it('auto-marks unchecked checkpoints when using yes flag', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(env.tasksDir, task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    const cpPath = path.join(cpDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, '# Checkpoints\n- [ ] unchecked item 1\n- [ ] unchecked item 2\n');

    await completeTask(task.id, { yes: true }, env.tempDir);

    expect(task.status).toBe('resolved');
    // Verify writeFileSync was called with [x] content
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('All checkpoints auto-marked as completed');
  });

  it('shows unchecked checkpoints warning in non-yes mode and user cancels', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
      // Mock prompts to reject (user cancels marking checkpoints)
      prompts: () => Promise.resolve({ proceed: false }),
    });

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(env.tasksDir, task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [ ] unchecked item');

    await completeTask(task.id, { yes: false }, env.tempDir);

    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('Cancelled');
  });

  it('completes task without checkpoint file', async () => {
    const task = baseTask();
    setupMocks({
      readTaskMeta: () => task,
    });
    // No checkpoint file created

    await completeTask(task.id, { yes: true }, env.tempDir);

    expect(task.status).toBe('resolved');
  });
});
