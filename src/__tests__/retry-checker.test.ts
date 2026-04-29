/**
 * Retry Checker 单元测试
 *
 * 测试重试上下文检查器的核心功能:
 * - R-RETRY-001: 遗留文件检查 (含 autoFix)
 * - R-RETRY-002: 锁文件检查 (含 autoFix)
 * - R-RETRY-003: 开发报告重置检查 (含 autoFix)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkLegacyFiles,
  checkLockFiles,
  checkDevReportReset,
  type RetryCheckResult,
} from '../utils/pre-dev-phase-gate/checkers/retry-checker.js';
import {
  cleanupLockFiles,
  archiveDevReport,
  createNewDevReport,
  resetDevReport,
  cleanupTempFiles,
  fullCleanup,
} from '../utils/pre-dev-phase-gate/checkers/auto-fix.js';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'retry_context',
    name: '测试规则',
    description: '这是一个测试规则',
    enabled: true,
    severity: 'warning',
    ...overrides,
  };
}

// 创建 mock 上下文
function createMockContext(
  cwd: string,
  overrides: Partial<PreDevPhaseCheckContext> = {}
): PreDevPhaseCheckContext {
  const mockTask: TaskMeta = {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '测试任务描述',
    type: 'feature',
    priority: 'P1',
    status: 'open',
    dependencies: [],
    checkpoints: [],
    affected_files: ['src/test.ts'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'test',
    schemaVersion: 6,
  };

  return {
    taskId: 'TASK-test-001',
    task: mockTask,
    cwd,
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

describe('Retry Checker Rules', () => {
  let testDir: string;
  let taskDir: string;
  let reportsDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/retry-checker-test-');
    taskDir = path.join(testDir, '.projmnt4claude', 'tasks', 'TASK-test-001');
    reportsDir = path.join(testDir, '.projmnt4claude', 'reports', 'dev');

    // 创建必要的目录结构
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // ============================================================================
  // R-RETRY-001: 遗留文件检查
  // ============================================================================
  describe('R-RETRY-001: checkLegacyFiles', () => {
    it('首次执行时应该跳过检查', async () => {
      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 1, isResumed: false });

      const result = await checkLegacyFiles(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toContain('首次执行');
    });

    it('没有遗留文件时应该通过', async () => {
      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLegacyFiles(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('未发现');
    });

    it('发现遗留临时文件时应该警告并提供autoFix', async () => {
      // 创建遗留文件
      fs.writeFileSync(path.join(taskDir, 'test.tmp'), 'temp content');
      fs.writeFileSync(path.join(taskDir, 'data.temp'), 'temp data');

      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLegacyFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('发现');
      expect(result.autoFixable).toBe(true);
      expect(result.autoFix).toBeDefined();
      expect(result.details?.legacyFiles).toContain('test.tmp');
      expect(result.details?.legacyFiles).toContain('data.temp');
    });

    it('发现.cache-文件时应该警告', async () => {
      fs.writeFileSync(path.join(taskDir, '.cache-test'), 'cache content');

      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLegacyFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.legacyFiles).toContain('.cache-test');
    });

    it('发现partial-文件时应该警告', async () => {
      fs.writeFileSync(path.join(taskDir, 'partial-result.json'), 'partial data');

      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLegacyFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.legacyFiles).toContain('partial-result.json');
    });

    it('autoFix应该能够清理遗留文件', async () => {
      fs.writeFileSync(path.join(taskDir, 'test.tmp'), 'temp content');

      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLegacyFiles(rule, context);
      expect(result.autoFix).toBeDefined();

      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fixResult.details?.removed).toContain('test.tmp');
      expect(fs.existsSync(path.join(taskDir, 'test.tmp'))).toBe(false);
    });

    it('恢复执行时应该进行检查', async () => {
      const rule = createMockRule({ id: 'R-RETRY-001' });
      const context = createMockContext(testDir, { attempt: 1, isResumed: true });

      const result = await checkLegacyFiles(rule, context);

      expect(result.checkId).toBe('R-RETRY-001');
      expect(result.message).not.toContain('首次执行');
    });
  });

  // ============================================================================
  // R-RETRY-002: 锁文件检查
  // ============================================================================
  describe('R-RETRY-002: checkLockFiles', () => {
    it('首次执行时应该跳过检查', async () => {
      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 1, isResumed: false });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toContain('首次执行');
    });

    it('没有锁文件时应该通过', async () => {
      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('未发现');
    });

    it('发现task.lock时应该失败并提供autoFix', async () => {
      fs.writeFileSync(path.join(testDir, 'task.lock'), 'lock content');

      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('task.lock');
      expect(result.autoFixable).toBe(true);
      expect(result.autoFix).toBeDefined();
    });

    it('发现.claude.lock时应该失败', async () => {
      fs.writeFileSync(path.join(testDir, '.claude.lock'), 'lock content');

      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('.claude.lock');
    });

    it('发现任务特定锁文件时应该失败', async () => {
      fs.writeFileSync(
        path.join(testDir, '.task-TASK-test-001.lock'),
        'lock content'
      );

      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.lockFiles.some((l: { name: string }) =>
        l.name.includes('TASK-test-001')
      )).toBe(true);
    });

    it('autoFix应该能够删除锁文件', async () => {
      fs.writeFileSync(path.join(testDir, 'task.lock'), 'lock content');

      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);
      expect(result.autoFix).toBeDefined();

      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'task.lock'))).toBe(false);
    });

    it('应该在任务目录中查找锁文件', async () => {
      fs.writeFileSync(path.join(taskDir, 'custom.lock'), 'lock content');

      const rule = createMockRule({ id: 'R-RETRY-002', severity: 'error' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkLockFiles(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.lockFiles.some((l: { name: string }) =>
        l.name === 'custom.lock'
      )).toBe(true);
    });
  });

  // ============================================================================
  // R-RETRY-003: 开发报告重置检查
  // ============================================================================
  describe('R-RETRY-003: checkDevReportReset', () => {
    it('首次执行时应该跳过检查', async () => {
      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 1, isResumed: false });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toContain('首次执行');
    });

    it('没有开发报告时应该通过', async () => {
      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('状态正常');
    });

    it('报告attempt小于当前attempt时应该通过', async () => {
      // 创建旧报告
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      const oldReport = {
        taskId: 'TASK-test-001',
        attempt: 1,
        metadata: { attempt: 1 },
      };
      fs.writeFileSync(reportPath, JSON.stringify(oldReport));

      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('状态正常');
    });

    it('报告attempt等于当前attempt时应该警告需要重置', async () => {
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      const oldReport = {
        taskId: 'TASK-test-001',
        attempt: 2,
        metadata: { attempt: 2 },
      };
      fs.writeFileSync(reportPath, JSON.stringify(oldReport));

      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('需要重置');
      expect(result.autoFixable).toBe(true);
      expect(result.autoFix).toBeDefined();
    });

    it('报告attempt大于当前attempt时应该警告', async () => {
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      const oldReport = {
        taskId: 'TASK-test-001',
        attempt: 3,
        metadata: { attempt: 3 },
      };
      fs.writeFileSync(reportPath, JSON.stringify(oldReport));

      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.needsReset).toBe(true);
    });

    it('autoFix应该归档旧报告并创建新报告', async () => {
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      const oldReport = {
        taskId: 'TASK-test-001',
        attempt: 2,
        metadata: { attempt: 2 },
      };
      fs.writeFileSync(reportPath, JSON.stringify(oldReport));

      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);
      expect(result.autoFix).toBeDefined();

      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fixResult.message).toContain('归档');
      expect(fs.existsSync(reportPath)).toBe(true); // 新报告存在

      // 验证新报告内容
      const newReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      expect(newReport.attempt).toBe(2);
      expect(newReport.metadata.attempt).toBe(2);
    });

    it('损坏的报告文件应该触发重置', async () => {
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      fs.writeFileSync(reportPath, 'invalid json content');

      const rule = createMockRule({ id: 'R-RETRY-003' });
      const context = createMockContext(testDir, { attempt: 2 });

      const result = await checkDevReportReset(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details?.needsReset).toBe(true);
    });
  });
});

// ============================================================================
// 自动修复工具测试
// ============================================================================
describe('Auto Fix Tools', () => {
  let testDir: string;
  let taskDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/auto-fix-test-');
    taskDir = path.join(testDir, '.projmnt4claude', 'tasks', 'TASK-test-001');
    fs.mkdirSync(taskDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('cleanupLockFiles', () => {
    it('应该清理所有锁文件', async () => {
      fs.writeFileSync(path.join(testDir, 'task.lock'), 'lock');
      fs.writeFileSync(path.join(testDir, '.claude.lock'), 'lock');

      const result = await cleanupLockFiles(testDir, 'TASK-test-001');

      expect(result.success).toBe(true);
      expect(result.details?.removed).toContain('task.lock');
      expect(result.details?.removed).toContain('.claude.lock');
      expect(fs.existsSync(path.join(testDir, 'task.lock'))).toBe(false);
    });

    it('没有锁文件时应该返回成功', async () => {
      const result = await cleanupLockFiles(testDir, 'TASK-test-001');

      expect(result.success).toBe(true);
      expect(result.message).toContain('成功');
    });
  });

  describe('archiveDevReport', () => {
    it('应该归档现有报告', async () => {
      const reportsDir = path.join(testDir, '.projmnt4claude', 'reports', 'dev');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      fs.writeFileSync(reportPath, JSON.stringify({ attempt: 1 }));

      const result = await archiveDevReport(testDir, 'TASK-test-001', 2);

      expect(result.success).toBe(true);
      expect(result.details?.archived).toBe(true);
    });

    it('没有报告时应该返回成功', async () => {
      const result = await archiveDevReport(testDir, 'TASK-test-001', 2);

      expect(result.success).toBe(true);
      expect(result.message).toContain('没有');
    });
  });

  describe('createNewDevReport', () => {
    it('应该创建新报告', async () => {
      const result = await createNewDevReport(testDir, 'TASK-test-001', 2, false);

      expect(result.success).toBe(true);
      expect(result.details?.attempt).toBe(2);

      const reportPath = path.join(
        testDir,
        '.projmnt4claude',
        'reports',
        'dev',
        'TASK-test-001-dev-report.json'
      );
      expect(fs.existsSync(reportPath)).toBe(true);
    });
  });

  describe('resetDevReport', () => {
    it('应该归档旧报告并创建新报告', async () => {
      const reportsDir = path.join(testDir, '.projmnt4claude', 'reports', 'dev');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, 'TASK-test-001-dev-report.json');
      fs.writeFileSync(reportPath, JSON.stringify({ attempt: 1, metadata: { attempt: 1 } }));

      const result = await resetDevReport(testDir, 'TASK-test-001', 2, false);

      expect(result.success).toBe(true);
      expect(result.details?.archived).toBe(true);
      expect(result.details?.newAttempt).toBe(2);
    });
  });

  describe('cleanupTempFiles', () => {
    it('应该清理临时文件', async () => {
      fs.writeFileSync(path.join(testDir, 'test.tmp'), 'temp');
      fs.writeFileSync(path.join(testDir, 'data.temp'), 'temp');
      fs.writeFileSync(path.join(taskDir, '.cache-file'), 'cache');

      const result = await cleanupTempFiles(testDir, 'TASK-test-001');

      expect(result.success).toBe(true);
      expect(result.details?.removed.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('fullCleanup', () => {
    it('应该执行全面清理', async () => {
      // 创建各种需要清理的文件
      fs.writeFileSync(path.join(testDir, 'task.lock'), 'lock');
      fs.writeFileSync(path.join(testDir, 'test.tmp'), 'temp');

      const result = await fullCleanup(testDir, 'TASK-test-001', 2, false);

      expect(result.success).toBe(true);
      expect(result.details?.lockFiles).toBeDefined();
      expect(result.details?.tempFiles).toBeDefined();
      expect(result.details?.devReport).toBeDefined();
    });
  });
});
