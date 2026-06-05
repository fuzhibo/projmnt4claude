/**
 * Eval Result AI Checker Tests
 * 评估结果 AI 审核检查器测试
 */

import { describe, test, expect, beforeEach} from '@jest/globals';
import {
  EvalResultAIChecker,
  createEvalResultAIChecker,
  checkEvalResultAI,
  DEFAULT_EVAL_RESULT_AI_CHECKER_CONFIG,
} from '../eval-result-ai-checker.js';
import type { PostEvalCheckContext, EvalReport } from '../../types.js';
import type { TaskMeta } from '../../../types/task.js';

// 创建测试上下文
function createTestContext(): PostEvalCheckContext {
  const task: TaskMeta = {
    id: 'TASK-test-001',
    title: '测试任务',
    type: 'feature',
    priority: 'P1',
    status: 'in_progress',
    dependencies: [],
    createdAt: '2026-05-22T10:00:00Z',
    updatedAt: '2026-05-22T10:00:00Z',
    history: [],
    checkpoints: [
      {
        id: 'CP-001',
        description: '验证功能实现',
        status: 'completed',
        createdAt: '2026-05-22T10:00:00Z',
        updatedAt: '2026-05-22T10:00:00Z',
      },
    ],
  };

  const evalReport: EvalReport = {
    version: '1.0',
    taskId: 'TASK-test-001',
    result: 'PASS',
    evaluatedAt: '2026-05-22T11:00:00Z',
    evaluator: 'AI-Evaluator',
    summary: '任务评估通过',
    evaluationLogs: [
      '开始评估任务',
      '检查验收标准',
      '验证检查点完成',
      '评估完成',
    ],
  };

  return {
    taskId: 'TASK-test-001',
    task,
    cwd: '/test/workspace',
    evalReport,
  };
}

describe('EvalResultAIChecker', () => {
  let checker: EvalResultAIChecker;

  beforeEach(() => {
    checker = new EvalResultAIChecker('/test/workspace');
  });

  test('应该正确初始化检查器', () => {
    expect(checker.id).toBe('R-EVAL-POST-003-AI');
    expect(checker.name).toBe('评估结果 AI 审核');
    expect(checker.failureType).toBe('B');
  });

  test('应该使用默认配置', () => {
    expect(DEFAULT_EVAL_RESULT_AI_CHECKER_CONFIG.enableAIReview).toBe(true);
    expect(DEFAULT_EVAL_RESULT_AI_CHECKER_CONFIG.aiReviewTimeout).toBe(60000);
  });

  test('当评估报告不存在时应该返回失败', async () => {
    const context = createTestContext();
    context.evalReport = undefined;

    const result = await checker.check(context);

    expect(result.passed).toBe(false);
    expect(result.severity).toBe('ERROR');
    expect(result.message).toContain('评估报告不存在');
    expect(result.details?.failureType).toBe('B');
  });

  test('当 AI 审核禁用时应该返回失败', async () => {
    const checkerDisabled = new EvalResultAIChecker('/test/workspace', {
      enableAIReview: false,
    });

    const context = createTestContext();
    const result = await checkerDisabled.check(context);

    expect(result.passed).toBe(false);
    expect(result.message).toContain('AI 审核未启用');
  });

  test('createEvalResultAIChecker 应该创建正确的实例', () => {
    const instance = createEvalResultAIChecker('/test/workspace');
    expect(instance).toBeInstanceOf(EvalResultAIChecker);
    expect(instance.id).toBe('R-EVAL-POST-003-AI');
  });

  test('checkEvalResultAI 应该返回检查结果', async () => {
    const context = createTestContext();

    const result = await checkEvalResultAI(context, '/test/workspace', {
      enableAIReview: false,
    });

    expect(result).toHaveProperty('ruleId');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('severity');
    expect(result).toHaveProperty('message');
  });
});

describe('EvalResultAIChecker - 配置验证', () => {
  test('应该支持自定义配置', () => {
    const customChecker = new EvalResultAIChecker('/test/workspace', {
      enableAIReview: false,
      aiReviewTimeout: 30000,
    });
    expect(customChecker).toBeInstanceOf(EvalResultAIChecker);
  });

  test('应该正确处理 NOPASS 结果', async () => {
    const context = createTestContext();
    context.evalReport = {
      version: '1.0',
      taskId: 'TASK-test-001',
      result: 'NOPASS',
      evaluatedAt: '2026-05-22T11:00:00Z',
      evaluator: 'AI-Evaluator',
      summary: '任务评估未通过',
      evaluationLogs: ['验收标准未满足'],
    };

    const checker = new EvalResultAIChecker('/test/workspace', {
      enableAIReview: false,
    });

    const result = await checker.check(context);
    expect(result).toHaveProperty('ruleId');
    expect(result).toHaveProperty('passed');
  });
});