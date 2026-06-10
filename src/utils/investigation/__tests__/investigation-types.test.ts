/**
 * Investigation 类型系统单元测试
 *
 * 覆盖 §3.1 类型系统 + §3.5 输出模式 + §3.6 AI 集成层
 */

import { describe, it, expect } from '@jest/globals';

import {
  PREFIX_MAP,
  type InvestigationReport,
  type RootCauseItem,
  type SolutionItem,
  type ReportCheckpoint,
  type ReportAssessment,
  type ReviewResult,
  type ReviewIssue,
  type SplitPlan,
  type SplitItem,
  type SplitReviewResult,
  type SplitReviewIssue,
  type OutputMode,
  type AICallOptions,
  type AICallResult,
  type CheckpointPrefix,
} from '../types.js';

// ============================================================
// Test helpers
// ============================================================

function createTestReport(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    metadata: {
      requirementSource: 'Test requirement',
      investigationDate: '2026-05-27T10:00:00.000Z',
      investigationDir: 'investigation-test',
      language: 'zh',
      ...overrides.metadata,
    },
    rootCauseAnalysis: [
      { id: 'CA-001', title: 'Test Cause', description: 'Test cause description' },
    ],
    solutions: [
      { id: 'SOL-001', title: 'Test Solution', correspondsTo: 'CA-001', description: 'Test solution description', files: ['src/test.ts'], expectedChanges: 'Add test code' },
    ],
    checkpoints: [
      { prefix: 'verify', description: 'Verify test', belongsTo: 'SOL-001' },
    ],
    assessment: {
      complexity: 'low',
      impactScope: '有限',
      estimatedMinutes: 30,
    },
    ...overrides,
  };
}

function createFullTestReport(): InvestigationReport {
  return {
    metadata: {
      requirementSource: 'Full test requirement',
      investigationDate: '2026-05-27T10:00:00.000Z',
      investigationDir: 'investigation-full-test',
      language: 'zh',
      parentReport: 'investigation-parent',
      dependsOn: ['sub-01', 'sub-02'],
    },
    rootCauseAnalysis: [
      { id: 'CA-001', title: 'Root cause 1', description: 'Description for CA-001' },
      { id: 'CA-002', title: 'Root cause 2', description: 'Description for CA-002' },
    ],
    solutions: [
      { id: 'SOL-001', title: 'Solution 1', correspondsTo: 'CA-001', description: 'Description for SOL-001', files: ['src/a.ts', 'src/b.ts'], expectedChanges: 'Modify a.ts and add b.ts' },
      { id: 'SOL-002', title: 'Solution 2', correspondsTo: 'CA-002', description: 'Description for SOL-002', files: ['src/c.ts'], expectedChanges: 'Add c.ts' },
    ],
    checkpoints: [
      { prefix: 'verify', description: 'Verify solution 1 works', belongsTo: 'SOL-001' },
      { prefix: 'test', description: 'Test solution 1', belongsTo: 'SOL-001' },
      { prefix: 'review', description: 'Review solution 2', belongsTo: 'SOL-002' },
      { prefix: 'implem', description: 'Implement solution 2', belongsTo: 'SOL-002' },
      { prefix: 'doc', description: 'Document changes', belongsTo: 'SOL-001' },
    ],
    assessment: {
      complexity: 'high',
      impactScope: '广泛',
      estimatedMinutes: 120,
    },
  };
}

// ============================================================
// §3.1 类型系统检查点
// ============================================================

