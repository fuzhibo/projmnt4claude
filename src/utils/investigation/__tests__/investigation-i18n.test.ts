/**
 * Investigation i18n 和接口契约单元测试
 *
 * 覆盖 §3.7 i18n 模板 + §3.8 接口契约
 */

import { describe, it, expect } from '@jest/globals';

import { PREFIX_MAP, type InvestigationReport } from '../types.js';
import { generateReport } from '../report-generator.js';
import { parseReport } from '../report-parser.js';
import { validateReport, VALIDATION_RULES } from '../report-validator.js';
import { loadTemplate, renderTemplate, loadAndRenderTemplate, listTemplates, listInvestigationTemplatesSync } from '../../prompt-templates/loader.js';

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
// §3.7 i18n 模板检查点
// ============================================================

describe('§3.7 i18n 模板', () => {
  describe('模板语言加载', () => {
    it('should load zh templates', async () => {
      const template = await loadTemplate('investigate', 'zh');
      expect(template).toBeTruthy();
      expect(typeof template).toBe('string');
    });

    it('should load en templates', async () => {
      const template = await loadTemplate('investigate', 'en');
      expect(template).toBeTruthy();
      expect(typeof template).toBe('string');
    });

    it('should throw for unsupported language', async () => {
      await expect(loadTemplate('investigate', 'fr' as any)).rejects.toThrow('Unsupported language');
    });

    it('should throw for unknown template name', async () => {
      await expect(loadTemplate('nonexistent' as any, 'zh')).rejects.toThrow('not found');
    });

    it('should list available templates for zh', async () => {
      const templates = await listTemplates('zh');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates).toContain('investigate');
    });

    it('should list available templates for en', async () => {
      const templates = await listTemplates('en');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates).toContain('investigate');
    });

    it('should have all 5 investigation templates', () => {
      const required = ['investigate', 'review', 'investigateWithFeedback', 'split', 'splitReview'];
      const zhTemplates = listInvestigationTemplatesSync('zh');
      for (const name of required) {
        expect(zhTemplates).toContain(name);
      }
    });
  });

  describe('占位符替换', () => {
    it('should replace placeholders in template', () => {
      const result = renderTemplate('Hello {name}, your task is {task}', {
        name: 'Claude',
        task: 'investigation',
      });
      expect(result).toBe('Hello Claude, your task is investigation');
    });

    it('should leave unmatched placeholders intact', () => {
      const result = renderTemplate('Hello {name}, {unknown}', { name: 'Claude' });
      expect(result).toBe('Hello Claude, {unknown}');
    });

    it('should loadAndRenderTemplate correctly', async () => {
      const result = await loadAndRenderTemplate('investigate', {
        requirement: 'Test requirement',
        context: 'Test project',
        splitThreshold: '30',
      }, 'zh');
      expect(result).toContain('Test requirement');
    });
  });

  describe('中英文参数一致性', () => {
    it('should have same template names in zh and en', () => {
      const zhTemplates = listInvestigationTemplatesSync('zh');
      const enTemplates = listInvestigationTemplatesSync('en');
      const coreTemplates = ['investigate', 'review', 'investigateWithFeedback', 'split', 'splitReview'];
      for (const name of coreTemplates) {
        expect(zhTemplates).toContain(name);
        expect(enTemplates).toContain(name);
      }
    });
  });
});

// ============================================================
// §3.8 接口契约检查点
// ============================================================

describe('§3.8 接口契约', () => {
  describe('validator 规则表两端一致', () => {
    it('should have consistent rule names', () => {
      const ruleNames = VALIDATION_RULES.map(r => r.name);
      expect(ruleNames).toContain('metadata-required');
      expect(ruleNames).toContain('root-cause-non-empty');
      expect(ruleNames).toContain('solution-non-empty');
      expect(ruleNames).toContain('ca-sol-correspondence');
      expect(ruleNames).toContain('checkpoint-prefix');
      expect(ruleNames).toContain('checkpoint-belongsto');
      expect(ruleNames).toContain('assessment-required');
      expect(ruleNames).toContain('id-format');
    });

    it('should have both investigationAction and initAction for each rule', () => {
      for (const rule of VALIDATION_RULES) {
        expect(rule).toHaveProperty('investigationAction');
        expect(rule).toHaveProperty('initAction');
        expect(['block', 'warn']).toContain(rule.investigationAction);
        expect(['block', 'warn']).toContain(rule.initAction);
      }
    });

    it('should have block action for critical rules', () => {
      const blockRules = VALIDATION_RULES.filter(r => r.investigationAction === 'block');
      expect(blockRules.length).toBeGreaterThan(0);
      expect(blockRules.map(r => r.name)).toContain('metadata-required');
      expect(blockRules.map(r => r.name)).toContain('root-cause-non-empty');
    });

    it('should produce errors for block rules', () => {
      const emptyCaReport = createTestReport({ rootCauseAnalysis: [] });
      const result = validateReport(emptyCaReport);
      expect(result.errors.some(e => e.rule === 'root-cause-non-empty')).toBe(true);
    });

    it('should produce warnings for warn rules', () => {
      const badFormatReport = createTestReport({
        rootCauseAnalysis: [{ id: 'CA-1', title: 'Bad format', description: 'Desc' }],
      });
      const result = validateReport(badFormatReport);
      expect(result.warnings.some(w => w.rule === 'id-format')).toBe(true);
    });
  });

  describe('PREFIX_MAP 两端一致', () => {
    it('should have consistent prefixes', () => {
      const prefixMapKeys = new Set(Object.keys(PREFIX_MAP));
      const validatorPrefixes = new Set(['verify', 'test', 'review', 'implem', 'doc']);
      expect(prefixMapKeys).toEqual(validatorPrefixes);
    });

    it('should use PREFIX_MAP in validator', () => {
      const validReport = createTestReport({
        checkpoints: [
          { prefix: 'verify', description: 'Verify', belongsTo: 'SOL-001' },
          { prefix: 'test', description: 'Test', belongsTo: 'SOL-001' },
          { prefix: 'review', description: 'Review', belongsTo: 'SOL-001' },
          { prefix: 'implem', description: 'Implement', belongsTo: 'SOL-001' },
          { prefix: 'doc', description: 'Document', belongsTo: 'SOL-001' },
        ],
      });
      const result = validateReport(validReport);
      const prefixWarnings = result.warnings.filter(w => w.rule === 'checkpoint-prefix');
      expect(prefixWarnings).toHaveLength(0);
    });
  });

  describe('InvestigationReport 作为正式接口', () => {
    it('should work across all modules', () => {
      const report = createFullTestReport();
      const md = generateReport(report);
      expect(md).toBeTruthy();

      const parsed = parseReport(md);
      expect(parsed.metadata).toBeDefined();

      const validationResult = validateReport(parsed);
      expect(validationResult.valid).toBe(true);
    });

    it('should maintain field compatibility', () => {
      const original = createFullTestReport();
      const md = generateReport(original, 'zh');
      const parsed = parseReport(md);
      const validationResult = validateReport(parsed);

      expect(validationResult.valid).toBe(true);
      expect(parsed.metadata.requirementSource).toBe(original.metadata.requirementSource);
      expect(parsed.rootCauseAnalysis.length).toBe(original.rootCauseAnalysis.length);
      expect(parsed.solutions.length).toBe(original.solutions.length);
    });
  });
});
