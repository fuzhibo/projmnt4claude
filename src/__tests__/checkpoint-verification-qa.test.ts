/**
 * checkpoint-verification-qa.test.ts - QA 补充测试
 *
 * 测试覆盖：
 * - testing/documentation/deployment/configuration 类别验证
 * - 边界条件：空任务、无检查点、所有检查点已完成
 * - 四个入口点集成验证
 * - phaseData 参数传递验证
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
  VerificationSource,
} from '../types/checkpoint-verification';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== 边界条件测试 ==============

describe('Boundary Conditions', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('Empty task', () => {
    it('handles task with undefined checkpoints', async () => {
      const task: TaskMeta = {
        id: 'TASK-001',
        title: 'Test Task',
        status: 'in_progress',
        type: 'feature',
        priority: 'P1',
        // checkpoints undefined
      };

      const result = await detectFalseSuccess(task, env.tempDir);

      expect(result.falseSuccessCheckpoints).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles task with null checkpoints', async () => {
      const task: TaskMeta = {
        id: 'TASK-001',
        title: 'Test Task',
        status: 'in_progress',
        type: 'feature',
        priority: 'P1',
        checkpoints: null as unknown as CheckpointMetadata[],
      };

      const result = await detectFalseSuccess(task, env.tempDir);

      expect(result.falseSuccessCheckpoints).toHaveLength(0);
    });
  });

  describe('All checkpoints completed', () => {
    it('checks all completed checkpoints', async () => {
      const task: TaskMeta = {
        id: 'TASK-001',
        title: 'Test Task',
        status: 'resolved',
        type: 'feature',
        priority: 'P1',
        checkpoints: [
          { id: 'CP-001', description: '实现功能', status: 'completed' },
          { id: 'CP-002', description: '编写测试', status: 'completed' },
          { id: 'CP-003', description: '更新文档', status: 'completed' },
        ],
      };

      const result = await detectFalseSuccess(task, env.tempDir);

      // All completed checkpoints should be checked
      expect(result.details.length).toBe(3);
    });
  });
});

// ============== Testing Category Tests ==============

describe('Testing Category Verification', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  it('verifies testing checkpoint with QA report', async () => {
    // Create QA report
    const reportDir = path.join(env.projectDir, 'reports', 'harness', 'TASK-001');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'qa-report.md'), '# QA Report');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '编写单元测试',
      category: 'testing',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
    expect(output.record.evidence).toBeDefined();
    expect(output.record.evidence?.some(e => e.includes('QA'))).toBe(true);
  });

  it('returns unverified for testing checkpoint without evidence', async () => {
    const context: VerificationContext = {
      taskId: 'TASK-002',
      checkpointId: 'CP-001',
      checkpointDescription: '编写单元测试',
      category: 'testing',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('unverified');
    expect(output.warnings).toBeDefined();
  });
});

// ============== Documentation Category Tests ==============

describe('Documentation Category Verification', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  it('verifies documentation checkpoint with README', async () => {
    fs.writeFileSync(path.join(env.tempDir, 'README.md'), '# README');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '更新文档',
      category: 'documentation',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
  });

  it('verifies documentation checkpoint with docs directory', async () => {
    const docsDir = path.join(env.tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '编写文档',
      category: 'documentation',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
  });

  it('returns unverified for documentation checkpoint without files', async () => {
    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '更新文档',
      category: 'documentation',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('unverified');
  });
});

// ============== Deployment Category Tests ==============

describe('Deployment Category Verification', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  it('verifies deployment checkpoint with dist directory', async () => {
    const distDir = path.join(env.tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.js'), 'module.exports = {}');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '构建项目',
      category: 'deployment',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
    expect(output.record.evidence?.some(e => e.includes('构建产物'))).toBe(true);
  });

  it('returns unverified for deployment checkpoint without dist', async () => {
    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '部署项目',
      category: 'deployment',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('unverified');
  });
});

// ============== Configuration Category Tests ==============

describe('Configuration Category Verification', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  it('verifies configuration checkpoint with .env file', async () => {
    fs.writeFileSync(path.join(env.tempDir, '.env'), 'DEBUG=true');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '配置环境变量',
      category: 'configuration',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
  });

  it('verifies configuration checkpoint with config.json', async () => {
    fs.writeFileSync(path.join(env.tempDir, 'config.json'), '{}');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '更新配置',
      category: 'configuration',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
  });

  it('returns unverified for configuration checkpoint without files', async () => {
    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '配置环境',
      category: 'configuration',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('unverified');
  });
});

// ============== Review Category Tests ==============

describe('Review Category Verification', () => {
  let env: IsolatedTestEnv;
  let verifier: CheckpointOutputVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    verifier = new CheckpointOutputVerifier(env.tempDir);
  });

  afterEach(() => {
    env.cleanup();
  });

  it('skips review checkpoint for non-cli_manual source', async () => {
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

  it('verifies review checkpoint with cr-report for cli_manual', async () => {
    const reportDir = path.join(env.projectDir, 'reports', 'harness', 'TASK-001');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'cr-report.md'), '# CR Report');

    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '[ai review] review code',
      category: 'review',
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
  });

  it('verifies review checkpoint with phaseData.codeReviewVerdict', async () => {
    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: '[ai review] review code',
      category: 'review',
      cwd: env.tempDir,
      source: 'cli_manual',
      phaseData: {
        codeReviewVerdict: { approved: true },
      },
    };

    const output = await verifier.verify(context);

    expect(output.result).toBe('verified');
    expect(output.record.evidence?.some(e => e.includes('审核结论'))).toBe(true);
  });
});

// ============== Four Entry Points Integration Tests ==============

describe('Four Entry Points Integration', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  const sources: VerificationSource[] = ['cli_manual', 'phase_sync', 'check_completed', 'analyze_fix'];

  for (const source of sources) {
    it(`verifyAndRecordCheckpoint works with source: ${source}`, async () => {
      const task: TaskMeta = {
        id: 'TASK-001',
        title: 'Test Task',
        status: 'in_progress',
        type: 'feature',
        priority: 'P1',
        checkpoints: [
          { id: 'CP-001', description: '实现功能', status: 'pending' },
        ],
      };

      const output = await verifyAndRecordCheckpoint(task, 'CP-001', source, env.tempDir);

      expect(output.result).toBeDefined();
      expect(output.record.source).toBe(source);
    });
  }

  it('cli_manual source verifies review checkpoints', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'in_progress',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        { id: 'CP-001', description: '[ai review] review code', status: 'completed', category: 'code_review' },
      ],
    };

    // Create cr-report
    const reportDir = path.join(env.projectDir, 'reports', 'harness', 'TASK-001');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'cr-report.md'), '# CR Report');

    const output = await verifyAndRecordCheckpoint(task, 'CP-001', 'cli_manual', env.tempDir);

    expect(output.result).toBe('verified');
  });

  it('phase_sync source passes phaseData correctly', async () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test Task',
      status: 'in_progress',
      type: 'feature',
      priority: 'P1',
      checkpoints: [
        { id: 'CP-001', description: '[ai review] review code', status: 'completed', category: 'code_review' },
      ],
    };

    const output = await verifyAndRecordCheckpoint(task, 'CP-001', 'phase_sync', env.tempDir, {
      phase: 'code_review',
      codeReviewVerdict: { approved: true },
    });

    // phase_sync source should skip review checkpoints (requires human)
    expect(output.result).toBe('skipped');
  });
});

// ============== Error Handling Tests ==============

describe('Error Handling', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('handles non-existent checkpoint gracefully', async () => {
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

  it('returns unverified for unknown category (graceful handling of missing strategy)', async () => {
    const verifier = new CheckpointOutputVerifier(env.tempDir);
    const context: VerificationContext = {
      taskId: 'TASK-001',
      checkpointId: 'CP-001',
      checkpointDescription: 'unknown checkpoint',
      category: 'unknown' as CheckpointOutputCategory,
      cwd: env.tempDir,
      source: 'cli_manual',
    };

    const output = await verifier.verify(context);
    expect(output.result).toBe('unverified');
    expect(output.record.failureReason).toContain('未知的检查点类别');
  });
});

// ============== CATEGORY_STRATEGIES Completeness Tests ==============

describe('CATEGORY_STRATEGIES Completeness', () => {
  it('all categories have autoVerifyFunction except custom', () => {
    const categoriesWithAutoVerify: CheckpointOutputCategory[] = [
      'implementation', 'testing', 'documentation', 'review', 'deployment', 'configuration',
    ];

    for (const category of categoriesWithAutoVerify) {
      expect(CATEGORY_STRATEGIES[category].autoVerifyFunction).toBeDefined();
    }

    // custom category does not require autoVerifyFunction
    expect(CATEGORY_STRATEGIES['custom'].autoVerifyFunction).toBeUndefined();
  });

  it('all strategies have description', () => {
    const categories: CheckpointOutputCategory[] = [
      'implementation', 'testing', 'documentation', 'review', 'deployment', 'configuration', 'custom',
    ];

    for (const category of categories) {
      expect(CATEGORY_STRATEGIES[category].description).toBeTruthy();
      expect(CATEGORY_STRATEGIES[category].description.length).toBeGreaterThan(0);
    }
  });

  it('all strategies have evidenceTypes', () => {
    const categories: CheckpointOutputCategory[] = [
      'implementation', 'testing', 'documentation', 'review', 'deployment', 'configuration', 'custom',
    ];

    for (const category of categories) {
      expect(CATEGORY_STRATEGIES[category].evidenceTypes).toBeDefined();
      expect(CATEGORY_STRATEGIES[category].evidenceTypes.length).toBeGreaterThan(0);
    }
  });
});
