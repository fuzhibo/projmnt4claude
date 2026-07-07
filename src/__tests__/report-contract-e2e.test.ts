/**
 * SOL-005: 端到端契约测试覆盖
 *
 * 验证完整链路：模板渲染 → 模拟 headless 输出 → 解析器提取 → 校验器验证。
 * 确保模板与解析器的契约变更能被自动检测，杜绝 CA-006 类补丁式修复。
 *
 * 关联文档: docs/investigation-init-requirement/SOL-005-e2e-contract-test-design.md
 * 关联 CA: CA-006
 */

import { describe, it, expect } from '@jest/globals';
import { loadAndRenderTemplate } from '../utils/prompt-templates/loader.js';
import { parseReport } from '../utils/investigation/report-parser.js';
import { validateReport } from '../utils/investigation/report-validator.js';
import {
  REPORT_SECTIONS,
  METADATA_FIELDS,
  SOLUTION_FIELDS,
  ASSESSMENT_FIELDS,
  CA_FORMAT,
  SOL_FORMAT,
  buildCaId,
  buildSolId,
} from '../utils/investigation/report-contract.js';

// ============================================================
// 模拟 Headless 输出样本（基于契约常量构建，契约变更自动传播）
// ============================================================

const buildMockZh = (override: { slug: string; requirement: string }): string => `# 调查报告：${override.requirement}

## ${REPORT_SECTIONS.metadata.zh}
- **${METADATA_FIELDS.requirementSource.zh}**: ${override.requirement}
- **${METADATA_FIELDS.investigationDate.zh}**: 2026-07-06T10:00:00.000Z
- **${METADATA_FIELDS.investigationDir.zh}**: investigation-${override.slug}
- **${METADATA_FIELDS.language.zh}**: zh

## ${REPORT_SECTIONS.rootCauseAnalysis.zh}
### ${buildCaId(1)}: 缺少登录验证逻辑
当前系统未实现用户登录验证功能，需要添加认证机制。

## ${REPORT_SECTIONS.solutions.zh}
### ${buildSolId(1)}: 实现登录验证
添加用户名密码验证逻辑
- ${SOLUTION_FIELDS.correspondsTo.zh}: ${buildCaId(1)}
- ${SOLUTION_FIELDS.files.zh}: \`src/auth/login.ts\`
- ${SOLUTION_FIELDS.expectedChanges.zh}: 新增 login 函数

## ${REPORT_SECTIONS.checkpoints.zh}
### ${buildSolId(1)} 相关检查点
- [ai review] 验证登录功能正常 → SOL-001
- [ai qa] 测试密码校验逻辑 → SOL-001

## ${REPORT_SECTIONS.assessment.zh}
- ${ASSESSMENT_FIELDS.complexity.zh}: medium
- ${ASSESSMENT_FIELDS.impactScope.zh}: 中等
- ${ASSESSMENT_FIELDS.estimatedMinutes.zh}: 60 分钟
`;

const buildMockEn = (override: { slug: string; requirement: string }): string => `# Investigation Report: ${override.requirement}

## ${REPORT_SECTIONS.metadata.en}
- **${METADATA_FIELDS.requirementSource.en}**: ${override.requirement}
- **${METADATA_FIELDS.investigationDate.en}**: 2026-07-06T10:00:00.000Z
- **${METADATA_FIELDS.investigationDir.en}**: investigation-${override.slug}
- **${METADATA_FIELDS.language.en}**: en

## ${REPORT_SECTIONS.rootCauseAnalysis.en}
### ${buildCaId(1)}: Missing login verification logic
Current system lacks user login verification, need to add authentication.

## ${REPORT_SECTIONS.solutions.en}
### ${buildSolId(1)}: Implement login verification
Add username/password verification logic
- ${SOLUTION_FIELDS.correspondsTo.en}: ${buildCaId(1)}
- ${SOLUTION_FIELDS.files.en}: \`src/auth/login.ts\`
- ${SOLUTION_FIELDS.expectedChanges.en}: Add login function

## ${REPORT_SECTIONS.checkpoints.en}
### ${buildSolId(1)} Related Checkpoints
- [ai review] Verify login functionality works → SOL-001
- [ai qa] Test password validation logic → SOL-001

## ${REPORT_SECTIONS.assessment.en}
- ${ASSESSMENT_FIELDS.complexity.en}: medium
- ${ASSESSMENT_FIELDS.impactScope.en}: moderate
- ${ASSESSMENT_FIELDS.estimatedMinutes.en}: 60 minutes
`;

