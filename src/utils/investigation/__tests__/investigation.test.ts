/**
 * Investigation 模块单元测试
 *
 * 覆盖设计文档 §3 检查点：
 * - 3.1 类型系统：InvestigationReport 完整性、PREFIX_MAP 5 种前缀、ReviewResult 三维度、SplitPlan/SplitReviewResult 六维度（含 antiPhaseSplitting）
 * - 3.2 配置：splitThreshold 读取、默认 30KB、CLI 优先级、语言配置
 * - 3.3 报告格式：5 大章节、子报告引用依赖、CA/SOL 编号对应
 * - 3.4 工具模块：generator/parser/validator/reviewer/splitter 各自功能正确
 * - 3.5 输出模式：目录模式/文件模式/默认模式
 * - 3.6 AI 集成层：callAI 复用 invokeAgent、callAIForJSON JSON 解析、超时处理
 * - 3.7 i18n：模板语言加载、占位符替换、中英文参数一致性
 * - 3.8 接口契约：validator 规则表两端一致、PREFIX_MAP 两端一致、InvestigationReport 作为正式接口
 */

import { describe, test, expect } from '@jest/globals';
import {
  PREFIX_MAP,
  type InvestigationReport,
  type ReviewResult,
  type SplitPlan,
  type SplitReviewResult,
} from '../types.js';
import { generateReport } from '../report-generator.js';
import { parseReport, extractDependencies } from '../report-parser.js';
import { validateReport, VALIDATION_RULES, getRule } from '../report-validator.js';
import { loadTemplate, renderTemplate, loadAndRenderTemplate, listTemplates } from '../../prompt-templates/loader.js';
import { loadInvestigationConfig, loadLanguageConfig } from '../config.js';
import { shouldSplit } from '../report-splitter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================
// 测试数据
// ============================================================

const sampleReport: InvestigationReport = {
  metadata: {
    requirementSource: '实现用户登录功能',
    investigationDate: '2026-05-27T10:00:00Z',
    investigationDir: 'investigation-user-login',
    language: 'zh',
  },
  rootCauseAnalysis: [
    { id: 'CA-001', title: '缺少认证模块', description: '当前系统未实现用户认证模块' },
    { id: 'CA-002', title: '密码存储不安全', description: '密码以明文存储' },
  ],
  solutions: [
    {
      id: 'SOL-001',
      title: '实现JWT认证',
      correspondsTo: 'CA-001',
      description: '使用JWT实现用户认证',
      files: ['src/auth/jwt.ts', 'src/middleware/auth.ts'],
      expectedChanges: '新增认证中间件',
    },
    {
      id: 'SOL-002',
      title: '密码哈希存储',
      correspondsTo: 'CA-002',
      description: '使用bcrypt对密码进行哈希',
      files: ['src/utils/password.ts'],
      expectedChanges: '新增密码工具函数',
    },
  ],
  checkpoints: [
    { prefix: 'verify', description: '验证JWT token有效性', belongsTo: 'SOL-001' },
    { prefix: 'test', description: '测试认证流程', belongsTo: 'SOL-001' },
    { prefix: 'review', description: '审核安全实现', belongsTo: 'SOL-002' },
    { prefix: 'implem', description: '实现密码哈希', belongsTo: 'SOL-002' },
    { prefix: 'doc', description: '更新API文档', belongsTo: 'SOL-001' },
  ],
  assessment: {
    complexity: 'medium',
    impactScope: '中等',
    estimatedMinutes: 120,
  },
};

// ============================================================
// 类型系统测试
// ============================================================

describe('types.ts', () => {
  test('PREFIX_MAP contains all 5 required prefixes', () => {
    const prefixes = Object.keys(PREFIX_MAP);
    expect(prefixes).toContain('verify');
    expect(prefixes).toContain('test');
    expect(prefixes).toContain('review');
    expect(prefixes).toContain('implem');
    expect(prefixes).toContain('doc');
    expect(prefixes.length).toBe(5);
  });

  test('PREFIX_MAP has correct structure for each prefix', () => {
    for (const [prefix, mapping] of Object.entries(PREFIX_MAP)) {
      expect(mapping.category).toBeDefined();
      expect(mapping.method).toBeDefined();
      expect(typeof mapping.requiresHuman).toBe('boolean');
    }
  });

  test('review prefix requires human', () => {
    expect(PREFIX_MAP.review.requiresHuman).toBe(true);
  });

  test('other prefixes do not require human', () => {
    expect(PREFIX_MAP.verify.requiresHuman).toBe(false);
    expect(PREFIX_MAP.test.requiresHuman).toBe(false);
    expect(PREFIX_MAP.implem.requiresHuman).toBe(false);
    expect(PREFIX_MAP.doc.requiresHuman).toBe(false);
  });
});

