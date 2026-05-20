/**
 * format 模块单元测试
 *
 * 测试统一输出格式常量和函数
 */

import { describe, it, expect } from 'bun:test';
import { SEPARATOR_WIDTH, separator } from '../utils/format.js';

// ============================================================
// Constants
// ============================================================

describe('SEPARATOR_WIDTH', () => {
  it('should be defined as a constant', () => {
    expect(SEPARATOR_WIDTH).toBeDefined();
  });

  it('should be a positive number', () => {
    expect(typeof SEPARATOR_WIDTH).toBe('number');
    expect(SEPARATOR_WIDTH).toBeGreaterThan(0);
  });

  it('should have a reasonable default value', () => {
    // 默认值 60 是一个合理的终端宽度
    expect(SEPARATOR_WIDTH).toBe(60);
  });
});

// ============================================================
// separator function
// ============================================================

describe('separator', () => {
  // --- Normal cases ---

  it('should return a string of default character and width', () => {
    const result = separator();
    expect(typeof result).toBe('string');
    expect(result.length).toBe(SEPARATOR_WIDTH);
    expect(result).toBe('━'.repeat(SEPARATOR_WIDTH));
  });

  it('should use custom character', () => {
    const result = separator('=');
    expect(result).toBe('='.repeat(SEPARATOR_WIDTH));
  });

  it('should use custom width', () => {
    const result = separator('━', 20);
    expect(result.length).toBe(20);
    expect(result).toBe('━'.repeat(20));
  });

  it('should use both custom character and width', () => {
    const result = separator('-', 40);
    expect(result).toBe('-'.repeat(40));
  });

  // --- Edge cases ---

  it('should handle width of 0', () => {
    const result = separator('━', 0);
    expect(result).toBe('');
    expect(result.length).toBe(0);
  });

  it('should handle width of 1', () => {
    const result = separator('━', 1);
    expect(result).toBe('━');
    expect(result.length).toBe(1);
  });

  it('should handle multi-character strings (uses first char only via repeat)', () => {
    // String.prototype.repeat 会对整个字符串进行重复
    const result = separator('abc', 3);
    expect(result).toBe('abcabcabc');
  });

  it('should handle special characters', () => {
    const result = separator('─', 10);
    expect(result).toBe('─'.repeat(10));
  });

  it('should handle unicode characters', () => {
    const result = separator('🌟', 5);
    expect(result).toBe('🌟'.repeat(5));
  });

  // --- Large width cases ---

  it('should handle large width values', () => {
    const result = separator('━', 100);
    expect(result.length).toBe(100);
  });

  // --- Consistency tests ---

  it('should produce consistent results for same inputs', () => {
    const result1 = separator('=', 30);
    const result2 = separator('=', 30);
    expect(result1).toBe(result2);
  });
});
