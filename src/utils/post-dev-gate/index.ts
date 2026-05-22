/**
 * Post-Dev Phase Gate Index
 * 开发阶段后门禁模块索引
 *
 * 职责:
 * - 导出所有开发后门禁相关模块
 * - 提供统一的模块访问入口
 *
 * @module post-dev-phase-gate
 */

// 运行器
export {
  PostDevGateRunner,
  PostDevPhaseRuleRegistry,
  createPostDevGateRunner,
  runPostDevPhaseGate,
  runPostDevPhaseGateWithAutoFix,
  postDevGateRunner,
} from './runner.js';

// 检查器
export * from './checkers/index.js';

// AI 审核检查器导出
export {
  ReportIntegrityAIChecker,
  createReportIntegrityAIChecker,
  checkReportIntegrityAI,
  OutputAlignmentAIChecker,
  createOutputAlignmentAIChecker,
  checkOutputAlignmentAI,
} from './checkers/index.js';

// 重新导出类型
export type {
  PostDevPhaseCheckContext,
  PostDevPhaseGateConfig,
  PostDevPhaseGateResult,
  PostDevPhaseGateReport,
  PostDevPhaseRule,
  PostDevPhaseRuleResult,
  PostDevPhaseCheckItemResult,
  PostDevPhaseCheckResult,
  PostDevPhaseRuleType,
  RuleSeverity,
  PostDevPhaseRuleConfig,
  AutoFixResult,
  AutoFix,
  OutputAlignmentCheckResult,
  PathDrift,
  ReportIntegrityCheckResult,
  IPostDevPhaseChecker,
} from '../../types/post-dev-phase-gate.js';

// 导出默认配置
export {
  DEFAULT_POST_DEV_PHASE_GATE_CONFIG,
  DEFAULT_OUTPUT_ALIGNMENT_RULE,
  DEFAULT_REPORT_INTEGRITY_RULE,
  DEFAULT_ARTIFACT_VALIDATION_RULE,
  DEFAULT_DELIVERABLE_CHECK_RULE,
  DEFAULT_POST_DEV_PHASE_RULES,
  POST_DEV_PHASE_OUTPUT_RULES,
  POST_DEV_PHASE_REPORT_RULES,
  createDefaultPostDevPhaseGateConfig,
} from '../../types/post-dev-phase-gate.js';
