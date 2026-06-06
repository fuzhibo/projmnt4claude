/**
 * Post-CR Gate Runner Tests
 * 代码审核后质量门禁运行器测试
 *
 * @module __tests__/post-cr-gate-runner
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PostCRGateRunner,
  createPostCRGateRunner,
  quickPostCRGateCheck,
  batchPostCRGateCheck,
  generateTestEnvConfig,
  DEFAULT_POST_CR_GATE_RULES,
  DEFAULT_POST_CR_GATE_RUNNER_CONFIG,
} from '../utils/post-cr-gate/runner.js';
import { createDefaultTaskMeta } from '../types/task.js';
import { writeTaskMeta } from '../utils/task.js';
import {
  createIsolatedTestEnv,
  createTaskDir,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

describe('PostCRGateRunner', () => {
  let env: IsolatedTestEnv;
  let runner: PostCRGateRunner;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'post-cr-gate-test-' });
    runner = createPostCRGateRunner(env.tempDir);

    // Create additional directories needed for tests
    fs.mkdirSync(path.join(env.tempDir, '.projmnt4claude', 'outputs'), { recursive: true });
    fs.mkdirSync(path.join(env.tempDir, '.projmnt4claude', 'reports'), { recursive: true });
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('Basic Functionality', () => {
    it('should create runner with default config', () => {
      expect(runner).toBeDefined();
      const config = runner.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.rules).toHaveLength(DEFAULT_POST_CR_GATE_RULES.length);
    });

    it('should skip gate when disabled', async () => {
      const disabledRunner = createPostCRGateRunner(env.tempDir, { enabled: false });
      const taskId = 'TASK-test-P2-test-task-20260101';

      // Create task
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const result = await disabledRunner.run(taskId);

      expect(result.decision).toBe('POST_CR_PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults).toHaveLength(0);
    });

    it('should fail when task does not exist', async () => {
      const result = await runner.run('TASK-nonexistent-P2-test-20260101');

      expect(result.decision).toBe('POST_CR_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.failedRules).toBe(1);
    });
  });

  describe('Report Existence Check (R-CR-POST-001)', () => {
    it('should fail when report does not exist', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const result = await runner.run(taskId);

      const reportCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-001');
      expect(reportCheck?.passed).toBe(false);
      expect(reportCheck?.message).toContain('不存在');
    });

    it('should pass when report exists', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      // Create report
      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const reportCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-001');
      expect(reportCheck?.passed).toBe(true);
      expect(reportCheck?.message).toContain('存在');
    });
  });

  describe('Report Format Check (R-CR-POST-002)', () => {
    it('should fail when report has invalid format', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      // Create invalid report
      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        // Missing required fields
        taskId,
      }));

      const result = await runner.run(taskId);

      const formatCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-002');
      expect(formatCheck?.passed).toBe(false);
      expect(formatCheck?.message).toContain('格式无效');
    });

    it('should pass when report has valid format', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      // Create valid report
      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
        issues: [],
        recommendations: [],
      }));

      const result = await runner.run(taskId);

      const formatCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-002');
      expect(formatCheck?.passed).toBe(true);
      expect(formatCheck?.message).toContain('格式有效');
    });
  });

  describe('Verdict Validity Check (R-CR-POST-003)', () => {
    it('should fail when verdict is invalid', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      // Create report with invalid verdict
      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'INVALID',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-003');
      expect(verdictCheck?.passed).toBe(false);
      expect(verdictCheck?.message).toContain('无效');
    });

    it('should pass with PASS verdict', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-003');
      expect(verdictCheck?.passed).toBe(true);
      expect(verdictCheck?.message).toContain('PASS');
    });

    it('should pass with NOPASS verdict', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary with issues',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-003');
      expect(verdictCheck?.passed).toBe(true);
      expect(verdictCheck?.message).toContain('NOPASS');
    });
  });

  describe('Summary Completeness Check (R-CR-POST-004)', () => {
    it('should fail when summary is too short', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Short', // Less than 10 characters
      }));

      const result = await runner.run(taskId);

      const summaryCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-004');
      expect(summaryCheck?.passed).toBe(false);
      expect(summaryCheck?.message).toContain('内容过短');
    });

    it('should pass when summary is complete', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'This is a complete summary of the code review.',
      }));

      const result = await runner.run(taskId);

      const summaryCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-004');
      expect(summaryCheck?.passed).toBe(true);
    });
  });

  describe('Timestamp Validity Check (R-CR-POST-007)', () => {
    it('should fail when timestamp is in the future', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: futureDate.toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const timestampCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-007');
      expect(timestampCheck?.passed).toBe(false);
      expect(timestampCheck?.message).toContain('未来日期');
    });

    it('should pass with valid timestamp', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const timestampCheck = result.ruleResults.find(r => r.ruleId === 'R-CR-POST-007');
      expect(timestampCheck?.passed).toBe(true);
    });
  });

  describe('Overall Decision', () => {
    it('should return POST_CR_PASS when all checks pass', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task with test verification', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Code review checkpoint',
          status: 'completed',
          verification: {
            method: 'code_review',
            commands: ['npm test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'This is a complete summary of the code review with enough length.',
        recommendations: ['Recommendation 1'],
      }));

      // Create test env config to pass R-CR-POST-008
      const testEnvPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(testEnvPath), { recursive: true });
      fs.writeFileSync(testEnvPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        generatedAt: new Date().toISOString(),
        environment: {
          testCommands: ['npm test'],
          envVars: { NODE_ENV: 'test' },
          dependencies: [],
        },
        recommendations: ['Run bun install first'],
      }));

      const result = await runner.run(taskId);

      expect(result.decision).toBe('POST_CR_PASS');
      expect(result.allowed).toBe(true);
    });

    it('should return POST_CR_WARN when non-blocking checks fail', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Short', // This will fail summary check but it's non-blocking
      }));

      const result = await runner.run(taskId);

      expect(result.decision).toBe('POST_CR_WARN');
      expect(result.allowed).toBe(true);
      expect(result.warningCount).toBeGreaterThan(0);
    });
  });

  describe('Report Generation', () => {
    it('should generate report when configured', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task with test verification', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Code review checkpoint',
          status: 'completed',
          verification: {
            method: 'code_review',
            commands: ['npm test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, env.tempDir);

      const reportPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'code-review-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        reviewedAt: new Date().toISOString(),
        reviewer: 'test',
        summary: 'Complete summary with enough length to pass validation.',
      }));

      // Create test env config to pass R-CR-POST-008
      const testEnvPath = path.join(env.tempDir, '.projmnt4claude', 'outputs', taskId, 'tasks_test_env_adv.json');
      fs.mkdirSync(path.dirname(testEnvPath), { recursive: true });
      fs.writeFileSync(testEnvPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        generatedAt: new Date().toISOString(),
        environment: {
          testCommands: ['npm test'],
          envVars: { NODE_ENV: 'test' },
          dependencies: [],
        },
        recommendations: ['Run bun install first'],
      }));

      const gateReportPath = path.join(env.tempDir, '.projmnt4claude', 'reports', 'post-cr-gate-report.json');
      const customRunner = createPostCRGateRunner(env.tempDir, {
        generateReport: true,
        reportPath: '.projmnt4claude/reports/post-cr-gate-report.json',
      });

      await customRunner.run(taskId);

      expect(fs.existsSync(gateReportPath)).toBe(true);

      const report = JSON.parse(fs.readFileSync(gateReportPath, 'utf-8'));
      expect(report.taskId).toBe(taskId);
      expect(report.result.decision).toBe('POST_CR_PASS');
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Utility Functions', () => {
    it('quickPostCRGateCheck should work', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, env.tempDir);

      const result = await quickPostCRGateCheck(taskId, env.tempDir);
      expect(result.taskId).toBe(taskId);
    });

    it('batchPostCRGateCheck should work', async () => {
      const taskIds = [
        'TASK-feature-P2-test-task-1-20260101',
        'TASK-feature-P2-test-task-2-20260101',
      ];

      for (const taskId of taskIds) {
        const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
        writeTaskMeta(task, env.tempDir);
      }

      const results = await batchPostCRGateCheck(taskIds, env.tempDir);
      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe(taskIds[0]);
      expect(results[1].taskId).toBe(taskIds[1]);
    });

    it('generateTestEnvConfig should create config', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Test checkpoint',
          status: 'pending',
          verification: {
            method: 'unit_test',
            commands: ['npm test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, env.tempDir);

      const configPath = await generateTestEnvConfig(taskId, env.tempDir);
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.taskId).toBe(taskId);
      expect(config.environment.testCommands).toContain('npm test');
    });
  });

  describe('Configuration Management', () => {
    it('should update config', () => {
      const customRunner = createPostCRGateRunner(env.tempDir);
      customRunner.updateConfig({ enabled: false });

      const config = customRunner.getConfig();
      expect(config.enabled).toBe(false);
    });

    it('should add custom rule', () => {
      const customRunner = createPostCRGateRunner(env.tempDir);
      const newRule = {
        id: 'custom-rule',
        type: 'custom' as const,
        name: 'Custom Rule',
        description: 'Test custom rule',
        enabled: true,
        priority: 100,
        blocking: false,
      };

      customRunner.addRule(newRule);

      const config = customRunner.getConfig();
      expect(config.rules.some(r => r.id === 'custom-rule')).toBe(true);
    });

    it('should remove rule', () => {
      const customRunner = createPostCRGateRunner(env.tempDir);
      customRunner.removeRule('R-CR-POST-001');

      const config = customRunner.getConfig();
      expect(config.rules.some(r => r.id === 'R-CR-POST-001')).toBe(false);
    });
  });
});
