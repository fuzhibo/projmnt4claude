/**
 * Evaluation class tests
 *
 * CP-2: Tests for Evaluation class smart routing mechanism
 */

import { describe, test, expect } from 'bun:test';
import { Evaluation, createEvaluation } from '../evaluation.js';
import type { RoutingDecision } from '../../types/task.js';

describe('Evaluation', () => {
  const evaluation = createEvaluation('/test/workspace');

  describe('analyzeEvaluationResult', () => {
    test('should route code quality issues to development', () => {
      const result = evaluation.analyzeEvaluationResult('Code quality issues found');

      expect(result.problemSource).toBe('development');
      expect(result.targetPhase).toBe('development');
      expect(result.reason).toContain('代码质量');
    });

    test('should route Chinese code quality issues to development', () => {
      const result = evaluation.analyzeEvaluationResult('代码质量不达标');

      expect(result.problemSource).toBe('development');
      expect(result.targetPhase).toBe('development');
    });

    test('should route lint issues to development', () => {
      const result = evaluation.analyzeEvaluationResult('Lint errors detected');

      expect(result.problemSource).toBe('development');
      expect(result.targetPhase).toBe('development');
    });

    test('should route test failures to QA', () => {
      const result = evaluation.analyzeEvaluationResult('Test failure in module');

      expect(result.problemSource).toBe('qa');
      expect(result.targetPhase).toBe('qa');
      expect(result.reason).toContain('QA');
    });

    test('should route Chinese test failures to QA', () => {
      const result = evaluation.analyzeEvaluationResult('测试失败: 用例未通过');

      expect(result.problemSource).toBe('qa');
      expect(result.targetPhase).toBe('qa');
    });

    test('should route assertion failures to QA', () => {
      const result = evaluation.analyzeEvaluationResult('Assertion error in tests');

      expect(result.problemSource).toBe('qa');
      expect(result.targetPhase).toBe('qa');
    });

    test('should route code review issues to code_review', () => {
      const result = evaluation.analyzeEvaluationResult('Code review comments not addressed');

      expect(result.problemSource).toBe('code_review');
      expect(result.targetPhase).toBe('code_review');
    });

    test('should route Chinese code review issues to code_review', () => {
      const result = evaluation.analyzeEvaluationResult('代码审查意见未处理');

      expect(result.problemSource).toBe('code_review');
      expect(result.targetPhase).toBe('code_review');
    });

    test('should use evaluation logs for coverage issues', () => {
      const result = evaluation.analyzeEvaluationResult(
        'Evaluation failed',
        'Coverage report shows 45% coverage'
      );

      expect(result.problemSource).toBe('qa');
      expect(result.targetPhase).toBe('qa');
      expect(result.reason).toContain('覆盖率');
    });

    test('should use evaluation logs for build issues', () => {
      const result = evaluation.analyzeEvaluationResult(
        'Evaluation failed',
        'Build failed with typescript type error'
      );

      expect(result.problemSource).toBe('development');
      expect(result.targetPhase).toBe('development');
      expect(result.reason).toContain('构建');
    });

    test('should default to development for unknown errors', () => {
      const result = evaluation.analyzeEvaluationResult('Unknown evaluation error');

      expect(result.problemSource).toBe('evaluation');
      expect(result.targetPhase).toBe('development');
      expect(result.reason).toContain('默认');
    });

    test('should extract specific issues from result text', () => {
      const result = evaluation.analyzeEvaluationResult('Code quality and lint issues found');

      expect(result.specificIssues.length).toBeGreaterThan(0);
    });

    test('should limit specific issues to 5', () => {
      const result = evaluation.analyzeEvaluationResult(
        'Code quality Code quality Code quality Code quality Code quality Code quality'
      );

      expect(result.specificIssues.length).toBeLessThanOrEqual(5);
    });
  });

  describe('determineRoutingTarget', () => {
    test('should annotate Type A failures as recoverable', () => {
      const result = evaluation.determineRoutingTarget('A', 'Code quality issues');

      expect(result.reason).toContain('A类');
      expect(result.targetPhase).toBe('development');
    });

    test('should annotate Type B failures as non-recoverable', () => {
      const result = evaluation.determineRoutingTarget('B', 'Code quality issues');

      expect(result.reason).toContain('B类');
      expect(result.targetPhase).toBe('development');
    });

    test('should route Type A test failures to QA', () => {
      const result = evaluation.determineRoutingTarget('A', 'Test failure detected');

      expect(result.targetPhase).toBe('qa');
    });

    test('should route Type B code review issues to code_review', () => {
      const result = evaluation.determineRoutingTarget('B', 'Code review not passed');

      expect(result.targetPhase).toBe('code_review');
    });
  });

  describe('createEvaluation', () => {
    test('should create Evaluation instance', () => {
      const instance = createEvaluation('/test/path');

      expect(instance).toBeInstanceOf(Evaluation);
    });
  });
});
