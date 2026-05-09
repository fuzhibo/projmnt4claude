/**
 * Git Workspace Checker Tests
 * Git工作区综合检查器测试
 *
 * 测试 GitWorkspaceChecker 的核心功能:
 * - 整合 Git 工作区检查
 * - 整合分支状态检查
 * - 生成综合报告
 *
 * @module tests/pre-dev-phase-gate/git-workspace-checker
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  GitWorkspaceChecker,
  createGitWorkspaceChecker,
  quickGitWorkspaceCheck,
  DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG,
  type GitWorkspaceCheckerConfig,
  type GitWorkspaceReport,
} from '../utils/pre-dev-phase-gate/checkers/git-workspace-checker.js';
import type { PreDevPhaseCheckContext } from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import { createGitTestEnv, type GitTestEnv } from '../utils/test-env.js';

// 创建 mock 上下文
function createMockContext(
  cwd: string,
  branch?: string,
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
    branch,
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

describe('GitWorkspaceChecker', () => {
  let gitEnv: GitTestEnv;
  let checker: GitWorkspaceChecker;

  beforeEach(async () => {
    gitEnv = await createGitTestEnv();
    checker = new GitWorkspaceChecker();
  });

  afterEach(() => {
    gitEnv.cleanup();
  });

  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(checker.id).toBe('checker-git-workspace');
    });

    it('应该有正确的 name', () => {
      expect(checker.name).toBe('Git工作区检查器');
    });

    it('应该有正确的 description', () => {
      expect(checker.description).toContain('Git');
      expect(checker.description).toContain('分支状态');
    });

    it('isApplicable 应该始终返回 true', () => {
      const context = createMockContext(gitEnv.tempDir);
      expect(checker.isApplicable(context)).toBe(true);
    });
  });

  describe('配置', () => {
    it('应该使用默认配置', () => {
      const defaultChecker = new GitWorkspaceChecker();
      expect(defaultChecker).toBeDefined();
    });

    it('应该合并自定义配置', () => {
      const customConfig: Partial<GitWorkspaceCheckerConfig> = {
        allowUncommitted: true,
        maxUntrackedFiles: 5,
      };
      const customChecker = new GitWorkspaceChecker(customConfig);
      expect(customChecker).toBeDefined();
    });

    it('默认配置应该包含所有必需字段', () => {
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.enableGitChecks).toBe(true);
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.enableBranchChecks).toBe(true);
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.allowUncommitted).toBe(false);
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.maxUntrackedFiles).toBe(10);
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.requireSync).toBe(true);
      expect(DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG.allowedBranches).toContain('main');
    });
  });

  describe('Git工作区检查', () => {
    it('应该检查工作区是否干净', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
      const report = result.details?.report as GitWorkspaceReport;
      expect(report.isClean).toBe(true);
      expect(report.uncommittedCount).toBe(0);
    });

    it('应该检测未提交更改', async () => {
      gitEnv.createUntracked('uncommitted.ts', 'const x = 1;');

      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.isClean).toBe(false);
      expect(report.uncommittedCount).toBeGreaterThan(0);
    });

    it('应该检查暂存区状态', async () => {
      gitEnv.createStaged('staged.ts', 'const y = 2;');

      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.stagedStatus.hasStaged).toBe(true);
      expect(report.stagedStatus.stagedCount).toBeGreaterThan(0);
    });

    it('应该检查冲突标记', async () => {
      gitEnv.createConflict('conflict.ts');

      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.hasConflicts).toBe(true);
    });
  });

  describe('分支状态检查', () => {
    it('应该检查分支是否存在', async () => {
      gitEnv.execGit('checkout -b feature/test-branch');

      const context = createMockContext(gitEnv.tempDir, 'feature/test-branch');
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.branchExists).toBe(true);
      expect(report.targetBranch).toBe('feature/test-branch');
    });

    it('应该检测不存在的分支', async () => {
      const context = createMockContext(gitEnv.tempDir, 'feature/non-existent');
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.branchExists).toBe(false);
    });

    it('应该检查当前分支', async () => {
      gitEnv.execGit('checkout -b feature/current');

      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.currentBranch).toBe('feature/current');
    });

    it('应该检查可切换性', async () => {
      const defaultBranch = gitEnv.currentBranch;

      gitEnv.execGit('checkout -b feature/target');
      gitEnv.createAndCommit('target.txt', 'target', 'Add target file');

      gitEnv.execGit(`checkout ${defaultBranch}`);

      const context = createMockContext(gitEnv.tempDir, 'feature/target');
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report.canSwitchBranch).toBe(true);
    });
  });

  describe('综合报告', () => {
    it('应该生成完整的报告', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      const report = result.details?.report as GitWorkspaceReport;
      expect(report).toHaveProperty('isClean');
      expect(report).toHaveProperty('uncommittedCount');
      expect(report).toHaveProperty('currentBranch');
      expect(report).toHaveProperty('branchExists');
      expect(report).toHaveProperty('hasRemoteTracking');
      expect(report).toHaveProperty('isSynced');
      expect(report).toHaveProperty('behindCount');
      expect(report).toHaveProperty('aheadCount');
      expect(report).toHaveProperty('canSwitchBranch');
      expect(report).toHaveProperty('hasConflicts');
      expect(report).toHaveProperty('stagedStatus');
      expect(report).toHaveProperty('gitignoreStatus');
    });

    it('报告应该包含所有检查结果', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      expect(result.details?.checkResults).toBeDefined();
      expect(Array.isArray(result.details?.checkResults)).toBe(true);
      expect(result.details?.checkResults.length).toBeGreaterThan(0);
    });
  });

  describe('建议生成', () => {
    it('应该为有问题的检查结果生成建议', async () => {
      gitEnv.createUntracked('dirty.ts', 'const dirty = true;');

      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });
  });

  describe('结果严重级别', () => {
    it('干净工作区应该返回通过的检查结果', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      expect(result.passed).toBe(true);
    });
  });

  describe('快速检查函数', () => {
    it('quickGitWorkspaceCheck 应该返回检查结果', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await quickGitWorkspaceCheck(context);

      expect(result).toBeDefined();
      expect(result.checkerId).toBe('checker-git-workspace');
      expect(result.passed).toBe(true);
    });
  });

  describe('工厂函数', () => {
    it('createGitWorkspaceChecker 应该创建实例', () => {
      const checker = createGitWorkspaceChecker();
      expect(checker).toBeInstanceOf(GitWorkspaceChecker);
      expect(checker.id).toBe('checker-git-workspace');
    });

    it('createGitWorkspaceChecker 应该接受自定义配置', () => {
      const config: Partial<GitWorkspaceCheckerConfig> = {
        allowUncommitted: true,
        maxUntrackedFiles: 20,
      };
      const checker = createGitWorkspaceChecker(config);
      expect(checker).toBeInstanceOf(GitWorkspaceChecker);
    });
  });

  describe('禁用特定检查', () => {
    it('应该可以禁用 Git 检查', async () => {
      const config: Partial<GitWorkspaceCheckerConfig> = {
        enableGitChecks: false,
      };
      const disabledChecker = new GitWorkspaceChecker(config);

      const context = createMockContext(gitEnv.tempDir);
      const result = await disabledChecker.check(context);

      // 当禁用 Git 检查时，只有分支检查的结果 (5个)
      expect(result.details?.checkResults.length).toBe(5);
    });

    it('应该可以禁用分支检查', async () => {
      const config: Partial<GitWorkspaceCheckerConfig> = {
        enableBranchChecks: false,
      };
      const disabledChecker = new GitWorkspaceChecker(config);

      const context = createMockContext(gitEnv.tempDir);
      const result = await disabledChecker.check(context);

      // 当禁用分支检查时，只有 Git 检查的结果 (4个)
      expect(result.details?.checkResults.length).toBe(4);
    });
  });

  describe('执行时长', () => {
    it('应该包含执行时长', async () => {
      const context = createMockContext(gitEnv.tempDir);
      const result = await checker.check(context);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });
});
