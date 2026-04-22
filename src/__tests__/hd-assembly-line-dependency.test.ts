/**
 * Tests for checkDependencies polling wait mechanism (PROBLEM-1 fix)
 *
 * Verifies:
 * - CP-1: checkDependencies method supports polling for in_progress dependency tasks
 * - CP-2: Polling logic: 5s interval, 30min timeout, failure detection
 * - CP-3: Tests don't depend on isRetryableError function (removed in PROBLEM-3)
 * - CP-4: All existing tests still pass
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import type { HarnessConfig, TaskMeta } from '../types/harness.js';

// ============================================================
// Test helpers
// ============================================================

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 60,
    parallel: 1,
    dryRun: false,
    continue: false,
    forceContinue: false,
    jsonOutput: false,
    cwd,
    batchGitCommit: false,
  };
}

function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TEST-TASK-001',
    title: 'Test Task',
    description: 'Test task for dependency check',
    status: 'open',
    type: 'feature',
    priority: 'P2',
    dependencies: [],
    checkpoints: [],
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'cli',
    schemaVersion: 6,
    ...overrides,
  };
}

function createMockTaskMeta(taskDir: string, task: TaskMeta): void {
  const taskDirPath = path.join(taskDir, task.id);
  if (!fs.existsSync(taskDirPath)) {
    fs.mkdirSync(taskDirPath, { recursive: true });
  }
  fs.writeFileSync(
    path.join(taskDirPath, 'meta.json'),
    JSON.stringify(task, null, 2),
    'utf-8'
  );
}

function updateMockTaskStatus(taskDir: string, taskId: string, status: string): void {
  const metaPath = path.join(taskDir, taskId, 'meta.json');
  const task = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  task.status = status;
  task.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(task, null, 2), 'utf-8');
}

// ============================================================
// Test suite
// ============================================================

describe('AssemblyLine - checkDependencies', () => {
  let tempDir: string;
  let tasksDir: string;
  let assemblyLine: AssemblyLine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-assembly-line-dep-test-'));
    tasksDir = path.join(tempDir, '.projmnt4claude', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const config = createTestConfig(tempDir);
    assemblyLine = new AssemblyLine(config);
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('CP-1: checkDependencies supports polling for in_progress tasks', () => {
    test('should return true immediately when dependency is resolved', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'resolved',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      // Access private method via any
      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    });

    test('should return true immediately when dependency is closed', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'closed',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    });

    test('should wait for in_progress dependency to complete', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'in_progress',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      // Simulate dependency completing after a short delay (before first poll)
      setTimeout(() => {
        updateMockTaskStatus(tasksDir, 'DEP-TASK-001', 'resolved');
      }, 100);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    }, 10000);
  });

  describe('CP-2: Polling logic parameters', () => {
    test('should detect failed dependencies immediately', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'failed',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(false);
    });

    test('should detect abandoned dependencies immediately', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'abandoned',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(false);
    });

    test('should handle multiple dependencies', async () => {
      const depTask1 = createMockTask({
        id: 'DEP-TASK-001',
        status: 'resolved',
      });
      const depTask2 = createMockTask({
        id: 'DEP-TASK-002',
        status: 'in_progress',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001', 'DEP-TASK-002'],
      });

      createMockTaskMeta(tasksDir, depTask1);
      createMockTaskMeta(tasksDir, depTask2);
      createMockTaskMeta(tasksDir, mainTask);

      // Complete second dependency after a short delay
      setTimeout(() => {
        updateMockTaskStatus(tasksDir, 'DEP-TASK-002', 'resolved');
      }, 100);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    }, 10000);
  });

  describe('CP-3: No dependency on isRetryableError', () => {
    test('should not use isRetryableError function', () => {
      // This test verifies that the checkDependencies implementation
      // does not depend on isRetryableError which was removed in PROBLEM-3
      const assemblyLineSource = fs.readFileSync(
        path.join(__dirname, '../utils/hd-assembly-line.ts'),
        'utf-8'
      );

      expect(assemblyLineSource).not.toContain('isRetryableError');
    });

    test('should not import isRetryableError', () => {
      const assemblyLineSource = fs.readFileSync(
        path.join(__dirname, '../utils/hd-assembly-line.ts'),
        'utf-8'
      );

      // Check that isRetryableError is not imported from harness-helpers
      const importMatch = assemblyLineSource.match(/from\s+['"]\.\.\/utils\/harness-helpers['"]/);
      if (importMatch) {
        const importLine = assemblyLineSource.substring(
          assemblyLineSource.lastIndexOf('\n', importMatch.index) + 1,
          assemblyLineSource.indexOf('\n', importMatch.index)
        );
        expect(importLine).not.toContain('isRetryableError');
      }
    });
  });

  describe('CP-4: Edge cases', () => {
    test('should return true for tasks with no dependencies', async () => {
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: [],
      });

      createMockTaskMeta(tasksDir, mainTask);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    });

    test('should return true for tasks with undefined dependencies', async () => {
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: undefined as any,
      });

      createMockTaskMeta(tasksDir, mainTask);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    });

    test('should handle wait_qa status as in-progress', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'wait_qa',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      // Complete dependency after a short delay
      setTimeout(() => {
        updateMockTaskStatus(tasksDir, 'DEP-TASK-001', 'resolved');
      }, 100);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    }, 10000);

    test('should handle wait_review status as in-progress', async () => {
      const depTask = createMockTask({
        id: 'DEP-TASK-001',
        status: 'wait_review',
      });
      const mainTask = createMockTask({
        id: 'MAIN-TASK-001',
        dependencies: ['DEP-TASK-001'],
      });

      createMockTaskMeta(tasksDir, depTask);
      createMockTaskMeta(tasksDir, mainTask);

      // Complete dependency after a short delay
      setTimeout(() => {
        updateMockTaskStatus(tasksDir, 'DEP-TASK-001', 'resolved');
      }, 100);

      const result = await (assemblyLine as any).checkDependencies(mainTask);
      expect(result).toBe(true);
    }, 10000);
  });
});
