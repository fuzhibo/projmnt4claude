/**
 * analyze.ts 辅助函数单元测试
 */

import { describe, test, expect } from 'bun:test';
import {
  normalizeStatus,
  normalizePriority,
} from '../types/task';
import {
  matchesIgnorePattern,
  isValidISOTimestamp,
  validateHistoryEntry,
  validateRequirementHistoryEntry,
  validateTaskIdFormat,
  isValidStatusValue,
  isValidTypeValue,
  isValidPriorityValue,
  calculateReopenStats,
  calculateHealthScore,
  extractKeywordsFromCriteria,
  inferVerificationMethod,
  extractAcceptanceCriteriaFromDescription,
  getPendingMigrations,
  applySchemaMigrations,
} from '../commands/analyze';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import {
  evaluateRelatedFiles,
  evaluateDescription,
  evaluateCheckpoints,
  evaluateSolution,
  extractFileRefsForLayer,
  calculateContentQuality,
  evaluateLayerOrdering,
} from '../utils/quality-gate';

// ============== normalizeStatus ==============

describe('normalizeStatus', () => {
  test('maps legacy pending to open', () => {
    expect(normalizeStatus('pending')).toBe('open');
  });

  test('maps legacy completed to resolved', () => {
    expect(normalizeStatus('completed')).toBe('resolved');
  });

  test('maps legacy cancelled to abandoned', () => {
    expect(normalizeStatus('cancelled')).toBe('abandoned');
  });

  test('maps reopen/reopened/blocked/needs_human to open', () => {
    expect(normalizeStatus('reopen')).toBe('open');
    expect(normalizeStatus('reopened')).toBe('open');
    expect(normalizeStatus('blocked')).toBe('open');
    expect(normalizeStatus('needs_human')).toBe('open');
  });

  test('returns standard statuses unchanged', () => {
    expect(normalizeStatus('in_progress')).toBe('in_progress');
    expect(normalizeStatus('wait_review')).toBe('wait_review');
    expect(normalizeStatus('wait_qa')).toBe('wait_qa');
    expect(normalizeStatus('wait_complete')).toBe('wait_complete');
    expect(normalizeStatus('resolved')).toBe('resolved');
    expect(normalizeStatus('closed')).toBe('closed');
    expect(normalizeStatus('abandoned')).toBe('abandoned');
    expect(normalizeStatus('failed')).toBe('failed');
  });

  test('defaults unknown status to open', () => {
    expect(normalizeStatus('unknown_status')).toBe('open');
  });
});

// ============== normalizePriority ==============

describe('normalizePriority', () => {
  test('maps textual priorities to P-series', () => {
    expect(normalizePriority('urgent')).toBe('P0');
    expect(normalizePriority('high')).toBe('P1');
    expect(normalizePriority('medium')).toBe('P2');
    expect(normalizePriority('low')).toBe('P3');
  });

  test('returns P-series and Q-series unchanged', () => {
    expect(normalizePriority('P0')).toBe('P0');
    expect(normalizePriority('P1')).toBe('P1');
    expect(normalizePriority('Q1')).toBe('Q1');
    expect(normalizePriority('Q4')).toBe('Q4');
  });

  test('defaults unknown priority to P2', () => {
    expect(normalizePriority('unknown')).toBe('P2');
  });
});

// ============== matchesIgnorePattern ==============

describe('matchesIgnorePattern', () => {
  test('matches exact pattern', () => {
    expect(matchesIgnorePattern('TASK-001', ['TASK-001'])).toBe(true);
  });

  test('matches wildcard pattern', () => {
    expect(matchesIgnorePattern('TASK-bug-P1-auth-20260101', ['TASK-bug-*'])).toBe(true);
  });

  test('returns false when no pattern matches', () => {
    expect(matchesIgnorePattern('TASK-001', ['TASK-999', 'OTHER-*'])).toBe(false);
  });

  test('returns false for empty patterns', () => {
    expect(matchesIgnorePattern('TASK-001', [])).toBe(false);
  });
});

// ============== isValidISOTimestamp ==============

describe('isValidISOTimestamp', () => {
  test('accepts valid ISO timestamp with Z', () => {
    expect(isValidISOTimestamp('2026-01-15T10:30:00Z')).toBe(true);
  });

  test('accepts valid ISO timestamp with milliseconds', () => {
    expect(isValidISOTimestamp('2026-01-15T10:30:00.123Z')).toBe(true);
  });

  test('rejects invalid format', () => {
    expect(isValidISOTimestamp('not-a-date')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidISOTimestamp('')).toBe(false);
  });
});

