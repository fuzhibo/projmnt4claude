/**
 * report-parser-contract.test.ts
 * 模板-解析器契约验证测试（CP-4 / CP-5）
 *
 * 验证 generateReport → parseReport 闭环数据一致性，
 * 防止模板输出格式与解析器正则再次断裂。
 */

import { generateReport } from '../utils/investigation/report-generator.js';
import { parseReport } from '../utils/investigation/report-parser.js';
import type { InvestigationReport } from '../utils/investigation/types.js';

const mockReport: InvestigationReport = {
  metadata: {
    requirementSource: '用户需求：调查 init-requirement 流水线超时问题',
    investigationDate: '2026-07-02',
    investigationDir: 'investigation-init-requirement-timeout',
    language: 'zh',
  },
  rootCauseAnalysis: [
    {
      id: 'CA-001',
      title: '模板正则不匹配',
      description: '模板输出格式缺少加粗标记，导致解析器提取 metadata 字段失败。',
    },
  ],
  solutions: [
    {
      id: 'SOL-001',
      title: '统一模板格式为加粗风格',
      correspondsTo: 'CA-001',
      description: '修改 zh.ts / en.ts 模板，添加 ** 加粗标记。',
      files: ['src/utils/prompt-templates/i18n/zh.ts', 'src/utils/prompt-templates/i18n/en.ts'],
      expectedChanges: '模板输出格式与解析器正则一致',
    },
  ],
  checkpoints: [
    {
      prefix: 'ai-qa',
      description: '验证模板输出格式与解析器正则一致',
      belongsTo: 'SOL-001',
    },
    {
      prefix: 'ai-qa',
      description: 'generate → parse 循环闭环测试',
      belongsTo: 'SOL-001',
    },
  ],
  assessment: {
    complexity: 'medium',
    impactScope: '中等',
    estimatedMinutes: 60,
  },
};

describe('Report Contract Validation (CP-4)', () => {
  it('zh: generateReport → parseReport 闭环一致', () => {
    const markdown = generateReport(mockReport, 'zh');
    const parsed = parseReport(markdown);

    expect(parsed.metadata.requirementSource).toBe(mockReport.metadata.requirementSource);
    expect(parsed.metadata.investigationDate).toBe(mockReport.metadata.investigationDate);
    expect(parsed.metadata.investigationDir).toBe(mockReport.metadata.investigationDir);
    expect(parsed.metadata.language).toBe('zh');
    expect(parsed.rootCauseAnalysis.length).toBe(mockReport.rootCauseAnalysis.length);
    expect(parsed.solutions.length).toBe(mockReport.solutions.length);
    expect(parsed.checkpoints.length).toBe(mockReport.checkpoints.length);
  });

  it('en: generateReport → parseReport 闭环一致 (CP-5)', () => {
    const enReport: InvestigationReport = {
      ...mockReport,
      metadata: { ...mockReport.metadata, language: 'en' },
    };
    const markdown = generateReport(enReport, 'en');
    const parsed = parseReport(markdown);

    expect(parsed.metadata.requirementSource).toBe(enReport.metadata.requirementSource);
    expect(parsed.metadata.investigationDate).toBe(enReport.metadata.investigationDate);
    expect(parsed.metadata.language).toBe('en');
  });
});

describe('Parser backward compatibility (CP-2 / CP-3)', () => {
  it('无加粗格式仍可解析 (CP-2)', () => {
    const markdown = `# 调查报告

- 需求来源: test-source
- 调查时间: 2026-01-01
- 调查目录: investigation-test
- 语言: zh

## 原因分析
### CA-001: 测试

## 解决方案
### SOL-001: 测试

## 检查点清单

## 评估
`;
    const parsed = parseReport(markdown);
    expect(parsed.metadata.requirementSource).toBe('test-source');
  });

  it('中文冒号兼容 (CP-3)', () => {
    const markdown = `# 调查报告

- **需求来源**：test-source-cn-colon
- **调查时间**：2026-01-01
- **调查目录**：investigation-test
- **语言**：zh

## 原因分析
### CA-001: 测试

## 解决方案
### SOL-001: 测试

## 检查点清单

## 评估
`;
    const parsed = parseReport(markdown);
    expect(parsed.metadata.requirementSource).toBe('test-source-cn-colon');
    expect(parsed.metadata.investigationDate).toBe('2026-01-01');
    expect(parsed.metadata.investigationDir).toBe('investigation-test');
    expect(parsed.metadata.language).toBe('zh');
  });
});
