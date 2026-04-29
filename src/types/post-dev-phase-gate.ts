/**
 * Post-Dev Phase Gate Types
 * 开发阶段后门禁类型定义
 *
 * 职责:
 * - 定义开发阶段后检查的类型和接口
 * - 在开发阶段完成后进行质量门禁检查
 * - 支持开发输出验证、报告完整性检查、路径对齐检查
 *
 * @module post-dev-phase-gate
 */

import type { TaskMeta } from './task.js';
import type { DevReport } from './harness.js';

/**
 * 开发后检查规则类型
 */
export type PostDevPhaseRuleType =
  | 'output_alignment'     // 开发输出路径对齐检查
  | 'report_integrity'     // 开发报告完整性检查
  | 'artifact_validation'  // 产物验证
  | 'deliverable_check'    // 可交付物检查
  | 'code_change'          // 代码变更检查
  | 'test_coverage'        // 测试覆盖检查
  | 'doc_update';          // 文档更新检查

/**
 * 规则严重级别
 */
export type RuleSeverity = 'error' | 'warning' | 'info';

/**
 * 开发后检查规则
 */
export interface PostDevPhaseRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PostDevPhaseRuleType;
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
  isApplicable?: (context: PostDevPhaseCheckContext) => boolean;
}

/**
 * 开发后检查上下文
 */
export interface PostDevPhaseCheckContext {
  /** 任务ID */
  taskId: string;
  /** 任务元数据 */
  task: TaskMeta;
  /** 工作目录 */
  cwd: string;
  /** 开发报告 */
  devReport?: DevReport;
  /** 期望的输出路径 */
  expectedOutputPaths?: string[];
  /** 实际的输出路径 */
  actualOutputPaths?: string[];
  /** 门禁配置 */
  config: PostDevPhaseGateConfig;
}

/**
 * 开发后门禁配置
 */
export interface PostDevPhaseGateConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 规则配置映射 */
  rules: Map<string, PostDevPhaseRuleConfig>;
  /** 失败时是否停止 */
  stopOnFailure: boolean;
  /** 是否生成详细报告 */
  generateReport: boolean;
  /** 报告输出路径 */
  reportPath?: string;
  /** 是否启用自动修复 */
  enableAutoFix: boolean;
}

/**
 * 单个规则配置
 */
