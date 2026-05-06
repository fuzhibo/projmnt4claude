/**
 * QA Report Checker Tests
 * QA报告检查器测试
 *
 * 对齐规则:
 * - R-QA-POST-001: QA报告存在性检查
 * - R-QA-POST-002: JSON格式有效性检查
 * - R-QA-POST-003: 测试结果有效性检查
 * - R-QA-POST-004: 测试失败详情检查
 *
 * @module __tests__/post-qa-gate/checkers/qa-report-checker
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  QAReportExistsChecker,
  QAReportJsonChecker,
  QAResultValidChecker,
  QAFailuresDetailChecker,
  QAReportChecker,
  createQAReportChecker,
  quickQAReportCheck,
} from '../../../utils/post-qa-gate/checkers/qa-report-checker.js';

describe('QAReportChecker', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-checker-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * 辅助: 创建QA报告文件
   */
  function createReport(taskId: string, report: Record<string, unknown>): void {
    const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * 辅助: 创建无效JSON文件
   */
  function createInvalidReport(taskId: string, content: string): void {
    const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, content);
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

  // ============== CP-001: QAReportExistsChecker (R-QA-POST-001) ==============

  describe('QAReportExistsChecker (R-QA-POST-001)', () => {
    it('should fail when report does not exist', async () => {
      const checker = new QAReportExistsChecker(tempDir);
      const result = await checker.check('TASK-test-P2-1-20260101');

      expect(result.passed).toBe(false);
      expect(result.check).toBe('qa_report_existence');
      expect(result.message).toContain('不存在');
    });

    it('should pass when report exists', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId));

      const checker = new QAReportExistsChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('qa_report_existence');
      expect(result.message).toContain('存在');
    });

    it('should use custom report path template', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      const customPath = 'custom/reports/{taskId}/qa.json';
      const fullPath = path.join(tempDir, 'custom', 'reports', taskId, 'qa.json');
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify(validReport(taskId)));

      const checker = new QAReportExistsChecker(tempDir, { reportPath: customPath });
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.details?.reportPath).toBe(`custom/reports/${taskId}/qa.json`);
    });
  });

  // ============== CP-002: QAReportJsonChecker (R-QA-POST-002) ==============

  describe('QAReportJsonChecker (R-QA-POST-002)', () => {
    it('should fail when report does not exist', async () => {
      const checker = new QAReportJsonChecker(tempDir);
      const result = await checker.check('TASK-test-P2-1-20260101');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('不存在');
    });

    it('should fail when report has invalid JSON', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createInvalidReport(taskId, 'not valid json{{{');

      const checker = new QAReportJsonChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.check).toBe('qa_report_format');
      expect(result.message).toContain('格式检查失败');
    });

    it('should fail when report has missing required fields', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, { taskId }); // Only taskId, missing other fields

      const checker = new QAReportJsonChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('格式无效');
      expect(result.details?.missingFields).toContain('version');
      expect(result.details?.missingFields).toContain('verdict');
    });

    it('should pass when report has valid format with all required fields', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId));

      const checker = new QAReportJsonChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('格式有效');
    });
  });

  // ============== CP-003: QAResultValidChecker (R-QA-POST-003) ==============

  describe('QAResultValidChecker (R-QA-POST-003)', () => {
    it('should fail when report does not exist', async () => {
      const checker = new QAResultValidChecker(tempDir);
      const result = await checker.check('TASK-test-P2-1-20260101');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('不存在');
    });

    it('should fail when verdict is invalid', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'INVALID' }));

      const checker = new QAResultValidChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('无效');
      expect(result.details?.verdict).toBe('INVALID');
    });

    it('should pass with PASS verdict', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'PASS' }));

      const checker = new QAResultValidChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('PASS');
    });

    it('should pass with NOPASS verdict', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'NOPASS' }));

      const checker = new QAResultValidChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('NOPASS');
    });
  });

  // ============== CP-004: QAFailuresDetailChecker (R-QA-POST-004) ==============

  describe('QAFailuresDetailChecker (R-QA-POST-004)', () => {
    it('should fail when report does not exist', async () => {
      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check('TASK-test-P2-1-20260101');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('不存在');
    });

    it('should pass when verdict is PASS (no failures needed)', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'PASS' }));

      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('PASS');
      expect(result.message).toContain('无需检查');
    });

    it('should fail when NOPASS but no testFailures', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'NOPASS' }));

      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少测试失败详情');
    });

    it('should fail when NOPASS but testFailures is empty array', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, {
        verdict: 'NOPASS',
        testFailures: [],
      }));

      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少测试失败详情');
    });

    it('should fail when NOPASS but testFailures lack details', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, {
        verdict: 'NOPASS',
        testFailures: [
          { testName: 'test1' }, // Missing reason and severity
          { testName: 'test2', reason: 'Failed', severity: 'high' },
        ],
      }));

      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('不完整');
    });

    it('should pass when NOPASS with complete testFailures', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, {
        verdict: 'NOPASS',
        testFailures: [
          { testName: 'test1', reason: 'Assertion failed', severity: 'high' },
          { testName: 'test2', reason: 'Timeout', severity: 'medium' },
        ],
      }));

      const checker = new QAFailuresDetailChecker(tempDir);
      const result = await checker.check(taskId);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('完整');
    });
  });

  // ============== QAReportChecker (聚合) ==============

  describe('QAReportChecker (aggregate)', () => {
    it('should run all 4 checks', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId));

      const checker = new QAReportChecker(tempDir);
      const results = await checker.check(taskId);

      expect(results).toHaveLength(4);
      expect(results[0]!.check).toBe('qa_report_existence');
      expect(results[1]!.check).toBe('qa_report_format');
      expect(results[2]!.check).toBe('qa_verdict_validity');
      expect(results[3]!.check).toBe('qa_failures_detail');
    });

    it('should pass all checks with valid PASS report', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, { verdict: 'PASS' }));

      const checker = new QAReportChecker(tempDir);
      const results = await checker.check(taskId);

      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should pass all checks with valid NOPASS report with failures', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId, {
        verdict: 'NOPASS',
        testFailures: [
          { testName: 'test1', reason: 'Failed', severity: 'high' },
        ],
      }));

      const checker = new QAReportChecker(tempDir);
      const results = await checker.check(taskId);

      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should fail existence check when no report', async () => {
      const checker = new QAReportChecker(tempDir);
      const results = await checker.check('TASK-test-P2-1-20260101');

      // All checks should fail since report doesn't exist
      expect(results.every(r => !r.passed)).toBe(true);
    });

    it('should expose individual checkers via getCheckers()', () => {
      const checker = new QAReportChecker(tempDir);
      const checkers = checker.getCheckers();

      expect(checkers.exists).toBeInstanceOf(QAReportExistsChecker);
      expect(checkers.json).toBeInstanceOf(QAReportJsonChecker);
      expect(checkers.result).toBeInstanceOf(QAResultValidChecker);
      expect(checkers.failures).toBeInstanceOf(QAFailuresDetailChecker);
    });
  });

  // ============== 便捷函数 ==============

  describe('Utility Functions', () => {
    it('createQAReportChecker should create checker instance', () => {
      const checker = createQAReportChecker(tempDir);
      expect(checker).toBeInstanceOf(QAReportChecker);
    });

    it('quickQAReportCheck should return all check results', async () => {
      const taskId = 'TASK-test-P2-1-20260101';
      createReport(taskId, validReport(taskId));

      const results = await quickQAReportCheck(taskId, tempDir);
      expect(results).toHaveLength(4);
    });
  });
});
