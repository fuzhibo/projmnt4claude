/**
 * Post-QA Gate
 * QA验证阶段后质量门禁模块
 *
 * 提供QA验证后质量门禁检查和反馈循环功能。
 *
 * 【注意】PostQAGateRunner 已迁移到统一门禁框架。
 * 新的 QA Post-Gate 规则集合: src/utils/gate-rules/qa-post-gate-rules.ts
 *
 * 当前保留的 checker 导出（供统一框架规则内部使用）:
 * - QAReportChecker: QA报告检查器
 * - TestCoverageChecker: 测试覆盖率检查器
 * - QACheckpointSyncChecker: 检查点状态同步检查器
 * - HumanVerificationPendingCollector: 人工验证状态收集器
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate
 */

// CP-4: Re-export QAFailureCategory from task.ts for convenience
export type { QAFailureCategory } from '../../types/task.js';

// Checker exports
export {
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

// Checkpoint sync checker exports
export {
  QACheckpointSyncChecker,
  createCheckpointSyncChecker,
  quickCheckpointSyncCheck,
  DEFAULT_CHECKPOINT_SYNC_CONFIG,
} from './checkers/checkpoint-sync-checker.js';

export type {
  CheckpointSyncCheckResult,
  CheckpointSyncCheckerConfig,
  MismatchedCheckpoint,
} from './checkers/checkpoint-sync-checker.js';

// Human verification collector exports
export {
  HumanVerificationPendingCollector,
  PipelineExitHumanVerificationNotifier,
  DEFAULT_HUMAN_VERIFICATION_CONFIG,
} from './checkers/human-verification-collector.js';

export type {
  HumanVerificationCheckResult,
  HumanVerificationCollectorConfig,
} from './checkers/human-verification-collector.js';
