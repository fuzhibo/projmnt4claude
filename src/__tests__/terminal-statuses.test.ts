/**
 * TERMINAL_STATUSES 测试
 *
 * 验证终端状态常量的定义和使用
 */

import { describe, it, expect } from '@jest/globals';
import {
  TERMINAL_STATUSES,
  normalizeStatus,
  DEPENDENCY_SATISFIED_STATUSES,
  isDependencySatisfied,
  type TaskStatus,
  type TaskMeta,
} from '../types/task.js';

describe('TERMINAL_STATUSES', () => {
  it('should contain exactly 4 terminal statuses', () => {
    expect(TERMINAL_STATUSES).toHaveLength(4);
    expect(TERMINAL_STATUSES).toEqual(['resolved', 'closed', 'abandoned', 'failed']);
  });

  it('should include resolved as terminal status', () => {
    expect(TERMINAL_STATUSES).toContain('resolved');
  });

  it('should include closed as terminal status', () => {
    expect(TERMINAL_STATUSES).toContain('closed');
  });

  it('should include abandoned as terminal status', () => {
    expect(TERMINAL_STATUSES).toContain('abandoned');
  });

  it('should include failed as terminal status', () => {
    expect(TERMINAL_STATUSES).toContain('failed');
  });

  it('should not include non-terminal statuses', () => {
    const nonTerminalStatuses: TaskStatus[] = [
      'open',
      'in_progress',
      'wait_review',
      'wait_qa',
      'wait_evaluation',
      'needs_human',
    ];
    for (const status of nonTerminalStatuses) {
      expect(TERMINAL_STATUSES).not.toContain(status);
    }
  });
});

describe('TERMINAL_STATUSES usage with normalizeStatus', () => {
  it('should identify resolved as terminal', () => {
    const normalized = normalizeStatus('resolved');
    expect(TERMINAL_STATUSES).toContain(normalized);
  });

  it('should identify closed as terminal', () => {
    const normalized = normalizeStatus('closed');
    expect(TERMINAL_STATUSES).toContain(normalized);
  });

  it('should identify abandoned as terminal', () => {
    const normalized = normalizeStatus('abandoned');
    expect(TERMINAL_STATUSES).toContain(normalized);
  });

  it('should identify failed as terminal', () => {
    const normalized = normalizeStatus('failed');
    expect(TERMINAL_STATUSES).toContain(normalized);
  });

  it('should not identify open as terminal', () => {
    const normalized = normalizeStatus('open');
    expect(TERMINAL_STATUSES).not.toContain(normalized);
  });

  it('should not identify in_progress as terminal', () => {
    const normalized = normalizeStatus('in_progress');
    expect(TERMINAL_STATUSES).not.toContain(normalized);
  });
});

describe('DEPENDENCY_SATISFIED_STATUSES', () => {
  it('should contain exactly 3 satisfied statuses', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).toHaveLength(3);
    expect(DEPENDENCY_SATISFIED_STATUSES).toEqual(['resolved', 'completed', 'closed']);
  });

  it('should include resolved as satisfied status', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).toContain('resolved');
  });

  it('should include completed as satisfied status (backward compatibility)', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).toContain('completed');
  });

  it('should include closed as satisfied status', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).toContain('closed');
  });

  it('should not include failed as satisfied status', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).not.toContain('failed');
  });

  it('should not include open as satisfied status', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).not.toContain('open');
  });
});

describe('isDependencySatisfied', () => {
  const createMockTask = (
    status: TaskStatus,
    checkpoints?: Array<{ status: string }>
  ): TaskMeta => ({
    id: 'TASK-test',
    title: 'Test Task',
    type: 'feature',
    priority: 'P2',
    status,
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    checkpoints: checkpoints as any,
  });

  describe('Rule 1: Task must exist', () => {
    it('should return false when task is null', () => {
      expect(isDependencySatisfied(null)).toBe(false);
    });

    it('should return false when task is undefined', () => {
      expect(isDependencySatisfied(undefined)).toBe(false);
    });
  });

  describe('Rule 2: Task status must be in satisfied statuses', () => {
    it('should return true for resolved status', () => {
      const task = createMockTask('resolved');
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return true for completed status (backward compatibility)', () => {
      const task = createMockTask('completed');
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return true for closed status', () => {
      const task = createMockTask('closed');
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return false for open status', () => {
      const task = createMockTask('open');
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false for in_progress status', () => {
      const task = createMockTask('in_progress');
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false for failed status', () => {
      const task = createMockTask('failed');
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false for abandoned status', () => {
      const task = createMockTask('abandoned');
      expect(isDependencySatisfied(task)).toBe(false);
    });
  });

  describe('Rule 3: All checkpoints must be completed', () => {
    it('should return true when no checkpoints exist', () => {
      const task = createMockTask('resolved', []);
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return true when all checkpoints are completed', () => {
      const task = createMockTask('resolved', [
        { status: 'completed' },
        { status: 'completed' },
      ]);
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return true when all checkpoints are completed or skipped', () => {
      const task = createMockTask('resolved', [
        { status: 'completed' },
        { status: 'skipped' },
      ]);
      expect(isDependencySatisfied(task)).toBe(true);
    });

    it('should return false when some checkpoints are pending', () => {
      const task = createMockTask('resolved', [
        { status: 'completed' },
        { status: 'pending' },
      ]);
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false when some checkpoints are failed', () => {
      const task = createMockTask('resolved', [
        { status: 'completed' },
        { status: 'failed' },
      ]);
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false when all checkpoints are pending', () => {
      const task = createMockTask('resolved', [
        { status: 'pending' },
        { status: 'pending' },
      ]);
      expect(isDependencySatisfied(task)).toBe(false);
    });
  });

  describe('Combined rules', () => {
    it('should return false when status is satisfied but checkpoints incomplete', () => {
      const task = createMockTask('resolved', [
        { status: 'pending' },
      ]);
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return false when status is not satisfied even if checkpoints complete', () => {
      const task = createMockTask('in_progress', [
        { status: 'completed' },
      ]);
      expect(isDependencySatisfied(task)).toBe(false);
    });

    it('should return true only when all rules pass', () => {
      const task = createMockTask('resolved', [
        { status: 'completed' },
        { status: 'skipped' },
      ]);
      expect(isDependencySatisfied(task)).toBe(true);
    });
  });
});
