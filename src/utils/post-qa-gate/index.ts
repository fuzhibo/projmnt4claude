/**
 * Post-QA Gate
 * QA验证阶段后质量门禁模块
 *
 * 提供QA验证后质量门禁检查和反馈循环功能。
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate
 */

// Runner exports
export {
  PostQAGateRunner,
  createPostQAGateRunner,
  quickPostQAGateCheck,
  batchPostQAGateCheck,
  DEFAULT_POST_QA_GATE_RULES,
  DEFAULT_POST_QA_GATE_RUNNER_CONFIG,
} from './runner.js';

export type {
  PostQAGateRuleType,
  PostQAGateRule,
  PostQAGateRuleResult,
  PostQAGateDecision,
  PostQAGateRunResult,
  PostQAGateReport,
  PostQAGateRunnerConfig,
  PostQAGateRuleHandler,
  PostQAGateContext,
  PostQACheckContext,
  FeedbackLoopItem,
  QAReport,
  QATestFailure,
  PendingHumanVerification,
} from './runner.js';

// Checker exports
export {
  QAReportExistsChecker,
  QAReportJsonChecker,
  QAResultValidChecker,
  QAFailuresDetailChecker,
  QAReportChecker,
  createQAReportChecker,
  quickQAReportCheck,
  DEFAULT_QA_REPORT_CHECKER_CONFIG,
} from './checkers/qa-report-checker.js';

export type {
  QACheckResult,
  QAReportCheckerConfig,
} from './checkers/qa-report-checker.js';

// Coverage checker exports
export {
  TestCoverageChecker,
  createCoverageChecker,
  quickCoverageCheck,
  DEFAULT_COVERAGE_CHECKER_CONFIG,
  DEFAULT_COVERAGE_WEIGHTS,
} from './checkers/coverage-checker.js';

export type {
  CoverageCheckResult,
  CoverageCheckerConfig,
  CoverageWeights,
} from './checkers/coverage-checker.js';
