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
  | 'retry_context'      // 重试上下文检查
  | 'path_alignment'      // 路径对齐检查
  | 'test_env_check';    // 测试环境/框架/元数据检查（R-DEV-PRE-006~008）

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
  /** 测试框架探测结果（由 test-framework-checker 写入，供 test-metadata-checker 消费） */
  frameworkDetection?: import('../utils/pre-dev-phase-gate/checkers/test-framework-checker.js').FrameworkDetectionResult;
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
 * 自动修复函数返回结果
 */
export interface AutoFixResult {
  /** 修复是否成功 */
  success: boolean;
  /** 修复结果消息 */
  message: string;
  /** 额外详情 */
  details?: Record<string, unknown>;
}

/**
 * 自动修复配置
 */
export interface AutoFix {
  /** 修复描述 */
  description: string;
  /** 修复函数 */
  fix: () => Promise<AutoFixResult>;
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
  /** 是否可自动修复 */
  autoFixable?: boolean;
  /** 自动修复配置 */
  autoFix?: AutoFix;
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
 * R-DEPOUT-001: 依赖任务输出可用性检查
 */
export const DEFAULT_DEPENDENCY_OUTPUT_RULE: PreDevPhaseRule = {
  id: 'R-DEPOUT-001',
  type: 'dependency_output',
  name: '依赖输出检查',
  description: '检查上游依赖任务的输出是否可用',
  enabled: true,
  severity: 'error',
  config: {
    outputPathPattern: '.projmnt4claude/outputs/{taskId}/',
    requiredOutputs: ['output.json', 'interface.json'],
  },
};

/**
 * 依赖接口规则默认配置
 * R-DEPOUT-002: 依赖接口定义检查
 */
export const DEFAULT_DEPENDENCY_INTERFACE_RULE: PreDevPhaseRule = {
  id: 'R-DEPOUT-002',
  type: 'dependency_output',
  name: '依赖接口定义检查',
  description: '检查依赖任务的接口定义是否完整',
  enabled: true,
  severity: 'error',
  config: {
    interfaceFileName: 'interface.json',
    requiredFields: ['exports', 'version'],
  },
};

/**
 * 循环依赖规则默认配置
 * R-DEPOUT-003: 循环依赖检查
 */
export const DEFAULT_CIRCULAR_DEPENDENCY_RULE: PreDevPhaseRule = {
  id: 'R-DEPOUT-003',
  type: 'dependency_output',
  name: '循环依赖检查',
  description: '检查是否存在循环依赖',
  enabled: true,
  severity: 'error',
};

/**
 * 资源配置规则默认配置
 * R-RES-001: 开发分支配置检查
 */
export const DEFAULT_RESOURCE_CONFIG_RULE: PreDevPhaseRule = {
  id: 'R-RES-001',
  type: 'resource_config',
  name: '开发分支配置检查',
  description: '检查开发分支是否存在且配置正确',
  enabled: true,
  severity: 'error',
  config: {
    allowedPrefixes: ['feature/', 'bugfix/', 'hotfix/', 'task/'],
  },
};

/**
 * 开发目录规则默认配置
 * R-RES-002: 开发目录配置检查
 */
export const DEFAULT_DEV_DIRECTORY_RULE: PreDevPhaseRule = {
  id: 'R-RES-002',
  type: 'resource_config',
  name: '开发目录配置检查',
  description: '检查开发目录是否存在且可写',
  enabled: true,
  severity: 'error',
  config: {
    requiredSubdirs: ['src', '.projmnt4claude/tasks'],
  },
};

/**
 * 环境变量规则默认配置
 * R-RES-003: 环境变量配置检查
 */
export const DEFAULT_ENV_CONFIG_RULE: PreDevPhaseRule = {
  id: 'R-RES-003',
  type: 'resource_config',
  name: '环境变量配置检查',
  description: '检查必需的环境变量是否已配置',
  enabled: true,
  severity: 'error',
  config: {
    requiredEnvVars: ['NODE_ENV'],
    optionalEnvVars: [],
  },
};

/**
 * 磁盘空间规则默认配置
 * R-RES-004: 磁盘空间检查
 */
export const DEFAULT_DISK_SPACE_RULE: PreDevPhaseRule = {
  id: 'R-RES-004',
  type: 'resource_config',
  name: '磁盘空间检查',
  description: '检查可用磁盘空间是否足够',
  enabled: true,
  severity: 'warning',
  config: {
    minFreeSpaceMB: 100,
    minFreeSpacePercent: 10,
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
 * 测试环境检查规则默认配置
 * R-DEV-PRE-006: TestEnvChecker
 */
export const DEFAULT_TEST_ENV_RULE: PreDevPhaseRule = {
  id: 'R-DEV-PRE-006',
  type: 'test_env_check',
  name: '测试环境检查',
  description: '检查项目测试环境配置（.projmnt4claude/test-env）是否就绪',
  enabled: true,
  severity: 'error',
  config: { type: 'testEnv' },
};

/**
 * 测试框架检查规则默认配置
 * R-DEV-PRE-007: TestFrameworkChecker
 */
export const DEFAULT_TEST_FRAMEWORK_RULE: PreDevPhaseRule = {
  id: 'R-DEV-PRE-007',
  type: 'test_env_check',
  name: '测试框架检查',
  description: '检测项目是否安装了测试框架（Jest/pytest/go test 等）',
  enabled: true,
  severity: 'error',
  config: { type: 'testFramework' },
};

/**
 * 测试元数据检查规则默认配置
 * R-DEV-PRE-008: TestMetadataChecker（M6）
 */
export const DEFAULT_TEST_METADATA_RULE: PreDevPhaseRule = {
  id: 'R-DEV-PRE-008',
  type: 'test_env_check',
  name: '测试元数据检查',
  description: '检查 TaskMeta 中测试相关元数据字段是否完整并与框架探测结果一致',
  enabled: true,
  severity: 'error',
  config: { type: 'testMetadata' },
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
 * 路径对齐规则默认配置
 * R-PATH-001: 任务文件路径对齐检查
 */
export const DEFAULT_TASK_FILE_PATH_RULE: PreDevPhaseRule = {
  id: 'R-PATH-001',
  type: 'path_alignment',
  name: '任务文件路径对齐检查',
  description: '检查任务文件是否存放在正确的路径位置',
  enabled: true,
  severity: 'error',
  config: {
    strictMode: true,
    expectedPaths: ['.projmnt4claude/tasks/{taskId}/meta.json', '.projmnt4claude/tasks/{taskId}/contract.json'],
  },
};

/**
 * 代码引用路径规则默认配置
 * R-PATH-002: 代码引用路径正确性检查
 */
export const DEFAULT_CODE_REFERENCE_PATH_RULE: PreDevPhaseRule = {
  id: 'R-PATH-002',
  type: 'path_alignment',
  name: '代码引用路径检查',
  description: '检查代码中的文件引用是否指向有效路径',
  enabled: true,
  severity: 'warning',
  config: {
    checkPatterns: ['src/**/*.{ts,js}'],
    excludePatterns: ['node_modules/**', 'dist/**'],
  },
};

/**
 * 资源引用路径规则默认配置
 * R-PATH-003: 资源引用路径有效性检查
 */
export const DEFAULT_RESOURCE_REFERENCE_PATH_RULE: PreDevPhaseRule = {
  id: 'R-PATH-003',
  type: 'path_alignment',
  name: '资源引用路径检查',
  description: '检查项目资源路径配置是否有效',
  enabled: true,
  severity: 'warning',
  config: {
    requiredPaths: ['.projmnt4claude/tasks', '.projmnt4claude/reports', '.projmnt4claude/outputs'],
  },
};

/**
 * 路径对齐规则数组
 * PRE_DEV_PHASE_PATH_RULES - 路径对齐检查规则
 */
export const PRE_DEV_PHASE_PATH_RULES: PreDevPhaseRule[] = [
  DEFAULT_TASK_FILE_PATH_RULE,
  DEFAULT_CODE_REFERENCE_PATH_RULE,
  DEFAULT_RESOURCE_REFERENCE_PATH_RULE,
];

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
  DEFAULT_DEPENDENCY_INTERFACE_RULE,
  DEFAULT_CIRCULAR_DEPENDENCY_RULE,
  DEFAULT_RESOURCE_CONFIG_RULE,
  DEFAULT_DEV_DIRECTORY_RULE,
  DEFAULT_ENV_CONFIG_RULE,
  DEFAULT_DISK_SPACE_RULE,
  DEFAULT_RETRY_CONTEXT_RULE,
  DEFAULT_TASK_FILE_PATH_RULE,
  DEFAULT_CODE_REFERENCE_PATH_RULE,
  DEFAULT_RESOURCE_REFERENCE_PATH_RULE,
  DEFAULT_TEST_ENV_RULE,
  DEFAULT_TEST_FRAMEWORK_RULE,
  DEFAULT_TEST_METADATA_RULE,
];

// ============================================================================
// 开发前检查器配置类型 (CP-006 类型安全修复)
// ============================================================================

/**
 * 测试环境检查器配置
 */
/**
 * 测试环境检查器规则配置
 * CP-006: 扩展检查器配置以支持类型安全传递
 */
export interface TestEnvRuleConfig extends Partial<import('../utils/pre-dev-phase-gate/checkers/test-env-checker.js').TestEnvCheckerConfig> {
  /** 配置类型标识 */
  type: 'testEnv';
  /** 工作目录路径 */
  cwd?: string;
  /** 测试环境检测指令列表 */
  commands?: import('../utils/pre-dev-phase-gate/checkers/test-env-checker.js').TestEnvCheckCommand[];
}

/**
 * 测试框架检查器规则配置
 * CP-006: 扩展检查器配置以支持类型安全传递
 */
export interface TestFrameworkRuleConfig extends Partial<import('../utils/pre-dev-phase-gate/checkers/test-framework-checker.js').TestFrameworkCheckerConfig> {
  /** 配置类型标识 */
  type: 'testFramework';
  /** 工作目录路径 */
  cwd?: string;
  /** 指定框架名称 */
  framework?: string;
}

/**
 * 测试元数据检查器规则配置
 * CP-006: 扩展检查器配置以支持类型安全传递
 */
export interface TestMetadataRuleConfig extends Partial<import('../utils/pre-dev-phase-gate/checkers/test-metadata-checker.js').TestMetadataCheckerConfig> {
  /** 配置类型标识 */
  type: 'testMetadata';
  /** 元数据字段 */
  metadata?: Record<string, unknown>;
}

/**
 * 开发前检查器配置联合类型
 */
export type DevCheckerRuleConfig =
  | TestEnvRuleConfig
  | TestFrameworkRuleConfig
  | TestMetadataRuleConfig;

/**
 * 类型守卫: 验证是否为测试环境检查器配置
 */
export function isTestEnvRuleConfig(config: unknown): config is TestEnvRuleConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    (config as Record<string, unknown>)['type'] === 'testEnv'
  );
}

/**
 * 类型守卫: 验证是否为测试框架检查器配置
 */
export function isTestFrameworkRuleConfig(config: unknown): config is TestFrameworkRuleConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    (config as Record<string, unknown>)['type'] === 'testFramework'
  );
}

/**
 * 类型守卫: 验证是否为测试元数据检查器配置
 */
export function isTestMetadataRuleConfig(config: unknown): config is TestMetadataRuleConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    (config as Record<string, unknown>)['type'] === 'testMetadata'
  );
}

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
