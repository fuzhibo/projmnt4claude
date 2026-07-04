/**
 * Investigation 报告格式单元测试
 * 覆盖 §3.3 报告格式
 */

import { describe, it, expect } from '@jest/globals';

import type { InvestigationReport } from '../types.js';
import { generateReport } from '../report-generator.js';
import { parseReport, extractDependencies, extractDependenciesFromMarkdown } from '../report-parser.js';

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
      { prefix: 'ai-qa', description: 'Verify test', belongsTo: 'SOL-001' },
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
      { prefix: 'ai-qa', description: 'Verify solution 1 works', belongsTo: 'SOL-001' },
      { prefix: 'ai-qa', description: 'Test solution 1', belongsTo: 'SOL-001' },
      { prefix: 'ai-review', description: 'Review solution 2', belongsTo: 'SOL-002' },
      { prefix: 'ai-qa', description: 'Implement solution 2', belongsTo: 'SOL-002' },
      { prefix: 'script', description: 'Document changes', belongsTo: 'SOL-001' },
    ],
    assessment: {
      complexity: 'high',
      impactScope: '广泛',
      estimatedMinutes: 120,
    },
  };
}

describe('§3.3 报告格式', () => {
  describe('5 大章节', () => {
    it('should generate markdown with all 5 sections in zh', () => {
      const report = createTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('# 调查报告');
      expect(md).toContain('## 原因分析');
      expect(md).toContain('## 解决方案');
      expect(md).toContain('## 检查点覆盖清单');
      expect(md).toContain('## 评估');
    });

    it('should generate markdown with all 5 sections in en', () => {
      const report = createTestReport();
      const md = generateReport(report, 'en');
      expect(md).toContain('# Investigation Report');
      expect(md).toContain('## Root Cause Analysis');
      expect(md).toContain('## Solutions');
      expect(md).toContain('## Checkpoints');
      expect(md).toContain('## Assessment');
    });
  });

  describe('子报告引用依赖', () => {
    it('should render dependsOn in metadata', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('**依赖子报告**');
      expect(md).toContain('sub-01');
      expect(md).toContain('sub-02');
    });

    it('should render parentReport in metadata', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('**父报告**');
      expect(md).toContain('investigation-parent');
    });

    it('should extract dependencies from markdown', () => {
      const md = '- **依赖子报告**: sub-01, sub-02';
      const deps = extractDependenciesFromMarkdown(md);
      expect(deps).toEqual(['sub-01', 'sub-02']);
    });

    it('should extract dependencies from English markdown', () => {
      const md = '- **Depends On**: sub-01, sub-02';
      const deps = extractDependenciesFromMarkdown(md);
      expect(deps).toEqual(['sub-01', 'sub-02']);
    });

    it('should return empty array when no dependencies', () => {
      const md = '- **需求来源**: Test';
      const deps = extractDependenciesFromMarkdown(md);
      expect(deps).toEqual([]);
    });

    it('should extract dependencies from InvestigationReport structure', () => {
      const report = createFullTestReport();
      const deps = extractDependencies(report);
      expect(deps.get('investigation-full-test')).toEqual(['sub-01', 'sub-02']);
    });
  });

  describe('CA/SOL 编号对应', () => {
    it('should render CA and SOL with proper IDs', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('CA-001');
      expect(md).toContain('CA-002');
      expect(md).toContain('SOL-001');
      expect(md).toContain('SOL-002');
    });

    it('should render correspondsTo mapping', () => {
      const report = createTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('对应原因');
      expect(md).toContain('CA-001');
    });

    it('should parse CA/SOL mapping from markdown', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);
      expect(parsed.solutions[0].correspondsTo).toBe('CA-001');
      expect(parsed.solutions[1].correspondsTo).toBe('CA-002');
    });
  });

  describe('generator → parser roundtrip', () => {
    it('should roundtrip a full report correctly', () => {
      const original = createFullTestReport();
      const md = generateReport(original, 'zh');
      const parsed = parseReport(md);

      expect(parsed.metadata.requirementSource).toBe(original.metadata.requirementSource);
      expect(parsed.metadata.investigationDir).toBe(original.metadata.investigationDir);
      expect(parsed.rootCauseAnalysis).toHaveLength(2);
      expect(parsed.solutions).toHaveLength(2);
      expect(parsed.checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(parsed.assessment.complexity).toBe('high');
      expect(parsed.assessment.estimatedMinutes).toBe(120);
    });
  });
});
