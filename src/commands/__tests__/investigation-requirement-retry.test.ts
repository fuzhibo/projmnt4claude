/**
 * investigation-requirement 重试逻辑单元测试
 *
 * 验证 §4.2 重试循环 + 回退机制，对应检查点 CP-1 至 CP-5
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../utils/test-env.js';
import type { InvestigationReport } from '../../utils/investigation/types.js';

// ============================================================
// Mock setup
// ============================================================

const mockGenerateReport = jest.fn<(...args: any[]) => any>();
const mockWriteReport = jest.fn<(...args: any[]) => any>();
const mockValidateReport = jest.fn<(...args: any[]) => any>();
const mockReviewWithRetry = jest.fn<(...args: any[]) => any>();
const mockKillAllActiveChildren = jest.fn<(...args: any[]) => any>();

// 需要 mock 的模块必须在 import 之前声明
jest.mock('../../utils/investigation/report-generator', () => ({
  generateReport: (report: unknown) => JSON.stringify(report),
}));

jest.mock('../../utils/investigation/report-validator', () => ({
  validateReport: (...args: unknown[]) => mockValidateReport(...args),
  VALIDATION_RULES: [],
}));

jest.mock('../../utils/investigation/report-reviewer', () => ({
  reviewReportWithRetry: (...args: unknown[]) => mockReviewWithRetry(...args),
}));

// mock generateInvestigationReport 内部使用（通过 callAI mock）
const mockCallAI = jest.fn<(...args: any[]) => any>();
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
      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      expect(retryCallArg.prompt).toContain('original requirement text');
      // SOL-003: 新模板使用 "上一次输出的格式问题" 章节替代旧 "格式纠正要求"
      expect(retryCallArg.prompt).toContain('上一次输出的格式问题');
      expect(retryCallArg.prompt).toContain('[R-META-001] metadata.requirementSource 缺失或为空');
      expect(retryCallArg.prompt).toContain('[R-CP-001] checkpoints 为空，至少需要 1 个检查点');
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

  // ============================================================
  // CA-003: 重试超时保护与清理
  // ============================================================

  describe('CA-003-4: child cleanup before retry', () => {
    it('should call killAllActiveChildren before each retry attempt', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-META-001', message: 'metadata.requirementSource 缺失或为空' }],
          warnings: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('cleanup test', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      expect(mockKillAllActiveChildren).toHaveBeenCalledTimes(1);
      expect(mockKillAllActiveChildren).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('CA-003-3: structured retry prompt', () => {
    it('should produce prompt containing format issues section and structured error list', async () => {
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

      await investigationRequirement('structured prompt test', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // SOL-003: 新模板使用 "上一次输出的格式问题" 章节标题
      expect(retryCallArg.prompt).toContain('上一次输出的格式问题');
      // SOL-003: 错误项带 rule 标识 [R-XXX]
      expect(retryCallArg.prompt).toContain('[R-META-001] metadata.requirementSource 缺失或为空');
      expect(retryCallArg.prompt).toContain('[R-CP-001] checkpoints 为空，至少需要 1 个检查点');
      // SOL-003: 必须包含完整格式示例（契约章节）
      expect(retryCallArg.prompt).toContain('## 元数据');
      expect(retryCallArg.prompt).toContain('## 原因分析');
      expect(retryCallArg.prompt).toContain('## 解决方案');
    });

    it('should truncate feedback to MAX_RETRY_FEEDBACK_LEN (500 chars)', async () => {
      const longMessage = 'X'.repeat(800);
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-LONG', message: longMessage }],
          warnings: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('trunc test', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      // 长消息应被截断到 500 字符
      expect(retryCallArg.prompt).not.toContain('X'.repeat(800));
      expect(retryCallArg.prompt).toMatch(/X{400,500}/);
    });

    // SOL-001: 验证重试提示词中格式示例的占位符已被替换
    it('should replace all placeholders in format example within retry prompt', async () => {
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-PLACEHOLDER', message: '格式验证失败' }],
          warnings: [],
        })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] })
        .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

      const { investigationRequirement } = await import('../investigation-requirement');

      const requirement = 'SOL-001 占位符替换测试需求';
      await investigationRequirement(requirement, env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: true,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      const retryCallArg = mockCallAI.mock.calls[1]![0] as { prompt: string };
      const prompt = retryCallArg.prompt;

      // 通用占位符必须已被替换（不能出现在 prompt 中）
      expect(prompt).not.toContain('{title}');
      expect(prompt).not.toContain('{requirement}');
      expect(prompt).not.toContain('{date}');
      expect(prompt).not.toContain('{slug}');
      expect(prompt).not.toContain('{N}');
      expect(prompt).not.toContain('{low|medium|high}');

      // 中文示例占位符必须已被替换
      expect(prompt).not.toContain('{原因标题}');
      expect(prompt).not.toContain('{原因详细描述}');
      expect(prompt).not.toContain('{方案标题}');
      expect(prompt).not.toContain('{方案详细描述}');
      expect(prompt).not.toContain('{变更描述}');
      expect(prompt).not.toContain('{有限|中等|广泛}');

      // 英文示例占位符必须已被替换
      expect(prompt).not.toContain('{Root cause title}');
      expect(prompt).not.toContain('{Root cause detailed description}');
      expect(prompt).not.toContain('{Solution title}');
      expect(prompt).not.toContain('{Solution detailed description}');
      expect(prompt).not.toContain('{Change description}');
      expect(prompt).not.toContain('{limited|moderate|extensive}');

      // 验证实际值已嵌入（反向确认替换成功）
      expect(prompt).toContain('SOL-001 占位符替换测试需求'); // {requirement} 替换值
      expect(prompt).toContain('investigation-sol-001-占位符替换测试需求'); // {slug}
      expect(prompt).toContain('60 分钟'); // {N} 替换值
      expect(prompt).toContain('示例原因标题'); // 中文示例占位符替换值
      expect(prompt).toContain('示例方案标题'); // 中文示例占位符替换值
    });

    // SOL-001 验证方法 1: 直接调用 buildRetryPrompt 的单元测试
    it('buildRetryPrompt should replace all placeholders in format example (direct unit test)', async () => {
      const { buildRetryPrompt } = await import('../investigation-requirement');
      const requirement = '测试需求描述';
      const errors = [{ rule: 'metadata-required', message: 'metadata.requirementSource 缺失' }];
      const attemptNum = 1;
      const lang = 'zh';

      const retryPrompt = buildRetryPrompt({
        requirement,
        errors,
        attemptNum,
        lang,
      });

      // 验证格式示例中的通用占位符已被替换
      expect(retryPrompt).not.toContain('{title}');
      expect(retryPrompt).not.toContain('{date}');
      expect(retryPrompt).not.toContain('{slug}');
      expect(retryPrompt).not.toContain('{N}');
      // 中文示例占位符已被替换
      expect(retryPrompt).not.toContain('{原因标题}');
      expect(retryPrompt).not.toContain('{方案标题}');
      // 复杂度占位符已被替换
      expect(retryPrompt).not.toContain('{low|medium|high}');

      // 验证实际值已嵌入
      expect(retryPrompt).toContain('测试需求描述');
      expect(retryPrompt).toContain('investigation-');
    });

    // SOL-001 验证方法 1 (英文分支): 直接调用 buildRetryPrompt 的单元测试
    it('buildRetryPrompt should replace all English placeholders in format example (en)', async () => {
      const { buildRetryPrompt } = await import('../investigation-requirement');
      const requirement = 'Test requirement description';
      const errors = [{ rule: 'metadata-required', message: 'metadata.requirementSource missing' }];
      const attemptNum = 1;
      const lang = 'en';

      const retryPrompt = buildRetryPrompt({
        requirement,
        errors,
        attemptNum,
        lang,
      });

      // 英文占位符已被替换
      expect(retryPrompt).not.toContain('{title}');
      expect(retryPrompt).not.toContain('{Root cause title}');
      expect(retryPrompt).not.toContain('{Solution title}');
      expect(retryPrompt).not.toContain('{limited|moderate|extensive}');

      // 实际值已嵌入
      expect(retryPrompt).toContain('Test requirement description');
      expect(retryPrompt).toContain('Sample solution title');
    });
  });

  // ============================================================
  // Phase 2 检查点：评审失败不重新生成报告
  // ============================================================

  describe('REDESIGN-001: reviewReportWithRetry does not regenerate', () => {
    it('should not call callAI when review fails (no regeneration)', async () => {
      // 评审失败，但 reviewReportWithRetry 不应重新生成报告
      mockReviewWithRetry.mockResolvedValue({
        report: makeValidReport(),
        review: {
          pass: false,
          issues: [{ severity: 'error', message: 'Test review failure' }],
          scores: { rootCauseAlignment: 1, solutionEffectiveness: 1, checkpointCompleteness: 1 },
        },
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('review no regen test', env.tempDir, {
        quiet: true,
        maxRetry: 1,
        skipReview: false,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // callAI 调用次数：初始生成 1 次 + 评审 1 次（reviewReport 使用 callAIForJSON）= 2 次
      // 关键验证：评审失败后没有额外的重新生成调用
      expect(mockCallAI.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('should complete successfully when review passes', async () => {
      mockReviewWithRetry.mockResolvedValue({
        report: makeValidReport(),
        review: {
          pass: true,
          issues: [],
          scores: { rootCauseAlignment: 3, solutionEffectiveness: 3, checkpointCompleteness: 3 },
        },
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      const result = await investigationRequirement('review pass test', env.tempDir, {
        quiet: true,
        maxRetry: 1,
        skipReview: false,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      expect(result.success).toBe(true);
      // callAI 调用次数：初始生成 1 次 + 评审 1 次 = 2 次
      expect(mockCallAI.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================
  // Phase 2 检查点：spawn 次数控制在 5 次以内
  // ============================================================

  describe('REDESIGN-001: spawn count limit', () => {
    it('should limit total callAI calls to <= 5 in worst case', async () => {
      // 最坏情况：验证失败 maxRetry 次 + 评审 + 重试
      mockValidateReport
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-001', message: 'error 1' }],
          warnings: [],
        })
        .mockReturnValueOnce({
          valid: false,
          errors: [{ rule: 'R-002', message: 'error 2' }],
          warnings: [],
        })
        .mockReturnValueOnce({
          valid: true,
          errors: [],
          warnings: [],
        })
        .mockReturnValueOnce({
          valid: true,
          errors: [],
          warnings: [],
        });

      mockReviewWithRetry.mockResolvedValue({
        report: makeValidReport(),
        review: {
          pass: true,
          issues: [],
          scores: { rootCauseAlignment: 3, solutionEffectiveness: 3, checkpointCompleteness: 3 },
        },
      });

      const { investigationRequirement } = await import('../investigation-requirement');

      await investigationRequirement('spawn count test', env.tempDir, {
        quiet: true,
        maxRetry: 3,
        skipReview: false,
        skipSplit: true,
        outputDir: env.tempDir,
      });

      // callAI 调用次数：初始 1 + 重试 2 + 评审 0（reviewReportWithRetry 不调用 callAI）= 3
      // 确保不超过 5 次
      expect(mockCallAI.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });

  // ============================================================
  // Phase 3 检查点：深度超限返回用户提示
  // ============================================================

  describe('REDESIGN-001: depth limit user feedback', () => {
    it('should return needsFurtherSplit when max depth reached', async () => {
      // 跳过评审和拆分，直接测试深度控制
      const { runSplitFlow } = await import('../investigation-requirement');

      const mockReport = makeValidReport();
      const result = await runSplitFlow(mockReport, 'test requirement', env.tempDir, {
        lang: 'zh',
        maxRetry: 1,
        splitThreshold: 100,
        outputDir: env.tempDir,
        quiet: true,
        depth: 3, // 达到 MAX_SPLIT_DEPTH
      });

      expect(result.needsFurtherSplit).toBe(true);
      expect(result.furtherSplitCandidates).toBeDefined();
      expect(result.furtherSplitCandidates!.length).toBeGreaterThan(0);
    });
  });
});
