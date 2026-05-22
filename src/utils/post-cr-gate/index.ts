/**
 * Post-CR Gate
 * 代码审核阶段后质量门禁模块
 *
 * 提供代码审核后质量门禁检查和反馈循环功能。
 *
 * @module post-cr-gate
 */

// Runner exports
export {
  PostCRGateRunner,
  createPostCRGateRunner,
  quickPostCRGateCheck,
  batchPostCRGateCheck,
  generateTestEnvConfig,
  DEFAULT_POST_CR_GATE_RULES,
  DEFAULT_POST_CR_GATE_RUNNER_CONFIG,
} from './runner.js';

export type {
  PostCRGateRuleType,
  PostCRGateRule,
  PostCRGateRuleResult,
  PostCRGateDecision,
  PostCRGateRunResult,
  PostCRGateReport,
  PostCRGateRunnerConfig,
  PostCRGateRuleHandler,
  PostCRGateContext,
  FeedbackLoopItem,
  CodeReviewReport,
  CodeReviewIssue,
  TestEnvConfig,
} from './runner.js';

// Report Checker exports
export {
  CodeReviewReportChecker,
  createCodeReviewReportChecker,
  quickReportCheck,
  DEFAULT_REPORT_CHECKER_CONFIG,
} from './checkers/report-checker.js';

export type {
  ReportCheckResult,
  CodeReviewReportCheckerConfig,
} from './checkers/report-checker.js';

// Test Env Checker exports
export {
  TestEnvConfigChecker,
  createTestEnvConfigChecker,
  quickTestEnvCheck,
  DEFAULT_TEST_ENV_CHECKER_CONFIG,
} from './checkers/test-env-checker.js';

export type {
  TestEnvCheckResult,
  TestEnvCheckerConfig,
} from './checkers/test-env-checker.js';

// Checkpoint Sync Checker exports
export {
  CheckpointSyncChecker,
  createCheckpointSyncChecker,
  quickCheckpointSyncCheck,
  syncCheckpoints,
  DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG,
} from './checkers/checkpoint-sync-checker.js';

export type {
  CheckpointSyncCheckResult,
  CheckpointSyncCheckerConfig,
  SyncIssue,
  SyncIssueType,
} from './checkers/checkpoint-sync-checker.js';

// Quality Score Checker exports
export {
  QualityScoreChecker,
  createQualityScoreChecker,
  quickQualityScoreCheck,
} from './checkers/quality-score-checker.js';

export type {
  QualityScoreCheckResult,
} from './checkers/quality-score-checker.js';
