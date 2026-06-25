/**
 * flowtarget-gate-routing.test.ts — FlowTarget 门禁路由函数测试
 *
 * 覆盖:
 * - executeRules: 全部通过、首条失败、中间失败
 * - flowTargetToPhaseIndex: 有效映射、无效抛出
 * - 8 个门禁检查函数的签名和基本结构
 */

import { describe, it, expect } from '@jest/globals';
import {
  executeRules,
  flowTargetToPhaseIndex,
  pre_dev_gate_check,
  post_dev_gate_check,
  pre_cr_gate_check,
  post_cr_gate_check,
  pre_qa_gate_check,
  post_qa_gate_check,
  pre_eval_gate_check,
  post_eval_gate_check,
} from '../utils/hd-assembly-line';
import type { GateCheckContext, GateRule } from '../types/harness';

function makeContext(overrides?: Partial<GateCheckContext>): GateCheckContext {
  return {
    task: { id: 'test-task', title: 'Test', status: 'pending' } as any,
    cwd: '/tmp/test',
    ...overrides,
  };
}

// ============== executeRules 单元测试 ==============

describe('executeRules', () => {
  it('所有规则通过时返回 passed: true', async () => {
    const rules: GateRule[] = [
      { id: 'R1', name: 'Test 1', onFailure: { targetPhase: 'EXIT', reason: 'fail1' }, check: async () => true },
      { id: 'R2', name: 'Test 2', onFailure: { targetPhase: 'EXIT', reason: 'fail2' }, check: async () => true },
    ];
    const result = await executeRules(rules, makeContext());
    expect(result.passed).toBe(true);
  });

  it('首条规则失败时返回该规则的 targetPhase 和 reason', async () => {
    const rules: GateRule[] = [
      { id: 'R1', name: 'Test 1', onFailure: { targetPhase: 'EXIT', reason: 'fail1' }, check: async () => false },
      { id: 'R2', name: 'Test 2', onFailure: { targetPhase: 'RETRY', reason: 'fail2' }, check: async () => true },
    ];
    const result = await executeRules(rules, makeContext());
    expect(result.passed).toBe(false);
    expect(result.targetPhase).toBe('EXIT');
    expect(result.reason).toContain('R1');
    expect(result.reason).toContain('fail1');
  });

  it('中间规则失败时返回该规则的 targetPhase', async () => {
    const rules: GateRule[] = [
      { id: 'R1', name: 'Test 1', onFailure: { targetPhase: 'EXIT', reason: 'fail1' }, check: async () => true },
      { id: 'R2', name: 'Test 2', onFailure: { targetPhase: 'development', reason: 'fail2' }, check: async () => false },
      { id: 'R3', name: 'Test 3', onFailure: { targetPhase: 'RETRY', reason: 'fail3' }, check: async () => true },
    ];
    const result = await executeRules(rules, makeContext());
    expect(result.passed).toBe(false);
    expect(result.targetPhase).toBe('development');
    expect(result.reason).toContain('R2');
  });

  it('支持 FlowTarget 的各种值', async () => {
    const targets = ['EXIT', 'RETRY', 'NEXT', 'development', 'code_review', 'qa', 'evaluation'] as const;
    for (const target of targets) {
      const rules: GateRule[] = [
        { id: 'R1', name: 'Test', onFailure: { targetPhase: target, reason: 'test' }, check: async () => false },
      ];
      const result = await executeRules(rules, makeContext());
      expect(result.targetPhase).toBe(target);
    }
  });
});

// ============== flowTargetToPhaseIndex 单元测试 ==============

describe('flowTargetToPhaseIndex', () => {
  it('development → 0', () => { expect(flowTargetToPhaseIndex('development')).toBe(0); });
  it('code_review → 1', () => { expect(flowTargetToPhaseIndex('code_review')).toBe(1); });
  it('qa → 2', () => { expect(flowTargetToPhaseIndex('qa')).toBe(2); });
  it('evaluation → 3', () => { expect(flowTargetToPhaseIndex('evaluation')).toBe(3); });

  it('RETRY 抛出异常', () => {
    expect(() => flowTargetToPhaseIndex('RETRY')).toThrow('Unknown rollback target: RETRY');
  });

  it('NEXT 抛出异常', () => {
    expect(() => flowTargetToPhaseIndex('NEXT')).toThrow('Unknown rollback target: NEXT');
  });

  it('EXIT 抛出异常', () => {
    expect(() => flowTargetToPhaseIndex('EXIT')).toThrow('Unknown rollback target: EXIT');
  });
});

// ============== 8 门禁检查函数结构验证 ==============

describe('pre_dev_gate_check', () => {
  it('有 task 时通过', async () => {
    const ctx = makeContext();
    const result = await pre_dev_gate_check(ctx);
    expect(result.passed).toBe(true);
  });

  it('无 task 时失败返回 EXIT', async () => {
    const ctx = makeContext({ task: null as any });
    const result = await pre_dev_gate_check(ctx);
    expect(result.passed).toBe(false);
    expect(result.targetPhase).toBe('EXIT');
  });

  it('返回结构包含 passed 和 targetPhase', async () => {
    const result = await pre_dev_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
    expect(result.passed).toBe(true);
  });
});

describe('post_dev_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await post_dev_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });
});

describe('pre_cr_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await pre_cr_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });
});

describe('post_cr_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await post_cr_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });

  it('phaseResult.result !== "PASS" 时触发 development 回退', async () => {
    const ctx = makeContext({ phaseResult: { result: 'FAIL' } });
    const result = await post_cr_gate_check(ctx);
    expect(result.targetPhase).toBe('development');
    expect(result.reason).toContain('R-CR-POST-003');
  });
});

describe('pre_qa_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await pre_qa_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });

  it('无 task 时失败返回 EXIT', async () => {
    const ctx = makeContext({ task: null as any });
    const result = await pre_qa_gate_check(ctx);
    expect(result.passed).toBe(false);
    expect(result.targetPhase).toBe('EXIT');
  });
});

describe('post_qa_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await post_qa_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });

  it('phaseResult.result !== "PASS" 时触发 development 回退', async () => {
    const ctx = makeContext({ phaseResult: { result: 'FAIL' } });
    const result = await post_qa_gate_check(ctx);
    expect(result.targetPhase).toBe('development');
    expect(result.reason).toContain('R-QA-POST-003');
  });
});

describe('pre_eval_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await pre_eval_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });
});

describe('post_eval_gate_check', () => {
  it('返回结果结构正确', async () => {
    const result = await post_eval_gate_check(makeContext());
    expect(result).toHaveProperty('passed');
  });
});
