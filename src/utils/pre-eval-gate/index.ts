/**
 * Pre-Eval Gate
 * 评估阶段前门禁模块
 *
 * 提供评估前置条件检查和门禁决策功能。
 * 对齐设计文档: docs/investigation/hd-p14-evaluation-pre-gate-design.md
 *
 * @module pre-eval-gate
 */

// Runner exports
export {
  PreEvalGateRunner,
  createPreEvalGateRunner,
  quickPreEvalGateCheck,
  batchPreEvalGateCheck,
  DEFAULT_PRE_EVAL_GATE_RUNNER_CONFIG,
} from './runner.js';

// Checker exports
export { QAPassChecker } from './qa-pass-checker.js';
export { QAReportExistenceChecker } from './checkers/qa-report-existence-checker.js';
export { DevReportChecker } from './checkers/dev-report-checker.js';
export { CodeReviewReportChecker } from './checkers/code-review-report-checker.js';
export { AllCheckpointsCompletedChecker } from './checkers/all-checkpoints-completed-checker.js';
export { PhaseHistoryCompleteChecker } from './checkers/phase-history-checker.js';

// Type exports
export type {
  PreEvalCheckContext,
  PreEvalCheckResult,
  PreEvalSeverity,
  PreEvalGateDecision,
  PreEvalGateRunResult,
  PreEvalGateReport,
  PreEvalGateRunnerConfig,
  IPreEvalChecker,
  QAReport,
} from './types.js';
