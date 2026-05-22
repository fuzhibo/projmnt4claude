/**
 * CodeReview class tests
 *
 * CP-1: Tests for CodeReview class chain fallback mechanism
 */

import { describe, test, expect } from 'bun:test';
import { CodeReview, createCodeReview } from '../code-review.js';
import type { QAFailureAnalysis, QAFailureCategory } from '../../types/task.js';

describe('CodeReview', () => {
  const codeReview = createCodeReview('/test/workspace');

  describe('analyzeQAFailure', () => {
    test('should classify logic errors as code_issue', () => {
      const result = codeReview.analyzeQAFailure('Logic error in function');

      expect(result.attribution).toBe('code_issue');
      expect(result.suggestedRollbackTarget).toBe('development');
      expect(result.reasoning).toContain('代码逻辑');
    });

    test('should classify assertion failures as code_issue', () => {
      const result = codeReview.analyzeQAFailure('Assertion failed: expected true');

      expect(result.attribution).toBe('code_issue');
      expect(result.suggestedRollbackTarget).toBe('development');
    });

    test('should classify Chinese assertion failures as code_issue', () => {
      const result = codeReview.analyzeQAFailure('断言失败: 期望值不匹配');

      expect(result.attribution).toBe('code_issue');
      expect(result.suggestedRollbackTarget).toBe('development');
    });

    test('should classify config issues as environment_issue', () => {
      const result = codeReview.analyzeQAFailure('Config file missing');

      expect(result.attribution).toBe('environment_issue');
      expect(result.suggestedRollbackTarget).toBe('qa');
    });

    test('should classify environment issues as environment_issue', () => {
      const result = codeReview.analyzeQAFailure('环境变量未设置');

      expect(result.attribution).toBe('environment_issue');
      expect(result.suggestedRollbackTarget).toBe('qa');
    });

    test('should classify setup issues as environment_issue', () => {
      const result = codeReview.analyzeQAFailure('Setup fixture failed');

      expect(result.attribution).toBe('environment_issue');
      expect(result.suggestedRollbackTarget).toBe('qa');
    });

    test('should classify timeout issues as environment_issue', () => {
      const result = codeReview.analyzeQAFailure('Test timeout exceeded');

      expect(result.attribution).toBe('environment_issue');
      expect(result.suggestedRollbackTarget).toBe('qa');
    });

    test('should analyze test failures with assertion patterns', () => {
      const testFailures = [
        { testName: 'test1', reason: 'Assertion failed' },
        { testName: 'test2', reason: 'passed' },
      ];

      const result = codeReview.analyzeQAFailure('Tests failed', testFailures);

      expect(result.attribution).toBe('code_issue');
      expect(result.suggestedRollbackTarget).toBe('development');
    });

    test('should analyze test failures with expected patterns', () => {
      const testFailures = [
        { testName: 'test1', reason: 'expected 5 but got 3' },
      ];

      const result = codeReview.analyzeQAFailure('Tests failed', testFailures);

      expect(result.attribution).toBe('code_issue');
    });

    test('should default to code_issue for unknown errors', () => {
      const result = codeReview.analyzeQAFailure('Unknown error occurred');

      expect(result.attribution).toBe('code_issue');
      expect(result.suggestedRollbackTarget).toBe('development');
      expect(result.reasoning).toContain('默认');
    });

    test('should handle empty test failures array', () => {
      const result = codeReview.analyzeQAFailure('Some error', []);

      expect(result.attribution).toBe('code_issue');
    });

    test('should handle undefined test failures', () => {
      const result = codeReview.analyzeQAFailure('Some error', undefined);

      expect(result.attribution).toBe('code_issue');
    });
  });

  describe('classifyFailure', () => {
    test('should return retry=true for coverage_retry', () => {
      const result = codeReview.classifyFailure('coverage_retry');

      expect(result.needsQARetry).toBe(true);
      expect(result.needsChainRollback).toBe(false);
    });

    test('should return rollback=true for chain_rollback', () => {
      const result = codeReview.classifyFailure('chain_rollback');

      expect(result.needsQARetry).toBe(false);
      expect(result.needsChainRollback).toBe(true);
    });

    test('should return both false for none', () => {
      const result = codeReview.classifyFailure('none');

      expect(result.needsQARetry).toBe(false);
      expect(result.needsChainRollback).toBe(false);
    });
  });

  describe('createCodeReview', () => {
    test('should create CodeReview instance', () => {
      const instance = createCodeReview('/test/path');

      expect(instance).toBeInstanceOf(CodeReview);
    });
  });
});