describe('§3.1 类型系统', () => {
  describe('InvestigationReport 完整性', () => {
    it('should contain all required fields', () => {
      const report = createTestReport();
      expect(report).toHaveProperty('metadata');
      expect(report).toHaveProperty('rootCauseAnalysis');
      expect(report).toHaveProperty('solutions');
      expect(report).toHaveProperty('checkpoints');
      expect(report).toHaveProperty('assessment');
    });

    it('should have correct metadata fields', () => {
      const report = createTestReport();
      const m = report.metadata;
      expect(m).toHaveProperty('requirementSource');
      expect(m).toHaveProperty('investigationDate');
      expect(m).toHaveProperty('investigationDir');
      expect(m).toHaveProperty('language');
    });

    it('should support optional metadata fields: parentReport and dependsOn', () => {
      const report = createFullTestReport();
      expect(report.metadata.parentReport).toBe('investigation-parent');
      expect(report.metadata.dependsOn).toEqual(['sub-01', 'sub-02']);
    });

    it('should have RootCauseItem with id/title/description', () => {
      const ca: RootCauseItem = { id: 'CA-001', title: 'Test', description: 'Desc' };
      expect(ca.id).toBe('CA-001');
      expect(ca.title).toBe('Test');
      expect(ca.description).toBe('Desc');
    });

    it('should have SolutionItem with all required fields', () => {
      const sol: SolutionItem = {
        id: 'SOL-001', title: 'Test', correspondsTo: 'CA-001',
        description: 'Desc', files: ['src/a.ts'], expectedChanges: 'Changes',
      };
      expect(sol.correspondsTo).toBe('CA-001');
      expect(sol.files).toEqual(['src/a.ts']);
      expect(sol.expectedChanges).toBe('Changes');
    });

    it('should have ReportCheckpoint with prefix/description/belongsTo', () => {
      const cp: ReportCheckpoint = { prefix: 'verify', description: 'Test', belongsTo: 'SOL-001' };
      expect(cp.prefix).toBe('verify');
      expect(cp.belongsTo).toBe('SOL-001');
    });

    it('should have ReportAssessment with all fields', () => {
      const a: ReportAssessment = { complexity: 'medium', impactScope: '中等', estimatedMinutes: 60 };
      expect(a.complexity).toBe('medium');
      expect(a.impactScope).toBe('中等');
      expect(a.estimatedMinutes).toBe(60);
    });
  });

  describe('PREFIX_MAP 5 种前缀', () => {
    it('should contain all 5 prefixes', () => {
      const keys = Object.keys(PREFIX_MAP);
      expect(keys).toHaveLength(5);
      expect(keys).toContain('verify');
      expect(keys).toContain('test');
      expect(keys).toContain('review');
      expect(keys).toContain('implem');
      expect(keys).toContain('doc');
    });

    it('should have correct mapping for verify', () => {
      expect(PREFIX_MAP.verify).toEqual({
        category: 'qa_verification', method: 'functional_test', requiresHuman: false,
      });
    });

    it('should have correct mapping for test', () => {
      expect(PREFIX_MAP.test).toEqual({
        category: 'qa_verification', method: 'unit_test', requiresHuman: false,
      });
    });

    it('should have correct mapping for review', () => {
      expect(PREFIX_MAP.review).toEqual({
        category: 'code_review', method: 'code_review', requiresHuman: true,
      });
    });

    it('should have correct mapping for implem', () => {
      expect(PREFIX_MAP.implem).toEqual({
        category: 'implementation', method: 'automated', requiresHuman: false,
      });
    });

    it('should have correct mapping for doc', () => {
      expect(PREFIX_MAP.doc).toEqual({
        category: 'documentation', method: 'automated', requiresHuman: false,
      });
    });

    it('should have only review with requiresHuman=true', () => {
      const humanRequired = Object.entries(PREFIX_MAP)
        .filter(([, v]) => v.requiresHuman).map(([k]) => k);
      expect(humanRequired).toEqual(['review']);
    });
  });

  describe('ReviewResult 三维度评分', () => {
    it('should have pass/scores/issues fields', () => {
      const result: ReviewResult = {
        pass: true,
        scores: { rootCauseAlignment: 8, solutionEffectiveness: 7, checkpointCompleteness: 9 },
        issues: [],
      };
      expect(result.pass).toBe(true);
      expect(result.scores.rootCauseAlignment).toBe(8);
      expect(result.scores.solutionEffectiveness).toBe(7);
      expect(result.scores.checkpointCompleteness).toBe(9);
    });

    it('should have ReviewIssue with dimension/severity/description/suggestion', () => {
      const issue: ReviewIssue = {
        dimension: 'rootCauseAlignment', severity: 'critical',
        description: 'Root cause misaligned', suggestion: 'Re-analyze',
      };
      expect(issue.dimension).toBe('rootCauseAlignment');
      expect(issue.severity).toBe('critical');
    });

    it('should support all three dimensions in issues', () => {
      const dims: Array<ReviewIssue['dimension']> = [
        'rootCauseAlignment', 'solutionEffectiveness', 'checkpointCompleteness',
      ];
      expect(dims).toHaveLength(3);
    });
  });

  describe('SplitPlan/SplitReviewResult 六维度', () => {
    it('should have SplitPlan with items array', () => {
      const plan: SplitPlan = {
        items: [
          { title: 'Part 1', relationship: 'parallel', scope: 'Scope 1',
            description: 'Desc 1', estimatedSize: 10, dependsOn: [] },
        ],
      };
      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].relationship).toBe('parallel');
      expect(plan.items[0].estimatedSize).toBe(10);
    });

    it('should support hierarchical relationship', () => {
      const item: SplitItem = {
        title: 'Parent', relationship: 'hierarchical', scope: 'Full',
        description: 'Desc', estimatedSize: 20, dependsOn: [0],
      };
      expect(item.relationship).toBe('hierarchical');
      expect(item.dependsOn).toEqual([0]);
    });

    it('should have 6 score dimensions including antiPhaseSplitting', () => {
      const result: SplitReviewResult = {
        pass: true,
        scores: {
          coverage: 8, boundaryClarity: 7, independence: 9,
          dependencyReasonability: 8, antiPhaseSplitting: 10, granularity: 7,
        },
        issues: [],
      };
      expect(result.scores).toHaveProperty('antiPhaseSplitting');
      expect(result.scores.antiPhaseSplitting).toBe(10);
    });

    it('should support all 6 dimensions in SplitReviewIssue', () => {
      const dims: Array<SplitReviewIssue['dimension']> = [
        'coverage', 'boundaryClarity', 'independence',
        'dependencyReasonability', 'antiPhaseSplitting', 'granularity',
      ];
      expect(dims).toHaveLength(6);
    });
  });
});

