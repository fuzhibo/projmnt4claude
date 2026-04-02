import { describe, test, expect } from 'bun:test';
import {
  getPendingMigrations,
  applySchemaMigrations,
  SCHEMA_MIGRATIONS,
} from '../commands/analyze';
import {
  CURRENT_TASK_SCHEMA_VERSION,
  PIPELINE_INTERMEDIATE_STATUSES,
  PIPELINE_STATUS_MIGRATION_MAP,
} from '../types/task';
import { VALID_VERDICT_ACTIONS } from '../types/harness';
import type { TaskMeta, TaskStatus } from '../types/task';

// Helper to create a minimal valid TaskMeta for testing
function createTestTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-feature-P2-test-task-20260402',
    title: 'Test task',
    description: 'Test description',
    type: 'feature',
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

// ============== Schema Version Constants ==============

describe('Schema Version Constants', () => {
  test('CURRENT_TASK_SCHEMA_VERSION should be 2', () => {
    expect(CURRENT_TASK_SCHEMA_VERSION).toBe(2);
  });

  test('SCHEMA_MIGRATIONS should have 2 steps', () => {
    expect(SCHEMA_MIGRATIONS).toHaveLength(2);
  });

  test('SCHEMA_MIGRATIONS versions should be sequential starting from 1', () => {
    expect(SCHEMA_MIGRATIONS[0]!.version).toBe(1);
    expect(SCHEMA_MIGRATIONS[1]!.version).toBe(2);
  });

  test('SCHEMA_MIGRATIONS should have required fields', () => {
    for (const migration of SCHEMA_MIGRATIONS) {
      expect(migration.version).toBeGreaterThan(0);
      expect(migration.name).toBeTruthy();
      expect(migration.description).toBeTruthy();
      expect(typeof migration.migrate).toBe('function');
    }
  });
});

// ============== Pipeline Status Constants ==============

describe('Pipeline Status Constants', () => {
  test('PIPELINE_INTERMEDIATE_STATUSES should contain expected values', () => {
    expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('wait_review');
    expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('wait_qa');
    expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('wait_complete');
    expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('needs_human');
    expect(PIPELINE_INTERMEDIATE_STATUSES).toHaveLength(4);
  });

  test('PIPELINE_STATUS_MIGRATION_MAP should map all intermediate statuses', () => {
    for (const status of PIPELINE_INTERMEDIATE_STATUSES) {
      expect(PIPELINE_STATUS_MIGRATION_MAP).toHaveProperty(status);
    }
  });

  test('PIPELINE_STATUS_MIGRATION_MAP should map to valid target statuses', () => {
    const validTargets = ['open', 'in_progress', 'resolved', 'closed', 'reopened', 'abandoned'];
    for (const [, target] of Object.entries(PIPELINE_STATUS_MIGRATION_MAP)) {
      expect(validTargets).toContain(target);
    }
  });

  test('needs_human should map to open', () => {
    expect(PIPELINE_STATUS_MIGRATION_MAP['needs_human']).toBe('open');
  });

  test('wait_review should map to in_progress', () => {
    expect(PIPELINE_STATUS_MIGRATION_MAP['wait_review']).toBe('in_progress');
  });

  test('wait_qa should map to in_progress', () => {
    expect(PIPELINE_STATUS_MIGRATION_MAP['wait_qa']).toBe('in_progress');
  });

  test('wait_complete should map to resolved', () => {
    expect(PIPELINE_STATUS_MIGRATION_MAP['wait_complete']).toBe('resolved');
  });
});

// ============== VerdictAction Constants ==============

describe('VerdictAction Constants', () => {
  test('VALID_VERDICT_ACTIONS should contain all valid actions', () => {
    expect(VALID_VERDICT_ACTIONS).toContain('resolve');
    expect(VALID_VERDICT_ACTIONS).toContain('redevelop');
    expect(VALID_VERDICT_ACTIONS).toContain('retest');
    expect(VALID_VERDICT_ACTIONS).toContain('reevaluate');
    expect(VALID_VERDICT_ACTIONS).toContain('escalate_human');
    expect(VALID_VERDICT_ACTIONS).toHaveLength(5);
  });

  test('VALID_VERDICT_ACTIONS should not contain invalid actions', () => {
    expect(VALID_VERDICT_ACTIONS).not.toContain('unknown');
    expect(VALID_VERDICT_ACTIONS).not.toContain('retry');
    expect(VALID_VERDICT_ACTIONS).not.toContain('approve');
    expect(VALID_VERDICT_ACTIONS).not.toContain('');
  });
});

