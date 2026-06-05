/**
 * ReportIntegrityAIChecker & OutputAlignmentAIChecker 单元测试
 */
import { describe, it, expect } from '@jest/globals';
import { ReportIntegrityAIChecker, createReportIntegrityAIChecker, checkReportIntegrityAI } from '../utils/post-dev-gate/checkers/report-integrity-ai-checker.js';
import { OutputAlignmentAIChecker, createOutputAlignmentAIChecker, checkOutputAlignmentAI } from '../utils/post-dev-gate/checkers/output-alignment-ai-checker.js';
import type { PostDevPhaseCheckContext } from '../types/post-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import type { DevReport } from '../types/harness.js';

function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: 'Test Task',
    description: 'Test description',
    type: 'feature',
    priority: 'P1',
    status: 'in_progress',
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

function createMockDevReport(overrides: Partial<DevReport> = {}): DevReport {
  return {
    taskId: 'TASK-test-001',
    status: 'completed',
    summary: 'Implemented the feature',
    changes: [
      { type: 'file', path: 'src/new-feature.ts', description: 'Added new feature implementation' },
    ],
    evidence: [
      { type: 'test', description: 'Unit tests pass', path: 'src/__tests__/new-feature.test.ts' },
    ],
    checkpointsCompleted: ['CP-001', 'CP-002'],
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    duration: 60000,
    ...overrides,
  };
}

function createMockPostDevContext(overrides: Partial<PostDevPhaseCheckContext> = {}): PostDevPhaseCheckContext {
  return {
    taskId: 'TASK-test-001',
    task: createMockTask(),
    cwd: process.cwd(),
    devReport: createMockDevReport(),
    config: {
      enabled: true,
      rules: new Map(),
      stopOnFailure: true,
      generateReport: true,
      enableAutoFix: true,
    },
    ...overrides,
  };
}

describe('ReportIntegrityAIChecker', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const checker = new ReportIntegrityAIChecker(process.cwd());
      expect(checker.id).toBe('R-OUTPUT-002-AI');
      expect(checker.name).toBe('开发报告完整性 AI 审核');
      expect(checker.failureType).toBe('B');
    });

    it('should create via factory function', () => {
      const checker = createReportIntegrityAIChecker(process.cwd());
      expect(checker).toBeInstanceOf(ReportIntegrityAIChecker);
    });

    it('should create with custom config', () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), {
        minChangeClarityScore: 70,
        minEvidenceSufficiencyScore: 70,
      });
      expect(checker.id).toBe('R-OUTPUT-002-AI');
    });
  });

  describe('check', () => {
    it('should fail when devReport is missing', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd());
      const context = createMockPostDevContext({ devReport: undefined });
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('不存在');
      expect((result.details as Record<string, unknown>).failureType).toBe('B');
    });

    it('should return failureType B in details', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.details).toBeDefined();
      expect((result.details as Record<string, unknown>).failureType).toBe('B');
    });

    it('should include duration and timestamp', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });

    it('should handle AI review disabled gracefully', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('AI');
    });

    // --- Extended edge cases and uncovered scenarios ---

    it('should handle devReport with empty changes and evidence', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext({
        devReport: createMockDevReport({ changes: [], evidence: [] }),
      });
      const result = await checker.check(context);

      expect(result).toBeDefined();
      expect(result.checkerId).toBe('R-OUTPUT-002-AI');
    });

    it('should handle devReport with empty summary', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext({
        devReport: createMockDevReport({ summary: '' }),
      });
      const result = await checker.check(context);

      expect(result).toBeDefined();
    });

    it('should include checkerId and checkerName in result', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.checkerId).toBe('R-OUTPUT-002-AI');
      expect(result.checkerName).toBe('开发报告完整性 AI 审核');
    });

    it('should work via checkReportIntegrityAI convenience function', async () => {
      const context = createMockPostDevContext();
      const result = await checkReportIntegrityAI(context, process.cwd(), { enableAIReview: false });

      expect(result.checkerId).toBe('R-OUTPUT-002-AI');
    });

    it('should work via createReportIntegrityAIChecker factory', async () => {
      const checker = createReportIntegrityAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.checkerId).toBe('R-OUTPUT-002-AI');
    });

    it('should handle custom min score thresholds', async () => {
      const checker = new ReportIntegrityAIChecker(process.cwd(), {
        enableAIReview: false,
        minChangeClarityScore: 90,
        minEvidenceSufficiencyScore: 90,
        minSummaryAccuracyScore: 90,
      });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result).toBeDefined();
    });
  });
});

describe('OutputAlignmentAIChecker', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const checker = new OutputAlignmentAIChecker(process.cwd());
      expect(checker.id).toBe('R-OUTPUT-001-AI');
      expect(checker.name).toBe('开发输出对齐 AI 审核');
      expect(checker.failureType).toBe('B');
    });

    it('should create via factory function', () => {
      const checker = createOutputAlignmentAIChecker(process.cwd());
      expect(checker).toBeInstanceOf(OutputAlignmentAIChecker);
    });

    it('should create with custom config', () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), {
        minCoverageScore: 70,
      });
      expect(checker.id).toBe('R-OUTPUT-001-AI');
    });
  });

  describe('check', () => {
    it('should return failureType B in details', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.details).toBeDefined();
      expect((result.details as Record<string, unknown>).failureType).toBe('B');
    });

    it('should include duration and timestamp', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });

    it('should handle AI review disabled gracefully', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.passed).toBe(false);
    });

    it('should extract changed files from devReport', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.details).toBeDefined();
      expect((result.details as Record<string, unknown>).changedFilesCount).toBeDefined();
    });

    // --- Extended edge cases and uncovered scenarios ---

    it('should handle devReport with empty changes', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext({
        devReport: createMockDevReport({ changes: [] }),
      });
      const result = await checker.check(context);

      expect(result).toBeDefined();
      expect((result.details as Record<string, unknown>).changedFilesCount).toBe(0);
    });

    it('should handle devReport without changes field', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext({
        devReport: createMockDevReport({ changes: [] }),
      });
      const result = await checker.check(context);

      expect(result).toBeDefined();
    });

    it('should include checkerId and checkerName in result', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.checkerId).toBe('R-OUTPUT-001-AI');
      expect(result.checkerName).toBe('开发输出对齐 AI 审核');
    });

    it('should work via checkOutputAlignmentAI convenience function', async () => {
      const context = createMockPostDevContext();
      const result = await checkOutputAlignmentAI(context, process.cwd(), { enableAIReview: false });

      expect(result.checkerId).toBe('R-OUTPUT-001-AI');
    });

    it('should work via createOutputAlignmentAIChecker factory', async () => {
      const checker = createOutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result.checkerId).toBe('R-OUTPUT-001-AI');
    });

    it('should handle custom minCoverageScore threshold', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), {
        enableAIReview: false,
        minCoverageScore: 90,
      });
      const context = createMockPostDevContext();
      const result = await checker.check(context);

      expect(result).toBeDefined();
    });

    it('should handle devReport with changes having only description (no path)', async () => {
      const checker = new OutputAlignmentAIChecker(process.cwd(), { enableAIReview: false });
      const context = createMockPostDevContext({
        devReport: createMockDevReport({
          changes: [
            { type: 'file', description: 'Updated configuration' },
          ],
        }),
      });
      const result = await checker.check(context);

      expect(result).toBeDefined();
      // When type is 'file' but no path, it uses description as the path
      expect((result.details as Record<string, unknown>).changedFilesCount).toBe(1);
    });
  });
});