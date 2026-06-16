/**
 * Investigation 核心功能单元测试（OOM 安全版本）
 *
 * 覆盖 §3.2 配置 + §3.3 报告格式 + §3.4 工具模块 + §3.5 输出模式
 *
 * 安全策略：直接导入独立模块（types.ts, report-generator.ts, report-parser.ts,
 * report-validator.ts, config-reader.ts），避免导入 loader.ts 或 index.ts，
 * 防止 SWC 编译时拉入庞大的 init-requirement 模板文件导致 OOM。
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { InvestigationReport, CheckpointPrefix } from '../types.js';
import { generateReport, writeReport } from '../report-generator.js';
import { parseReport, extractDependencies, extractDependenciesFromMarkdown } from '../report-parser.js';
import { validateReport, VALIDATION_RULES, getValidationRules, getRule } from '../report-validator.js';
import { loadInvestigationConfig, loadLanguageConfig, getDefaultConfig } from '../config-reader.js';

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
// §3.2 配置读取
// ============================================================

describe('§3.2 配置读取', () => {
  describe('splitThreshold 默认 30KB', () => {
    it('should return default splitThreshold of 30', () => {
      const config = getDefaultConfig();
      expect(config.splitThreshold).toBe(30);
    });

    it('should return default maxRetry of 3', () => {
      const config = getDefaultConfig();
      expect(config.maxRetry).toBe(3);
    });

    it('should return default outputDir', () => {
      const config = getDefaultConfig();
      expect(config.outputDir).toBe('docs/investigation');
    });
  });

  describe('CLI 优先级覆盖', () => {
    it('should use CLI threshold when provided', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-config-test-'));
      try {
        const config = loadInvestigationConfig(tmpDir, 50);
        expect(config.splitThreshold).toBe(50);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should fallback to default when no CLI override and no config file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-config-test-'));
      try {
        const config = loadInvestigationConfig(tmpDir);
        expect(config.splitThreshold).toBe(30);
        expect(config.maxRetry).toBe(3);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('语言配置', () => {
    it('should fallback to zh when config missing', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-config-test-'));
      try {
        const lang = loadLanguageConfig(tmpDir);
        expect(lang).toBe('zh');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should read language from config file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-config-test-'));
      try {
        const projDir = path.join(tmpDir, '.projmnt4claude');
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(
          path.join(projDir, 'config.json'),
          JSON.stringify({ prompts: { language: 'en' } }),
          'utf-8',
        );
        const lang = loadLanguageConfig(tmpDir);
        expect(lang).toBe('en');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// ============================================================
// §3.3 报告格式
// ============================================================

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

// ============================================================
// §3.4 工具模块
// ============================================================

describe('§3.4 工具模块', () => {
  describe('report-generator.ts', () => {
    it('should generate valid markdown from InvestigationReport', () => {
      const report = createTestReport();
      const md = generateReport(report);
      expect(md).toBeTruthy();
      expect(typeof md).toBe('string');
      expect(md.length).toBeGreaterThan(0);
    });

    it('should include all solution fields in zh', () => {
      const report = createTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('对应原因');
      expect(md).toContain('涉及文件');
      expect(md).toContain('预期变更');
    });

    it('should include all solution fields in en', () => {
      const report = createTestReport();
      const md = generateReport(report, 'en');
      expect(md).toContain('Corresponds To');
      expect(md).toContain('Involved Files');
      expect(md).toContain('Expected Changes');
    });

    it('should render assessment correctly in zh', () => {
      const report = createTestReport();
      const md = generateReport(report, 'zh');
      expect(md).toContain('**复杂度**');
      expect(md).toContain('**影响范围**');
      expect(md).toContain('**预估工时**');
    });

    it('should render assessment correctly in en', () => {
      const report = createTestReport();
      const md = generateReport(report, 'en');
      expect(md).toContain('**Complexity**');
      expect(md).toContain('**Impact Scope**');
      expect(md).toContain('**Estimated Effort**');
    });
  });

  describe('report-parser.ts', () => {
    it('should parse a complete markdown report', () => {
      const report = createTestReport();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);
      expect(parsed.metadata.requirementSource).toBe('Test requirement');
      expect(parsed.rootCauseAnalysis).toHaveLength(1);
      expect(parsed.rootCauseAnalysis[0].id).toBe('CA-001');
      expect(parsed.solutions).toHaveLength(1);
      expect(parsed.solutions[0].id).toBe('SOL-001');
    });

    it('should parse root cause analysis items', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);
      expect(parsed.rootCauseAnalysis).toHaveLength(2);
      expect(parsed.rootCauseAnalysis[0].id).toBe('CA-001');
      expect(parsed.rootCauseAnalysis[1].id).toBe('CA-002');
    });

    it('should parse solutions with files and expectedChanges', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);
      expect(parsed.solutions[0].files).toEqual(['src/a.ts', 'src/b.ts']);
      expect(parsed.solutions[0].expectedChanges).toBe('Modify a.ts and add b.ts');
    });

    it('should parse checkpoints with prefix and belongsTo', () => {
      const report = createFullTestReport();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);
      expect(parsed.checkpoints.length).toBeGreaterThanOrEqual(1);
      const verifyCp = parsed.checkpoints.find(cp => cp.prefix === 'verify');
      expect(verifyCp).toBeDefined();
      expect(verifyCp!.belongsTo).toBe('SOL-001');
    });

    it('should handle empty sections gracefully', () => {
      const md = '# 调查报告\n\n## 原因分析\n\n## 解决方案\n\n## 检查点覆盖清单\n\n## 评估';
      const parsed = parseReport(md);
      expect(parsed.rootCauseAnalysis).toEqual([]);
      expect(parsed.solutions).toEqual([]);
      expect(parsed.checkpoints).toEqual([]);
    });

    it('should parse English report correctly', () => {
      const report = createTestReport();
      const md = generateReport(report, 'en');
      const parsed = parseReport(md);
      expect(parsed.metadata.requirementSource).toBe('Test requirement');
      expect(parsed.rootCauseAnalysis).toHaveLength(1);
    });
  });

  describe('report-validator.ts', () => {
    it('should validate a correct report as valid', () => {
      const report = createFullTestReport();
      const result = validateReport(report);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error when metadata is missing', () => {
      const report = createTestReport({ metadata: undefined as any });
      const result = validateReport(report);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'metadata-required')).toBe(true);
    });

    it('should error when rootCauseAnalysis is empty', () => {
      const report = createTestReport({ rootCauseAnalysis: [] });
      const result = validateReport(report);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'root-cause-non-empty')).toBe(true);
    });

    it('should error when solutions is empty', () => {
      const report = createTestReport({ solutions: [] });
      const result = validateReport(report);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'solution-non-empty')).toBe(true);
    });

    it('should error when CA-SOL correspondence is broken', () => {
      const report = createTestReport({
        solutions: [{
          id: 'SOL-001', title: 'Test', correspondsTo: 'CA-999',
          description: 'Desc', files: [], expectedChanges: 'Changes',
        }],
      });
      const result = validateReport(report);
      expect(result.errors.some(e => e.rule === 'ca-sol-correspondence')).toBe(true);
    });

    it('should warn on invalid checkpoint prefix', () => {
      const report = createTestReport({
        checkpoints: [{ prefix: 'invalid' as CheckpointPrefix, description: 'Bad prefix', belongsTo: 'SOL-001' }],
      });
      const result = validateReport(report);
      expect(result.warnings.some(w => w.rule === 'checkpoint-prefix')).toBe(true);
    });

    it('should warn on invalid CA id format', () => {
      const report = createTestReport({
        rootCauseAnalysis: [{ id: 'CA-1', title: 'Bad ID', description: 'Desc' }],
      });
      const result = validateReport(report);
      expect(result.warnings.some(w => w.rule === 'id-format')).toBe(true);
    });

    it('should warn on missing assessment', () => {
      const report = createTestReport({ assessment: undefined as any });
      const result = validateReport(report);
      expect(result.warnings.some(w => w.rule === 'assessment-required')).toBe(true);
    });

    it('should have exactly 8 validation rules', () => {
      expect(VALIDATION_RULES).toHaveLength(8);
    });

    it('should return rules via getValidationRules', () => {
      const rules = getValidationRules();
      expect(rules).toHaveLength(8);
      expect(rules[0].name).toBe('metadata-required');
    });

    it('should return specific rule via getRule', () => {
      const rule = getRule('metadata-required');
      expect(rule).toBeDefined();
      expect(rule!.investigationAction).toBe('block');
      expect(rule!.initAction).toBe('block');
    });

    it('should warn on checkpoint belongsTo pointing to invalid SOL', () => {
      const report = createTestReport({
        checkpoints: [{ prefix: 'verify', description: 'Verify', belongsTo: 'SOL-999' }],
      });
      const result = validateReport(report);
      expect(result.warnings.some(w => w.rule === 'checkpoint-belongsto')).toBe(true);
    });

    it('should error on missing checkpoints', () => {
      const report = createTestReport({ checkpoints: [] });
      const result = validateReport(report);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'checkpoint-prefix')).toBe(true);
    });

    it('should warn on invalid SOL id format', () => {
      const report = createTestReport({
        solutions: [{ id: 'SOL-1', title: 'Bad', correspondsTo: 'CA-001', description: 'Desc', files: [], expectedChanges: 'Changes' }],
      });
      const result = validateReport(report);
      expect(result.warnings.some(w => w.rule === 'id-format')).toBe(true);
    });
  });
});

// ============================================================
// §3.5 输出模式
// ============================================================

describe('§3.5 输出模式', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-output-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write report to directory mode', () => {
    const report = createTestReport();
    const filePath = writeReport(report, { type: 'dir', path: 'output' }, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# 调查报告');
  });

  it('should write report to file mode', () => {
    const report = createTestReport();
    const filePath = writeReport(report, { type: 'file', path: 'reports/my-report.md' }, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# 调查报告');
  });

  it('should create nested directories for file mode', () => {
    const report = createTestReport();
    const filePath = writeReport(report, { type: 'file', path: 'deep/nested/report.md' }, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'deep', 'nested'))).toBe(true);
  });

  it('should use report language for output', () => {
    const report = createTestReport({ metadata: { ...createTestReport().metadata, language: 'en' } });
    const filePath = writeReport(report, { type: 'dir', path: 'output-en' }, tmpDir);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Investigation Report');
  });
});

// ============================================================
// §3.8 接口契约（补充验证）
// ============================================================

describe('§3.8 接口契约补充', () => {
  it('should have consistent PREFIX_MAP keys', () => {
    const report = createFullTestReport();
    const md = generateReport(report, 'zh');
    const parsed = parseReport(md);
    const result = validateReport(parsed);
    expect(result.valid).toBe(true);
  });

  it('should maintain all 5 checkpoint prefixes through roundtrip', () => {
    const report = createFullTestReport();
    const md = generateReport(report, 'zh');
    const parsed = parseReport(md);
    const prefixes = parsed.checkpoints.map(cp => cp.prefix);
    expect(prefixes).toContain('verify');
    expect(prefixes).toContain('test');
    expect(prefixes).toContain('review');
    expect(prefixes).toContain('implem');
    expect(prefixes).toContain('doc');
  });

  it('should validate all 8 rules have both investigationAction and initAction', () => {
    for (const rule of VALIDATION_RULES) {
      expect(rule).toHaveProperty('investigationAction');
      expect(rule).toHaveProperty('initAction');
      expect(['block', 'warn']).toContain(rule.investigationAction);
      expect(['block', 'warn']).toContain(rule.initAction);
    }
  });
});
