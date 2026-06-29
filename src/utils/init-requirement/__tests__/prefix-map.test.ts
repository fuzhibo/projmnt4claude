/**
 * PREFIX_MAP + parseCheckpoint 单元测试
 *
 * 覆盖检查点 §3.1 和 §3.2：
 * - 3.1 PREFIX_MAP：4 种 System B 前缀映射正确、category/verificationMethod/requiresHuman 完整
 * - 3.2 检查点解析：System B 前缀解析、System A 废弃警告迁移、无前缀报错
 */

import { describe, test, expect } from '@jest/globals';
import {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  hasValidPrefix,
  hasDeprecatedPrefix,
} from '../prefix-map.js';

// ============================================================
// §3.1 PREFIX_MAP 测试
// ============================================================

describe('PREFIX_MAP (§3.1)', () => {
  test('contains all 4 System B prefixes only', () => {
    expect(VALID_PREFIXES).toEqual([
      'ai-review',
      'ai-qa',
      'human-qa',
      'script',
    ]);
    expect(Object.keys(PREFIX_MAP).length).toBe(4);
  });

  test('ai-review: category=code_review, method=code_review, requiresHuman=false', () => {
    expect(PREFIX_MAP['ai-review']).toEqual({
      category: 'code_review',
      method: 'code_review',
      requiresHuman: false,
    });
  });

  test('ai-qa: category=qa_verification, method=automated, requiresHuman=false', () => {
    expect(PREFIX_MAP['ai-qa']).toEqual({
      category: 'qa_verification',
      method: 'automated',
      requiresHuman: false,
    });
  });

  test('human-qa: category=qa_verification, method=automated, requiresHuman=true', () => {
    expect(PREFIX_MAP['human-qa']).toEqual({
      category: 'qa_verification',
      method: 'automated',
      requiresHuman: true,
    });
  });

  test('script: category=evaluation, method=automated, requiresHuman=false', () => {
    expect(PREFIX_MAP['script']).toEqual({
      category: 'evaluation',
      method: 'automated',
      requiresHuman: false,
    });
  });

  test('every prefix has complete category/method/requiresHuman', () => {
    for (const prefix of VALID_PREFIXES) {
      const entry = PREFIX_MAP[prefix]!;
      expect(entry.category).toBeTruthy();
      expect(entry.method).toBeTruthy();
      expect(typeof entry.requiresHuman).toBe('boolean');
    }
  });
});

// ============================================================
// §3.2 检查点解析测试 - System B
// ============================================================

describe('parseCheckpoint - System B (§3.2)', () => {
  test('parses [ai review] prefix → category=code_review', () => {
    const result = parseCheckpoint('[ai review] 检查代码质量');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
    expect(result!.description).toBe('检查代码质量');
    expect(result!.category).toBe('code_review');
    expect(result!.verificationMethod).toBe('code_review');
    expect(result!.requiresHuman).toBe(false);
    expect(result!.warnings).toEqual([]);
  });

  test('parses [ai qa] prefix → category=qa_verification', () => {
    const result = parseCheckpoint('[ai qa] 测试登录流程');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('测试登录流程');
    expect(result!.category).toBe('qa_verification');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
    expect(result!.warnings).toEqual([]);
  });

  test('parses [human qa] prefix → requiresHuman=true', () => {
    const result = parseCheckpoint('[human qa] 人工审核UI');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('human-qa');
    expect(result!.description).toBe('人工审核UI');
    expect(result!.category).toBe('qa_verification');
    expect(result!.requiresHuman).toBe(true);
    expect(result!.warnings).toEqual([]);
  });

  test('parses [script] prefix → category=evaluation', () => {
    const result = parseCheckpoint('[script] 运行性能基准测试');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('script');
    expect(result!.description).toBe('运行性能基准测试');
    expect(result!.category).toBe('evaluation');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
    expect(result!.warnings).toEqual([]);
  });

  test('parses prefix case-insensitively', () => {
    const result = parseCheckpoint('[AI REVIEW] 检查代码');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
  });
});

// ============================================================
// §3.2b 废弃前缀迁移测试
// ============================================================

