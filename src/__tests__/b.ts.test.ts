/**
 * src/utils/task.ts 单元测试（补充）
 *
 * 测试覆盖: getTaskDir, getTaskMetaPath, readTaskMeta, writeTaskMeta,
 * getAllTaskIds, taskExists, parseParentFromSubtaskId, isSubtask,
 * generateSubtaskId, addSubtaskToParent, getSubtasks, getParentTask,
 * updateTaskStatus, buildTaskVerification, assignRole,
 * incrementReopenCount, recordExecutionStats, renameTask
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TaskMeta, ExecutionStats } from '../types/task';
import { createDefaultTaskMeta } from '../types/task';

const taskUtils = () => import('../utils/task.js');
const pathUtils = () => import('../utils/path.js');

function makeTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    ...createDefaultTaskMeta('TASK-001', 'Test Task'),
    ...overrides,
  };
}

function writeTaskToDisk(taskDir: string, task: TaskMeta): void {
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }
  fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2), 'utf-8');
}

// ============================================================
// getTaskDir / getTaskMetaPath
// ============================================================

describe('getTaskDir', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    const pMod = await pathUtils();
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue('/project/.projmnt4claude/tasks');
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
  });

  it('returns correct task directory path', async () => {
    const { getTaskDir } = await taskUtils();
    expect(getTaskDir('TASK-001')).toBe('/project/.projmnt4claude/tasks/TASK-001');
  });

  it('respects cwd parameter', async () => {
    const { getTaskDir } = await taskUtils();
    expect(getTaskDir('TASK-ABC', '/custom')).toBe('/project/.projmnt4claude/tasks/TASK-ABC');
  });
});

describe('getTaskMetaPath', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    const pMod = await pathUtils();
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue('/project/.projmnt4claude/tasks');
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
  });

  it('returns meta.json path inside task directory', async () => {
    const { getTaskMetaPath } = await taskUtils();
    expect(getTaskMetaPath('TASK-001')).toBe('/project/.projmnt4claude/tasks/TASK-001/meta.json');
  });
});

// ============================================================
// readTaskMeta
// ============================================================

describe('readTaskMeta', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when not initialized', async () => {
    isInitSpy.mockReturnValue(false);
    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-001', tempDir)).toBeNull();
  });

  it('returns null when meta.json missing', async () => {
    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-NONEXIST', tempDir)).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const taskDir = path.join(tasksDir, 'TASK-001');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'meta.json'), 'bad json');
    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-001', tempDir)).toBeNull();
  });

  it('reads valid task meta', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001', title: 'Hello' }));
    const { readTaskMeta } = await taskUtils();
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('TASK-001');
    expect(result!.title).toBe('Hello');
  });
});

// ============================================================
// writeTaskMeta
// ============================================================

describe('writeTaskMeta', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates directory and writes meta.json', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', title: 'New' }), tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('New');
  });

  it('updates updatedAt on write', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', updatedAt: '2020-01-01T00:00:00.000Z' });
    writeTaskMeta(task, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('records history on status change', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', status: 'open' });
    writeTaskMeta(task, tempDir);
    task.status = 'in_progress';
    writeTaskMeta(task, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    const statusEntry = result!.history.find(h => h.field === 'status');
    expect(statusEntry).toBeDefined();
    expect(statusEntry!.oldValue).toBe('open');
    expect(statusEntry!.newValue).toBe('in_progress');
  });

  it('records history on priority change', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', priority: 'P2' });
    writeTaskMeta(task, tempDir);
    task.priority = 'P0';
    writeTaskMeta(task, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    const prioEntry = result!.history.find(h => h.field === 'priority');
    expect(prioEntry).toBeDefined();
  });

  it('records history on dependencies change', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', dependencies: [] });
    writeTaskMeta(task, tempDir);
    task.dependencies = ['TASK-002', 'TASK-003'];
    writeTaskMeta(task, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    const depEntry = result!.history.find(h => h.field === 'dependencies');
    expect(depEntry).toBeDefined();
    expect(depEntry!.newValue).toContain('TASK-002');
  });
});

// ============================================================
// getAllTaskIds
// ============================================================

describe('getAllTaskIds', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty when not initialized', async () => {
    isInitSpy.mockReturnValue(false);
    const { getAllTaskIds } = await taskUtils();
    expect(getAllTaskIds(tempDir)).toEqual([]);
  });

  it('returns empty when tasks dir missing', async () => {
    const { getAllTaskIds } = await taskUtils();
    expect(getAllTaskIds(tempDir)).toEqual([]);
  });

  it('returns only directories with meta.json', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));
    writeTaskToDisk(path.join(tasksDir, 'TASK-002'), makeTask({ id: 'TASK-002' }));
    fs.mkdirSync(path.join(tasksDir, 'empty-dir'), { recursive: true });
    const { getAllTaskIds } = await taskUtils();
    const ids = getAllTaskIds(tempDir);
    expect(ids.sort()).toEqual(['TASK-001', 'TASK-002']);
  });
});

// ============================================================
// taskExists
// ============================================================

describe('taskExists', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true for existing task', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));
    const { taskExists } = await taskUtils();
    expect(taskExists('TASK-001', tempDir)).toBe(true);
  });

  it('returns false for non-existing task', async () => {
    const { taskExists } = await taskUtils();
    expect(taskExists('TASK-NONEXIST', tempDir)).toBe(false);
  });
});

// ============================================================
// parseParentFromSubtaskId / isSubtask
// ============================================================

describe('parseParentFromSubtaskId', () => {
  it('parses 1-digit subtask suffix', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-ABC-1')).toBe('TASK-ABC');
  });

  it('parses 2-digit subtask suffix', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-ABC-99')).toBe('TASK-ABC');
  });

  it('returns null for date-like suffixes (3+ digits)', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-20260411')).toBeNull();
  });

  it('returns null when parent ends with digit', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-001-1')).toBeNull();
  });

  it('returns null for plain ID without dash', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK001')).toBeNull();
  });
});

describe('isSubtask', () => {
  it('returns true for valid subtask ID', async () => {
    const { isSubtask } = await taskUtils();
    expect(isSubtask('TASK-ABC-1')).toBe(true);
  });

  it('returns false for non-subtask ID', async () => {
    const { isSubtask } = await taskUtils();
    expect(isSubtask('TASK-feature-P2-auth-20260411')).toBe(false);
  });
});

// ============================================================
// generateSubtaskId
// ============================================================

describe('generateSubtaskId', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates first subtask', async () => {
    const { writeTaskMeta, generateSubtaskId } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    expect(generateSubtaskId('TASK-001', tempDir)).toBe('TASK-001-1');
  });

  it('increments from existing subtasks', async () => {
    const { writeTaskMeta, generateSubtaskId } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', subtaskIds: ['TASK-001-1', 'TASK-001-2'] }), tempDir);
    expect(generateSubtaskId('TASK-001', tempDir)).toBe('TASK-001-3');
  });

  it('throws when parent missing', async () => {
    const { generateSubtaskId } = await taskUtils();
    expect(() => generateSubtaskId('TASK-NONEXIST', tempDir)).toThrow('不存在');
  });
});

// ============================================================
// addSubtaskToParent
// ============================================================

describe('addSubtaskToParent', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds subtask to parent and records history', async () => {
    const { writeTaskMeta, addSubtaskToParent, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    addSubtaskToParent('TASK-001', 'TASK-001-1', tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.subtaskIds).toContain('TASK-001-1');
    expect(result!.history.find(h => h.action.includes('添加子任务'))).toBeDefined();
  });

  it('skips duplicate subtask', async () => {
    const { writeTaskMeta, addSubtaskToParent, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', subtaskIds: ['TASK-001-1'] }), tempDir);
    addSubtaskToParent('TASK-001', 'TASK-001-1', tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.subtaskIds!.filter(id => id === 'TASK-001-1').length).toBe(1);
  });

  it('throws when parent missing', async () => {
    const { addSubtaskToParent } = await taskUtils();
    expect(() => addSubtaskToParent('TASK-NONEXIST', 'X', tempDir)).toThrow('不存在');
  });
});

// ============================================================
// getSubtasks
// ============================================================

describe('getSubtasks', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns subtasks sorted by createdAt', async () => {
    const { writeTaskMeta, getSubtasks } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', subtaskIds: ['TASK-001-1', 'TASK-001-2'] }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-1', createdAt: '2020-01-02T00:00:00.000Z' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-2', createdAt: '2020-01-01T00:00:00.000Z' }), tempDir);
    const subtasks = getSubtasks('TASK-001', tempDir);
    expect(subtasks[0]!.id).toBe('TASK-001-2');
    expect(subtasks[1]!.id).toBe('TASK-001-1');
  });

  it('returns empty for missing parent', async () => {
    const { getSubtasks } = await taskUtils();
    expect(getSubtasks('TASK-NONEXIST', tempDir)).toEqual([]);
  });
});

// ============================================================
// getParentTask
// ============================================================

describe('getParentTask', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns parent when parentId set', async () => {
    const { writeTaskMeta, getParentTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-1', parentId: 'TASK-001' }), tempDir);
    expect(getParentTask('TASK-001-1', tempDir)!.id).toBe('TASK-001');
  });

  it('returns null when no parentId', async () => {
    const { writeTaskMeta, getParentTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    expect(getParentTask('TASK-001', tempDir)).toBeNull();
  });
});

// ============================================================
// updateTaskStatus
// ============================================================

describe('updateTaskStatus', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates status and records history', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);
    updateTaskStatus('TASK-001', 'in_progress', tempDir, 'starting');
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.status).toBe('in_progress');
    const entry = result!.history.find(h => h.field === 'status');
    expect(entry).toBeDefined();
    expect(entry!.oldValue).toBe('open');
    expect(entry!.newValue).toBe('in_progress');
  });

  it('no-ops when status unchanged', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);
    const beforeLen = readTaskMeta('TASK-001', tempDir)!.history.length;
    updateTaskStatus('TASK-001', 'open', tempDir);
    expect(readTaskMeta('TASK-001', tempDir)!.history.length).toBe(beforeLen);
  });

  it('throws for missing task', async () => {
    const { updateTaskStatus } = await taskUtils();
    expect(() => updateTaskStatus('TASK-NONEXIST', 'open', tempDir)).toThrow('不存在');
  });

  it('auto-completes pending checkpoints on resolve', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({
      id: 'TASK-001',
      status: 'in_progress',
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', verification: { method: 'automated' as const } },
        { id: 'CP-002', description: 'B', status: 'pending', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    }), tempDir);
    updateTaskStatus('TASK-001', 'resolved', tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.checkpoints![1]!.status).toBe('completed');
    expect(result!.verification!.result).toBe('passed');
  });

  it('adds transitionNote', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);
    updateTaskStatus('TASK-001', 'in_progress', tempDir, undefined, 'dev started');
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.transitionNotes![0]!.note).toBe('dev started');
  });
});

// ============================================================
// buildTaskVerification
// ============================================================

describe('buildTaskVerification', () => {
  it('passed when all checkpoints completed', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', verification: { method: 'unit_test' as const } },
      ],
    });
    const v = buildTaskVerification(task);
    expect(v.result).toBe('passed');
    expect(v.checkpointCompletionRate).toBe(100);
    expect(v.methods).toContain('unit_test');
  });

  it('passed when no checkpoints', async () => {
    const { buildTaskVerification } = await taskUtils();
    expect(buildTaskVerification(makeTask({ checkpoints: [] })).result).toBe('passed');
  });

  it('partial when >= 50% completed without failures', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'CP-002', description: 'B', status: 'pending', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });
    expect(buildTaskVerification(task).result).toBe('partial');
  });

  it('failed when any checkpoint failed', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'CP-002', description: 'B', status: 'failed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });
    expect(buildTaskVerification(task).result).toBe('failed');
  });
});

// ============================================================
// assignRole
// ============================================================

describe('assignRole', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('assigns role with history', async () => {
    const { writeTaskMeta, assignRole, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    assignRole('TASK-001', 'executor', tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.recommendedRole).toBe('executor');
    expect(result!.history.find(h => h.field === 'recommendedRole')).toBeDefined();
  });

  it('throws for missing task', async () => {
    const { assignRole } = await taskUtils();
    expect(() => assignRole('TASK-NONEXIST', 'executor', tempDir)).toThrow('不存在');
  });
});

// ============================================================
// incrementReopenCount
// ============================================================

describe('incrementReopenCount', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('increments from default 0', async () => {
    const { writeTaskMeta, incrementReopenCount, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    incrementReopenCount('TASK-001', 'QA fail', tempDir);
    expect(readTaskMeta('TASK-001', tempDir)!.reopenCount).toBe(1);
  });

  it('increments existing count', async () => {
    const { writeTaskMeta, incrementReopenCount, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', reopenCount: 5 }), tempDir);
    incrementReopenCount('TASK-001', 'again', tempDir);
    expect(readTaskMeta('TASK-001', tempDir)!.reopenCount).toBe(6);
  });

  it('throws for missing task', async () => {
    const { incrementReopenCount } = await taskUtils();
    expect(() => incrementReopenCount('TASK-NONEXIST', 'r', tempDir)).toThrow('不存在');
  });
});

// ============================================================
// recordExecutionStats
// ============================================================

describe('recordExecutionStats', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('records stats', async () => {
    const { writeTaskMeta, recordExecutionStats, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    const stats: ExecutionStats = { duration: 5000, retryCount: 2, completedAt: new Date().toISOString() };
    recordExecutionStats('TASK-001', stats, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.executionStats!.duration).toBe(5000);
  });

  it('preserves existing commitHistory', async () => {
    const { writeTaskMeta, recordExecutionStats, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({
      id: 'TASK-001',
      executionStats: { duration: 1000, retryCount: 0, completedAt: '2020-01-01T00:00:00.000Z', commitHistory: [{ sha: 'abc', batchLabel: 'B1', timestamp: '2020-01-01T00:00:00.000Z' }] },
    }), tempDir);
    recordExecutionStats('TASK-001', { duration: 2000, retryCount: 1, completedAt: new Date().toISOString() }, tempDir);
    expect(readTaskMeta('TASK-001', tempDir)!.executionStats!.commitHistory!.length).toBe(1);
  });

  it('throws for missing task', async () => {
    const { recordExecutionStats } = await taskUtils();
    expect(() => recordExecutionStats('TASK-NONEXIST', { duration: 1, retryCount: 0, completedAt: new Date().toISOString() }, tempDir)).toThrow('不存在');
  });
});

// ============================================================
// renameTask
// ============================================================

describe('renameTask', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-b-test-'));
    tasksDir = path.join(tempDir, 'tasks');
    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('renames task and updates meta id', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    const result = renameTask('TASK-001', 'TASK-NEW', tempDir);
    expect(result.success).toBe(true);
    expect(readTaskMeta('TASK-NEW', tempDir)!.id).toBe('TASK-NEW');
    expect(fs.existsSync(path.join(tasksDir, 'TASK-001'))).toBe(false);
  });

  it('fails for non-existent source', async () => {
    const { renameTask } = await taskUtils();
    expect(renameTask('TASK-NONEXIST', 'TASK-NEW', tempDir).success).toBe(false);
  });

  it('fails when target ID occupied', async () => {
    const { writeTaskMeta, renameTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-002' }), tempDir);
    expect(renameTask('TASK-001', 'TASK-002', tempDir).success).toBe(false);
  });

  it('updates dependency references', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-002', dependencies: ['TASK-001'] }), tempDir);
    renameTask('TASK-001', 'TASK-NEW', tempDir);
    expect(readTaskMeta('TASK-002', tempDir)!.dependencies).toContain('TASK-NEW');
  });

  it('copies extra files during rename', async () => {
    const { writeTaskMeta, renameTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    fs.writeFileSync(path.join(tasksDir, 'TASK-001', 'checkpoint.md'), '# CP');
    renameTask('TASK-001', 'TASK-002', tempDir);
    expect(fs.readFileSync(path.join(tasksDir, 'TASK-002', 'checkpoint.md'), 'utf-8')).toBe('# CP');
  });
});
