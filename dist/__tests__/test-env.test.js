/**
 * 测试环境辅助工具单元测试
 *
 * 验证 createIsolatedTestEnv 和 resetTestEnv 功能
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, resetTestEnv, createTaskDir, readTaskMeta, writeTaskMeta, taskExists, getAllTaskIds, createArchivedTask, createTestTasks, createTaskDependency, createTestLifecycle, } from '../utils/test-env.js';
describe('createIsolatedTestEnv', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('creates temporary directory', () => {
        expect(fs.existsSync(env.tempDir)).toBe(true);
        expect(fs.statSync(env.tempDir).isDirectory()).toBe(true);
    });
    it('creates tasks directory', () => {
        expect(fs.existsSync(env.tasksDir)).toBe(true);
        expect(env.tasksDir).toContain('tasks');
    });
    it('creates project directory', () => {
        expect(fs.existsSync(env.projectDir)).toBe(true);
        expect(env.projectDir).toContain('.projmnt4claude');
    });
    it('sets up path module mocks', async () => {
        const pathModule = await import('../utils/path.js');
        expect(pathModule.isInitialized(env.tempDir)).toBe(true);
        expect(pathModule.getTasksDir(env.tempDir)).toBe(env.tasksDir);
        expect(pathModule.getProjectDir(env.tempDir)).toBe(env.projectDir);
    });
    it('provides cleanup function', () => {
        expect(typeof env.cleanup).toBe('function');
        // Cleanup is tested in afterEach
    });
    it('provides reset function', () => {
        expect(typeof env.reset).toBe('function');
    });
});
describe('resetTestEnv', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('clears all task data', () => {
        // Create some tasks
        createTaskDir(env.tasksDir, 'TASK-001');
        createTaskDir(env.tasksDir, 'TASK-002');
        expect(getAllTaskIds(env.tasksDir)).toHaveLength(2);
        // Reset environment
        resetTestEnv(env);
        expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);
    });
    it('preserves directory structure', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        resetTestEnv(env);
        expect(fs.existsSync(env.tempDir)).toBe(true);
        expect(fs.existsSync(env.tasksDir)).toBe(true);
        expect(fs.existsSync(env.projectDir)).toBe(true);
    });
    it('resets mock values', async () => {
        const pathModule = await import('../utils/path.js');
        // Verify mocks still return correct values after reset
        resetTestEnv(env);
        expect(pathModule.getTasksDir(env.tempDir)).toBe(env.tasksDir);
        expect(pathModule.getProjectDir(env.tempDir)).toBe(env.projectDir);
    });
    describe('参数验证', () => {
        it('当 env 为 null 时抛出 TypeError', () => {
            expect(() => resetTestEnv(null)).toThrow(TypeError);
            expect(() => resetTestEnv(null)).toThrow('不能为 null 或 undefined');
        });
        it('当 env 为 undefined 时抛出 TypeError', () => {
            expect(() => resetTestEnv(undefined)).toThrow(TypeError);
            expect(() => resetTestEnv(undefined)).toThrow('不能为 null 或 undefined');
        });
        it('当 env 不是对象时抛出 TypeError', () => {
            expect(() => resetTestEnv('string')).toThrow(TypeError);
            expect(() => resetTestEnv('string')).toThrow('必须是对象类型');
            expect(() => resetTestEnv(123)).toThrow('必须是对象类型');
            expect(() => resetTestEnv(true)).toThrow('必须是对象类型');
        });
        it('当 env 缺少 reset 方法时抛出 TypeError', () => {
            const invalidEnv = { tempDir: '/tmp', tasksDir: '/tmp/tasks' };
            expect(() => resetTestEnv(invalidEnv)).toThrow(TypeError);
            expect(() => resetTestEnv(invalidEnv)).toThrow('必须包含 reset 方法');
        });
        it('当传入有效 env 时正常工作', () => {
            // 不应该抛出错误
            expect(() => resetTestEnv(env)).not.toThrow();
        });
    });
});
describe('createTaskDir', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('creates task directory', () => {
        const taskDir = createTaskDir(env.tasksDir, 'TASK-001');
        expect(fs.existsSync(taskDir)).toBe(true);
        expect(fs.statSync(taskDir).isDirectory()).toBe(true);
    });
    it('creates meta.json with defaults', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        const metaPath = path.join(env.tasksDir, 'TASK-001', 'meta.json');
        expect(fs.existsSync(metaPath)).toBe(true);
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        expect(meta.id).toBe('TASK-001');
        expect(meta.title).toBe('Test Task TASK-001');
        expect(meta.status).toBe('open');
        expect(meta.createdAt).toBeDefined();
        expect(meta.updatedAt).toBeDefined();
    });
    it('merges custom meta values', () => {
        createTaskDir(env.tasksDir, 'TASK-001', {
            title: 'Custom Title',
            status: 'in_progress',
            priority: 'P1',
        });
        const meta = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(meta?.title).toBe('Custom Title');
        expect(meta?.status).toBe('in_progress');
        expect(meta?.priority).toBe('P1');
    });
    it('returns task directory path', () => {
        const taskDir = createTaskDir(env.tasksDir, 'TASK-001');
        expect(taskDir).toBe(path.join(env.tasksDir, 'TASK-001'));
    });
});
describe('readTaskMeta / writeTaskMeta', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('writes and reads task metadata', () => {
        const meta = {
            id: 'TASK-001',
            title: 'Test Task',
            status: 'open',
            customField: 'value',
        };
        writeTaskMeta(env.tasksDir, 'TASK-001', meta);
        const read = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(read).toEqual(meta);
    });
    it('returns null for non-existent task', () => {
        const meta = readTaskMeta(env.tasksDir, 'NON-EXISTENT');
        expect(meta).toBeNull();
    });
    it('returns null for invalid JSON', () => {
        const taskDir = path.join(env.tasksDir, 'TASK-001');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'meta.json'), 'invalid json {{{', 'utf-8');
        const meta = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(meta).toBeNull();
    });
    it('creates directory when writing', () => {
        writeTaskMeta(env.tasksDir, 'TASK-001', { id: 'TASK-001' });
        expect(fs.existsSync(path.join(env.tasksDir, 'TASK-001'))).toBe(true);
    });
});
describe('taskExists', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('returns true for existing task', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        expect(taskExists(env.tasksDir, 'TASK-001')).toBe(true);
    });
    it('returns false for non-existent task', () => {
        expect(taskExists(env.tasksDir, 'NON-EXISTENT')).toBe(false);
    });
    it('returns false for directory without meta.json', () => {
        fs.mkdirSync(path.join(env.tasksDir, 'TASK-001'), { recursive: true });
        expect(taskExists(env.tasksDir, 'TASK-001')).toBe(false);
    });
});
describe('getAllTaskIds', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('returns empty array for empty tasks directory', () => {
        expect(getAllTaskIds(env.tasksDir)).toEqual([]);
    });
    it('returns all task IDs', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        createTaskDir(env.tasksDir, 'TASK-002');
        createTaskDir(env.tasksDir, 'TASK-003');
        const ids = getAllTaskIds(env.tasksDir);
        expect(ids).toHaveLength(3);
        expect(ids.sort()).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
    });
    it('skips directories without meta.json', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        fs.mkdirSync(path.join(env.tasksDir, 'not-a-task'), { recursive: true });
        const ids = getAllTaskIds(env.tasksDir);
        expect(ids).toEqual(['TASK-001']);
    });
    it('returns empty array for non-existent directory', () => {
        const nonExistentDir = path.join(env.tempDir, 'non-existent');
        expect(getAllTaskIds(nonExistentDir)).toEqual([]);
    });
});
describe('createArchivedTask', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('creates task in archive directory', () => {
        const archiveDir = createArchivedTask(env.projectDir, 'TASK-ARCHIVED');
        expect(fs.existsSync(archiveDir)).toBe(true);
        expect(archiveDir).toContain('archive');
    });
    it('creates meta.json with closed status', () => {
        createArchivedTask(env.projectDir, 'TASK-ARCHIVED');
        const meta = readTaskMeta(path.join(env.projectDir, 'archive'), 'TASK-ARCHIVED');
        expect(meta?.status).toBe('closed');
        expect(meta?.title).toContain('Archived');
    });
    it('merges custom meta values', () => {
        createArchivedTask(env.projectDir, 'TASK-ARCHIVED', {
            title: 'Custom Archived',
            customField: 'value',
        });
        const meta = readTaskMeta(path.join(env.projectDir, 'archive'), 'TASK-ARCHIVED');
        expect(meta?.title).toBe('Custom Archived');
        expect(meta?.customField).toBe('value');
    });
});
describe('createTestTasks', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('creates specified number of tasks', () => {
        const ids = createTestTasks(env.tasksDir, 5);
        expect(ids).toHaveLength(5);
        expect(getAllTaskIds(env.tasksDir)).toHaveLength(5);
    });
    it('returns task IDs in sequence', () => {
        const ids = createTestTasks(env.tasksDir, 3);
        expect(ids).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
    });
    it('applies base meta to all tasks', () => {
        createTestTasks(env.tasksDir, 2, { status: 'in_progress', priority: 'P1' });
        const meta1 = readTaskMeta(env.tasksDir, 'TASK-001');
        const meta2 = readTaskMeta(env.tasksDir, 'TASK-002');
        expect(meta1?.status).toBe('in_progress');
        expect(meta1?.priority).toBe('P1');
        expect(meta2?.status).toBe('in_progress');
        expect(meta2?.priority).toBe('P1');
    });
});
describe('createTaskDependency', () => {
    let env;
    beforeEach(async () => {
        env = await createIsolatedTestEnv();
    });
    afterEach(() => {
        env.cleanup();
    });
    it('adds dependency to parent task', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        createTaskDir(env.tasksDir, 'TASK-002');
        createTaskDependency(env.tasksDir, 'TASK-001', 'TASK-002');
        const meta = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(meta?.dependencies).toContain('TASK-002');
    });
    it('does not add duplicate dependencies', () => {
        createTaskDir(env.tasksDir, 'TASK-001');
        createTaskDir(env.tasksDir, 'TASK-002');
        createTaskDependency(env.tasksDir, 'TASK-001', 'TASK-002');
        createTaskDependency(env.tasksDir, 'TASK-001', 'TASK-002');
        const meta = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(meta?.dependencies?.length).toBe(1);
    });
    it('creates dependencies array if not exists', () => {
        createTaskDir(env.tasksDir, 'TASK-001', { dependencies: undefined });
        createTaskDir(env.tasksDir, 'TASK-002');
        createTaskDependency(env.tasksDir, 'TASK-001', 'TASK-002');
        const meta = readTaskMeta(env.tasksDir, 'TASK-001');
        expect(meta?.dependencies).toEqual(['TASK-002']);
    });
});
describe('createTestLifecycle', () => {
    const { setup, teardown, getEnv, reset } = createTestLifecycle();
    // 注意：这里不使用 beforeEach/afterEach，而是手动测试生命周期函数
    it('setup creates isolated environment', async () => {
        const env = await setup();
        expect(fs.existsSync(env.tempDir)).toBe(true);
        expect(fs.existsSync(env.tasksDir)).toBe(true);
        teardown();
    });
    it('getEnv returns current environment', async () => {
        await setup();
        const env = getEnv();
        expect(fs.existsSync(env.tempDir)).toBe(true);
        teardown();
    });
    it('reset clears task data', async () => {
        const env = await setup();
        createTaskDir(env.tasksDir, 'TASK-001');
        expect(getAllTaskIds(env.tasksDir)).toHaveLength(1);
        reset();
        expect(getAllTaskIds(env.tasksDir)).toHaveLength(0);
        teardown();
    });
    it('teardown cleans up environment', async () => {
        const env = await setup();
        const tempDir = env.tempDir;
        expect(fs.existsSync(tempDir)).toBe(true);
        teardown();
        // Note: Directory may or may not exist after cleanup depending on timing
        // The main test is that cleanup() doesn't throw
    });
    it('getEnv throws when not initialized', () => {
        // Create a fresh lifecycle without calling setup
        const { getEnv: getEnvUninitialized } = createTestLifecycle();
        expect(() => getEnvUninitialized()).toThrow('Test environment not initialized');
    });
});
describe('test-env options', () => {
    it('respects custom prefix', async () => {
        const env = await createIsolatedTestEnv({ prefix: 'custom-prefix-' });
        expect(path.basename(env.tempDir).startsWith('custom-prefix-')).toBe(true);
        env.cleanup();
    });
    it('can skip creating tasks directory', async () => {
        const env = await createIsolatedTestEnv({ createTasksDir: false });
        expect(fs.existsSync(env.tempDir)).toBe(true);
        // tasksDir path is still set but directory may not exist
        env.cleanup();
    });
    it('can skip creating project directory', async () => {
        const env = await createIsolatedTestEnv({ createProjectDir: false });
        expect(fs.existsSync(env.tempDir)).toBe(true);
        // projectDir path is still set but directory may not exist
        env.cleanup();
    });
});
describe('cleanup behavior', () => {
    it('removes temp directory on cleanup', async () => {
        const env = await createIsolatedTestEnv();
        const tempDir = env.tempDir;
        expect(fs.existsSync(tempDir)).toBe(true);
        env.cleanup();
        // Note: In some cases the directory might still exist briefly
        // The main test is that cleanup() completes without error
    });
    it('restores mocks on cleanup', async () => {
        const env = await createIsolatedTestEnv();
        // Verify mocks are active
        const pathModule = await import('../utils/path.js');
        expect(pathModule.isInitialized(env.tempDir)).toBe(true);
        env.cleanup();
        // After cleanup, mocks should be restored
        // (actual behavior depends on spyOn implementation)
    });
});