// ============== validateHistoryEntry ==============

describe('validateHistoryEntry', () => {
  test('validates correct entry', () => {
    const result = validateHistoryEntry({
      timestamp: '2026-01-15T10:30:00Z',
      action: 'status_change',
    }, 0);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects non-object entry', () => {
    const result = validateHistoryEntry(null, 0);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('不是有效对象');
  });

  test('reports missing timestamp', () => {
    const result = validateHistoryEntry({ action: 'created' }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('timestamp'))).toBe(true);
  });

  test('reports missing action', () => {
    const result = validateHistoryEntry({ timestamp: '2026-01-15T10:30:00Z' }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('action'))).toBe(true);
  });
});

// ============== validateRequirementHistoryEntry ==============

describe('validateRequirementHistoryEntry', () => {
  test('validates correct entry', () => {
    const result = validateRequirementHistoryEntry({
      timestamp: '2026-01-15T10:30:00Z',
      version: 1,
      newDescription: 'Updated desc',
      changeReason: 'Bug fix',
    }, 0);
    expect(result.valid).toBe(true);
  });

  test('rejects invalid version', () => {
    const result = validateRequirementHistoryEntry({
      timestamp: '2026-01-15T10:30:00Z',
      version: 0,
      newDescription: 'desc',
      changeReason: 'reason',
    }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  test('rejects missing fields', () => {
    const result = validateRequirementHistoryEntry({}, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ============== validateTaskIdFormat ==============

describe('validateTaskIdFormat', () => {
  test('recognizes old format TASK-001', () => {
    const result = validateTaskIdFormat('TASK-001');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('old');
  });

  test('recognizes new format', () => {
    const result = validateTaskIdFormat('TASK-bug-P1-auth-login-20260115');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('new');
  });

  test('rejects completely invalid ID', () => {
    const result = validateTaskIdFormat('INVALID');
    expect(result.valid).toBe(false);
  });

  test('rejects empty string', () => {
    const result = validateTaskIdFormat('');
    expect(result.valid).toBe(false);
  });
});

// ============== isValidStatusValue / isValidTypeValue / isValidPriorityValue ==============

describe('validation helpers', () => {
  test('isValidStatusValue accepts valid statuses', () => {
    expect(isValidStatusValue('open')).toBe(true);
    expect(isValidStatusValue('resolved')).toBe(true);
    expect(isValidStatusValue('failed')).toBe(true);
  });

  test('isValidStatusValue rejects invalid status', () => {
    expect(isValidStatusValue('unknown')).toBe(false);
  });

  test('isValidTypeValue accepts valid types', () => {
    expect(isValidTypeValue('bug')).toBe(true);
    expect(isValidTypeValue('feature')).toBe(true);
  });

  test('isValidTypeValue rejects invalid type', () => {
    expect(isValidTypeValue('unknown')).toBe(false);
  });

  test('isValidPriorityValue accepts valid priorities', () => {
    expect(isValidPriorityValue('P0')).toBe(true);
    expect(isValidPriorityValue('Q4')).toBe(true);
  });

  test('isValidPriorityValue rejects invalid priority', () => {
    expect(isValidPriorityValue('X9')).toBe(false);
  });
});

// ============== evaluateDescription ==============

describe('evaluateDescription', () => {
  test('returns 0 score for empty description', () => {
    const result = evaluateDescription('');
    expect(result.score).toBe(0);
    expect(result.deductions.some(d => d.reason.includes('缺少描述'))).toBe(true);
  });

  test('returns 0 score for undefined description', () => {
    const result = evaluateDescription(undefined);
    expect(result.score).toBe(0);
  });

  test('deducts for short description (< 30 chars)', () => {
    const result = evaluateDescription('This is a short task');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('过短'))).toBe(true);
  });

  test('deducts for medium description (30-49 chars)', () => {
    const result = evaluateDescription('This is a medium task description here');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('较短'))).toBe(true);
  });

  test('deducts for missing structured sections in long description', () => {
    const result = evaluateDescription('A'.repeat(100));
    expect(result.deductions.some(d => d.reason.includes('结构化段落'))).toBe(true);
  });

  test('high score with structured description including sections', () => {
    const desc = [
      '## 问题描述\nSomething went wrong with the login flow',
      '## 根因分析\nRoot cause was a missing null check in the auth handler',
      '## 解决方案\nAdd null check before accessing user.token',
      'Related to src/auth/handler.ts',
    ].join('\n\n');
    const result = evaluateDescription(desc);
    expect(result.score).toBeGreaterThan(60);
  });
});

// ============== evaluateCheckpoints ==============

describe('evaluateCheckpoints', () => {
  test('returns 100 for no checkpoints (uses checkpoint.md)', () => {
    const result = evaluateCheckpoints(undefined);
    expect(result.score).toBe(100);
  });

  test('returns 100 for empty checkpoints array', () => {
    const result = evaluateCheckpoints([]);
    expect(result.score).toBe(100);
  });

  test('deducts for generic checkpoint descriptions', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: '核心功能实现', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('泛化'))).toBe(true);
  });

  test('deducts for too few checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'Implement user login API endpoint', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.deductions.some(d => d.reason.includes('数量过少'))).toBe(true);
  });

  test('high score with specific checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'Implement user login API endpoint', status: 'pending' },
      { id: 'CP2', description: 'Add JWT token validation middleware', status: 'pending' },
      { id: 'CP3', description: 'Write integration tests for auth flow', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.score).toBe(100);
  });
});

