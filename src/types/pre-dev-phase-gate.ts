/**
 * Pre-Dev Phase Gate Types
 * 开发阶段前门禁类型定义
 *
 * 职责:
 * - 定义开发阶段前检查的类型和接口
 * - 在进入开发阶段前进行质量门禁检查
 * - 支持 Git工作区检查、依赖输出检查、资源配置检查
 *
 * @module pre-dev-phase-gate
 */

import type { TaskMeta } from './task.js';

/**
 * 开发前检查规则类型
 */
export type PreDevPhaseRuleType =
  | 'git_workspace'      // Git工作区检查
  | 'branch_status'      // 分支状态检查
  | 'dependency_output'  // 依赖输出检查
  | 'resource_config'    // 资源配置检查
  | 'retry_context';     // 重试上下文检查

/**
 * 规则严重级别
 */
export type RuleSeverity = 'error' | 'warning' | 'info';

/**
 * 开发前检查规则
 */
export interface PreDevPhaseRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PreDevPhaseRuleType;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 严重级别 */
  severity: RuleSeverity;
  /** 规则配置参数 */
  config?: Record<string, unknown>;
  /**
   * 检查规则是否适用于给定上下文
   * @param context - 检查上下文
   * @returns 是否适用
   */
  isApplicable?: (context: PreDevPhaseCheckContext) => boolean;
}

/**
 * 重试上下文 - 用于在重试时传递前次失败信息
 */
export interface RetryContext {
  /** 失败阶段 */
  phase: string;
  /** 失败原因 */
  reason: string;
  /** 失败尝试次数 */
  attempt: number;
  /** 错误详情 */
  error?: string;
  /** 建议修复 */
  suggestedFixes?: string[];
}

/**
 * 开发前检查上下文
 */
export interface PreDevPhaseCheckContext {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** 工作目录 */
  cwd: string;
  /** 当前尝试次数 */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否是从恢复状态 */
  isResumed: boolean;
  /** 前次失败信息（重试时） */
  previousFailure?: RetryContext;
  /** 门禁配置 */
  config: PreDevPhaseGateConfig;
}

/**
 * 开发前门禁配置
 */
export interface PreDevPhaseGateConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 规则配置映射 */
  rules: Map<string, PreDevPhaseRuleConfig>;
  /** 是否启用重试特定规则 */
  enableRetryRules: boolean;
  /** 失败时是否停止 */
  stopOnFailure: boolean;
  /** 是否生成详细报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
}

/**
 * 单个规则配置
 */
export interface PreDevPhaseRuleConfig {
  /** 规则ID */
  ruleId: string;
  /** 是否启用 */
  enabled: boolean;
  /** 严重级别覆盖 */
  severity?: RuleSeverity;
  /** 规则特定配置 */
  config?: Record<string, unknown>;
}

/**
 * 单个检查结果
 */
