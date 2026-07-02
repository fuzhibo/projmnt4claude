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
