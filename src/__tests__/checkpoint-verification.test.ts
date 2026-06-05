/**
 * checkpoint-verification.test.ts - 检查点产出验证模块测试
 *
 * 测试覆盖：
 * - inferCategoryFromDescription: 从描述推断类别
 * - inferCategoryFromCheckpoint: 从检查点元数据推断类别
 * - CheckpointOutputVerifier.verify: 核心验证方法
 * - detectFalseSuccess: 假成功检测
 * - verifyAndRecordCheckpoint: 验证并记录
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  inferCategoryFromDescription,
  inferCategoryFromCheckpoint,
  CheckpointOutputVerifier,
  detectFalseSuccess,
  verifyAndRecordCheckpoint,
  CATEGORY_STRATEGIES,
} from '../utils/checkpoint-verification';
import type {
  CheckpointOutputCategory,
  VerificationContext,
  VerificationOutput,
} from '../types/checkpoint-verification';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== inferCategoryFromDescription ==============

describe('inferCategoryFromDescription', () => {
  it('detects testing category from test keywords', () => {
    expect(inferCategoryFromDescription('编写单元测试')).toBe('testing');
    expect(inferCategoryFromDescription('run unit test')).toBe('testing');
    expect(inferCategoryFromDescription('集成测试')).toBe('testing');
    expect(inferCategoryFromDescription('e2e test')).toBe('testing');
  });

  it('detects documentation category from doc keywords', () => {
    expect(inferCategoryFromDescription('update README')).toBe('documentation');
    expect(inferCategoryFromDescription('编写文档')).toBe('documentation');
    expect(inferCategoryFromDescription('add comments')).toBe('documentation');
  });

  it('detects review category from review keywords', () => {
    expect(inferCategoryFromDescription('[ai review] code review')).toBe('review');
    expect(inferCategoryFromDescription('审核代码')).toBe('review');
    expect(inferCategoryFromDescription('code review')).toBe('review');
  });

  it('detects deployment category from deploy keywords', () => {
    expect(inferCategoryFromDescription('deploy to production')).toBe('deployment');
    expect(inferCategoryFromDescription('构建项目')).toBe('deployment');
    expect(inferCategoryFromDescription('release v1.0')).toBe('deployment');
  });

  it('detects configuration category from config keywords', () => {
    expect(inferCategoryFromDescription('update config')).toBe('configuration');
    expect(inferCategoryFromDescription('配置环境变量')).toBe('configuration');
    expect(inferCategoryFromDescription('修改 settings')).toBe('configuration');
  });

  it('defaults to implementation for generic descriptions', () => {
    expect(inferCategoryFromDescription('实现功能')).toBe('implementation');
    expect(inferCategoryFromDescription('fix bug')).toBe('implementation');
    expect(inferCategoryFromDescription('add feature')).toBe('implementation');
  });
});

// ============== inferCategoryFromCheckpoint ==============

describe('inferCategoryFromCheckpoint', () => {
  it('uses category field when available', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-001',
      description: 'test checkpoint',
      status: 'pending',
      category: 'code_review',
    };
    expect(inferCategoryFromCheckpoint(checkpoint)).toBe('review');
  });

  it('uses qa_verification category', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-002',
      description: 'qa checkpoint',
      status: 'pending',
      category: 'qa_verification',
    };
    expect(inferCategoryFromCheckpoint(checkpoint)).toBe('testing');
  });

  it('infers from verification method', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-003',
      description: 'test checkpoint',
      status: 'pending',
      verification: { method: 'unit_test' },
    };
    expect(inferCategoryFromCheckpoint(checkpoint)).toBe('testing');
  });

  it('infers from review method', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-004',
      description: 'review checkpoint',
      status: 'pending',
      verification: { method: 'code_review' },
    };
    expect(inferCategoryFromCheckpoint(checkpoint)).toBe('review');
  });

  it('falls back to description inference', () => {
    const checkpoint: CheckpointMetadata = {
      id: 'CP-005',
      description: '编写测试',
      status: 'pending',
    };
    expect(inferCategoryFromCheckpoint(checkpoint)).toBe('testing');
  });
});

// ============== CATEGORY_STRATEGIES ==============

describe('CATEGORY_STRATEGIES', () => {
  it('has strategies for all categories', () => {
    const categories: CheckpointOutputCategory[] = [
      'implementation', 'testing', 'documentation',
      'review', 'deployment', 'configuration', 'custom',
    ];

    for (const category of categories) {
      expect(CATEGORY_STRATEGIES[category]).toBeDefined();
      expect(CATEGORY_STRATEGIES[category].category).toBe(category);
    }
  });

  it('review and custom require human confirmation', () => {
    expect(CATEGORY_STRATEGIES['review'].requiresHumanConfirmation).toBe(true);
    expect(CATEGORY_STRATEGIES['custom'].requiresHumanConfirmation).toBe(true);
  });

  it('implementation does not require human confirmation', () => {
    expect(CATEGORY_STRATEGIES['implementation'].requiresHumanConfirmation).toBe(false);
  });
});

// ============== CheckpointOutputVerifier ==============

describe('CheckpointOutputVerifier', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('verify', () => {
    it('returns skipped for review category with non-cli source', async () => {
      const context: VerificationContext = {
        taskId: 'TASK-001',
        checkpointId: 'CP-001',
        checkpointDescription: '[ai review] review code',
        category: 'review',
        cwd: env.tempDir,
        source: 'phase_sync',
      };

      const output = await verifier.verify(context);

      expect(output.result).toBe('skipped');
      expect(output.record.failureReason).toContain('人工确认');
    });

    it('returns skipped for custom category', async () => {
      const context: VerificationContext = {
        taskId: 'TASK-001',
        checkpointId: 'CP-001',
        checkpointDescription: 'custom checkpoint',
        category: 'custom',
        cwd: env.tempDir,
        source: 'check_completed',
      };

      const output = await verifier.verify(context);

      expect(output.result).toBe('skipped');
    });

    it('verifies implementation checkpoint with evidence', async () => {
      // 创建证据目录
      const evidenceDir = path.join(env.projectDir, 'evidence', 'TASK-001');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'test.txt'), 'evidence');

      const context: VerificationContext = {
        taskId: 'TASK-001',
        checkpointId: 'CP-001',
        checkpointDescription: '实现功能',
        category: 'implementation',
        cwd: env.tempDir,
        source: 'cli_manual',
      };

      const output = await verifier.verify(context);

      expect(output.result).toBe('verified');
      expect(output.record.evidence).toBeDefined();
      expect(output.record.evidence?.length).toBeGreaterThan(0);
    });

    it('returns unverified for implementation checkpoint without evidence', async () => {
      const context: VerificationContext = {
        taskId: 'TASK-002',
        checkpointId: 'CP-001',
        checkpointDescription: '实现功能',
        category: 'implementation',
        cwd: env.tempDir,
        source: 'cli_manual',
      };

      const output = await verifier.verify(context);

      expect(output.result).toBe('unverified');
      expect(output.warnings).toBeDefined();
      expect(output.warnings?.length).toBeGreaterThan(0);
    });
  });
});

// ============== detectFalseSuccess ==============

describe('detectFalseSuccess', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('returns empty for task without checkpoints', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'resolved',
      type: 'feature',
      priority: 'P1',
      checkpoints: [],
    };

    const result = await detectFalseSuccess(task, env.tempDir);

    expect(result.falseSuccessCheckpoints).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.details).toHaveLength(0);
  });

  it('detects false success for completed checkpoint without evidence', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'resolved',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        {
          id: 'CP-001',
          description: '实现功能',
          status: 'completed',
        },
      ],
    };

    const result = await detectFalseSuccess(task, env.tempDir);

    expect(result.falseSuccessCheckpoints).toContain('CP-001');
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details[0].checkpointId).toBe('CP-001');
  });

  it('does not detect false success for pending checkpoint', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'in_progress',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        {
          id: 'CP-001',
          description: '实现功能',
          status: 'pending',
        },
      ],
    };

    const result = await detectFalseSuccess(task, env.tempDir);

    expect(result.falseSuccessCheckpoints).toHaveLength(0);
  });

  it('skips review checkpoints (requires human)', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'resolved',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        {
          id: 'CP-001',
          description: '[ai review] review code',
          status: 'completed',
          category: 'code_review',
        },
      ],
    };

    const result = await detectFalseSuccess(task, env.tempDir);

    // Review checkpoints are skipped because they require human confirmation
    expect(result.falseSuccessCheckpoints).toHaveLength(0);
  });
});

// ============== verifyAndRecordCheckpoint ==============

describe('verifyAndRecordCheckpoint', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('returns failed for non-existent checkpoint', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'in_progress',
      type: 'feature',
      priority: 'P1',
      checkpoints: [],
    };

    const output = await verifyAndRecordCheckpoint(task, 'CP-NONEXIST', 'cli_manual', env.tempDir);

    expect(output.result).toBe('failed');
    expect(output.record.failureReason).toContain('不存在');
  });

  it('verifies existing checkpoint', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'in_progress',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        {
          id: 'CP-001',
          description: '实现功能',
          status: 'pending',
        },
      ],
    };

    const output = await verifyAndRecordCheckpoint(task, 'CP-001', 'cli_manual', env.tempDir);

    expect(output.result).toBeDefined();
    expect(output.record.source).toBe('cli_manual');
  });
});