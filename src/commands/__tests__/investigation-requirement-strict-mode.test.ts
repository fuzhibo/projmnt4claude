/**
 * investigation-requirement strict mode integration test
 *
 * 覆盖 SOL-002: 验证 strict 模式下未替换占位符触发 fail-fast
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../utils/test-env.js';

// ============================================================
// Mock setup — 复制 investigation-requirement-sol.test.ts 的 mock 模式
// ============================================================

const mockCallAI = jest.fn<(...args: any[]) => any>();

jest.mock('../../utils/investigation/report-validator', () => ({
  validateReport: () => ({ valid: true, errors: [], warnings: [], blockingErrors: [], warningErrors: [] }),
  VALIDATION_RULES: [],
}));

jest.mock('../../utils/investigation/report-reviewer', () => ({
  reviewReport: () => ({ pass: true }),
}));

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
  killAllActiveChildren: jest.fn(),
}));

// 只 mock renderTemplate 部分 —— 替换 loader 的 loadAndRenderTemplate
const mockLoadAndRenderTemplate = jest.fn<(...args: any[]) => any>();
jest.mock('../../utils/prompt-templates/loader', () => ({
  loadAndRenderTemplate: (...args: unknown[]) => mockLoadAndRenderTemplate(...args),
  listTemplates: () => Promise.resolve(['investigate']),
  listInvestigationTemplatesSync: () => ['investigate'],
}));

describe('investigation-requirement strict mode integration', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    jest.clearAllMocks();
  });

  afterEach(() => {
    env.cleanup();
    jest.restoreAllMocks();
  });

  it('should fail fast when template has unreplaced placeholders in strict mode', async () => {
    mockLoadAndRenderTemplate.mockImplementation(() => {
      throw new Error('[renderTemplate] 未替换占位符: unreplacedKey');
    });

    const { investigationRequirement } = await import('../investigation-requirement');

    // generateInvestigationReport 无 try/catch，错误直接传播
    await expect(
      investigationRequirement('测试需求strict模式集成', env.tempDir, {
        nonInteractive: true,
        lang: 'zh',
        maxRetry: 1,
        splitThreshold: 100,
        templateMode: 'strict',
        quiet: true,
      }),
    ).rejects.toThrow(/未替换占位符|placeholder/i);

    // 验证 mode 参数为 strict
    const lastCall = mockLoadAndRenderTemplate.mock.calls[mockLoadAndRenderTemplate.mock.calls.length - 1];
    expect(lastCall?.[3]?.mode).toBe('strict');
  });

  it('should default to strict mode when templateMode not specified (SOL-002 design)', async () => {
    mockLoadAndRenderTemplate.mockResolvedValue('mock prompt');
    mockCallAI.mockResolvedValue({
      success: true,
      output: JSON.stringify({
        metadata: { requirementSource: 'test', investigationDate: new Date().toISOString(), investigationDir: 'investigation-test', language: 'zh' },
        rootCauseAnalysis: [{ id: 'CA-001', title: 'Test', description: 'Test' }],
        solutions: [{ id: 'SOL-001', title: 'Test', correspondsTo: 'CA-001', description: 'Test', files: ['test.ts'], expectedChanges: 'Test' }],
        checkpoints: [{ prefix: 'ai-qa', description: 'Test', belongsTo: 'SOL-001' }],
        assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
      }),
      durationMs: 100,
      provider: 'mock',
      tokensUsed: 10,
      model: 'mock',
    });

    const { investigationRequirement } = await import('../investigation-requirement');

    await investigationRequirement('测试需求默认模式', env.tempDir, {
      nonInteractive: true,
      lang: 'zh',
      maxRetry: 1,
      splitThreshold: 100,
      skipReview: true,
      quiet: true,
    });

    // SOL-002: 默认模式为 strict（从 lenient 升级，确保 fail-fast）
    const strictCalls = mockLoadAndRenderTemplate.mock.calls.filter(
      (call) => call[3]?.mode === 'strict',
    );
    expect(strictCalls.length).toBeGreaterThan(0);
  });

  it('should pass templateMode through CLI option', async () => {
    mockLoadAndRenderTemplate.mockResolvedValue('mock prompt');
    mockCallAI.mockResolvedValue({
      success: true,
      output: JSON.stringify({
        metadata: { requirementSource: 'test', investigationDate: new Date().toISOString(), investigationDir: 'investigation-test', language: 'zh' },
        rootCauseAnalysis: [{ id: 'CA-001', title: 'Test', description: 'Test' }],
        solutions: [{ id: 'SOL-001', title: 'Test', correspondsTo: 'CA-001', description: 'Test', files: ['test.ts'], expectedChanges: 'Test' }],
        checkpoints: [{ prefix: 'ai-qa', description: 'Test', belongsTo: 'SOL-001' }],
        assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
      }),
      durationMs: 100,
      provider: 'mock',
      tokensUsed: 10,
      model: 'mock',
    });

    const { investigationRequirement } = await import('../investigation-requirement');

    await investigationRequirement('测试需求auto-fill模式', env.tempDir, {
      nonInteractive: true,
      lang: 'zh',
      maxRetry: 1,
      splitThreshold: 100,
      templateMode: 'auto-fill',
      skipReview: true,
      quiet: true,
    });

    const autoFillCalls = mockLoadAndRenderTemplate.mock.calls.filter(
      (call) => call[3]?.mode === 'auto-fill',
    );
    expect(autoFillCalls.length).toBeGreaterThan(0);
  });
});
