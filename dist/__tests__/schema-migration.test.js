import { describe, test, expect } from 'bun:test';
import { getPendingMigrations, applySchemaMigrations, SCHEMA_MIGRATIONS, } from '../commands/analyze';
import { CURRENT_TASK_SCHEMA_VERSION, PIPELINE_INTERMEDIATE_STATUSES, PIPELINE_STATUS_MIGRATION_MAP, } from '../types/task';
import { VALID_VERDICT_ACTIONS } from '../types/harness';
// Helper to create a minimal valid TaskMeta for testing
function createTestTask(overrides = {}) {
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
    test('CURRENT_TASK_SCHEMA_VERSION should be 6', () => {
        expect(CURRENT_TASK_SCHEMA_VERSION).toBe(6);
    });
    test('SCHEMA_MIGRATIONS should have 6 steps', () => {
        expect(SCHEMA_MIGRATIONS).toHaveLength(6);
    });
    test('SCHEMA_MIGRATIONS versions should be sequential starting from 1', () => {
        expect(SCHEMA_MIGRATIONS[0].version).toBe(1);
        expect(SCHEMA_MIGRATIONS[1].version).toBe(2);
        expect(SCHEMA_MIGRATIONS[2].version).toBe(3);
        expect(SCHEMA_MIGRATIONS[3].version).toBe(4);
        expect(SCHEMA_MIGRATIONS[4].version).toBe(5);
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
        expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('wait_evaluation');
        expect(PIPELINE_INTERMEDIATE_STATUSES).toContain('needs_human');
        expect(PIPELINE_INTERMEDIATE_STATUSES).toHaveLength(4);
    });
    test('PIPELINE_STATUS_MIGRATION_MAP should map all intermediate statuses', () => {
        for (const status of PIPELINE_INTERMEDIATE_STATUSES) {
            expect(PIPELINE_STATUS_MIGRATION_MAP).toHaveProperty(status);
        }
    });
    test('PIPELINE_STATUS_MIGRATION_MAP should map to valid target statuses', () => {
        const validTargets = ['open', 'in_progress', 'wait_qa', 'wait_evaluation', 'resolved', 'closed', 'reopened', 'abandoned', 'failed'];
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
    test('wait_evaluation should map to wait_qa', () => {
        expect(PIPELINE_STATUS_MIGRATION_MAP['wait_evaluation']).toBe('wait_qa');
    });
});
// ============== VerdictAction Constants ==============
describe('VerdictAction Constants', () => {
    test('VALID_VERDICT_ACTIONS should contain all valid actions', () => {
        expect(VALID_VERDICT_ACTIONS).toContain('resolve');
        expect(VALID_VERDICT_ACTIONS).toContain('redevelop');
        expect(VALID_VERDICT_ACTIONS).toContain('minor_fix');
        expect(VALID_VERDICT_ACTIONS).toContain('retest');
        expect(VALID_VERDICT_ACTIONS).toContain('reevaluate');
        expect(VALID_VERDICT_ACTIONS).toContain('escalate_human');
        expect(VALID_VERDICT_ACTIONS).toHaveLength(6);
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
        expect(pending).toHaveLength(6);
        expect(pending[0].version).toBe(1);
        expect(pending[1].version).toBe(2);
        expect(pending[2].version).toBe(3);
        expect(pending[3].version).toBe(4);
        expect(pending[4].version).toBe(5);
        expect(pending[5].version).toBe(6);
    });
    test('from version 1 should return v2, v3, v4, v5, v6 migrations', () => {
        const pending = getPendingMigrations(1);
        expect(pending).toHaveLength(5);
        expect(pending[0].version).toBe(2);
        expect(pending[0].name).toBe('pipeline_status_and_verdict_action');
        expect(pending[1].version).toBe(3);
        expect(pending[2].version).toBe(4);
        expect(pending[3].version).toBe(5);
        expect(pending[4].version).toBe(6);
    });
    test('from version 3 should return v4, v5, v6 migrations', () => {
        const pending = getPendingMigrations(3);
        expect(pending).toHaveLength(3);
        expect(pending[0].version).toBe(4);
        expect(pending[0].name).toBe('reopened_to_open_and_transition_notes');
        expect(pending[1].version).toBe(5);
        expect(pending[1].name).toBe('checkpoint_prefix_completion');
        expect(pending[2].version).toBe(6);
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
            reopenCount: undefined,
            requirementHistory: undefined,
            schemaVersion: undefined,
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
            status: 'open', // not a pipeline intermediate status
            schemaVersion: 0,
        });
        const result = applySchemaMigrations(task);
        expect(result.changed).toBe(true); // changed because version bumped
        expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
    });
    // --- Version 0 → v1 (legacy schema fields) ---
    test('v1 migration should add reopenCount when missing', () => {
        const task = createTestTask({
            reopenCount: undefined,
            requirementHistory: [],
            schemaVersion: 0,
        });
        applySchemaMigrations(task);
        expect(task.reopenCount).toBe(0);
    });
    test('v1 migration should add requirementHistory when missing', () => {
        const task = createTestTask({
            reopenCount: 0,
            requirementHistory: undefined,
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
        expect(task.history[0].newValue).toContain('migrated: invalid_verdict_action');
        expect(task.history[0].newValue).toContain('invalid_action');
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
        expect(task.history[0].newValue).toBe('redevelop');
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
            },
        });
        const result = applySchemaMigrations(task);
        expect(result.changed).toBe(true);
        expect(task.verification.verdictAction).toBeUndefined();
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
            },
        });
        applySchemaMigrations(task);
        expect(task.verification.verdictAction).toBe('redevelop');
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
        expect(task.history[0].newValue).toContain('bad1');
        expect(task.history[1].newValue).toBe('b'); // non-verdict entry unchanged
        expect(task.history[2].newValue).toContain('bad2');
    });
    // --- Version 3 → v4 (reopened→open + TransitionNote + resumeAction) ---
    test('v4 migration should migrate reopened to open', () => {
        const task = createTestTask({
            status: 'reopened',
            schemaVersion: 3,
        });
        const result = applySchemaMigrations(task);
        expect(task.status).toBe('open');
        expect(result.details).toContain('status: reopened → open');
        expect(result.changed).toBe(true);
    });
    test('v4 migration should initialize transitionNotes when missing', () => {
        const task = createTestTask({
            status: 'open',
            schemaVersion: 3,
        });
        const result = applySchemaMigrations(task);
        expect(task.transitionNotes).toEqual([]);
        expect(result.details).toContain('添加 transitionNotes: []');
    });
    test('v4 migration should not overwrite existing transitionNotes', () => {
        const existingNotes = [{
                timestamp: '2026-04-01T00:00:00.000Z',
                fromStatus: 'in_progress',
                toStatus: 'resolved',
                note: 'Task completed',
                author: 'test',
            }];
        const task = createTestTask({
            status: 'open',
            transitionNotes: existingNotes,
            schemaVersion: 3,
        });
        applySchemaMigrations(task);
        expect(task.transitionNotes).toEqual(existingNotes);
    });
    test('v4 migration should set resumeAction for pipeline intermediate status', () => {
        for (const status of PIPELINE_INTERMEDIATE_STATUSES) {
            const task = createTestTask({
                status: status,
                schemaVersion: 3,
            });
            const result = applySchemaMigrations(task);
            expect(task.resumeAction).toBe('resume_pipeline');
            expect(result.changed).toBe(true);
        }
    });
    test('v4 migration should not set resumeAction for non-intermediate status', () => {
        const task = createTestTask({
            status: 'open',
            schemaVersion: 3,
        });
        applySchemaMigrations(task);
        expect(task.resumeAction).toBeUndefined();
    });
    test('v4 migration should not overwrite existing resumeAction', () => {
        const task = createTestTask({
            status: 'wait_review',
            resumeAction: 'restart_stage',
            schemaVersion: 3,
        });
        applySchemaMigrations(task);
        expect(task.resumeAction).toBe('restart_stage');
    });
    test('v4 migration should handle reopened status + initialize fields together', () => {
        const task = createTestTask({
            status: 'reopened',
            schemaVersion: 3,
        });
        const result = applySchemaMigrations(task);
        expect(task.status).toBe('open');
        expect(task.transitionNotes).toHaveLength(1);
        expect(task.transitionNotes[0].fromStatus).toBe('reopened');
        expect(task.transitionNotes[0].toStatus).toBe('open');
        expect(task.resumeAction).toBeUndefined();
        expect(task.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
        expect(result.changed).toBe(true);
        expect(result.details).toContain('status: reopened → open');
        expect(result.details).toContain('transitionNote: 记录 reopened → open 迁移');
    });
    test('TransitionNote write and read roundtrip', () => {
        const note = {
            timestamp: '2026-04-04T00:00:00.000Z',
            fromStatus: 'in_progress',
            toStatus: 'resolved',
            note: 'All checkpoints passed',
            author: 'harness',
        };
        const task = createTestTask({
            status: 'resolved',
            transitionNotes: [note],
            schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
        });
        const result = applySchemaMigrations(task);
        expect(result.changed).toBe(false);
        expect(task.transitionNotes).toHaveLength(1);
        expect(task.transitionNotes[0].fromStatus).toBe('in_progress');
        expect(task.transitionNotes[0].toStatus).toBe('resolved');
        expect(task.transitionNotes[0].note).toBe('All checkpoints passed');
        expect(task.transitionNotes[0].author).toBe('harness');
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
            reopenCount: undefined,
            requirementHistory: undefined,
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
            },
        });
        const result = applySchemaMigrations(task);
        // v1: reopenCount + requirementHistory added
        expect(task.reopenCount).toBe(0);
        expect(task.requirementHistory).toEqual([]);
        // v2: status migrated, invalid actions cleaned
        expect(task.status).toBe('in_progress');
        expect(task.history[0].newValue).toContain('garbage_action');
        expect(task.verification.verdictAction).toBeUndefined();
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
            history: undefined,
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
            schemaVersion: null,
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
        const task = createTestTask({ reopenCount: undefined });
        const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1);
        const result = v1.migrate(task);
        expect(result.changed).toBe(true);
        expect(result.details).toContain('添加 reopenCount: 0');
    });
    test('v1 migration: should detect change for missing requirementHistory', () => {
        const task = createTestTask({ requirementHistory: undefined });
        const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1);
        const result = v1.migrate(task);
        expect(result.changed).toBe(true);
        expect(result.details).toContain('添加 requirementHistory: []');
    });
    test('v1 migration: should return unchanged when fields already present', () => {
        const task = createTestTask({ reopenCount: 0, requirementHistory: [] });
        const v1 = SCHEMA_MIGRATIONS.find(m => m.version === 1);
        const result = v1.migrate(task);
        expect(result.changed).toBe(false);
    });
    test('v2 migration: should detect pipeline status change', () => {
        for (const [oldStatus, newStatus] of Object.entries(PIPELINE_STATUS_MIGRATION_MAP)) {
            const task = createTestTask({ status: oldStatus });
            const v2 = SCHEMA_MIGRATIONS.find(m => m.version === 2);
            const result = v2.migrate(task);
            expect(task.status).toBe(newStatus);
            expect(result.changed).toBe(true);
        }
    });
    test('v2 migration: should not change already-valid status', () => {
        const nonPipelineStatuses = ['open', 'in_progress', 'resolved', 'closed', 'abandoned', 'failed'];
        for (const status of nonPipelineStatuses) {
            const task = createTestTask({ status: status, history: [] });
            const v2 = SCHEMA_MIGRATIONS.find(m => m.version === 2);
            v2.migrate(task);
            expect(task.status).toBe(status);
        }
    });
    // --- v3 individual migration ---
    test('v3 migration: should add commitHistory to existing executionStats', () => {
        const task = createTestTask({
            executionStats: {
                duration: 1000,
                retryCount: 0,
                completedAt: '2026-04-01T00:00:00.000Z',
            },
        });
        const v3 = SCHEMA_MIGRATIONS.find(m => m.version === 3);
        const result = v3.migrate(task);
        expect(result.changed).toBe(true);
        expect(task.executionStats.commitHistory).toEqual([]);
        expect(result.details).toContain('添加 executionStats.commitHistory: []');
    });
    test('v3 migration: should not change task without executionStats', () => {
        const task = createTestTask({});
        const v3 = SCHEMA_MIGRATIONS.find(m => m.version === 3);
        const result = v3.migrate(task);
        expect(result.changed).toBe(false);
    });
    test('v3 migration: should not overwrite existing commitHistory', () => {
        const existingHistory = [{ sha: 'abc123', batchLabel: '批次 1', timestamp: '2026-04-01T00:00:00.000Z' }];
        const task = createTestTask({
            executionStats: {
                duration: 1000,
                retryCount: 0,
                completedAt: '2026-04-01T00:00:00.000Z',
                commitHistory: existingHistory,
            },
        });
        const v3 = SCHEMA_MIGRATIONS.find(m => m.version === 3);
        const result = v3.migrate(task);
        expect(result.changed).toBe(false);
        expect(task.executionStats.commitHistory).toEqual(existingHistory);
    });
    // --- v4 individual migration ---
    test('v4 migration: should convert reopened to open', () => {
        const task = createTestTask({ status: 'reopened' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.status).toBe('open');
        expect(result.changed).toBe(true);
        expect(result.details).toContain('status: reopened → open');
    });
    test('v4 migration: should initialize transitionNotes', () => {
        const task = createTestTask({ status: 'open' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.transitionNotes).toEqual([]);
        expect(result.details).toContain('添加 transitionNotes: []');
    });
    test('v4 migration: should set resumeAction for wait_review', () => {
        const task = createTestTask({ status: 'wait_review' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.resumeAction).toBe('resume_pipeline');
        expect(result.changed).toBe(true);
    });
    test('v4 migration: should set resumeAction for wait_qa', () => {
        const task = createTestTask({ status: 'wait_qa' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.resumeAction).toBe('resume_pipeline');
    });
    test('v4 migration: should set resumeAction for wait_evaluation', () => {
        const task = createTestTask({ status: 'wait_evaluation' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.resumeAction).toBe('resume_pipeline');
    });
    test('v4 migration: should set resumeAction for needs_human', () => {
        const task = createTestTask({ status: 'needs_human' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        expect(task.resumeAction).toBe('resume_pipeline');
    });
    test('v4 migration: should not set resumeAction for open status', () => {
        const task = createTestTask({ status: 'open' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        v4.migrate(task);
        expect(task.resumeAction).toBeUndefined();
    });
    test('v4 migration: should not change already-open status', () => {
        const task = createTestTask({ status: 'open' });
        const v4 = SCHEMA_MIGRATIONS.find(m => m.version === 4);
        const result = v4.migrate(task);
        // Only transitionNotes change, not status
        expect(task.status).toBe('open');
    });
    // --- v5 individual migration ---
    test('v5 migration: should add prefix to checkpoints without valid prefix', () => {
        const task = createTestTask({
            status: 'open',
            checkpoints: [
                { id: 'CP-1', description: '实现用户登录功能', completed: false },
                { id: 'CP-2', description: '验证测试通过', completed: false },
                { id: 'CP-3', description: '部署到生产环境', completed: false },
            ],
        });
        const v5 = SCHEMA_MIGRATIONS.find(m => m.version === 5);
        const result = v5.migrate(task);
        expect(result.changed).toBe(true);
        expect(task.checkpoints[0].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] 实现用户登录功能$/);
        expect(task.checkpoints[1].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] 验证测试通过$/);
        expect(task.checkpoints[2].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] 部署到生产环境$/);
    });
    test('v5 migration: should not modify checkpoints that already have valid prefix', () => {
        const task = createTestTask({
            status: 'open',
            checkpoints: [
                { id: 'CP-1', description: '[ai review] 实现用户登录功能', completed: false },
                { id: 'CP-2', description: '[ai qa] 验证测试通过', completed: false },
            ],
        });
        const v5 = SCHEMA_MIGRATIONS.find(m => m.version === 5);
        const result = v5.migrate(task);
        expect(result.changed).toBe(false);
        expect(task.checkpoints[0].description).toBe('[ai review] 实现用户登录功能');
        expect(task.checkpoints[1].description).toBe('[ai qa] 验证测试通过');
    });
    test('v5 migration: should handle mixed checkpoints (some with prefix, some without)', () => {
        const task = createTestTask({
            status: 'open',
            checkpoints: [
                { id: 'CP-1', description: '[ai review] 实现用户登录功能', completed: false },
                { id: 'CP-2', description: '手动验证UI效果', completed: false },
            ],
        });
        const v5 = SCHEMA_MIGRATIONS.find(m => m.version === 5);
        const result = v5.migrate(task);
        expect(result.changed).toBe(true);
        expect(task.checkpoints[0].description).toBe('[ai review] 实现用户登录功能');
        expect(task.checkpoints[1].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] 手动验证UI效果$/);
    });
    test('v5 migration: should handle empty checkpoints', () => {
        const task = createTestTask({
            status: 'open',
            checkpoints: [],
        });
        const v5 = SCHEMA_MIGRATIONS.find(m => m.version === 5);
        const result = v5.migrate(task);
        expect(result.changed).toBe(false);
        expect(task.checkpoints).toEqual([]);
    });
    test('v5 migration: should handle task without checkpoints field', () => {
        const task = createTestTask({
            status: 'open',
        });
        // @ts-expect-error - testing undefined checkpoints
        task.checkpoints = undefined;
        const v5 = SCHEMA_MIGRATIONS.find(m => m.version === 5);
        const result = v5.migrate(task);
        expect(result.changed).toBe(false);
    });
});
