/**
 * Branch Checker - 分支与同步状态检查器
 * 实现 P8 开发阶段前质量门禁的分支相关规则
 *
 * 规则覆盖:
 * - R-BR-001: 目标分支存在性
 * - R-BR-002: 分支关联正确性
 * - R-BR-003: 远程分支追踪
 * - R-BR-004: 分支同步状态
 * - R-BR-005: 分支可切换性
 *
 * @module pre-dev-phase-gate/checkers/branch
 */

import { execSync } from 'node:child_process';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 分支检查结果
 */
export interface BranchCheckResult {
  /** 当前分支 */
  currentBranch: string;
  /** 目标分支 */
  targetBranch?: string;
  /** 分支是否存在 */
  exists: boolean;
  /** 是否有远程追踪 */
  hasRemoteTracking: boolean;
  /** 是否与远程同步 */
  isSyncedWithRemote: boolean;
  /** 落后远程的提交数 */
  behindCount: number;
  /** 领先远程的提交数 */
  aheadCount: number;
  /** 是否可切换 */
  isSwitchable: boolean;
}

/**
 * R-BR-001: 目标分支存在性检查
 * 检查任务关联的分支是否在本地存在
 */
export async function checkBranchExists(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;

  // 如果没有配置分支，跳过检查
  if (!targetBranch) {
    return {
      checkId: 'R-BR-001',
      checkName: '目标分支存在性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 检查本地分支是否存在
    execSync(`git rev-parse --verify ${targetBranch}`, {
      cwd: context.cwd,
      encoding: 'utf-8',
    });

    return {
      checkId: 'R-BR-001',
      checkName: '目标分支存在性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'error',
      message: `分支存在: ${targetBranch}`,
      details: {
        targetBranch,
        exists: true,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      checkId: 'R-BR-001',
      checkName: '目标分支存在性检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `分支不存在: ${targetBranch}`,
      details: {
        targetBranch,
        exists: false,
      },
      suggestions: [
        `创建分支: git checkout -b ${targetBranch}`,
        '或更新任务的分支配置',
      ],
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-BR-002: 分支关联正确性检查
 * 检查分支名称是否符合约定（包含任务ID）
 */
export async function checkBranchAssociation(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;
  const taskId = context.task.id;

  if (!targetBranch) {
    return {
      checkId: 'R-BR-002',
      checkName: '分支关联正确性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 检查分支名是否包含任务ID或符合常见约定
  const taskIdPattern = taskId.toLowerCase().replace(/-/g, '[-_]');
  const containsTaskId = new RegExp(taskIdPattern, 'i').test(targetBranch);

  // 常见分支前缀
  const validPrefixes = ['feature/', 'bugfix/', 'hotfix/', 'release/', 'task/', 'dev/'];
  const hasValidPrefix = validPrefixes.some(prefix =>
    targetBranch.toLowerCase().startsWith(prefix)
  );

  const passed = containsTaskId || hasValidPrefix;

  return {
    checkId: 'R-BR-002',
    checkName: '分支关联正确性检查',
    ruleId: rule.id,
    passed,
    severity: 'warning',
    message: passed
      ? `分支名称符合约定: ${targetBranch}`
      : `分支名称可能不符合约定: ${targetBranch}`,
    details: {
      targetBranch,
      taskId,
      containsTaskId,
      hasValidPrefix,
      validPrefixes,
    },
    suggestions: !passed
      ? [
          `建议分支名包含任务ID: ${taskId}`,
          `或使用标准前缀: ${validPrefixes.join(', ')}`,
          `示例: feature/${taskId}-description`,
        ]
      : undefined,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * R-BR-003: 远程分支追踪检查
 * 检查分支是否有对应的远程分支
 */
export async function checkBranchTracking(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;

  if (!targetBranch) {
    return {
      checkId: 'R-BR-003',
      checkName: '远程分支追踪检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 检查是否有上游分支配置
    const upstream = execSync(
      `git rev-parse --abbrev-ref --symbolic-full-name ${targetBranch}@{u}`,
      { cwd: context.cwd, encoding: 'utf-8' }
    ).trim();

    const hasRemoteTracking = upstream.length > 0;

    return {
      checkId: 'R-BR-003',
      checkName: '远程分支追踪检查',
      ruleId: rule.id,
      passed: true,
      severity: 'warning',
      message: hasRemoteTracking
        ? `分支已追踪远程: ${upstream}`
        : '分支未配置远程追踪',
      details: {
        targetBranch,
        upstream,
        hasRemoteTracking,
      },
      suggestions: !hasRemoteTracking
        ? [
            `推送并设置上游: git push -u origin ${targetBranch}`,
            '或手动设置上游: git branch --set-upstream-to=origin/' + targetBranch,
          ]
        : undefined,
      autoFixable: !hasRemoteTracking,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch {
    // 没有上游分支 - 创建 autoFix 函数
    const autoFix = {
      description: `设置分支 ${targetBranch} 的远程追踪`,
      fix: async () => {
        try {
          execSync(`git branch -u origin/${targetBranch}`, {
            cwd: context.cwd,
            encoding: 'utf-8',
          });
          return {
            success: true,
            message: `成功设置分支 ${targetBranch} 追踪远程 origin/${targetBranch}`,
          };
        } catch (error) {
          return {
            success: false,
            message: `设置远程追踪失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };

    return {
      checkId: 'R-BR-003',
      checkName: '远程分支追踪检查',
      ruleId: rule.id,
      passed: false,
      severity: 'warning',
      message: `分支未追踪远程: ${targetBranch}`,
      details: {
        targetBranch,
        hasRemoteTracking: false,
      },
      suggestions: [
        `推送并设置上游: git push -u origin ${targetBranch}`,
      ],
      autoFixable: true,
      autoFix,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-BR-004: 分支同步状态检查
 * 检查本地分支是否与远程同步
 */
export async function checkBranchSync(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;
  const currentBranch = getCurrentBranch(context.cwd);

  if (!targetBranch) {
    return {
      checkId: 'R-BR-004',
      checkName: '分支同步状态检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 先获取远程更新
    execSync('git fetch origin', {
      cwd: context.cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    // 检查是否有上游分支
    let hasUpstream = false;
    try {
      execSync(
        `git rev-parse --abbrev-ref --symbolic-full-name ${targetBranch}@{u}`,
        { cwd: context.cwd, encoding: 'utf-8' }
      );
      hasUpstream = true;
    } catch {
      hasUpstream = false;
    }

    if (!hasUpstream) {
      return {
        checkId: 'R-BR-004',
        checkName: '分支同步状态检查',
        ruleId: rule.id,
        passed: true,
        severity: 'warning',
        message: '分支未设置远程追踪，无法检查同步状态',
        suggestions: [
          `设置远程追踪: git push -u origin ${targetBranch}`,
        ],
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查本地分支与远程的差异
    const behindOutput = execSync(
      `git rev-list --count ${targetBranch}..${targetBranch}@{u}`,
      { cwd: context.cwd, encoding: 'utf-8' }
    ).trim();

    const aheadOutput = execSync(
      `git rev-list --count ${targetBranch}@{u}..${targetBranch}`,
      { cwd: context.cwd, encoding: 'utf-8' }
    ).trim();

    const behindCount = parseInt(behindOutput, 10) || 0;
    const aheadCount = parseInt(aheadOutput, 10) || 0;
    const isBehind = behindCount > 0;
    const isAhead = aheadCount > 0;

    let passed = !isBehind;
    let message = '分支已与远程同步';

    if (isBehind && isAhead) {
      message = `分支与远程分歧: 落后 ${behindCount} 个提交，领先 ${aheadCount} 个提交`;
    } else if (isBehind) {
      message = `分支落后远程 ${behindCount} 个提交`;
    } else if (isAhead) {
      message = `分支领先远程 ${aheadCount} 个提交`;
      passed = true; // 领先不算问题
    }

    // 创建 autoFix 函数（如果分支落后）
    const autoFix = isBehind
      ? {
          description: `同步分支 ${targetBranch} 与远程`,
          fix: async () => {
            try {
              execSync(`git pull origin ${targetBranch}`, {
                cwd: context.cwd,
                encoding: 'utf-8',
              });
              return {
                success: true,
                message: `成功同步分支 ${targetBranch}，拉取了 ${behindCount} 个提交`,
              };
            } catch (error) {
              return {
                success: false,
                message: `同步分支失败: ${error instanceof Error ? error.message : String(error)}`,
              };
            }
          },
        }
      : undefined;

    return {
      checkId: 'R-BR-004',
      checkName: '分支同步状态检查',
      ruleId: rule.id,
      passed,
      severity: 'warning',
      message,
      details: {
        targetBranch,
        currentBranch,
        behindCount,
        aheadCount,
        isBehind,
        isAhead,
        isSynced: !isBehind,
      },
      suggestions: isBehind
        ? [`同步分支: git pull origin ${targetBranch}`]
        : undefined,
      autoFixable: isBehind,
      autoFix,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-BR-004',
      checkName: '分支同步状态检查',
      ruleId: rule.id,
      passed: true,
      severity: 'warning',
      message: `无法检查同步状态: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-BR-005: 分支可切换性检查
 * 检查当前是否可以切换到目标分支
 */
export async function checkBranchSwitchable(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;
  const currentBranch = getCurrentBranch(context.cwd);

  if (!targetBranch) {
    return {
      checkId: 'R-BR-005',
      checkName: '分支可切换性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 如果已经在目标分支上，直接通过
  if (currentBranch === targetBranch) {
    return {
      checkId: 'R-BR-005',
      checkName: '分支可切换性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'error',
      message: `已在目标分支上: ${targetBranch}`,
      details: {
        currentBranch,
        targetBranch,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 尝试检查切换是否会成功（不实际切换）
    // 使用 git checkout --dry-run 如果可用，否则检查工作区是否干净
    const statusOutput = execSync('git status --porcelain', {
      cwd: context.cwd,
      encoding: 'utf-8',
    });

    const hasUncommittedChanges = statusOutput.trim().length > 0;

    // 检查目标分支是否存在
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify ${targetBranch}`, {
        cwd: context.cwd,
        encoding: 'utf-8',
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (!branchExists) {
      return {
        checkId: 'R-BR-005',
        checkName: '分支可切换性检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `目标分支不存在: ${targetBranch}`,
        details: {
          currentBranch,
          targetBranch,
          branchExists: false,
        },
        suggestions: [
          `创建分支: git checkout -b ${targetBranch}`,
          `或检出远程分支: git checkout -t origin/${targetBranch}`,
        ],
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 如果有未提交更改，切换可能会失败或被阻止
    const passed = !hasUncommittedChanges;

    return {
      checkId: 'R-BR-005',
      checkName: '分支可切换性检查',
      ruleId: rule.id,
      passed,
      severity: 'error',
      message: passed
        ? `可以切换到分支: ${targetBranch}`
        : '有未提交更改，切换分支可能失败',
      details: {
        currentBranch,
        targetBranch,
        branchExists: true,
        hasUncommittedChanges,
      },
      suggestions: hasUncommittedChanges
        ? [
            '提交更改后切换:',
            '  git commit -m "保存进度" && git checkout ' + targetBranch,
            '或使用储藏:',
            '  git stash && git checkout ' + targetBranch,
          ]
        : [`切换到分支: git checkout ${targetBranch}`],
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-BR-005',
      checkName: '分支可切换性检查',
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
