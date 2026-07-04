/**
 * 检查点格式契约一致性测试
 *
 * 验证模板、解析器、共享规范三者之间的契约一致性。
 * 确保 AI 输出格式与解析器期望格式完全匹配。
 */

import { describe, it, expect } from '@jest/globals';
import { CheckpointFormat, VALID_CHECKPOINT_PREFIXES, PREFIX_NORMALIZE_MAP } from '../checkpoint-format.js';
import { investigationTemplates } from '../../prompt-templates/i18n/zh.js';
import { investigationTemplates as enTemplates } from '../../prompt-templates/i18n/en.js';
import { parseReport } from '../report-parser.js';
import { generateReport } from '../report-generator.js';
import type { InvestigationReport } from '../types.js';

// ============================================================
// §1 共享格式规范基础测试
// ============================================================

describe('§1 共享格式规范', () => {
  describe('VALID_CHECKPOINT_PREFIXES', () => {
    it('should have exactly 4 standard prefixes', () => {
      expect(VALID_CHECKPOINT_PREFIXES).toHaveLength(4);
      expect(VALID_CHECKPOINT_PREFIXES).toContain('ai review');
      expect(VALID_CHECKPOINT_PREFIXES).toContain('ai qa');
      expect(VALID_CHECKPOINT_PREFIXES).toContain('human qa');
      expect(VALID_CHECKPOINT_PREFIXES).toContain('script');
    });
  });

  describe('PREFIX_NORMALIZE_MAP', () => {
    it('should normalize all System A legacy prefixes', () => {
      expect(PREFIX_NORMALIZE_MAP['ai']).toBe('ai-qa');
      expect(PREFIX_NORMALIZE_MAP['review']).toBe('ai-review');
      expect(PREFIX_NORMALIZE_MAP['qa']).toBe('ai-qa');
      expect(PREFIX_NORMALIZE_MAP['human']).toBe('human-qa');
    });

    it('should keep System B prefixes unchanged', () => {
      expect(PREFIX_NORMALIZE_MAP['ai review']).toBe('ai-review');
      expect(PREFIX_NORMALIZE_MAP['ai qa']).toBe('ai-qa');
      expect(PREFIX_NORMALIZE_MAP['human qa']).toBe('human-qa');
      expect(PREFIX_NORMALIZE_MAP['script']).toBe('script');
    });

    it('should normalize hyphenated variants', () => {
      expect(PREFIX_NORMALIZE_MAP['ai-review']).toBe('ai-review');
      expect(PREFIX_NORMALIZE_MAP['ai-qa']).toBe('ai-qa');
      expect(PREFIX_NORMALIZE_MAP['human-qa']).toBe('human-qa');
    });
  });
});

// ============================================================
// §2 检查点生成器测试
// ============================================================

describe('§2 检查点生成器', () => {
  describe('CheckpointFormat.generate', () => {
    it('should generate full format with arrow', () => {
      const result = CheckpointFormat.generate('ai-qa', '测试功能', 'SOL-001');
      expect(result).toBe('- [ai-qa] 测试功能 → SOL-001');
    });

    it('should generate with ai review prefix', () => {
      const result = CheckpointFormat.generate('ai-review', '检查设计方案', 'SOL-002');
      expect(result).toBe('- [ai-review] 检查设计方案 → SOL-002');
    });

    it('should generate with script prefix', () => {
      const result = CheckpointFormat.generate('script', '运行单元测试', 'SOL-003');
      expect(result).toBe('- [script] 运行单元测试 → SOL-003');
    });
  });

  describe('CheckpointFormat.generateSectionTitle', () => {
    it('should generate Chinese section title', () => {
      const result = CheckpointFormat.generateSectionTitle('SOL-001', 'zh');
      expect(result).toBe('### SOL-001 相关检查点');
    });

    it('should generate English section title', () => {
      const result = CheckpointFormat.generateSectionTitle('SOL-001', 'en');
      expect(result).toBe('### SOL-001 Related Checkpoints');
    });
  });
});

