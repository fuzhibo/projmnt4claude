import { describe, it, expect } from '@jest/globals';
import {
  MIN_SUPPORTED_CLI,
  KNOWN_BAD_CLI,
  compareVersions,
  getCliCompatLevel,
  assertCliCompatible,
} from '../cli-version-check.js';

/**
 * CP-6: Claude CLI 版本兼容矩阵（V2.1 §6.1.5）
 *
 * 矩阵：
 *   < 2.0.0           → unsupported
 *   2.0.0 - 2.1.122   → legacy（旧语义，--fork-session 未实现）
 *   ≥ 2.1.123         → supported（当前生产目标版本）
 *   命中 KNOWN_BAD_CLI → known-bad
 *
 * 关键行为变更（2.1.123）：裸复用相同 UUID 立即报错，
 * 是 2026-06-20 流水线异常终止的直接触发原因。
 */
describe('CP-6: Claude CLI 版本兼容矩阵', () => {
  describe('compareVersions', () => {
    it('同版本返回 0', () => {
      expect(compareVersions('2.1.123', '2.1.123')).toBe(0);
    });

    it('高位数差异按数值比较（非字符串）', () => {
      expect(compareVersions('2.1.99', '2.1.123')).toBeLessThan(0);
      expect(compareVersions('2.1.123', '2.1.99')).toBeGreaterThan(0);
    });

    it('缺位补零', () => {
      expect(compareVersions('2.0', '2.0.0')).toBe(0);
      expect(compareVersions('2.1', '2.1.0.0')).toBe(0);
    });

    it('主版本差异优先', () => {
      expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
      expect(compareVersions('3.0.0', '2.9.9')).toBeGreaterThan(0);
    });
  });

  describe('getCliCompatLevel', () => {
    it('< 2.0.0 归类为 unsupported', () => {
      expect(getCliCompatLevel('1.9.9')).toBe('unsupported');
      expect(getCliCompatLevel('0.9.0')).toBe('unsupported');
    });

    it('2.0.0 - 2.1.122 归类为 legacy', () => {
      expect(getCliCompatLevel('2.0.0')).toBe('legacy');
      expect(getCliCompatLevel('2.1.0')).toBe('legacy');
      expect(getCliCompatLevel('2.1.122')).toBe('legacy');
    });

    it('≥ 2.1.123 归类为 supported', () => {
      expect(getCliCompatLevel('2.1.123')).toBe('supported');
      expect(getCliCompatLevel('2.1.124')).toBe('supported');
      expect(getCliCompatLevel('2.2.0')).toBe('supported');
      expect(getCliCompatLevel('3.0.0')).toBe('supported');
    });
  });

  describe('assertCliCompatible', () => {
    it('supported 版本不抛异常', () => {
      expect(() => assertCliCompatible('2.1.123')).not.toThrow();
      expect(() => assertCliCompatible('2.2.0')).not.toThrow();
    });

    it('legacy 版本抛出升级提示', () => {
      expect(() => assertCliCompatible('2.1.122')).toThrow(/低于最低支持版本/);
      expect(() => assertCliCompatible('2.0.0')).toThrow(/低于最低支持版本/);
    });

    it('unsupported 版本抛出升级提示', () => {
      expect(() => assertCliCompatible('1.9.9')).toThrow(/低于最低支持版本/);
    });
  });

  describe('§6.1.5 兼容矩阵锚点', () => {
    it('MIN_SUPPORTED_CLI 应为 2.1.123', () => {
      expect(MIN_SUPPORTED_CLI).toBe('2.1.123');
    });

    it('KNOWN_BAD_CLI 默认为空数组（未来回填）', () => {
      expect(Array.isArray(KNOWN_BAD_CLI)).toBe(true);
    });

    it('当前生产版本 2.1.123 通过兼容检查', () => {
      // 这是 2026-06-20 事故现场版本，必须是 supported
      expect(getCliCompatLevel('2.1.123')).toBe('supported');
      expect(() => assertCliCompatible('2.1.123')).not.toThrow();
    });

    it('2.1.124+ 预期同 2.1.123（回归声明）', () => {
      // 矩阵声明 ≥ 2.1.124 预期支持（需回归）
      expect(getCliCompatLevel('2.1.124')).toBe('supported');
      expect(getCliCompatLevel('2.2.0')).toBe('supported');
    });
  });
});
