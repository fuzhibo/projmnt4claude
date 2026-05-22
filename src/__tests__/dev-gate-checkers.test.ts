/**
 * TestEnvChecker & TestFrameworkChecker 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { TestEnvChecker, createTestEnvChecker, checkTestEnv } from '../utils/pre-dev-phase-gate/checkers/test-env-checker.js';
import { TestFrameworkChecker, createTestFrameworkChecker, checkTestFramework } from '../utils/pre-dev-phase-gate/checkers/test-framework-checker.js';
import type { PreDevPhaseCheckContext } from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: 'Test Task',
    type: 'feature',
    priority: 'P1',
    status: 'open',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

function createMockContext(overrides: Partial<PreDevPhaseCheckContext> = {}): PreDevPhaseCheckContext {
  return {
    taskId: 'TASK-test-001',
    task: createMockTask(),
    cwd: process.cwd(),
    attempt: 1,
    maxRetries: 3,
    isResumed: false,
    config: {
      enabled: true,
      rules: new Map(),
      enableRetryRules: true,
      stopOnFailure: true,
      generateReport: true,
    },
    ...overrides,
  };
}

describe('TestEnvChecker', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const checker = new TestEnvChecker(process.cwd());
      expect(checker.id).toBe('R-DEV-PRE-006');
      expect(checker.name).toBe('测试环境检查');
      expect(checker.failureType).toBe('A');
    });

    it('should create with custom config', () => {
      const checker = new TestEnvChecker(process.cwd(), { defaultTimeout: 10000 });
      expect(checker.id).toBe('R-DEV-PRE-006');
    });

    it('should create via factory function', () => {
      const checker = createTestEnvChecker(process.cwd());
      expect(checker).toBeInstanceOf(TestEnvChecker);
    });
  });

  describe('check', () => {
    it('should pass when no testEnvCheckCommands defined', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未定义');
    });

    it('should pass when testEnvCheckCommands is empty array', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
    });

    it('should pass when all commands succeed', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-1', description: 'Check 1', command: 'echo ok' },
            { id: 'check-2', description: 'Check 2', command: 'echo ok' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('2 个检测指令通过');
    });

    it('should fail when a required command fails', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-fail', description: 'Will fail', command: 'exit 1' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('should pass when optional command fails', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-optional', description: 'Optional', command: 'exit 1', required: false },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
    });

    it('should include failureType A in details when commands defined', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-1', description: 'Check 1', command: 'echo ok' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.details).toBeDefined();
      expect((result.details as Record<string, unknown>).failureType).toBe('A');
    });

    it('should include duration and timestamp', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });

    // --- Extended edge cases and uncovered scenarios ---

    it('should handle expectedExitCode non-zero (command intentionally exits with 1)', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-exit1', description: 'Expected exit 1', command: 'exit 1', expectedExitCode: 1 },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      expect(result.details).toBeDefined();
      const details = result.details as Record<string, unknown>;
      expect(details.passedCommands).toBe(1);
      expect(details.failedCommands).toBe(0);
    });

    it('should handle command output with special characters', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-special', description: 'Special chars', command: 'echo "hello\\nworld\\ttab"' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
    });

    it('should handle multiple commands with partial success and partial failure', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-ok', description: 'Passing', command: 'echo ok' },
            { id: 'check-fail', description: 'Failing', command: 'exit 1' },
            { id: 'check-ok2', description: 'Passing 2', command: 'echo ok2' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      const details = result.details as Record<string, unknown>;
      expect(details.totalCommands).toBe(3);
      expect(details.passedCommands).toBe(2);
      expect(details.failedCommands).toBe(1);
    });

    it('should handle command timeout gracefully', async () => {
      const checker = new TestEnvChecker(process.cwd(), { defaultTimeout: 500 });
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'check-slow', description: 'Slow command', command: 'sleep 10', timeout: 500 },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
    });

    it('should work via checkTestEnv convenience function', async () => {
      const context = createMockContext();
      const result = await checkTestEnv(context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('test-env-check');
    });

    it('should handle mixed required and optional commands', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext({
        task: createMockTask({
          testEnvCheckCommands: [
            { id: 'req-ok', description: 'Required passing', command: 'echo ok', required: true },
            { id: 'opt-fail', description: 'Optional failing', command: 'exit 1', required: false },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      const details = result.details as Record<string, unknown>;
      expect(details.passedCommands).toBe(1);
      expect(details.failedCommands).toBe(1);
    });

    it('should include ruleId in result', async () => {
      const checker = new TestEnvChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.ruleId).toBe('R-DEV-PRE-006');
    });
  });
});

describe('TestFrameworkChecker', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const checker = new TestFrameworkChecker(process.cwd());
      expect(checker.id).toBe('R-DEV-PRE-007');
      expect(checker.name).toBe('测试框架检查');
      expect(checker.failureType).toBe('A');
    });

    it('should create via factory function', () => {
      const checker = createTestFrameworkChecker(process.cwd());
      expect(checker).toBeInstanceOf(TestFrameworkChecker);
    });
  });

  describe('check', () => {
    it('should detect test framework in this project', async () => {
      const checker = new TestFrameworkChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.checkId).toBe('test-framework-check');
      expect(result.details).toBeDefined();
      expect((result.details as Record<string, unknown>).failureType).toBe('A');
    });

    it('should include duration and timestamp', async () => {
      const checker = new TestFrameworkChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });

    it('should pass when disabled', async () => {
      const checker = new TestFrameworkChecker(process.cwd(), { enabled: false });
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('已禁用');
    });

    it('should provide suggestions when framework not ready', async () => {
      const checker = new TestFrameworkChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      if (!result.passed) {
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions!.length).toBeGreaterThan(0);
      }
    });

    // --- Extended edge cases and uncovered scenarios ---

    it('should fail with suggestions for empty directory (no package.json)', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/test-framework-empty-');
      try {
        const checker = new TestFrameworkChecker(tmpDir);
        const context = createMockContext({ cwd: tmpDir });
        const result = await checker.check(context);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe('error');
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions!.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should detect Vitest when vitest config exists', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/test-framework-vitest-');
      try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
          scripts: { test: 'vitest run' },
          devDependencies: { vitest: '^1.0.0' },
        }));
        const checker = new TestFrameworkChecker(tmpDir);
        const context = createMockContext({ cwd: tmpDir });
        const result = await checker.check(context);

        expect(result.passed).toBe(true);
        const details = result.details as Record<string, unknown>;
        expect(details.type).toBe('Node.js/Vitest');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should detect Jest when jest dep exists', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/test-framework-jest-');
      try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
          scripts: { test: 'jest' },
          devDependencies: { jest: '^29.0.0' },
        }));
        const checker = new TestFrameworkChecker(tmpDir);
        const context = createMockContext({ cwd: tmpDir });
        const result = await checker.check(context);

        expect(result.passed).toBe(true);
        const details = result.details as Record<string, unknown>;
        expect(details.type).toBe('Node.js/Jest');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report not ready when package.json has no test script', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/test-framework-notest-');
      try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
          devDependencies: { jest: '^29.0.0' },
        }));
        const checker = new TestFrameworkChecker(tmpDir);
        const context = createMockContext({ cwd: tmpDir });
        const result = await checker.check(context);

        expect(result.passed).toBe(false);
        const details = result.details as Record<string, unknown>;
        expect(details.frameworkReady).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should include ruleId in result', async () => {
      const checker = new TestFrameworkChecker(process.cwd());
      const context = createMockContext();
      const result = await checker.check(context);

      expect(result.ruleId).toBe('R-DEV-PRE-007');
    });

    it('should work via checkTestFramework convenience function', async () => {
      const context = createMockContext();
      const result = await checkTestFramework(context);

      expect(result.checkId).toBe('test-framework-check');
    });

    it('should handle malformed package.json gracefully', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/test-framework-malformed-');
      try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json {{{');
        const checker = new TestFrameworkChecker(tmpDir);
        const context = createMockContext({ cwd: tmpDir });
        const result = await checker.check(context);

        // Should not throw, should handle gracefully
        expect(result).toBeDefined();
        expect(result.checkId).toBe('test-framework-check');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});