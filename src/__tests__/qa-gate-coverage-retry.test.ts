/**
 * QA Gate Coverage Retry Tests
 * 测试 QA 门禁覆盖率重试机制
 *
 * CP-5: 测试覆盖率缺口数据提取和 QA 重试 prompt 生成
 * CP-6: 测试 classifyQAFailureCategory 返回 'coverage_retry'
 */
import { describe, it, expect } from 'bun:test';
import { PostQAGateRunner } from '../utils/post-qa-gate/runner.js';
import type { PostQAGateRunResult } from '../utils/post-qa-gate/runner.js';

// Use a temp directory as cwd (the classification methods don't read filesystem)
const TEST_CWD = '/tmp/qa-gate-test';

function createRunner(): PostQAGateRunner {
  return new PostQAGateRunner(TEST_CWD);
}

describe('QA Gate Coverage Retry', () => {
  // ============================================================
  // CP-6: classifyQAFailureCategory tests
  // ============================================================
  describe('classifyQAFailureCategory', () => {
    it('should return "none" when gate passes', () => {
      const runner = createRunner();
      const passResult: PostQAGateRunResult = {
        taskId: 'TASK-test-001',
        decision: 'POST_QA_PASS',
        allowed: true,
        ruleResults: [],
        passedRules: 1,
        failedRules: 0,
        warningCount: 0,
        blockingFailures: 0,
        duration: 100,
        timestamp: new Date().toISOString(),
      };

      expect(runner.classifyQAFailureCategory(passResult)).toBe('none');
    });

    it('should return "coverage_retry" when coverage check fails with gap data', () => {
      const runner = createRunner();
      const result: PostQAGateRunResult = {
        taskId: 'TASK-test-002',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          {
            ruleId: 'R-QA-POST-007',
            passed: false,
            ruleName: '测试覆盖率达标',
            message: '测试覆盖率未达标: 65.0% < 80%',
            details: { coverage: 0.65, minCoverage: 0.8 },
            duration: 50,
            timestamp: new Date().toISOString(),
            failureType: 'B',
          },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 150,
        timestamp: new Date().toISOString(),
        coverageGapData: {
          currentCoverage: 0.65,
          minCoverage: 0.8,
          gap: 0.15,
          gapPercent: '15.0%',
          failureType: 'B',
          message: '当前覆盖率: 65.0%，阈值要求: 80%，缺口: 15.0%',
        },
      };

      expect(runner.classifyQAFailureCategory(result)).toBe('coverage_retry');
    });

    it('should return "chain_rollback" for A-type failures', () => {
      const runner = createRunner();
      const result: PostQAGateRunResult = {
        taskId: 'TASK-test-003',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          {
            ruleId: 'R-QA-POST-001',
            passed: false,
            ruleName: 'QA报告存在',
            message: 'QA报告不存在',
            details: {},
            duration: 10,
            timestamp: new Date().toISOString(),
            failureType: 'A',
          },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 50,
        timestamp: new Date().toISOString(),
      };

      expect(runner.classifyQAFailureCategory(result)).toBe('chain_rollback');
    });

    it('should return "chain_rollback" when coverage fails but no gap data', () => {
      const runner = createRunner();
      const result: PostQAGateRunResult = {
        taskId: 'TASK-test-004',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          {
            ruleId: 'R-QA-POST-007',
            passed: false,
            ruleName: '测试覆盖率达标',
            message: '测试覆盖率未达标',
            details: {},
            duration: 50,
            timestamp: new Date().toISOString(),
            failureType: 'B',
          },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 150,
        timestamp: new Date().toISOString(),
      };

      expect(runner.classifyQAFailureCategory(result)).toBe('chain_rollback');
    });

    it('should distinguish coverage retry from chain rollback (CP-6 core requirement)', () => {
      const runner = createRunner();

      // Coverage issue → coverage_retry (QA internal retry, NOT chain rollback)
      const coverageResult: PostQAGateRunResult = {
        taskId: 'TASK-coverage-001',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          { ruleId: 'R-QA-POST-007', passed: false, ruleName: '覆盖率', message: '覆盖率不足', duration: 50, timestamp: new Date().toISOString(), failureType: 'B' },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 100,
        timestamp: new Date().toISOString(),
        coverageGapData: { currentCoverage: 0.6, minCoverage: 0.8, gap: 0.2, gapPercent: '20.0%', failureType: 'B', message: '覆盖率不足' },
      };

      // Functional issue → chain_rollback (QA → CR → Dev)
      const functionalResult: PostQAGateRunResult = {
        taskId: 'TASK-functional-001',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          { ruleId: 'R-QA-POST-003', passed: false, ruleName: '结果有效性', message: '结果无效', duration: 50, timestamp: new Date().toISOString(), failureType: 'A' },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 100,
        timestamp: new Date().toISOString(),
      };

      expect(runner.classifyQAFailureCategory(coverageResult)).toBe('coverage_retry');
      expect(runner.classifyQAFailureCategory(functionalResult)).toBe('chain_rollback');
    });
  });

  // ============================================================
  // CP-5: classifyQAGateFailure returns coverage gap data + prompt
  // ============================================================
  describe('classifyQAGateFailure', () => {
    it('should return coverageGapData and qaRetryPrompt for coverage retry', () => {
      const runner = createRunner();
      const result: PostQAGateRunResult = {
        taskId: 'TASK-test-005',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          {
            ruleId: 'R-QA-POST-007',
            passed: false,
            ruleName: '测试覆盖率达标',
            message: '测试覆盖率未达标: 62.5% < 80%',
            details: { coverage: 0.625, minCoverage: 0.8 },
            duration: 50,
            timestamp: new Date().toISOString(),
            failureType: 'B',
          },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 150,
        timestamp: new Date().toISOString(),
        coverageGapData: {
          currentCoverage: 0.625,
          minCoverage: 0.8,
          gap: 0.175,
          gapPercent: '17.5%',
          coverageDetails: { lines: 0.60, branches: 0.55, functions: 0.70, statements: 0.65 },
          failureType: 'B',
          message: '当前覆盖率: 62.5%，阈值要求: 80%，缺口: 17.5%',
        },
      };

      const classification = runner.classifyQAGateFailure(result);

      expect(classification.needsQARetry).toBe(true);
      expect(classification.needsChainRollback).toBe(false);
      expect(classification.failureCategory).toBe('coverage_retry');
      expect(classification.coverageGapData?.currentCoverage).toBe(0.625);
      expect(classification.coverageGapData?.minCoverage).toBe(0.8);
      expect(classification.qaRetryPrompt).toContain('覆盖率门禁未通过');
      expect(classification.qaRetryPrompt).toContain('62.5%');
      expect(classification.qaRetryPrompt).toContain('80%');
    });

    it('should return needsChainRollback for A-type failures without coverage data', () => {
      const runner = createRunner();
      const result: PostQAGateRunResult = {
        taskId: 'TASK-test-006',
        decision: 'POST_QA_FAIL',
        allowed: false,
        ruleResults: [
          { ruleId: 'R-QA-POST-002', passed: false, ruleName: '报告格式', message: '格式无效', details: {}, duration: 20, timestamp: new Date().toISOString(), failureType: 'A' },
        ],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: 50,
        timestamp: new Date().toISOString(),
      };

      const classification = runner.classifyQAGateFailure(result);

      expect(classification.needsQARetry).toBe(false);
      expect(classification.needsChainRollback).toBe(true);
      expect(classification.failureCategory).toBe('chain_rollback');
      expect(classification.coverageGapData).toBeUndefined();
      expect(classification.qaRetryPrompt).toBeUndefined();
    });
  });

  // ============================================================
  // CP-5: generateQARetryPrompt tests
  // ============================================================
  describe('generateQARetryPrompt', () => {
    it('should generate prompt with coverage details', () => {
      const runner = createRunner();
      const gapData = {
        currentCoverage: 0.55,
        minCoverage: 0.80,
        gap: 0.25,
        gapPercent: '25.0%',
        coverageDetails: { lines: 0.50, branches: 0.45, functions: 0.60, statements: 0.55 },
        failureType: 'B' as const,
        message: '当前覆盖率: 55.0%，阈值要求: 80%，缺口: 25.0%',
      };

      const prompt = runner.generateQARetryPrompt(gapData);

      expect(prompt).toContain('覆盖率门禁未通过');
      expect(prompt).toContain('55.0%');
      expect(prompt).toContain('80%');
      expect(prompt).toContain('25.0%');
      expect(prompt).toContain('行覆盖率: 50.0%');
      expect(prompt).toContain('分支覆盖率: 45.0%');
      expect(prompt).toContain('函数覆盖率: 60.0%');
      expect(prompt).toContain('语句覆盖率: 55.0%');
      expect(prompt).toContain('最低覆盖率维度');
      expect(prompt).toContain('分支覆盖率');
    });

    it('should generate prompt without coverage details', () => {
      const runner = createRunner();
      const gapData = {
        currentCoverage: 0.65,
        minCoverage: 0.80,
        gap: 0.15,
        gapPercent: '15.0%',
        failureType: 'B' as const,
        message: '当前覆盖率: 65.0%，阈值要求: 80%，缺口: 15.0%',
      };

      const prompt = runner.generateQARetryPrompt(gapData);

      expect(prompt).toContain('覆盖率门禁未通过');
      expect(prompt).toContain('65.0%');
      expect(prompt).toContain('80%');
      expect(prompt).toContain('请扩展测试用例');
    });
  });
});