// ============================================================
// §3 检查点验证器测试
// ============================================================

describe('§3 检查点验证器', () => {
  describe('CheckpointFormat.validateFull', () => {
    it('should validate full format with belongsTo', () => {
      const result = CheckpointFormat.validateFull('- [ai qa] 测试功能 → SOL-001');
      expect(result.valid).toBe(true);
      expect(result.prefix).toBe('ai-qa');
      expect(result.description).toBe('测试功能');
      expect(result.belongsTo).toBe('SOL-001');
    });

    it('should validate full format with parenthesized belongsTo', () => {
      const result = CheckpointFormat.validateFull('- [ai review] 检查代码 (→ SOL-002)');
      expect(result.valid).toBe(true);
      expect(result.prefix).toBe('ai-review');
      expect(result.belongsTo).toBe('SOL-002');
    });

    it('should reject simple format without belongsTo', () => {
      const result = CheckpointFormat.validateFull('- [ai qa] 测试功能');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid prefix', () => {
      const result = CheckpointFormat.validateFull('- [invalid] 测试功能 → SOL-001');
      expect(result.valid).toBe(false);
    });
  });

  describe('CheckpointFormat.validateSimple', () => {
    it('should validate simple format without belongsTo', () => {
      const result = CheckpointFormat.validateSimple('- [ai qa] 测试功能');
      expect(result.valid).toBe(true);
      expect(result.prefix).toBe('ai-qa');
      expect(result.description).toBe('测试功能');
    });

    it('should validate simple format with human qa', () => {
      const result = CheckpointFormat.validateSimple('- [human qa] 手动验证');
      expect(result.valid).toBe(true);
      expect(result.prefix).toBe('human-qa');
    });

    it('should reject non-checkpoint line', () => {
      const result = CheckpointFormat.validateSimple('普通文本');
      expect(result.valid).toBe(false);
    });
  });

  describe('CheckpointFormat.normalizePrefix', () => {
    it('should normalize System A to System B', () => {
      expect(CheckpointFormat.normalizePrefix('ai')).toBe('ai-qa');
      expect(CheckpointFormat.normalizePrefix('review')).toBe('ai-review');
      expect(CheckpointFormat.normalizePrefix('qa')).toBe('ai-qa');
    });

    it('should keep System B unchanged', () => {
      expect(CheckpointFormat.normalizePrefix('ai-qa')).toBe('ai-qa');
      expect(CheckpointFormat.normalizePrefix('script')).toBe('script');
    });

    it('should return null for unknown prefix', () => {
      expect(CheckpointFormat.normalizePrefix('unknown')).toBeNull();
    });
  });

  describe('CheckpointFormat.extractSolFromTitle', () => {
    it('should extract SOL from Chinese title', () => {
      const result = CheckpointFormat.extractSolFromTitle('### SOL-001 相关检查点');
      expect(result).toBe('SOL-001');
    });

    it('should extract SOL from English title', () => {
      const result = CheckpointFormat.extractSolFromTitle('### SOL-002 Related Checkpoints');
      expect(result).toBe('SOL-002');
    });

    it('should return null for non-title', () => {
      const result = CheckpointFormat.extractSolFromTitle('### 其他标题');
      expect(result).toBeNull();
    });
  });

  describe('CheckpointFormat.inferBelongsToFromContext', () => {
    it('should infer belongsTo from nearest section title', () => {
      const section = '### SOL-001 相关检查点\n- [ai qa] 测试功能\n### SOL-002 相关检查点\n- [ai review] 检查代码';
      // Index of "- [ai review]" line
      const idx = section.indexOf('- [ai review]');
      const result = CheckpointFormat.inferBelongsToFromContext(section, idx);
      expect(result).toBe('SOL-002');
    });

    it('should infer belongsTo from first section title', () => {
      const section = '### SOL-001 相关检查点\n- [ai qa] 测试功能';
      const idx = section.indexOf('- [ai qa]');
      const result = CheckpointFormat.inferBelongsToFromContext(section, idx);
      expect(result).toBe('SOL-001');
    });

    it('should return empty string when no section title', () => {
      const section = '- [ai qa] 测试功能';
      const result = CheckpointFormat.inferBelongsToFromContext(section, 0);
      expect(result).toBe('');
    });
  });
});