export interface PostDevPhaseRuleConfig {
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
export interface PostDevPhaseCheckItemResult {
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
export interface PostDevPhaseRuleResult {
  /** 规则ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 规则类型 */
  ruleType: PostDevPhaseRuleType;
  /** 是否通过 */
  passed: boolean;
  /** 严重级别 */
  severity: RuleSeverity;
  /** 检查项结果列表 */
  checkResults: PostDevPhaseCheckItemResult[];
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 开发后门禁运行结果
 */
export interface PostDevPhaseGateResult {
  /** 任务ID */
  taskId: string;
  /** 是否通过门禁 */
  passed: boolean;
  /** 检查结果汇总 */
  summary: string;
  /** 规则检查结果列表 */
  ruleResults: PostDevPhaseRuleResult[];
  /** 所有检查项结果 */
  checks: PostDevPhaseCheckItemResult[];
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
  /** 自动修复结果 */
  autoFixResults?: Map<string, AutoFixResult>;
}

/**
 * 开发后门禁报告
 */
export interface PostDevPhaseGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PostDevPhaseGateResult;
  /** 建议 */
  recommendations: string[];
  /** 元数据 */
  metadata: {
    version: string;
    checkerVersion: string;
    rulesExecuted: number;
    autoFixApplied: boolean;
  };
}

/**
 * 输出对齐检查结果
 */
export interface OutputAlignmentCheckResult {
  /** 路径是否对齐 */
  aligned: boolean;
  /** 期望路径列表 */
  expectedPaths: string[];
  /** 实际路径列表 */
  actualPaths: string[];
  /** 缺失的路径 */
  missingPaths: string[];
  /** 意外的路径 */
  unexpectedPaths: string[];
  /** 路径漂移列表 */
  pathDrifts: PathDrift[];
}

/**
 * 路径漂移信息
 */
export interface PathDrift {
  /** 期望路径 */
  expectedPath: string;
  /** 实际找到的路径 */
  actualPath: string;
  /** 漂移类型 */
  driftType: 'moved' | 'renamed' | 'missing';
  /** 是否可以自动修复 */
  autoFixable: boolean;
}

/**
 * 报告完整性检查结果
 */
export interface ReportIntegrityCheckResult {
  /** 报告是否完整 */
  complete: boolean;
  /** 必需的字段 */
  requiredFields: string[];
  /** 缺失的字段 */
  missingFields: string[];
  /** 字段完整性评分 (0-100) */
  completenessScore: number;
  /** 发现的错误 */
  errors: string[];
}

/**
 * 默认开发后门禁配置
 */
export const DEFAULT_POST_DEV_PHASE_GATE_CONFIG: PostDevPhaseGateConfig = {
  enabled: true,
  rules: new Map(),
  stopOnFailure: true,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/post-dev-gate-report.json',
  enableAutoFix: true,
};

/**
 * 输出对齐规则默认配置
 * R-OUTPUT-001: 开发输出路径对齐检查
 */
export const DEFAULT_OUTPUT_ALIGNMENT_RULE: PostDevPhaseRule = {
  id: 'R-OUTPUT-001',
  type: 'output_alignment',
  name: '开发输出路径对齐检查',
  description: '检查开发输出文件路径是否与预期一致',
  enabled: true,
  severity: 'error',
  config: {
    strictMode: true,
    expectedOutputPaths: [
      'src/**/*.{ts,js}',
      'tests/**/*.{test,spec}.{ts,js}',
      '.projmnt4claude/outputs/{taskId}/output.json',
    ],
    allowUnexpectedFiles: false,
  },
};

/**
 * 报告完整性规则默认配置
 * R-OUTPUT-002: 开发报告完整性检查
 */
export const DEFAULT_REPORT_INTEGRITY_RULE: PostDevPhaseRule = {
  id: 'R-OUTPUT-002',
  type: 'report_integrity',
  name: '开发报告完整性检查',
  description: '检查开发报告是否包含所有必需字段',
  enabled: true,
  severity: 'error',
  config: {
    requiredFields: [
      'taskId',
      'status',
      'changes',
      'evidence',
      'checkpointsCompleted',
      'startTime',
      'endTime',
      'duration',
    ],
    minCompletenessScore: 80,
  },
};

/**
 * 产物验证规则默认配置
 * R-OUTPUT-003: 开发产物验证
 */
export const DEFAULT_ARTIFACT_VALIDATION_RULE: PostDevPhaseRule = {
  id: 'R-OUTPUT-003',
  type: 'artifact_validation',
  name: '开发产物验证',
  description: '验证开发产物的完整性和有效性',
  enabled: true,
  severity: 'warning',
  config: {
    validateCodeFiles: true,
    validateTestFiles: true,
    validateDocs: true,
  },
};

/**
 * 可交付物检查规则默认配置
 * R-OUTPUT-004: 开发可交付物检查
 */
export const DEFAULT_DELIVERABLE_CHECK_RULE: PostDevPhaseRule = {
  id: 'R-OUTPUT-004',
  type: 'deliverable_check',
  name: '开发可交付物检查',
  description: '检查所有必需的可交付物是否就绪',
  enabled: true,
  severity: 'error',
  config: {
    requiredDeliverables: ['code', 'tests', 'docs'],
  },
};

/**
 * 代码变更检查规则默认配置
 * R-CHANGE-001: 代码变更合理性检查
 */
export const DEFAULT_CODE_CHANGE_RULE: PostDevPhaseRule = {
  id: 'R-CHANGE-001',
  type: 'code_change',
  name: '代码变更检查',
  description: '检查代码变更的合理性和预期性',
  enabled: true,
  severity: 'warning',
  config: {
    maxFilesChanged: 50,
    minReasonablenessScore: 60,
    allowConfigChanges: false,
    allowTestDeletion: false,
    suspiciousPatterns: [
      'todo',
      'fixme',
      'hack',
      'workaround',
      'console.log',
      'debugger',
    ],
    criticalFiles: [
      'package-lock.json',
      'yarn.lock',
      '.gitignore',
      'LICENSE',
    ],
  },
};

/**
 * 测试覆盖检查规则默认配置
 * R-COVERAGE-001: 测试覆盖率检查
 */
export const DEFAULT_TEST_COVERAGE_RULE: PostDevPhaseRule = {
  id: 'R-COVERAGE-001',
  type: 'test_coverage',
  name: '测试覆盖检查',
  description: '检查测试覆盖率是否达标',
  enabled: true,
  severity: 'warning',
  config: {
    minLineCoverage: 60,
    minBranchCoverage: 50,
    minFunctionCoverage: 60,
    minOverallScore: 60,
    requireCoverageReport: false,
    sourcePatterns: ['src/**/*.ts'],
    testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
  },
};

/**
 * 文档更新检查规则默认配置
 * R-DOC-001: 文档更新检查
 */
export const DEFAULT_DOC_UPDATE_RULE: PostDevPhaseRule = {
  id: 'R-DOC-001',
  type: 'doc_update',
  name: '文档更新检查',
  description: '检查文档是否与代码实现同步',
  enabled: true,
  severity: 'warning',
  config: {
    minConsistencyScore: 60,
    requireReadme: false,
    requireChangelog: false,
    requireApiDocs: false,
    docPatterns: ['docs/**/*.md', '**/*.md'],
    codeDocPatterns: ['src/**/*.ts'],
    maxDocAgeDays: 30,
  },
};

/**
 * 默认规则列表
 */
export const DEFAULT_POST_DEV_PHASE_RULES: PostDevPhaseRule[] = [
  DEFAULT_OUTPUT_ALIGNMENT_RULE,
  DEFAULT_REPORT_INTEGRITY_RULE,
  DEFAULT_ARTIFACT_VALIDATION_RULE,
  DEFAULT_DELIVERABLE_CHECK_RULE,
  DEFAULT_CODE_CHANGE_RULE,
  DEFAULT_TEST_COVERAGE_RULE,
  DEFAULT_DOC_UPDATE_RULE,
];

// ============================================================================
// 检查器接口和结果类型 (QA验证要求)
// ============================================================================

/**
 * 检查器接口
 * IPostDevPhaseChecker - 定义开发后阶段检查器的标准接口
 */
export interface IPostDevPhaseChecker {
  /** 检查器ID */
  readonly id: string;
  /** 检查器名称 */
  readonly name: string;
  /** 检查器描述 */
  readonly description: string;
  /** 执行检查 */
  check(context: PostDevPhaseCheckContext): Promise<PostDevPhaseCheckResult>;
  /** 检查是否适用于当前上下文 */
  isApplicable?(context: PostDevPhaseCheckContext): boolean;
}

/**
 * 检查结果类型
 * PostDevPhaseCheckResult - 统一的结果返回格式
 */
export interface PostDevPhaseCheckResult {
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

/**
 * 规则处理器函数类型
 */
export type PostDevPhaseRuleHandler = (
  context: PostDevPhaseCheckContext,
  rule: PostDevPhaseRule
) => Promise<PostDevPhaseRuleResult>;

// ============================================================================
// 规则常量数组
// ============================================================================

/**
 * 输出对齐规则数组
 * POST_DEV_PHASE_OUTPUT_RULES - 输出对齐检查规则
 */
export const POST_DEV_PHASE_OUTPUT_RULES: PostDevPhaseRule[] = [
  DEFAULT_OUTPUT_ALIGNMENT_RULE,
];

/**
 * 报告完整性规则数组
 * POST_DEV_PHASE_REPORT_RULES - 报告完整性检查规则
 */
export const POST_DEV_PHASE_REPORT_RULES: PostDevPhaseRule[] = [
  DEFAULT_REPORT_INTEGRITY_RULE,
];

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建默认开发后门禁配置
 * createDefaultPostDevPhaseGateConfig - 工厂函数创建默认配置
 */
export function createDefaultPostDevPhaseGateConfig(): PostDevPhaseGateConfig {
  return {
    enabled: true,
    rules: new Map(),
    stopOnFailure: true,
    generateReport: true,
    reportPath: '.projmnt4claude/reports/post-dev-gate-report.json',
    enableAutoFix: true,
  };
}
