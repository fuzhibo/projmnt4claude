/**
 * checkpoint-rules 单元测试
 *
 * 覆盖检查点评审规则 §4.x：
 * - Rule 9: deprecatedPrefixDetector (System A 废弃前缀检测)
 */

import { describe, test, expect } from '@jest/globals';
import { deprecatedPrefixDetector } from '../../utils/validation-rules/checkpoint-rules.js';

describe('deprecatedPrefixDetector (Rule 9)', () => {
  test('returns null when no deprecated prefixes exist', () => {
    const output = {
      checkpoints: [
        '[ai review] 检查代码质量',
        '[ai qa] 测试登录流程',
        '[human qa] 人工审核UI',
        '[script] 运行性能基准测试',
      ],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).toBeNull();
  });

  test('detects [verify] prefix', () => {
    const output = {
      checkpoints: ['[verify] 验证JWT token有效性'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('deprecated-prefix-detector');
    expect(result!.severity).toBe('warning');
    expect(result!.message).toContain('[verify]');
    expect(result!.message).toContain('[ai qa]');
  });

  test('detects [test] prefix', () => {
    const output = {
      checkpoints: ['[test] 测试认证流程'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('[test]');
    expect(result!.message).toContain('[ai qa]');
  });

  test('detects [review] prefix', () => {
    const output = {
      checkpoints: ['[review] 审核安全实现'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('[review]');
    expect(result!.message).toContain('[ai review]');
  });

  test('detects [implem] prefix', () => {
    const output = {
      checkpoints: ['[implem] 实现密码哈希'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('[implem]');
    expect(result!.message).toContain('[ai qa]');
  });

  test('detects [doc] prefix', () => {
    const output = {
      checkpoints: ['[doc] 更新API文档'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('[doc]');
    expect(result!.message).toContain('[script]');
  });

  test('detects multiple deprecated prefixes', () => {
    const output = {
      checkpoints: [
        '[verify] 验证登录',
        '[test] 测试注册',
        '[ai review] 检查代码',
      ],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('2 条');
  });

  test('is case-insensitive for deprecated prefixes', () => {
    const output = {
      checkpoints: ['[VERIFY] 大写前缀', '[Test] 混合大小写'],
    };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('2 条');
  });

  test('returns null for empty checkpoints array', () => {
    const output = { checkpoints: [] };
    const result = deprecatedPrefixDetector.check(output);
    expect(result).toBeNull();
  });

  test('returns null when no checkpoints field exists', () => {
    const output = {};
    const result = deprecatedPrefixDetector.check(output);
    expect(result).toBeNull();
  });
});
