/**
 * Post-Dev Phase Gate Checkers Index
 * 开发阶段后门禁检查器索引
 *
 * 职责:
 * - 导出所有检查器模块
 * - 提供统一的检查器访问入口
 *
 * @module post-dev-phase-gate/checkers
 */

// 输出对齐检查器
export {
  checkOutputAlignment,
  OutputAlignmentChecker,
  outputAlignmentChecker,
  checkPathExists,
  analyzePathDrift,
} from './output-alignment-checker.js';

// 报告完整性检查器
export {
  checkReportIntegrity,
  ReportIntegrityChecker,
  reportIntegrityChecker,
  checkReportExists,
  getReportCompletenessScore,
} from './report-integrity-checker.js';

// 代码变更检查器
export {
  checkCodeChanges,
  CodeChangeChecker,
  codeChangeChecker,
  getChangeStats,
  hasSuspiciousChanges,
  type CodeChangeCheckResult,
  type SuspiciousChange,
} from './code-change-checker.js';

// 测试覆盖检查器
export {
  checkTestCoverage,
  TestCoverageChecker,
  testCoverageChecker,
  getTestCoverageStats,
  getUntestedFiles,
  type TestCoverageCheckResult,
  type TestSourceMapping,
} from './test-coverage-checker.js';

// 文档更新检查器
export {
  checkDocUpdates,
  DocUpdateChecker,
  docUpdateChecker,
  getDocStats,
  needsDocUpdate,
  type DocUpdateCheckResult,
  type OutdatedDocInfo,
  type MissingDocInfo,
} from './doc-update-checker.js';

// 自动修复功能
export {
  tryAutoFixAll,
  PostDevPhaseAutoFix,
  postDevPhaseAutoFix,
  needsAutoFix,
  getFixableCount,
  createFixBackup,
  fixSinglePathDrift,
  createPlaceholderFile,
  type AutoFixCollection,
} from './auto-fix.js';
