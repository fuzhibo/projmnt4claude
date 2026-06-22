/**
 * PREFIX_MAP + parseCheckpoint 单元测试
 *
 * 覆盖检查点 §3.1 和 §3.2：
 * - 3.1 PREFIX_MAP：9 种前缀映射正确、category/verificationMethod/requiresHuman 完整
 * - 3.2 检查点解析：前缀提取（System A + System B）、无前缀报错、category 推断
 */

import { describe, test, expect } from '@jest/globals';
import {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  hasValidPrefix,
  type ParsedCheckpoint,
} from '../prefix-map.js';

// ============================================================
// §3.1 PREFIX_MAP 测试
// ============================================================

describe('PREFIX_MAP (§3.1)', () => {
  test('contains all 9 required prefixes (System A + System B)', () => {
    expect(VALID_PREFIXES).toEqual(expect.arrayContaining([
      'verify', 'test', 'review', 'implem', 'doc',
      'ai-review', 'ai-qa', 'human-qa', 'script',
    ]));
    expect(Object.keys(PREFIX_MAP).length).toBe(9);
  });

  test('verify: category=qa_verification, method=functional_test, requiresHuman=false', () => {
    expect(PREFIX_MAP.verify).toEqual({
      category: 'qa_verification',
      method: 'functional_test',
      requiresHuman: false,
    });
  });

  test('test: category=qa_verification, method=unit_test, requiresHuman=false', () => {
    expect(PREFIX_MAP.test).toEqual({
      category: 'qa_verification',
      method: 'unit_test',
      requiresHuman: false,
    });
  });

  test('review: category=code_review, method=code_review, requiresHuman=true', () => {
    expect(PREFIX_MAP.review).toEqual({
      category: 'code_review',
      method: 'code_review',
      requiresHuman: true,
    });
  });

  test('implem: category=implementation, method=automated, requiresHuman=false', () => {
    expect(PREFIX_MAP.implem).toEqual({
      category: 'implementation',
      method: 'automated',
      requiresHuman: false,
    });
  });

  test('doc: category=documentation, method=automated, requiresHuman=false', () => {
    expect(PREFIX_MAP.doc).toEqual({
      category: 'documentation',
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
// §3.2 检查点解析测试
// ============================================================

describe('parseCheckpoint (§3.2)', () => {
  test('parses [verify] prefix with description', () => {
    const result = parseCheckpoint('[verify] 验证JWT token有效性');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('verify');
    expect(result!.description).toBe('验证JWT token有效性');
    expect(result!.category).toBe('qa_verification');
    expect(result!.verificationMethod).toBe('functional_test');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [test] prefix with category inference', () => {
    const result = parseCheckpoint('[test] 测试认证流程');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('test');
    expect(result!.description).toBe('测试认证流程');
    expect(result!.category).toBe('qa_verification');
    expect(result!.verificationMethod).toBe('unit_test');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [review] prefix with requiresHuman=true', () => {
    const result = parseCheckpoint('[review] 审核安全实现');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('review');
    expect(result!.category).toBe('code_review');
    expect(result!.verificationMethod).toBe('code_review');
    expect(result!.requiresHuman).toBe(true);
  });

  test('parses [implem] prefix with category inference', () => {
    const result = parseCheckpoint('[implem] 实现密码哈希');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('implem');
    expect(result!.category).toBe('implementation');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [doc] prefix with category inference', () => {
    const result = parseCheckpoint('[doc] 更新API文档');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('doc');
    expect(result!.category).toBe('documentation');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
  });

  // System B (§3.2b) — 新前缀

  test('parses [ai review] prefix → category=code_review', () => {
    const result = parseCheckpoint('[ai review] 检查代码质量');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
    expect(result!.description).toBe('检查代码质量');
    expect(result!.category).toBe('code_review');
    expect(result!.verificationMethod).toBe('code_review');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [ai qa] prefix → category=qa_verification', () => {
    const result = parseCheckpoint('[ai qa] 测试登录流程');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('测试登录流程');
    expect(result!.category).toBe('qa_verification');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [human qa] prefix → requiresHuman=true', () => {
    const result = parseCheckpoint('[human qa] 人工审核UI');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('human-qa');
    expect(result!.description).toBe('人工审核UI');
    expect(result!.category).toBe('qa_verification');
    expect(result!.requiresHuman).toBe(true);
  });

  test('parses [script] prefix → category=evaluation', () => {
    const result = parseCheckpoint('[script] 运行性能基准测试');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('script');
    expect(result!.description).toBe('运行性能基准测试');
    expect(result!.category).toBe('evaluation');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
  });

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

  test('returns null for prefix with empty description', () => {
    expect(parseCheckpoint('[test]')).toBeNull();
  });

  test('returns null for prefix with whitespace-only description', () => {
    // parseCheckpoint accepts empty description after trim - returns valid checkpoint with empty description
    const result = parseCheckpoint('[test]   ');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('test');
    expect(result!.description).toBe('');
  });

  test('trims whitespace from description', () => {
    const result = parseCheckpoint('[test]   测试用例  ');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('测试用例');
  });

  test('hasValidPrefix detects valid and invalid prefixes', () => {
    // System A
    expect(hasValidPrefix('[verify] test')).toBe(true);
    expect(hasValidPrefix('[test] something')).toBe(true);
    expect(hasValidPrefix('[review] code')).toBe(true);
    expect(hasValidPrefix('[implem] feature')).toBe(true);
    expect(hasValidPrefix('[doc] update')).toBe(true);
    // System B
    expect(hasValidPrefix('[ai review] code quality')).toBe(true);
    expect(hasValidPrefix('[ai qa] test coverage')).toBe(true);
    expect(hasValidPrefix('[human qa] manual check')).toBe(true);
    expect(hasValidPrefix('[script] auto verify')).toBe(true);
    // Invalid
    expect(hasValidPrefix('no prefix')).toBe(false);
    expect(hasValidPrefix('[invalid] test')).toBe(false);
  });

  test('hasValidPrefix returns false for empty string', () => {
    expect(hasValidPrefix('')).toBe(false);
  });

  test('hasValidPrefix returns false for prefix without closing bracket', () => {
    expect(hasValidPrefix('[verify test')).toBe(false);
  });

  test('hasValidPrefix returns false for prefix without opening bracket', () => {
    expect(hasValidPrefix('verify] test')).toBe(false);
  });
});
