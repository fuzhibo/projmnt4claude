/**
 * Test Coverage Checker Tests
 * 测试覆盖率检查器测试
 *
 * 对齐规则:
 * - R-QA-POST-007: 测试覆盖率达标检查
 *
 * @module __tests__/post-qa-gate/checkers/coverage-checker
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TestCoverageChecker,
  createCoverageChecker,
  quickCoverageCheck,
  DEFAULT_COVERAGE_CHECKER_CONFIG,
  DEFAULT_COVERAGE_WEIGHTS,
} from '../../../utils/post-qa-gate/checkers/coverage-checker.js';

describe('TestCoverageChecker (R-QA-POST-007)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-checker-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * 辅助: 创建QA报告文件
   */
  function createQAReport(taskId: string, report: Record<string, unknown>): void {
    const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * 辅助: 创建覆盖率报告文件
   */
  function createCoverageReport(filePath: string, data: Record<string, unknown>): void {
    const fullPath = path.join(tempDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  }

  const validReport = (taskId: string, overrides?: Record<string, unknown>) => ({
    version: '1.0.0',
    taskId,
    verdict: 'PASS' as const,
    verifiedAt: new Date().toISOString(),
    verifier: 'qa_tester',
    summary: 'Test summary',
    ...overrides,
  });

  // ============== 基本功能 ==============

  describe('基本功能', () => {
    it('should fail when no coverage data available', async () => {
      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check('TASK-test-P2-1-20260101');

      expect(result.passed).toBe(true);
      expect(result.check).toBe('test_coverage');
      expect(result.details?.skipped).toBe(true);
    });

    it('should pass when coverage from qa-report.json meets threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.75 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('test_coverage');
      expect(result.message).toContain('达标');
      expect(result.details?.coverage).toBe(0.75);
      expect(result.details?.source).toBe('qa-report.json');
    });

    it('should fail when coverage from qa-report.json below threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.45 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('未达标');
      expect(result.details?.coverage).toBe(0.45);
    });

    it('should use qa-report.json coverage over file-based coverage', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.8 }));

      // Also create a coverage file with different data
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 50 },
          branches: { pct: 50 },
          functions: { pct: 50 },
          statements: { pct: 50 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Should use qa-report.json value (0.8), not file-based (0.5)
      expect(result.details?.coverage).toBe(0.8);
      expect(result.details?.source).toBe('qa-report.json');
    });
  });

  // ============== 覆盖率文件解析 ==============

  describe('覆盖率文件解析', () => {
    it('should calculate weighted coverage from coverage-summary.json (nyc/c8 format)', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 80 },
          branches: { pct: 60 },
          functions: { pct: 70 },
          statements: { pct: 90 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Expected: 80*0.4 + 60*0.3 + 70*0.2 + 90*0.1 = 32 + 18 + 14 + 9 = 73 -> 0.73
      expect(result.details?.coverage).toBe(0.73);
      expect(result.details?.source).toBe('coverage/coverage-summary.json');
      expect(result.passed).toBe(true);
    });

    it('should calculate weighted coverage from lcov-report path', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/lcov-report/coverage-summary.json', {
        total: {
          lines: { pct: 70 },
          branches: { pct: 50 },
          functions: { pct: 60 },
          statements: { pct: 80 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Expected: 70*0.4 + 50*0.3 + 60*0.2 + 80*0.1 = 28 + 15 + 12 + 8 = 63 -> 0.63
      expect(result.details?.coverage).toBe(0.63);
      expect(result.details?.source).toBe('coverage/lcov-report/coverage-summary.json');
    });

    it('should calculate weighted coverage from coverage.json', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage.json', {
        total: {
          lines: { pct: 90 },
          branches: { pct: 80 },
          functions: { pct: 85 },
          statements: { pct: 95 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Expected: 90*0.4 + 80*0.3 + 85*0.2 + 95*0.1 = 36 + 24 + 17 + 9.5 = 86.5 -> 0.865
      expect(result.details?.coverage).toBe(0.865);
    });

    it('should handle flat format (jest/vitest without total wrapper)', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        lines: { pct: 75 },
        branches: { pct: 55 },
        functions: { pct: 65 },
        statements: { pct: 85 },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Expected: 75*0.4 + 55*0.3 + 65*0.2 + 85*0.1 = 30 + 16.5 + 13 + 8.5 = 68 -> 0.68
      expect(result.details?.coverage).toBe(0.68);
    });

    it('should prioritize coverage-summary.json over other files', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      // Create multiple coverage files with different values
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 80 },
          branches: { pct: 80 },
          functions: { pct: 80 },
          statements: { pct: 80 },
        },
      });
      createCoverageReport('coverage/lcov-report/coverage-summary.json', {
        total: {
          lines: { pct: 50 },
          branches: { pct: 50 },
          functions: { pct: 50 },
          statements: { pct: 50 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Should use the first file found (coverage/coverage-summary.json)
      expect(result.details?.coverage).toBe(0.8);
      expect(result.details?.source).toBe('coverage/coverage-summary.json');
    });

    it('should skip invalid JSON files and try next', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      // Create invalid file at first path
      const invalidPath = path.join(tempDir, 'coverage', 'coverage-summary.json');
      fs.mkdirSync(path.dirname(invalidPath), { recursive: true });
      fs.writeFileSync(invalidPath, 'not valid json');

      // Create valid file at second path
      createCoverageReport('coverage/lcov-report/coverage-summary.json', {
        total: {
          lines: { pct: 70 },
          branches: { pct: 70 },
          functions: { pct: 70 },
          statements: { pct: 70 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Should fall back to second file
      expect(result.details?.coverage).toBe(0.7);
      expect(result.details?.source).toBe('coverage/lcov-report/coverage-summary.json');
    });
  });

  // ============== 自定义配置 ==============

  describe('自定义配置', () => {
    it('should use custom threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.55 }));

      // Default threshold 60% should fail
      const checker1 = new TestCoverageChecker(tempDir);
      const result1 = await checker1.check(taskId);
      expect(result1.passed).toBe(false);

      // Custom threshold 50% should pass
      const checker2 = new TestCoverageChecker(tempDir, { minCoverage: 0.5 });
      const result2 = await checker2.check(taskId);
      expect(result2.passed).toBe(true);
    });

    it('should use custom coverage file paths', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('custom/coverage.json', {
        total: {
          lines: { pct: 90 },
          branches: { pct: 90 },
          functions: { pct: 90 },
          statements: { pct: 90 },
        },
      });

      const checker = new TestCoverageChecker(tempDir, {
        coverageFiles: ['custom/coverage.json'],
      });
      const result = await checker.check(taskId);

      expect(result.details?.coverage).toBe(0.9);
      expect(result.details?.source).toBe('custom/coverage.json');
    });

    it('should use custom weights', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 100 },
          branches: { pct: 0 },
          functions: { pct: 0 },
          statements: { pct: 0 },
        },
      });

      // With default weights: 100*0.4 + 0*0.3 + 0*0.2 + 0*0.1 = 40% -> 0.4
      const checker1 = new TestCoverageChecker(tempDir);
      const result1 = await checker1.check(taskId);
      expect(result1.details?.coverage).toBe(0.4);

      // With custom weights (all lines): 100*1.0 = 100% -> 1.0
      const checker2 = new TestCoverageChecker(tempDir, undefined, {
        lines: 1.0,
        branches: 0,
        functions: 0,
        statements: 0,
      });
      const result2 = await checker2.check(taskId);
      expect(result2.details?.coverage).toBe(1.0);
    });
  });

  // ============== 改进建议 ==============

  describe('改进建议', () => {
    it('should generate suggestions when coverage below threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 50 },
          branches: { pct: 30 },
          functions: { pct: 40 },
          statements: { pct: 60 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      const suggestions = result.details?.suggestions as string[];
      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      expect(suggestions[0]).toContain('低于阈值');
      expect(suggestions[1]).toContain('添加测试用例');
      // Should highlight the lowest dimension (branches at 30%)
      expect(suggestions[2]).toContain('分支覆盖率');
      expect(suggestions[2]).toContain('30.0%');
    });

    it('should not generate suggestions when coverage meets threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.8 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.details?.suggestions).toBeUndefined();
    });
  });

  // ============== 详情信息 ==============

  describe('详情信息', () => {
    it('should include breakdown when coverage from file', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 75.5 },
          branches: { pct: 60.2 },
          functions: { pct: 80.8 },
          statements: { pct: 70.1 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.details?.breakdown).toBeDefined();
      const breakdown = result.details?.breakdown as Record<string, string>;
      expect(breakdown.lines).toBe('75.5%');
      expect(breakdown.branches).toBe('60.2%');
      expect(breakdown.functions).toBe('80.8%');
      expect(breakdown.statements).toBe('70.1%');
    });

    it('should include weights in details', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.75 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.details?.weights).toEqual(DEFAULT_COVERAGE_WEIGHTS);
    });

    it('should include percentage strings in details', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.75 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.details?.coveragePercent).toBe('75.0%');
      expect(result.details?.thresholdPercent).toBe('60%');
    });
  });

  // ============== 边界情况 ==============

  describe('边界情况', () => {
    it('should pass when coverage exactly equals threshold', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.6 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
    });

    it('should handle zero coverage gracefully', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 0 },
          branches: { pct: 0 },
          functions: { pct: 0 },
          statements: { pct: 0 },
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.details?.coverage).toBe(0);
    });

    it('should handle coverage of 100%', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 1.0 }));

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.details?.coverage).toBe(1.0);
    });

    it('should handle missing fields in coverage report gracefully', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createCoverageReport('coverage/coverage-summary.json', {
        total: {
          lines: { pct: 80 },
          // Missing other fields
        },
      });

      const checker = new TestCoverageChecker(tempDir);
      const result = await checker.check(taskId);

      // Missing fields should default to 0
      // Expected: 80*0.4 + 0*0.3 + 0*0.2 + 0*0.1 = 32 -> 0.32
      expect(result.details?.coverage).toBe(0.32);
    });
  });

  // ============== 聚合和便捷函数 ==============

  describe('便捷函数', () => {
    it('createCoverageChecker should create checker instance', () => {
      const checker = createCoverageChecker(tempDir);
      expect(checker).toBeInstanceOf(TestCoverageChecker);
    });

    it('quickCoverageCheck should return check result', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.85 }));

      const result = await quickCoverageCheck(taskId, tempDir);
      expect(result.passed).toBe(true);
      expect(result.check).toBe('test_coverage');
    });

    it('quickCoverageCheck should accept custom config', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createQAReport(taskId, validReport(taskId, { coverage: 0.55 }));

      const result = await quickCoverageCheck(taskId, tempDir, { minCoverage: 0.5 });
      expect(result.passed).toBe(true);
    });
  });

  // ============== 默认配置 ==============

  describe('默认配置', () => {
    it('should have correct default config values', () => {
      expect(DEFAULT_COVERAGE_CHECKER_CONFIG.minCoverage).toBe(0.6);
      expect(DEFAULT_COVERAGE_CHECKER_CONFIG.reportPath).toBe(
        '.projmnt4claude/outputs/{taskId}/qa-report.json'
      );
      expect(DEFAULT_COVERAGE_CHECKER_CONFIG.coverageFiles).toHaveLength(3);
    });

    it('should have correct default weights', () => {
      expect(DEFAULT_COVERAGE_WEIGHTS.lines).toBe(0.4);
      expect(DEFAULT_COVERAGE_WEIGHTS.branches).toBe(0.3);
      expect(DEFAULT_COVERAGE_WEIGHTS.functions).toBe(0.2);
      expect(DEFAULT_COVERAGE_WEIGHTS.statements).toBe(0.1);

      // Weights should sum to 1.0
      const sum =
        DEFAULT_COVERAGE_WEIGHTS.lines +
        DEFAULT_COVERAGE_WEIGHTS.branches +
        DEFAULT_COVERAGE_WEIGHTS.functions +
        DEFAULT_COVERAGE_WEIGHTS.statements;
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });
});