describe('parseCheckpoint - deprecated System A migration', () => {
  test('[verify] migrates to [ai qa] with warning', () => {
    const result = parseCheckpoint('[verify] 验证JWT token有效性');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] 验证JWT token有效性');
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0]).toContain('已废弃');
    expect(result!.warnings[0]).toContain('[verify]');
  });

  test('[test] migrates to [ai qa] with warning', () => {
    const result = parseCheckpoint('[test] 测试认证流程');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] 测试认证流程');
    expect(result!.warnings).toHaveLength(1);
  });

  test('[review] migrates to [ai review] with warning', () => {
    const result = parseCheckpoint('[review] 审核安全实现');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
    expect(result!.description).toBe('[ai review] 审核安全实现');
    expect(result!.warnings).toHaveLength(1);
  });

  test('[implem] migrates to [ai qa] with warning', () => {
    const result = parseCheckpoint('[implem] 实现密码哈希');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] (implementation) 实现密码哈希');
    expect(result!.warnings).toHaveLength(1);
  });

  test('[doc] migrates to [script] with warning', () => {
    const result = parseCheckpoint('[doc] 更新API文档');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('script');
    expect(result!.description).toBe('[script] (doc) 更新API文档');
    expect(result!.warnings).toHaveLength(1);
  });
});

// ============================================================
// §3.2c 无效输入测试
// ============================================================

describe('parseCheckpoint - invalid inputs', () => {
  test('returns null for invalid prefix', () => {
    expect(parseCheckpoint('[invalid] test')).toBeNull();
  });

  test('returns null for missing prefix', () => {
    expect(parseCheckpoint('plain text without prefix')).toBeNull();
  });

  test('returns null for malformed prefix (missing brackets)', () => {
    expect(parseCheckpoint('verify] missing bracket')).toBeNull();
    expect(parseCheckpoint('[verify missing closing bracket')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseCheckpoint('')).toBeNull();
  });

  test('returns null for string with only whitespace', () => {
    expect(parseCheckpoint('   ')).toBeNull();
  });
});

// ============================================================
// §3.3 hasValidPrefix 测试
// ============================================================

describe('hasValidPrefix', () => {
  test('returns true for System B prefixes', () => {
    expect(hasValidPrefix('[ai review] code quality')).toBe(true);
    expect(hasValidPrefix('[ai qa] test coverage')).toBe(true);
    expect(hasValidPrefix('[human qa] manual check')).toBe(true);
    expect(hasValidPrefix('[script] auto verify')).toBe(true);
  });

  test('returns false for System A prefixes (deprecated)', () => {
    expect(hasValidPrefix('[verify] test')).toBe(false);
    expect(hasValidPrefix('[test] something')).toBe(false);
    expect(hasValidPrefix('[review] code')).toBe(false);
    expect(hasValidPrefix('[implem] feature')).toBe(false);
    expect(hasValidPrefix('[doc] update')).toBe(false);
  });

  test('returns false for invalid or missing prefix', () => {
    expect(hasValidPrefix('no prefix')).toBe(false);
    expect(hasValidPrefix('[invalid] test')).toBe(false);
    expect(hasValidPrefix('')).toBe(false);
    expect(hasValidPrefix('[verify test')).toBe(false);
  });
});

// ============================================================
// §3.4 hasDeprecatedPrefix 测试
// ============================================================

describe('hasDeprecatedPrefix', () => {
  test('returns true for System A prefixes', () => {
    expect(hasDeprecatedPrefix('[verify] test')).toBe(true);
    expect(hasDeprecatedPrefix('[test] something')).toBe(true);
    expect(hasDeprecatedPrefix('[review] code')).toBe(true);
    expect(hasDeprecatedPrefix('[implem] feature')).toBe(true);
    expect(hasDeprecatedPrefix('[doc] update')).toBe(true);
  });

  test('returns false for System B prefixes', () => {
    expect(hasDeprecatedPrefix('[ai review] code')).toBe(false);
    expect(hasDeprecatedPrefix('[ai qa] test')).toBe(false);
    expect(hasDeprecatedPrefix('[human qa] manual')).toBe(false);
    expect(hasDeprecatedPrefix('[script] auto')).toBe(false);
  });

  test('returns false for invalid or missing prefix', () => {
    expect(hasDeprecatedPrefix('no prefix')).toBe(false);
    expect(hasDeprecatedPrefix('[invalid] test')).toBe(false);
    expect(hasDeprecatedPrefix('')).toBe(false);
  });
});