// ============== evaluateSolution ==============

describe('evaluateSolution', () => {
  test('returns 100 for empty description (no penalty here)', () => {
    const result = evaluateSolution(undefined);
    expect(result.score).toBe(100);
  });

  test('deducts for description without solution', () => {
    const result = evaluateSolution('This is a task about something but no fix mentioned');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('解决方案'))).toBe(true);
  });

  test('high score with solution section', () => {
    const result = evaluateSolution('## 解决方案\nAdd input validation to the login form');
    expect(result.score).toBe(100);
  });

  test('partial score with solution keywords but no section', () => {
    const result = evaluateSolution('需要 modify the auth module to add validation');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('结构化'))).toBe(true);
  });
});

// ============== extractFileRefsForLayer ==============

describe('extractFileRefsForLayer', () => {
  test('extracts src/ file paths', () => {
    const result = extractFileRefsForLayer('Modify src/auth/handler.ts and src/types/user.ts');
    expect(result).toContain('src/auth/handler.ts');
    expect(result).toContain('src/types/user.ts');
  });

  test('extracts relative paths', () => {
    const result = extractFileRefsForLayer('Edit ./config/settings.json');
    expect(result).toContain('./config/settings.json');
  });

  test('returns empty array for no file paths', () => {
    const result = extractFileRefsForLayer('No file paths here');
    expect(result).toEqual([]);
  });

  test('deduplicates file paths', () => {
    const result = extractFileRefsForLayer('See src/auth/handler.ts and src/auth/handler.ts');
    expect(result.filter(f => f === 'src/auth/handler.ts')).toHaveLength(1);
  });
});

// ============== calculateReopenStats ==============

describe('calculateReopenStats', () => {
  test('returns zero stats for tasks without reopens', () => {
    const tasks: TaskMeta[] = [
      { id: 'T1', title: 'Task 1', type: 'bug', priority: 'P1', status: 'open', schemaVersion: 1 },
    ];
    const result = calculateReopenStats(tasks);
    expect(result.reopenCount).toBe(0);
    expect(result.topReopened).toHaveLength(0);
  });

  test('counts tasks with reopenCount > 0', () => {
    const tasks: TaskMeta[] = [
      { id: 'T1', title: 'Task 1', type: 'bug', priority: 'P1', status: 'open', schemaVersion: 1, reopenCount: 3 },
      { id: 'T2', title: 'Task 2', type: 'feature', priority: 'P2', status: 'open', schemaVersion: 1 },
    ];
    const result = calculateReopenStats(tasks);
    expect(result.reopenCount).toBe(1);
    expect(result.topReopened[0].count).toBe(3);
  });

  test('sorts by reopen count descending', () => {
    const tasks: TaskMeta[] = [
      { id: 'T1', title: 'Task 1', type: 'bug', priority: 'P1', status: 'open', schemaVersion: 1, reopenCount: 2 },
      { id: 'T2', title: 'Task 2', type: 'bug', priority: 'P1', status: 'open', schemaVersion: 1, reopenCount: 5 },
    ];
    const result = calculateReopenStats(tasks);
    expect(result.topReopened[0].taskId).toBe('T2');
    expect(result.topReopened[1].taskId).toBe('T1');
  });
});

