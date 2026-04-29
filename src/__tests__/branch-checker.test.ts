/**
 * Branch Checker 单元测试
 *
 * 测试分支状态检查器的核心功能:
 * - R-BR-001: 目标分支存在性检查
 * - R-BR-002: 分支关联正确性检查
 * - R-BR-003: 远程分支追踪检查
 * - R-BR-004: 分支同步状态检查
 * - R-BR-005: 分支可切换性检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  checkBranchExists,
  checkBranchAssociation,
  checkBranchTracking,
  checkBranchSync,
  checkBranchSwitchable,
  type BranchCheckResult,
} from '../utils/pre-dev-phase-gate/checkers/branch-checker.js';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'branch_status',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'cli',
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

describe('Branch Checker Rules', () => {
  let testDir: string;
  let gitDir: string;
  let defaultBranch: string;

  beforeEach(() => {
    // 创建临时测试目录并初始化为 git 仓库
    testDir = fs.mkdtempSync('/tmp/branch-checker-test-');
    gitDir = path.join(testDir, '.git');

    // 初始化 git 仓库
    execSync('git init', { cwd: testDir, encoding: 'utf-8' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, encoding: 'utf-8' });
    execSync('git config user.name "Test User"', { cwd: testDir, encoding: 'utf-8' });

    // 创建初始提交
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Project');
    execSync('git add README.md', { cwd: testDir, encoding: 'utf-8' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, encoding: 'utf-8' });

    // 检测默认分支名
    try {
      execSync('git rev-parse --verify main', { cwd: testDir, encoding: 'utf-8' });
      defaultBranch = 'main';
    } catch {
      defaultBranch = 'master';
    }
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // ============================================================================
  // R-BR-001: 目标分支存在性检查
  // ============================================================================
  describe('R-BR-001: checkBranchExists', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-BR-001' });
      const context = createMockContext(testDir, undefined);

      const result = await checkBranchExists(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-BR-001');
      expect(result.checkName).toBe('目标分支存在性检查');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('分支存在时应该通过', async () => {
      // 创建分支
      execSync('git checkout -b feature/test-branch', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-BR-001' });
      const context = createMockContext(testDir, 'feature/test-branch');

      const result = await checkBranchExists(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('存在');
      expect(result.details).toBeDefined();
      expect(result.details!.exists).toBe(true);
    });

    it('分支不存在时应该失败', async () => {
      const rule = createMockRule({ id: 'R-BR-001' });
      const context = createMockContext(testDir, 'non-existent-branch');

      const result = await checkBranchExists(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
      expect(result.details).toBeDefined();
      expect(result.details!.exists).toBe(false);
      expect(result.suggestions).toBeDefined();
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-BR-001' });
      const context = createMockContext(testDir, defaultBranch);

      const result = await checkBranchExists(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-BR-002: 分支关联正确性检查
  // ============================================================================
  describe('R-BR-002: checkBranchAssociation', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-BR-002' });
      const context = createMockContext(testDir, undefined);

      const result = await checkBranchAssociation(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-BR-002');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('包含任务ID的分支名应该通过', async () => {
      const rule = createMockRule({ id: 'R-BR-002' });
      const context = createMockContext(testDir, 'feature/TASK-test-001-description');

      const result = await checkBranchAssociation(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('符合约定');
      expect(result.details).toBeDefined();
      expect(result.details!.containsTaskId).toBe(true);
    });

    it('使用标准前缀的分支名应该通过', async () => {
      const rule = createMockRule({ id: 'R-BR-002' });
      const context = createMockContext(testDir, 'feature/some-description');

      const result = await checkBranchAssociation(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('符合约定');
      expect(result.details).toBeDefined();
      expect(result.details!.hasValidPrefix).toBe(true);
    });

    it('不符合约定的分支名应该失败', async () => {
      const rule = createMockRule({ id: 'R-BR-002' });
      const context = createMockContext(testDir, 'random-branch-name');

      const result = await checkBranchAssociation(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('不符合约定');
      expect(result.suggestions).toBeDefined();
    });

    it('应该支持各种标准前缀', async () => {
      const prefixes = ['feature/', 'bugfix/', 'hotfix/', 'release/', 'task/', 'dev/'];

      for (const prefix of prefixes) {
        const rule = createMockRule({ id: 'R-BR-002' });
        const context = createMockContext(testDir, `${prefix}test`);

        const result = await checkBranchAssociation(rule, context);

        expect(result.passed).toBe(true);
        expect(result.details!.hasValidPrefix).toBe(true);
      }
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-BR-002' });
      const context = createMockContext(testDir, 'feature/test');

      const result = await checkBranchAssociation(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-BR-003: 远程分支追踪检查
  // ============================================================================
  describe('R-BR-003: checkBranchTracking', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-BR-003' });
      const context = createMockContext(testDir, undefined);

      const result = await checkBranchTracking(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-BR-003');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('未设置远程追踪时应该失败', async () => {
      // 创建本地分支但不推送
      execSync('git checkout -b feature/no-remote', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-BR-003' });
      const context = createMockContext(testDir, 'feature/no-remote');

      const result = await checkBranchTracking(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('未追踪远程');
      expect(result.suggestions).toBeDefined();
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-BR-003' });
      const context = createMockContext(testDir, defaultBranch);

      const result = await checkBranchTracking(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-BR-004: 分支同步状态检查
  // ============================================================================
  describe('R-BR-004: checkBranchSync', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-BR-004' });
      const context = createMockContext(testDir, undefined);

      const result = await checkBranchSync(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-BR-004');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('没有远程仓库时应该返回警告但不失败', async () => {
      // 创建本地分支
      execSync('git checkout -b feature/no-upstream', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-BR-004' });
      const context = createMockContext(testDir, 'feature/no-upstream');

      const result = await checkBranchSync(rule, context);

      // 没有远程仓库时应该通过但给出警告或返回无法检查的信息
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-BR-004' });
      const context = createMockContext(testDir, defaultBranch);

      const result = await checkBranchSync(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-BR-005: 分支可切换性检查
  // ============================================================================
  describe('R-BR-005: checkBranchSwitchable', () => {
    it('未配置分支时应该跳过', async () => {
      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, undefined);

      const result = await checkBranchSwitchable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-BR-005');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('未配置');
    });

    it('已在目标分支上时应该通过', async () => {
      // 创建并切换到分支
      execSync('git checkout -b feature/current-branch', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, 'feature/current-branch');

      const result = await checkBranchSwitchable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('已在目标分支上');
      expect(result.details).toBeDefined();
      expect(result.details!.currentBranch).toBe('feature/current-branch');
    });

    it('目标分支不存在时应该失败', async () => {
      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, 'non-existent-branch');

      const result = await checkBranchSwitchable(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
      expect(result.suggestions).toBeDefined();
    });

    it('有未提交更改时应该失败', async () => {
      // 先创建并切换到一个分支，然后再切回默认分支
      execSync('git checkout -b feature/target', { cwd: testDir, encoding: 'utf-8' });
      // 添加一个提交到 feature/target
      fs.writeFileSync(path.join(testDir, 'target.txt'), 'target content');
      execSync('git add target.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add target file"', { cwd: testDir, encoding: 'utf-8' });
      // 切回默认分支
      execSync(`git checkout ${defaultBranch}`, { cwd: testDir, encoding: 'utf-8' });
      // 创建未提交文件
      fs.writeFileSync(path.join(testDir, 'uncommitted.txt'), 'test content');

      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, 'feature/target');

      const result = await checkBranchSwitchable(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未提交更改');
      expect(result.details).toBeDefined();
      expect(result.details!.hasUncommittedChanges).toBe(true);
      expect(result.suggestions).toBeDefined();
    });

    it('工作区干净时应该通过', async () => {
      // 创建分支并添加提交
      execSync('git checkout -b feature/clean-target', { cwd: testDir, encoding: 'utf-8' });
      fs.writeFileSync(path.join(testDir, 'clean.txt'), 'clean content');
      execSync('git add clean.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add clean file"', { cwd: testDir, encoding: 'utf-8' });
      // 切回默认分支
      execSync(`git checkout ${defaultBranch}`, { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, 'feature/clean-target');

      const result = await checkBranchSwitchable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('可以切换到分支');
      expect(result.details).toBeDefined();
      expect(result.details!.hasUncommittedChanges).toBe(false);
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext(testDir, defaultBranch);

      const result = await checkBranchSwitchable(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // 错误处理测试
  // ============================================================================
  describe('错误处理', () => {
    it('R-BR-001 在无效目录应该返回错误结果', async () => {
      const rule = createMockRule({ id: 'R-BR-001' });
      const context = createMockContext('/nonexistent/directory', defaultBranch);

      const result = await checkBranchExists(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
    });

    it('R-BR-005 应该处理检查异常', async () => {
      const rule = createMockRule({ id: 'R-BR-005' });
      const context = createMockContext('/nonexistent/directory', defaultBranch);

      const result = await checkBranchSwitchable(rule, context);

      expect(result.checkId).toBe('R-BR-005');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('检查失败');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });
  });
});
