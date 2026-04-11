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
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============== hasValidCheckpoints ==============

// Import the module under test - we use dynamic import to allow mocking
const taskModule = () => import('../commands/task.js');

// ============== hasValidCheckpoints (pure-ish, uses fs) ==============

describe('hasValidCheckpoints', () => {
  let hasValidCheckpoints: typeof import('../commands/task.js')['hasValidCheckpoints'];
  let tempDir: string;

  beforeEach(async () => {
    const mod = await taskModule();
    hasValidCheckpoints = mod.hasValidCheckpoints;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // --- Content mode (isContent=true) ---

  it('returns invalid for null content', async () => {
    const result = hasValidCheckpoints(null, false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('无检查点内容');
  });

  it('returns invalid for null content with isContent=true', async () => {
    const result = hasValidCheckpoints(null, true);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('无检查点内容');
  });

  it('returns invalid for content with no checkpoint items', async () => {
    const result = hasValidCheckpoints('# Title\nSome text without checkboxes', true);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('checkpoint.md 中没有检查点项');
  });

  it('returns valid for content with meaningful checkpoints', async () => {
    const content = `# TASK-001 检查点\n- [ ] 验证用户登录功能正常\n- [ ] 确认数据库迁移成功\n- [ ] API 响应格式符合规范`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('');
  });

  it('returns invalid when majority are template checkpoints (检查点1, 检查点2)', async () => {
    const content = `# TASK-001 检查点\n- [ ] 检查点1\n- [ ] 检查点2\n- [ ] 验证功能`;
    // 2/3 are template → majority
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('模板内容');
  });

  it('returns valid when minority are template checkpoints', async () => {
    const content = `# TASK-001 检查点\n- [ ] 检查点1\n- [ ] 验证登录功能\n- [ ] 确认 API 正常\n- [ ] 更新文档`;
    // 1/4 are template → minority
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(true);
  });

  it('detects "完成任务" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 完成任务\n- [ ] 完成任`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "待填写" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 待填写\n- [ ] 待填写`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "TODO" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] TODO\n- [ ] TODO`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "..." template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] ...\n- [ ] ...`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "checkpoint N" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] checkpoint 1\n- [ ] checkpoint 2`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "CP-001" template pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] CP-001\n- [ ] CP-002`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  it('detects "请替换为具体验收标准" pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 检查点1（请替换为具体验收标准）\n- [ ] 检查点2（请替换为具体验收标准）`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('模板内容');
  });

  it('detects "请替换.*具体" pattern', async () => {
    const content = `# TASK-001 检查点\n- [ ] 请替换为具体的验收标准\n- [ ] 请替换为具体的检查内容`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(false);
  });

  // --- File mode (isContent=false) ---

  it('returns invalid when checkpoint file does not exist', async () => {
    const result = hasValidCheckpoints(path.join(tempDir, 'nonexistent.md'), false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('checkpoint.md 文件不存在');
  });

  it('reads from file when isContent=false and file exists', async () => {
    const cpPath = path.join(tempDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, `# TASK-001 检查点\n- [ ] 验证功能A\n- [ ] 确认功能B正常`);
    const result = hasValidCheckpoints(cpPath, false);
    expect(result.valid).toBe(true);
  });

  it('reads from file and detects template content', async () => {
    const cpPath = path.join(tempDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, `# TASK-001 检查点\n- [ ] 检查点1\n- [ ] 检查点2`);
    const result = hasValidCheckpoints(cpPath, false);
    expect(result.valid).toBe(false);
  });

  it('handles exact 50% template threshold (not majority)', async () => {
    // 1 out of 2 is exactly half → NOT majority → should be valid
    const content = `# TASK-001 检查点\n- [ ] 检查点1\n- [ ] 验证功能正常`;
    const result = hasValidCheckpoints(content, true);
    expect(result.valid).toBe(true);
  });
});

// ============== displayCheckpointVerificationWarnings ==============

describe('displayCheckpointVerificationWarnings', () => {
  let displayCheckpointVerificationWarnings: typeof import('../commands/task.js')['displayCheckpointVerificationWarnings'];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    const mod = await taskModule();
    displayCheckpointVerificationWarnings = mod.displayCheckpointVerificationWarnings;
    consoleSpy = spyOn(console, 'log');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('does not output anything when warnings array is empty', () => {
    displayCheckpointVerificationWarnings([]);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('displays warnings for missing verification commands', () => {
    displayCheckpointVerificationWarnings([
      '检查点 "验证登录" 的验证方法为 functional_test，但缺少 commands 或 steps',
    ]);
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('检查点验证命令缺失提醒');
    expect(output).toContain('1 个检查点缺少自动化验证命令');
    expect(output).toContain('验证登录');
  });

  it('displays multiple warnings', () => {
    displayCheckpointVerificationWarnings([
      '检查点 "A" 缺少 commands',
      '检查点 "B" 缺少 commands',
      '检查点 "C" 缺少 commands',
    ]);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('3 个检查点缺少自动化验证命令');
  });
});

// ============== displayCheckpointCreationWarning ==============

describe('displayCheckpointCreationWarning', () => {
  let displayCheckpointCreationWarning: typeof import('../commands/task.js')['displayCheckpointCreationWarning'];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    const mod = await taskModule();
    displayCheckpointCreationWarning = mod.displayCheckpointCreationWarning;
    consoleSpy = spyOn(console, 'log');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('displays checkpoint quality reminder with task ID', () => {
    displayCheckpointCreationWarning('TASK-feature-P2-test-20260411', '/project');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('检查点质量提醒');
    expect(output).toContain('TASK-feature-P2-test-20260411');
    expect(output).toContain('checkpoint.md');
  });

  it('mentions analyze command for auto-generation', () => {
    displayCheckpointCreationWarning('TASK-001', '/project');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('analyze');
    expect(output).toContain('--generate-checkpoints');
  });
});

// ============== generateCheckpointTemplate ==============

describe('generateCheckpointTemplate', () => {
  let generateCheckpointTemplate: typeof import('../commands/task.js')['generateCheckpointTemplate'];
  let tempDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let pathSpy: ReturnType<typeof spyOn>;
  let taskSpy: ReturnType<typeof spyOn>;

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
    const mod = await taskModule();
    generateCheckpointTemplate = mod.generateCheckpointTemplate;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-test-'));
    const tasksDir = path.join(tempDir, '.projmnt4claude', 'tasks', 'TASK-feature-P2-test-20260411');
    fs.mkdirSync(tasksDir, { recursive: true });

    // Mock dependencies
    const pathMod = await import('../utils/path.js');
    pathSpy = spyOn(pathMod, 'isInitialized').mockReturnValue(true);
    const taskMod = await import('../utils/task.js');
    taskSpy = spyOn(taskMod, 'readTaskMeta').mockReturnValue({ ...mockTask });

    consoleSpy = spyOn(console, 'log');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    pathSpy.mockRestore();
    taskSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits if project not initialized', async () => {
    pathSpy.mockReturnValue(false);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      generateCheckpointTemplate('TASK-001');
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    taskSpy.mockReturnValue(null);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      generateCheckpointTemplate('TASK-NONEXIST');
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('displays bug template for bug type', () => {
    taskSpy.mockReturnValue({ ...mockTask, type: 'bug' });
    generateCheckpointTemplate('TASK-bug-P1-fix-20260411');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('复现问题');
    expect(output).toContain('定位根本原因');
    expect(output).toContain('实现修复');
  });

  it('displays feature template by default', () => {
    generateCheckpointTemplate('TASK-feature-P2-test-20260411');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('理解需求和设计');
    expect(output).toContain('实现核心功能');
    expect(output).toContain('编写单元测试');
  });

  it('displays research template', () => {
    generateCheckpointTemplate('TASK-001', { type: 'research' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('明确研究目标');
    expect(output).toContain('收集相关信息');
  });

  it('displays docs template', () => {
    generateCheckpointTemplate('TASK-001', { type: 'docs' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('确定文档范围和受众');
  });

  it('displays refactor template', () => {
    generateCheckpointTemplate('TASK-001', { type: 'refactor' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('分析现有代码结构');
    expect(output).toContain('设计重构方案');
  });

  it('displays test template', () => {
    generateCheckpointTemplate('TASK-001', { type: 'test' });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('确定测试范围');
    expect(output).toContain('设计测试用例');
  });
});

// ============== createTask (non-interactive mode) ==============

describe('createTask', () => {
  let createTask: typeof import('../commands/task.js')['createTask'];
  let tempDir: string;
  let tasksDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let pathIsInitSpy: ReturnType<typeof spyOn>;
  let pathGetTasksDirSpy: ReturnType<typeof spyOn>;
  let taskExistsSpy: ReturnType<typeof spyOn>;
  let generateNewTaskIdSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let syncCheckpointsSpy: ReturnType<typeof spyOn>;
  let fsWriteSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    const mod = await taskModule();
    createTask = mod.createTask;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-test-'));
    tasksDir = path.join(tempDir, '.projmnt4claude', 'tasks');

    // Mock fs.writeFileSync to auto-create parent dirs for checkpoint.md
    fsWriteSpy = spyOn(fs, 'writeFileSync').mockImplementation((p: string, ...args: any[]) => {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // @ts-ignore
      return fs.writeFileSync.__original?.(p, ...args) ?? (globalThis as any).__origWriteFileSync?.(p, ...args);
    });
    // Restore original for real writes
    (fsWriteSpy as any).__original = fs.writeFileSync;
    // Re-apply: we need a wrapper that ensures dirs exist
    fsWriteSpy.mockRestore();
    // Instead, just use a manual approach: let writeFileSync work but pre-create dirs

    // Setup spies
    const pathMod = await import('../utils/path.js');
    pathIsInitSpy = spyOn(pathMod, 'isInitialized').mockReturnValue(true);
    pathGetTasksDirSpy = spyOn(pathMod, 'getTasksDir').mockReturnValue(tasksDir);

    const taskMod = await import('../utils/task.js');
    taskExistsSpy = spyOn(taskMod, 'taskExists').mockReturnValue(false);
    generateNewTaskIdSpy = spyOn(taskMod, 'generateNewTaskId').mockReturnValue('TASK-feature-P2-test-20260411');
    writeTaskMetaSpy = spyOn(taskMod, 'writeTaskMeta').mockImplementation(() => {});

    const cpMod = await import('../utils/checkpoint.js');
    syncCheckpointsSpy = spyOn(cpMod, 'syncCheckpointsToMeta').mockImplementation(() => {});

    // Pre-create the task directory (normally writeTaskMeta creates it)
    const defaultTaskDir = path.join(tasksDir, 'TASK-feature-P2-test-20260411');
    fs.mkdirSync(defaultTaskDir, { recursive: true });

    consoleSpy = spyOn(console, 'log');
    consoleErrorSpy = spyOn(console, 'error');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    pathIsInitSpy.mockRestore();
    pathGetTasksDirSpy.mockRestore();
    taskExistsSpy.mockRestore();
    generateNewTaskIdSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    syncCheckpointsSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits if project not initialized', async () => {
    pathIsInitSpy.mockReturnValue(false);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({ title: 'Test', nonInteractive: true }, tempDir);
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
    }, tempDir);

    expect(result.title).toBe('Add login feature');
    expect(result.status).toBe('open');
    expect(writeTaskMetaSpy).toHaveBeenCalled();
  });

  it('creates task with specified type', async () => {
    const result = await createTask({
      title: 'Fix login bug',
      type: 'bug',
      priority: 'P1',
      nonInteractive: true,
      skipValidation: true,
    }, tempDir);

    expect(result.title).toBe('Fix login bug');
    expect(result.priority).toBe('P1');
  });

  it('creates task with custom ID when id option provided', async () => {
    // Pre-create directory for custom ID
    fs.mkdirSync(path.join(tasksDir, 'TASK-custom-id'), { recursive: true });
    const result = await createTask({
      title: 'Test',
      id: 'TASK-custom-id',
      nonInteractive: true,
      skipValidation: true,
    }, tempDir);

    expect(result.id).toBe('TASK-custom-id');
  });

  it('rejects invalid custom task ID', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({
        title: 'Test',
        id: 'invalid id with spaces',
        nonInteractive: true,
      }, tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('rejects duplicate task ID', async () => {
    taskExistsSpy.mockReturnValue(true);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await createTask({
        title: 'Test',
        id: 'TASK-existing',
        nonInteractive: true,
      }, tempDir);
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
    }, tempDir);

    const cpPath = path.join(tasksDir, 'TASK-feature-P2-test-20260411', 'checkpoint.md');
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
    }, tempDir);

    expect(result.history.length).toBeGreaterThan(0);
    const createEntry = result.history.find(h => h.action === '任务创建');
    expect(createEntry).toBeDefined();
    expect(createEntry!.newValue).toBe('open');
  });
});

// ============== updateTask ==============

describe('updateTask', () => {
  let updateTask: typeof import('../commands/task.js')['updateTask'];
  let tempDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let pathIsInitSpy: ReturnType<typeof spyOn>;
  let pathGetTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;

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
    const mod = await taskModule();
    updateTask = mod.updateTask;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-test-'));

    const pathMod = await import('../utils/path.js');
    pathIsInitSpy = spyOn(pathMod, 'isInitialized').mockReturnValue(true);

    const tasksDir = path.join(tempDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    pathGetTasksDirSpy = spyOn(pathMod, 'getTasksDir').mockReturnValue(tasksDir);

    const taskMod = await import('../utils/task.js');
    readTaskMetaSpy = spyOn(taskMod, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskMod, 'writeTaskMeta').mockImplementation(() => {});

    consoleSpy = spyOn(console, 'log');
    consoleErrorSpy = spyOn(console, 'error');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    pathIsInitSpy.mockRestore();
    pathGetTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits if project not initialized', async () => {
    pathIsInitSpy.mockReturnValue(false);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask('TASK-001', { title: 'New Title' }, tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    readTaskMetaSpy.mockReturnValue(null);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask('TASK-NONEXIST', { title: 'New' }, tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('updates task title', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { title: 'Updated Title' }, tempDir);
    expect(task.title).toBe('Updated Title');
    expect(writeTaskMetaSpy).toHaveBeenCalled();
  });

  it('updates task priority', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { priority: 'P0' }, tempDir);
    expect(task.priority).toBe('P0');
  });

  it('updates task status to in_progress', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { status: 'in_progress' }, tempDir);
    expect(task.status).toBe('in_progress');
  });

  it('handles reopened status: maps to open + increments reopenCount', async () => {
    const task = baseTask();
    task.status = 'resolved';
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { status: 'reopened' }, tempDir);
    expect(task.status).toBe('open');
    expect(task.reopenCount).toBe(1);
    // Should have transitionNotes
    expect(task.transitionNotes!.length).toBeGreaterThan(0);
    // Should have history entry
    const reopenEntry = task.history.find(h => h.action.includes('重开'));
    expect(reopenEntry).toBeDefined();
  });

  it('increments reopenCount on multiple reopens', async () => {
    const task = baseTask();
    task.status = 'resolved';
    task.reopenCount = 2;
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { status: 'reopened' }, tempDir);
    expect(task.reopenCount).toBe(3);
  });

  it('clears failureReason when reopening from failed status', async () => {
    const task = baseTask();
    task.status = 'failed';
    (task as any).failureReason = 'timeout';
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { status: 'reopened' }, tempDir);
    expect((task as any).failureReason).toBeUndefined();
  });

  it('updates task description', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { description: 'New description' }, tempDir);
    expect(task.description).toBe('New description');
  });

  it('updates recommended role', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { role: 'executor' }, tempDir);
    expect(task.recommendedRole).toBe('executor');
  });

  it('updates branch', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, { branch: 'feature/login' }, tempDir);
    expect(task.branch).toBe('feature/login');
  });

  it('shows "no updates" when no fields specified', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    await updateTask(task.id, {}, tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('没有指定要更新的字段');
    expect(writeTaskMetaSpy).not.toHaveBeenCalled();
  });

  it('requires token for resolved status when checkpoints exist', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    readTaskMetaSpy.mockReturnValue(task);

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(tempDir, 'tasks', task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [ ] unchecked item');

    await updateTask(task.id, { status: 'resolved' }, tempDir);
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('检查点确认提醒');
  });

  it('resolves directly when no checkpoint file exists', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    readTaskMetaSpy.mockReturnValue(task);
    // No checkpoint file created → should resolve directly

    await updateTask(task.id, { status: 'resolved' }, tempDir);
    expect(task.status).toBe('resolved');
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('已更新为已解决状态');
  });

  it('rejects invalid token for resolved status', async () => {
    const task = baseTask();
    task.status = 'in_progress';
    task.checkpointConfirmationToken = 'valid-token';
    readTaskMetaSpy.mockReturnValue(task);

    // Create checkpoint with all checked items
    const cpDir = path.join(tempDir, 'tasks', task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [x] checked item');

    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await updateTask(task.id, { status: 'resolved', token: 'wrong-token' }, tempDir);
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
    readTaskMetaSpy.mockReturnValue(task);

    const cpDir = path.join(tempDir, 'tasks', task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [x] checked item');

    await updateTask(task.id, { status: 'resolved', token: 'valid-token' }, tempDir);
    expect(task.status).toBe('resolved');
    expect(task.checkpointConfirmationToken).toBeUndefined();
  });
});