// ============================================================
// §3.5 输出模式检查点
// ============================================================

describe('§3.5 输出模式', () => {
  it('should support dir output mode type', () => {
    const mode: OutputMode = { type: 'dir', path: '/output/dir' };
    expect(mode.type).toBe('dir');
    expect(mode.path).toBe('/output/dir');
  });

  it('should support file output mode type', () => {
    const mode: OutputMode = { type: 'file', path: '/output/report.md' };
    expect(mode.type).toBe('file');
    expect(mode.path).toBe('/output/report.md');
  });
});

// ============================================================
// §3.6 AI 集成层检查点
// ============================================================

describe('§3.6 AI 集成层', () => {
  it('should have AICallOptions with required fields', () => {
    const options: AICallOptions = {
      prompt: 'Test prompt',
      outputFormat: 'text',
      cwd: '/project',
    };
    expect(options.prompt).toBe('Test prompt');
    expect(options.outputFormat).toBe('text');
    expect(options.cwd).toBe('/project');
  });

  it('should support optional timeout and allowedTools', () => {
    const options: AICallOptions = {
      prompt: 'Test',
      outputFormat: 'json',
      timeout: 60,
      allowedTools: ['Read', 'Write'],
      cwd: '/project',
    };
    expect(options.timeout).toBe(60);
    expect(options.allowedTools).toEqual(['Read', 'Write']);
  });

  it('should have AICallResult with output/success/durationMs', () => {
    const result: AICallResult = {
      output: 'test output',
      success: true,
      durationMs: 100,
    };
    expect(result.output).toBe('test output');
    expect(result.success).toBe(true);
    expect(result.durationMs).toBe(100);
  });

  it('should include error field on failure', () => {
    const result: AICallResult = {
      output: '',
      success: false,
      durationMs: 50,
      error: 'Timeout',
    };
    expect(result.error).toBe('Timeout');
  });
});

export { createTestReport, createFullTestReport };