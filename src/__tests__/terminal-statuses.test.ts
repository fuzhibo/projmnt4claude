/**
 * TERMINAL_STATUSES 测试
 *
 * 验证终端状态常量的定义和使用
 */

import { describe, it, expect } from 'bun:test';
import {
  TERMINAL_STATUSES,
  normalizeStatus,
  type TaskStatus,
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
