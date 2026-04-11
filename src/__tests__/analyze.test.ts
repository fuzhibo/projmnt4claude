/**
 * analyze.ts 综合单元测试
 * 覆盖纯函数导出: evaluateDescription, evaluateCheckpoints, evaluateSolution,
 * evaluateLayerOrdering, evaluateRelatedFiles, readAnalyzeConfig, matchesIgnorePattern,
 * isValidISOTimestamp, validateHistoryEntry, validateRequirementHistoryEntry,
 * validateTaskIdFormat, isValidStatusValue, isValidTypeValue, isValidPriorityValue,
 * extractKeywordsFromCriteria, extractAcceptanceCriteriaFromDescription,
 * inferVerificationMethod, calculateHealthScore, applySchemaMigrations,
 * getPendingMigrations, extractFileRefsForLayer, calculateReopenStats
 */

import { describe, test, expect } from 'bun:test';
import {
  evaluateDescription,
  evaluateCheckpoints,
  evaluateSolution,
  evaluateLayerOrdering,
  readAnalyzeConfig,
  matchesIgnorePattern,
  isValidISOTimestamp,
  validateHistoryEntry,
  validateRequirementHistoryEntry,
  validateTaskIdFormat,
  isValidStatusValue,
  isValidTypeValue,
  isValidPriorityValue,
  extractKeywordsFromCriteria,
  extractAcceptanceCriteriaFromDescription,
  inferVerificationMethod,
  calculateHealthScore,
  applySchemaMigrations,
  getPendingMigrations,
  extractFileRefsForLayer,
  calculateReopenStats,
} from '../commands/analyze';
import type { AnalysisResult, ContentQualityScore } from '../commands/analyze';
import type { TaskMeta, CheckpointMetadata } from '../types/task';
import { evaluateRelatedFiles } from '../utils/quality-gate';

// ============== evaluateDescription ==============

describe('evaluateDescription', () => {
  test('returns 0 for empty description', () => {
    const result = evaluateDescription('');
    expect(result.score).toBe(0);
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0].reason).toContain('缺少描述');
  });

  test('returns 0 for undefined description', () => {
    const result = evaluateDescription(undefined);
    expect(result.score).toBe(0);
  });

  test('deducts for short description (< 30 chars)', () => {
    const result = evaluateDescription('修复bug');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('过短'))).toBe(true);
  });

  test('deducts for moderate description (30-49 chars) but less than short', () => {
    const shortResult = evaluateDescription('a'.repeat(20));
    const mediumResult = evaluateDescription('a'.repeat(40));
    expect(mediumResult.score).toBeGreaterThan(shortResult.score);
    expect(mediumResult.score).toBeLessThan(100);
  });

  test('deducts for long description without structured sections', () => {
    const longDesc = '这是一段很长的描述没有任何结构化段落标题也没有根因分析'.repeat(3);
    const result = evaluateDescription(longDesc);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('结构化段落') || d.reason.includes('根因'))).toBe(true);
  });

  test('returns high score for well-structured description', () => {
    const goodDesc = [
      '## 问题描述',
      '系统在特定条件下崩溃',
      '',
      '## 根因分析',
      '因为空指针导致崩溃',
      '',
      '## 解决方案',
      '添加空值检查',
    ].join('\n');
    const result = evaluateDescription(goodDesc);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });
});

// ============== evaluateCheckpoints ==============

describe('evaluateCheckpoints', () => {
  test('returns 100 for undefined checkpoints', () => {
    const result = evaluateCheckpoints(undefined);
    expect(result.score).toBe(100);
    expect(result.deductions).toHaveLength(0);
  });

  test('returns 100 for empty checkpoints', () => {
    const result = evaluateCheckpoints([]);
    expect(result.score).toBe(100);
  });

  test('deducts for generic checkpoint descriptions', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: '核心功能实现', status: 'pending' },
      { id: 'CP2', description: '测试与验证', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('泛化'))).toBe(true);
  });

  test('deducts for too few checkpoints (< 2)', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: '实现用户登录接口', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.deductions.some(d => d.reason.includes('过少'))).toBe(true);
  });

  test('returns high score for specific checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: '实现 POST /api/login 接口', status: 'pending' },
      { id: 'CP2', description: '添加 JWT token 验证中间件', status: 'pending' },
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

  test('deducts heavily when no solution section or keywords', () => {
    const result = evaluateSolution('这是一段普通的描述没有任何解决方案的内容');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.points === -25)).toBe(true);
  });

  test('deducts slightly for solution keywords without section header', () => {
    const result = evaluateSolution('我们需要实现一个新的功能来解决这个问题');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('未结构化'))).toBe(true);
  });

  test('returns 100 for description with solution section', () => {
    const desc = '## 解决方案\n使用 Redis 缓存来优化查询性能';
    const result = evaluateSolution(desc);
    expect(result.score).toBe(100);
  });
});