// ============== getPendingMigrations ==============

describe('getPendingMigrations', () => {
  test('from version 0 should return all migrations', () => {
    const pending = getPendingMigrations(0);
    expect(pending).toHaveLength(2);
    expect(pending[0]!.version).toBe(1);
    expect(pending[1]!.version).toBe(2);
  });

  test('from version 1 should return only v2 migration', () => {
    const pending = getPendingMigrations(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.version).toBe(2);
    expect(pending[0]!.name).toBe('pipeline_status_and_verdict_action');
  });

  test('from current version should return no migrations', () => {
    const pending = getPendingMigrations(CURRENT_TASK_SCHEMA_VERSION);
    expect(pending).toHaveLength(0);
  });

  test('from future version should return no migrations', () => {
    const pending = getPendingMigrations(99);
    expect(pending).toHaveLength(0);
  });
});

// ============== applySchemaMigrations ==============

describe('applySchemaMigrations', () => {
  // --- Version 0 → Latest (full migration) ---

  test('should migrate v0 task with no fields to latest version', () => {
    const task = createTestTask({
      // Explicitly remove fields that v0 wouldn't have
      reopenCount: undefined as unknown as number,
      requirementHistory: undefined as unknown as [],
      schemaVersion: undefined as unknown as number,
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(true);
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
    expect(task.reopenCount).toBe(0);
    expect(task.requirementHistory).toEqual([]);
  });

  test('should set schemaVersion even when no data changes needed', () => {
    const task = createTestTask({
      reopenCount: 0,
      requirementHistory: [],
      status: 'open',  // not a pipeline intermediate status
      schemaVersion: 0,
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(true); // changed because version bumped
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
  });

  // --- Version 0 → v1 (legacy schema fields) ---

  test('v1 migration should add reopenCount when missing', () => {
    const task = createTestTask({
      reopenCount: undefined as unknown as number,
      requirementHistory: [],
      schemaVersion: 0,
    });

    applySchemaMigrations(task);
    expect(task.reopenCount).toBe(0);
  });

  test('v1 migration should add requirementHistory when missing', () => {
    const task = createTestTask({
      reopenCount: 0,
      requirementHistory: undefined as unknown as [],
      schemaVersion: 0,
    });

    applySchemaMigrations(task);
    expect(task.requirementHistory).toEqual([]);
  });

  test('v1 migration should not overwrite existing reopenCount', () => {
    const task = createTestTask({
      reopenCount: 3,
      requirementHistory: [],
      schemaVersion: 0,
    });

    applySchemaMigrations(task);
    expect(task.reopenCount).toBe(3);
  });

  test('v1 migration should not overwrite existing requirementHistory', () => {
    const existingHistory = [{
      timestamp: '2026-01-01T00:00:00.000Z',
      version: 1,
      newDescription: 'Updated desc',
      changeReason: 'test',
    }];
    const task = createTestTask({
      reopenCount: 0,
      requirementHistory: existingHistory,
      schemaVersion: 0,
    });

    applySchemaMigrations(task);
    expect(task.requirementHistory).toEqual(existingHistory);
  });

  // --- Version 1 → v2 (pipeline status + verdict action) ---

  test('v2 migration should migrate wait_review to in_progress', () => {
    const task = createTestTask({
      status: 'wait_review',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);

    expect(task.status).toBe('in_progress');
    expect(result.details).toContain('status: wait_review → in_progress');
  });

  test('v2 migration should migrate wait_qa to in_progress', () => {
    const task = createTestTask({
      status: 'wait_qa',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);

    expect(task.status).toBe('in_progress');
    expect(result.details).toContain('status: wait_qa → in_progress');
  });

  test('v2 migration should migrate wait_complete to resolved', () => {
    const task = createTestTask({
      status: 'wait_complete',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);

    expect(task.status).toBe('resolved');
    expect(result.details).toContain('status: wait_complete → resolved');
  });

  test('v2 migration should migrate needs_human to open', () => {
    const task = createTestTask({
      status: 'needs_human',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);

    expect(task.status).toBe('open');
    expect(result.details).toContain('status: needs_human → open');
  });

  test('v2 migration should not change non-pipeline status', () => {
    const task = createTestTask({
      status: 'in_progress',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);

    expect(task.status).toBe('in_progress');
    expect(result.details).not.toContainEqual(expect.stringContaining('status:'));
  });

  // --- VerdictAction cleanup ---

  test('v2 migration should clean invalid VerdictAction from history', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'verdict',
          field: 'status',
          oldValue: 'in_progress',
          newValue: 'invalid_action',
          reason: 'test',
          user: 'test',
        },
      ],
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(true);
    expect(task.history[0]!.newValue).toContain('migrated: invalid_verdict_action');
    expect(task.history[0]!.newValue).toContain('invalid_action');
  });

  test('v2 migration should not modify valid VerdictAction in history', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'verdict',
          field: 'status',
          oldValue: 'in_progress',
          newValue: 'redevelop',
          reason: 'test',
          user: 'test',
        },
      ],
    });

    applySchemaMigrations(task);

    expect(task.history[0]!.newValue).toBe('redevelop');
  });

  test('v2 migration should clean invalid verdictAction from verification', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [],
      verification: {
        result: 'passed',
        method: 'automated',
        verifiedAt: '2026-04-02T00:00:00.000Z',
        verifiedBy: 'test',
        checkpoints: [],
        verdictAction: 'bad_action',
      } as any,
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(true);
    expect((task.verification as any).verdictAction).toBeUndefined();
  });

  test('v2 migration should preserve valid verdictAction in verification', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [],
      verification: {
        result: 'passed',
        method: 'automated',
        verifiedAt: '2026-04-02T00:00:00.000Z',
        verifiedBy: 'test',
        checkpoints: [],
        verdictAction: 'redevelop',
      } as any,
    });

    applySchemaMigrations(task);

    expect((task.verification as any).verdictAction).toBe('redevelop');
  });

  test('v2 migration should handle multiple invalid VerdictActions in history', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'verdict',
          field: 'status',
          oldValue: 'a',
          newValue: 'bad1',
          reason: 'test',
          user: 'test',
        },
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'status_change',
          field: 'status',
          oldValue: 'a',
          newValue: 'b',
          reason: 'test',
          user: 'test',
        },
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'verdict',
          field: 'status',
          oldValue: 'c',
          newValue: 'bad2',
          reason: 'test',
          user: 'test',
        },
      ],
    });

    const result = applySchemaMigrations(task);

    expect(task.history[0]!.newValue).toContain('bad1');
    expect(task.history[1]!.newValue).toBe('b'); // non-verdict entry unchanged
    expect(task.history[2]!.newValue).toContain('bad2');
  });

  // --- Already at current version ---

  test('should return unchanged for task at current version', () => {
    const task = createTestTask({
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(false);
    expect(result.details).toHaveLength(0);
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
  });

  // --- updatedAt timestamp ---

  test('should update updatedAt timestamp after migration', () => {
    const originalUpdatedAt = '2026-01-01T00:00:00.000Z';
    const task = createTestTask({
      updatedAt: originalUpdatedAt,
      schemaVersion: 0,
    });

    applySchemaMigrations(task);

    expect(task.updatedAt).not.toBe(originalUpdatedAt);
  });

  // --- Full pipeline: v0 with all fixable issues ---

  test('should handle full migration from v0 with pipeline status + invalid verdict', () => {
    const task = createTestTask({
      status: 'wait_review',
      reopenCount: undefined as unknown as number,
      requirementHistory: undefined as unknown as [],
      schemaVersion: 0,
      history: [
        {
          timestamp: '2026-04-02T00:00:00.000Z',
          action: 'verdict',
          field: 'status',
          oldValue: 'in_progress',
          newValue: 'garbage_action',
          reason: 'test',
          user: 'test',
        },
      ],
      verification: {
        result: 'passed',
        method: 'automated',
        verifiedAt: '2026-04-02T00:00:00.000Z',
        verifiedBy: 'test',
        checkpoints: [],
        verdictAction: 'another_bad_value',
      } as any,
    });

    const result = applySchemaMigrations(task);

    // v1: reopenCount + requirementHistory added
    expect(task.reopenCount).toBe(0);
    expect(task.requirementHistory).toEqual([]);

    // v2: status migrated, invalid actions cleaned
    expect(task.status).toBe('in_progress');
    expect(task.history[0]!.newValue).toContain('garbage_action');
    expect((task.verification as any).verdictAction).toBeUndefined();

    // Version bumped
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
    expect(result.changed).toBe(true);
    expect(result.details.length).toBeGreaterThanOrEqual(3);
  });

  // --- Edge cases ---

  test('should handle task with empty history', () => {
    const task = createTestTask({
      history: [],
      schemaVersion: 0,
    });

    const result = applySchemaMigrations(task);
    expect(result.changed).toBe(true);
  });

  test('should handle task with undefined history gracefully', () => {
    const task = createTestTask({
      history: undefined as unknown as [],
      schemaVersion: 0,
    });

    // Should not throw
    expect(() => applySchemaMigrations(task)).not.toThrow();
  });

  test('should handle task without verification field', () => {
    const task = createTestTask({
      status: 'wait_qa',
      schemaVersion: 1,
    });

    const result = applySchemaMigrations(task);
    expect(task.status).toBe('in_progress');
    expect(result.changed).toBe(true);
  });

  test('should handle task with null schemaVersion', () => {
    const task = createTestTask({
      schemaVersion: null as unknown as number,
    });

    const result = applySchemaMigrations(task);
    // null ?? 0 = 0, so should migrate from v0
    expect(result.changed).toBe(true);
    expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
  });

  test('should preserve non-verdict history entries during migration', () => {
    const originalEntries = [
      { timestamp: '2026-04-01T00:00:00.000Z', action: 'status_change', field: 'status', oldValue: 'open', newValue: 'in_progress', reason: 'started', user: 'cli' },
      { timestamp: '2026-04-01T01:00:00.000Z', action: 'comment', field: 'description', oldValue: '', newValue: 'added notes', reason: '', user: 'cli' },
      { timestamp: '2026-04-01T02:00:00.000Z', action: 'dependency_add', field: 'dependencies', oldValue: '', newValue: 'TASK-001', reason: '', user: 'cli' },
    ];

    const task = createTestTask({
      history: [...originalEntries],
      schemaVersion: 0,
    });

    applySchemaMigrations(task);

    // Original entries should be unchanged
    expect(task.history[0]).toEqual(originalEntries[0]);
    expect(task.history[1]).toEqual(originalEntries[1]);
    expect(task.history[2]).toEqual(originalEntries[2]);
  });

  test('should correctly report details for version bump even without data changes', () => {
    const task = createTestTask({
      status: 'open',
      reopenCount: 0,
      requirementHistory: [],
      schemaVersion: 1,
      history: [],
    });

    const result = applySchemaMigrations(task);

    expect(result.changed).toBe(true);
    expect(result.details).toContain(`schemaVersion: 1 → ${CURRENT_TASK_SCHEMA_VERSION}`);
  });
});