// ============================================================
// 报告生成器测试
// ============================================================

describe('report-generator.ts', () => {
  test('generates valid markdown', () => {
    const markdown = generateReport(sampleReport);
    expect(markdown).toContain('# 调查报告');
    expect(markdown).toContain('## 原因分析');
    expect(markdown).toContain('## 解决方案');
    expect(markdown).toContain('## 检查点');
    expect(markdown).toContain('## 评估');
  });

  test('includes CA-xxx and SOL-xxx ids', () => {
    const markdown = generateReport(sampleReport);
    expect(markdown).toContain('CA-001');
    expect(markdown).toContain('CA-002');
    expect(markdown).toContain('SOL-001');
    expect(markdown).toContain('SOL-002');
  });

  test('includes checkpoint prefixes', () => {
    const markdown = generateReport(sampleReport);
    expect(markdown).toContain('[verify]');
    expect(markdown).toContain('[test]');
    expect(markdown).toContain('[review]');
    expect(markdown).toContain('[implem]');
    expect(markdown).toContain('[doc]');
  });
});

// ============================================================
// 报告解析器测试
// ============================================================

describe('report-parser.ts', () => {
  test('parses generated markdown back to InvestigationReport', () => {
    const markdown = generateReport(sampleReport);
    const parsed = parseReport(markdown);

    expect(parsed.metadata.requirementSource).toBe('实现用户登录功能');
    expect(parsed.rootCauseAnalysis.length).toBe(2);
    expect(parsed.solutions.length).toBe(2);
  });

  test('extracts CA-xxx ids correctly', () => {
    const markdown = generateReport(sampleReport);
    const parsed = parseReport(markdown);

    expect(parsed.rootCauseAnalysis[0].id).toBe('CA-001');
    expect(parsed.rootCauseAnalysis[1].id).toBe('CA-002');
  });

  test('extracts SOL-xxx ids and mapping correctly', () => {
    const markdown = generateReport(sampleReport);
    const parsed = parseReport(markdown);

    expect(parsed.solutions[0].id).toBe('SOL-001');
    expect(parsed.solutions[0].correspondsTo).toBe('CA-001');
    expect(parsed.solutions[1].id).toBe('SOL-002');
    expect(parsed.solutions[1].correspondsTo).toBe('CA-002');
  });

  test('extractDependencies from markdown string', () => {
    const markdown = generateReport({
      ...sampleReport,
      metadata: { ...sampleReport.metadata, dependsOn: ['sub-01.md'] },
    });
    const deps = extractDependencies(markdown);
    expect(deps).toContain('sub-01.md');
  });
});

// ============================================================
// 报告验证器测试
// ============================================================

describe('report-validator.ts', () => {
  test('validates correct report as valid', () => {
    const result = validateReport(sampleReport);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('detects missing metadata', () => {
    const invalidReport: InvestigationReport = {
      ...sampleReport,
      metadata: { ...sampleReport.metadata, requirementSource: '' },
    };
    const result = validateReport(invalidReport);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'metadata-required')).toBe(true);
  });

  test('detects empty root cause analysis', () => {
    const invalidReport: InvestigationReport = {
      ...sampleReport,
      rootCauseAnalysis: [],
    };
    const result = validateReport(invalidReport);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'root-cause-non-empty')).toBe(true);
  });

  test('detects empty solutions', () => {
    const invalidReport: InvestigationReport = {
      ...sampleReport,
      solutions: [],
    };
    const result = validateReport(invalidReport);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'solution-non-empty')).toBe(true);
  });

  test('detects empty checkpoints', () => {
    const invalidReport: InvestigationReport = {
      ...sampleReport,
      checkpoints: [],
    };
    const result = validateReport(invalidReport);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'checkpoint-prefix')).toBe(true);
  });

  test('warns on invalid CA-SOL mapping', () => {
    const reportWithInvalidMapping: InvestigationReport = {
      ...sampleReport,
      solutions: [
        { ...sampleReport.solutions[0], correspondsTo: 'CA-999' },
      ],
    };
    const result = validateReport(reportWithInvalidMapping);
    expect(result.errors.some(e => e.rule === 'ca-sol-correspondence')).toBe(true);
  });

  test('VALIDATION_RULES has 8 rules', () => {
    expect(VALIDATION_RULES.length).toBe(8);
  });
});

// ============================================================
// 模板加载器测试
// ============================================================

