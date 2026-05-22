/**
 * 类型定义统一导出
 */

// 反馈约束引擎类型
export type {
  ViolationSeverity,
  ValidationViolation,
  ValidationRule,
  OutputType,
  ValidationRuleSet,
  FeedbackTemplate,
  EngineResult,
  FeedbackConstraintEngine,
} from './feedback-constraint.js';

// 需求分解类型
export type {
  DecomposedTaskItem,
  RequirementDecomposition,
  DecomposeOptions,
  ProblemPattern,
  DecompositionStrategy,
} from './decomposition.js';

// 阶段前门禁类型
export type {
  ExecutionPhase,
  PrePhaseGateConfig,
  PhaseGateConfig,
  PhaseGateRule,
  PhaseGateRuleType,
  PhaseGateCheckResult,
  PrePhaseGateResult,
  PrePhaseGateContext,
  PrePhaseGateReport,
  PhaseGateDecision,
  PhaseGateRuleHandler,
  PhaseEntryValidation,
} from './pre-phase-gate.js';

export {
  createDefaultPhaseGateConfig,
  DEFAULT_DEV_PHASE_RULES,
  DEFAULT_CR_PHASE_RULES,
  DEFAULT_QA_PHASE_RULES,
  DEFAULT_EVAL_PHASE_RULES,
} from './pre-phase-gate.js';

// 阶段后门禁类型
export type {
  ExecutionPhase as PostPhaseExecutionPhase,
  PostPhaseGateConfig,
  PostPhaseGateConfigEntry,
  PostPhaseGateRule,
  PostPhaseGateRuleType,
  PostPhaseGateCheckResult,
  PostPhaseGateResult,
  PostPhaseGateContext,
  PostPhaseGateReport,
  PostPhaseGateDecision,
  PostPhaseGateRuleHandler,
  PhaseExitValidation,
  PhaseDeliverable,
} from './post-phase-gate.js';

export {
  createDefaultPostPhaseGateConfig,
  DEFAULT_DEV_POST_PHASE_RULES,
  DEFAULT_CR_POST_PHASE_RULES,
  DEFAULT_QA_POST_PHASE_RULES,
  DEFAULT_EVAL_POST_PHASE_RULES,
} from './post-phase-gate.js';

// 开发阶段后门禁类型
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
} from './post-dev-phase-gate.js';

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
} from './post-dev-phase-gate.js';

// Harness types
export type {
  PhaseCheckpoint,
} from './harness.js';

// Quality Score types
export type {
  QualityScoreDimension,
  DimensionScore,
  CodeReviewQualityScore,
  QualityScoreCheckerConfig,
  QualityScoreCheckResult,
  AIReviewContext,
  AIReviewResponse,
} from './quality-score.js';

export {
  DEFAULT_DIMENSION_WEIGHTS,
  DEFAULT_QUALITY_SCORE_CHECKER_CONFIG,
  calculateWeightedTotalScore,
  isScoreAcceptable,
  createDefaultQualityScore,
} from './quality-score.js';

// Checkpoint Verification types
export type {
  CheckpointOutputCategory,
  VerificationResult,
  VerificationSource,
  VerificationRecord,
  VerificationStrategy,
  VerificationContext,
  VerificationOutput,
} from './checkpoint-verification.js';

// Task types - TestEnvCheckCommand, QAFailureCategory, QAFailureAnalysis, RoutingDecision
export type {
  TestEnvCheckCommand,
  QAFailureCategory,
  QAFailureAnalysis,
  RoutingDecision,
} from './task.js';
