/**
 * Code Review Verdict 验证规则单元测试
 *
 * 覆盖 codeReviewVerdictResultMarker 和 codeReviewVerdictHasReason 规则
 */

import { describe, test, expect } from '@jest/globals';
import {
  codeReviewVerdictResultMarker,
  codeReviewVerdictHasReason,
  codeReviewVerdictValidationRules,
} from '../../utils/validation-rules/verdict-rules.js';

describe('codeReviewVerdictResultMarker', () => {
  test('VERDICT: PASS 通过验证', () => {
    const result = codeReviewVerdictResultMarker.check('VERDICT: PASS\n## 审核结果: PASS\n原因: 代码质量良好');
    expect(result).toBeNull();
  });

  test('VERDICT: NOPASS 通过验证', () => {
    const result = codeReviewVerdictResultMarker.check('VERDICT: NOPASS\n## 审核结果: NOPASS\n原因: 存在未处理的错误');
    expect(result).toBeNull();
  });

  test('小写 verdict: pass 通过验证 (大小写不敏感)', () => {
    const result = codeReviewVerdictResultMarker.check('verdict: pass\n审核通过');
    expect(result).toBeNull();
  });

  test('VERDICT: NOPASS (混合大小写) 通过验证', () => {
    const result = codeReviewVerdictResultMarker.check('Verdict: NoPass\n代码存在问题');
    expect(result).toBeNull();
  });

  test('包含 EVALUATION_RESULT 但不包含 VERDICT — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check('EVALUATION_RESULT: PASS\n评估通过');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
    expect(result!.severity).toBe('error');
  });

  test('缺少任何标记 — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check('代码质量良好，没有发现问题');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
    expect(result!.severity).toBe('error');
  });

  test('空字符串 — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check('');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
    expect(result!.severity).toBe('error');
  });

  test('非字符串类型 — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check(123);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
    expect(result!.severity).toBe('error');
  });

  test('null 输入 — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check(null);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
  });

  test('只有 PASS 单词但没有 VERDICT 前缀 — 应返回违规', () => {
    const result = codeReviewVerdictResultMarker.check('结果: PASS\n审核完成');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-result-marker');
  });
});

describe('codeReviewVerdictHasReason', () => {
  test('包含 ## 审核结果 章节 — 通过验证', () => {
    const result = codeReviewVerdictHasReason.check('VERDICT: PASS\n## 审核结果: PASS\n代码实现正确');
    expect(result).toBeNull();
  });

  test('包含 ## 原因 章节 — 通过验证', () => {
    const result = codeReviewVerdictHasReason.check('VERDICT: NOPASS\n## 原因\n存在安全漏洞');
    expect(result).toBeNull();
  });

  test('包含 ## Reason 章节 — 通过验证', () => {
    const result = codeReviewVerdictHasReason.check('VERDICT: PASS\n## Reason\nAll checks passed');
    expect(result).toBeNull();
  });

  test('包含 原因: 前缀 — 通过验证', () => {
    const result = codeReviewVerdictHasReason.check('VERDICT: PASS\n原因: 代码质量符合规范');
    expect(result).toBeNull();
  });

  test('有 VERDICT 但缺少原因章节 — 应返回 warning', () => {
    const result = codeReviewVerdictHasReason.check('VERDICT: PASS');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-has-reason');
    expect(result!.severity).toBe('warning');
  });

  test('空字符串 — 应返回 warning', () => {
    const result = codeReviewVerdictHasReason.check('');
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-has-reason');
    expect(result!.severity).toBe('warning');
  });

  test('非字符串类型 — 应返回 warning', () => {
    const result = codeReviewVerdictHasReason.check({});
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe('code-review-verdict-has-reason');
    expect(result!.severity).toBe('warning');
  });
});

describe('codeReviewVerdictValidationRules', () => {
  test('聚合数组包含两条规则', () => {
    expect(codeReviewVerdictValidationRules).toHaveLength(2);
    expect(codeReviewVerdictValidationRules[0]!.id).toBe('code-review-verdict-result-marker');
    expect(codeReviewVerdictValidationRules[1]!.id).toBe('code-review-verdict-has-reason');
  });

  test('两条规则的严重级别分别为 error 和 warning', () => {
    expect(codeReviewVerdictValidationRules[0]!.severity).toBe('error');
    expect(codeReviewVerdictValidationRules[1]!.severity).toBe('warning');
  });
});