// ============================================================
// §4 模板与解析器契约一致性测试（核心）
// ============================================================

describe('§4 模板-解析器契约一致性', () => {
  describe('zh.ts 模板检查点示例', () => {
    it('should contain full format with → SOL-NNN in investigate template', () => {
      const template = investigationTemplates.investigate;
      expect(template).toContain('→ SOL-001');
      expect(template).toContain('- [ai review]');
      expect(template).toContain('- [ai qa]');
      expect(template).toContain('- [script]');
    });

    it('should contain checkpoint format instruction in notes', () => {
      const template = investigationTemplates.investigate;
      expect(template).toContain('检查点格式：');
      expect(template).toContain("'- [prefix] 描述 → SOL-NNN'");
    });

    it('should contain section title format in template', () => {
      const template = investigationTemplates.investigate;
      expect(template).toContain('### SOL-001 相关检查点');
    });
  });

  describe('en.ts 模板检查点示例', () => {
    it('should contain full format with → SOL-NNN in investigate template', () => {
      const template = enTemplates.investigate;
      expect(template).toContain('→ SOL-001');
      expect(template).toContain('- [ai review]');
      expect(template).toContain('- [ai qa]');
      expect(template).toContain('- [script]');
    });

    it('should contain checkpoint format instruction in notes', () => {
      const template = enTemplates.investigate;
      expect(template).toContain('Checkpoint format:');
      expect(template).toContain("'- [prefix] description → SOL-NNN'");
    });

    it('should contain section title format in template', () => {
      const template = enTemplates.investigate;
      expect(template).toContain('### SOL-001 Related Checkpoints');
    });
  });

  describe('模板示例可被解析器正确解析', () => {
    const createReportFromTemplate = (): InvestigationReport => ({
      metadata: {
        requirementSource: 'CA-004 test',
        investigationDate: '2026-07-03',
        investigationDir: 'investigation-ca-004',
        language: 'zh',
      },
      rootCauseAnalysis: [
        { id: 'CA-001', title: '模板格式不匹配', description: '模板示例与解析器期望不一致' },
      ],
      solutions: [
        {
          id: 'SOL-001',
          title: '更新模板示例',
          correspondsTo: 'CA-001',
          description: '更新模板示例以包含完整格式',
          files: ['src/utils/prompt-templates/i18n/zh.ts'],
          expectedChanges: '更新检查点示例',
        },
      ],
      checkpoints: [
        { prefix: 'ai-review', description: '验证模板示例包含完整格式', belongsTo: 'SOL-001' },
        { prefix: 'ai-qa', description: '验证模板示例能被正确解析', belongsTo: 'SOL-001' },
        { prefix: 'script', description: '运行模板渲染测试', belongsTo: 'SOL-001' },
      ],
      assessment: {
        complexity: 'low',
        impactScope: '有限',
        estimatedMinutes: 60,
      },
    });

    it('should roundtrip full format checkpoints', () => {
      const report = createReportFromTemplate();
      const md = generateReport(report, 'zh');
      const parsed = parseReport(md);

      expect(parsed.checkpoints).toHaveLength(3);
      expect(parsed.checkpoints[0]).toMatchObject({
        prefix: 'ai-review',
        description: '验证模板示例包含完整格式',
        belongsTo: 'SOL-001',
      });
      expect(parsed.checkpoints[1]).toMatchObject({
        prefix: 'ai-qa',
        description: '验证模板示例能被正确解析',
        belongsTo: 'SOL-001',
      });
      expect(parsed.checkpoints[2]).toMatchObject({
        prefix: 'script',
        description: '运行模板渲染测试',
        belongsTo: 'SOL-001',
      });
    });
  });

  describe('分组标题推断契约', () => {
    it('should infer belongsTo from section title when missing inline', () => {
      const md = `
# 调查报告

## 检查点覆盖清单
### SOL-001 相关检查点
- [ai qa] 验证功能
- [script] 运行测试
### SOL-002 相关检查点
- [ai review] 检查代码

## 评估
- 复杂度: low
- 影响范围: 有限
- 预估工时: 60 分钟
`;
      const parsed = parseReport(md);
      expect(parsed.checkpoints).toHaveLength(3);
      expect(parsed.checkpoints[0]?.belongsTo).toBe('SOL-001');
      expect(parsed.checkpoints[1]?.belongsTo).toBe('SOL-001');
      expect(parsed.checkpoints[2]?.belongsTo).toBe('SOL-002');
    });

    it('should prefer inline belongsTo over section title inference', () => {
      const md = `
# 调查报告

## 检查点覆盖清单
### SOL-001 相关检查点
- [ai qa] 验证功能 → SOL-001
- [script] 运行测试 → SOL-001

## 评估
- 复杂度: low
- 影响范围: 有限
- 预估工时: 60 分钟
`;
      const parsed = parseReport(md);
      expect(parsed.checkpoints).toHaveLength(2);
      expect(parsed.checkpoints[0]?.belongsTo).toBe('SOL-001');
      expect(parsed.checkpoints[1]?.belongsTo).toBe('SOL-001');
    });
  });
});

