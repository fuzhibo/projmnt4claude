/**
 * Git Checker - Git工作区状态检查器
 * 实现 P8 开发阶段前质量门禁的 Git 相关规则
 *
 * 规则覆盖:
 * - R-GIT-001: 工作区干净检查
 * - R-GIT-002: 暂存区为空检查
 * - R-GIT-003: 忽略文件配置检查
 * - R-GIT-004: 冲突标记检查
 *
 * @module pre-dev-phase-gate/checkers/git
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * Git工作区检查结果
 */
export interface GitWorkspaceCheckResult {
  /** 是否有未提交更改 */
  hasUncommittedChanges: boolean;
  /** 未提交文件数 */
  uncommittedFileCount: number;
  /** 当前分支 */
  currentBranch: string;
  /** 分支是否与远程同步 */
  isSyncedWithRemote: boolean;
  /** 是否有冲突 */
  hasConflicts: boolean;
  /** 详细状态 */
  status: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
  };
}

/**
 * R-GIT-001: Git工作区干净状态检查
 * 检查工作区是否有未提交更改
 */
export async function checkGitWorkspaceClean(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const stdout = execSync('git status --porcelain', {
      cwd: context.cwd,
      encoding: 'utf-8',
    });

    const lines = stdout.trim().split('\n').filter(line => line.length > 0);
    const isClean = lines.length === 0;

    // 分类文件状态
    const staged = lines.filter(line => /^[AMDRC]./.test(line));
    const unstaged = lines.filter(line => /^.[MD]/.test(line));
    const untracked = lines.filter(line => line.startsWith('??'));

    const config = rule.config as { allowUncommitted?: boolean; maxUntrackedFiles?: number } | undefined;
    const allowUncommitted = config?.allowUncommitted ?? false;
    const maxUntrackedFiles = config?.maxUntrackedFiles ?? 10;

    let passed = isClean;
    let severity: 'error' | 'warning' | 'info' = rule.severity;
    let message = 'Git工作区干净';
    let suggestions: string[] | undefined;

    if (!isClean) {
      if (allowUncommitted) {
        // 允许未提交，但检查未跟踪文件数量
        if (untracked.length > maxUntrackedFiles) {
          passed = false;
          severity = 'warning';
          message = `未跟踪文件过多: ${untracked.length} 个 (最大允许: ${maxUntrackedFiles})`;
          suggestions = [
            '添加.gitignore规则忽略临时文件',
            '或清理未跟踪文件: git clean -fd',
          ];
        } else {
          passed = true;
          severity = 'info';
          message = `允许未提交更改: ${lines.length} 个文件`;
        }
      } else {
        passed = false;
        message = `Git工作区有未提交更改: ${lines.length} 个文件`;
        suggestions = [
          '提交当前更改:',
          '  git add . && git commit -m "保存当前进度"',
          '或使用储藏:',
          '  git stash push -m "WIP: before harness"',
        ];
      }
    }

    const details: GitWorkspaceCheckResult = {
      hasUncommittedChanges: !isClean,
      uncommittedFileCount: lines.length,
      currentBranch: getCurrentBranch(context.cwd),
      isSyncedWithRemote: false,
      hasConflicts: false,
      status: {
        staged: staged.map(l => l.slice(3)),
        unstaged: unstaged.map(l => l.slice(3)),
        untracked: untracked.map(l => l.slice(3)),
      },
    };

    return {
      checkId: 'R-GIT-001',
      checkName: 'Git工作区干净检查',
      ruleId: rule.id,
      passed,
      severity,
      message,
      details: details as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-GIT-001',
      checkName: 'Git工作区干净检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `Git命令执行失败: ${error instanceof Error ? error.message : String(error)}`,
      suggestions: [
        '检查Git是否已安装',
        '确认当前目录是Git仓库',
      ],
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-GIT-002: 暂存区为空检查
 * 检查是否有暂存但未提交的更改
 */
export async function checkGitStaged(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const stdout = execSync('git diff --cached --name-only', {
      cwd: context.cwd,
      encoding: 'utf-8',
    });

    const stagedFiles = stdout.trim().split('\n').filter(f => f.length > 0);
    const hasStaged = stagedFiles.length > 0;

    return {
      checkId: 'R-GIT-002',
      checkName: '暂存区为空检查',
      ruleId: rule.id,
      passed: !hasStaged,
      severity: 'info',
      message: hasStaged
        ? `暂存区有 ${stagedFiles.length} 个文件待提交`
        : '暂存区为空',
      details: {
        stagedFiles: stagedFiles.slice(0, 10),
        totalStaged: stagedFiles.length,
      },
      suggestions: hasStaged
        ? ['提交暂存区更改: git commit -m "提交暂存更改"']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-GIT-002',
      checkName: '暂存区为空检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-GIT-003: 忽略文件配置检查
 * 检查 .gitignore 是否正确配置
 */
export async function checkGitIgnore(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const gitignorePath = path.join(context.cwd, '.gitignore');
    const excludePath = path.join(context.cwd, '.git', 'info', 'exclude');

    let gitignoreContent = '';
    let excludeContent = '';

    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    }

    if (fs.existsSync(excludePath)) {
      excludeContent = fs.readFileSync(excludePath, 'utf-8');
    }

    const requiredPatterns = ['.projmnt4claude/', '.projmnt4claude/tasks/'];
    const combinedContent = gitignoreContent + '\n' + excludeContent;

    const missingPatterns: string[] = [];
    for (const pattern of requiredPatterns) {
      if (!combinedContent.includes(pattern)) {
        missingPatterns.push(pattern);
      }
    }

    const passed = missingPatterns.length === 0;

    return {
      checkId: 'R-GIT-003',
      checkName: '忽略文件配置检查',
      ruleId: rule.id,
      passed,
      severity: 'warning',
      message: passed
        ? '.gitignore 配置正确'
        : `.gitignore 缺少推荐配置: ${missingPatterns.join(', ')}`,
      details: {
        gitignoreExists: fs.existsSync(gitignorePath),
        missingPatterns,
        recommendedPatterns: requiredPatterns,
      },
      suggestions: missingPatterns.length > 0
        ? [
            `在 .gitignore 中添加:`,
            ...missingPatterns.map(p => `  ${p}`),
          ]
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-GIT-003',
      checkName: '忽略文件配置检查',
      ruleId: rule.id,
      passed: false,
      severity: 'warning',
      message: `检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-GIT-004: 冲突标记检查
 * 检查工作区文件是否包含冲突标记
 */
export async function checkConflictMarkers(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  // 冲突标记正则
  const conflictPatterns = [
    { pattern: /^<{7}\s/m, name: '<<<<<<<' },
    { pattern: /^={7}\s/m, name: '=======' },
    { pattern: /^>{7}\s/m, name: '>>>>>>>' },
  ];

  try {
    // 获取已跟踪文件列表
    const trackedFiles = execSync('git ls-files', {
      cwd: context.cwd,
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(f => f.length > 0);

    const filesWithConflicts: string[] = [];

    // 限制检查文件数以避免性能问题
    const filesToCheck = trackedFiles.slice(0, 100);

    for (const file of filesToCheck) {
      const filePath = path.join(context.cwd, file);

      if (!fs.existsSync(filePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (conflictPatterns.some(cp => cp.pattern.test(content))) {
          filesWithConflicts.push(file);
        }
      } catch {
        // 忽略二进制文件读取错误
      }
    }

    const passed = filesWithConflicts.length === 0;

    return {
      checkId: 'R-GIT-004',
      checkName: '冲突标记检查',
      ruleId: rule.id,
      passed,
      severity: 'error',
      message: passed
        ? '未发现冲突标记'
        : `发现冲突标记: ${filesWithConflicts.length} 个文件`,
      details: {
        filesWithConflicts: filesWithConflicts.slice(0, 10),
        totalConflicts: filesWithConflicts.length,
        conflictMarkers: conflictPatterns.map(cp => cp.name),
      },
      suggestions: passed
        ? undefined
        : [
            '解决冲突后重新运行:',
            '  1. 编辑文件解决冲突',
            '  2. git add <file>',
            '  3. git commit -m "解决冲突"',
          ],
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-GIT-004',
      checkName: '冲突标记检查',
      ruleId: rule.id,
      passed: false,
      severity: 'warning',
      message: `冲突检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 获取当前分支
 */
function getCurrentBranch(cwd: string): string {
  try {
    return execSync('git branch --show-current', {
      cwd,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}
