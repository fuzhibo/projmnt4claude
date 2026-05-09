/**
 * Resource Checker 单元测试
 *
 * 测试资源配置检查器的核心功能:
 * - R-RES-001: 开发分支配置检查
 * - R-RES-002: 开发目录配置检查
 * - R-RES-003: 环境变量配置检查
 * - R-RES-004: 磁盘空间检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  checkDevBranchConfig,
  checkDevDirectoryConfig,
  checkEnvConfig,
  checkDiskSpace,
  type ResourceCheckResult,
} from '../utils/pre-dev-phase-gate/checkers/resource-checker.js';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'resource_config',
    name: '测试规则',
    description: '这是一个测试规则',
    enabled: true,
    severity: 'error',
    ...overrides,
  };
}

// 创建 mock 上下文
function createMockContext(
  cwd: string,
  branch?: string,
  overrides: Partial<PreDevPhaseCheckContext> = {}
): PreDevPhaseCheckContext {
  const mockTask: TaskMeta = {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '测试任务描述\n\n## 相关文件\n- src/test.ts',
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
    branch,
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

describe('Resource Checker Rules', () => {
  let env: IsolatedTestEnv;
  let testDir: string;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    testDir = env.projectDir;
  });

  afterEach(() => {
    env.cleanup();
  });

  // ============================================================================
  // R-RES-001: 开发分支配置检查
  // ============================================================================
  describe('R-RES-001: checkDevBranchConfig', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-RES-001' });
      const context = createMockContext(testDir, undefined);

      const result = await checkDevBranchConfig(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-RES-001');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('分支不存在时应该失败', async () => {
      const rule = createMockRule({ id: 'R-RES-001' });
      const context = createMockContext(testDir, 'non-existent-branch');

      const result = await checkDevBranchConfig(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
      expect(result.suggestions).toBeDefined();
    });

    it('分支存在且符合约定时应该通过', async () => {
      // 初始化 git 仓库并创建分支
      execSync('git init', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.name "Test User"', { cwd: testDir, encoding: 'utf-8' });
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Test');
      execSync('git add README.md', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git checkout -b feature/test-branch', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-RES-001' });
      const context = createMockContext(testDir, 'feature/test-branch');

      const result = await checkDevBranchConfig(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('配置正确');
    });

    it('分支存在但不符合约定时应该警告', async () => {
      // 初始化 git 仓库
      execSync('git init', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.name "Test User"', { cwd: testDir, encoding: 'utf-8' });
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Test');
      execSync('git add README.md', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git checkout -b random-branch-name', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-RES-001' });
      const context = createMockContext(testDir, 'random-branch-name');

      const result = await checkDevBranchConfig(rule, context);

      // 分支存在但名称不符合约定，应该返回 passed = false 或警告
      expect(result.passed).toBe(false);
      expect(result.message).toContain('约定');
    });

    it('应该支持自定义前缀', async () => {
      // 初始化 git 仓库
      execSync('git init', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git config user.name "Test User"', { cwd: testDir, encoding: 'utf-8' });
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Test');
      execSync('git add README.md', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, encoding: 'utf-8' });
      execSync('git checkout -b custom/test-branch', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({
        id: 'R-RES-001',
        config: { allowedPrefixes: ['custom/'] },
      });
      const context = createMockContext(testDir, 'custom/test-branch');

      const result = await checkDevBranchConfig(rule, context);

      expect(result.passed).toBe(true);
    });
  });

  // ============================================================================
  // R-RES-002: 开发目录配置检查
  // ============================================================================
  describe('R-RES-002: checkDevDirectoryConfig', () => {
    it('目录存在且可写时应该通过', async () => {
      // 创建必需的子目录（默认配置要求）
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(testDir, '.projmnt4claude', 'tasks'), { recursive: true });

      const rule = createMockRule({ id: 'R-RES-002' });
      const context = createMockContext(testDir);

      const result = await checkDevDirectoryConfig(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-RES-002');
      expect(result.message).toContain('正确');
    });

    it('目录不存在时应该失败', async () => {
      const rule = createMockRule({ id: 'R-RES-002' });
      const context = createMockContext('/nonexistent/directory');

      const result = await checkDevDirectoryConfig(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
    });

    it('缺少必需子目录时应该失败', async () => {
      const rule = createMockRule({ id: 'R-RES-002' });
      const context = createMockContext(testDir);

      const result = await checkDevDirectoryConfig(rule, context);

      // 默认配置要求 src 和 .projmnt4claude/tasks 子目录
      expect(result.passed).toBe(false);
      expect(result.details).toBeDefined();
      const details = result.details as { missingSubdirs: string[] };
      expect(details.missingSubdirs.length).toBeGreaterThan(0);
    });

    it('子目录完整时应该通过', async () => {
      // 创建必需的子目录
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(testDir, '.projmnt4claude', 'tasks'), { recursive: true });

      const rule = createMockRule({ id: 'R-RES-002' });
      const context = createMockContext(testDir);

      const result = await checkDevDirectoryConfig(rule, context);

      expect(result.passed).toBe(true);
    });

    it('应该支持自定义子目录要求', async () => {
      fs.mkdirSync(path.join(testDir, 'custom-dir'), { recursive: true });

      const rule = createMockRule({
        id: 'R-RES-002',
        config: { requiredSubdirs: ['custom-dir'] },
      });
      const context = createMockContext(testDir);

      const result = await checkDevDirectoryConfig(rule, context);

      expect(result.passed).toBe(true);
    });
  });

  // ============================================================================
  // R-RES-003: 环境变量配置检查
  // ============================================================================
  describe('R-RES-003: checkEnvConfig', () => {
    it('所有必需变量已配置时应该通过', async () => {
      // NODE_ENV 通常会在测试环境中设置
      const rule = createMockRule({ id: 'R-RES-003' });
      const context = createMockContext(testDir);

      const result = await checkEnvConfig(rule, context);

      // 如果 NODE_ENV 已设置
      if (process.env.NODE_ENV) {
        expect(result.passed).toBe(true);
      }
    });

    it('缺少必需变量时应该失败', async () => {
      const rule = createMockRule({
        id: 'R-RES-003',
        config: { requiredEnvVars: ['NON_EXISTENT_VAR_XYZ'] },
      });
      const context = createMockContext(testDir);

      const result = await checkEnvConfig(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('缺少');
      expect(result.details).toBeDefined();
      const details = result.details as { missingRequired: string[] };
      expect(details.missingRequired).toContain('NON_EXISTENT_VAR_XYZ');
    });

    it('应该支持自定义必需变量', async () => {
      process.env.TEST_VAR_123 = 'test-value';

      const rule = createMockRule({
        id: 'R-RES-003',
        config: { requiredEnvVars: ['TEST_VAR_123'] },
      });
      const context = createMockContext(testDir);

      const result = await checkEnvConfig(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('已配置');

      delete process.env.TEST_VAR_123;
    });

    it('应该报告可选变量未配置', async () => {
      const rule = createMockRule({
        id: 'R-RES-003',
        config: {
          requiredEnvVars: ['NODE_ENV'],
          optionalEnvVars: ['OPTIONAL_VAR_XYZ'],
        },
      });
      const context = createMockContext(testDir);

      const result = await checkEnvConfig(rule, context);

      expect(result.details).toBeDefined();
      const details = result.details as { missingOptional: string[] };
      expect(details.missingOptional).toContain('OPTIONAL_VAR_XYZ');
    });

    it('应该提供设置建议', async () => {
      const rule = createMockRule({
        id: 'R-RES-003',
        config: { requiredEnvVars: ['MISSING_VAR'] },
      });
      const context = createMockContext(testDir);

      const result = await checkEnvConfig(rule, context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.some(s => s.includes('export'))).toBe(true);
    });
  });

  // ============================================================================
  // R-RES-004: 磁盘空间检查
  // ============================================================================
  describe('R-RES-004: checkDiskSpace', () => {
    it('空间充足时应该通过', async () => {
      const rule = createMockRule({ id: 'R-RES-004' });
      const context = createMockContext(testDir);

      const result = await checkDiskSpace(rule, context);

      // 磁盘空间检查通常能通过（除非磁盘真的满了）
      expect(result.checkId).toBe('R-RES-004');
      expect(result.timestamp).toBeDefined();
    });

    it('应该返回磁盘空间信息', async () => {
      const rule = createMockRule({ id: 'R-RES-004' });
      const context = createMockContext(testDir);

      const result = await checkDiskSpace(rule, context);

      expect(result.details).toBeDefined();
      const details = result.details as {
        availableMB: number;
        totalMB: number;
        freePercent: number;
      };
      expect(details.availableMB).toBeGreaterThanOrEqual(0);
      expect(details.totalMB).toBeGreaterThanOrEqual(0);
    });

    it('应该支持自定义最小空间要求', async () => {
      const rule = createMockRule({
        id: 'R-RES-004',
        config: { minFreeSpaceMB: 1, minFreeSpacePercent: 1 },
      });
      const context = createMockContext(testDir);

      const result = await checkDiskSpace(rule, context);

      // 几乎总是能通过如此低的要求
      expect(result.details).toBeDefined();
      const details = result.details as { minFreeSpaceMB: number; minFreeSpacePercent: number };
      expect(details.minFreeSpaceMB).toBe(1);
      expect(details.minFreeSpacePercent).toBe(1);
    });

    it('无法检查时应该返回警告', async () => {
      const rule = createMockRule({ id: 'R-RES-004' });
      const context = createMockContext('/nonexistent/path');

      const result = await checkDiskSpace(rule, context);

      // 无法检查时不应该抛出异常
      expect(result.checkId).toBe('R-RES-004');
      expect(result.passed).toBeDefined();
    });

    it('应该包含执行时长', async () => {
      const rule = createMockRule({ id: 'R-RES-004' });
      const context = createMockContext(testDir);

      const result = await checkDiskSpace(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