// ============== calculateHealthScore ==============

describe('calculateHealthScore', () => {
  const makeResult = (overrides: Record<string, unknown> = {}) => ({
    issues: [],
    stats: {
      total: 10,
      parentTasks: 8,
      subtasks: 2,
      subtaskCompletionRate: 0.5,
      byStatus: {},
      byPriority: {},
      blocked: 0,
      stale: 0,
      orphan: 0,
      cycle: 0,
      orphanSubtasks: 0,
      abandonedResidual: 0,
      resolvedWithoutVerification: 0,
      inconsistentStatus: 0,
      fileNotFound: 0,
      ignored: 0,
      missingCreatedBy: 0,
      ...overrides,
    },
  });

  test('returns 100 for empty project', () => {
    const result = calculateHealthScore(makeResult({ total: 0 }) as any);
    expect(result).toBe(100);
  });

  test('deducts for stale tasks', () => {
    const result = calculateHealthScore(makeResult({ stale: 3 }) as any);
    expect(result).toBeLessThan(100);
    expect(result).toBe(85); // 100 - 3*5
  });

  test('deducts for cycle dependencies', () => {
    const result = calculateHealthScore(makeResult({ cycle: 2 }) as any);
    expect(result).toBe(70); // 100 - 2*15
  });

  test('score clamped to 0', () => {
    const result = calculateHealthScore(makeResult({ stale: 30 }) as any);
    expect(result).toBe(0);
  });
});

// ============== extractKeywordsFromCriteria ==============

describe('extractKeywordsFromCriteria', () => {
  test('extracts English keywords filtering stop words', () => {
    const result = extractKeywordsFromCriteria('The user authentication should validate tokens');
    expect(result).toContain('authentication');
    expect(result).toContain('tokens');
    expect(result).toContain('validate');
    // stop words filtered
    expect(result).not.toContain('the');
    expect(result).not.toContain('should');
  });

  test('extracts Chinese keywords', () => {
    const result = extractKeywordsFromCriteria('需要验证用户登录功能');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(k => k.includes('登录'))).toBe(true);
  });

  test('returns empty array for empty input', () => {
    const result = extractKeywordsFromCriteria('');
    expect(result).toEqual([]);
  });
});

// ============== inferVerificationMethod ==============

describe('inferVerificationMethod', () => {
  test('returns unit_test for test-related descriptions', () => {
    expect(inferVerificationMethod('Write unit test for login')).toBe('unit_test');
    expect(inferVerificationMethod('添加测试用例')).toBe('unit_test');
  });

  test('returns code_review for review-related descriptions', () => {
    expect(inferVerificationMethod('Code review for PR')).toBe('code_review');
    expect(inferVerificationMethod('审查代码质量')).toBe('code_review');
  });

  test('returns functional_test for API descriptions', () => {
    expect(inferVerificationMethod('Implement REST API endpoint')).toBe('functional_test');
    expect(inferVerificationMethod('添加接口')).toBe('functional_test');
  });

  test('returns e2e_test for UI descriptions', () => {
    expect(inferVerificationMethod('Update UI components')).toBe('e2e_test');
  });

  test('returns automated as default', () => {
    expect(inferVerificationMethod('Refactor codebase')).toBe('automated');
  });
});

// ============== extractAcceptanceCriteriaFromDescription ==============

describe('extractAcceptanceCriteriaFromDescription', () => {
  test('extracts bullet list items', () => {
    const desc = '- User can login\n- Password is validated\n- Session is created';
    const result = extractAcceptanceCriteriaFromDescription(desc);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('User can login');
  });

  test('extracts numbered list items', () => {
    const desc = '1. First item\n2. Second item';
    const result = extractAcceptanceCriteriaFromDescription(desc);
    expect(result).toHaveLength(2);
  });

  test('extracts checkbox items', () => {
    const desc = '- [ ] Implement feature\n- [x] Write tests';
    const result = extractAcceptanceCriteriaFromDescription(desc);
    expect(result).toHaveLength(2);
  });

  test('falls back to full description if no list items', () => {
    const desc = 'Just a plain description without lists';
    const result = extractAcceptanceCriteriaFromDescription(desc);
    expect(result).toEqual(['Just a plain description without lists']);
  });
});