// ============== evaluateLayerOrdering ==============

describe('evaluateLayerOrdering', () => {
  test('returns 100 for undefined checkpoints', () => {
    const result = evaluateLayerOrdering(undefined, 'some description');
    expect(result.score).toBe(100);
    expect(result.deductions).toHaveLength(0);
  });

  test('returns 100 for single checkpoint (need >= 2)', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'Implement feature in src/utils/helper.ts', status: 'pending' },
    ];
    const result = evaluateLayerOrdering(checkpoints);
    expect(result.score).toBe(100);
  });

  test('returns 100 when text has fewer than 2 file references', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP1', description: 'First step without file paths', status: 'pending' },
      { id: 'CP2', description: 'Second step without file paths', status: 'pending' },
    ];
    const result = evaluateLayerOrdering(checkpoints, 'No file paths in this description');
    expect(result.score).toBe(100);
  });
});

// ============== evaluateRelatedFiles ==============

describe('evaluateRelatedFiles', () => {
  test('deducts when no file references found', () => {
    const result = evaluateRelatedFiles('这是一个任务描述，没有文件引用', []);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('关联文件'))).toBe(true);
  });

  test('returns 100 when description has related files section (Chinese)', () => {
    const result = evaluateRelatedFiles('## 相关文件\n- src/main.ts\n- src/app.ts', []);
    expect(result.score).toBe(100);
  });

  test('returns 100 when checkpoint has evidencePath', () => {
    const checkpoints: CheckpointMetadata[] = [
      {
        id: 'CP1',
        description: 'Verify implementation',
        status: 'pending',
        verification: { method: 'unit_test' as any, evidencePath: 'src/utils/helper.ts' },
      },
    ];
    const result = evaluateRelatedFiles('Task description', checkpoints);
    expect(result.score).toBe(100);
  });
});

// ============== readAnalyzeConfig ==============

describe('readAnalyzeConfig', () => {
  test('returns defaults for non-existent directory', () => {
    const config = readAnalyzeConfig('/tmp/nonexistent-projmnt4claude-test-dir');
    expect(config.autoGenerateCheckpoints).toBe(true);
    expect(config.checkpointGenerator).toBe('rule-based');
    expect(config.minCheckpointCoverage).toBe(0.8);
    expect(config.ignorePatterns).toEqual([]);
  });

  test('returns valid config structure for any directory', () => {
    const config = readAnalyzeConfig();
    expect(typeof config.autoGenerateCheckpoints).toBe('boolean');
    expect(['rule-based', 'ai-powered', 'hybrid']).toContain(config.checkpointGenerator);
    expect(config.minCheckpointCoverage).toBeGreaterThanOrEqual(0);
    expect(config.minCheckpointCoverage).toBeLessThanOrEqual(1);
  });
});

// ============== matchesIgnorePattern ==============

describe('matchesIgnorePattern', () => {
  test('matches exact pattern', () => {
    expect(matchesIgnorePattern('TASK-001', ['TASK-001'])).toBe(true);
  });

  test('matches wildcard pattern', () => {
    expect(matchesIgnorePattern('TASK-test-001', ['TASK-test-*'])).toBe(true);
    expect(matchesIgnorePattern('TASK-test-999', ['TASK-test-*'])).toBe(true);
  });

  test('does not match non-matching pattern', () => {
    expect(matchesIgnorePattern('TASK-001', ['TASK-test-*'])).toBe(false);
  });

  test('returns false for empty patterns', () => {
    expect(matchesIgnorePattern('TASK-001', [])).toBe(false);
  });

  test('matches first matching pattern in list', () => {
    expect(matchesIgnorePattern('TASK-prod-001', ['TASK-test-*', 'TASK-prod-*'])).toBe(true);
  });
});

// ============== isValidISOTimestamp ==============