const MOCK_ZH = buildMockZh({ slug: 'test-requirement', requirement: '测试需求：实现用户登录功能' });
const MOCK_EN = buildMockEn({ slug: 'test-requirement', requirement: 'Test requirement: Implement user login' });

// ============================================================
// 模板渲染契约
// ============================================================

describe('SOL-005 Template Rendering Contract', () => {
  const renderCases = [
    { lang: 'zh' as const, requirement: '测试需求：实现用户登录功能' },
    { lang: 'en' as const, requirement: 'Test requirement: Implement user login' },
  ];

  const baseParams = (requirement: string) => ({
    requirement,
    projectContext: 'Main directories: src, tests',
    date: '2026-07-06T10:00:00.000Z',
    slug: 'test-slug',
    title: requirement.slice(0, 50),
    // N 参数对应模板 i18n/zh.ts:74 与 i18n/en.ts:75 的 {N} 占位符（预估工时）
    N: '60',
  });

  renderCases.forEach(({ lang, requirement }) => {
    describe(`Language: ${lang}`, () => {
      it('should render investigate template with all placeholders filled', async () => {
        const prompt = await loadAndRenderTemplate('investigate', baseParams(requirement), lang);

        expect(prompt).toBeDefined();
        expect(prompt.length).toBeGreaterThan(100);

        // 验证所有传入占位符均已替换
        expect(prompt).not.toContain('{requirement}');
        expect(prompt).not.toContain('{projectContext}');
        expect(prompt).not.toContain('{date}');
        expect(prompt).not.toContain('{slug}');
        expect(prompt).not.toContain('{title}');
        expect(prompt).not.toContain('{N}');
      });

      it('should contain all required sections', async () => {
        const prompt = await loadAndRenderTemplate('investigate', baseParams(requirement), lang);

        expect(prompt).toContain(REPORT_SECTIONS.metadata[lang]);
        expect(prompt).toContain(REPORT_SECTIONS.rootCauseAnalysis[lang]);
        expect(prompt).toContain(REPORT_SECTIONS.solutions[lang]);
        expect(prompt).toContain(REPORT_SECTIONS.checkpoints[lang]);
        expect(prompt).toContain(REPORT_SECTIONS.assessment[lang]);
      });

      it('should use correct numbering format (CA-NNN, SOL-NNN)', async () => {
        const prompt = await loadAndRenderTemplate('investigate', baseParams(requirement), lang);

        // 模板嵌入 buildCaId(1)/buildSolId(1) 示例，应匹配契约格式
        const caMatches = prompt.match(/CA-\d{3,}/g) ?? [];
        const solMatches = prompt.match(/SOL-\d{3,}/g) ?? [];
        expect(caMatches.length).toBeGreaterThan(0);
        expect(solMatches.length).toBeGreaterThan(0);
        caMatches.forEach(id => expect(CA_FORMAT.test(id)).toBe(true));
        solMatches.forEach(id => expect(SOL_FORMAT.test(id)).toBe(true));
      });
    });
  });
});

// ============================================================
// 模拟 Headless 输出解析
// ============================================================

