/**
 * Git Workspace Checker - Git工作区综合检查器
 * 实现 P8 开发阶段前质量门禁的 Git 工作区综合检查
 *
 * 职责:
 * - 整合 Git 工作区检查 (来自 prob8b)
 * - 整合分支状态检查 (来自 prob8c)
 * - 生成统一的 Git 工作区报告
 *
 * 规则覆盖:
 * - R-GIT-001~004: Git工作区相关规则
 * - R-BR-001~005: 分支状态相关规则
 *
 * @module pre-dev-phase-gate/checkers/git-workspace
 */

import type {
  IPreDevPhaseChecker,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckResult,
  PreDevPhaseCheckItemResult,
  PreDevPhaseRule,
  RuleSeverity,
} from '../../../types/pre-dev-phase-gate.js';

// 导入 Git 检查器函数
import {
  checkGitWorkspaceClean,
  checkGitStaged,
  checkGitIgnore,
  checkConflictMarkers,
} from './git-checker.js';

// 导入分支检查器函数
import {
  checkBranchExists,
  checkBranchAssociation,
  checkBranchTracking,
  checkBranchSync,
  checkBranchSwitchable,
} from './branch-checker.js';

/**
 * Git工作区综合报告
 */
export interface GitWorkspaceReport {
  /** 工作区是否干净 */
  isClean: boolean;
  /** 未提交文件数量 */
  uncommittedCount: number;
  /** 当前分支 */
  currentBranch: string;
  /** 目标分支 */
  targetBranch?: string;
  /** 分支是否存在 */
  branchExists: boolean;
  /** 是否有远程追踪 */
  hasRemoteTracking: boolean;
  /** 是否与远程同步 */
  isSynced: boolean;
  /** 落后提交数 */
  behindCount: number;
  /** 领先提交数 */
  aheadCount: number;
  /** 是否可以切换分支 */
  canSwitchBranch: boolean;
  /** 是否有冲突标记 */
  hasConflicts: boolean;
  /** 暂存区状态 */
  stagedStatus: {
    hasStaged: boolean;
    stagedCount: number;
  };
  /** .gitignore 配置状态 */
  gitignoreStatus: {
    configured: boolean;
    missingPatterns: string[];
  };
}

/**
 * Git工作区检查器配置
 */
export interface GitWorkspaceCheckerConfig {
  /** 是否启用 Git 工作区检查 */
  enableGitChecks: boolean;
  /** 是否启用分支状态检查 */
  enableBranchChecks: boolean;
  /** 是否允许未提交更改 */
  allowUncommitted: boolean;
  /** 最大允许未跟踪文件数 */
  maxUntrackedFiles: number;
  /** 是否要求远程同步 */
  requireSync: boolean;
  /** 允许的分支名称 */
  allowedBranches: string[];
}

/**
 * 默认配置
 */
export const DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG: GitWorkspaceCheckerConfig = {
  enableGitChecks: true,
  enableBranchChecks: true,
  allowUncommitted: false,
  maxUntrackedFiles: 10,
  requireSync: true,
  allowedBranches: ['main', 'master', 'develop'],
};

/**
 * GitWorkspaceChecker - Git工作区综合检查器
 *
 * 实现 IPreDevPhaseChecker 接口，整合 Git 和分支检查
 * 为开发阶段前提供完整的 Git 环境验证
 */
export class GitWorkspaceChecker implements IPreDevPhaseChecker {
  readonly id = 'checker-git-workspace';
  readonly name = 'Git工作区检查器';
  readonly description = '综合检查 Git 工作区和分支状态，确保开发环境就绪';

  private config: GitWorkspaceCheckerConfig;

  /**
   * 构造函数
   * @param config - 检查器配置
   */
  constructor(config: Partial<GitWorkspaceCheckerConfig> = {}) {
    this.config = { ...DEFAULT_GIT_WORKSPACE_CHECKER_CONFIG, ...config };
  }

  /**
   * 检查是否适用于当前上下文
   * @param context - 检查上下文
   * @returns 始终返回 true，Git 检查适用于所有上下文
   */
  isApplicable(_context: PreDevPhaseCheckContext): boolean {
    return true;
  }