describe('isValidISOTimestamp', () => {
  test('validates correct ISO timestamps', () => {
    expect(isValidISOTimestamp('2026-03-19T10:00:00.000Z')).toBe(true);
    expect(isValidISOTimestamp('2026-03-19T10:00:00Z')).toBe(true);
  });

  test('rejects invalid timestamps', () => {
    expect(isValidISOTimestamp('')).toBe(false);
    expect(isValidISOTimestamp('not-a-date')).toBe(false);
    expect(isValidISOTimestamp('2026-13-45T99:99:99Z')).toBe(false);
  });

  test('rejects non-string input', () => {
    expect(isValidISOTimestamp(undefined as any)).toBe(false);
    expect(isValidISOTimestamp(123 as any)).toBe(false);
  });
});

// ============== validateHistoryEntry ==============

describe('validateHistoryEntry', () => {
  test('validates correct history entry', () => {
    const result = validateHistoryEntry({
      timestamp: '2026-03-19T10:00:00.000Z',
      action: 'status_change',
    }, 0);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects null entry', () => {
    const result = validateHistoryEntry(null, 0);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('不是有效对象');
  });

  test('rejects entry missing timestamp', () => {
    const result = validateHistoryEntry({ action: 'status_change' }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('timestamp'))).toBe(true);
  });

  test('rejects entry with invalid timestamp format', () => {
    const result = validateHistoryEntry({
      timestamp: 'bad-format',
      action: 'status_change',
    }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ISO'))).toBe(true);
  });

  test('rejects entry missing action', () => {
    const result = validateHistoryEntry({
      timestamp: '2026-03-19T10:00:00.000Z',
    }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('action'))).toBe(true);
  });
});

// ============== validateRequirementHistoryEntry ==============

