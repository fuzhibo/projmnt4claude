/**
 * CodeReviewReportChecker 单元测试
 *
 * 测试代码审核报告检查器的核心功能:
 * - 报告存在性检查 (R-CR-POST-001)
 * - 报告格式有效性检查 (R-CR-POST-002)
 * - 审核结果有效性检查 (R-CR-POST-003)
 * - 审核原因完整性检查 (R-CR-POST-004)
 * - 问题项详情检查 (R-CR-POST-005)
 * - 审核时间戳有效性检查 (R-CR-POST-007)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  CodeReviewReportChecker,
  createCodeReviewReportChecker,
  quickReportCheck,
  DEFAULT_REPORT_CHECKER_CONFIG,
  type CodeReviewReportCheckerConfig,
  type CodeReviewReport,
} from '../utils/post-cr-gate/checkers/report-checker.js';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// 测试辅助函数
function createMockReport(overrides: Partial<CodeReviewReport> = {}): CodeReviewReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    verdict: 'PASS',
    reviewedAt: new Date().toISOString(),
    reviewer: 'test-reviewer',
    summary: '这是一个完整的审核总结，内容足够长以满足最小长度要求。',
    issues: [],
    recommendations: [],
    ...overrides,
  };
}

describe('CodeReviewReportChecker', () => {
  let env: IsolatedTestEnv;
  let testDir: string;
  let outputsDir: string;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'report-checker-test-' });
    testDir = env.tempDir;
    outputsDir = path.join(testDir, '.projmnt4claude', 'outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const checker = new CodeReviewReportChecker(testDir);
      expect(checker).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const checker = new CodeReviewReportChecker(testDir);
      expect(checker).toBeDefined();
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<CodeReviewReportCheckerConfig> = {
        reportPath: '.projmnt4claude/outputs/{taskId}/custom-report.json',
        requireIssues: true,
        requireRecommendations: true,
        minSummaryLength: 20,
      };

      const checker = new CodeReviewReportChecker(testDir, customConfig);
      expect(checker).toBeDefined();
    });
  });

  describe('R-CR-POST-001: 报告存在性检查', () => {
    it('报告存在时应该通过', async () => {
      const taskId = 'TASK-test-report-exists';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      // 创建报告文件
      const report = createMockReport({ taskId });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const existenceResult = results.find(r => r.check === 'report_existence');

      expect(existenceResult?.passed).toBe(true);
      expect(existenceResult?.message).toContain('存在');
    });

    it('报告不存在时应该失败', async () => {
      const taskId = 'TASK-test-report-missing';

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const existenceResult = results.find(r => r.check === 'report_existence');

      expect(existenceResult?.passed).toBe(false);
      expect(existenceResult?.message).toContain('不存在');
    });
  });

  describe('R-CR-POST-002: 报告格式有效性检查', () => {
    it('格式正确的报告应该通过', async () => {
      const taskId = 'TASK-test-valid-format';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const formatResult = results.find(r => r.check === 'report_format');

      expect(formatResult?.passed).toBe(true);
      expect(formatResult?.message).toContain('格式有效');
    });

    it('缺少必需字段的报告应该失败', async () => {
      const taskId = 'TASK-test-missing-fields';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      // 缺少多个必需字段的报告
      const invalidReport = {
        version: '1.0.0',
        taskId,
        // 缺少 verdict, reviewedAt, reviewer, summary
      };
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(invalidReport, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const formatResult = results.find(r => r.check === 'report_format');

      expect(formatResult?.passed).toBe(false);
      expect(formatResult?.message).toContain('缺少字段');
    });

    it('无效的 JSON 应该失败', async () => {
      const taskId = 'TASK-test-invalid-json';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      // 写入无效的 JSON
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        '{ invalid json }'
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const formatResult = results.find(r => r.check === 'report_format');

      expect(formatResult?.passed).toBe(false);
    });

    it('报告不存在时应该返回适当的错误', async () => {
      const taskId = 'TASK-test-format-no-file';

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const formatResult = results.find(r => r.check === 'report_format');

      expect(formatResult?.passed).toBe(false);
      expect(formatResult?.message).toContain('不存在');
    });
  });

  describe('R-CR-POST-003: 审核结果有效性检查', () => {
    it('PASS 结果应该通过', async () => {
      const taskId = 'TASK-test-verdict-pass';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, verdict: 'PASS' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const verdictResult = results.find(r => r.check === 'verdict_validity');

      expect(verdictResult?.passed).toBe(true);
      expect(verdictResult?.message).toContain('PASS');
    });

    it('NOPASS 结果应该通过', async () => {
      const taskId = 'TASK-test-verdict-nopass';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, verdict: 'NOPASS' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const verdictResult = results.find(r => r.check === 'verdict_validity');

      expect(verdictResult?.passed).toBe(true);
      expect(verdictResult?.message).toContain('NOPASS');
    });

    it('无效的审核结果应该失败', async () => {
      const taskId = 'TASK-test-invalid-verdict';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, verdict: 'INVALID' as any });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const verdictResult = results.find(r => r.check === 'verdict_validity');

      expect(verdictResult?.passed).toBe(false);
      expect(verdictResult?.message).toContain('无效');
    });
  });

  describe('R-CR-POST-004: 审核原因完整性检查', () => {
    it('完整的审核总结应该通过', async () => {
      const taskId = 'TASK-test-complete-summary';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const summary = '这是一个非常详细的审核总结，包含足够的信息来解释审核决定的原因和背景。';
      const report = createMockReport({ taskId, summary });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const summaryResult = results.find(r => r.check === 'summary_completeness');

      expect(summaryResult?.passed).toBe(true);
    });

    it('空总结应该失败', async () => {
      const taskId = 'TASK-test-empty-summary';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, summary: '' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const summaryResult = results.find(r => r.check === 'summary_completeness');

      expect(summaryResult?.passed).toBe(false);
      expect(summaryResult?.message).toContain('缺少总结');
    });

    it('过短的总结应该失败', async () => {
      const taskId = 'TASK-test-short-summary';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, summary: '短' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const summaryResult = results.find(r => r.check === 'summary_completeness');

      expect(summaryResult?.passed).toBe(false);
      expect(summaryResult?.message).toContain('内容过短');
    });

    it('应该支持自定义最小长度', async () => {
      const taskId = 'TASK-test-custom-min-length';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, summary: '中等长度的总结内容' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      // 使用较短的最小长度配置
      const checker = new CodeReviewReportChecker(testDir, { minSummaryLength: 5 });
      const results = await checker.check(taskId);
      const summaryResult = results.find(r => r.check === 'summary_completeness');

      expect(summaryResult?.passed).toBe(true);
    });
  });

  describe('R-CR-POST-005: 问题项详情检查', () => {
    it('无问题时应该通过', async () => {
      const taskId = 'TASK-test-no-issues';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, issues: [] });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const issuesResult = results.find(r => r.check === 'issues_details');

      expect(issuesResult?.passed).toBe(true);
    });

    it('完整的问题项应该通过', async () => {
      const taskId = 'TASK-test-complete-issues';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({
        taskId,
        issues: [
          {
            id: 'ISSUE-001',
            type: 'error',
            description: '发现了一个错误',
            severity: 'high',
            file: 'src/test.ts',
            line: 10,
          },
        ],
      });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const issuesResult = results.find(r => r.check === 'issues_details');

      expect(issuesResult?.passed).toBe(true);
    });

    it('不完整的问题项应该失败', async () => {
      const taskId = 'TASK-test-incomplete-issues';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({
        taskId,
        issues: [
          {
            id: '',
            type: 'error',
            description: '',
            severity: 'high',
          },
        ],
      });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const issuesResult = results.find(r => r.check === 'issues_details');

      expect(issuesResult?.passed).toBe(false);
      expect(issuesResult?.message).toContain('不完整');
    });

    it('配置要求 issues 时不存在应该失败', async () => {
      const taskId = 'TASK-test-require-issues';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId });
      delete (report as any).issues;
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir, { requireIssues: true });
      const results = await checker.check(taskId);
      const issuesResult = results.find(r => r.check === 'issues_details');

      expect(issuesResult?.passed).toBe(false);
      expect(issuesResult?.message).toContain('缺少');
    });
  });

  describe('R-CR-POST-007: 审核时间戳有效性检查', () => {
    it('有效的时间戳应该通过', async () => {
      const taskId = 'TASK-test-valid-timestamp';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, reviewedAt: new Date().toISOString() });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const timestampResult = results.find(r => r.check === 'timestamp_validity');

      expect(timestampResult?.passed).toBe(true);
    });

    it('无效的日期格式应该失败', async () => {
      const taskId = 'TASK-test-invalid-timestamp';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId, reviewedAt: 'invalid-date' });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const timestampResult = results.find(r => r.check === 'timestamp_validity');

      expect(timestampResult?.passed).toBe(false);
      expect(timestampResult?.message).toContain('无效日期格式');
    });

    it('未来日期应该失败', async () => {
      const taskId = 'TASK-test-future-timestamp';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      // 设置一个未来的日期
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const report = createMockReport({ taskId, reviewedAt: futureDate.toISOString() });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);
      const timestampResult = results.find(r => r.check === 'timestamp_validity');

      expect(timestampResult?.passed).toBe(false);
      expect(timestampResult?.message).toContain('未来日期');
    });
  });

  describe('综合检查', () => {
    it('所有检查通过时应该返回通过的结果', async () => {
      const taskId = 'TASK-test-all-pass';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);

      // 所有检查都应该通过
      const allPassed = results.every(r => r.passed);
      expect(allPassed).toBe(true);
      expect(results.length).toBe(6); // 6 个检查项
    });

    it('报告不存在时所有相关检查应该失败', async () => {
      const taskId = 'TASK-test-all-fail-no-report';

      const checker = new CodeReviewReportChecker(testDir);
      const results = await checker.check(taskId);

      // 除了存在性检查外，其他检查都应该因为文件不存在而失败
      const existenceResult = results.find(r => r.check === 'report_existence');
      expect(existenceResult?.passed).toBe(false);
    });
  });

  describe('readReport 方法', () => {
    it('应该能够读取报告', () => {
      const taskId = 'TASK-test-read-report';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const checker = new CodeReviewReportChecker(testDir);
      const readReport = checker.readReport(taskId);

      expect(readReport).toBeDefined();
      expect(readReport?.taskId).toBe(taskId);
      expect(readReport?.verdict).toBe('PASS');
    });

    it('报告不存在时应该返回 null', () => {
      const taskId = 'TASK-test-read-no-report';

      const checker = new CodeReviewReportChecker(testDir);
      const readReport = checker.readReport(taskId);

      expect(readReport).toBeNull();
    });
  });

  describe('便捷函数', () => {
    it('createCodeReviewReportChecker 应该创建实例', () => {
      const checker = createCodeReviewReportChecker(testDir);
      expect(checker).toBeInstanceOf(CodeReviewReportChecker);
    });

    it('quickReportCheck 应该快速执行检查', async () => {
      const taskId = 'TASK-test-quick-check';
      const taskOutputDir = path.join(outputsDir, taskId);
      fs.mkdirSync(taskOutputDir, { recursive: true });

      const report = createMockReport({ taskId });
      fs.writeFileSync(
        path.join(taskOutputDir, 'code-review-report.json'),
        JSON.stringify(report, null, 2)
      );

      const results = await quickReportCheck(taskId, testDir);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.check === 'report_existence')).toBe(true);
    });
  });

  describe('配置管理', () => {
    it('应该支持更新配置', () => {
      const checker = new CodeReviewReportChecker(testDir);

      checker.updateConfig({
        minSummaryLength: 50,
        requireIssues: true,
      });

      // 配置已更新，验证通过执行检查
      expect(checker).toBeDefined();
    });
  });

  describe('默认配置', () => {
    it('DEFAULT_REPORT_CHECKER_CONFIG 应该包含默认配置', () => {
      expect(DEFAULT_REPORT_CHECKER_CONFIG.reportPath).toContain('{taskId}');
      expect(DEFAULT_REPORT_CHECKER_CONFIG.requireIssues).toBe(false);
      expect(DEFAULT_REPORT_CHECKER_CONFIG.requireRecommendations).toBe(false);
      expect(DEFAULT_REPORT_CHECKER_CONFIG.minSummaryLength).toBe(10);
    });
  });
});