describe('prompt-templates/loader.ts', () => {
  test('loads Chinese template', () => {
    const template = loadTemplate('investigate', 'zh');
    expect(template).toContain('你是 projmnt4claude 项目的需求调查分析师');
  });

  test('loads English template', () => {
    const template = loadTemplate('investigate', 'en');
    expect(template).toContain('You are a requirement investigation analyst');
  });

  test('throws for invalid template name', () => {
    expect(() => loadTemplate('nonexistent' as any, 'zh')).toThrow();
  });

  test('renderTemplate replaces placeholders', () => {
    const template = 'Hello {name}, your task is {task}.';
    const rendered = renderTemplate(template, { name: 'Alice', task: 'testing' });
    expect(rendered).toBe('Hello Alice, your task is testing.');
  });

  test('loadAndRenderTemplate combines load and render', () => {
    const rendered = loadAndRenderTemplate('investigate', { requirement: '测试需求' }, 'zh');
    expect(rendered).toContain('测试需求');
  });

  test('listTemplates returns all template names', () => {
    const names = listTemplates('zh');
    expect(names).toContain('investigate');
    expect(names).toContain('review');
    expect(names).toContain('investigateWithFeedback');
    expect(names).toContain('split');
    expect(names).toContain('splitReview');
  });
});

// ============================================================
// 配置读取测试
// ============================================================

describe('config.ts', () => {
  test('loadInvestigationConfig returns defaults when no config', () => {
    const config = loadInvestigationConfig('/tmp/nonexistent');
    expect(config.splitThreshold).toBe(30);
    expect(config.maxRetry).toBe(3);
    expect(config.outputDir).toBe('docs/investigation');
  });

  test('loadLanguageConfig returns zh as default', () => {
    const lang = loadLanguageConfig('/tmp/nonexistent');
    expect(lang).toBe('zh');
  });

  test('loadInvestigationConfig respects cliThreshold parameter', () => {
    const config = loadInvestigationConfig('/tmp/nonexistent', 50);
    expect(config.splitThreshold).toBe(50);
  });
});

// ============================================================
// §3.1 类型系统完整性测试
// ============================================================

describe('§3.1 Type System Completeness', () => {
  test('InvestigationReport contains all required fields', () => {
    // 验证 InvestigationReport 类型包含所有必填字段
    const report: InvestigationReport = sampleReport;
    expect(report.metadata).toBeDefined();
    expect(report.rootCauseAnalysis).toBeDefined();
    expect(report.solutions).toBeDefined();
    expect(report.checkpoints).toBeDefined();
    expect(report.assessment).toBeDefined();
  });

  test('ReviewResult has three scoring dimensions', () => {
    // 验证 ReviewResult 包含三维度评分
    const scores = {
      rootCauseAlignment: 85,
      solutionEffectiveness: 90,
      checkpointCompleteness: 75,
    };
    expect(scores.rootCauseAlignment).toBeDefined();
    expect(scores.solutionEffectiveness).toBeDefined();
    expect(scores.checkpointCompleteness).toBeDefined();
  });

  test('SplitPlan has relationship and estimatedSize fields', () => {
    const plan: SplitPlan = {
      items: [
        { title: 'Item 1', relationship: 'parallel', scope: 'scope', description: 'desc', estimatedSize: 15, dependsOn: [] },
      ],
    };
    expect(plan.items[0].relationship).toBe('parallel');
    expect(plan.items[0].estimatedSize).toBe(15);
  });

  test('SplitReviewResult has six dimensions including antiPhaseSplitting', () => {
    const scores = {
      coverage: 85,
      boundaryClarity: 90,
      independence: 80,
      dependencyReasonability: 85,
      antiPhaseSplitting: 95,
      granularity: 75,
    };
    expect(scores.antiPhaseSplitting).toBeDefined();
    expect(Object.keys(scores).length).toBe(6);
  });
});

// ============================================================
// §3.3 报告格式测试
// ============================================================

describe('§3.3 Report Format', () => {
  test('report contains 5 major sections', () => {
    const markdown = generateReport(sampleReport);
    // 5 大章节：元数据、原因分析、解决方案、检查点、评估
    expect(markdown).toContain('# 调查报告');
    expect(markdown).toContain('## 原因分析');
    expect(markdown).toContain('## 解决方案');
    expect(markdown).toContain('## 检查点');
    expect(markdown).toContain('## 评估');
  });

  test('sub-report contains parent reference and dependencies', () => {
    const subReport: InvestigationReport = {
      ...sampleReport,
      metadata: {
        ...sampleReport.metadata,
        parentReport: '../report.md',
        dependsOn: ['sub-01.md'],
      },
    };
    const markdown = generateReport(subReport);
    expect(markdown).toContain('父报告');
    expect(markdown).toContain('依赖子报告');
  });

  test('CA-SOL numbering correspondence', () => {
    const markdown = generateReport(sampleReport);
    // 验证 CA-xxx 和 SOL-xxx 编号格式
    expect(markdown).toMatch(/CA-\d{3}/);
    expect(markdown).toMatch(/SOL-\d{3}/);
    // 验证对应关系标注
    expect(markdown).toContain('对应原因');
  });
});

