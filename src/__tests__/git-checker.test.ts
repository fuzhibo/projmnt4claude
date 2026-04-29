/**
 * Git Checker 单元测试
 *
 * 测试 Git 工作区检查器的核心功能:
 * - R-GIT-001: Git工作区干净检查
 * - R-GIT-002: 暂存区为空检查
 * - R-GIT-003: 忽略文件配置检查 (含 autoFix)
 * - R-GIT-004: 冲突标记检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  let testDir: string;
  let gitDir: string;

  beforeEach(() => {
    // 创建临时测试目录并初始化为 git 仓库
    testDir = fs.mkdtempSync('/tmp/git-checker-test-');
    gitDir = path.join(testDir, '.git');

    // 初始化 git 仓库
    execSync('git init', { cwd: testDir, encoding: 'utf-8' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, encoding: 'utf-8' });
    execSync('git config user.name "Test User"', { cwd: testDir, encoding: 'utf-8' });

    // 创建初始提交
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Project');
    execSync('git add README.md', { cwd: testDir, encoding: 'utf-8' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, encoding: 'utf-8' });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // ============================================================================
  // R-GIT-001: Git工作区干净检查
  // ============================================================================
  describe('R-GIT-001: checkGitWorkspaceClean', () => {
    it('工作区干净时应该通过', async () => {
      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(testDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-001');
      expect(result.checkName).toBe('Git工作区干净检查');
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('干净');
    });

    it('有未提交更改时应该失败', async () => {
      // 创建未提交文件
      fs.writeFileSync(path.join(testDir, 'uncommitted.txt'), 'test content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(testDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未提交');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('应该返回详细的工作区状态', async () => {
      // 创建暂存文件
      fs.writeFileSync(path.join(testDir, 'staged.txt'), 'staged content');
      execSync('git add staged.txt', { cwd: testDir, encoding: 'utf-8' });

      // 创建未跟踪文件
      fs.writeFileSync(path.join(testDir, 'untracked.txt'), 'untracked content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(testDir);

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
      // 创建未跟踪文件（少于 maxUntrackedFiles）
      fs.writeFileSync(path.join(testDir, 'untracked1.txt'), 'content1');

      const rule = createMockRule({
        id: 'R-GIT-001',
        config: { allowUncommitted: true, maxUntrackedFiles: 10 },
      });
      const context = createMockContext(testDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
    });

    it('未跟踪文件过多时应该失败', async () => {
      // 创建大量未跟踪文件
      for (let i = 0; i < 15; i++) {
        fs.writeFileSync(path.join(testDir, `untracked${i}.txt`), `content${i}`);
      }

      const rule = createMockRule({
        id: 'R-GIT-001',
        config: { allowUncommitted: true, maxUntrackedFiles: 10 },
      });
      const context = createMockContext(testDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未跟踪文件过多');
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(testDir);

      const result = await checkGitWorkspaceClean(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // R-GIT-002: 暂存区为空检查
  // ============================================================================
  describe('R-GIT-002: checkGitStaged', () => {
    it('暂存区为空时应该通过', async () => {
      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(testDir);

      const result = await checkGitStaged(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-002');
      expect(result.checkName).toBe('暂存区为空检查');
      expect(result.message).toContain('为空');
    });

    it('暂存区有文件时应该失败', async () => {
      // 创建并暂存文件
      fs.writeFileSync(path.join(testDir, 'staged.txt'), 'staged content');
      execSync('git add staged.txt', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(testDir);

      const result = await checkGitStaged(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('暂存区');
      expect(result.details).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('应该返回暂存文件列表', async () => {
      // 创建并暂存多个文件
      fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content2');
      execSync('git add file1.txt file2.txt', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(testDir);

      const result = await checkGitStaged(rule, context);

      expect(result.details).toBeDefined();
      expect(result.details!.stagedFiles).toBeDefined();
      expect(result.details!.totalStaged).toBe(2);
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-002' });
      const context = createMockContext(testDir);

      const result = await checkGitStaged(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-GIT-003: 忽略文件配置检查 (含 autoFix)
  // ============================================================================
  describe('R-GIT-003: checkGitIgnore', () => {
    it('.gitignore 配置完整时应该通过', async () => {
      // 创建包含所有必需模式的 .gitignore
      const gitignoreContent = '# Project files\n.projmnt4claude/\n.projmnt4claude/tasks/\n';
      fs.writeFileSync(path.join(testDir, '.gitignore'), gitignoreContent);

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-003');
      expect(result.checkName).toBe('忽略文件配置检查');
      expect(result.message).toContain('正确');
    });

    it('.gitignore 缺少必需模式时应该失败', async () => {
      // 创建不完整的 .gitignore
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少');
      expect(result.details).toBeDefined();
      expect(result.details!.missingPatterns).toBeDefined();
      expect(result.details!.missingPatterns.length).toBeGreaterThan(0);
    });

    it('缺少 .gitignore 文件时应该失败并提供 autoFix', async () => {
      // 确保没有 .gitignore
      const gitignorePath = path.join(testDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details!.gitignoreExists).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.autoFix).toBeDefined();
      expect(result.autoFix!.description).toContain('自动');
    });

    it('应该提供 autoFix 功能', async () => {
      // 创建不完整的 .gitignore
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.passed).toBe(false);
      expect(result.autoFix).toBeDefined();
      expect(result.autoFix!.description).toBeDefined();
      expect(typeof result.autoFix!.fix).toBe('function');
    });

    it('autoFix 应该能修复缺失的 .gitignore 配置', async () => {
      // 创建不完整的 .gitignore
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\n');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.autoFix).toBeDefined();

      // 执行 autoFix
      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fixResult.message).toContain('已添加');

      // 验证 .gitignore 已被更新
      const gitignoreContent = fs.readFileSync(path.join(testDir, '.gitignore'), 'utf-8');
      expect(gitignoreContent).toContain('.projmnt4claude/');
    });

    it('autoFix 应该能创建新的 .gitignore 文件', async () => {
      // 确保没有 .gitignore
      const gitignorePath = path.join(testDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.autoFix).toBeDefined();

      // 执行 autoFix
      const fixResult = await result.autoFix!.fix();

      expect(fixResult.success).toBe(true);
      expect(fs.existsSync(gitignorePath)).toBe(true);

      // 验证内容
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignoreContent).toContain('.projmnt4claude/');
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(testDir);

      const result = await checkGitIgnore(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-GIT-004: 冲突标记检查
  // ============================================================================
  describe('R-GIT-004: checkConflictMarkers', () => {
    it('无冲突标记时应该通过', async () => {
      // 创建普通文件
      fs.writeFileSync(path.join(testDir, 'clean.txt'), 'This is a clean file\nNo conflicts here\n');
      execSync('git add clean.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add clean file"', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-GIT-004');
      expect(result.checkName).toBe('冲突标记检查');
      expect(result.message).toContain('未发现');
    });

    it('发现冲突标记时应该失败', async () => {
      // 创建包含冲突标记的文件
      const conflictContent = `This is a file
<<<<<<< HEAD
Our changes
=======
Their changes
>>>>>>> branch-name
End of file
`;
      fs.writeFileSync(path.join(testDir, 'conflict.txt'), conflictContent);
      execSync('git add conflict.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add conflict file"', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('冲突');
      expect(result.details).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('应该检测所有类型的冲突标记', async () => {
      // 测试 ======= 标记
      fs.writeFileSync(path.join(testDir, 'marker1.txt'), 'Content\n=======\nMore content\n');
      execSync('git add marker1.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add marker1" --no-verify', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details!.conflictMarkers).toBeDefined();
    });

    it('应该返回包含冲突标记的文件列表', async () => {
      // 创建多个冲突文件
      fs.writeFileSync(path.join(testDir, 'conflict1.txt'), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n');
      fs.writeFileSync(path.join(testDir, 'conflict2.txt'), 'Content\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n');
      execSync('git add conflict1.txt conflict2.txt', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add conflict files" --no-verify', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details).toBeDefined();
      expect(result.details!.totalConflicts).toBeGreaterThan(0);
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // 错误处理测试
  // ============================================================================
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
      // 创建一个文件而不是目录来模拟权限问题
      const badDir = path.join(testDir, 'notadir');
      fs.writeFileSync(badDir, 'not a directory');

      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(badDir);

      const result = await checkGitIgnore(rule, context);

      // 应该返回检查结果而不是抛出异常
      expect(result.checkId).toBe('R-GIT-003');
      expect(result.duration).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('R-GIT-004 应该处理二进制文件读取错误', async () => {
      // 创建一个模拟的二进制文件（不会被正则匹配）
      fs.writeFileSync(path.join(testDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      execSync('git add binary.bin', { cwd: testDir, encoding: 'utf-8' });
      execSync('git commit -m "Add binary file" --no-verify', { cwd: testDir, encoding: 'utf-8' });

      const rule = createMockRule({ id: 'R-GIT-004' });
      const context = createMockContext(testDir);

      const result = await checkConflictMarkers(rule, context);

      // 二进制文件应该被忽略，不影响检查结果
      expect(result.passed).toBe(true);
      expect(result.message).toContain('未发现');
    });

    it('R-GIT-003 应该处理文件系统错误（读取异常）', async () => {
      // 创建一个目录作为 .gitignore 路径，这样 readFileSync 会抛出异常
      const badDir = path.join(testDir, 'badgitignore');
      fs.mkdirSync(badDir);

      // 在上下文中设置一个路径，让 .gitignore 指向一个目录（而不是文件）
      // 这会触发 readFileSync 抛出 EISDIR 错误
      const rule = createMockRule({ id: 'R-GIT-003' });
      const context = createMockContext(badDir);

      // 临时创建一个名为 .gitignore 的目录来触发读取错误
      const gitignoreAsDir = path.join(badDir, '.gitignore');
      fs.mkdirSync(gitignoreAsDir);

      const result = await checkGitIgnore(rule, context);

      // 应该返回检查结果而不是抛出异常
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
      // 创建一个目录，初始化 git 但损坏 git 配置以触发分支获取失败
      const badGitDir = path.join(testDir, 'badgit');
      fs.mkdirSync(badGitDir);
      fs.mkdirSync(path.join(badGitDir, '.git'));

      // 添加一个文件，这样 git status 会工作（因为没有实际的 git 结构）
      fs.writeFileSync(path.join(badGitDir, 'file.txt'), 'content');

      const rule = createMockRule({ id: 'R-GIT-001' });
      const context = createMockContext(badGitDir);

      // 这里主要验证不会抛出异常
      const result = await checkGitWorkspaceClean(rule, context);

      // 验证返回了结果
      expect(result.checkId).toBe('R-GIT-001');
      expect(result.passed).toBeDefined();
      expect(result.details).toBeDefined();
    });
  });
});