// ============== Integration: SCHEMA_MIGRATIONS individual steps ==============

describe('Individual Migration Steps', () => {
  test('v1 migration: should detect change for missing reopenCount', () => {
    const task = createTestTask({ reopenCount: undefined as unknown as number });
    const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1)!;
    const result = v1.migrate(task);
    expect(result.changed).toBe(true);
    expect(result.details).toContain('添加 reopenCount: 0');
  });

  test('v1 migration: should detect change for missing requirementHistory', () => {
    const task = createTestTask({ requirementHistory: undefined as unknown as [] });
    const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1)!;
    const result = v1.migrate(task);
    expect(result.changed).toBe(true);
    expect(result.details).toContain('添加 requirementHistory: []');
  });

  test('v1 migration: should return unchanged when fields already present', () => {
    const task = createTestTask({ reopenCount: 0, requirementHistory: [] });
    const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1)!;
    const result = v1.migrate(task);
    expect(result.changed).toBe(false);
  });

  test('v2 migration: should detect pipeline status change', () => {
    for (const [oldStatus, newStatus] of Object.entries(PIPELINE_STATUS_MIGRATION_MAP)) {
      const task = createTestTask({ status: oldStatus as any });
      const v2 = SCHEMA_MIGRATIONS.find(m => m.version === 2)!;
      const result = v2.migrate(task);
      expect(task.status).toBe(newStatus);
      expect(result.changed).toBe(true);
    }
  });

  test('v2 migration: should not change already-valid status', () => {
    const nonPipelineStatuses = ['open', 'in_progress', 'resolved', 'closed', 'reopened', 'abandoned'];
    for (const status of nonPipelineStatuses) {
      const task = createTestTask({ status: status as any, history: [] });
      const v2 = SCHEMA_MIGRATIONS.find(m => m.version === 2)!;
      v2.migrate(task);
      expect(task.status).toBe(status as TaskStatus);
    }
  });
});
