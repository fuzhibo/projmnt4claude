/**
 * Post-QA Gate Runner Tests
 * QA验证阶段后质量门禁运行器测试
 *
 * 对齐设计文档 hd-p13-qa-post-gate-design.md
 * 8条规则: R-QA-POST-001 ~ R-QA-POST-007 + R-QA-POST-005a
 *
 * @module __tests__/post-qa-gate-runner
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PostQAGateRunner,
  createPostQAGateRunner,
  quickPostQAGateCheck,
  batchPostQAGateCheck,
  DEFAULT_POST_QA_GATE_RULES,
  DEFAULT_POST_QA_GATE_RUNNER_CONFIG,
} from '../utils/post-qa-gate/runner.js';
import type { PendingHumanVerification } from '../utils/post-qa-gate/runner.js';
import { createDefaultTaskMeta } from '../types/task.js';
import { writeTaskMeta } from '../utils/task.js';

describe('PostQAGateRunner', () => {
  let tempDir: string;
  let runner: PostQAGateRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-qa-gate-test-'));
    runner = createPostQAGateRunner(tempDir);

    // Create .projmnt4claude structure
    fs.mkdirSync(path.join(tempDir, '.projmnt4claude', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.projmnt4claude', 'outputs'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.projmnt4claude', 'reports'), { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Basic Functionality', () => {
    it('should create runner with default config (8 rules)', () => {
      expect(runner).toBeDefined();
      const config = runner.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.rules).toHaveLength(8);
    });

    it('should have correct rule IDs matching design doc', () => {
      const ruleIds = DEFAULT_POST_QA_GATE_RULES.map(r => r.id);
      expect(ruleIds).toContain('R-QA-POST-001');
      expect(ruleIds).toContain('R-QA-POST-002');
      expect(ruleIds).toContain('R-QA-POST-003');
      expect(ruleIds).toContain('R-QA-POST-004');
      expect(ruleIds).toContain('R-QA-POST-005');
      expect(ruleIds).toContain('R-QA-POST-005a');
      expect(ruleIds).toContain('R-QA-POST-006');
      expect(ruleIds).toContain('R-QA-POST-007');
    });

    it('should skip gate when disabled', async () => {
      const disabledRunner = createPostQAGateRunner(tempDir, { enabled: false });
      const taskId = 'TASK-test-P2-test-task-20260101';

      // Create task
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const result = await disabledRunner.run(taskId);

      expect(result.decision).toBe('POST_QA_PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults).toHaveLength(0);
    });

    it('should fail when task does not exist', async () => {
      const result = await runner.run('TASK-nonexistent-P2-test-20260101');

      expect(result.decision).toBe('POST_QA_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.failedRules).toBe(1);
    });
  });

  describe('R-QA-POST-001: QA报告存在', () => {
    it('should fail when report does not exist', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const result = await runner.run(taskId);

      const reportCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-001');
      expect(reportCheck?.passed).toBe(false);
      expect(reportCheck?.message).toContain('不存在');
    });

    it('should pass when report exists', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      // Create report
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const reportCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-001');
      expect(reportCheck?.passed).toBe(true);
      expect(reportCheck?.message).toContain('存在');
    });
  });

  describe('R-QA-POST-002: 报告格式有效', () => {
    it('should fail when report has invalid JSON', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      // Create invalid JSON report
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, 'not valid json{{{');

      const result = await runner.run(taskId);

      const formatCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-002');
      expect(formatCheck?.passed).toBe(false);
    });

    it('should fail when report has missing required fields', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      // Create report with missing fields
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        taskId,
      }));

      const result = await runner.run(taskId);

      const formatCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-002');
      expect(formatCheck?.passed).toBe(false);
      expect(formatCheck?.message).toContain('格式无效');
    });

    it('should pass when report has valid format', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      // Create valid report
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const formatCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-002');
      expect(formatCheck?.passed).toBe(true);
      expect(formatCheck?.message).toContain('格式有效');
    });
  });

  describe('R-QA-POST-003: 测试结果有效', () => {
    it('should fail when verdict is invalid', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'INVALID',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-003');
      expect(verdictCheck?.passed).toBe(false);
      expect(verdictCheck?.message).toContain('无效');
    });

    it('should pass with PASS verdict', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-003');
      expect(verdictCheck?.passed).toBe(true);
      expect(verdictCheck?.message).toContain('PASS');
    });

    it('should pass with NOPASS verdict', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary with issues',
      }));

      const result = await runner.run(taskId);

      const verdictCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-003');
      expect(verdictCheck?.passed).toBe(true);
      expect(verdictCheck?.message).toContain('NOPASS');
    });
  });

  describe('R-QA-POST-004: 测试失败详情', () => {
    it('should pass when verdict is PASS (no failures needed)', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const failuresCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-004');
      expect(failuresCheck?.passed).toBe(true);
      expect(failuresCheck?.message).toContain('PASS');
    });

    it('should fail when NOPASS but no testFailures', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Some tests failed',
      }));

      const result = await runner.run(taskId);

      const failuresCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-004');
      expect(failuresCheck?.passed).toBe(false);
      expect(failuresCheck?.message).toContain('缺少测试失败详情');
    });

    it('should fail when NOPASS but testFailures lack details', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Some tests failed',
        testFailures: [
          { testName: 'test1' }, // Missing reason and severity
          { testName: 'test2', reason: 'Failed', severity: 'high' },
        ],
      }));

      const result = await runner.run(taskId);

      const failuresCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-004');
      expect(failuresCheck?.passed).toBe(false);
    });

    it('should pass when NOPASS with complete testFailures', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Some tests failed',
        testFailures: [
          { testName: 'test1', reason: 'Assertion failed', severity: 'high' },
          { testName: 'test2', reason: 'Timeout', severity: 'medium' },
        ],
      }));

      const result = await runner.run(taskId);

      const failuresCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-004');
      expect(failuresCheck?.passed).toBe(true);
    });
  });

  describe('R-QA-POST-005: 人工验证状态收集', () => {
    it('should always pass (INFO level, non-blocking)', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const humanCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-005');
      expect(humanCheck?.passed).toBe(true);
    });

    it('should collect pending human verification checkpoints', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Manual review required',
          status: 'pending',
          requiresHuman: true,
          verification: { method: 'code_review' as const, commands: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'CP-002',
          description: 'Auto test checkpoint',
          status: 'completed',
          requiresHuman: false,
          verification: { method: 'unit_test' as const, commands: ['bun test'] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const humanCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-005');
      expect(humanCheck?.passed).toBe(true);
      expect(humanCheck?.message).toContain('1 个待人工验证检查点');

      // Should be in run result
      const pending = result.pendingHumanVerifications;
      expect(pending).toBeDefined();
      expect(pending).toHaveLength(1);
      expect(pending![0]!.id).toBe('CP-001');
    });

    it('should not collect verified checkpoints', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Manual review required',
          status: 'pending',
          requiresHuman: true,
          verification: { method: 'code_review' as const, commands: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
        humanVerificationCheckpoints: ['CP-001'], // Already verified
      }));

      const result = await runner.run(taskId);

      const humanCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-005');
      expect(humanCheck?.passed).toBe(true);
      expect(humanCheck?.message).toContain('无待人工验证检查点');
      expect(result.pendingHumanVerifications).toBeUndefined();
    });
  });

  describe('R-QA-POST-005a: 人工验证汇总通知', () => {
    it('should pass when no pending verifications', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const notifyCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-005a');
      expect(notifyCheck?.passed).toBe(true);
      expect(notifyCheck?.message).toContain('无待人工验证检查点');
    });

    it('should generate notification when pending verifications exist', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'Manual review required',
          status: 'pending',
          requiresHuman: true,
          verification: { method: 'code_review' as const, commands: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const notifyCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-005a');
      expect(notifyCheck?.passed).toBe(true);
      expect(notifyCheck?.message).toContain('1 个检查点待验证');
      expect(notifyCheck?.details?.notificationSummary).toContain('待人工验证检查点汇总');
    });
  });

  describe('R-QA-POST-006: 检查点状态同步', () => {
    it('should pass when no QA checkpoints', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const syncCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-006');
      expect(syncCheck?.passed).toBe(true);
      expect(syncCheck?.message).toContain('跳过同步检查');
    });

    it('should pass when QA result PASS and checkpoints completed', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'QA verification checkpoint',
          status: 'completed',
          verification: { method: 'unit_test', commands: ['bun test'] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      }));

      const result = await runner.run(taskId);

      const syncCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-006');
      expect(syncCheck?.passed).toBe(true);
      expect(syncCheck?.message).toContain('同步');
    });
  });

  describe('R-QA-POST-007: 测试覆盖率达标', () => {
    it('should fail when coverage below threshold', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
        coverage: 0.3, // 30% - below 60% threshold
      }));

      const result = await runner.run(taskId);

      const coverageCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-007');
      expect(coverageCheck?.passed).toBe(false);
      expect(coverageCheck?.message).toContain('未达标');
    });

    it('should pass when coverage meets threshold', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
        coverage: 0.8, // 80% - above 60% threshold
      }));

      const result = await runner.run(taskId);

      const coverageCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-007');
      expect(coverageCheck?.passed).toBe(true);
      expect(coverageCheck?.message).toContain('达标');
    });

    it('should use custom threshold from rule config', async () => {
      const customRunner = createPostQAGateRunner(tempDir, {
        rules: DEFAULT_POST_QA_GATE_RULES.map(r =>
          r.id === 'R-QA-POST-007'
            ? { ...r, config: { minCoverage: 0.9 } }
            : r
        ),
      });

      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
        coverage: 0.8, // 80% - below 90% custom threshold
      }));

      const result = await customRunner.run(taskId);

      const coverageCheck = result.ruleResults.find(r => r.ruleId === 'R-QA-POST-007');
      expect(coverageCheck?.passed).toBe(false);
    });
  });

  describe('Overall Decision', () => {
    it('should return POST_QA_PASS when all checks pass', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task with QA verification', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'QA verification checkpoint',
          status: 'completed',
          verification: {
            method: 'unit_test',
            commands: ['bun test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'This is a complete summary of the QA verification with enough length.',
        testFailures: [],
        coverage: 0.85,
      }));

      const result = await runner.run(taskId);

      expect(result.decision).toBe('POST_QA_PASS');
      expect(result.allowed).toBe(true);
    });

    it('should return POST_QA_WARN when non-blocking checks fail', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test summary with enough length for validation.',
        coverage: 0.3, // Below threshold - non-blocking warning
      }));

      const result = await runner.run(taskId);

      expect(result.decision).toBe('POST_QA_WARN');
      expect(result.allowed).toBe(true);
      expect(result.warningCount).toBeGreaterThan(0);
    });

    it('should return POST_QA_FAIL when blocking checks fail', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      // No report created - blocking check R-QA-POST-001 will fail

      const result = await runner.run(taskId);

      expect(result.decision).toBe('POST_QA_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });

  describe('Report Generation', () => {
    it('should generate report when configured', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task with QA verification', 'feature');
      task.checkpoints = [
        {
          id: 'CP-001',
          description: 'QA verification checkpoint',
          status: 'completed',
          verification: {
            method: 'unit_test',
            commands: ['bun test'],
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeTaskMeta(task, tempDir);

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Complete summary with enough length to pass validation.',
        coverage: 0.85,
      }));

      const gateReportPath = path.join(tempDir, '.projmnt4claude', 'reports', 'post-qa-gate-report.json');
      const customRunner = createPostQAGateRunner(tempDir, {
        generateReport: true,
        reportPath: '.projmnt4claude/reports/post-qa-gate-report.json',
      });

      await customRunner.run(taskId);

      expect(fs.existsSync(gateReportPath)).toBe(true);

      const report = JSON.parse(fs.readFileSync(gateReportPath, 'utf-8'));
      expect(report.taskId).toBe(taskId);
      expect(report.result.decision).toBe('POST_QA_PASS');
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Utility Functions', () => {
    it('quickPostQAGateCheck should work', async () => {
      const taskId = 'TASK-feature-P2-test-task-20260101';
      const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
      writeTaskMeta(task, tempDir);

      const result = await quickPostQAGateCheck(taskId, tempDir);
      expect(result.taskId).toBe(taskId);
    });

    it('batchPostQAGateCheck should work', async () => {
      const taskIds = [
        'TASK-feature-P2-test-task-1-20260101',
        'TASK-feature-P2-test-task-2-20260101',
      ];

      for (const taskId of taskIds) {
        const task = createDefaultTaskMeta(taskId, 'Test Task', 'feature');
        writeTaskMeta(task, tempDir);
      }

      const results = await batchPostQAGateCheck(taskIds, tempDir);
      expect(results).toHaveLength(2);
      expect(results[0]!.taskId).toBe(taskIds[0]!);
      expect(results[1]!.taskId).toBe(taskIds[1]!);
    });
  });

  describe('Configuration Management', () => {
    it('should update config', () => {
      const customRunner = createPostQAGateRunner(tempDir);
      customRunner.updateConfig({ enabled: false });

      const config = customRunner.getConfig();
      expect(config.enabled).toBe(false);
    });

    it('should add custom rule', () => {
      const customRunner = createPostQAGateRunner(tempDir);
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
      const customRunner = createPostQAGateRunner(tempDir);
      customRunner.removeRule('R-QA-POST-001');

      const config = customRunner.getConfig();
      expect(config.rules.some(r => r.id === 'R-QA-POST-001')).toBe(false);
    });
  });
});
