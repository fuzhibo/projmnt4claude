/**
 * Investigation 配置读取单元测试
 * 覆盖 §3.2 配置
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { InvestigationReport } from '../types.js';
import { loadInvestigationConfig, loadLanguageConfig, getDefaultConfig, loadCustomRequirements, formatCustomRequirements } from '../config-reader.js';

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

describe('§3.2 配置读取', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-config-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('splitThreshold 默认 30KB', () => {
    it('should use default 30KB when config missing', () => {
      const config = getDefaultConfig();
      expect(config.splitThreshold).toBe(30);
    });

    it('should read splitThreshold from config.json', () => {
      const configDir = path.join(tmpDir, '.projmnt4claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ investigation: { splitThreshold: 50 } }),
      );

      const config = loadInvestigationConfig(tmpDir);
      expect(config.splitThreshold).toBe(50);
    });
  });

  describe('CLI 优先级覆盖', () => {
    it('should prioritize CLI threshold over config.json', () => {
      const configDir = path.join(tmpDir, '.projmnt4claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ investigation: { splitThreshold: 50 } }),
      );

      const config = loadInvestigationConfig(tmpDir, 100);
      expect(config.splitThreshold).toBe(100);
    });

    it('should use default when both config and CLI are missing', () => {
      const config = loadInvestigationConfig(tmpDir);
      expect(config.splitThreshold).toBe(30);
    });
  });

  describe('语言配置', () => {
    it('should default to zh when config missing', () => {
      const lang = loadLanguageConfig(tmpDir);
      expect(lang).toBe('zh');
    });

    it('should read language from config file', () => {
      const configDir = path.join(tmpDir, '.projmnt4claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ prompts: { language: 'en' } }),
      );

      const lang = loadLanguageConfig(tmpDir);
      expect(lang).toBe('en');
    });

    it('should fallback to zh for invalid language', () => {
      const configDir = path.join(tmpDir, '.projmnt4claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ prompts: { language: 'fr' } }),
      );

      const lang = loadLanguageConfig(tmpDir);
      expect(lang).toBe('zh');
    });
  });

  describe('loadCustomRequirements', () => {
    it('should return empty strings when config missing', () => {
      const customReqs = loadCustomRequirements(tmpDir);
      expect(customReqs.investigate).toBe('');
      expect(customReqs.review).toBe('');
      expect(customReqs.investigateWithFeedback).toBe('');
      expect(customReqs.split).toBe('');
      expect(customReqs.splitReview).toBe('');
    });

    it('should read customRequirements from config.json', () => {
      const configDir = path.join(tmpDir, '.projmnt4claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({
          prompts: {
            customRequirements: {
              investigate: '请确保包含代码位置引用',
              review: '检查原因分析完整性',
            },
          },
        }),
      );

      const customReqs = loadCustomRequirements(tmpDir);
      expect(customReqs.investigate).toBe('请确保包含代码位置引用');
      expect(customReqs.review).toBe('检查原因分析完整性');
      expect(customReqs.investigateWithFeedback).toBe('');
    });
  });

  describe('formatCustomRequirements', () => {
    it('should return empty string for empty input', () => {
      expect(formatCustomRequirements('', 'investigate', 'zh')).toBe('');
      expect(formatCustomRequirements('   ', 'review', 'en')).toBe('');
    });

    it('should add guidance prefix for zh', () => {
      const result = formatCustomRequirements('请确保包含代码位置', 'investigate', 'zh');
      expect(result).toContain('## 用户定制要求');
      expect(result).toContain('请在调查过程中遵循以下定制要求');
      expect(result).toContain('请确保包含代码位置');
    });

    it('should add guidance prefix for en', () => {
      const result = formatCustomRequirements('Include code references', 'review', 'en');
      expect(result).toContain('## Custom Requirements');
      expect(result).toContain('Please follow the custom requirements below during review');
      expect(result).toContain('Include code references');
    });

    it('should use different guidance for each phase', () => {
      const phases: Array<'investigate' | 'review' | 'investigateWithFeedback' | 'split' | 'splitReview'> =
        ['investigate', 'review', 'investigateWithFeedback', 'split', 'splitReview'];

      const zhGuidanceTexts = phases.map(phase =>
        formatCustomRequirements('test', phase, 'zh'),
      );

      expect(zhGuidanceTexts[0]).toContain('调查过程中');
      expect(zhGuidanceTexts[1]).toContain('评审过程中');
      expect(zhGuidanceTexts[2]).toContain('修正过程中');
      expect(zhGuidanceTexts[3]).toContain('拆分过程中');
      expect(zhGuidanceTexts[4]).toContain('审核过程中');
    });
  });
});
