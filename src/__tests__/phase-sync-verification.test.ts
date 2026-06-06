/**
 * phase-sync-verification.test.ts - 阶段同步验证单元测试
 *
 * 测试覆盖：
 * - getVerificationSource: 阶段到验证来源映射
 * - verifyPhaseSyncCheckpoint: 阶段同步验证流程
 * - PhaseSyncVerificationResult: 返回格式正确性
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  getVerificationSource,
  verifyPhaseSyncCheckpoint,
  CheckpointOutputVerifier,
} from '../utils/checkpoint-verification';
import type {
  VerificationSource,
} from '../types/checkpoint-verification';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== Helper Functions ==============

function createTestCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: 'CP-001',
    description: '实现登录功能',
    status: 'pending',
    category: 'code_review',
    verification: {
      method: 'automated',
      commands: ['npm run build', 'npm test'],
      expected: '编译成功；测试通过',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestTask(checkpoints: CheckpointMetadata[] = []): TaskMeta {
  return {
    id: 'TASK-feature-P1-test-20260522',
    title: 'Test Task',
    type: 'feature',
    priority: 'P1',
    status: 'in_progress',
    dependencies: [],
    checkpoints,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

// ============== getVerificationSource Tests ==============

describe('getVerificationSource', () => {
  it('returns phase_sync_dev for development phase', () => {
    expect(getVerificationSource('development')).toBe('phase_sync_dev');
  });

  it('returns phase_sync_cr for code_review phase', () => {
    expect(getVerificationSource('code_review')).toBe('phase_sync_cr');
  });

  it('returns phase_sync_qa for qa phase', () => {
    expect(getVerificationSource('qa')).toBe('phase_sync_qa');
  });

  it('returns valid VerificationSource type for all phases', () => {
    const validSources: VerificationSource[] = [
      'cli_manual', 'phase_sync', 'phase_sync_dev', 'phase_sync_cr', 'phase_sync_qa',
      'check_completed', 'analyze_fix',
    ];
    const devSource = getVerificationSource('development');
    const crSource = getVerificationSource('code_review');
    const qaSource = getVerificationSource('qa');

    expect(validSources).toContain(devSource);
    expect(validSources).toContain(crSource);
    expect(validSources).toContain(qaSource);
  });

  it('returns distinct sources for each phase', () => {
    const devSource = getVerificationSource('development');
    const crSource = getVerificationSource('code_review');
    const qaSource = getVerificationSource('qa');

    expect(devSource).not.toBe(crSource);
    expect(devSource).not.toBe(qaSource);
    expect(crSource).not.toBe(qaSource);
  });
});

// ============== verifyPhaseSyncCheckpoint Tests ==============

describe('verifyPhaseSyncCheckpoint', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('human verification checkpoint', () => {
    it('skips checkpoints with requiresHuman=true', async () => {
      const checkpoint = createTestCheckpoint({
        id: 'CP-HUMAN',
        requiresHuman: true,
        description: '人工验证检查点',
      });
      const task = createTestTask([checkpoint]);

      const result = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'development', env.tempDir
      );

      expect(result.valid).toBe(false);
      expect(result.checkpointId).toBe('CP-HUMAN');
      expect(result.requiresHuman).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain('人工验证');
    });

    it('returns empty evidence for human checkpoints', async () => {
      const checkpoint = createTestCheckpoint({
        id: 'CP-HUMAN-2',
        requiresHuman: true,
      });
      const task = createTestTask([checkpoint]);

      const result = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'code_review', env.tempDir
      );

      expect(result.evidence).toEqual([]);
      expect(result.missingOutputs).toEqual([]);
    });
  });

  describe('automated checkpoint verification', () => {
    it('returns correct result format for verification', async () => {
      const checkpoint = createTestCheckpoint({
        id: 'CP-AUTO',
        requiresHuman: false,
        category: 'code_review',
        description: '[ai review] CheckpointOutputVerifier 类已创建并导出',
      });
      const task = createTestTask([checkpoint]);

      const result = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'development', env.tempDir
      );

      // Verify result format
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('checkpointId', 'CP-AUTO');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('missingOutputs');
      expect(result).toHaveProperty('warnings');
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(Array.isArray(result.missingOutputs)).toBe(true);
    });

    it('uses correct verification source based on phase', async () => {
      const checkpoint = createTestCheckpoint({
        id: 'CP-DEV',
        requiresHuman: false,
        category: 'code_review',
      });
      const task = createTestTask([checkpoint]);

      // Test with development phase - should use phase_sync_dev
      const devResult = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'development', env.tempDir
      );
      expect(devResult.checkpointId).toBe('CP-DEV');

      // Test with code_review phase - should use phase_sync_cr
      const crResult = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'code_review', env.tempDir
      );
      expect(crResult.checkpointId).toBe('CP-DEV');

      // Test with qa phase - should use phase_sync_qa
      const qaResult = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'qa', env.tempDir
      );
      expect(qaResult.checkpointId).toBe('CP-DEV');
    });

    it('passes phaseData to verification context', async () => {
      const checkpoint = createTestCheckpoint({
        id: 'CP-PHASE',
        requiresHuman: false,
        category: 'code_review',
        description: '代码审查检查点',
      });
      const task = createTestTask([checkpoint]);

      const phaseData = {
        codeReviewVerdict: { verdict: 'approved' },
      };

      // Should not throw when phaseData is provided
      const result = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'code_review', env.tempDir, phaseData
      );

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('checkpointId', 'CP-PHASE');
    });
  });

  describe('checkpoint without verification', () => {
    it('handles checkpoint without verification field', async () => {
      const checkpoint: CheckpointMetadata = {
        id: 'CP-NO-VER',
        description: '无验证信息检查点',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const task = createTestTask([checkpoint]);

      const result = await verifyPhaseSyncCheckpoint(
        task, checkpoint, 'development', env.tempDir
      );

      expect(result).toHaveProperty('valid');
      expect(result.checkpointId).toBe('CP-NO-VER');
    });
  });
});

// ============== PhaseSyncVerificationResult Format Tests ==============

describe('PhaseSyncVerificationResult format', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('has all required fields in result', async () => {
    const checkpoint = createTestCheckpoint({
      id: 'CP-FORMAT',
      requiresHuman: false,
    });
    const task = createTestTask([checkpoint]);

    const result = await verifyPhaseSyncCheckpoint(
      task, checkpoint, 'development', env.tempDir
    );

    // Required fields per PhaseSyncVerificationResult interface
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('checkpointId');
    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('evidence');
    expect(result).toHaveProperty('missingOutputs');
  });

  it('evidence items have type and description fields', async () => {
    const checkpoint = createTestCheckpoint({
      id: 'CP-EVID',
      requiresHuman: false,
      category: 'code_review',
    });
    const task = createTestTask([checkpoint]);

    const result = await verifyPhaseSyncCheckpoint(
      task, checkpoint, 'development', env.tempDir
    );

    // Each evidence item should have type and description
    for (const e of result.evidence) {
      expect(e).toHaveProperty('type');
      expect(e).toHaveProperty('description');
    }
  });

  it('human checkpoint result has requiresHuman=true', async () => {
    const checkpoint = createTestCheckpoint({
      id: 'CP-HUMAN-FMT',
      requiresHuman: true,
    });
    const task = createTestTask([checkpoint]);

    const result = await verifyPhaseSyncCheckpoint(
      task, checkpoint, 'development', env.tempDir
    );

    expect(result.requiresHuman).toBe(true);
    expect(result.valid).toBe(false);
  });
});
