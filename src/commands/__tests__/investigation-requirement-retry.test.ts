/**
 * investigation-requirement 重试逻辑单元测试
 *
 * 验证 §4.2 重试循环 + 回退机制，对应检查点 CP-1 至 CP-5
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../utils/test-env.js';

// ============================================================
// Mock setup
// ============================================================

const mockGenerateReport = jest.fn();
const mockWriteReport = jest.fn();
const mockValidateReport = jest.fn();
const mockReviewWithRetry = jest.fn();

// 需要 mock 的模块必须在 import 之前声明
jest.mock('../../utils/investigation/report-generator', () => ({
  generateReport: (report: unknown) => JSON.stringify(report),
}));

jest.mock('../../utils/investigation/report-validator', () => ({
  validateReport: (...args: unknown[]) => mockValidateReport(...args),
  VALIDATION_RULES: [],
}));

jest.mock('../../utils/investigation/report-reviewer', () => ({
  reviewWithRetry: (...args: unknown[]) => mockReviewWithRetry(...args),
}));

// mock generateInvestigationReport 内部使用（通过 callAI mock）
const mockCallAI = jest.fn();
jest.mock('../../utils/investigation/ai-integration', () => ({
  callAI: (...args: unknown[]) => mockCallAI(...args),
  callAIForJSON: (...args: unknown[]) => mockCallAI(...args),
}));

// mock 完整路径
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
}));

jest.mock('../../utils/investigation/report-parser', () => ({
  parseReport: (input: string) => JSON.parse(input),
}));

// ============================================================
// Helpers
// ============================================================

function makeValidReport() {
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

// ============================================================
// Tests
// ============================================================

describe('investigation-requirement retry logic', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    jest.clearAllMocks();

    // 默认 mock
    mockReviewWithRetry.mockResolvedValue({
      review: { pass: true, issues: [], scores: { rootCauseAlignment: 3, solutionEffectiveness: 3, checkpointCompleteness: 3 } },
    });

    mockWriteReport.mockResolvedValue('/tmp/report.md');

    // mock callAI 返回有效报告的 JSON
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

  describe('CP-1: while loop structure', () => {
    it('should retry in a loop until validation passes', async () => {
      // 循环内：第一次失败、第二次成功；最终验证再调用一次
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'test', message: 'first error' }],
          warnings: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test loop', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 循环内 2 次 + 最终验证 1 次 = 3 次
      expect(mockValidateReport).toHaveBeenCalledTimes(3);
      expect(mockCallAI).toHaveBeenCalledTimes(2); // initial + 1 retry
      expect(result.success).toBe(true);
    });

    it('should stop retrying after maxRetry attempts', async () => {
      // 每次验证都失败
      mockValidateReport.mockReturnValue({
        valid: false,
        errors: [{ rule: 'test', message: 'always fails' }],
        warnings: [],
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test max', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 循环内 2 次 + 最终验证 1 次 = 3 次
      expect(mockValidateReport).toHaveBeenCalledTimes(3);
      // 初始生成 + 2 次重试 = 3 次 callAI
      expect(mockCallAI).toHaveBeenCalledTimes(3);
    });
  });

  describe('CP-4: maxRetry=1 exits normally', () => {
    it('should complete with maxRetry=1 when validation passes', async () => {
      mockValidateReport.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test maxRetry=1', env.tempDir, {
        quiet: true,
        maxRetry: 1,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      expect(result.success).toBe(true);
      expect(mockCallAI).toHaveBeenCalledTimes(1);
    });
  });

  describe('CP-5: maxRetry=0 no retries', () => {
    it('should skip retry loop when maxRetry=0', async () => {
      // maxRetry=0 → while 条件 retryCount < 0 不成立，直接跳到最终验证
      mockValidateReport.mockReturnValue({
        valid: false,
        errors: [{ rule: 'test', message: 'not retried' }],
        warnings: [],
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test maxRetry=0', env.tempDir, {
        quiet: true,
        maxRetry: 0,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // while 循环未进入，但最终验证会执行
      // validateReport 被调用 1 次（仅最终验证）
      expect(mockValidateReport).toHaveBeenCalledTimes(1);
      // callAI 被调用 1 次（仅初始生成）
      expect(mockCallAI).toHaveBeenCalledTimes(1);
    });
  });

  describe('CP-3: fallback mechanism', () => {
    it('should use last valid report on regeneration failure', async () => {
      // 第一次验证失败 → 触发重试
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'test', message: 'first error' }],
          warnings: [],
        });

      // 第一次 callAI 返回报告（作为回退）
      mockCallAI
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(makeValidReport()),
          durationMs: 100,
          provider: 'mock',
          tokensUsed: 10,
          model: 'mock',
        });

      // 第二次 callAI（重试）抛错
      mockCallAI.mockRejectedValueOnce(new Error('Retry failed'));

      // 最终验证使用回退报告 → valid: true
      mockValidateReport.mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test fallback', env.tempDir, {
        quiet: true,
        maxRetry: 1,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 回退成功，报告沿用第一次有效报告
      expect(result.success).toBe(true);
    });

    it('should exhaust retries then proceed when validation keeps failing', async () => {
      // 所有验证都失败，包括最终验证
      mockValidateReport.mockReturnValue({
        valid: false,
        errors: [{ rule: 'test', message: 'always fails' }],
        warnings: [],
      });

      // 每次 AI 调用返回有效报告
      mockCallAI.mockResolvedValue({
        success: true,
        output: JSON.stringify(makeValidReport()),
        durationMs: 100,
        provider: 'mock',
        tokensUsed: 10,
        model: 'mock',
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test exhaust', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 最终验证不阻断流程
      expect(result.success).toBe(true);
      // 循环内 2 次 + 最终 1 次 = 3 次验证
      expect(mockValidateReport).toHaveBeenCalledTimes(3);
      // 初始 + 2 次重试 = 3 次 callAI
      expect(mockCallAI).toHaveBeenCalledTimes(3);
    });
  });

  describe('final validation warning (post-loop)', () => {
    it('should log warning but not block when final validation fails', async () => {
      mockValidateReport.mockReturnValue({
        valid: false,
        errors: [{ rule: 'test', message: 'minor issue' }],
        warnings: [],
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('test final warn', env.tempDir, {
        quiet: true,
        maxRetry: 2,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 最终验证不阻断流程
      expect(result.success).toBe(true);
    });
  });

  describe('CP-6: error injection into regeneration requirement', () => {
    it('should inject format errors into the regeneration prompt', async () => {
      // 第一次验证失败（带特定错误信息），第二次成功
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [
            { rule: 'R-META-001', message: 'metadata.requirementSource 缺失或为空' },
            { rule: 'R-CP-001', message: 'checkpoints 为空，至少需要 1 个检查点' },
          ],
          warnings: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('original requirement text', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // 第二次 callAI（重试）的 options.prompt 应包含原始需求 + 格式修正提示
      expect(mockCallAI).toHaveBeenCalledTimes(2);
      const retryCallArg = mockCallAI.mock.calls[1][0] as { prompt: string };
      expect(retryCallArg.prompt).toContain('original requirement text');
      expect(retryCallArg.prompt).toContain('Format correction needed');
      expect(retryCallArg.prompt).toContain('metadata.requirementSource 缺失或为空');
      expect(retryCallArg.prompt).toContain('checkpoints 为空，至少需要 1 个检查点');
    });
  });

  describe('initial generation failure (no fallback path)', () => {
    it('should propagate error when initial generateInvestigationReport throws', async () => {
      // 初始 callAI 抛错，此时 lastValidReport=null，应直接抛出
      mockCallAI.mockReset();
      mockCallAI.mockRejectedValueOnce(new Error('Initial generation failed: Process exited with code 1'));

      const { investigationRequirement } = await import('../investigation-requirement');

      await expect(
        investigationRequirement('test initial fail', env.tempDir, {
          quiet: true,
          maxRetry: 3,
          skipReview: true,
          skipSplit: true,
          outputDir: env.tempDir,
        }),
      ).rejects.toThrow('Initial generation failed: Process exited with code 1');

      // 由于初始生成就失败，不应进入重试循环
      expect(mockCallAI).toHaveBeenCalledTimes(1);
      // validateReport 不应被调用（循环未进入）
      expect(mockValidateReport).not.toHaveBeenCalled();
    });
  });
});
