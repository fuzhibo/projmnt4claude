/**
 * report-parser-hardening.test.ts
 * 正则容错增强：格式变体测试覆盖 (CP-4 / CP-5 / CP-6)
 *
 * 覆盖调查报告中的 5 种格式变体 + 多行值测试
 */

import { parseReport, extractDependenciesFromMarkdown } from '../utils/investigation/report-parser.js';

const validReportHeader = `## 检查点覆盖清单

## 评估

- 复杂度: medium
- 影响范围: 中等
- 预估工时: 60
`;

describe('extractField format variants', () => {
  it('CP-1: 无加粗格式仍可解析', () => {
    const md = `# 调查报告\n\n- 需求来源: test-value\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('test-value');
  });

  it('CP-2: 中文冒号兼容（加粗）', () => {
    const md = `# 调查报告\n\n- **需求来源**：cn-colon-value\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('cn-colon-value');
  });

  it('CP-3: 冒号后无空格', () => {
    const md = `# 调查报告\n\n- **需求来源**:no-space\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('no-space');
  });

  it('标准格式（加粗 + 英文冒号）', () => {
    const md = `# 调查报告\n\n- **需求来源**: standard-value\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('standard-value');
  });

  it('中文冒号无加粗', () => {
    const md = `# 调查报告\n\n- 需求来源：cn-colon-no-bold\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('cn-colon-no-bold');
  });

  it('冒号后无空格无加粗', () => {
    const md = `# 调查报告\n\n- 需求来源:no-space-no-bold\n\n${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('no-space-no-bold');
  });

  it('多字段统一格式变体', () => {
    const md = `# 调查报告

- **需求来源**: standard
- 调查时间: 2026-01-01
- **调查目录**：investigation-test
- 语言:zh

${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('standard');
    expect(parsed.metadata.investigationDate).toBe('2026-01-01');
    expect(parsed.metadata.investigationDir).toBe('investigation-test');
    expect(parsed.metadata.language).toBe('zh');
  });
});

describe('extractField multi-line values (CP-4)', () => {
  it('缩进续行合并到首行值', () => {
    const md = `# 调查报告

- **需求来源**: 第一行
  第二行

${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('第一行\n第二行');
  });

  it('三行续行全部合并', () => {
    const md = `# 调查报告

- **需求来源**: 第一行
  第二行
  第三行

${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('第一行\n第二行\n第三行');
  });

  it('四行续行全部合并', () => {
    const md = `# 调查报告

- **调查目录**: path/to
  /continued/dir
  /more/path
  /final

${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.investigationDir).toBe('path/to\n/continued/dir\n/more/path\n/final');
  });

  it('Tab 缩进续行合并', () => {
    const md = `# 调查报告

- **需求来源**: 首行
\t续行1
\t续行2

${validReportHeader}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('首行\n续行1\n续行2');
  });
});

describe('extractInlineField format variants', () => {
  it('标准格式加粗英文冒号', () => {
    const md = `# 调查报告

- **需求来源**: test

## 评估

- **复杂度**: high
- **影响范围**: 广泛
- **预估工时**: 30
`;
    const parsed = parseReport(md);
    expect(parsed.assessment.complexity).toBe('high');
    expect(parsed.assessment.impactScope).toBe('广泛');
    expect(parsed.assessment.estimatedMinutes).toBe(30);
  });

  it('无加粗中文冒号', () => {
    const md = `# 调查报告

- **需求来源**: test

## 评估

- 复杂度：low
- 影响范围：小
- 预估工时：15
`;
    const parsed = parseReport(md);
    expect(parsed.assessment.complexity).toBe('low');
    expect(parsed.assessment.estimatedMinutes).toBe(15);
  });
});

describe('extractDependenciesFromMarkdown format variants', () => {
  it('标准加粗英文冒号', () => {
    const md = `- **依赖子报告**: docs/a.md, docs/b.md`;
    expect(extractDependenciesFromMarkdown(md)).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('中文冒号', () => {
    const md = `- **依赖子报告**：docs/c.md`;
    expect(extractDependenciesFromMarkdown(md)).toEqual(['docs/c.md']);
  });

  it('无加粗', () => {
    const md = `- 依赖子报告: docs/d.md, docs/e.md`;
    expect(extractDependenciesFromMarkdown(md)).toEqual(['docs/d.md', 'docs/e.md']);
  });

  it('无加粗中文冒号', () => {
    const md = `- Depends On：docs/f.md`;
    expect(extractDependenciesFromMarkdown(md)).toEqual(['docs/f.md']);
  });
});

describe('validateImpactScope value-domain narrowing (CP-8)', () => {
  function buildReport(impactRaw: string): string {
    return `# 调查报告

- **需求来源**: test

## 评估

- **复杂度**: medium
- **影响范围**: ${impactRaw}
- **预估工时**: 60
`;
  }

  it('中文 "有限" → 有限', () => {
    const parsed = parseReport(buildReport('有限'));
    expect(parsed.assessment.impactScope).toBe('有限');
  });

  it('中文 "中等" → 中等', () => {
    const parsed = parseReport(buildReport('中等'));
    expect(parsed.assessment.impactScope).toBe('中等');
  });

  it('中文 "广泛" → 广泛', () => {
    const parsed = parseReport(buildReport('广泛'));
    expect(parsed.assessment.impactScope).toBe('广泛');
  });

  it('英文 "limited" → 有限', () => {
    const parsed = parseReport(buildReport('limited'));
    expect(parsed.assessment.impactScope).toBe('有限');
  });

  it('英文 "medium" → 中等', () => {
    const parsed = parseReport(buildReport('medium'));
    expect(parsed.assessment.impactScope).toBe('中等');
  });

  it('英文 "moderate" → 中等', () => {
    const parsed = parseReport(buildReport('moderate'));
    expect(parsed.assessment.impactScope).toBe('中等');
  });

  it('英文 "wide" → 广泛', () => {
    const parsed = parseReport(buildReport('wide'));
    expect(parsed.assessment.impactScope).toBe('广泛');
  });

  it('英文 "broad" → 广泛', () => {
    const parsed = parseReport(buildReport('broad'));
    expect(parsed.assessment.impactScope).toBe('广泛');
  });

  it('英文 "extensive" → 广泛', () => {
    const parsed = parseReport(buildReport('extensive'));
    expect(parsed.assessment.impactScope).toBe('广泛');
  });

  it('非标准值回退到 "中等"', () => {
    const parsed = parseReport(buildReport('unknown-value'));
    expect(parsed.assessment.impactScope).toBe('中等');
  });

  it('空评估段默认值 "中等"', () => {
    const parsed = parseReport(`# 调查报告

- **需求来源**: test

## 评估

- **复杂度**: medium
`);
    expect(parsed.assessment.impactScope).toBe('中等');
  });
});

describe('English label variants (CP-5)', () => {
  const validReportHeaderEn = `## Checkpoint Checklist

## Assessment

- Complexity: medium
- Impact Scope: moderate
- Estimated Minutes: 60
`;

  it('Requirement Source label', () => {
    const md = `# Investigation Report

- **Requirement Source**: test-source

${validReportHeaderEn}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.requirementSource).toBe('test-source');
  });

  it('Investigation Date label', () => {
    const md = `# Investigation Report

- **Investigation Date**: 2026-01-01

${validReportHeaderEn}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.investigationDate).toBe('2026-01-01');
  });

  it('Investigation Dir label', () => {
    const md = `# Investigation Report

- **Investigation Dir**: docs/en-test

${validReportHeaderEn}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.investigationDir).toBe('docs/en-test');
  });

  it('Language label', () => {
    const md = `# Investigation Report

- **Language**: en

${validReportHeaderEn}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.language).toBe('en');
  });

  it('Parent Report label', () => {
    const md = `# Investigation Report

- **Parent Report**: docs/parent.md

${validReportHeaderEn}`;
    const parsed = parseReport(md);
    expect(parsed.metadata.parentReport).toBe('docs/parent.md');
  });

  it('Depends On label', () => {
    const md = `- **Depends On**: docs/dep1.md, docs/dep2.md`;
    expect(extractDependenciesFromMarkdown(md)).toEqual(['docs/dep1.md', 'docs/dep2.md']);
  });
});
