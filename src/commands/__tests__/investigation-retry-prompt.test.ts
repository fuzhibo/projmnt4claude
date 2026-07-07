/**
 * SOL-003: buildRetryPrompt 单元测试
 *
 * 验证重试提示词生成逻辑覆盖检查点 #11:
 * - 中英文模板正确渲染
 * - attemptNum 多次替换 (replaceAll)
 * - 错误摘要与审核建议摘要截断 (MAX_RETRY_FEEDBACK_LEN)
 * - 无 reviewResult / reviewPath 降级
 * - 格式示例使用 report-contract 常量（间接验证 getFormatExample）
 */

import { describe, it, expect } from '@jest/globals';
import { buildRetryPrompt } from '../investigation-requirement.js';
import type { ReviewResult } from '../../utils/investigation/types.js';

describe('SOL-003 buildRetryPrompt', () => {
  const baseOptions = {
    requirement: '修复登录超时',
    errors: [{ rule: 'MISSING_SECTION', message: '缺少原因分析章节' }],
    attemptNum: 2,
    lang: 'zh' as const,
  };

  describe('基础模板渲染', () => {
    it('should include requirement in zh prompt', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('## 原始需求');
      expect(prompt).toContain('修复登录超时');
    });

    it('should include requirement in en prompt', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, lang: 'en' });
      expect(prompt).toContain('## Original Requirement');
      expect(prompt).toContain('修复登录超时');
    });

    it('should include error summary with rule label', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('- [MISSING_SECTION] 缺少原因分析章节');
    });

    it('should render attemptNum in both task header and notes (replaceAll)', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, attemptNum: 3 });
      // 任务行与注意事项行各出现一次
      const matches = prompt.match(/第 3 次重试/g);
      expect(matches?.length).toBe(2);
    });
  });

  describe('审核建议摘要', () => {
    const reviewResult: ReviewResult = {
      pass: false,
      scores: { rootCauseAlignment: 60, solutionEffectiveness: 50, checkpointCompleteness: 40 },
      issues: [
        {
          dimension: 'rootCauseAlignment',
          severity: 'major',
          description: '原因分析不够深入',
          suggestion: '补充 5 Whys 分析',
        },
        {
          dimension: 'checkpointCompleteness',
          severity: 'critical',
          description: '缺少测试检查点',
          suggestion: '添加 ai qa 检查点',
        },
      ],
    };

    it('should include review suggestions when reviewResult has issues', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, reviewResult });
      expect(prompt).toContain('- [major] rootCauseAlignment: 补充 5 Whys 分析');
      expect(prompt).toContain('- [critical] checkpointCompleteness: 添加 ai qa 检查点');
    });

    it('should show fallback text when no reviewResult', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('无具体建议');
    });

    it('should show fallback text when reviewResult has empty issues', () => {
      const prompt = buildRetryPrompt({
        ...baseOptions,
        reviewResult: { pass: true, scores: { rootCauseAlignment: 90, solutionEffectiveness: 90, checkpointCompleteness: 90 }, issues: [] },
      });
      expect(prompt).toContain('无具体建议');
    });

    it('should show en fallback text for en lang without reviewResult', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, lang: 'en' });
      expect(prompt).toContain('No specific suggestions');
    });
  });

  describe('审核报告路径', () => {
    it('should include reviewPath when provided', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, reviewPath: '/tmp/report-review.md' });
      expect(prompt).toContain('审核报告已保存到: /tmp/report-review.md');
    });

    it('should show fallback when reviewPath missing (zh)', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('未生成审核报告');
    });

    it('should show fallback when reviewPath missing (en)', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, lang: 'en' });
      expect(prompt).toContain('No review report generated');
    });
  });

  describe('格式示例与契约常量', () => {
    it('should include format example with contract section names (zh)', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('## 元数据');
      expect(prompt).toContain('## 原因分析');
      expect(prompt).toContain('## 解决方案');
      expect(prompt).toContain('## 检查点覆盖清单');
      expect(prompt).toContain('## 评估');
    });

    it('should include format example with contract section names (en)', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, lang: 'en' });
      expect(prompt).toContain('## Metadata');
      expect(prompt).toContain('## Root Cause Analysis');
      expect(prompt).toContain('## Solutions');
      expect(prompt).toContain('## Checkpoint Checklist');
      expect(prompt).toContain('## Assessment');
    });

    it('should include CA-001 / SOL-001 numbering in format example', () => {
      const prompt = buildRetryPrompt(baseOptions);
      expect(prompt).toContain('### CA-001:');
      expect(prompt).toContain('### SOL-001:');
    });
  });

  describe('摘要截断', () => {
    it('should truncate error summary to MAX_RETRY_FEEDBACK_LEN', () => {
      const longMessage = 'A'.repeat(600);
      const prompt = buildRetryPrompt({
        ...baseOptions,
        errors: [{ rule: 'LONG_ERROR', message: longMessage }],
      });
      expect(prompt).toContain('## 上一次输出的格式问题');
      const errorPart = prompt.split('## 上一次输出的格式问题')[1]?.split('##')[0] ?? '';
      expect(errorPart.length).toBeGreaterThan(0);
      expect(errorPart.length).toBeLessThanOrEqual(530); // 前缀 + 截断后内容
    });

    it('should truncate suggestions summary to MAX_RETRY_FEEDBACK_LEN', () => {
      const longSuggestion = 'S'.repeat(600);
      const reviewResult: ReviewResult = {
        pass: false,
        scores: { rootCauseAlignment: 50, solutionEffectiveness: 50, checkpointCompleteness: 50 },
        issues: [
          {
            dimension: 'rootCauseAlignment',
            severity: 'major',
            description: 'desc',
            suggestion: longSuggestion,
          },
        ],
      };
      const prompt = buildRetryPrompt({ ...baseOptions, reviewResult });
      expect(prompt).toContain('## 审核建议');
      const suggestionPart = prompt.split('## 审核建议')[1]?.split('##')[0] ?? '';
      expect(suggestionPart.length).toBeGreaterThan(0);
      expect(suggestionPart.length).toBeLessThanOrEqual(550);
    });
  });

  describe('空错误降级', () => {
    it('should show fallback when errors array is empty (zh)', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, errors: [] });
      expect(prompt).toContain('无格式错误详情');
    });

    it('should show fallback when errors array is empty (en)', () => {
      const prompt = buildRetryPrompt({ ...baseOptions, errors: [], lang: 'en' });
      expect(prompt).toContain('No format error details');
    });
  });
});