// ============== completeTask ==============

describe('completeTask', () => {
  let completeTask: typeof import('../commands/task.js')['completeTask'];
  let tempDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let pathIsInitSpy: ReturnType<typeof spyOn>;
  let pathGetTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;

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
    const mod = await taskModule();
    completeTask = mod.completeTask;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-test-'));

    const pathMod = await import('../utils/path.js');
    pathIsInitSpy = spyOn(pathMod, 'isInitialized').mockReturnValue(true);

    const tasksDir = path.join(tempDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    pathGetTasksDirSpy = spyOn(pathMod, 'getTasksDir').mockReturnValue(tasksDir);

    const taskMod = await import('../utils/task.js');
    readTaskMetaSpy = spyOn(taskMod, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskMod, 'writeTaskMeta').mockImplementation(() => {});

    consoleSpy = spyOn(console, 'log');
    consoleErrorSpy = spyOn(console, 'error');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    pathIsInitSpy.mockRestore();
    pathGetTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits if project not initialized', async () => {
    pathIsInitSpy.mockReturnValue(false);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await completeTask('TASK-001', {}, tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits if task not found', async () => {
    readTaskMetaSpy.mockReturnValue(null);
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await completeTask('TASK-NONEXIST', {}, tempDir);
    } catch (e) {
      expect((e as Error).message).toBe('exit');
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('completes task and sets status to resolved', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);

    // No checkpoint file → no unchecked checkpoints
    await completeTask(task.id, { yes: true }, tempDir);

    expect(task.status).toBe('resolved');
    expect(writeTaskMetaSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('已完成');
  });

  it('auto-marks unchecked checkpoints when using yes flag', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(tempDir, 'tasks', task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    const cpPath = path.join(cpDir, 'checkpoint.md');
    fs.writeFileSync(cpPath, '# Checkpoints\n- [ ] unchecked item 1\n- [ ] unchecked item 2\n');

    await completeTask(task.id, { yes: true }, tempDir);

    expect(task.status).toBe('resolved');
    // Verify writeFileSync was called with [x] content
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('已自动标记');
  });

  it('shows unchecked checkpoints warning in non-yes mode and user cancels', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);

    // Create checkpoint file at the mocked getTasksDir path
    const cpDir = path.join(tempDir, 'tasks', task.id);
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'checkpoint.md'), '- [ ] unchecked item');

    // Mock prompts to reject (user cancels marking checkpoints)
    const prompts = await import('prompts');
    // First call: proceed=false (don't mark all as complete)
    const promptsSpy = spyOn(prompts, 'default')
      .mockResolvedValueOnce({ proceed: false });

    await completeTask(task.id, { yes: false }, tempDir);

    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('已取消');
    promptsSpy.mockRestore();
  });

  it('completes task without checkpoint file', async () => {
    const task = baseTask();
    readTaskMetaSpy.mockReturnValue(task);
    // No checkpoint file created

    await completeTask(task.id, { yes: true }, tempDir);

    expect(task.status).toBe('resolved');
  });
});
