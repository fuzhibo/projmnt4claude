/**
 * checkpoint-format-tolerance.test.ts
 * CA-011 SOL-004: 解析器容错边界测试覆盖
 *
 * 验证 strict/normal/loose 三级容错行为符合容错边界矩阵定义。
 *
 * 注意：parseCheckpoints 是内部函数，测试通过 parseReport 验证整体行为，
 * CheckpointFormat.validateContract 直接导出可独立测试。
 */

import { parseReport } from '../utils/investigation/report-parser.js';
import { CheckpointFormat } from '../utils/investigation/checkpoint-format.js';

/**
 * 构造完整的报告 markdown 用于测试
 */
function buildReport(checkpointsMd: string): string {
  return `# 调查报告

## 元数据
- 需求来源: 测试容错边界
- 调查时间: 2026-07-10
- 调查目录: test-tolerance
- 语言: zh

## 原因分析
### CA-001: 测试原因

## 解决方案
### SOL-001: 测试方案

## 检查点覆盖清单
${checkpointsMd}

## 评估
- 复杂度: low
- 影响范围: 有限
- 预估工时: 30 分钟
`;
}

describe('Checkpoint Format Tolerance Boundary (CA-011)', () => {
  describe('SOL-002: strict 模式前置契约验证', () => {
    it('strict 拒绝无分组标题的简化格式', () => {
      const input = `- [ai review] 验证容错边界矩阵定义完整
- [ai qa] 测试 strict 模式拒绝无分组标题简化格式`;
      const result = parseReport(buildReport(input), { tolerance: 'strict' });
      expect(result.checkpoints).toEqual([]);
    });

    it('strict 接受有分组标题的完整格式', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 验证容错边界矩阵定义完整 → SOL-001
- [ai qa] 测试 strict 模式接受有分组标题简化格式 → SOL-001`;
      const result = parseReport(buildReport(input), { tolerance: 'strict' });
      expect(result.checkpoints.length).toBe(2);
      expect(result.checkpoints[0]!.belongsTo).toBe('SOL-001');
      expect(result.checkpoints[1]!.belongsTo).toBe('SOL-001');
    });

    it('strict 接受有分组标题的简化格式（无 → belongsTo）', () => {
      const input = `### SOL-002 相关检查点
- [ai review] 验证 parseCheckpoints 调用 validateContract
- [ai qa] 测试 normal 模式接受有分组标题简化格式`;
      const result = parseReport(buildReport(input), { tolerance: 'strict' });
      expect(result.checkpoints.length).toBe(2);
      expect(result.checkpoints[0]!.belongsTo).toBe('SOL-002');
    });
  });

  describe('SOL-002: normal 模式三层回退', () => {
    it('normal 接受有分组标题的简化格式', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 验证容错边界矩阵定义完整
- [ai qa] 测试 normal 模式接受有分组标题简化格式`;
      const result = parseReport(buildReport(input), { tolerance: 'normal' });
      expect(result.checkpoints.length).toBe(2);
      expect(result.checkpoints[0]!.belongsTo).toBe('SOL-001');
      expect(result.checkpoints[1]!.belongsTo).toBe('SOL-001');
    });

    it('normal 接受无分组标题的简化格式', () => {
      const input = `- [ai review] 验证容错边界矩阵定义完整
- [ai qa] 测试 normal 模式接受无分组标题简化格式`;
      const result = parseReport(buildReport(input), { tolerance: 'normal' });
      expect(result.checkpoints.length).toBe(2);
    });

    it('normal 层级1: 优先匹配完整格式', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 完整格式检查点 → SOL-001
- [ai qa] 简化格式检查点`;
      const result = parseReport(buildReport(input), { tolerance: 'normal' });
      expect(result.checkpoints.length).toBe(2);
      expect(result.checkpoints[0]!.belongsTo).toBe('SOL-001');
      expect(result.checkpoints[1]!.belongsTo).toBe('SOL-001');
    });
  });

  describe('硬边界: 任何模式都拒绝', () => {
    it('未知前缀被所有模式拒绝', () => {
      const input = `### SOL-001 相关检查点
- [unknown-prefix] 未知前缀检查点`;
      const result = parseReport(buildReport(input), { tolerance: 'strict' });
      expect(result.checkpoints).toEqual([]);
    });
  });

  describe('CheckpointFormat.validateContract 单元测试', () => {
    it('validateContract 检测缺少分组标题的简化格式', () => {
      const input = `- [ai review] 检查点1
- [ai qa] 检查点2`;
      const result = CheckpointFormat.validateContract(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('缺少分组标题');
    });

    it('validateContract 通过有分组标题的格式', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 检查点1
- [ai qa] 检查点2`;
      const result = CheckpointFormat.validateContract(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validateContract 检测 belongsTo 与分组标题不一致', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 检查点1 → SOL-002`;
      const result = CheckpointFormat.validateContract(input);
      expect(result.valid).toBe(true); // 完整格式本身有效
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('不一致');
    });

    it('validateContract 通过完整格式（有 → belongsTo）', () => {
      const input = `### SOL-001 相关检查点
- [ai review] 检查点1 → SOL-001`;
      const result = CheckpointFormat.validateContract(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('validateContract 处理空输入', () => {
      const result = CheckpointFormat.validateContract('');
      expect(result.valid).toBe(true); // 无检查点 = 无错误
      expect(result.errors).toEqual([]);
    });
  });

  describe('容错边界矩阵验证', () => {
    const testCases = [
      { name: '标准格式（有分组标题+完整格式）', input: '### SOL-001\n- [ai review] 检查点 → SOL-001', strict: 1, normal: 1, loose: 1 },
      { name: '简化格式（有分组标题）', input: '### SOL-001\n- [ai review] 检查点', strict: 1, normal: 1, loose: 1 },
      { name: '简化格式（无分组标题）', input: '- [ai review] 检查点', strict: 0, normal: 1, loose: 1 },
      { name: '空输入', input: '', strict: 0, normal: 0, loose: 0 },
    ];

    testCases.forEach(({ name, input, strict, normal, loose }) => {
      it(`矩阵: ${name}`, () => {
        expect(parseReport(buildReport(input), { tolerance: 'strict' }).checkpoints.length).toBe(strict);
        expect(parseReport(buildReport(input), { tolerance: 'normal' }).checkpoints.length).toBe(normal);
        expect(parseReport(buildReport(input), { tolerance: 'loose' }).checkpoints.length).toBe(loose);
      });
    });
  });
});