  /**
   * 执行 Git 工作区综合检查
   * @param context - 检查上下文
   * @returns 检查结果
   */
  async check(context: PreDevPhaseCheckContext): Promise<PreDevPhaseCheckResult> {
    const startTime = Date.now();

    // 创建规则对象用于子检查器
    const gitRule = this.createGitRule();
    const branchRule = this.createBranchRule();

    // 执行所有检查
    const checkResults: PreDevPhaseCheckItemResult[] = [];

    if (this.config.enableGitChecks) {
      // Git 工作区检查
      const gitChecks = await this.runGitChecks(gitRule, context);
      checkResults.push(...gitChecks);
    }

    if (this.config.enableBranchChecks) {
      // 分支状态检查
      const branchChecks = await this.runBranchChecks(branchRule, context);
      checkResults.push(...branchChecks);
    }

    // 生成综合报告
    const report = this.generateReport(checkResults);

    // 确定整体结果
    const { passed, severity, message } = this.determineOverallResult(checkResults);

    return {
      checkerId: this.id,
      checkerName: this.name,
      passed,
      severity,
      message,
      details: {
        report,
        checkResults,
        config: this.config,
      },
      suggestions: this.generateSuggestions(report, checkResults),
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 运行 Git 工作区检查
   * @param rule - Git规则
   * @param context - 检查上下文
   * @returns 检查结果数组
   */
  private async runGitChecks(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult[]> {
    const results: PreDevPhaseCheckItemResult[] = [];

    // R-GIT-001: 工作区干净检查
    const cleanResult = await checkGitWorkspaceClean(rule, context);
    results.push(cleanResult);

    // R-GIT-002: 暂存区为空检查
    const stagedResult = await checkGitStaged(rule, context);
    results.push(stagedResult);

    // R-GIT-003: 忽略文件配置检查
    const ignoreResult = await checkGitIgnore(rule, context);
    results.push(ignoreResult);

    // R-GIT-004: 冲突标记检查
    const conflictResult = await checkConflictMarkers(rule, context);
    results.push(conflictResult);

    return results;
  }

  /**
   * 运行分支状态检查
   * @param rule - 分支规则
   * @param context - 检查上下文
   * @returns 检查结果数组
   */
  private async runBranchChecks(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult[]> {
    const results: PreDevPhaseCheckItemResult[] = [];

    // R-BR-001: 目标分支存在性检查
    const existsResult = await checkBranchExists(rule, context);
    results.push(existsResult);

    // R-BR-002: 分支关联正确性检查
    const associationResult = await checkBranchAssociation(rule, context);
    results.push(associationResult);

    // R-BR-003: 远程分支追踪检查
    const trackingResult = await checkBranchTracking(rule, context);
    results.push(trackingResult);

    // R-BR-004: 分支同步状态检查
    const syncResult = await checkBranchSync(rule, context);
    results.push(syncResult);

    // R-BR-005: 分支可切换性检查
    const switchableResult = await checkBranchSwitchable(rule, context);
    results.push(switchableResult);

    return results;
  }

  /**
   * 创建 Git 规则对象
   */
  private createGitRule(): PreDevPhaseRule {
    return {
      id: 'R-GIT-001',
      type: 'git_workspace',
      name: 'Git工作区检查',
      description: '检查Git工作区是否有未提交更改',
      enabled: true,
      severity: 'warning',
      config: {
        allowUncommitted: this.config.allowUncommitted,
        maxUntrackedFiles: this.config.maxUntrackedFiles,
      },
    };
  }

  /**
   * 创建分支规则对象
   */
  private createBranchRule(): PreDevPhaseRule {
    return {
      id: 'R-BR-001',
      type: 'branch_status',
      name: '分支状态检查',
      description: '检查当前分支状态和远程同步情况',
      enabled: true,
      severity: 'error',
      config: {
        requireSync: this.config.requireSync,
        allowedBranches: this.config.allowedBranches,
      },
    };
  }

  /**
   * 生成综合报告
   * @param results - 检查结果数组
   * @returns Git工作区报告
   */
  private generateReport(results: PreDevPhaseCheckItemResult[]): GitWorkspaceReport {
    // 从结果中提取信息
    const cleanResult = results.find(r => r.checkId === 'R-GIT-001');
    const stagedResult = results.find(r => r.checkId === 'R-GIT-002');
    const ignoreResult = results.find(r => r.checkId === 'R-GIT-003');
    const conflictResult = results.find(r => r.checkId === 'R-GIT-004');

    const existsResult = results.find(r => r.checkId === 'R-BR-001');
    const trackingResult = results.find(r => r.checkId === 'R-BR-003');
    const syncResult = results.find(r => r.checkId === 'R-BR-004');
    const switchableResult = results.find(r => r.checkId === 'R-BR-005');

    // 提取详细信息
    const cleanDetails = cleanResult?.details as {
      hasUncommittedChanges?: boolean;
      uncommittedFileCount?: number;
      currentBranch?: string;
      status?: { staged: string[]; unstaged: string[]; untracked: string[] };
    } | undefined;

    const stagedDetails = stagedResult?.details as {
      totalStaged?: number;
    } | undefined;

    const ignoreDetails = ignoreResult?.details as {
      missingPatterns?: string[];
    } | undefined;

    const syncDetails = syncResult?.details as {
      behindCount?: number;
      aheadCount?: number;
      isBehind?: boolean;
    } | undefined;

    const existsDetails = existsResult?.details as {
      targetBranch?: string;
      exists?: boolean;
    } | undefined;

    const trackingDetails = trackingResult?.details as {
      hasRemoteTracking?: boolean;
    } | undefined;

    const switchableDetails = switchableResult?.details as {
      hasUncommittedChanges?: boolean;
    } | undefined;

    const conflictDetails = conflictResult?.details as {
      totalConflicts?: number;
    } | undefined;

    return {
      isClean: !(cleanDetails?.hasUncommittedChanges ?? false),
      uncommittedCount: cleanDetails?.uncommittedFileCount ?? 0,
      currentBranch: cleanDetails?.currentBranch ?? 'unknown',
      targetBranch: existsDetails?.targetBranch,
      branchExists: existsDetails?.exists ?? false,
      hasRemoteTracking: trackingDetails?.hasRemoteTracking ?? false,
      isSynced: !(syncDetails?.isBehind ?? false),
      behindCount: syncDetails?.behindCount ?? 0,
      aheadCount: syncDetails?.aheadCount ?? 0,
      canSwitchBranch: switchableResult?.passed ?? false,
      hasConflicts: (conflictDetails?.totalConflicts ?? 0) > 0,
      stagedStatus: {
        hasStaged: (stagedDetails?.totalStaged ?? 0) > 0,
        stagedCount: stagedDetails?.totalStaged ?? 0,
      },
      gitignoreStatus: {
        configured: ignoreResult?.passed ?? false,
        missingPatterns: ignoreDetails?.missingPatterns ?? [],
      },
    };
  }

  /**
   * 确定整体检查结果
   * @param results - 检查结果数组
   * @returns 整体结果
   */
  private determineOverallResult(results: PreDevPhaseCheckItemResult[]): {
    passed: boolean;
    severity: RuleSeverity;
    message: string;
  } {
    const failedResults = results.filter(r => !r.passed);
    const errorResults = failedResults.filter(r => r.severity === 'error');
    const warningResults = failedResults.filter(r => r.severity === 'warning');

    if (errorResults.length > 0) {
      return {
        passed: false,
        severity: 'error',
        message: `Git工作区检查失败: ${errorResults.length} 个错误`,
      };
    }

    if (warningResults.length > 0) {
      return {
        passed: true,
        severity: 'warning',
        message: `Git工作区检查通过，但有 ${warningResults.length} 个警告`,
      };
    }

    return {
      passed: true,
      severity: 'info',
      message: 'Git工作区检查通过，环境已就绪',
    };
  }

  /**
   * 生成建议
   * @param report - Git工作区报告
   * @param results - 检查结果数组
   * @returns 建议数组
   */
  private generateSuggestions(
    report: GitWorkspaceReport,
    results: PreDevPhaseCheckItemResult[]
  ): string[] {
    const suggestions: string[] = [];

    // 收集所有失败结果的建议
    for (const result of results) {
      if (!result.passed && result.suggestions) {
        suggestions.push(...result.suggestions);
      }
    }

    // 根据报告状态添加额外建议
    if (!report.isClean) {
      suggestions.push('工作区有未提交更改，建议提交或储藏后再继续');
    }

    if (!report.branchExists && report.targetBranch) {
      suggestions.push(`创建目标分支: git checkout -b ${report.targetBranch}`);
    }

    if (!report.isSynced && report.behindCount > 0) {
      suggestions.push(`同步远程分支: git pull origin ${report.currentBranch}`);
    }

    if (report.hasConflicts) {
      suggestions.push('解决冲突标记后再继续开发');
    }

    // 去重
    return Array.from(new Set(suggestions));
  }
}

/**
 * 创建默认配置的 GitWorkspaceChecker 实例
 * @param config - 可选配置
 * @returns GitWorkspaceChecker 实例
 */
export function createGitWorkspaceChecker(
  config?: Partial<GitWorkspaceCheckerConfig>
): GitWorkspaceChecker {
  return new GitWorkspaceChecker(config);
}

/**
 * 快速检查 Git 工作区
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function quickGitWorkspaceCheck(
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckResult> {
  const checker = new GitWorkspaceChecker();
  return checker.check(context);
}

export default GitWorkspaceChecker;
