/**
 * CR Gate failureType 声明单元测试
 * 验证 Pre-CR Gate 和 Post-CR Gate 的 failureType 分类正确性
 */
import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_PRE_CR_GATE_RULES,
  DEFAULT_POST_CR_GATE_RULES,
  PreCRGateRunner,
  PostCRGateRunner,
  QualityScoreChecker,
  createPreCRGateRunner,
  createPostCRGateRunner,
  createQualityScoreChecker,
} from '../utils/checkpoint.js';
import type { PreCRGateRule, PostCRGateRule } from '../utils/checkpoint.js';

// ============================================================
// Pre-CR Gate failureType 测试
// ============================================================

describe('Pre-CR Gate failureType', () => {
  describe('DEFAULT_PRE_CR_GATE_RULES', () => {
    it('should have all rules with failureType A', () => {
      for (const rule of DEFAULT_PRE_CR_GATE_RULES) {
        expect(rule.failureType).toBe('A');
      }
    });

    it('should have exactly 4 rules', () => {
      expect(DEFAULT_PRE_CR_GATE_RULES).toHaveLength(4);
    });

    it('should have blocking rules as type A', () => {
      const blockingRules = DEFAULT_PRE_CR_GATE_RULES.filter(r => r.blocking);
      for (const rule of blockingRules) {
        expect(rule.failureType).toBe('A');
      }
    });

    it('should have non-blocking rules also as type A', () => {
      const nonBlockingRules = DEFAULT_PRE_CR_GATE_RULES.filter(r => !r.blocking);
      for (const rule of nonBlockingRules) {
        expect(rule.failureType).toBe('A');
      }
    });

    it('should include quality_score rule with minScore config', () => {
      const qualityRule = DEFAULT_PRE_CR_GATE_RULES.find(r => r.type === 'quality_score');
      expect(qualityRule).toBeDefined();
      expect(qualityRule!.failureType).toBe('A');
      expect(qualityRule!.config?.minScore).toBe(70);
    });
  });

  describe('PreCRGateRule interface', () => {
    it('should accept failureType field in rule definition', () => {
      const customRule: PreCRGateRule = {
        id: 'test-rule',
        type: 'task_status',
        name: 'Test Rule',
        description: 'Test description',
        enabled: true,
        priority: 1,
        blocking: true,
        failureType: 'A',
      };
      expect(customRule.failureType).toBe('A');
    });

    it('should allow optional failureType', () => {
      const ruleWithoutType: PreCRGateRule = {
        id: 'test-rule',
        type: 'task_status',
        name: 'Test Rule',
        description: 'Test description',
        enabled: true,
        priority: 1,
        blocking: true,
      };
      expect(ruleWithoutType.failureType).toBeUndefined();
    });
  });
});

// ============================================================
// Post-CR Gate failureType 测试
// ============================================================

describe('Post-CR Gate failureType', () => {
  describe('DEFAULT_POST_CR_GATE_RULES', () => {
    it('should have rules with A or B failureType', () => {
      for (const rule of DEFAULT_POST_CR_GATE_RULES) {
        expect(['A', 'B']).toContain(rule.failureType);
      }
    });

    it('should have exactly 10 rules', () => {
      expect(DEFAULT_POST_CR_GATE_RULES).toHaveLength(10);
    });

    it('should have blocking rules as type A', () => {
      const blockingRules = DEFAULT_POST_CR_GATE_RULES.filter(r => r.blocking);
      for (const rule of blockingRules) {
        expect(rule.failureType).toBe('A');
      }
    });

    it('should classify report existence as type A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-001');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should classify report format as type A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-002');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should classify verdict validity as type A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-003');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should classify reason completeness as type B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-004');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should classify issue details as type B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-005');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should classify checkpoint sync as type A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-006');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should classify timestamp validity as type B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-007');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should have correct A/B type distribution', () => {
      const typeA = DEFAULT_POST_CR_GATE_RULES.filter(r => r.failureType === 'A');
      const typeB = DEFAULT_POST_CR_GATE_RULES.filter(r => r.failureType === 'B');
      // A: R-CR-POST-001, R-CR-POST-002, R-CR-POST-003, R-CR-POST-006
      expect(typeA).toHaveLength(4);
      // B: R-CR-POST-004, R-CR-POST-005, R-CR-POST-007, R-CR-POST-008, R-CR-POST-009, R-CR-POST-010
      expect(typeB).toHaveLength(6);
    });
  });

  describe('PostCRGateRule interface', () => {
    it('should accept failureType A in rule definition', () => {
      const customRule: PostCRGateRule = {
        id: 'test-rule-a',
        type: 'report_existence',
        name: 'Test Rule A',
        description: 'Test description',
        enabled: true,
        priority: 1,
        blocking: true,
        failureType: 'A',
      };
      expect(customRule.failureType).toBe('A');
    });

    it('should accept failureType B in rule definition', () => {
      const customRule: PostCRGateRule = {
        id: 'test-rule-b',
        type: 'report_format',
        name: 'Test Rule B',
        description: 'Test description',
        enabled: true,
        priority: 1,
        blocking: false,
        failureType: 'B',
      };
      expect(customRule.failureType).toBe('B');
    });
  });
});

// ============================================================
// 导出验证测试
// ============================================================

describe('CR Gate exports from checkpoint.ts', () => {
  it('should export PreCRGateRunner class', () => {
    expect(PreCRGateRunner).toBeDefined();
    expect(typeof PreCRGateRunner).toBe('function');
  });

  it('should export PostCRGateRunner class', () => {
    expect(PostCRGateRunner).toBeDefined();
    expect(typeof PostCRGateRunner).toBe('function');
  });

  it('should export QualityScoreChecker class', () => {
    expect(QualityScoreChecker).toBeDefined();
    expect(typeof QualityScoreChecker).toBe('function');
  });

  it('should export createPreCRGateRunner factory', () => {
    expect(createPreCRGateRunner).toBeDefined();
    expect(typeof createPreCRGateRunner).toBe('function');
  });

  it('should export createPostCRGateRunner factory', () => {
    expect(createPostCRGateRunner).toBeDefined();
    expect(typeof createPostCRGateRunner).toBe('function');
  });

  it('should export createQualityScoreChecker factory', () => {
    expect(createQualityScoreChecker).toBeDefined();
    expect(typeof createQualityScoreChecker).toBe('function');
  });
});
