/**
 * src/utils/task.ts 单元测试
 *
 * 测试覆盖: readTaskMeta, writeTaskMeta, getAllTaskIds, getAllTasks,
 * generateNewTaskId, taskExists, generateSubtaskId, addSubtaskToParent,
 * getSubtasks, parseParentFromSubtaskId, isSubtask, getParentTask,
 * updateTaskStatus, buildTaskVerification, assignRole,
 * incrementReopenCount, recordExecutionStats, renameTask
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TaskMeta, ExecutionStats } from '../types/task';
import { createDefaultTaskMeta } from '../types/task';

// Helpers
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
// readTaskMeta
// ============================================================

describe('readTaskMeta', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('returns null when project not initialized', async () => {
    isInitSpy.mockReturnValue(false);
    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-001', tempDir)).toBeNull();
  });

  it('returns null when meta.json does not exist', async () => {
    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-NONEXIST', tempDir)).toBeNull();
  });

  it('returns null when meta.json contains invalid JSON', async () => {
    const taskDir = path.join(tasksDir, 'TASK-001');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'meta.json'), 'not valid json {{{', 'utf-8');

    const { readTaskMeta } = await taskUtils();
    expect(readTaskMeta('TASK-001', tempDir)).toBeNull();
  });

  it('reads and returns task meta when file is valid', async () => {
    const task = makeTask({ id: 'TASK-001', title: 'Valid Task' });
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), task);

    const { readTaskMeta } = await taskUtils();
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('TASK-001');
    expect(result!.title).toBe('Valid Task');
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('creates task directory and writes meta.json', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', title: 'New Task' });
    writeTaskMeta(task, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('New Task');
  });

  it('updates updatedAt timestamp', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', updatedAt: '2020-01-01T00:00:00.000Z' });
    writeTaskMeta(task, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('records history when status changes', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', status: 'open' });
    writeTaskMeta(task, tempDir);

    // Update status
    task.status = 'in_progress';
    writeTaskMeta(task, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    const statusHistory = result!.history.filter(h => h.field === 'status');
    expect(statusHistory.length).toBeGreaterThan(0);
    expect(statusHistory[0]!.oldValue).toBe('open');
    expect(statusHistory[0]!.newValue).toBe('in_progress');
  });

  it('records history when title changes', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', title: 'Old Title' });
    writeTaskMeta(task, tempDir);

    task.title = 'New Title';
    writeTaskMeta(task, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    const titleHistory = result!.history.filter(h => h.field === 'title');
    expect(titleHistory.length).toBeGreaterThan(0);
  });

  it('records history when dependencies change', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', dependencies: [] });
    writeTaskMeta(task, tempDir);

    task.dependencies = ['TASK-002'];
    writeTaskMeta(task, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    const depHistory = result!.history.filter(h => h.field === 'dependencies');
    expect(depHistory.length).toBeGreaterThan(0);
  });

  it('does not record history when no tracked fields change', async () => {
    const { writeTaskMeta, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', status: 'open', title: 'Same' });
    writeTaskMeta(task, tempDir);
    const firstHistoryLength = readTaskMeta('TASK-001', tempDir)!.history.length;

    // Write again without changing tracked fields
    writeTaskMeta(task, tempDir);
    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.history.length).toBe(firstHistoryLength);
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('returns empty array when not initialized', async () => {
    isInitSpy.mockReturnValue(false);
    const { getAllTaskIds } = await taskUtils();
    expect(getAllTaskIds(tempDir)).toEqual([]);
  });

  it('returns empty array when tasks dir does not exist', async () => {
    const { getAllTaskIds } = await taskUtils();
    expect(getAllTaskIds(tempDir)).toEqual([]);
  });

  it('returns task IDs for directories with valid meta.json', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));
    writeTaskToDisk(path.join(tasksDir, 'TASK-002'), makeTask({ id: 'TASK-002' }));

    const { getAllTaskIds } = await taskUtils();
    const ids = getAllTaskIds(tempDir);
    expect(ids.sort()).toEqual(['TASK-001', 'TASK-002']);
  });

  it('skips directories without meta.json', async () => {
    fs.mkdirSync(path.join(tasksDir, 'TASK-001'), { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'not-a-task'), { recursive: true });
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));

    const { getAllTaskIds } = await taskUtils();
    const ids = getAllTaskIds(tempDir);
    expect(ids).toEqual(['TASK-001']);
  });
});

// ============================================================
// getAllTasks
// ============================================================

describe('getAllTasks', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let getProjectDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
    tasksDir = path.join(tempDir, 'tasks');

    const pMod = await pathUtils();
    isInitSpy = spyOn(pMod, 'isInitialized').mockReturnValue(true);
    getTasksDirSpy = spyOn(pMod, 'getTasksDir').mockReturnValue(tasksDir);
    getProjectDirSpy = spyOn(pMod, 'getProjectDir').mockReturnValue(path.join(tempDir, '.projmnt4claude'));
  });

  afterEach(() => {
    isInitSpy.mockRestore();
    getTasksDirSpy.mockRestore();
    getProjectDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns all tasks', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));
    writeTaskToDisk(path.join(tasksDir, 'TASK-002'), makeTask({ id: 'TASK-002' }));

    const { getAllTasks } = await taskUtils();
    const tasks = getAllTasks(tempDir);
    expect(tasks.length).toBe(2);
  });

  it('includes archived tasks when flag is true', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));

    // Create archived task
    const archiveDir = path.join(tempDir, '.projmnt4claude', 'archive', 'TASK-002');
    writeTaskToDisk(archiveDir, makeTask({ id: 'TASK-002', title: 'Archived' }));

    const { getAllTasks } = await taskUtils();
    const tasks = getAllTasks(tempDir, true);
    expect(tasks.length).toBe(2);
    expect(tasks.some(t => t.id === 'TASK-002')).toBe(true);
  });

  it('excludes archived tasks when flag is false', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));

    const archiveDir = path.join(tempDir, '.projmnt4claude', 'archive', 'TASK-002');
    writeTaskToDisk(archiveDir, makeTask({ id: 'TASK-002' }));

    const { getAllTasks } = await taskUtils();
    const tasks = getAllTasks(tempDir, false);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe('TASK-001');
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('returns true when task exists', async () => {
    writeTaskToDisk(path.join(tasksDir, 'TASK-001'), makeTask({ id: 'TASK-001' }));

    const { taskExists } = await taskUtils();
    expect(taskExists('TASK-001', tempDir)).toBe(true);
  });

  it('returns false when task does not exist', async () => {
    const { taskExists } = await taskUtils();
    expect(taskExists('TASK-NONEXIST', tempDir)).toBe(false);
  });
});

// ============================================================
// generateNewTaskId
// ============================================================

describe('generateNewTaskId', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('generates ID with correct format', async () => {
    const { generateNewTaskId } = await taskUtils();
    const id = generateNewTaskId(tempDir, 'feature', 'P2', 'user login');
    expect(id).toMatch(/^TASK-feature-P2-/);
  });

  it('includes date in ID', async () => {
    const { generateNewTaskId } = await taskUtils();
    const id = generateNewTaskId(tempDir, 'bug', 'P1', 'crash fix');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(id).toContain(today);
  });

  it('avoids collisions with existing IDs', async () => {
    const { generateNewTaskId } = await taskUtils();
    const firstId = generateNewTaskId(tempDir, 'feature', 'P2', 'test');
    // Create the task to simulate collision
    writeTaskToDisk(path.join(tasksDir, firstId), makeTask({ id: firstId }));

    const secondId = generateNewTaskId(tempDir, 'feature', 'P2', 'test');
    expect(secondId).not.toBe(firstId);
  });
});

// ============================================================
// parseParentFromSubtaskId / isSubtask
// ============================================================

describe('parseParentFromSubtaskId', () => {
  it('parses parent from subtask ID with 1-digit suffix', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-feature-P2-auth-1')).toBe('TASK-feature-P2-auth');
  });

  it('parses parent from subtask ID with 2-digit suffix', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    // Parent must not end with a digit (date-avoidance logic)
    expect(parseParentFromSubtaskId('TASK-ABC-12')).toBe('TASK-ABC');
  });

  it('returns null for parent IDs ending with digit (date-avoidance)', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    // TASK-001 ends with '1', so TASK-001-12 is treated as date-like
    expect(parseParentFromSubtaskId('TASK-001-12')).toBeNull();
  });

  it('returns null for IDs ending with 3+ digits (likely dates)', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-20260411')).toBeNull();
  });

  it('returns null for non-subtask IDs', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK-feature-P2-auth-20260411')).toBeNull();
  });

  it('returns null for simple IDs without dash', async () => {
    const { parseParentFromSubtaskId } = await taskUtils();
    expect(parseParentFromSubtaskId('TASK001')).toBeNull();
  });
});

describe('isSubtask', () => {
  it('returns true for subtask IDs with non-digit-ending parent', async () => {
    const { isSubtask } = await taskUtils();
    expect(isSubtask('TASK-ABC-1')).toBe(true);
  });

  it('returns false for IDs with digit-ending parent', async () => {
    const { isSubtask } = await taskUtils();
    // TASK-001 ends with '1' — treated as date-like, not a subtask
    expect(isSubtask('TASK-001-1')).toBe(false);
  });

  it('returns false for non-subtask IDs', async () => {
    const { isSubtask } = await taskUtils();
    expect(isSubtask('TASK-feature-P2-auth-20260411')).toBe(false);
  });
});

// ============================================================
// generateSubtaskId / addSubtaskToParent / getSubtasks / getParentTask
// ============================================================

describe('generateSubtaskId', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('generates first subtask ID (parentId-1)', async () => {
    const { generateSubtaskId, writeTaskMeta } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001' });
    writeTaskMeta(parent, tempDir);

    expect(generateSubtaskId('TASK-001', tempDir)).toBe('TASK-001-1');
  });

  it('increments subtask number', async () => {
    const { generateSubtaskId, writeTaskMeta } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001', subtaskIds: ['TASK-001-1', 'TASK-001-2'] });
    writeTaskMeta(parent, tempDir);

    expect(generateSubtaskId('TASK-001', tempDir)).toBe('TASK-001-3');
  });

  it('throws when parent does not exist', async () => {
    const { generateSubtaskId } = await taskUtils();
    expect(() => generateSubtaskId('TASK-NONEXIST', tempDir)).toThrow('不存在');
  });
});

describe('addSubtaskToParent', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('adds subtask ID to parent', async () => {
    const { addSubtaskToParent, writeTaskMeta, readTaskMeta } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001' });
    writeTaskMeta(parent, tempDir);

    addSubtaskToParent('TASK-001', 'TASK-001-1', tempDir);

    const updated = readTaskMeta('TASK-001', tempDir);
    expect(updated!.subtaskIds).toContain('TASK-001-1');
  });

  it('does not add duplicate subtask', async () => {
    const { addSubtaskToParent, writeTaskMeta, readTaskMeta } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001', subtaskIds: ['TASK-001-1'] });
    writeTaskMeta(parent, tempDir);

    addSubtaskToParent('TASK-001', 'TASK-001-1', tempDir);

    const updated = readTaskMeta('TASK-001', tempDir);
    expect(updated!.subtaskIds!.filter(id => id === 'TASK-001-1').length).toBe(1);
  });

  it('adds history entry for subtask addition', async () => {
    const { addSubtaskToParent, writeTaskMeta, readTaskMeta } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001' });
    writeTaskMeta(parent, tempDir);

    addSubtaskToParent('TASK-001', 'TASK-001-1', tempDir);

    const updated = readTaskMeta('TASK-001', tempDir);
    const subtaskHistory = updated!.history.find(h => h.action.includes('添加子任务'));
    expect(subtaskHistory).toBeDefined();
    expect(subtaskHistory!.newValue).toBe('TASK-001-1');
  });

  it('throws when parent does not exist', async () => {
    const { addSubtaskToParent } = await taskUtils();
    expect(() => addSubtaskToParent('TASK-NONEXIST', 'TASK-NONEXIST-1', tempDir)).toThrow('不存在');
  });
});

describe('getSubtasks', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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
    const parent = makeTask({
      id: 'TASK-001',
      subtaskIds: ['TASK-001-2', 'TASK-001-1'],
    });
    writeTaskMeta(parent, tempDir);

    writeTaskMeta(makeTask({ id: 'TASK-001-2', createdAt: '2020-01-01T00:00:00.000Z' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-1', createdAt: '2020-01-02T00:00:00.000Z' }), tempDir);

    const subtasks = getSubtasks('TASK-001', tempDir);
    expect(subtasks.length).toBe(2);
    // Sorted by createdAt ascending (older first)
    expect(subtasks[0]!.id).toBe('TASK-001-2');
    expect(subtasks[1]!.id).toBe('TASK-001-1');
  });

  it('returns empty array when parent does not exist', async () => {
    const { getSubtasks } = await taskUtils();
    expect(getSubtasks('TASK-NONEXIST', tempDir)).toEqual([]);
  });

  it('skips subtasks that no longer exist on disk', async () => {
    const { writeTaskMeta, getSubtasks } = await taskUtils();
    const parent = makeTask({
      id: 'TASK-001',
      subtaskIds: ['TASK-001-1', 'TASK-001-DELETED'],
    });
    writeTaskMeta(parent, tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-1' }), tempDir);
    // TASK-001-DELETED not written to disk

    const subtasks = getSubtasks('TASK-001', tempDir);
    expect(subtasks.length).toBe(1);
    expect(subtasks[0]!.id).toBe('TASK-001-1');
  });
});

describe('getParentTask', () => {
  let tempDir: string;
  let tasksDir: string;
  let isInitSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('returns parent task when parentId is set', async () => {
    const { writeTaskMeta, getParentTask } = await taskUtils();
    const parent = makeTask({ id: 'TASK-001' });
    writeTaskMeta(parent, tempDir);
    const child = makeTask({ id: 'TASK-001-1', parentId: 'TASK-001' });
    writeTaskMeta(child, tempDir);

    const result = getParentTask('TASK-001-1', tempDir);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('TASK-001');
  });

  it('returns null when task has no parentId', async () => {
    const { writeTaskMeta, getParentTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    expect(getParentTask('TASK-001', tempDir)).toBeNull();
  });

  it('returns null when task does not exist', async () => {
    const { getParentTask } = await taskUtils();
    expect(getParentTask('TASK-NONEXIST', tempDir)).toBeNull();
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('updates task status', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);

    updateTaskStatus('TASK-001', 'in_progress', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.status).toBe('in_progress');
  });

  it('does nothing when status unchanged', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    const task = makeTask({ id: 'TASK-001', status: 'open' });
    writeTaskMeta(task, tempDir);
    const beforeHistory = readTaskMeta('TASK-001', tempDir)!.history.length;

    updateTaskStatus('TASK-001', 'open', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.history.length).toBe(beforeHistory);
  });

  it('throws when task does not exist', async () => {
    const { updateTaskStatus } = await taskUtils();
    expect(() => updateTaskStatus('TASK-NONEXIST', 'open', tempDir)).toThrow('不存在');
  });

  it('adds history entry for status change', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);

    updateTaskStatus('TASK-001', 'in_progress', tempDir, 'Starting work');

    const result = readTaskMeta('TASK-001', tempDir);
    const entry = result!.history.find(h => h.field === 'status');
    expect(entry).toBeDefined();
    expect(entry!.oldValue).toBe('open');
    expect(entry!.newValue).toBe('in_progress');
  });

  it('sets verification when status becomes resolved', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'in_progress' }), tempDir);

    updateTaskStatus('TASK-001', 'resolved', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.verification).toBeDefined();
    expect(result!.verification!.result).toBe('passed');
  });

  it('auto-completes pending checkpoints when resolving', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    const task = makeTask({
      id: 'TASK-001',
      status: 'in_progress',
      checkpoints: [
        { id: 'CP-001', description: 'Test', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', verification: { method: 'automated' as const } },
        { id: 'CP-002', description: 'Test 2', status: 'pending', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });
    writeTaskMeta(task, tempDir);

    updateTaskStatus('TASK-001', 'resolved', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.checkpoints![1]!.status).toBe('completed');
    expect(result!.verification!.result).toBe('passed');
  });

  it('adds transitionNote when provided', async () => {
    const { writeTaskMeta, updateTaskStatus, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', status: 'open' }), tempDir);

    updateTaskStatus('TASK-001', 'in_progress', tempDir, undefined, 'Starting development');

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.transitionNotes).toBeDefined();
    expect(result!.transitionNotes!.length).toBeGreaterThan(0);
    expect(result!.transitionNotes![0]!.note).toBe('Starting development');
  });
});

// ============================================================
// buildTaskVerification
// ============================================================

describe('buildTaskVerification', () => {
  it('returns passed when all checkpoints completed', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'Test', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', verification: { method: 'unit_test' as const } },
        { id: 'CP-002', description: 'Test 2', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', verification: { method: 'automated' as const } },
      ],
    });

    const v = buildTaskVerification(task);
    expect(v.result).toBe('passed');
    expect(v.checkpointCompletionRate).toBe(100);
    expect(v.methods).toContain('unit_test');
    expect(v.methods).toContain('automated');
  });

  it('returns passed when no checkpoints', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({ checkpoints: [] });
    const v = buildTaskVerification(task);
    expect(v.result).toBe('passed');
    expect(v.checkpointCompletionRate).toBe(100);
  });

  it('returns partial when >= 50% completed and no failures', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'CP-002', description: 'B', status: 'pending', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });

    const v = buildTaskVerification(task);
    expect(v.result).toBe('partial');
    expect(v.checkpointCompletionRate).toBe(50);
  });

  it('returns failed when any checkpoint failed', async () => {
    const { buildTaskVerification } = await taskUtils();
    const task = makeTask({
      checkpoints: [
        { id: 'CP-001', description: 'A', status: 'completed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'CP-002', description: 'B', status: 'failed', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });

    const v = buildTaskVerification(task);
    expect(v.result).toBe('failed');
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('assigns role and records history', async () => {
    const { writeTaskMeta, assignRole, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    assignRole('TASK-001', 'executor', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.recommendedRole).toBe('executor');
    const roleHistory = result!.history.find(h => h.field === 'recommendedRole');
    expect(roleHistory).toBeDefined();
    expect(roleHistory!.newValue).toBe('executor');
  });

  it('throws when task does not exist', async () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('increments from 0 to 1', async () => {
    const { writeTaskMeta, incrementReopenCount, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', reopenCount: 0 }), tempDir);

    incrementReopenCount('TASK-001', 'QA failed', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.reopenCount).toBe(1);
  });

  it('increments existing count', async () => {
    const { writeTaskMeta, incrementReopenCount, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', reopenCount: 3 }), tempDir);

    incrementReopenCount('TASK-001', 'Another failure', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.reopenCount).toBe(4);
  });

  it('records reason in history', async () => {
    const { writeTaskMeta, incrementReopenCount, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    incrementReopenCount('TASK-001', 'QA rejection', tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    const entry = result!.history.find(h => h.field === 'reopenCount');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('QA rejection');
  });

  it('throws when task does not exist', async () => {
    const { incrementReopenCount } = await taskUtils();
    expect(() => incrementReopenCount('TASK-NONEXIST', 'reason', tempDir)).toThrow('不存在');
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('records execution stats', async () => {
    const { writeTaskMeta, recordExecutionStats, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    const stats: ExecutionStats = {
      duration: 5000,
      retryCount: 2,
      completedAt: new Date().toISOString(),
    };

    recordExecutionStats('TASK-001', stats, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.executionStats).toBeDefined();
    expect(result!.executionStats!.duration).toBe(5000);
    expect(result!.executionStats!.retryCount).toBe(2);
  });

  it('preserves existing commitHistory when new stats lack it', async () => {
    const { writeTaskMeta, recordExecutionStats, readTaskMeta } = await taskUtils();
    const existingStats: ExecutionStats = {
      duration: 1000,
      retryCount: 0,
      completedAt: '2020-01-01T00:00:00.000Z',
      commitHistory: [{ sha: 'abc123', batchLabel: 'Batch 1', timestamp: '2020-01-01T00:00:00.000Z' }],
    };
    writeTaskMeta(makeTask({ id: 'TASK-001', executionStats: existingStats }), tempDir);

    const newStats: ExecutionStats = {
      duration: 2000,
      retryCount: 1,
      completedAt: new Date().toISOString(),
      // no commitHistory
    };
    recordExecutionStats('TASK-001', newStats, tempDir);

    const result = readTaskMeta('TASK-001', tempDir);
    expect(result!.executionStats!.commitHistory).toBeDefined();
    expect(result!.executionStats!.commitHistory!.length).toBe(1);
    expect(result!.executionStats!.commitHistory![0]!.sha).toBe('abc123');
  });

  it('throws when task does not exist', async () => {
    const { recordExecutionStats } = await taskUtils();
    expect(() => recordExecutionStats('TASK-NONEXIST', {
      duration: 1000,
      retryCount: 0,
      completedAt: new Date().toISOString(),
    }, tempDir)).toThrow('不存在');
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-utils-test-'));
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

  it('renames task directory and updates meta', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001', title: 'Old' }), tempDir);

    const result = renameTask('TASK-001', 'TASK-002', tempDir);
    expect(result.success).toBe(true);
    expect(result.oldId).toBe('TASK-001');
    expect(result.newId).toBe('TASK-002');

    // Old dir should not exist
    expect(fs.existsSync(path.join(tasksDir, 'TASK-001'))).toBe(false);
    // New dir should exist with updated ID
    const task = readTaskMeta('TASK-002', tempDir);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('TASK-002');
  });

  it('fails when old task does not exist', async () => {
    const { renameTask } = await taskUtils();
    const result = renameTask('TASK-NONEXIST', 'TASK-002', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('fails when new ID conflicts with existing task', async () => {
    const { writeTaskMeta, renameTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-002' }), tempDir);

    const result = renameTask('TASK-001', 'TASK-002', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('已被占用');
  });

  it('updates references in other tasks', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-002', dependencies: ['TASK-001'] }), tempDir);

    renameTask('TASK-001', 'TASK-NEW', tempDir);

    const task2 = readTaskMeta('TASK-002', tempDir);
    expect(task2!.dependencies).toContain('TASK-NEW');
    expect(task2!.dependencies).not.toContain('TASK-001');
  });

  it('updates parentId references in child tasks', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);
    writeTaskMeta(makeTask({ id: 'TASK-001-1', parentId: 'TASK-001' }), tempDir);

    renameTask('TASK-001', 'TASK-NEW', tempDir);

    const child = readTaskMeta('TASK-001-1', tempDir);
    expect(child!.parentId).toBe('TASK-NEW');
  });

  it('copies non-meta files during rename', async () => {
    const { writeTaskMeta, renameTask } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    // Create extra file
    const checkpointPath = path.join(tasksDir, 'TASK-001', 'checkpoint.md');
    fs.writeFileSync(checkpointPath, '# Checkpoints', 'utf-8');

    renameTask('TASK-001', 'TASK-002', tempDir);

    const newCheckpointPath = path.join(tasksDir, 'TASK-002', 'checkpoint.md');
    expect(fs.existsSync(newCheckpointPath)).toBe(true);
    expect(fs.readFileSync(newCheckpointPath, 'utf-8')).toBe('# Checkpoints');
  });

  it('records rename in history', async () => {
    const { writeTaskMeta, renameTask, readTaskMeta } = await taskUtils();
    writeTaskMeta(makeTask({ id: 'TASK-001' }), tempDir);

    renameTask('TASK-001', 'TASK-002', tempDir);

    const task = readTaskMeta('TASK-002', tempDir);
    const renameEntry = task!.history.find(h => h.action.includes('重命名'));
    expect(renameEntry).toBeDefined();
    expect(renameEntry!.oldValue).toBe('TASK-001');
    expect(renameEntry!.newValue).toBe('TASK-002');
  });
});
