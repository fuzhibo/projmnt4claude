/**
 * Pre-QA Gate
 * QA验证阶段前门禁模块
 *
 * 提供QA验证前置条件检查和门禁决策功能。
 *
 * @module pre-qa-gate
 */

// Runner exports
export {
  PreQAGateRunner,
  createPreQAGateRunner,
  quickPreQAGateCheck,
  batchPreQAGateCheck,
  DEFAULT_PRE_QA_GATE_RULES,
  DEFAULT_PRE_QA_GATE_RUNNER_CONFIG,
} from './runner.js';

export type {
  PreQAGateRuleType,
  PreQAGateRule,
  PreQAGateRuleResult,
  PreQAGateDecision,
  PreQAGateRunResult,
  PreQAGateReport,
  PreQAGateRunnerConfig,
  PreQAGateRuleHandler,
  PreQAGateContext,
} from './runner.js';

// CodeReviewPassChecker exports
export {
  CodeReviewPassChecker,
  createCodeReviewPassChecker,
  quickCodeReviewPassCheck,
  batchCodeReviewPassCheck,
  formatCodeReviewPassResult,
  DEFAULT_CODE_REVIEW_PASS_CHECKER_CONFIG,
} from './checkers/code-review-pass-checker.js';

export type {
  CodeReviewPassCheckResult,
  CodeReviewPassCheckerResult,
  CodeReviewPassCheckerConfig,
} from './checkers/code-review-pass-checker.js';

// QACheckpointsChecker exports
export {
  QACheckpointsChecker,
  createQACheckpointsChecker,
  quickQACheckpointsCheck,
  batchQACheckpointsCheck,
  formatQACheckpointsResult,
  DEFAULT_QA_CHECKPOINTS_CHECKER_CONFIG,
} from './checkers/qa-checkpoints-checker.js';

export type {
  QACheckpointCheckResult,
  QACheckpointsCheckerResult,
  QACheckpointsCheckerConfig,
} from './checkers/qa-checkpoints-checker.js';

// TestConfigChecker exports
export {
  TestConfigChecker,
  createTestConfigChecker,
  quickTestConfigCheck,
  batchTestConfigCheck,
  formatTestConfigResult,
  DEFAULT_TEST_CONFIG_CHECKER_CONFIG,
} from './checkers/test-config-checker.js';

export type {
  TestConfigCheckResult,
  TestConfigCheckerResult,
  TestConfigCheckerConfig,
} from './checkers/test-config-checker.js';