// ============== getPendingMigrations ==============

describe('getPendingMigrations', () => {
  test('returns all migrations when fromVersion is 0', () => {
    const result = getPendingMigrations(0);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].version).toBeGreaterThanOrEqual(1);
  });

  test('returns empty for current version', () => {
    const currentVersion = getPendingMigrations(0).reduce(
      (max, m) => Math.max(max, m.version), 0
    );
    const result = getPendingMigrations(currentVersion);
    expect(result).toHaveLength(0);
  });
});

// ============== applySchemaMigrations ==============

describe('applySchemaMigrations', () => {
  test('applies migrations to task with schemaVersion 0', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test task',
      type: 'bug',
      priority: 'P1',
      status: 'open',
      schemaVersion: 0,
      dependencies: [],
      createdAt: '2026-01-15T10:30:00Z',
      updatedAt: '2026-01-15T10:30:00Z',
      history: [],
    };
    const result = applySchemaMigrations(task);
    expect(result.changed).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
    expect(task.schemaVersion).toBeGreaterThan(0);
  });

  test('adds reopenCount field when missing', () => {
    const task = {
      id: 'TASK-001',
      title: 'Test',
      type: 'bug' as const,
      priority: 'P1' as const,
      status: 'open' as const,
      schemaVersion: 0,
      dependencies: [],
      createdAt: '2026-01-15T10:30:00Z',
      updatedAt: '2026-01-15T10:30:00Z',
      history: [],
    } as TaskMeta;
    applySchemaMigrations(task);
    expect(task.reopenCount).toBe(0);
  });

  test('adds requirementHistory field when missing', () => {
    const task = {
      id: 'TASK-001',
      title: 'Test',
      type: 'bug' as const,
      priority: 'P1' as const,
      status: 'open' as const,
      schemaVersion: 0,
      dependencies: [],
      createdAt: '2026-01-15T10:30:00Z',
      updatedAt: '2026-01-15T10:30:00Z',
      history: [],
    } as TaskMeta;
    applySchemaMigrations(task);
    expect(task.requirementHistory).toEqual([]);
  });

  test('returns no changes for fully up-to-date task', () => {
    const currentVersion = getPendingMigrations(0).reduce(
      (max, m) => Math.max(max, m.version), 0
    );
    const task: TaskMeta = {
      id: 'TASK-001',
      title: 'Test task',
      type: 'bug',
      priority: 'P1',
      status: 'open',
      schemaVersion: currentVersion,
      reopenCount: 0,
      requirementHistory: [],
      dependencies: [],
      createdAt: '2026-01-15T10:30:00Z',
      updatedAt: '2026-01-15T10:30:00Z',
      history: [],
    };
    const result = applySchemaMigrations(task);
    expect(result.changed).toBe(false);
    expect(result.details).toHaveLength(0);
  });
});

// ============== calculateContentQuality ==============

