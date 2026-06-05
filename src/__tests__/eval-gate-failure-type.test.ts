/**
 * Eval Gate failureType 单元测试
 * 验证 Pre-Eval Gate 和 Post-Eval Gate 检查器的 failureType 属性正确性
 */
import { describe, it, expect } from '@jest/globals';
import { QAPassChecker } from '../utils/pre-eval-gate/qa-pass-checker.js';
import { QAReportExistenceChecker } from '../utils/pre-eval-gate/checkers/qa-report-existence-checker.js';
import { DevReportChecker } from '../utils/pre-eval-gate/checkers/dev-report-checker.js';
import { CodeReviewReportChecker } from '../utils/pre-eval-gate/checkers/code-review-report-checker.js';
import { AllCheckpointsCompletedChecker } from '../utils/pre-eval-gate/checkers/all-checkpoints-completed-checker.js';
import { PhaseHistoryCompleteChecker } from '../utils/pre-eval-gate/checkers/phase-history-checker.js';
import { EvalReportExistsChecker } from '../utils/post-eval-gate/checkers/eval-report-existence-checker.js';
import { EvalLogsChecker } from '../utils/post-eval-gate/checkers/eval-logs-checker.js';
import { AllCheckpointsFinalChecker } from '../utils/post-eval-gate/checkers/checkpoints-final-checker.js';
import { FinalStateConsistencyChecker } from '../utils/post-eval-gate/checkers/state-consistency-checker.js';
import { TaskClosableChecker } from '../utils/post-eval-gate/checkers/task-closable-checker.js';
import { EvalReportJsonChecker, EvalResultValidChecker } from '../utils/post-eval-gate/checkers/eval-result-checker.js';
import { EvalLogsAIChecker } from '../utils/post-eval-gate/checkers/eval-logs-ai-checker.js';
import { EvalResultAIChecker } from '../utils/post-eval-gate/checkers/eval-result-ai-checker.js';

describe('Eval Gate failureType', () => {
  describe('Pre-Eval Gate checkers', () => {
    it('QAPassChecker should have failureType A', () => {
      const checker = new QAPassChecker();
      expect(checker.failureType).toBe('A');
    });

    it('QAReportExistenceChecker should have failureType A', () => {
      const checker = new QAReportExistenceChecker();
      expect(checker.failureType).toBe('A');
    });

    it('DevReportChecker should have failureType A', () => {
      const checker = new DevReportChecker();
      expect(checker.failureType).toBe('A');
    });

    it('CodeReviewReportChecker should have failureType A', () => {
      const checker = new CodeReviewReportChecker();
      expect(checker.failureType).toBe('A');
    });

    it('AllCheckpointsCompletedChecker should have failureType A', () => {
      const checker = new AllCheckpointsCompletedChecker();
      expect(checker.failureType).toBe('A');
    });

    it('PhaseHistoryCompleteChecker should have failureType A', () => {
      const checker = new PhaseHistoryCompleteChecker();
      expect(checker.failureType).toBe('A');
    });
  });

  describe('Post-Eval Gate A-type checkers', () => {
    it('AllCheckpointsFinalChecker should have failureType A', () => {
      const checker = new AllCheckpointsFinalChecker();
      expect(checker.failureType).toBe('A');
    });

    it('FinalStateConsistencyChecker should have failureType A', () => {
      const checker = new FinalStateConsistencyChecker();
      expect(checker.failureType).toBe('A');
    });

    it('TaskClosableChecker should have failureType A', () => {
      const checker = new TaskClosableChecker();
      expect(checker.failureType).toBe('A');
    });
  });

  describe('Post-Eval Gate B-type checkers', () => {
    it('EvalReportExistsChecker should have failureType B', () => {
      const checker = new EvalReportExistsChecker();
      expect(checker.failureType).toBe('B');
    });

    it('EvalLogsChecker should have failureType B', () => {
      const checker = new EvalLogsChecker();
      expect(checker.failureType).toBe('B');
    });

    it('EvalReportJsonChecker should have failureType B', () => {
      const checker = new EvalReportJsonChecker();
      expect(checker.failureType).toBe('B');
    });

    it('EvalResultValidChecker should have failureType B', () => {
      const checker = new EvalResultValidChecker();
      expect(checker.failureType).toBe('B');
    });

    it('EvalLogsAIChecker should have failureType B', () => {
      const checker = new EvalLogsAIChecker();
      expect(checker.failureType).toBe('B');
    });

    it('EvalResultAIChecker should have failureType B', () => {
      const checker = new EvalResultAIChecker();
      expect(checker.failureType).toBe('B');
    });
  });

  describe('failureType included in check results', () => {
    it('QAPassChecker should include failureType in check result details', async () => {
      const checker = new QAPassChecker();
      const result = await checker.check({
        taskId: 'TASK-001',
        cwd: '/tmp',
        task: { id: 'TASK-001', checkpoints: [] } as any,
        qaReport: { verdict: 'PASS', verifiedAt: '2024-01-01' },
      });
      expect(result.details).toHaveProperty('failureType', 'A');
    });

    it('AllCheckpointsFinalChecker should include failureType in check result details', async () => {
      const checker = new AllCheckpointsFinalChecker();
      const result = await checker.check({
        taskId: 'TASK-001',
        cwd: '/tmp',
        task: { id: 'TASK-001', checkpoints: [{ id: 'CP-1', status: 'completed' }] } as any,
        evalReport: { result: 'PASS' } as any,
      });
      expect(result.details).toHaveProperty('failureType', 'A');
    });

    it('FinalStateConsistencyChecker should include failureType in check result details', async () => {
      const checker = new FinalStateConsistencyChecker();
      const result = await checker.check({
        taskId: 'TASK-001',
        cwd: '/tmp',
        task: { id: 'TASK-001', status: 'in_review', checkpoints: [] } as any,
        evalReport: { result: 'PASS' } as any,
      });
      expect(result.details).toHaveProperty('failureType', 'A');
    });

    it('TaskClosableChecker should include failureType in check result details', async () => {
      const checker = new TaskClosableChecker();
      const result = await checker.check({
        taskId: 'TASK-001',
        cwd: '/tmp',
        task: { id: 'TASK-001', status: 'completed', checkpoints: [{ id: 'CP-1', status: 'completed' }] } as any,
        evalReport: { result: 'PASS' } as any,
      });
      expect(result.details).toHaveProperty('failureType', 'A');
    });
  });
});
