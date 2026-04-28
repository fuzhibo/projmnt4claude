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
