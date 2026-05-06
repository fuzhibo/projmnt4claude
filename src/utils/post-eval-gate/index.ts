/**
 * Post-Eval Gate
 * 评估阶段后门禁模块
 *
 * 提供评估后置条件检查和门禁决策功能。
 * 对齐设计文档: docs/investigation/hd-p15-evaluation-post-gate-design.md
 *
 * @module post-eval-gate
 */

// Runner exports
export {
  PostEvalGateRunner,
  createPostEvalGateRunner,
  quickPostEvalGateCheck,
  batchPostEvalGateCheck,
  DEFAULT_POST_EVAL_GATE_RUNNER_CONFIG,
} from './runner.js';

// Checker exports
export { EvalReportExistsChecker } from './checkers/eval-report-existence-checker.js';
export { EvalLogsChecker } from './checkers/eval-logs-checker.js';
export { EvalReportJsonChecker, EvalResultValidChecker } from './checkers/eval-result-checker.js';
export { AllCheckpointsFinalChecker } from './checkers/checkpoints-final-checker.js';
export { FinalStateConsistencyChecker } from './checkers/state-consistency-checker.js';
export { TaskClosableChecker } from './checkers/task-closable-checker.js';

// Type exports
export type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  PostEvalSeverity,
  PostEvalGateDecision,
  PostEvalGateRunResult,
  PostEvalGateReport,
  PostEvalGateRunnerConfig,
  IPostEvalChecker,
  EvalReport,
  DevReport,
  CodeReviewReport,
  QAReport,
} from './types.js';