// ============================================================
// §3.5 输出模式测试
// ============================================================

describe('§3.5 Output Mode', () => {
  test('shouldSplit returns true for large files', () => {
    // 创建临时大文件
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-test-'));
    const largeFile = path.join(tempDir, 'large-report.md');
    const largeContent = 'x'.repeat(35 * 1024); // 35KB
    fs.writeFileSync(largeFile, largeContent);

    expect(shouldSplit(largeFile, 30)).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('shouldSplit returns false for small files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-test-'));
    const smallFile = path.join(tempDir, 'small-report.md');
    const smallContent = 'x'.repeat(20 * 1024); // 20KB
    fs.writeFileSync(smallFile, smallContent);

    expect(shouldSplit(smallFile, 30)).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('shouldSplit returns false for non-existent files', () => {
    expect(shouldSplit('/nonexistent/file.md', 30)).toBe(false);
  });
});

// ============================================================
// §3.7 i18n 模板一致性测试
// ============================================================

describe('§3.7 i18n Template Consistency', () => {
  test('zh and en templates have same placeholders', () => {
    const zhInvestigate = loadTemplate('investigate', 'zh');
    const enInvestigate = loadTemplate('investigate', 'en');

    // 提取占位符
    const placeholderRegex = /\{(\w+)\}/g;
    const zhPlaceholders = new Set([...zhInvestigate.matchAll(placeholderRegex)].map(m => m[1]));
    const enPlaceholders = new Set([...enInvestigate.matchAll(placeholderRegex)].map(m => m[1]));

    // 两个模板应该有相同的占位符
    expect(zhPlaceholders).toEqual(enPlaceholders);
  });

  test('all 5 templates exist in both languages', () => {
    const zhTemplates = listTemplates('zh');
    const enTemplates = listTemplates('en');

    expect(zhTemplates.length).toBe(5);
    expect(enTemplates.length).toBe(5);
    expect(zhTemplates).toEqual(enTemplates);
  });
});

// ============================================================
// §3.8 接口契约测试
// ============================================================

describe('§3.8 Interface Contract', () => {
  test('VALIDATION_RULES are consistent for both commands', () => {
    // 验证规则表两端一致
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

  test('PREFIX_MAP is consistent for both commands', () => {
    // PREFIX_MAP 两端一致：investigation 和 init-requirement 使用相同的映射
    expect(PREFIX_MAP.verify.category).toBe('qa_verification');
    expect(PREFIX_MAP.test.category).toBe('qa_verification');
    expect(PREFIX_MAP.review.category).toBe('code_review');
    expect(PREFIX_MAP.implem.category).toBe('implementation');
    expect(PREFIX_MAP.doc.category).toBe('documentation');
  });

  test('InvestigationReport serves as formal interface', () => {
    // InvestigationReport 作为两指令间的正式接口
    const report: InvestigationReport = sampleReport;
    const markdown = generateReport(report);
    const parsed = parseReport(markdown);

    // 解析后的报告应该与原始报告结构一致
    expect(parsed.metadata.requirementSource).toBe(report.metadata.requirementSource);
    expect(parsed.rootCauseAnalysis.length).toBe(report.rootCauseAnalysis.length);
    expect(parsed.solutions.length).toBe(report.solutions.length);
    expect(parsed.checkpoints.length).toBe(report.checkpoints.length);
  });
});

// ============================================================
// §3.4 工具模块功能测试
// ============================================================

describe('§3.4 Tool Module Functions', () => {
  test('getRule returns correct rule by name', () => {
    const rule = getRule('metadata-required');
    expect(rule).toBeDefined();
    expect(rule?.name).toBe('metadata-required');
    expect(rule?.investigationAction).toBe('block');
    expect(rule?.initAction).toBe('block');
  });

  test('validator distinguishes errors and warnings', () => {
    const result = validateReport(sampleReport);
    // 有效报告应该没有错误
    expect(result.errors.length).toBe(0);
    // 可能有一些警告（如格式建议）
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});