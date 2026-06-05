/**
 * CR Gate Exports and Integration Tests
 * 代码审查门禁导出和集成测试
 *
 * 验收标准:
 * - CP-1: Pre-CR Gate 类已创建并导出
 * - CP-2: Post-CR Gate 类已创建并导出
 * - CP-3: QualityScoreChecker 已创建并导出
 * - 验证 DEFAULT_PRE_CR_GATE_RULES 所有规则 failureType 为 'A'
 * - 验证 DEFAULT_POST_CR_GATE_RULES 混合 failureType (包含 'A' 和 'B')
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'node:path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// Import from main checkpoint module (export verification)
import {
  PreCRGateRunner,
  createPreCRGateRunner,
  quickPreCRGateCheck,
  batchPreCRGateCheck,
  DEFAULT_PRE_CR_GATE_RULES,
  DEFAULT_PRE_CR_GATE_RUNNER_CONFIG,
  PostCRGateRunner,
  createPostCRGateRunner,
  quickPostCRGateCheck,
  batchPostCRGateCheck,
  DEFAULT_POST_CR_GATE_RULES,
  DEFAULT_POST_CR_GATE_RUNNER_CONFIG,
  QualityScoreChecker,
  createQualityScoreChecker,
  quickQualityScoreCheck,
} from '../utils/checkpoint.js';

// Import types
import type {
  PreCRGateRule,
  PostCRGateRule,
} from '../utils/checkpoint.js';

import type { AIReviewContext } from '../types/quality-score.js';

describe('CR Gate Exports', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // ============================================================
  // CP-1: Pre-CR Gate Exports Verification
  // ============================================================

  describe('CP-1: Pre-CR Gate exports', () => {
    it('should export PreCRGateRunner class', () => {
      expect(PreCRGateRunner).toBeDefined();
      expect(typeof PreCRGateRunner).toBe('function');
    });

    it('should export createPreCRGateRunner factory function', () => {
      expect(createPreCRGateRunner).toBeDefined();
      expect(typeof createPreCRGateRunner).toBe('function');
    });

    it('should export quickPreCRGateCheck convenience function', () => {
      expect(quickPreCRGateCheck).toBeDefined();
      expect(typeof quickPreCRGateCheck).toBe('function');
    });

    it('should export batchPreCRGateCheck convenience function', () => {
      expect(batchPreCRGateCheck).toBeDefined();
      expect(typeof batchPreCRGateCheck).toBe('function');
    });

    it('should export DEFAULT_PRE_CR_GATE_RULES', () => {
      expect(DEFAULT_PRE_CR_GATE_RULES).toBeDefined();
      expect(Array.isArray(DEFAULT_PRE_CR_GATE_RULES)).toBe(true);
      expect(DEFAULT_PRE_CR_GATE_RULES.length).toBeGreaterThan(0);
    });

    it('should export DEFAULT_PRE_CR_GATE_RUNNER_CONFIG', () => {
      expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG).toBeDefined();
      expect(typeof DEFAULT_PRE_CR_GATE_RUNNER_CONFIG).toBe('object');
      expect(DEFAULT_PRE_CR_GATE_RUNNER_CONFIG.enabled).toBe(true);
    });

    it('should instantiate PreCRGateRunner correctly', () => {
      const runner = createPreCRGateRunner(env.projectDir);
      expect(runner).toBeInstanceOf(PreCRGateRunner);
      expect(runner.getConfig()).toBeDefined();
    });
  });

  // ============================================================
  // CP-2: Post-CR Gate Exports Verification
  // ============================================================

  describe('CP-2: Post-CR Gate exports', () => {
    it('should export PostCRGateRunner class', () => {
      expect(PostCRGateRunner).toBeDefined();
      expect(typeof PostCRGateRunner).toBe('function');
    });

    it('should export createPostCRGateRunner factory function', () => {
      expect(createPostCRGateRunner).toBeDefined();
      expect(typeof createPostCRGateRunner).toBe('function');
    });

    it('should export quickPostCRGateCheck convenience function', () => {
      expect(quickPostCRGateCheck).toBeDefined();
      expect(typeof quickPostCRGateCheck).toBe('function');
    });

    it('should export batchPostCRGateCheck convenience function', () => {
      expect(batchPostCRGateCheck).toBeDefined();
      expect(typeof batchPostCRGateCheck).toBe('function');
    });

    it('should export DEFAULT_POST_CR_GATE_RULES', () => {
      expect(DEFAULT_POST_CR_GATE_RULES).toBeDefined();
      expect(Array.isArray(DEFAULT_POST_CR_GATE_RULES)).toBe(true);
      expect(DEFAULT_POST_CR_GATE_RULES.length).toBeGreaterThan(0);
    });

    it('should export DEFAULT_POST_CR_GATE_RUNNER_CONFIG', () => {
      expect(DEFAULT_POST_CR_GATE_RUNNER_CONFIG).toBeDefined();
      expect(typeof DEFAULT_POST_CR_GATE_RUNNER_CONFIG).toBe('object');
      expect(DEFAULT_POST_CR_GATE_RUNNER_CONFIG.enabled).toBe(true);
    });

    it('should instantiate PostCRGateRunner correctly', () => {
      const runner = createPostCRGateRunner(env.projectDir);
      expect(runner).toBeInstanceOf(PostCRGateRunner);
      expect(runner.getConfig()).toBeDefined();
    });
  });

  // ============================================================
  // CP-3: QualityScoreChecker Exports Verification
  // ============================================================

  describe('CP-3: QualityScoreChecker exports', () => {
    it('should export QualityScoreChecker class', () => {
      expect(QualityScoreChecker).toBeDefined();
      expect(typeof QualityScoreChecker).toBe('function');
    });

    it('should export createQualityScoreChecker factory function', () => {
      expect(createQualityScoreChecker).toBeDefined();
      expect(typeof createQualityScoreChecker).toBe('function');
    });

    it('should export quickQualityScoreCheck convenience function', () => {
      expect(quickQualityScoreCheck).toBeDefined();
      expect(typeof quickQualityScoreCheck).toBe('function');
    });

    it('should instantiate QualityScoreChecker correctly', () => {
      const checker = createQualityScoreChecker(env.projectDir);
      expect(checker).toBeInstanceOf(QualityScoreChecker);
    });
  });

  // ============================================================
  // Pre-CR Gate failureType Verification (All 'A')
  // ============================================================

  describe('Pre-CR Gate failureType rules', () => {
    it('should have all rules with failureType: A', () => {
      for (const rule of DEFAULT_PRE_CR_GATE_RULES) {
        expect(rule.failureType).toBe('A');
      }
    });

    it('should have task_status rule with failureType A', () => {
      const taskStatusRule = DEFAULT_PRE_CR_GATE_RULES.find(
        r => r.id === 'rule-task-status'
      );
      expect(taskStatusRule).toBeDefined();
      expect(taskStatusRule!.failureType).toBe('A');
    });

    it('should have checkpoints_complete rule with failureType A', () => {
      const checkpointsRule = DEFAULT_PRE_CR_GATE_RULES.find(
        r => r.id === 'rule-checkpoints-complete'
      );
      expect(checkpointsRule).toBeDefined();
      expect(checkpointsRule!.failureType).toBe('A');
    });

    it('should have artifacts_exist rule with failureType A', () => {
      const artifactsRule = DEFAULT_PRE_CR_GATE_RULES.find(
        r => r.id === 'rule-artifacts-exist'
      );
      expect(artifactsRule).toBeDefined();
      expect(artifactsRule!.failureType).toBe('A');
    });

    it('should have quality_score rule with failureType A', () => {
      const qualityRule = DEFAULT_PRE_CR_GATE_RULES.find(
        r => r.id === 'rule-quality-score'
      );
      expect(qualityRule).toBeDefined();
      expect(qualityRule!.failureType).toBe('A');
    });
  });

  // ============================================================
  // Post-CR Gate failureType Verification (Mixed A and B)
  // ============================================================

  describe('Post-CR Gate failureType rules', () => {
    it('should have mixed failureType (both A and B)', () => {
      const typeA = DEFAULT_POST_CR_GATE_RULES.filter(r => r.failureType === 'A');
      const typeB = DEFAULT_POST_CR_GATE_RULES.filter(r => r.failureType === 'B');

      expect(typeA.length).toBeGreaterThan(0);
      expect(typeB.length).toBeGreaterThan(0);
    });

    it('should have R-CR-POST-001 (report_existence) with failureType A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-001');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should have R-CR-POST-002 (report_format) with failureType A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-002');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should have R-CR-POST-003 (verdict_validity) with failureType A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-003');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should have R-CR-POST-004 (verdict completeness) with failureType B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-004');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should have R-CR-POST-005 (issue details) with failureType B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-005');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should have R-CR-POST-006 (checkpoint_sync) with failureType A', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-006');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('A');
    });

    it('should have R-CR-POST-007 (timestamp) with failureType B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-007');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });

    it('should have R-CR-POST-008 (test_env_config) with failureType B', () => {
      const rule = DEFAULT_POST_CR_GATE_RULES.find(r => r.id === 'R-CR-POST-008');
      expect(rule).toBeDefined();
      expect(rule!.failureType).toBe('B');
    });
  });

  // ============================================================
  // Gate Runner Basic Operations
  // ============================================================

  describe('Gate Runner basic operations', () => {
    it('should run Pre-CR Gate with disabled config', async () => {
      const runner = createPreCRGateRunner(env.projectDir, { enabled: false });
      const result = await runner.run('non-existent-task');

      expect(result.decision).toBe('PRE_CR_PASS');
      expect(result.allowed).toBe(true);
    });

    it('should run Post-CR Gate with disabled config', async () => {
      const runner = createPostCRGateRunner(env.projectDir, { enabled: false });
      const result = await runner.run('non-existent-task');

      expect(result.decision).toBe('POST_CR_PASS');
      expect(result.allowed).toBe(true);
    });

    it('should handle non-existent task in Pre-CR Gate', async () => {
      const runner = createPreCRGateRunner(env.projectDir);
      const result = await runner.run('non-existent-task');

      expect(result.decision).toBe('PRE_CR_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });

    it('should handle non-existent task in Post-CR Gate', async () => {
      const runner = createPostCRGateRunner(env.projectDir);
      const result = await runner.run('non-existent-task');

      expect(result.decision).toBe('POST_CR_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // QualityScoreChecker Basic Operations
  // ============================================================

  describe('QualityScoreChecker basic operations', () => {
    it('should create checker with default config', () => {
      const checker = createQualityScoreChecker(env.projectDir);
      expect(checker).toBeDefined();
    });

    it('should create checker with custom config', () => {
      const checker = createQualityScoreChecker(env.projectDir, {
        minScore: 80,
        enableAIReview: false,
      });
      expect(checker).toBeDefined();
    });

    it('should return result for valid context', async () => {
      const checker = createQualityScoreChecker(env.projectDir, {
        enableAIReview: false,
      });

      const context: AIReviewContext = {
        task: {
          id: 'TEST-001',
          title: 'Test Task',
          type: 'feature',
          priority: 'P2',
          description: 'Test description',
          status: 'in_progress',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        changedFiles: [],
      };

      const result = await checker.check(context);

      expect(result).toBeDefined();
      expect(result.check).toBe('quality_score');
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.duration).toBe('number');
    });
  });
});
