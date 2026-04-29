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

// 分支检查器 - 由 prob8c 任务实现
// export {
//   checkBranchExists,
//   checkBranchAssociation,
//   checkBranchTracking,
//   checkBranchSync,
//   checkBranchSwitchable,
//   type BranchCheckResult,
// } from './branch-checker.js';

// 导出依赖输出检查器
export {
  checkDependencyOutputAvailable,
  checkDependencyInterface,
  checkCircularDependency,
  type DependencyCheckResult,
} from './dependency-checker.js';

// 导出资源配置检查器
export {
  checkDevBranchConfig,
  checkDevDirectoryConfig,
  checkEnvConfig,
  checkDiskSpace,
  type ResourceCheckResult,
} from './resource-checker.js';

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
 * 由 prob8c 任务实现，暂时注释
 */
// export class BranchStatusChecker implements Checker {
//   async check(
//     rule: PreDevPhaseRule,
//     context: PreDevPhaseCheckContext
//   ): Promise<PreDevPhaseCheckItemResult> {
//     // 根据规则ID选择具体检查
//     const { checkBranchExists, checkBranchSync } = await import('./branch-checker.js');
//
//     if (rule.id === 'R-BR-001') {
//       return checkBranchExists(rule, context);
//     }
//
//     return checkBranchSync(rule, context);
//   }
// }

/**
 * 依赖输出检查器
 * CP-PDGC-CHECK-3: 依赖输出检查
 */
export class DependencyOutputChecker implements Checker {
  async check(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    // 根据规则ID路由到具体检查器
    const {
      checkDependencyOutputAvailable,
      checkDependencyInterface,
      checkCircularDependency,
    } = await import('./dependency-checker.js');

    switch (rule.id) {
      case 'R-DEPOUT-001':
        return checkDependencyOutputAvailable(rule, context);
      case 'R-DEPOUT-002':
        return checkDependencyInterface(rule, context);
      case 'R-DEPOUT-003':
        return checkCircularDependency(rule, context);
      default:
        // 默认使用输出可用性检查
        return checkDependencyOutputAvailable(rule, context);
    }
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
    // 根据规则ID路由到具体检查器
    const {
      checkDevBranchConfig,
      checkDevDirectoryConfig,
      checkEnvConfig,
      checkDiskSpace,
    } = await import('./resource-checker.js');

    switch (rule.id) {
      case 'R-RES-001':
        return checkDevBranchConfig(rule, context);
      case 'R-RES-002':
        return checkDevDirectoryConfig(rule, context);
      case 'R-RES-003':
        return checkEnvConfig(rule, context);
      case 'R-RES-004':
        return checkDiskSpace(rule, context);
      default:
        // 默认使用环境变量检查
        return checkEnvConfig(rule, context);
    }
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
