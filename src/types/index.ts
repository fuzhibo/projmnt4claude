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