describe('validateRequirementHistoryEntry', () => {
  test('validates correct requirement history entry', () => {
    const result = validateRequirementHistoryEntry({
      timestamp: '2026-03-19T10:00:00.000Z',
      version: 1,
      newDescription: 'Updated description',
      changeReason: 'Clarification needed',
    }, 0);
    expect(result.valid).toBe(true);
  });

  test('rejects entry with invalid version', () => {
    const result = validateRequirementHistoryEntry({
      timestamp: '2026-03-19T10:00:00.000Z',
      version: 0,
      newDescription: 'desc',
      changeReason: 'reason',
    }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  test('rejects entry missing changeReason', () => {
    const result = validateRequirementHistoryEntry({
      timestamp: '2026-03-19T10:00:00.000Z',
      version: 1,
      newDescription: 'desc',
    }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('changeReason'))).toBe(true);
  });
});

// ============== validateTaskIdFormat ==============

describe('validateTaskIdFormat', () => {
  test('validates old format TASK-001', () => {
    const result = validateTaskIdFormat('TASK-001');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('old');
  });

  test('validates new format TASK-feature-P1-auth-20260319', () => {
    const result = validateTaskIdFormat('TASK-feature-P1-auth-20260319');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('new');
  });

  test('rejects invalid format', () => {
    const result = validateTaskIdFormat('INVALID');
    expect(result.valid).toBe(false);
    expect(result.format).toBe('unknown');
  });

  test('validates loose format TASK-anything-here', () => {
    const result = validateTaskIdFormat('TASK-custom-format-ok');
    expect(result.valid).toBe(true);
  });

  test('rejects empty string', () => {
    const result = validateTaskIdFormat('');
    expect(result.valid).toBe(false);
  });
});

// ============== isValidStatusValue / isValidTypeValue / isValidPriorityValue ==============

describe('isValidStatusValue', () => {
  test('returns true for valid statuses', () => {
    expect(isValidStatusValue('open')).toBe(true);
    expect(isValidStatusValue('in_progress')).toBe(true);
    expect(isValidStatusValue('resolved')).toBe(true);
    expect(isValidStatusValue('closed')).toBe(true);
  });

  test('returns false for invalid statuses', () => {
    expect(isValidStatusValue('pending')).toBe(false);
    expect(isValidStatusValue('unknown')).toBe(false);
  });
});

describe('isValidTypeValue', () => {
  test('returns true for valid types', () => {
    expect(isValidTypeValue('bug')).toBe(true);
    expect(isValidTypeValue('feature')).toBe(true);
    expect(isValidTypeValue('test')).toBe(true);
  });

  test('returns false for invalid types', () => {
    expect(isValidTypeValue('task')).toBe(false);
    expect(isValidTypeValue('')).toBe(false);
  });
});

describe('isValidPriorityValue', () => {
  test('returns true for valid priorities', () => {
    expect(isValidPriorityValue('P0')).toBe(true);
    expect(isValidPriorityValue('P3')).toBe(true);
    expect(isValidPriorityValue('Q1')).toBe(true);
  });

  test('returns false for invalid priorities', () => {
    expect(isValidPriorityValue('urgent')).toBe(false);
    expect(isValidPriorityValue('high')).toBe(false);
  });
});

// ============== extractKeywordsFromCriteria ==============

describe('extractKeywordsFromCriteria', () => {
  test('extracts English keywords', () => {
    const keywords = extractKeywordsFromCriteria('Implement user login authentication');
    // 'implement' is a stop word; verify non-stop words are extracted
    expect(keywords).toContain('user');
    expect(keywords).toContain('login');
    expect(keywords).toContain('authentication');
  });

  test('extracts Chinese keywords', () => {
    const keywords = extractKeywordsFromCriteria('实现用户登录功能并验证权限');
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords.some(k => k.includes('用户') || k.includes('登录') || k.includes('权限'))).toBe(true);
  });

  test('filters out stop words', () => {
    const keywords = extractKeywordsFromCriteria('the is a an to of in');
    expect(keywords).toHaveLength(0);
  });

  test('returns empty for empty input', () => {
    const keywords = extractKeywordsFromCriteria('');
    expect(keywords).toHaveLength(0);
  });
});

// ============== extractAcceptanceCriteriaFromDescription ==============

describe('extractAcceptanceCriteriaFromDescription', () => {
  test('extracts dash-list items', () => {
    const desc = '- First criterion\n- Second criterion\n- Third criterion';
    const criteria = extractAcceptanceCriteriaFromDescription(desc);
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe('First criterion');
  });

  test('extracts numbered list items', () => {
    const desc = '1. First item\n2. Second item\n3. Third item';
    const criteria = extractAcceptanceCriteriaFromDescription(desc);
    expect(criteria).toHaveLength(3);
  });

  test('extracts checkbox items', () => {
    const desc = '- [x] Completed item\n- [ ] Pending item';
    const criteria = extractAcceptanceCriteriaFromDescription(desc);
    expect(criteria).toHaveLength(2);
  });

  test('returns full text when no list format found', () => {
    const desc = 'Just a plain description without lists';
    const criteria = extractAcceptanceCriteriaFromDescription(desc);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toBe(desc);
  });
});

// ============== inferVerificationMethod ==============

describe('inferVerificationMethod', () => {
  test('returns unit_test for test-related criteria', () => {
    expect(inferVerificationMethod('编写单元测试验证功能')).toBe('unit_test');
    expect(inferVerificationMethod('run integration test')).toBe('unit_test');
  });

  test('returns code_review for review-related criteria', () => {
    expect(inferVerificationMethod('代码审查通过')).toBe('code_review');
    expect(inferVerificationMethod('Review the implementation')).toBe('code_review');
  });

  test('returns functional_test for API-related criteria', () => {
    expect(inferVerificationMethod('API 接口功能验证')).toBe('functional_test');
  });

  test('returns e2e_test for UI-related criteria', () => {
    expect(inferVerificationMethod('UI 界面显示正确')).toBe('e2e_test');
  });

  test('returns automated for document-related criteria', () => {
    expect(inferVerificationMethod('文档已更新')).toBe('automated');
  });

  test('returns automated as default', () => {
    expect(inferVerificationMethod('其他普通描述')).toBe('automated');
  });
});

// ============== calculateHealthScore ==============

describe('calculateHealthScore', () => {
  function makeResult(overrides: Partial<AnalysisResult['stats']> = {}): AnalysisResult {
    return {
      issues: [],
      stats: {
        total: 10,
        parentTasks: 10,
        subtasks: 0,
        subtaskCompletionRate: 0,
        byStatus: { open: 5, in_progress: 2, wait_review: 0, wait_qa: 0, wait_complete: 0, resolved: 3, closed: 0, abandoned: 0, failed: 0 },
        byPriority: { P0: 0, P1: 2, P2: 5, P3: 3, Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
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
    };
  }

  test('returns 100 for zero tasks', () => {
    const result = makeResult({ total: 0 });
    expect(calculateHealthScore(result)).toBe(100);
  });

  test('returns 100 for healthy project', () => {
    expect(calculateHealthScore(makeResult())).toBe(100);
  });

  test('deducts for stale tasks', () => {
    const result = makeResult({ stale: 4 });
    expect(calculateHealthScore(result)).toBe(80); // 100 - 4*5
  });

  test('deducts for blocked tasks', () => {
    const result = makeResult({ blocked: 5 });
    expect(calculateHealthScore(result)).toBe(85); // 100 - 5*3
  });

  test('deducts heavily for cycle dependencies', () => {
    const result = makeResult({ cycle: 2 });
    expect(calculateHealthScore(result)).toBe(70); // 100 - 2*15
  });

  test('score never goes below 0', () => {
    const result = makeResult({ stale: 50, blocked: 50, cycle: 50 });
    expect(calculateHealthScore(result)).toBe(0);
  });
});

// ============== applySchemaMigrations / getPendingMigrations ==============

describe('applySchemaMigrations', () => {
  test('returns no changes for up-to-date schema', () => {
    const task = { schemaVersion: 999 } as TaskMeta;
    const result = applySchemaMigrations(task);
    expect(result.changed).toBe(false);
    expect(result.details).toHaveLength(0);
  });

  test('applies v1 migration: adds reopenCount and requirementHistory', () => {
    const task = { schemaVersion: 0 } as TaskMeta;
    const result = applySchemaMigrations(task);
    expect(task.reopenCount).toBe(0);
    expect(task.requirementHistory).toEqual([]);
    expect(result.details.some(d => d.includes('reopenCount'))).toBe(true);
  });
});

describe('getPendingMigrations', () => {
  test('returns migrations for version 0', () => {
    const migrations = getPendingMigrations(0);
    expect(migrations.length).toBeGreaterThan(0);
  });

  test('returns no migrations for high version', () => {
    const migrations = getPendingMigrations(999);
    expect(migrations).toHaveLength(0);
  });
});

// ============== extractFileRefsForLayer ==============

describe('extractFileRefsForLayer', () => {
  test('extracts src/ file references', () => {
    const files = extractFileRefsForLayer('Implement in src/utils/helper.ts and src/types/task.ts');
    expect(files).toContain('src/utils/helper.ts');
    expect(files).toContain('src/types/task.ts');
  });

  test('extracts relative path references', () => {
    const files = extractFileRefsForLayer('See ./config/settings.json for details');
    expect(files).toContain('./config/settings.json');
  });

  test('returns empty for no file references', () => {
    const files = extractFileRefsForLayer('No file paths in this text');
    expect(files).toHaveLength(0);
  });

  test('deduplicates file references', () => {
    const files = extractFileRefsForLayer('src/main.ts and src/main.ts again');
    expect(files.filter(f => f === 'src/main.ts')).toHaveLength(1);
  });
});

// ============== calculateReopenStats ==============

describe('calculateReopenStats', () => {
  test('returns zero stats for tasks with no reopens', () => {
    const tasks = [
      { id: 'T1', title: 'Task 1', reopenCount: 0, history: [] } as unknown as TaskMeta,
    ];
    const stats = calculateReopenStats(tasks);
    expect(stats.reopenCount).toBe(0);
    expect(stats.topReopened).toHaveLength(0);
  });

  test('counts tasks with reopenCount > 0', () => {
    const tasks = [
      { id: 'T1', title: 'Task 1', reopenCount: 2, history: [] } as unknown as TaskMeta,
      { id: 'T2', title: 'Task 2', reopenCount: 1, history: [] } as unknown as TaskMeta,
    ];
    const stats = calculateReopenStats(tasks);
    expect(stats.reopenCount).toBe(2);
    expect(stats.topReopened).toHaveLength(2);
    // Sorted by count descending
    expect(stats.topReopened[0].count).toBe(2);
  });

  test('falls back to history when reopenCount is missing', () => {
    const tasks = [
      {
        id: 'T1',
        title: 'Task 1',
        reopenCount: undefined,
        history: [
          { action: 'status_change', newValue: 'reopened' },
          { action: 'status_change', newValue: 'reopened' },
        ],
      } as unknown as TaskMeta,
    ];
    const stats = calculateReopenStats(tasks);
    expect(stats.topReopened).toHaveLength(1);
    expect(stats.topReopened[0].count).toBe(2);
  });
});
