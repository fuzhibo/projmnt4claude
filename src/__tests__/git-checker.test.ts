/**
 * Git Checker 单元测试
 *
 * 测试 Git 工作区检查器的核心功能:
 * - R-GIT-001: Git工作区干净检查
 * - R-GIT-002: 暂存区为空检查
 * - R-GIT-003: 忽略文件配置检查 (含 autoFix)
 * - R-GIT-004: 冲突标记检查
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  checkGitWorkspaceClean,
  checkGitStaged,
  checkGitIgnore,
  checkConflictMarkers,
  type GitWorkspaceCheckResult,
} from '../utils/pre-dev-phase-gate/checkers/git-checker.js';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import { createGitTestEnv, type GitTestEnv } from '../utils/test-env.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'git_workspace',
    name: '测试规则',
    description: '这是一个测试规则',
    enabled: true,
    severity: 'warning',
    ...overrides,
  };
}

// 创建 mock 上下文
function createMockContext(cwd: string, overrides: Partial<PreDevPhaseCheckContext> = {}): PreDevPhaseCheckContext {
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

describe('Git Checker Rules', () => {
  let gitEnv: GitTestEnv;

  beforeEach(async () => {
    gitEnv = await createGitTestEnv();
  });

  afterEach(() => {
    gitEnv.cleanup();
  });

  describe('R-GIT-001: checkGitWorkspaceClean', () => {
    it('工作区干净时应该通过', async () => {
      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-001');
      expect(result.checkName).toBe('Git工作区干净检查');
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('干净');
    });

    it('有未提交更改时应该失败', async () => {
      gitEnv.createUntracked('uncommitted.txt', 'test content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未提交');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('应该返回详细的工作区状态', async () => {
      gitEnv.createStaged('staged.txt', 'staged content');
      gitEnv.createUntracked('untracked.txt', 'untracked content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.details).toBeDefined();
      const details = result.details as GitWorkspaceCheckResult;
      expect(details.hasUncommittedChanges).toBe(true);
      expect(details.uncommittedFileCount).toBeGreaterThan(0);
      expect(details.status).toBeDefined();
      expect(Array.isArray(details.status.staged)).toBe(true);
      expect(Array.isArray(details.status.untracked)).toBe(true);
    });

    it('配置 allowUncommitted 时应该通过', async () => {
      gitEnv.createUntracked('untracked1.txt', 'content1');

      const rule = createMockRule({
        id: 'R-GIT-001',
        config: { allowUncommitted: true, maxUntrackedFiles: 10 },
      });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
    });

    it('未跟踪文件过多时应该失败', async () => {
      for (let i = 0; i < 15; i++) {
        gitEnv.createUntracked(`untracked${i}.txt`, `content${i}`);
      }

      const rule = createMockRule({
        id: 'R-GIT-001',
        config: { allowUncommitted: true, maxUntrackedFiles: 10 },
      });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未跟踪文件过多');
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('R-GIT-002: checkGitStaged', () => {
    it('暂存区为空时应该通过', async () => {
      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitStaged(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-002');
      expect(result.checkName).toBe('暂存区为空检查');
      expect(result.message).toContain('为空');
    });

    it('暂存区有文件时应该失败', async () => {
      gitEnv.createStaged('staged.txt', 'staged content');

      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitStaged(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('暂存区');
      expect(result.details).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('应该返回暂存文件列表', async () => {
      gitEnv.createStaged('file1.txt', 'content1');
      gitEnv.createStaged('file2.txt', 'content2');

      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitStaged(rule, context);

      expect(result.details).toBeDefined();
      expect(result.details!.stagedFiles).toBeDefined();
      expect(result.details!.totalStaged).toBe(2);
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitStaged(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('R-GIT-003: checkGitIgnore', () => {
    it('.gitignore 配置完整时应该通过', async () => {
      const gitignoreContent = '# Project files\n.projmnt4claude/\n.projmnt4claude/tasks/\n';
      fs.writeFileSync(path.join(gitEnv.tempDir, '.gitignore'), gitignoreContent);

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-003');
      expect(result.checkName).toBe('忽略文件配置检查');
      expect(result.message).toContain('正确');
    });

    it('.gitignore 缺少必需模式时应该失败', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少');
      expect(result.details).toBeDefined();
      expect(result.details!.missingPatterns).toBeDefined();
      expect(result.details!.missingPatterns.length).toBeGreaterThan(0);
    });

    it('缺少 .gitignore 文件时应该失败并提供 autoFix', async () => {
      const gitignorePath = path.join(gitEnv.tempDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details!.gitignoreExists).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.autoFix).toBeDefined();
      expect(result.autoFix!.description).toContain('自动');
    });

    it('应该提供 autoFix 功能', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.autoFix).toBeDefined();
      expect(result.autoFix!.description).toBeDefined();
      expect(typeof result.autoFix!.fix).toBe('function');
    });

    it('autoFix 应该能修复缺失的 .gitignore 配置', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.autoFix).toBeDefined();

      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fixResult.message).toContain('已添加');

      const gitignoreContent = fs.readFileSync(path.join(gitEnv.tempDir, '.gitignore'), 'utf-8');
      expect(gitignoreContent).toContain('.projmnt4claude/');
    });

    it('autoFix 应该能创建新的 .gitignore 文件', async () => {
      const gitignorePath = path.join(gitEnv.tempDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.autoFix).toBeDefined();

      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignoreContent).toContain('.projmnt4claude/');
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('R-GIT-004: checkConflictMarkers', () => {
    it('无冲突标记时应该通过', async () => {
      gitEnv.createAndCommit('clean.txt', 'This is a clean file\nNo conflicts here\n');

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-004');
      expect(result.checkName).toBe('冲突标记检查');
      expect(result.message).toContain('未发现');
    });

    it('发现冲突标记时应该失败', async () => {
      const conflictContent = `This is a file
<<<<<<< HEAD
Our changes
=======
Their changes
>>>>>>> branch-name
End of file
`;
      fs.writeFileSync(path.join(gitEnv.tempDir, 'conflict.txt'), conflictContent);
      gitEnv.execGit('add conflict.txt');
      gitEnv.execGit('commit -m "Add conflict file"');

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('冲突');
      expect(result.details).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('应该检测所有类型的冲突标记', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, 'marker1.txt'), 'Content\n=======\nMore content\n');
      gitEnv.execGit('add marker1.txt');
      gitEnv.execGit('commit -m "Add marker1" --no-verify');

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details!.conflictMarkers).toBeDefined();
    });

    it('应该返回包含冲突标记的文件列表', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, 'conflict1.txt'), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n');
      fs.writeFileSync(path.join(gitEnv.tempDir, 'conflict2.txt'), 'Content\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n');
      gitEnv.execGit('add conflict1.txt conflict2.txt');
      gitEnv.execGit('commit -m "Add conflict files" --no-verify');

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details).toBeDefined();
      expect(result.details!.totalConflicts).toBeGreaterThan(0);
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('R-GIT-001 在无效目录应该返回错误结果', async () => {
      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext('/nonexistent/directory');

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('Git命令执行失败');
      expect(result.suggestions).toBeDefined();
    });

    it('R-GIT-002 在无效目录应该返回错误结果', async () => {
      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext('/nonexistent/directory');

      const result = await checkGitStaged(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('检查失败');
    });

    it('R-GIT-003 应该处理文件系统错误', async () => {
      const badDir = path.join(gitEnv.tempDir, 'notadir');
      fs.writeFileSync(badDir, 'not a directory');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(badDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.checkId).toBe('R-GIT-003');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('R-GIT-004 应该处理二进制文件读取错误', async () => {
      fs.writeFileSync(path.join(gitEnv.tempDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      gitEnv.execGit('add binary.bin');
      gitEnv.execGit('commit -m "Add binary file" --no-verify');

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(gitEnv.tempDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('未发现');
    });

    it('R-GIT-003 应该处理文件系统错误（读取异常）', async () => {
      const badDir = path.join(gitEnv.tempDir, 'badgitignore');
      fs.mkdirSync(badDir);

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(badDir);

      const gitignoreAsDir = path.join(badDir, '.gitignore');
      fs.mkdirSync(gitignoreAsDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.checkId).toBe('R-GIT-003');
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('检查失败');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('R-GIT-004 在无效目录应该返回错误结果', async () => {
      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext('/nonexistent/directory');

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('冲突检查失败');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('R-GIT-001 应该处理获取分支信息失败的情况', async () => {
      const badGitDir = path.join(gitEnv.tempDir, 'badgit');
      fs.mkdirSync(badGitDir);
      fs.mkdirSync(path.join(badGitDir, '.git'));

      fs.writeFileSync(path.join(badGitDir, 'file.txt'), 'content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(badGitDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.checkId).toBe('R-GIT-001');
      expect(result.passed).toBeDefined();
      expect(result.details).toBeDefined();
    });
  });
});
