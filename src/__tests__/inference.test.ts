/**
 * 依赖推断模块单元测试
 *
 * 测试 inferredToEdgeMeta 转换函数
 */
import { describe, test, expect } from 'bun:test';
import { inferredToEdgeMeta } from '../utils/dependency-graph/inference.js';

// ============== inferredToEdgeMeta ==============

describe('inferredToEdgeMeta', () => {
  test('file-overlap 来源正确转换', () => {
    const result = inferredToEdgeMeta({
      source: 'file-overlap',
      overlappingFiles: ['src/a.ts', 'src/b.ts'],
      reason: '共享 2 个文件',
    });
    expect(result.source).toBe('file-overlap');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.8);
    expect(result.overlappingFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.reason).toBe('共享 2 个文件');
  });

  test('file-overlap 置信度与文件数量成正比', () => {
    const few = inferredToEdgeMeta({
      source: 'file-overlap',
      overlappingFiles: ['a.ts'],
    });
    const many = inferredToEdgeMeta({
      source: 'file-overlap',
      overlappingFiles: ['a.ts', 'b.ts', 'c.ts', 'c.ts'],
    });
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  test('file-overlap 置信度上限为 0.8', () => {
    const result = inferredToEdgeMeta({
      source: 'file-overlap',
      overlappingFiles: Array.from({ length: 20 }, (_, i) => `file${i}.ts`),
    });
    expect(result.confidence).toBeLessThanOrEqual(0.8);
  });

  test('keyword 来源固定置信度 0.6', () => {
    const result = inferredToEdgeMeta({
      source: 'keyword',
      reason: '关键词匹配',
    });
    expect(result.source).toBe('keyword');
    expect(result.confidence).toBe(0.6);
    expect(result.reason).toBe('关键词匹配');
  });

  test('ai-semantic 来源固定置信度 0.7', () => {
    const result = inferredToEdgeMeta({
      source: 'ai-semantic',
      reason: 'AI 语义分析',
    });
    expect(result.source).toBe('ai-semantic');
    expect(result.confidence).toBe(0.7);
    expect(result.reason).toBe('AI 语义分析');
  });

  test('无重叠文件时 file-overlap 置信度为 0.5', () => {
    const result = inferredToEdgeMeta({
      source: 'file-overlap',
    });
    expect(result.confidence).toBe(0.5);
  });

  test('输出结构完整', () => {
    const result = inferredToEdgeMeta({
      source: 'keyword',
      reason: 'test',
    });
    expect(result).toHaveProperty('source');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reason');
    expect(typeof result.confidence).toBe('number');
  });
});
