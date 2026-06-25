/**
 * checkpoint-verification-ab.test.ts - FlowTarget 路由分类测试
 *
 * 测试覆盖：
 * - FlowTarget routing via targetPhase 字段验证
 * - PostQAGateRule targetPhase 声明验证
 * - 路由分类语义正确性（development 链式回退 vs. qa 内部重试）
 */

import { describe, it, expect } from '@jest/globals';
import { PostQAGateRunner } from '../utils/post-qa-gate/runner.js';
import type { PostQAGateRunResult, PostQAGateRuleResult } from '../utils/post-qa-gate/runner.js';
import type { PostQAGateRule } from '../utils/post-qa-gate/runner.js';
import { DEFAULT_POST_QA_GATE_RULES } from '../utils/post-qa-gate/runner.js';

// ============== CP-001: targetPhase 字段定义验证 ==============

describe('CP-001: targetPhase 字段定义', () => {
  it('PostQAGateRule interface has optional targetPhase field', () => {
    const rule: PostQAGateRule = {
      id: 'test-rule',
      type: 'qa_report_existence',
      name: 'Test Rule',
      description: 'Test',
      enabled: true,
      priority: 1,
      blocking: true,
    };
    expect(rule.targetPhase).toBeUndefined();
  });

  it('targetPhase accepts "development"', () => {
    const rule: PostQAGateRule = {
      id: 'test-rule',
      type: 'qa_report_existence',
      name: 'Test Rule',
      description: 'Test',
      enabled: true,
      priority: 1,
      blocking: true,
      targetPhase: 'development',
    };
    expect(rule.targetPhase).toBe('development');
  });

  it('targetPhase accepts "qa"', () => {
    const rule: PostQAGateRule = {
      id: 'test-rule',
      type: 'test_coverage',
      name: 'Test Rule',
      description: 'Test',
      enabled: true,
      priority: 1,
      blocking: true,
      targetPhase: 'qa',
    };
    expect(rule.targetPhase).toBe('qa');
  });
});

// ============== CP-002: 默认规则 targetPhase 声明验证 ==============

describe('CP-002: 默认规则 targetPhase 声明', () => {
  it('R-QA-POST-001~003, R-QA-POST-006 have targetPhase: "development"', () => {
    const devRules = DEFAULT_POST_QA_GATE_RULES.filter(
      r => r.id === 'R-QA-POST-001' || r.id === 'R-QA-POST-002' ||
           r.id === 'R-QA-POST-003' || r.id === 'R-QA-POST-006'
    );
    for (const rule of devRules) {
      expect(rule.targetPhase).toBe('development');
    }
  });

  it('R-QA-POST-004~005, R-QA-POST-005a, R-QA-POST-007 have targetPhase: "qa"', () => {
    const qaRules = DEFAULT_POST_QA_GATE_RULES.filter(
      r => r.id === 'R-QA-POST-004' || r.id === 'R-QA-POST-005' ||
           r.id === 'R-QA-POST-005a' || r.id === 'R-QA-POST-007'
    );
    for (const rule of qaRules) {
      expect(rule.targetPhase).toBe('qa');
    }
  });

  it('total default rules count is 8', () => {
    expect(DEFAULT_POST_QA_GATE_RULES.length).toBe(8);
  });
});

// ============== CP-005: classifyQAFailureCategory 路由分类处理验证 ==============

describe('CP-005: classifyQAFailureCategory 路由分类处理', () => {
  const runner = new PostQAGateRunner('/tmp/test');

  it('passing result returns "none"', () => {
    const result: PostQAGateRunResult = {
      taskId: 'test',
      decision: 'POST_QA_PASS',
      allowed: true,
      ruleResults: [],
      passedRules: 1,
      failedRules: 0,
      warningCount: 0,
      blockingFailures: 0,
      duration: 100,
      timestamp: new Date().toISOString(),
    };
    expect(runner.classifyQAFailureCategory(result)).toBe('none');
  });

  it('coverage failure (targetPhase: "qa") returns "coverage_retry"', () => {
    const result: PostQAGateRunResult = {
      taskId: 'test',
      decision: 'POST_QA_FAIL',
      allowed: false,
      ruleResults: [
        {
          ruleId: 'R-QA-POST-007',
          passed: false,
          ruleName: '覆盖率达标的测试',
          message: '覆盖率不足',
          duration: 10,
          timestamp: new Date().toISOString(),
          targetPhase: 'qa',
        },
      ],
      passedRules: 0,
      failedRules: 1,
      warningCount: 0,
      blockingFailures: 1,
      duration: 100,
      timestamp: new Date().toISOString(),
      coverageGapData: {
        currentCoverage: 0.6,
        minCoverage: 0.8,
        gap: 0.2,
        gapPercent: '20.0%',
        targetPhase: 'qa',
        message: '覆盖率不足',
      },
    };
    expect(runner.classifyQAFailureCategory(result)).toBe('coverage_retry');
  });

  it('functional failure (targetPhase: "development") returns "chain_rollback"', () => {
    const result: PostQAGateRunResult = {
      taskId: 'test',
      decision: 'POST_QA_FAIL',
      allowed: false,
      ruleResults: [
        {
          ruleId: 'R-QA-POST-001',
          passed: false,
          ruleName: 'QA报告存在的',
          message: 'QA报告不存在',
          duration: 10,
          timestamp: new Date().toISOString(),
          targetPhase: 'development',
        },
      ],
      passedRules: 0,
      failedRules: 1,
      warningCount: 0,
      blockingFailures: 1,
      duration: 100,
      timestamp: new Date().toISOString(),
    };
    expect(runner.classifyQAFailureCategory(result)).toBe('chain_rollback');
  });

  it('coverage failure without gap data returns "chain_rollback"', () => {
    const result: PostQAGateRunResult = {
      taskId: 'test',
      decision: 'POST_QA_FAIL',
      allowed: false,
      ruleResults: [
        {
          ruleId: 'R-QA-POST-007',
          passed: false,
          ruleName: '覆盖率达标的测试',
          message: '覆盖率不足',
          duration: 10,
          timestamp: new Date().toISOString(),
          targetPhase: 'qa',
        },
      ],
      passedRules: 0,
      failedRules: 1,
      warningCount: 0,
      blockingFailures: 1,
      duration: 100,
      timestamp: new Date().toISOString(),
    };
    expect(runner.classifyQAFailureCategory(result)).toBe('chain_rollback');
  });
});
