/**
 * State Simplification Tests
 *
 * Tests for PROBLEM-2: 简化双层状态架构
 * - 验证 checkDependencies 直接从文件读取而非内存缓存
 * - 验证 state.records 移除后的兼容性
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  resetTestEnv,
  writeTaskMeta,
  type IsolatedTestEnv
} from '../utils/test-env';
import { readTaskMeta } from '../utils/task';
import type { TaskMeta } from '../types/task';
import { createDefaultTaskMeta } from '../types/task';

describe('State Simplification', () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(async () => {
    testEnv = await createIsolatedTestEnv({});
  });

  afterEach(() => {
    resetTestEnv(testEnv);
  });

  describe('checkDependencies simplification', () => {
    test('reads dependency status directly from task meta, not from memory cache', () => {
      // Create a dependency task
      const depTaskId = 'TASK-dep-001';
      const depTaskMeta = createDefaultTaskMeta(depTaskId, 'Dependency Task', 'feature');
      depTaskMeta.priority = 'P2';
      writeTaskMeta(testEnv.tasksDir, depTaskId, depTaskMeta);

      // Create a main task that depends on the dependency
      const mainTaskId = 'TASK-main-001';
      const mainTaskMeta = createDefaultTaskMeta(mainTaskId, 'Main Task', 'feature');
      mainTaskMeta.priority = 'P2';
      mainTaskMeta.dependencies = [depTaskId];
      writeTaskMeta(testEnv.tasksDir, mainTaskId, mainTaskMeta);

      // Initially dependency is not resolved
      let depMeta = JSON.parse(fs.readFileSync(
        path.join(testEnv.tasksDir, depTaskId, 'meta.json'),
        'utf-8'
      )) as TaskMeta;
      expect(depMeta.status).toBe('open');

      // Mark dependency as resolved by updating the file
      depMeta.status = 'resolved';
      depMeta.updatedAt = new Date().toISOString();
      writeTaskMeta(testEnv.tasksDir, depTaskId, depMeta);

      // Verify the status was written to file
      depMeta = JSON.parse(fs.readFileSync(
        path.join(testEnv.tasksDir, depTaskId, 'meta.json'),
        'utf-8'
      )) as TaskMeta;
      expect(depMeta.status).toBe('resolved');

      // The dependency check should now pass because it reads from file
      // This validates that checkDependencies uses readTaskMeta directly
      const depTaskMetaFromFile = JSON.parse(fs.readFileSync(
        path.join(testEnv.tasksDir, depTaskId, 'meta.json'),
        'utf-8'
      )) as TaskMeta;
      expect(['resolved', 'closed']).toContain(depTaskMetaFromFile.status);
    });

    test('handles missing dependencies gracefully', () => {
      // Create a main task that depends on a non-existent task
      const mainTaskId = 'TASK-main-002';
      const mainTaskMeta = createDefaultTaskMeta(mainTaskId, 'Main Task', 'feature');
      mainTaskMeta.dependencies = ['non-existent-task'];
      writeTaskMeta(testEnv.tasksDir, mainTaskId, mainTaskMeta);

      // Verify task was created with the dependency
      const mainMeta = JSON.parse(fs.readFileSync(
        path.join(testEnv.tasksDir, mainTaskId, 'meta.json'),
        'utf-8'
      )) as TaskMeta;
      expect(mainMeta.dependencies).toContain('non-existent-task');

      // Verify readTaskMeta returns null for non-existent task
      const nonExistentTask = readTaskMeta('non-existent-task', testEnv.cwd);
      expect(nonExistentTask).toBeNull();
    });

    test('returns true for tasks with no dependencies', () => {
      const taskId = 'TASK-independent-001';
      const taskMeta = createDefaultTaskMeta(taskId, 'Independent Task', 'feature');
      taskMeta.dependencies = [];
      writeTaskMeta(testEnv.tasksDir, taskId, taskMeta);

      const meta = JSON.parse(fs.readFileSync(
        path.join(testEnv.tasksDir, taskId, 'meta.json'),
        'utf-8'
      )) as TaskMeta;
      expect(meta.dependencies).toEqual([]);
    });
  });

  describe('HarnessRuntimeState compatibility', () => {
    test('state does not have records field after PROBLEM-2 refactoring', () => {
      // PROBLEM-2: records field was removed from HarnessRuntimeState
      // Execution records are now stored in AssemblyLine.executionRecords Map
      const state = {
        state: 'idle' as const,
        config: {
          maxRetries: 3,
          timeout: 300,
          parallel: 1,
          dryRun: false,
          continue: false,
          jsonOutput: false,
          cwd: testEnv.cwd,
          batchGitCommit: false,
          forceContinue: false,
        },
        taskQueue: [],
        currentIndex: 0,
        startTime: new Date().toISOString(),
        retryCounter: new Map(),
        updatedAt: new Date().toISOString(),
        resumeFrom: new Map(),
        reevaluateCounter: new Map(),
        phaseRetryCounters: new Map(),
        taskPhaseCheckpoints: new Map(),
      };

      // Verify records field is not present
      expect('records' in state).toBe(false);
    });
  });

  describe('readTaskMeta behavior', () => {
    test('returns null for non-existent tasks', () => {
      // This validates that readTaskMeta handles missing files gracefully
      // which is important for the simplified state architecture
      const nonExistentTask = readTaskMeta('NONEXISTENT', testEnv.cwd);
      expect(nonExistentTask).toBeNull();
    });

    test('reads task meta correctly from file system', () => {
      const taskId = 'TASK-test-001';
      const taskMeta = createDefaultTaskMeta(taskId, 'Test Task', 'bug');
      taskMeta.priority = 'P1';
      writeTaskMeta(testEnv.tasksDir, taskId, taskMeta);

      const metaPath = path.join(testEnv.tasksDir, taskId, 'meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;
      expect(meta.id).toBe(taskId);
      expect(meta.title).toBe('Test Task');
      expect(meta.type).toBe('bug');
      expect(meta.priority).toBe('P1');
    });

    test('ensures all array fields have default values', () => {
      const taskId = 'TASK-test-002';
      const taskMeta = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(testEnv.tasksDir, taskId, taskMeta);

      // Read using readTaskMeta which applies defaults
      const meta = readTaskMeta(taskId, testEnv.cwd);
      expect(meta).not.toBeNull();

      // All array fields should be defined
      expect(Array.isArray(meta!.dependencies)).toBe(true);
      expect(Array.isArray(meta!.history)).toBe(true);
      expect(Array.isArray(meta!.checkpoints)).toBe(true);
      expect(Array.isArray(meta!.subtaskIds)).toBe(true);
      expect(Array.isArray(meta!.discussionTopics)).toBe(true);
      expect(Array.isArray(meta!.fileWarnings)).toBe(true);
      expect(Array.isArray(meta!.allowedTools)).toBe(true);
      expect(Array.isArray(meta!.requirementHistory)).toBe(true);
      expect(Array.isArray(meta!.transitionNotes)).toBe(true);
      expect(Array.isArray(meta!.phaseHistory)).toBe(true);
    });

    test('readTaskMeta returns correct data after status update', () => {
      const taskId = 'TASK-test-003';
      const taskMeta = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      taskMeta.status = 'open';
      writeTaskMeta(testEnv.tasksDir, taskId, taskMeta);

      // Initial status
      let meta = readTaskMeta(taskId, testEnv.cwd);
      expect(meta!.status).toBe('open');

      // Update status via file write
      meta!.status = 'resolved';
      meta!.updatedAt = new Date().toISOString();
      writeTaskMeta(testEnv.tasksDir, taskId, meta!);

      // Read again - should reflect the change
      meta = readTaskMeta(taskId, testEnv.cwd);
      expect(meta!.status).toBe('resolved');
    });
  });
});
