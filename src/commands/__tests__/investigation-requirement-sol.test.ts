/**
 * investigation-requirement SOL-001 / SOL-002 专项测试
 *
 * 覆盖范围：
 * - saveAttemptReport 文件写入
 * - saveReviewReport 文件写入
 * - saveFinalReport 文件写入
 * - formatReviewReport Markdown 格式化（zh / en）
 * - buildRetryPrompt 带 reviewPath 引用
 * - 重试循环集成：skipReview=false 时保存 attempt + review 文件
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../utils/test-env.js';
import type { InvestigationReport, ReviewResult } from '../../utils/investigation/types.js';

// ============================================================
// Mock setup
// ============================================================

const mockValidateReport = jest.fn<(...args: any[]) => any>();
const mockReviewReport = jest.fn<(...args: any[]) => any>();
const mockKillAllActiveChildren = jest.fn<(...args: any[]) => any>();

jest.mock('../../utils/investigation/report-validator', () => ({
  validateReport: (...args: unknown[]) => mockValidateReport(...args),
  VALIDATION_RULES: [],
}));

jest.mock('../../utils/investigation/report-reviewer', () => ({
  reviewReport: (...args: unknown[]) => mockReviewReport(...args),
}));

const mockCallAI = jest.fn<(...args: any[]) => any>();
jest.mock('../../utils/investigation/ai-integration', () => ({
  callAI: (...args: unknown[]) => mockCallAI(...args),
  callAIForJSON: (...args: unknown[]) => mockCallAI(...args),
}));

jest.mock('../../utils/path', () => ({
  isInitialized: () => true,
}));

jest.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

jest.mock('../../utils/investigation/config-reader', () => ({
  loadInvestigationConfig: () => ({}),
  loadLanguageConfig: () => 'zh',
  loadCustomRequirements: () => [],
  formatCustomRequirements: () => '',
}));

jest.mock('../../utils/investigation/report-parser', () => ({
  parseReport: (input: string) => JSON.parse(input),
}));

jest.mock('../../utils/child-process-registry.js', () => ({
  killAllActiveChildren: (...args: unknown[]) => mockKillAllActiveChildren(...args),
}));

// ============================================================
// Helpers
// ============================================================

function makeValidReport(): InvestigationReport {
  return {
    metadata: {
      requirementSource: 'Test requirement',
      investigationDate: new Date().toISOString(),
      investigationDir: 'investigation-test',
      language: 'zh',
    },
    rootCauseAnalysis: [{ id: 'CA-001', title: 'Test', description: 'Test' }],
    solutions: [
      {
        id: 'SOL-001',
        title: 'Test Solution',
        correspondsTo: 'CA-001',
        description: 'Test',
        files: ['test.ts'],
        expectedChanges: 'Test',
      },
    ],
    checkpoints: [{ prefix: 'ai-qa', description: 'Test', belongsTo: 'SOL-001' }],
    assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
  };
}

function makeReviewResult(): ReviewResult {
  return {
    pass: false,
    scores: { rootCauseAlignment: 50, solutionEffectiveness: 60, checkpointCompleteness: 40, factAccuracy: 85 },
    issues: [
      {
        dimension: 'rootCauseAlignment',
        severity: 'critical',
        description: '根因分析为空',
        suggestion: '请补充根因分析段落',
      },
      {
        dimension: 'checkpointCompleteness',
        severity: 'major',
        description: '检查点数量不足',
        suggestion: '请至少添加 3 个检查点',
      },
    ],
  };
}

// ============================================================
// Tests
// ============================================================

describe('investigation-requirement SOL-001 / SOL-002', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    jest.clearAllMocks();

    mockCallAI.mockResolvedValue({
      success: true,
      output: JSON.stringify(makeValidReport()),
      durationMs: 100,
      provider: 'mock',
      tokensUsed: 10,
      model: 'mock',
    });
  });

  afterEach(() => {
    env.cleanup();
  });

  // ============================================================
  // SOL-002: saveAttemptReport 文件写入验证
  // ============================================================

  describe('SOL-002: saveAttemptReport', () => {
    it('should write report-attempt-N.md to outputDir when validation fails', async () => {
      // 第一次验证失败，第二次成功
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-META-001', message: 'metadata missing' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-META-001', message: 'metadata missing' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test save attempt', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const attemptPath = path.join(env.tempDir, 'report-attempt-1.md');
      expect(fs.existsSync(attemptPath)).toBe(true);
      const content = fs.readFileSync(attemptPath, 'utf-8');
      expect(content).toContain('Test requirement');
    });

    it('should write multiple attempt files for multiple failures', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error 1' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'error 1' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-002', message: 'error 2' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-002', message: 'error 2' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test multi attempt', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-1.md'))).toBe(true);
      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-2.md'))).toBe(true);
    });
  });

  // ============================================================
  // SOL-002: saveFinalReport 文件写入验证
  // ============================================================

  describe('SOL-002: saveFinalReport', () => {
    it('should rename report-final.md to investigation-{slug}.md on success', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error 1' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'error 1' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test final report', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 成功路径：report-final.md 被重命名为 investigation-{slug}.md
      expect(result.success).toBe(true);
      expect(result.reportPath).toBeDefined();
      expect(fs.existsSync(result.reportPath!)).toBe(true);
      const content = fs.readFileSync(result.reportPath!, 'utf-8');
      expect(content).toContain('Test requirement');

      // report-final.md 不应存在（已被重命名）
      const finalPath = path.join(env.tempDir, 'report-final.md');
      expect(fs.existsSync(finalPath)).toBe(false);
    });
  });

  // ============================================================
  // SOL-001: saveReviewReport + buildRetryPrompt with reviewPath
  // ============================================================

  describe('SOL-001: review report save + retry prompt', () => {
    it('should save review report and reference it in retry prompt (zh)', async () => {
      const reviewResult = makeReviewResult();

      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(reviewResult);

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test review zh', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 验证审核报告文件已写入
      const reviewPath = path.join(env.tempDir, 'report-attempt-1-review.md');
      expect(fs.existsSync(reviewPath)).toBe(true);

      const reviewContent = fs.readFileSync(reviewPath, 'utf-8');
      expect(reviewContent).toContain('审核报告（第 1 次尝试）');
      expect(reviewContent).toContain('**通过状态**: 未通过');
      expect(reviewContent).toContain('**根因对齐度**: 50/100');
      expect(reviewContent).toContain('问题 1: rootCauseAlignment');
      expect(reviewContent).toContain('[关键] 请补充根因分析段落');
      expect(reviewContent).toContain('[重要] 请至少添加 3 个检查点');

      // 验证重试 prompt 引用了审核报告路径
      expect(mockCallAI).toHaveBeenCalledTimes(2);
      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // SOL-003: 新模板使用 "审核报告路径" 章节标题
      expect(retryCallArg.prompt).toContain('审核报告路径');
      expect(retryCallArg.prompt).toContain(reviewPath);
      // SOL-003: 新模板包含审核建议摘要（reviewResult.issues 渲染）
      expect(retryCallArg.prompt).toContain('审核建议');
      // SOL-003: 新模板包含完整格式示例
      expect(retryCallArg.prompt).toContain('## 元数据');
      // SOL-003: 新模板包含重试次数提示
      expect(retryCallArg.prompt).toContain('第 1 次重试');
    });

    it('should save review report and reference it in retry prompt (en)', async () => {
      const reviewResult = makeReviewResult();

      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(reviewResult);

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test review en', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
        lang: 'en',
      });

      const reviewPath = path.join(env.tempDir, 'report-attempt-1-review.md');
      expect(fs.existsSync(reviewPath)).toBe(true);

      const reviewContent = fs.readFileSync(reviewPath, 'utf-8');
      expect(reviewContent).toContain('Review Report (Attempt 1)');
      expect(reviewContent).toContain('**Pass Status**: Failed');
      expect(reviewContent).toContain('Issue 1: rootCauseAlignment');
      expect(reviewContent).toContain('[Critical] 请补充根因分析段落');

      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // SOL-003: 新模板使用 "Review Report Path" 章节标题
      expect(retryCallArg.prompt).toContain('Review Report Path');
      expect(retryCallArg.prompt).toContain(reviewPath);
      // SOL-003: 新模板包含审核建议摘要
      expect(retryCallArg.prompt).toContain('Review Suggestions');
      // SOL-003: 新模板包含完整格式示例
      expect(retryCallArg.prompt).toContain('## Metadata');
      // SOL-003: 新模板包含重试次数提示
      expect(retryCallArg.prompt).toContain('attempt 1');
    });

    it('should fallback to original feedback when reviewReport throws', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'rootCauseAnalysis empty' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockRejectedValue(new Error('AI review service down'));

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test review fallback', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const reviewPath = path.join(env.tempDir, 'report-attempt-1-review.md');

      // 审核报告文件不应存在
      expect(fs.existsSync(reviewPath)).toBe(false);

      // 重试 prompt 应降级为原始反馈（SOL-003: 新模板仍有格式问题章节，但无审核报告路径）
      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // SOL-003: 新模板使用 "上一次输出的格式问题" 章节
      expect(retryCallArg.prompt).toContain('上一次输出的格式问题');
      expect(retryCallArg.prompt).toContain('[R-001] rootCauseAnalysis empty');
      // 审核报告未生成，应显示降级文案而非路径
      expect(retryCallArg.prompt).toContain('未生成审核报告');
      expect(retryCallArg.prompt).not.toContain(reviewPath);
    });

    it('should fallback to original feedback when reviewReport returns undefined', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'format error' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'format error' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(undefined);

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test review undefined', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-1-review.md'))).toBe(false);

      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // SOL-003: 新模板使用 "上一次输出的格式问题" 章节
      expect(retryCallArg.prompt).toContain('上一次输出的格式问题');
    });
  });

  // ============================================================
  // SOL-002: 重试历史完整性（attempt + review + final）
  // ============================================================

  describe('SOL-002: retry history completeness', () => {
    it('should produce all expected files after 2 failures and final success', async () => {
      const reviewResult = makeReviewResult();

      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error 1' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'error 1' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-002', message: 'error 2' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-002', message: 'error 2' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(reviewResult);

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test history', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 期望文件列表：历史记录保留，最终报告已重命名
      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-1.md'))).toBe(true);
      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-1-review.md'))).toBe(true);
      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-2.md'))).toBe(true);
      expect(fs.existsSync(path.join(env.tempDir, 'report-attempt-2-review.md'))).toBe(true);
      // report-final.md 已被重命名为 investigation-{slug}.md
      expect(fs.existsSync(path.join(env.tempDir, 'report-final.md'))).toBe(false);
      // 最终报告存在
      expect(result.success).toBe(true);
      expect(fs.existsSync(result.reportPath!)).toBe(true);
    });
  });

  // ============================================================
  // SOL-001: formatReviewReport Markdown 内容验证
  // ============================================================

  describe('SOL-001: formatReviewReport markdown', () => {
    it('should include all critical and major suggestions grouped by severity (zh)', async () => {
      const reviewResult: ReviewResult = {
        pass: false,
        scores: { rootCauseAlignment: 10, solutionEffectiveness: 20, checkpointCompleteness: 30, factAccuracy: 85 },
        issues: [
          { dimension: 'rootCauseAlignment', severity: 'critical', description: 'desc1', suggestion: 'fix1' },
          { dimension: 'solutionEffectiveness', severity: 'critical', description: 'desc2', suggestion: 'fix2' },
          { dimension: 'checkpointCompleteness', severity: 'major', description: 'desc3', suggestion: 'fix3' },
          { dimension: 'rootCauseAlignment', severity: 'minor', description: 'desc4', suggestion: 'fix4' },
        ],
      };

      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'error' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(reviewResult);

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test severity zh', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const reviewContent = fs.readFileSync(path.join(env.tempDir, 'report-attempt-1-review.md'), 'utf-8');
      expect(reviewContent).toContain('[关键] fix1');
      expect(reviewContent).toContain('[关键] fix2');
      expect(reviewContent).toContain('[重要] fix3');
      // minor 不应出现在修正建议汇总中
      expect(reviewContent).not.toContain('[次要] fix4');
    });

    it('should include all critical and major suggestions grouped by severity (en)', async () => {
      const reviewResult: ReviewResult = {
        pass: false,
        scores: { rootCauseAlignment: 10, solutionEffectiveness: 20, checkpointCompleteness: 30, factAccuracy: 85 },
        issues: [
          { dimension: 'rootCauseAlignment', severity: 'critical', description: 'desc1', suggestion: 'fix1' },
          { dimension: 'checkpointCompleteness', severity: 'major', description: 'desc2', suggestion: 'fix2' },
        ],
      };

      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error' }],
          warnings: [],
          blockingErrors: [{ rule: 'R-001', message: 'error' }],
          warningErrors: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] });

      mockReviewReport.mockResolvedValue(reviewResult);

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('test severity en', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
        lang: 'en',
      });

      const reviewContent = fs.readFileSync(path.join(env.tempDir, 'report-attempt-1-review.md'), 'utf-8');
      expect(reviewContent).toContain('[Critical] fix1');
      expect(reviewContent).toContain('[Major] fix2');
    });
  });
});