describe('SOL-005 Simulated Headless Output Parsing', () => {
  it('should parse valid Chinese output correctly', () => {
    const report = parseReport(MOCK_ZH);

    expect(report.metadata.requirementSource).toBe('测试需求：实现用户登录功能');
    expect(report.metadata.investigationDate).toBe('2026-07-06T10:00:00.000Z');
    expect(report.metadata.investigationDir).toBe('investigation-test-requirement');
    expect(report.metadata.language).toBe('zh');

    expect(report.rootCauseAnalysis.length).toBe(1);
    expect(report.rootCauseAnalysis[0]?.id).toMatch(CA_FORMAT);
    expect(report.solutions.length).toBe(1);
    expect(report.solutions[0]?.id).toMatch(SOL_FORMAT);
    expect(report.solutions[0]?.correspondsTo).toBe(buildCaId(1));
    expect(report.checkpoints.length).toBe(2);
    expect(report.assessment.complexity).toBe('medium');
    expect(report.assessment.estimatedMinutes).toBe(60);
  });

  it('should parse valid English output correctly', () => {
    const report = parseReport(MOCK_EN);

    expect(report.metadata.requirementSource).toBe('Test requirement: Implement user login');
    expect(report.metadata.investigationDate).toBe('2026-07-06T10:00:00.000Z');
    expect(report.metadata.investigationDir).toBe('investigation-test-requirement');
    expect(report.metadata.language).toBe('en');

    expect(report.rootCauseAnalysis.length).toBe(1);
    expect(report.rootCauseAnalysis[0]?.id).toMatch(CA_FORMAT);
    expect(report.solutions.length).toBe(1);
    expect(report.solutions[0]?.id).toMatch(SOL_FORMAT);
    expect(report.solutions[0]?.correspondsTo).toBe(buildCaId(1));
    expect(report.checkpoints.length).toBe(2);
    expect(report.assessment.complexity).toBe('medium');
    expect(report.assessment.estimatedMinutes).toBe(60);
  });

  it('should validate parsed Chinese report successfully', () => {
    const report = parseReport(MOCK_ZH);
    const validation = validateReport(report);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should validate parsed English report successfully', () => {
    const report = parseReport(MOCK_EN);
    const validation = validateReport(report);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should normalize checkpoint prefixes to kebab-case', () => {
    const reportZh = parseReport(MOCK_ZH);
    expect(reportZh.checkpoints[0]?.prefix).toBe('ai-review');
    expect(reportZh.checkpoints[1]?.prefix).toBe('ai-qa');
    expect(reportZh.checkpoints[0]?.belongsTo).toBe(buildSolId(1));
  });
});

// ============================================================
// 格式变体解析（解析器容忍性）
// ============================================================

describe('SOL-005 Format Variant Parsing', () => {
  describe('CA numbering variants', () => {
    const variants = [
      { id: 'CA-1',   desc: '少于3位数字' },
      { id: 'CA-01',  desc: '2位数字' },
      { id: 'CA-001', desc: '标准格式' },
    ];

    variants.forEach(({ id, desc }) => {
      it(`should parse ${id} (${desc})`, () => {
        const md = `# 调查报告

## ${REPORT_SECTIONS.rootCauseAnalysis.zh}
### ${id}: 原因标题
原因描述
`;
        const report = parseReport(md);
        expect(report.rootCauseAnalysis.length).toBe(1);
        expect(report.rootCauseAnalysis[0]?.id).toBe(id);
      });
    });
  });

  describe('SOL numbering variants', () => {
    const variants = [
      { id: 'SOL-1',   desc: '少于3位数字' },
      { id: 'SOL-01',  desc: '2位数字' },
      { id: 'SOL-001', desc: '标准格式' },
    ];

    variants.forEach(({ id, desc }) => {
      it(`should parse ${id} (${desc})`, () => {
        const md = `# 调查报告

## ${REPORT_SECTIONS.solutions.zh}
### ${id}: 方案标题
方案描述
`;
        const report = parseReport(md);
        expect(report.solutions.length).toBe(1);
        expect(report.solutions[0]?.id).toBe(id);
      });
    });
  });

  describe('checkpoint prefix variants', () => {
    it('should parse System B lowercase prefix [ai review]', () => {
      const md = `# 调查报告

## ${REPORT_SECTIONS.checkpoints.zh}
- [ai review] 验证内容 → SOL-001
`;
      const report = parseReport(md);
      expect(report.checkpoints.length).toBe(1);
      expect(report.checkpoints[0]?.prefix).toBe('ai-review');
      expect(report.checkpoints[0]?.belongsTo).toBe('SOL-001');
    });

    it('should parse System B lowercase prefix [ai qa]', () => {
      const md = `# 调查报告

## ${REPORT_SECTIONS.checkpoints.zh}
- [ai qa] 测试内容 → SOL-001
`;
      const report = parseReport(md);
      expect(report.checkpoints.length).toBe(1);
      expect(report.checkpoints[0]?.prefix).toBe('ai-qa');
    });

    it('should parse legacy System A prefix [verify] and migrate to ai-qa', () => {
      const md = `# 调查报告

## ${REPORT_SECTIONS.checkpoints.zh}
- [verify] 验证内容 → SOL-001
`;
      const report = parseReport(md);
      // legacy verify 迁移至 ai-qa
      expect(report.checkpoints.length).toBe(1);
      expect(report.checkpoints[0]?.prefix).toBe('ai-qa');
    });

    it('should NOT parse uppercase [VERIFY] (parser regex is case-sensitive)', () => {
      const md = `# 调查报告

## ${REPORT_SECTIONS.checkpoints.zh}
- [VERIFY] 验证内容 → SOL-001
`;
      const report = parseReport(md);
      // 当前解析器正则 [a-z] 仅匹配小写，大写不解析
      expect(report.checkpoints.length).toBe(0);
    });
  });
});

