/**
 * 模板-解析器共享契约一致性测试 (SOL-001)
 *
 * 验证契约常量值、构建函数、以及模板/解析器对契约的正确引用。
 */

import { describe, it, expect } from '@jest/globals';
import {
  REPORT_SECTIONS,
  METADATA_FIELDS,
  SOLUTION_FIELDS,
  ASSESSMENT_FIELDS,
  CA_PREFIX,
  SOL_PREFIX,
  CA_FORMAT,
  SOL_FORMAT,
  buildCaId,
  buildSolId,
  buildCaHeadingRegex,
  buildSolHeadingRegex,
} from '../report-contract.js';
import { investigationTemplates as zhTemplates } from '../../prompt-templates/i18n/zh.js';
import { investigationTemplates as enTemplates } from '../../prompt-templates/i18n/en.js';

describe('SOL-001 Report Contract', () => {
  describe('Section Titles', () => {
    it('should define all required sections with zh/en pair', () => {
      expect(REPORT_SECTIONS.metadata).toEqual({ zh: '元数据', en: 'Metadata' });
      expect(REPORT_SECTIONS.rootCauseAnalysis).toEqual({ zh: '原因分析', en: 'Root Cause Analysis' });
      expect(REPORT_SECTIONS.solutions).toEqual({ zh: '解决方案', en: 'Solutions' });
      expect(REPORT_SECTIONS.checkpoints).toEqual({ zh: '检查点覆盖清单', en: 'Checkpoint Checklist' });
      expect(REPORT_SECTIONS.assessment).toEqual({ zh: '评估', en: 'Assessment' });
    });
  });

  describe('Numbering Format', () => {
    it('should have correct prefix constants', () => {
      expect(CA_PREFIX).toBe('CA-');
      expect(SOL_PREFIX).toBe('SOL-');
    });

    it('should validate CA-NNN format with at least 3 digits', () => {
      expect(CA_FORMAT.test('CA-001')).toBe(true);
      expect(CA_FORMAT.test('CA-123')).toBe(true);
      expect(CA_FORMAT.test('CA-1')).toBe(false);
      expect(CA_FORMAT.test('CA-01')).toBe(false);
      expect(CA_FORMAT.test('CA-')).toBe(false);
      expect(CA_FORMAT.test('SOL-001')).toBe(false);
    });

    it('should validate SOL-NNN format with at least 3 digits', () => {
      expect(SOL_FORMAT.test('SOL-001')).toBe(true);
      expect(SOL_FORMAT.test('SOL-123')).toBe(true);
      expect(SOL_FORMAT.test('SOL-1')).toBe(false);
      expect(SOL_FORMAT.test('SOL-01')).toBe(false);
      expect(SOL_FORMAT.test('SOL-')).toBe(false);
      expect(SOL_FORMAT.test('CA-001')).toBe(false);
    });

    it('should build CA-NNN id from number or string', () => {
      expect(buildCaId(1)).toBe('CA-001');
      expect(buildCaId(12)).toBe('CA-012');
      expect(buildCaId(123)).toBe('CA-123');
      expect(buildCaId('001')).toBe('CA-001');
      expect(buildCaId('999')).toBe('CA-999');
    });

    it('should build SOL-NNN id from number or string', () => {
      expect(buildSolId(1)).toBe('SOL-001');
      expect(buildSolId(12)).toBe('SOL-012');
      expect(buildSolId(123)).toBe('SOL-123');
      expect(buildSolId('001')).toBe('SOL-001');
      expect(buildSolId('999')).toBe('SOL-999');
    });

    it('should build heading regex matching CA/SOL headings', () => {
      const caRe = buildCaHeadingRegex();
      expect('### CA-001: Title'.match(caRe)).toBeTruthy();
      expect('### CA-123: Long Title'.match(caRe)).toBeTruthy();
      expect('### SOL-001: Title'.match(caRe)).toBeFalsy();

      const solRe = buildSolHeadingRegex();
      expect('### SOL-001: Title'.match(solRe)).toBeTruthy();
      expect('### SOL-123: Long Title'.match(solRe)).toBeTruthy();
      expect('### CA-001: Title'.match(solRe)).toBeFalsy();
    });
  });

  describe('Metadata Fields', () => {
    it('should define all metadata field labels', () => {
      expect(METADATA_FIELDS.requirementSource).toEqual({ zh: '需求来源', en: 'Requirement Source' });
      expect(METADATA_FIELDS.investigationDate).toEqual({ zh: '调查时间', en: 'Investigation Date' });
      expect(METADATA_FIELDS.investigationDir).toEqual({ zh: '调查目录', en: 'Investigation Dir' });
      expect(METADATA_FIELDS.language).toEqual({ zh: '语言', en: 'Language' });
      expect(METADATA_FIELDS.parentReport).toEqual({ zh: '父报告', en: 'Parent Report' });
      expect(METADATA_FIELDS.dependsOn).toEqual({ zh: '依赖子报告', en: 'Depends On' });
    });
  });

  describe('Solution Fields', () => {
    it('should define all solution inline field labels', () => {
      expect(SOLUTION_FIELDS.correspondsTo).toEqual({ zh: '对应原因', en: 'Corresponds To' });
      expect(SOLUTION_FIELDS.files).toEqual({ zh: '涉及文件', en: 'Files' });
      expect(SOLUTION_FIELDS.expectedChanges).toEqual({ zh: '预期变更', en: 'Expected Changes' });
    });
  });

  describe('Assessment Fields', () => {
    it('should define all assessment inline field labels', () => {
      expect(ASSESSMENT_FIELDS.complexity).toEqual({ zh: '复杂度', en: 'Complexity' });
      expect(ASSESSMENT_FIELDS.impactScope).toEqual({ zh: '影响范围', en: 'Impact Scope' });
      expect(ASSESSMENT_FIELDS.estimatedMinutes).toEqual({ zh: '预估工时', en: 'Estimated Minutes' });
    });
  });

  describe('Template Contract Alignment', () => {
    it('zh investigate template should include all section titles', () => {
      const tpl = zhTemplates.investigate;
      expect(tpl).toContain(REPORT_SECTIONS.metadata.zh);
      expect(tpl).toContain(REPORT_SECTIONS.rootCauseAnalysis.zh);
      expect(tpl).toContain(REPORT_SECTIONS.solutions.zh);
      expect(tpl).toContain(REPORT_SECTIONS.checkpoints.zh);
      expect(tpl).toContain(REPORT_SECTIONS.assessment.zh);
    });

    it('zh investigate template should include all metadata field labels', () => {
      const tpl = zhTemplates.investigate;
      expect(tpl).toContain(METADATA_FIELDS.requirementSource.zh);
      expect(tpl).toContain(METADATA_FIELDS.investigationDate.zh);
      expect(tpl).toContain(METADATA_FIELDS.investigationDir.zh);
      expect(tpl).toContain(METADATA_FIELDS.language.zh);
    });

    it('zh investigate template should include solution fields', () => {
      const tpl = zhTemplates.investigate;
      expect(tpl).toContain(SOLUTION_FIELDS.files.zh);
      expect(tpl).toContain(SOLUTION_FIELDS.expectedChanges.zh);
    });

    it('zh investigate template should include assessment fields', () => {
      const tpl = zhTemplates.investigate;
      expect(tpl).toContain(ASSESSMENT_FIELDS.complexity.zh);
      expect(tpl).toContain(ASSESSMENT_FIELDS.impactScope.zh);
      expect(tpl).toContain(ASSESSMENT_FIELDS.estimatedMinutes.zh);
    });

    it('zh investigate template should include CA-001 and SOL-001 examples', () => {
      const tpl = zhTemplates.investigate;
      expect(tpl).toContain(buildCaId(1));
      expect(tpl).toContain(buildSolId(1));
    });

    it('en investigate template should include all section titles', () => {
      const tpl = enTemplates.investigate;
      expect(tpl).toContain(REPORT_SECTIONS.metadata.en);
      expect(tpl).toContain(REPORT_SECTIONS.rootCauseAnalysis.en);
      expect(tpl).toContain(REPORT_SECTIONS.solutions.en);
      expect(tpl).toContain(REPORT_SECTIONS.checkpoints.en);
      expect(tpl).toContain(REPORT_SECTIONS.assessment.en);
    });

    it('en investigate template should include all metadata field labels', () => {
      const tpl = enTemplates.investigate;
      expect(tpl).toContain(METADATA_FIELDS.requirementSource.en);
      expect(tpl).toContain(METADATA_FIELDS.investigationDate.en);
      expect(tpl).toContain(METADATA_FIELDS.investigationDir.en);
      expect(tpl).toContain(METADATA_FIELDS.language.en);
    });

    it('en investigate template should include solution fields', () => {
      const tpl = enTemplates.investigate;
      expect(tpl).toContain(SOLUTION_FIELDS.files.en);
      expect(tpl).toContain(SOLUTION_FIELDS.expectedChanges.en);
    });

    it('en investigate template should include assessment fields', () => {
      const tpl = enTemplates.investigate;
      expect(tpl).toContain(ASSESSMENT_FIELDS.complexity.en);
      expect(tpl).toContain(ASSESSMENT_FIELDS.impactScope.en);
      expect(tpl).toContain(ASSESSMENT_FIELDS.estimatedMinutes.en);
    });

    it('en investigate template should include CA-001 and SOL-001 examples', () => {
      const tpl = enTemplates.investigate;
      expect(tpl).toContain(buildCaId(1));
      expect(tpl).toContain(buildSolId(1));
    });
  });
});
