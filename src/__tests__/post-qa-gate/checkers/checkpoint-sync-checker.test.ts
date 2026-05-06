/**
 * Checkpoint Sync Checker Tests
 * 检查点状态同步检查器测试
 *
 * 对齐规则:
 * - R-QA-POST-006: 检查点状态同步 (ERROR级)
 *
 * @module __tests__/post-qa-gate/checkers/checkpoint-sync-checker
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  QACheckpointSyncChecker,
  createCheckpointSyncChecker,
  quickCheckpointSyncCheck,
} from '../../../utils/post-qa-gate/checkers/checkpoint-sync-checker.js';
import type { CheckpointMetadata } from '../../../types/task.js';

describe('CheckpointSyncChecker', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-sync-test-'));
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

  // ============== QACheckpointSyncChecker (R-QA-POST-006) ==============

  describe('QACheckpointSyncChecker (R-QA-POST-006)', () => {
    it('should pass when no checkpoints exist', async () => {
      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check('TASK-test-1', []);

      expect(result.passed).toBe(true);
      expect(result.check).toBe('checkpoint_sync');
      expect(result.message).toContain('没有QA相关检查点');
      expect(result.details?.qaCheckpoints).toBe(0);
    });

    it('should pass when no QA verification checkpoints exist', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'code_review' }),
        createCheckpoint({ id: 'CP-002', description: '普通检查点' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check('TASK-test-1', checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('没有QA相关检查点');
    });

    it('should pass when QA report does not exist', async () => {
      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check('TASK-nonexistent', checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('QA报告不存在');
    });

    it('should pass when QA result is PASS and all QA checkpoints are completed', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'completed' }),
        createCheckpoint({ id: 'CP-002', category: 'qa_verification', status: 'completed' }),
        createCheckpoint({ id: 'CP-003', category: 'code_review', status: 'pending' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('检查点状态同步');
      expect(result.details?.reportVerdict).toBe('PASS');
      expect(result.details?.qaCheckpoints).toBe(2);
      expect(result.details?.completedQACheckpoints).toBe(2);
    });

    it('should fail when QA result is PASS but QA checkpoints are not completed', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'completed', description: '测试通过检查' }),
        createCheckpoint({ id: 'CP-002', category: 'qa_verification', status: 'pending', description: '回归测试检查' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(false);
      expect(result.check).toBe('checkpoint_sync');
      expect(result.message).toContain('检查点状态不同步');
      expect(result.details?.mismatched).toHaveLength(1);
      expect((result.details?.mismatched as any[])[0].id).toBe('CP-002');
      expect((result.details?.mismatched as any[])[0].expectedStatus).toBe('completed');
    });

    it('should allow requiresHuman checkpoints to be uncompleted when PASS', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      });

      const checkpoints = [
        createCheckpoint({
          id: 'CP-001',
          category: 'qa_verification',
          status: 'completed',
          description: '自动化测试检查',
        }),
        createCheckpoint({
          id: 'CP-002',
          category: 'qa_verification',
          status: 'pending',
          requiresHuman: true,
          description: 'UI截图人工确认',
        }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('检查点状态同步');
    });

    it('should pass when QA result is NOPASS regardless of checkpoint status', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'NOPASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'Tests failed',
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'pending' }),
        createCheckpoint({ id: 'CP-002', category: 'qa_verification', status: 'failed' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.details?.reportVerdict).toBe('NOPASS');
    });

    it('should only check qa_verification category checkpoints', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'completed' }),
        createCheckpoint({ id: 'CP-002', category: 'code_review', status: 'pending' }),
        createCheckpoint({ id: 'CP-003', status: 'pending' }), // 无 category
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.details?.qaCheckpoints).toBe(1);
      expect(result.details?.totalCheckpoints).toBe(3);
    });

    it('should handle invalid QA report gracefully', async () => {
      const taskId = 'TASK-test-1';
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, 'not valid json{{{');

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('QA报告不存在');
    });

    it('should include checkpoint details in result', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        version: '1.0.0',
        taskId,
        verdict: 'PASS',
        verifiedAt: new Date().toISOString(),
        verifier: 'qa_tester',
        summary: 'All tests passed',
      });

      const checkpoints = [
        createCheckpoint({
          id: 'CP-001',
          category: 'qa_verification',
          status: 'completed',
          description: '单元测试通过',
        }),
        createCheckpoint({
          id: 'CP-002',
          category: 'qa_verification',
          status: 'completed',
          description: '集成测试通过',
        }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir);
      const result = await checker.check(taskId, checkpoints);

      expect(result.details?.checkpoints).toHaveLength(2);
      expect((result.details?.checkpoints as any[])[0].id).toBe('CP-001');
      expect((result.details?.checkpoints as any[])[0].description).toBe('单元测试通过');
      expect((result.details?.checkpoints as any[])[0].status).toBe('completed');
    });

    it('should use custom report path', async () => {
      const taskId = 'TASK-test-1';
      const customPath = 'custom/{taskId}/qa.json';
      const fullPath = path.join(tempDir, 'custom', taskId, 'qa.json');
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify({
        verdict: 'PASS',
      }));

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'pending' }),
      ];

      const checker = new QACheckpointSyncChecker(tempDir, { reportPath: customPath });
      const result = await checker.check(taskId, checkpoints);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('检查点状态不同步');
    });
  });

  // ============== 便捷函数 ==============

  describe('Utility Functions', () => {
    it('createCheckpointSyncChecker should create checker instance', () => {
      const checker = createCheckpointSyncChecker(tempDir);
      expect(checker).toBeInstanceOf(QACheckpointSyncChecker);
    });

    it('quickCheckpointSyncCheck should return check result', async () => {
      const taskId = 'TASK-test-1';
      createQAReport(taskId, {
        verdict: 'PASS',
      });

      const checkpoints = [
        createCheckpoint({ id: 'CP-001', category: 'qa_verification', status: 'completed' }),
      ];

      const result = await quickCheckpointSyncCheck(taskId, checkpoints, tempDir);
      expect(result.passed).toBe(true);
      expect(result.check).toBe('checkpoint_sync');
    });
  });
});