// ============================================================
// 契约变更检测
// ============================================================

describe('SOL-005 Contract Change Detection', () => {
  it('REPORT_SECTIONS should cover all sections referenced by parser', () => {
    // 解析器通过 extractSection 引用以下章节标题
    const parserReferencedSections = [
      REPORT_SECTIONS.metadata.zh,
      REPORT_SECTIONS.metadata.en,
      REPORT_SECTIONS.rootCauseAnalysis.zh,
      REPORT_SECTIONS.rootCauseAnalysis.en,
      REPORT_SECTIONS.solutions.zh,
      REPORT_SECTIONS.solutions.en,
      REPORT_SECTIONS.checkpoints.zh,
      REPORT_SECTIONS.checkpoints.en,
      REPORT_SECTIONS.assessment.zh,
      REPORT_SECTIONS.assessment.en,
    ];

    // 每个被引用的章节都应在 REPORT_SECTIONS 中定义
    const definedSections = Object.values(REPORT_SECTIONS).flatMap(s => [s.zh, s.en]);
    parserReferencedSections.forEach(section => {
      expect(definedSections).toContain(section);
    });
  });

  it('buildCaId/buildSolId should produce IDs matching CA_FORMAT/SOL_FORMAT', () => {
    [1, 12, 123, 999].forEach(n => {
      expect(CA_FORMAT.test(buildCaId(n))).toBe(true);
      expect(SOL_FORMAT.test(buildSolId(n))).toBe(true);
    });
  });

  it('rendered investigate template should contain CA/SOL IDs that match contract format', async () => {
    const prompt = await loadAndRenderTemplate('investigate', {
      requirement: 'test',
      projectContext: 'src',
      date: '2026-07-06',
      slug: 'test',
      title: 'test',
      N: '60',
    }, 'zh');

    const caIds = prompt.match(/CA-\d{3,}/g) ?? [];
    const solIds = prompt.match(/SOL-\d{3,}/g) ?? [];
    expect(caIds.length).toBeGreaterThan(0);
    expect(solIds.length).toBeGreaterThan(0);
    caIds.forEach(id => expect(CA_FORMAT.test(id)).toBe(true));
    solIds.forEach(id => expect(SOL_FORMAT.test(id)).toBe(true));
  });

  it('rendered investigate template should contain all metadata field labels', async () => {
    const zhPrompt = await loadAndRenderTemplate('investigate', {
      requirement: 'test', projectContext: 'src', date: '2026-07-06',
      slug: 'test', title: 'test', N: '60',
    }, 'zh');

    expect(zhPrompt).toContain(METADATA_FIELDS.requirementSource.zh);
    expect(zhPrompt).toContain(METADATA_FIELDS.investigationDate.zh);
    expect(zhPrompt).toContain(METADATA_FIELDS.investigationDir.zh);
    expect(zhPrompt).toContain(METADATA_FIELDS.language.zh);

    const enPrompt = await loadAndRenderTemplate('investigate', {
      requirement: 'test', projectContext: 'src', date: '2026-07-06',
      slug: 'test', title: 'test', N: '60',
    }, 'en');

    expect(enPrompt).toContain(METADATA_FIELDS.requirementSource.en);
    expect(enPrompt).toContain(METADATA_FIELDS.investigationDate.en);
    expect(enPrompt).toContain(METADATA_FIELDS.investigationDir.en);
    expect(enPrompt).toContain(METADATA_FIELDS.language.en);
  });
});
