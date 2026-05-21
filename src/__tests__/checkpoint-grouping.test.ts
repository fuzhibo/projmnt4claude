/**
 * Checkpoint Grouping and Constraints Section 单元测试
 *
 * 测试 harness-executor.ts 中的两个函数:
 * - groupCheckpointsByPhase: 按阶段分组检查点
 * - buildCheckpointConstraintsSection: 构建检查点约束章节
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HarnessExecutor } from '../utils/harness-executor.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import type { HarnessConfig, SprintContract } from '../types/harness.js';
import { getI18n } from '../i18n/index.js';

// ============================================================
// Helpers
// ============================================================

function createCheckpoint(overrides: Partial<CheckpointMetadata> = {}): CheckpointMetadata {
  return {
    id: overrides.id || 'CP-001',
    description: overrides.description || 'Test checkpoint',
    status: 'pending',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Access private method via type assertion for testing
 */
function getGroupCheckpointsByPhase(executor: HarnessExecutor) {
  return (executor as unknown as {
    groupCheckpointsByPhase: (checkpoints: TaskMeta['checkpoints']) => {
      codeReview: CheckpointMetadata[];
      qa: CheckpointMetadata[];
      evaluation: CheckpointMetadata[];
      general: CheckpointMetadata[];
    };
  }).groupCheckpointsByPhase.bind(executor);
}

function getBuildCheckpointConstraintsSection(executor: HarnessExecutor) {
  return (executor as unknown as {
    buildCheckpointConstraintsSection: (
      checkpoints: TaskMeta['checkpoints'],
      texts: ReturnType<typeof getI18n>
    ) => string;
  }).buildCheckpointConstraintsSection.bind(executor);
}

// ============================================================
// Tests
// ============================================================

describe('groupCheckpointsByPhase', () => {
  let executor: HarnessExecutor;
  let groupCheckpointsByPhase: ReturnType<typeof getGroupCheckpointsByPhase>;

  beforeEach(() => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: '/tmp/test',
      forceContinue: false,
    };
    executor = new HarnessExecutor(config);
    groupCheckpointsByPhase = getGroupCheckpointsByPhase(executor);
  });

  // --- Normal cases ---

  test('should return empty groups for empty checkpoints', () => {
    const result = groupCheckpointsByPhase([]);

    expect(result.codeReview).toHaveLength(0);
    expect(result.qa).toHaveLength(0);
    expect(result.evaluation).toHaveLength(0);
    expect(result.general).toHaveLength(0);
  });

  test('should return empty groups for null/undefined checkpoints', () => {
    const result = groupCheckpointsByPhase(null as unknown as []);

    expect(result.codeReview).toHaveLength(0);
    expect(result.qa).toHaveLength(0);
    expect(result.evaluation).toHaveLength(0);
    expect(result.general).toHaveLength(0);
  });

  test('should group checkpoints by [ai review] prefix', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[ai review] Code review checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: '[ai review] Another review checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(2);
    expect(result.codeReview[0].id).toBe('CP-001');
    expect(result.codeReview[1].id).toBe('CP-002');
    expect(result.qa).toHaveLength(0);
    expect(result.evaluation).toHaveLength(0);
    expect(result.general).toHaveLength(0);
  });

  test('should group checkpoints by [ai qa] prefix', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[ai qa] QA verification checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: '[ai qa] Another QA checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.qa).toHaveLength(2);
    expect(result.qa[0].id).toBe('CP-001');
    expect(result.qa[1].id).toBe('CP-002');
    expect(result.codeReview).toHaveLength(0);
    expect(result.evaluation).toHaveLength(0);
    expect(result.general).toHaveLength(0);
  });

  test('should group checkpoints by [script] prefix', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[script] Automated verification checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: '[script] Another script checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.evaluation).toHaveLength(2);
    expect(result.evaluation[0].id).toBe('CP-001');
    expect(result.evaluation[1].id).toBe('CP-002');
    expect(result.codeReview).toHaveLength(0);
    expect(result.qa).toHaveLength(0);
    expect(result.general).toHaveLength(0);
  });

  test('should group checkpoints without prefix as general', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'General checkpoint without prefix' }),
      createCheckpoint({ id: 'CP-002', description: 'Another general checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.general).toHaveLength(2);
    expect(result.general[0].id).toBe('CP-001');
    expect(result.general[1].id).toBe('CP-002');
    expect(result.codeReview).toHaveLength(0);
    expect(result.qa).toHaveLength(0);
    expect(result.evaluation).toHaveLength(0);
  });

  test('should group checkpoints by category field', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'Checkpoint', category: 'code_review' }),
      createCheckpoint({ id: 'CP-002', description: 'Checkpoint', category: 'qa_verification' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(1);
    expect(result.codeReview[0].id).toBe('CP-001');
    expect(result.qa).toHaveLength(1);
    expect(result.qa[0].id).toBe('CP-002');
  });

  test('should handle mixed checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[ai review] Review checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: '[ai qa] QA checkpoint' }),
      createCheckpoint({ id: 'CP-003', description: '[script] Script checkpoint' }),
      createCheckpoint({ id: 'CP-004', description: 'General checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(1);
    expect(result.qa).toHaveLength(1);
    expect(result.evaluation).toHaveLength(1);
    expect(result.general).toHaveLength(1);
  });

  // --- Edge cases ---

  test('should handle case-insensitive prefix matching', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[AI REVIEW] Uppercase prefix' }),
      createCheckpoint({ id: 'CP-002', description: '[AI QA] Uppercase QA' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(1);
    expect(result.qa).toHaveLength(1);
  });

  test('should detect Chinese keywords', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '代码审查检查点' }),
      createCheckpoint({ id: 'CP-002', description: 'QA验证检查点' }),
      createCheckpoint({ id: 'CP-003', description: '脚本自动化检查点' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(1);
    expect(result.qa).toHaveLength(1);
    expect(result.evaluation).toHaveLength(1);
  });

  test('should detect English keywords', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'Code review checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: 'QA verification checkpoint' }),
    ];

    const result = groupCheckpointsByPhase(checkpoints);

    expect(result.codeReview).toHaveLength(1);
    expect(result.qa).toHaveLength(0); // 'QA verification' doesn't match 'qa验证' or '测试验证'
    expect(result.general).toHaveLength(1); // Falls into general
  });
});