describe('calculateContentQuality', () => {
  const makeTask = (overrides: Partial<TaskMeta> = {}): TaskMeta => ({
    id: 'TASK-001',
    title: 'Test task',
    type: 'bug',
    priority: 'P1',
    status: 'open',
    schemaVersion: 1,
    dependencies: [],
    createdAt: '2026-01-15T10:30:00Z',
    updatedAt: '2026-01-15T10:30:00Z',
    history: [],
    ...overrides,
  });

  test('returns scores for task with minimal fields (no AI)', async () => {
    const task = makeTask();
    const result = await calculateContentQuality(task);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
    expect(result.descriptionScore).toBeGreaterThanOrEqual(0);
    expect(result.checkpointScore).toBeGreaterThanOrEqual(0);
    expect(result.relatedFilesScore).toBeGreaterThanOrEqual(0);
    expect(result.solutionScore).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
    expect(result.aiSemanticScore).toBeUndefined();
  });

  test('deducts for empty description', async () => {
    const task = makeTask({ description: '' });
    const result = await calculateContentQuality(task);
    expect(result.descriptionScore).toBe(0);
    expect(result.totalScore).toBeLessThan(100);
  });

  test('high score with rich structured description and files', async () => {
    const desc = [
      '## 问题描述\nUser login fails when password contains special characters',
      '## 解决方案\nAdd input sanitization in src/auth/handler.ts',
      '## 相关文件\n- src/auth/handler.ts\n- src/utils/sanitize.ts',
    ].join('\n\n');
    const task = makeTask({
      description: desc,
      checkpoints: [
        { id: 'CP1', description: 'Implement sanitization in src/utils/sanitize.ts', status: 'pending' },
        { id: 'CP2', description: 'Update src/auth/handler.ts to use sanitizer', status: 'pending' },
        { id: 'CP3', description: 'Add tests for special character handling', status: 'pending' },
      ],
    });
    const result = await calculateContentQuality(task);
    expect(result.totalScore).toBeGreaterThan(50);
    expect(result.solutionScore).toBe(100);
    expect(result.relatedFilesScore).toBe(100);
  });

  test('aggregates scores with correct weighting (structural only)', async () => {
    const task = makeTask({ description: '' });
    const result = await calculateContentQuality(task);
    // With no AI, totalScore = desc*0.35 + cp*0.30 + files*0.15 + sol*0.20
    const expected = Math.round(
      result.descriptionScore * 0.35 +
      result.checkpointScore * 0.30 +
      result.relatedFilesScore * 0.15 +
      result.solutionScore * 0.20
    );
    expect(result.totalScore).toBe(expected);
  });
});

// ============== evaluateLayerOrdering ==============

describe('evaluateLayerOrdering', () => {
  test('returns 100 for fewer than 2 checkpoints', () => {
    const result = evaluateLayerOrdering(
      [{ id: 'CP1', description: 'Do something', status: 'pending' }],
      'description'
    );
    expect(result.score).toBe(100);
    expect(result.deductions).toHaveLength(0);
  });

  test('returns 100 for undefined checkpoints', () => {
    const result = evaluateLayerOrdering(undefined, 'description');
    expect(result.score).toBe(100);
  });

  test('returns 100 when fewer than 2 file paths found', () => {
    const result = evaluateLayerOrdering(
      [
        { id: 'CP1', description: 'Do something', status: 'pending' },
        { id: 'CP2', description: 'Do other thing', status: 'pending' },
      ],
      'No file paths here'
    );
    expect(result.score).toBe(100);
  });

  test('deducts when checkpoints reference files in wrong layer order', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'Update src/commands/cli.ts entry point', status: 'pending' },
      { id: 'CP2', description: 'Modify src/types/config.ts type definitions', status: 'pending' },
    ];
    const result = evaluateLayerOrdering(checkpoints, '');
    // types (Layer0) should come before commands (Layer3)
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('层级顺序异常'))).toBe(true);
  });

  test('no deduction when checkpoints follow correct layer order', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'Define types in src/types/auth.ts', status: 'pending' },
      { id: 'CP2', description: 'Implement logic in src/core/auth-handler.ts', status: 'pending' },
    ];
    const result = evaluateLayerOrdering(checkpoints, '');
    expect(result.score).toBe(100);
    expect(result.deductions).toHaveLength(0);
  });
});

// ============== evaluateRelatedFiles ==============

describe('evaluateRelatedFiles', () => {
  test('deducts when no related files found', () => {
    const result = evaluateRelatedFiles('Plain text without file references', undefined);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('缺少关联文件'))).toBe(true);
  });

  test('returns 100 when description contains file paths', () => {
    const result = evaluateRelatedFiles('Modify src/auth/handler.ts and src/utils/crypto.ts', undefined);
    expect(result.score).toBe(100);
  });

  test('returns 100 when description has related files section', () => {
    const result = evaluateRelatedFiles('## 相关文件\nSome context here', undefined);
    expect(result.score).toBe(100);
  });

  test('returns 100 when checkpoints have evidencePath', () => {
    const checkpoints: CheckpointMetadata[] = [
      {
        id: 'CP1',
        description: 'Test checkpoint',
        status: 'pending',
        verification: { evidencePath: 'src/auth/handler.ts' },
      },
    ];
    const result = evaluateRelatedFiles('No files in description', checkpoints);
    expect(result.score).toBe(100);
  });

  test('deducts 15 points for missing related files', () => {
    const result = evaluateRelatedFiles(undefined, undefined);
    expect(result.score).toBe(85);
    expect(result.deductions[0].points).toBe(-15);
  });
});
