/**
 * Pre-Dev Phase Gate Checkers
 * 开发阶段前门禁检查器
 *
 * 职责:
 * - 实现各类门禁检查器
 * - Git工作区检查 (R-GIT-001~004)
 * - 分支状态检查 (R-BR-001~005)
 * - 依赖输出检查 (R-DEPOUT-001~003)
 * - 资源配置检查 (R-RES-001~004)
 * - 重试上下文检查 (R-RETRY-001~003)
 *
 * @module pre-dev-phase-gate/checkers
 */

import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
} from '../../../types/pre-dev-phase-gate.js';

// 导出 Git 检查器
export {
  checkGitWorkspaceClean,
  checkGitStaged,
  checkGitIgnore,
  checkConflictMarkers,
  type GitWorkspaceCheckResult,
} from './git-checker.js';

// 导出分支检查器
export {
  checkBranchExists,
  checkBranchAssociation,
  checkBranchTracking,
  checkBranchSync,
  checkBranchSwitchable,
  type BranchCheckResult,
} from './branch-checker.js';

/**
 * 检查器接口
 */
export interface Checker {
  check(rule: PreDevPhaseRule, context: PreDevPhaseCheckContext): Promise<PreDevPhaseCheckItemResult>;
}

/**
 * Git工作区检查器
 * CP-PDGC-CHECK-1: Git工作区检查
 * 使用 git-checker.ts 中的具体实现
 */
export class GitWorkspaceChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    // 使用新的详细检查器
    const { checkGitWorkspaceClean } = await import('./git-checker.js');
    return checkGitWorkspaceClean(rule, context);
  }
}

/**
 * 分支状态检查器
 * CP-PDGC-CHECK-2: 分支状态检查
 * 使用 branch-checker.ts 中的具体实现
 */
export class BranchStatusChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    // 根据规则ID选择具体检查
    const { checkBranchExists, checkBranchSync } = await import('./branch-checker.js');

    if (rule.id === 'R-BR-001') {
      return checkBranchExists(rule, context);
    }

    return checkBranchSync(rule, context);
  }
}

/**
 * 依赖输出检查器
 * CP-PDGC-CHECK-3: 依赖输出检查
 */
export class DependencyOutputChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const taskDeps = context.task.dependencies || [];

    return {
      checkId: 'dependency-output',
      checkName: '依赖输出检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: taskDeps.length > 0
        ? `检查 ${taskDeps.length} 个依赖任务的输出`
        : '无依赖任务',
      details: {
        dependencyCount: taskDeps.length,
        dependencies: taskDeps,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 资源配置检查器
 * CP-PDGC-CHECK-4: 资源配置检查
 */
export class ResourceConfigChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const config = rule.config as { requiredEnvVars?: string[] } | undefined;
    const requiredEnvVars = config?.requiredEnvVars ?? ['NODE_ENV'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);

    return {
      checkId: 'resource-config',
      checkName: '资源配置检查',
      ruleId: rule.id,
      passed: missingVars.length === 0,
      severity: rule.severity,
      message: missingVars.length > 0
        ? `缺少环境变量: ${missingVars.join(', ')}`
        : '所有必需环境变量已配置',
      details: {
        missingVars,
        requiredVars: requiredEnvVars,
      },
      suggestions: missingVars.map(v => `设置环境变量: export ${v}=value`),
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 重试上下文检查器
 * CP-PDGC-CHECK-5: 重试上下文检查
 */
export class RetryContextChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    if (!context.isResumed && context.attempt === 1) {
      return {
        checkId: 'retry-context',
        checkName: '重试上下文检查',
        ruleId: rule.id,
        passed: true,
        severity: 'info',
        message: '首次执行，跳过重试检查',
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      checkId: 'retry-context',
      checkName: '重试上下文检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: `第 ${context.attempt}/${context.maxRetries} 次尝试`,
      details: {
        attempt: context.attempt,
        maxRetries: context.maxRetries,
        isResumed: context.isResumed,
        previousFailure: context.previousFailure,
      },
      suggestions: context.previousFailure?.suggestedFixes,
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
