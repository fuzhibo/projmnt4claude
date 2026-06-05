/**
 * conversion-status 状态管理单元测试
 *
 * 覆盖检查点 §3.4 和 §3.5：
 * - 3.4 状态机：pending→completed、pending→failed、failed→completed 路径正确
 * - 3.5 恢复：conversion-status.json 读写、断点续转
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  loadConversionStatus,
  createEmptyConversionStatus,
  updateConversionStatus,
  getPendingReports,
  topologicalSort,
} from '../conversion-status.js';
import type { ConversionStatus } from '../types.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `conv-status-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// §3.4 状态机测试
// ============================================================

describe('State Machine (§3.4)', () => {
  test('pending → completed', () => {
    updateConversionStatus(tempDir, 'report.md', 'pending');
    updateConversionStatus(tempDir, 'report.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('completed');
  });

  test('pending → failed', () => {
    updateConversionStatus(tempDir, 'report.md', 'pending');
    updateConversionStatus(tempDir, 'report.md', 'failed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('failed');
  });

  test('failed → completed (user fixes report and reruns)', () => {
    updateConversionStatus(tempDir, 'report.md', 'failed');
    updateConversionStatus(tempDir, 'report.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('completed');
  });

  test('multiple reports with independent states', () => {
    updateConversionStatus(tempDir, 'r1.md', 'completed');
    updateConversionStatus(tempDir, 'r2.md', 'pending');
    updateConversionStatus(tempDir, 'r3.md', 'failed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['r1.md']).toBe('completed');
    expect(status.reports['r2.md']).toBe('pending');
    expect(status.reports['r3.md']).toBe('failed');
  });
});

// ============================================================
// §3.5 恢复（读写 + 断点续转）测试
// ============================================================

describe('Conversion Status Read/Write (§3.5)', () => {
  test('loadConversionStatus returns empty status when file does not exist', () => {
    const status = loadConversionStatus(tempDir);
    expect(status.reports).toEqual({});
    expect(status.tasks).toEqual({});
    expect(status.lastRunAt).toBeDefined();
  });

  test('createEmptyConversionStatus creates valid empty status', () => {
    const status = createEmptyConversionStatus();
    expect(status.reports).toEqual({});
    expect(status.tasks).toEqual({});
    expect(status.lastRunAt).toBeDefined();
  });

  test('updateConversionStatus persists to disk', () => {
    updateConversionStatus(tempDir, 'report-01.md', 'pending');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report-01.md']).toBe('pending');
  });

  test('updateConversionStatus with detail records taskId', () => {
    updateConversionStatus(tempDir, 'report-01.md', 'completed', {
      taskId: 'TASK-feature-P1-test-20260527',
    });
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report-01.md']).toBe('completed');
    expect(status.tasks['report-01.md'].taskId).toBe('TASK-feature-P1-test-20260527');
  });

  test('updateConversionStatus records lastError on failure', () => {
    updateConversionStatus(tempDir, 'report-01.md', 'failed', {
      lastError: 'Quality gate failed: score=45',
      lastAttemptAt: '2026-05-27T10:00:00Z',
    });
    const status = loadConversionStatus(tempDir);
    expect(status.tasks['report-01.md'].lastError).toBe('Quality gate failed: score=45');
    expect(status.tasks['report-01.md'].lastAttemptAt).toBe('2026-05-27T10:00:00Z');
  });

  test('断点续转: getPendingReports filters completed, keeps pending + failed', () => {
    updateConversionStatus(tempDir, 'report-01.md', 'completed');
    updateConversionStatus(tempDir, 'report-02.md', 'pending');
    updateConversionStatus(tempDir, 'report-03.md', 'failed');

    const status = loadConversionStatus(tempDir);
    const pending = getPendingReports(status);

    expect(pending).toContain('report-02.md');
    expect(pending).toContain('report-03.md');
    expect(pending).not.toContain('report-01.md');
  });

  test('断点续转: reload preserves existing state', () => {
    updateConversionStatus(tempDir, 'r1.md', 'completed', { taskId: 'TASK-001' });
    updateConversionStatus(tempDir, 'r2.md', 'failed', { lastError: 'gate fail' });

    // Reload from disk
    const status = loadConversionStatus(tempDir);
    expect(status.reports['r1.md']).toBe('completed');
    expect(status.reports['r2.md']).toBe('failed');
    expect(status.tasks['r1.md'].taskId).toBe('TASK-001');
    expect(status.tasks['r2.md'].lastError).toBe('gate fail');
  });

  test('detail fields merge with existing task data', () => {
    updateConversionStatus(tempDir, 'r1.md', 'pending', { taskId: 'TASK-001' });
    updateConversionStatus(tempDir, 'r1.md', 'failed', { lastError: 'gate fail' });
    const status = loadConversionStatus(tempDir);
    expect(status.tasks['r1.md'].taskId).toBe('TASK-001');
    expect(status.tasks['r1.md'].lastError).toBe('gate fail');
  });
});

// ============================================================
// 拓扑排序测试
// ============================================================

describe('topologicalSort', () => {
  test('sorts reports by dependsOn correctly (B before A)', () => {
    const reportDir = join(tempDir, 'sub');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(join(reportDir, 'report-01'), { recursive: true });
    mkdirSync(join(reportDir, 'report-02'), { recursive: true });

    writeFileSync(
      join(reportDir, 'report-01', 'meta.json'),
      JSON.stringify({ dependsOn: ['sub/report-02.md'] }),
    );
    writeFileSync(
      join(reportDir, 'report-02', 'meta.json'),
      JSON.stringify({ dependsOn: [] }),
    );

    const status: ConversionStatus = {
      reports: { 'sub/report-01.md': 'pending', 'sub/report-02.md': 'pending' },
      tasks: { 'sub/report-01.md': {}, 'sub/report-02.md': {} },
      lastRunAt: new Date().toISOString(),
    };

    const sorted = topologicalSort(['sub/report-01.md', 'sub/report-02.md'], status, tempDir);
    expect(sorted[0]).toBe('sub/report-02.md');
    expect(sorted[1]).toBe('sub/report-01.md');
  });

  test('throws on circular dependency', () => {
    const reportDir = join(tempDir, 'sub');
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(join(reportDir, 'report-A'), { recursive: true });
    mkdirSync(join(reportDir, 'report-B'), { recursive: true });

    writeFileSync(
      join(reportDir, 'report-A', 'meta.json'),
      JSON.stringify({ dependsOn: ['sub/report-B.md'] }),
    );
    writeFileSync(
      join(reportDir, 'report-B', 'meta.json'),
      JSON.stringify({ dependsOn: ['sub/report-A.md'] }),
    );

    const status: ConversionStatus = {
      reports: { 'sub/report-A.md': 'pending', 'sub/report-B.md': 'pending' },
      tasks: { 'sub/report-A.md': {}, 'sub/report-B.md': {} },
      lastRunAt: new Date().toISOString(),
    };

    expect(() =>
      topologicalSort(['sub/report-A.md', 'sub/report-B.md'], status, tempDir)
    ).toThrow('循环依赖');
  });

  test('no dependencies returns same order', () => {
    const status: ConversionStatus = {
      reports: { 'r1.md': 'pending', 'r2.md': 'pending' },
      tasks: { 'r1.md': {}, 'r2.md': {} },
      lastRunAt: new Date().toISOString(),
    };

    const sorted = topologicalSort(['r1.md', 'r2.md'], status, tempDir);
    expect(sorted).toEqual(['r1.md', 'r2.md']);
  });
});