describe('buildCheckpointConstraintsSection', () => {
  let executor: HarnessExecutor;
  let buildCheckpointConstraintsSection: ReturnType<typeof getBuildCheckpointConstraintsSection>;
  const texts = getI18n('zh');

  beforeEach(() => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: '/tmp/test',
      forceContinue: false,
    };
    executor = new HarnessExecutor(config);
    buildCheckpointConstraintsSection = getBuildCheckpointConstraintsSection(executor);
  });

  // --- Normal cases ---

  test('should return empty string for empty checkpoints', () => {
    const result = buildCheckpointConstraintsSection([], texts);

    expect(result).toBe('');
  });

  test('should return empty string for null/undefined checkpoints', () => {
    const result = buildCheckpointConstraintsSection(null as unknown as [], texts);

    expect(result).toBe('');
  });

  test('should build section with checkpoints title', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'Test checkpoint' }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('## 检查点');
    expect(result).toContain('请完成以下检查点');
  });

  test('should include checkpoint ID and description', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'Implement feature X' }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('[CP-001]');
    expect(result).toContain('Implement feature X');
  });

  test('should include verification commands when present', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({
        id: 'CP-001',
        description: 'Test checkpoint',
        verification: {
          method: 'automated',
          commands: ['bun test', 'bun run build'],
          expected: 'All tests pass',
        },
      }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('验证命令');
    expect(result).toContain('bun test && bun run build');
  });

  test('should include expected result when present', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({
        id: 'CP-001',
        description: 'Test checkpoint',
        verification: {
          method: 'automated',
          expected: 'All tests pass',
        },
      }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('预期结果');
    expect(result).toContain('All tests pass');
  });

  test('should group checkpoints by category', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'General checkpoint' }),
      createCheckpoint({ id: 'CP-002', description: '[ai review] Review checkpoint' }),
      createCheckpoint({ id: 'CP-003', description: '[ai qa] QA checkpoint' }),
      createCheckpoint({ id: 'CP-004', description: '[script] Script checkpoint' }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('开发检查点');
    expect(result).toContain('代码审查检查点');
    expect(result).toContain('QA 验证检查点');
    expect(result).toContain('自动化验证检查点');
  });

  // --- Edge cases ---

  test('should handle checkpoints without verification', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: 'Manual checkpoint' }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('[CP-001]');
    expect(result).toContain('Manual checkpoint');
    expect(result).not.toContain('验证命令');
  });

  test('should handle multiple checkpoints in same category', () => {
    const checkpoints: CheckpointMetadata[] = [
      createCheckpoint({ id: 'CP-001', description: '[ai review] Review 1' }),
      createCheckpoint({ id: 'CP-002', description: '[ai review] Review 2' }),
      createCheckpoint({ id: 'CP-003', description: '[ai review] Review 3' }),
    ];

    const result = buildCheckpointConstraintsSection(checkpoints, texts);

    expect(result).toContain('[CP-001]');
    expect(result).toContain('[CP-002]');
    expect(result).toContain('[CP-003]');
  });
});