// ============================================================
// §5 契约验证器测试
// ============================================================

describe('§5 契约验证器', () => {
  describe('CheckpointFormat.validateContract', () => {
    it('should validate valid full format contract', () => {
      const md = `### SOL-001 相关检查点
- [ai qa] 验证功能 → SOL-001
- [script] 运行测试 → SOL-001`;
      const result = CheckpointFormat.validateContract(md);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid simple format with section title', () => {
      const md = `### SOL-001 相关检查点
- [ai qa] 验证功能
- [script] 运行测试`;
      const result = CheckpointFormat.validateContract(md);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on simple format without section title', () => {
      const md = `- [ai qa] 验证功能
- [script] 运行测试`;
      const result = CheckpointFormat.validateContract(md);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn on belongsTo mismatch with section title', () => {
      const md = `### SOL-001 相关检查点
- [ai qa] 验证功能 → SOL-002`;
      const result = CheckpointFormat.validateContract(md);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('SOL-002');
      expect(result.warnings[0]).toContain('SOL-001');
    });
  });
});

// ============================================================
// §6 CA-004 回归测试
// ============================================================

describe('§6 CA-004 回归测试', () => {
  it('should not reproduce CA-004-1: template missing belongsTo suffix', () => {
    // 模板现在包含完整格式
    const template = investigationTemplates['investigate'];
    const hasBelongsTo = template?.includes('→ SOL-001') ?? false;
    expect(hasBelongsTo).toBe(true);

    // 解析器可以解析完整格式
    const md = `- [ai qa] 验证功能 → SOL-001`;
    const result = CheckpointFormat.validateFull(md);
    expect(result.valid).toBe(true);
    expect(result.belongsTo).toBe('SOL-001');
  });

  it('should not reproduce CA-004-2: parser not handling section titles', () => {
    // 解析器已实现 inferBelongsToFromContext
    const md = `### SOL-001 相关检查点
- [ai qa] 验证功能`;
    const parsed = parseReport(`# 调查报告

## 检查点覆盖清单
${md}

## 评估
- 复杂度: low
- 影响范围: 有限
- 预估工时: 60 分钟
`);
    expect(parsed.checkpoints[0]?.belongsTo).toBe('SOL-001');
  });

  it('should not reproduce CA-004-4: template and parser not sharing format spec', () => {
    // 现在共享规范存在
    expect(CheckpointFormat).toBeDefined();
    expect(VALID_CHECKPOINT_PREFIXES).toHaveLength(4);

    // 模板前缀与规范一致
    const template = investigationTemplates.investigate;
    for (const prefix of VALID_CHECKPOINT_PREFIXES) {
      expect(template).toContain(`[${prefix}]`);
    }
  });
});
