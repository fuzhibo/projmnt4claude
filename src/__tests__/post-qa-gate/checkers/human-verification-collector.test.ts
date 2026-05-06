/**
 * Human Verification Collector Tests
 * 人工验证状态收集器测试
 *
 * 对齐规则:
 * - R-QA-POST-005: 人工验证状态收集 (INFO级)
 * - R-QA-POST-005a: 人工验证汇总通知 (INFO级)
 *
 * @module __tests__/post-qa-gate/checkers/human-verification-collector
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  HumanVerificationPendingCollector,
  PipelineExitHumanVerificationNotifier,
  HumanVerificationChecker,
  createHumanVerificationChecker,
  quickHumanVerificationCheck,
} from '../../../utils/post-qa-gate/checkers/human-verification-collector.js';
import type { CheckpointMetadata } from '../../../types/task.js';

describe('HumanVerificationCollector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-verification-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * 辅助: 创建检查点
   */
  function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
    return {
      id: 'CP-001',
      description: 'Test checkpoint',
      status: 'pending',
      requiresHuman: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * 辅助: 创建QA报告文件
   */
  function createQAReport(taskId: string, report: Record<string, unknown>): void {
    const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  // ============== CP-001: HumanVerificationPendingCollector (R-QA-POST-005) ==============

  describe('HumanVerificationPendingCollector (R-QA-POST-005)', () => {
    it('should return no pending when no checkpoints', async () => {
      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check('TASK-test-1', []);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('human_verification_collect');
      expect(result.message).toContain('无待人工验证检查点');
      expect(result.details?.pendingHumanVerifications).toEqual([]);
    });

    it('should return no pending when no requiresHuman checkpoints', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: false }),
        createCheckpoint({ id: 'CP-002', requiresHuman: false, status: 'completed' }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check('TASK-test-1', checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('无待人工验证检查点');
    });

    it('should collect requiresHuman checkpoints that are not completed', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true, description: 'UI截图确认' }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true, status: 'completed', description: '已验证' }),
        createCheckpoint({ id: 'CP-003', requiresHuman: false, description: '自动检查' }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check('TASK-test-1', checkpoints);

      expect(result.passed).toBe(true); // INFO级别，不阻断
      expect(result.message).toContain('1 个待人工验证检查点');
      expect(result.details?.pendingHumanVerifications).toHaveLength(1);
      expect((result.details?.pendingHumanVerifications as any[])[0].id).toBe('CP-001');
    });

    it('should exclude checkpoints verified in QA report', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Test',
        humanVerificationCheckpoints: ['CP-001'],
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true, description: '已验证的检查点' }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true, description: '未验证的检查点' }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.details?.pendingHumanVerifications).toHaveLength(1);
      expect((result.details?.pendingHumanVerifications as any[])[0].id).toBe('CP-002');
    });

    it('should handle missing QA report gracefully', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check('TASK-nonexistent', checkpoints);

      expect(result.passed).toBe(true);
      expect(result.details?.pendingHumanVerifications).toHaveLength(1);
    });

    it('should handle invalid QA report gracefully', async () => {
      const taskId = 'TASK-test-1';
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, 'not valid json{{{');

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.details?.pendingHumanVerifications).toHaveLength(1);
    });

    it('should include correct details', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true, status: 'completed' }),
        createCheckpoint({ id: 'CP-003', requiresHuman: false }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const result = await collector.check('TASK-test-1', checkpoints);

      expect(result.details?.totalCheckpoints).toBe(3);
      expect(result.details?.requiresHumanCount).toBe(2);
      expect(result.details?.verifiedCount).toBe(0);
      expect(result.details?.willNotifyAtPipelineExit).toBe(true);
    });

    it('should use custom report path', async () => {
      const taskId = 'TASK-test-1';
      const customPath = 'custom/{taskId}/qa.json';
      const fullPath = path.join(tempDir, 'custom', taskId, 'qa.json');
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify({
        humanVerificationCheckpoints: ['CP-001'],
      }));

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir, { reportPath: customPath });
      const result = await collector.check(taskId, checkpoints);

      expect(result.details?.pendingHumanVerifications).toHaveLength(1);
      expect((result.details?.pendingHumanVerifications as any[])[0].id).toBe('CP-002');
    });
  });

  // ============== CP-002: getPendingVerifications ==============

  describe('getPendingVerifications', () => {
    it('should return pending verifications list', () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true, description: 'UI验证' }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true, status: 'completed' }),
        createCheckpoint({ id: 'CP-003', requiresHuman: false }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const pending = collector.getPendingVerifications('TASK-test-1', checkpoints);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('CP-001');
      expect(pending[0].description).toBe('UI验证');
      expect(pending[0].taskId).toBe('TASK-test-1');
    });

    it('should exclude QA-verified checkpoints', () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        humanVerificationCheckpoints: ['CP-001'],
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true }),
      ];

      const collector = new HumanVerificationPendingCollector(tempDir);
      const pending = collector.getPendingVerifications(taskId, checkpoints);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('CP-002');
    });
  });

  // ============== CP-003: PipelineExitHumanVerificationNotifier (R-QA-POST-005a) ==============

  describe('PipelineExitHumanVerificationNotifier (R-QA-POST-005a)', () => {
    it('should return empty result when no pending items', () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const result = notifier.formatNotification([]);

      expect(result.totalCount).toBe(0);
      expect(result.text).toBe('');
      expect(result.groupedByTask.size).toBe(0);
    });

    it('should format single task notification', () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const result = notifier.formatNotification([
        { id: 'CP-001', description: 'UI截图确认', taskId: 'TASK-1' },
        { id: 'CP-002', description: '文档审核', taskId: 'TASK-1' },
      ]);

      expect(result.totalCount).toBe(2);
      expect(result.text).toContain('待人工验证检查点汇总');
      expect(result.text).toContain('TASK-1');
      expect(result.text).toContain('CP-001');
      expect(result.text).toContain('UI截图确认');
      expect(result.text).toContain('CP-002');
      expect(result.text).toContain('文档审核');
      expect(result.text).toContain('总计: 2');
    });

    it('should group multiple tasks', () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const result = notifier.formatNotification([
        { id: 'CP-001', description: '检查点A1', taskId: 'TASK-A' },
        { id: 'CP-002', description: '检查点A2', taskId: 'TASK-A' },
        { id: 'CP-003', description: '检查点B1', taskId: 'TASK-B' },
      ]);

      expect(result.totalCount).toBe(3);
      expect(result.groupedByTask.size).toBe(2);
      expect(result.groupedByTask.get('TASK-A')).toHaveLength(2);
      expect(result.groupedByTask.get('TASK-B')).toHaveLength(1);
      expect(result.text).toContain('TASK-A');
      expect(result.text).toContain('TASK-B');
      expect(result.text).toContain('总计: 3');
    });

    it('should notify to console', () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        notifier.notify([
          { id: 'CP-001', description: '测试', taskId: 'TASK-1' },
        ]);

        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('待人工验证检查点汇总');
      } finally {
        console.log = originalLog;
      }
    });

    it('should not notify to console when no pending items', () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        notifier.notify([]);
        expect(logs).toHaveLength(0);
      } finally {
        console.log = originalLog;
      }
    });

    it('should write notification to file', async () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const outputPath = path.join(tempDir, 'output', 'pending-verifications.json');

      await notifier.notifyToFile(
        [
          { id: 'CP-001', description: '测试检查点', taskId: 'TASK-1' },
        ],
        outputPath
      );

      expect(fs.existsSync(outputPath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(data.totalCheckpoints).toBe(1);
      expect(data.totalTasks).toBe(1);
      expect(data.tasks['TASK-1']).toHaveLength(1);
      expect(data.generatedAt).toBeDefined();
    });

    it('should not write file when no pending items', async () => {
      const notifier = new PipelineExitHumanVerificationNotifier();
      const outputPath = path.join(tempDir, 'output', 'empty.json');

      await notifier.notifyToFile([], outputPath);

      expect(fs.existsSync(outputPath)).toBe(false);
    });
  });

  // ============== CP-004: HumanVerificationChecker (聚合) ==============

  describe('HumanVerificationChecker (aggregate)', () => {
    it('should run collector check', async () => {
      const checker = new HumanVerificationChecker(tempDir);
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
      ];

      const result = await checker.check('TASK-test-1', checkpoints);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('human_verification_collect');
    });

    it('should get pending verifications', () => {
      const checker = new HumanVerificationChecker(tempDir);
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
        createCheckpoint({ id: 'CP-002', requiresHuman: true, status: 'completed' }),
      ];

      const pending = checker.getPendingVerifications('TASK-test-1', checkpoints);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('CP-001');
    });

    it('should format exit notification', () => {
      const checker = new HumanVerificationChecker(tempDir);
      const result = checker.formatExitNotification([
        { id: 'CP-001', description: '测试', taskId: 'TASK-1' },
      ]);

      expect(result.totalCount).toBe(1);
      expect(result.text).toContain('待人工验证检查点汇总');
    });

    it('should expose individual checkers via getCheckers()', () => {
      const checker = new HumanVerificationChecker(tempDir);
      const checkers = checker.getCheckers();

      expect(checkers.collector).toBeInstanceOf(HumanVerificationPendingCollector);
      expect(checkers.notifier).toBeInstanceOf(PipelineExitHumanVerificationNotifier);
    });
  });

  // ============== 便捷函数 ==============

  describe('Utility Functions', () => {
    it('createHumanVerificationChecker should create checker instance', () => {
      const checker = createHumanVerificationChecker(tempDir);
      expect(checker).toBeInstanceOf(HumanVerificationChecker);
    });

    it('quickHumanVerificationCheck should return check result', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', requiresHuman: true }),
      ];

      const result = await quickHumanVerificationCheck('TASK-test-1', checkpoints, tempDir);
      expect(result.passed).toBe(true);
      expect(result.check).toBe('human_verification_collect');
    });
  });
});