export interface PreDevPhaseCheckItemResult {
  /** 检查项ID */
  checkId: string;
  /** 检查项名称 */
  checkName: string;
  /** 所属规则ID */
  ruleId: string;
  /** 是否通过 */
  passed: boolean;
  /** 严重级别 */
  severity: RuleSeverity;
  /** 检查消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 建议修复 */
  suggestions?: string[];
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 规则检查结果
 */
export interface PreDevPhaseRuleResult {
  /** 规则ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 规则类型 */
  ruleType: PreDevPhaseRuleType;
  /** 是否通过 */
  passed: boolean;
  /** 严重级别 */
  severity: RuleSeverity;
  /** 检查项结果列表 */
  checkResults: PreDevPhaseCheckItemResult[];
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 开发前门禁运行结果
 */
export interface PreDevPhaseGateResult {
  /** 任务ID */
  taskId: string;
  /** 是否通过门禁 */
  passed: boolean;
  /** 检查结果汇总 */
  summary: string;
  /** 规则检查结果列表 */
  ruleResults: PreDevPhaseRuleResult[];
  /** 所有检查项结果 */
  checks: PreDevPhaseCheckItemResult[];
  /** 通过规则数 */
  passedCount: number;
  /** 失败规则数 */
  failedCount: number;
  /** 警告数 */
  warningCount: number;
  /** 阻塞失败数 */
  blockingFailures: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
  /** 建议 */
  recommendations: string[];
}

/**
 * 开发前门禁报告
 */
export interface PreDevPhaseGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PreDevPhaseGateResult;
  /** 建议 */
  recommendations: string[];
  /** 元数据 */
  metadata: {
    version: string;
    checkerVersion: string;
    rulesExecuted: number;
    attempt: number;
    isResumed: boolean;
  };
}

/**
 * 规则处理器函数类型
 */
export type PreDevPhaseRuleHandler = (
  context: PreDevPhaseCheckContext,
  rule: PreDevPhaseRule
) => Promise<PreDevPhaseRuleResult>;

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
 * 依赖输出检查结果
 */
export interface DependencyOutputCheckResult {
  /** 依赖任务ID */
  dependencyTaskId: string;
  /** 依赖任务状态 */
  dependencyStatus: string;
  /** 输出是否可用 */
  outputsAvailable: boolean;
  /** 输出路径列表 */
  outputPaths: string[];
  /** 接口定义是否可用 */
  interfacesAvailable: boolean;
  /** 缺失的输出 */
  missingOutputs: string[];
}

/**
 * 资源配置检查结果
 */
export interface ResourceConfigCheckResult {
  /** 开发分支配置 */
  devBranch: {
    exists: boolean;
    name: string;
    valid: boolean;
  };
  /** 开发目录配置 */
  devDirectory: {
    exists: boolean;
    path: string;
    writable: boolean;
  };
  /** 环境配置 */
  envConfig: {
    valid: boolean;
    missingVars: string[];
  };
}

/**
 * 默认开发前门禁配置
 */
export const DEFAULT_PRE_DEV_PHASE_GATE_CONFIG: PreDevPhaseGateConfig = {
  enabled: true,
  rules: new Map(),
  enableRetryRules: true,
  stopOnFailure: true,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/pre-dev-gate-report.json',
};

/**
 * Git工作区规则默认配置
 */
export const DEFAULT_GIT_WORKSPACE_RULE: PreDevPhaseRule = {
  id: 'R-GIT-001',
  type: 'git_workspace',
  name: 'Git工作区检查',
  description: '检查Git工作区是否有未提交更改',
  enabled: true,
  severity: 'warning',
  config: {
    allowUncommitted: false,
    maxUntrackedFiles: 10,
  },
};

/**
 * 分支状态规则默认配置
 */
export const DEFAULT_BRANCH_STATUS_RULE: PreDevPhaseRule = {
  id: 'R-BR-001',
  type: 'branch_status',
  name: '分支状态检查',
  description: '检查当前分支状态和远程同步情况',
  enabled: true,
  severity: 'error',
  config: {
    requireSync: true,
    allowedBranches: ['main', 'master', 'develop'],
  },
};

/**
 * 依赖输出规则默认配置
 */
export const DEFAULT_DEPENDENCY_OUTPUT_RULE: PreDevPhaseRule = {
  id: 'R-DEPOUT-001',
  type: 'dependency_output',
  name: '依赖输出检查',
  description: '检查上游依赖任务的输出是否可用',
  enabled: true,
  severity: 'error',
};

/**
 * 资源配置规则默认配置
 */
export const DEFAULT_RESOURCE_CONFIG_RULE: PreDevPhaseRule = {
  id: 'R-RES-001',
  type: 'resource_config',
  name: '资源配置检查',
  description: '检查开发所需资源是否配置正确',
  enabled: true,
  severity: 'error',
  config: {
    requiredEnvVars: ['NODE_ENV'],
  },
};

/**
 * 重试上下文规则默认配置
 */
export const DEFAULT_RETRY_CONTEXT_RULE: PreDevPhaseRule = {
  id: 'R-RETRY-001',
  type: 'retry_context',
  name: '重试上下文检查',
  description: '检查重试上下文并应用特定规则',
  enabled: true,
  severity: 'info',
  isApplicable: (context: PreDevPhaseCheckContext) => context.isResumed || context.attempt > 1,
};

/**
 * Git暂存区规则默认配置
 * R-GIT-002: 暂存区为空检查
 */
export const DEFAULT_GIT_STAGED_RULE: PreDevPhaseRule = {
  id: 'R-GIT-002',
  type: 'git_workspace',
  name: '暂存区为空检查',
  description: '检查暂存区是否有未提交的更改',
  enabled: true,
  severity: 'info',
};

/**
 * Git忽略文件规则默认配置
 * R-GIT-003: 忽略文件配置检查
 */
export const DEFAULT_GIT_IGNORE_RULE: PreDevPhaseRule = {
  id: 'R-GIT-003',
  type: 'git_workspace',
  name: '忽略文件配置检查',
  description: '检查.gitignore是否正确配置',
  enabled: true,
  severity: 'warning',
};

/**
 * 冲突标记规则默认配置
 * R-GIT-004: 冲突标记检查
 */
export const DEFAULT_CONFLICT_MARKER_RULE: PreDevPhaseRule = {
  id: 'R-GIT-004',
  type: 'git_workspace',
  name: '冲突标记检查',
  description: '检查工作区文件是否包含冲突标记',
  enabled: true,
  severity: 'error',
};

/**
 * 分支关联规则默认配置
 * R-BR-002: 分支关联正确性检查
 */
export const DEFAULT_BRANCH_ASSOCIATION_RULE: PreDevPhaseRule = {
  id: 'R-BR-002',
  type: 'branch_status',
  name: '分支关联正确性检查',
  description: '检查分支名称是否符合约定',
  enabled: true,
  severity: 'warning',
};

/**
 * 分支追踪规则默认配置
 * R-BR-003: 远程分支追踪检查
 */
export const DEFAULT_BRANCH_TRACKING_RULE: PreDevPhaseRule = {
  id: 'R-BR-003',
  type: 'branch_status',
  name: '远程分支追踪检查',
  description: '检查分支是否有远程追踪配置',
  enabled: true,
  severity: 'warning',
};

/**
 * 分支同步规则默认配置
 * R-BR-004: 分支同步状态检查
 */
export const DEFAULT_BRANCH_SYNC_RULE: PreDevPhaseRule = {
  id: 'R-BR-004',
  type: 'branch_status',
  name: '分支同步状态检查',
  description: '检查本地分支是否与远程同步',
  enabled: true,
  severity: 'warning',
};

/**
 * 分支可切换规则默认配置
 * R-BR-005: 分支可切换性检查
 */
export const DEFAULT_BRANCH_SWITCHABLE_RULE: PreDevPhaseRule = {
  id: 'R-BR-005',
  type: 'branch_status',
  name: '分支可切换性检查',
  description: '检查当前是否可以切换到目标分支',
  enabled: true,
  severity: 'error',
};

/**
 * 默认规则列表
 */
export const DEFAULT_PRE_DEV_PHASE_RULES: PreDevPhaseRule[] = [
  DEFAULT_GIT_WORKSPACE_RULE,
  DEFAULT_GIT_STAGED_RULE,
  DEFAULT_GIT_IGNORE_RULE,
  DEFAULT_CONFLICT_MARKER_RULE,
  DEFAULT_BRANCH_STATUS_RULE,
  DEFAULT_BRANCH_ASSOCIATION_RULE,
  DEFAULT_BRANCH_TRACKING_RULE,
  DEFAULT_BRANCH_SYNC_RULE,
  DEFAULT_BRANCH_SWITCHABLE_RULE,
  DEFAULT_DEPENDENCY_OUTPUT_RULE,
  DEFAULT_RESOURCE_CONFIG_RULE,
  DEFAULT_RETRY_CONTEXT_RULE,
];

// ============================================================================
// 检查器接口和结果类型 (QA验证要求)
// ============================================================================

/**
 * 检查器接口
 * IPreDevPhaseChecker - 定义开发前阶段检查器的标准接口
 */
export interface IPreDevPhaseChecker {
  /** 检查器ID */
  readonly id: string;
  /** 检查器名称 */
  readonly name: string;
  /** 检查器描述 */
  readonly description: string;
  /** 执行检查 */
  check(context: PreDevPhaseCheckContext): Promise<PreDevPhaseCheckResult>;
  /** 检查是否适用于当前上下文 */
  isApplicable?(context: PreDevPhaseCheckContext): boolean;
}

/**
 * 检查结果类型
 * PreDevPhaseCheckResult - 统一的结果返回格式
 */
export interface PreDevPhaseCheckResult {
  /** 检查器ID */
  checkerId: string;
  /** 检查器名称 */
  checkerName: string;
  /** 是否通过 */
  passed: boolean;
  /** 严重级别 */
  severity: RuleSeverity;
  /** 检查消息 */
  message: string;
  /** 详细数据 */
  details?: Record<string, unknown>;
  /** 建议修复 */
  suggestions?: string[];
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

// ============================================================================
// 规则常量数组 (5类规则)
// ============================================================================

/**
 * Git工作区规则数组
 * PRE_DEV_PHASE_GIT_RULES - Git相关检查规则
 */
export const PRE_DEV_PHASE_GIT_RULES: PreDevPhaseRule[] = [
  DEFAULT_GIT_WORKSPACE_RULE,
  DEFAULT_BRANCH_STATUS_RULE,
];

/**
 * 分支状态规则数组
 * PRE_DEV_PHASE_BRANCH_RULES - 分支状态检查规则
 */
export const PRE_DEV_PHASE_BRANCH_RULES: PreDevPhaseRule[] = [
  DEFAULT_BRANCH_STATUS_RULE,
];

/**
 * 依赖输出规则数组
 * PRE_DEV_PHASE_DEPENDENCY_RULES - 依赖输出检查规则
 */
export const PRE_DEV_PHASE_DEPENDENCY_RULES: PreDevPhaseRule[] = [
  DEFAULT_DEPENDENCY_OUTPUT_RULE,
];

/**
 * 资源配置规则数组
 * PRE_DEV_PHASE_RESOURCE_RULES - 资源配置检查规则
 */
export const PRE_DEV_PHASE_RESOURCE_RULES: PreDevPhaseRule[] = [
  DEFAULT_RESOURCE_CONFIG_RULE,
];

/**
 * 重试上下文规则数组
 * PRE_DEV_PHASE_RETRY_RULES - 重试上下文检查规则
 */
export const PRE_DEV_PHASE_RETRY_RULES: PreDevPhaseRule[] = [
  DEFAULT_RETRY_CONTEXT_RULE,
];

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建默认开发前门禁配置
 * createDefaultPreDevPhaseGateConfig - 工厂函数创建默认配置
 */
export function createDefaultPreDevPhaseGateConfig(): PreDevPhaseGateConfig {
  return {
    enabled: true,
    rules: new Map(),
    enableRetryRules: true,
    stopOnFailure: true,
    generateReport: true,
    reportPath: '.projmnt4claude/reports/pre-dev-gate-report.json',
  };
}
