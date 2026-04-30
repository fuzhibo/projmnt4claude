/**
 * Pre-CR Gate
 * 代码审核前门禁模块
 *
 * 提供代码审核前置条件检查和门禁决策功能。
 *
 * @module pre-cr-gate
 */

// Runner exports
export {
  PreCRGateRunner,
  createPreCRGateRunner,
  quickPreCRGateCheck,
  batchPreCRGateCheck,
  DEFAULT_PRE_CR_GATE_RULES,
  DEFAULT_PRE_CR_GATE_RUNNER_CONFIG,
} from './runner.js';

export type {
  PreCRGateRuleType,
  PreCRGateRule,
  PreCRGateRuleResult,
  PreCRGateDecision,
  PreCRGateRunResult,
  PreCRGateReport,
  PreCRGateRunnerConfig,
  PreCRGateRuleHandler,
  PreCRGateContext,
} from './runner.js';

// PrerequisitesChecker exports
export {
  PrerequisitesChecker,
  createPrerequisitesChecker,
  quickPrerequisitesCheck,
  batchPrerequisitesCheck,
  validateCheckpointForReview,
  formatPrerequisitesResult,
  DEFAULT_PREREQUISITES_CHECKER_CONFIG,
} from './checkers/prerequisites-checker.js';

export type {
  PrerequisiteCheckResult,
  PrerequisitesCheckResult,
  PrerequisitesCheckerConfig,
} from './checkers/prerequisites-checker.js';

// DevCompleteChecker exports
export {
  DevCompleteChecker,
  createDevCompleteChecker,
  quickDevCompleteCheck,
  batchDevCompleteCheck,
  formatDevCompleteResult,
  DEFAULT_DEV_COMPLETE_CHECKER_CONFIG,
} from './checkers/dev-complete-checker.js';

export type {
  DevCompleteCheckResult,
  DevCompleteCheckerResult,
  DevCompleteCheckerConfig,
} from './checkers/dev-complete-checker.js';

// ReportValidityChecker exports
export {
  ReportValidityChecker,
  createReportValidityChecker,
  quickReportValidityCheck,
  batchReportValidityCheck,
  formatReportValidityResult,
  DEFAULT_REPORT_VALIDITY_CHECKER_CONFIG,
  DEFAULT_REPORT_TYPES,
} from './checkers/report-validity-checker.js';

export type {
  ReportValidityCheckResult,
  ReportValidityCheckerResult,
  ReportValidityCheckerConfig,
  ReportType,
  ReportInfo,
} from './checkers/report-validity-checker.js';

// CheckpointSyncChecker exports
export {
  CheckpointSyncChecker,
  createCheckpointSyncChecker,
  quickCheckpointSyncCheck,
  batchCheckpointSyncCheck,
  formatCheckpointSyncResult,
  DEFAULT_CHECKPOINT_SYNC_CHECKER_CONFIG,
} from './checkers/checkpoint-sync-checker.js';

export type {
  CheckpointSyncCheckResult,
  CheckpointSyncCheckerResult,
  CheckpointSyncCheckerConfig,
  SyncIssue,
} from './checkers/checkpoint-sync-checker.js';

// CodeReadyChecker exports
export {
  CodeReadyChecker,
  createCodeReadyChecker,
  quickCodeReadyCheck,
  batchCodeReadyCheck,
  formatCodeReadyResult,
  DEFAULT_CODE_READY_CHECKER_CONFIG,
} from './checkers/code-ready-checker.js';

export type {
  CodeReadyCheckResult,
  CodeReadyCheckerResult,
  CodeReadyCheckerConfig,
} from './checkers/code-ready-checker.js';
