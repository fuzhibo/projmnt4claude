/**
 * init-requirement 基础架构单元测试
 *
 * 验证检查点覆盖清单 §3:
 * - 3.1 PREFIX_MAP: 5 种前缀映射正确
 * - 3.2 检查点解析: 前缀提取、无前缀报错
 * - 3.3 verification.commands 生成
 * - 3.4 状态机: pending→completed、pending→failed、failed→completed
 * - 3.5 恢复: conversion-status.json 读写
 * - 3.6 gateCheckAndFix: 门禁失败→AI修正→对齐→重试闭环
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  hasValidPrefix,
  type CheckpointPrefix,
  type ParsedCheckpoint,
} from '../prefix-map.js';
import {
  detectProjectConfig,
  mapSourceToTestFile,
  generateVerificationCommands,
  type ProjectConfig,
} from '../verification-commands.js';
import {
  loadConversionStatus,
  createEmptyConversionStatus,
  updateConversionStatus,
  getPendingReports,
  topologicalSort,
} from '../conversion-status.js';
import type { ConversionStatus, ConversionState, GateDependencies, GateFixResult } from '../types.js';
import { gateCheckAndFix } from '../gate-check-fix.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../test-env.js';

// ============================================================
// 测试数据与临时目录
// ============================================================

let env: IsolatedTestEnv;
let tempDir: string;

beforeEach(async () => {
  env = await createIsolatedTestEnv({ prefix: 'init-req-test-' });
  tempDir = env.tempDir;
});

afterEach(() => {
  env.cleanup();
  jest.restoreAllMocks();
});

// ============================================================
// 3.1 PREFIX_MAP 测试
// ============================================================

describe('PREFIX_MAP (§3.1)', () => {
  test('contains only 4 System B prefixes (System A deprecated)', () => {
    expect(VALID_PREFIXES).toEqual(expect.arrayContaining([
      'ai-review', 'ai-qa', 'human-qa', 'script',
    ]));
    expect(Object.keys(PREFIX_MAP).length).toBe(4);
  });

  test('ai-qa prefix maps to qa_verification/automated', () => {
    expect(PREFIX_MAP['ai-qa']).toEqual({
      category: 'qa_verification',
      method: 'automated',
      requiresHuman: false,
    });
  });

  test('ai-review prefix maps to code_review/code_review', () => {
    expect(PREFIX_MAP['ai-review']).toEqual({
      category: 'code_review',
      method: 'code_review',
      requiresHuman: false,
    });
  });

  test('human-qa prefix maps to qa_verification/automated with requiresHuman=true', () => {
    expect(PREFIX_MAP['human-qa']).toEqual({
      category: 'qa_verification',
      method: 'automated',
      requiresHuman: true,
    });
  });

  test('script prefix maps to evaluation/automated', () => {
    expect(PREFIX_MAP.script).toEqual({
      category: 'evaluation',
      method: 'automated',
      requiresHuman: false,
    });
  });
});

// ============================================================
// 3.2 检查点解析测试
// ============================================================

describe('parseCheckpoint (§3.2)', () => {
  // System B 标准前缀解析测试
  test('parses [ai review] prefix correctly (case-insensitive)', () => {
    const result = parseCheckpoint('[ai review] 验证JWT token有效性');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
    expect(result!.description).toBe('验证JWT token有效性');
    expect(result!.category).toBe('code_review');
    expect(result!.verificationMethod).toBe('code_review');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [ai qa] prefix correctly', () => {
    const result = parseCheckpoint('[ai qa] 测试认证流程');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('测试认证流程');
    expect(result!.category).toBe('qa_verification');
    expect(result!.verificationMethod).toBe('automated');
    expect(result!.requiresHuman).toBe(false);
  });

  test('parses [human qa] prefix correctly', () => {
    const result = parseCheckpoint('[human qa] 审核安全实现');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('human-qa');
    expect(result!.requiresHuman).toBe(true);
    expect(result!.category).toBe('qa_verification');
  });

  test('parses [script] prefix correctly', () => {
    const result = parseCheckpoint('[script] 实现密码哈希');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('script');
    expect(result!.category).toBe('evaluation');
    expect(result!.verificationMethod).toBe('automated');
  });

  // System A 废弃前缀迁移测试
  test('migrates [verify] to [ai qa] with warning', () => {
    const result = parseCheckpoint('[verify] 验证功能');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] 验证功能');
    expect(result!.warnings).toContain('前缀 "[verify]" 已废弃，已自动迁移为 "[ai qa] 验证功能"');
  });

  test('migrates [test] to [ai qa] with warning', () => {
    const result = parseCheckpoint('[test] 测试功能');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] 测试功能');
    expect(result!.warnings.length).toBeGreaterThan(0);
  });

  test('migrates [review] to [ai review] with warning', () => {
    const result = parseCheckpoint('[review] 代码审核');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-review');
    expect(result!.description).toBe('[ai review] 代码审核');
    expect(result!.warnings.length).toBeGreaterThan(0);
  });

  test('migrates [implem] to [ai qa] with implementation note', () => {
    const result = parseCheckpoint('[implem] 实现功能');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('ai-qa');
    expect(result!.description).toBe('[ai qa] (implementation) 实现功能');
    expect(result!.warnings.length).toBeGreaterThan(0);
  });

  test('migrates [doc] to [script] with doc note', () => {
    const result = parseCheckpoint('[doc] 更新文档');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('script');
    expect(result!.description).toBe('[script] (doc) 更新文档');
    expect(result!.warnings.length).toBeGreaterThan(0);
  });

  // 边界测试
  test('returns null for invalid prefix', () => {
    expect(parseCheckpoint('[invalid] test')).toBeNull();
  });

  test('returns null for missing prefix', () => {
    expect(parseCheckpoint('plain text without prefix')).toBeNull();
  });

  test('returns null for malformed prefix', () => {
    expect(parseCheckpoint('verify] missing bracket')).toBeNull();
    expect(parseCheckpoint('[verify missing closing bracket')).toBeNull();
  });

  test('hasValidPrefix detects System B prefix', () => {
    expect(hasValidPrefix('[ai review] test')).toBe(true);
    expect(hasValidPrefix('[ai qa] test')).toBe(true);
    expect(hasValidPrefix('[human qa] test')).toBe(true);
    expect(hasValidPrefix('[script] test')).toBe(true);
    expect(hasValidPrefix('no prefix')).toBe(false);
  });

  test('hasValidPrefix rejects System A deprecated prefix', () => {
    expect(hasValidPrefix('[verify] test')).toBe(false);
    expect(hasValidPrefix('[test] test')).toBe(false);
    expect(hasValidPrefix('[review] test')).toBe(false);
  });
});

// ============================================================
// 3.3 验证命令生成测试
// ============================================================

describe('generateVerificationCommands (§3.3)', () => {
  test('ai-qa prefix with existing test files generates npm test command', () => {
    const checkpoint: ParsedCheckpoint = {
      prefix: 'ai-qa',
      description: '测试认证',
      category: 'qa_verification',
      verificationMethod: 'automated',
      requiresHuman: false,
    };

    const taskFiles = ['src/auth.ts'];
    const config: ProjectConfig = {
      type: 'node',
      testCommand: 'npm test',
      testFilePattern: '**/__tests__/*.test.ts',
    };

    const commands = generateVerificationCommands(checkpoint, taskFiles, config);
    expect(commands.length).toBe(1);
    expect(commands[0]).toContain('npm test');
  });

  test('ai-qa prefix without test files generates pattern command', () => {
    const checkpoint: ParsedCheckpoint = {
      prefix: 'ai-qa',
      description: '测试认证流程',
      category: 'qa_verification',
      verificationMethod: 'automated',
      requiresHuman: false,
    };

    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual(['npm test --testNamePattern="测试认证流程"']);
  });

  test('ai-review prefix generates git diff', () => {
    const checkpoint: ParsedCheckpoint = {
      prefix: 'ai-review',
      description: '代码审核',
      category: 'code_review',
      verificationMethod: 'code_review',
      requiresHuman: false,
    };

    const taskFiles = ['src/auth.ts', 'src/middleware.ts'];
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, taskFiles, config);
    expect(commands).toEqual(['git diff HEAD -- src/auth.ts src/middleware.ts']);
  });

  test('human-qa prefix generates build and test', () => {
    const checkpoint: ParsedCheckpoint = {
      prefix: 'human-qa',
      description: '人工验证',
      category: 'qa_verification',
      verificationMethod: 'automated',
      requiresHuman: true,
    };

    const config: ProjectConfig = {
      type: 'node',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
    };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual(['npm run build', 'npm test']);
  });

  test('script prefix generates build', () => {
    const checkpoint: ParsedCheckpoint = {
      prefix: 'script',
      description: '脚本验证',
      category: 'evaluation',
      verificationMethod: 'automated',
      requiresHuman: false,
    };

    const config: ProjectConfig = { type: 'node', buildCommand: 'npm run build' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual(['npm run build']);
  });
});

// ============================================================
// 3.4/3.5 转换状态管理测试
// ============================================================

describe('conversion-status (§3.4, §3.5)', () => {
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

  test('updateConversionStatus updates reports and tasks fields', () => {
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
  });

  test('state machine: pending → completed', () => {
    updateConversionStatus(tempDir, 'report.md', 'pending');
    updateConversionStatus(tempDir, 'report.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('completed');
  });

  test('state machine: pending → failed', () => {
    updateConversionStatus(tempDir, 'report.md', 'pending');
    updateConversionStatus(tempDir, 'report.md', 'failed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('failed');
  });

  test('state machine: failed → completed (user fixes report)', () => {
    updateConversionStatus(tempDir, 'report.md', 'failed');
    updateConversionStatus(tempDir, 'report.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('completed');
  });

  test('getPendingReports filters completed, keeps pending and failed', () => {
    updateConversionStatus(tempDir, 'report-01.md', 'completed');
    updateConversionStatus(tempDir, 'report-02.md', 'pending');
    updateConversionStatus(tempDir, 'report-03.md', 'failed');

    const status = loadConversionStatus(tempDir);
    const pending = getPendingReports(status);

    expect(pending).toContain('report-02.md');
    expect(pending).toContain('report-03.md');
    expect(pending).not.toContain('report-01.md');
  });
});

// ============================================================
// 3.6 gateCheckAndFix 测试
// ============================================================

describe('gateCheckAndFix (§3.6)', () => {
  test('gate pass + alignment pass returns { passed: true }', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'All checks passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
      },
      mockDeps,
    );

    expect(result.passed).toBe(true);
    expect(result.taskId).toBe('TASK-001');
  });

  test('gate fail triggers AI fix loop', async () => {
    let fixCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: false,
        summary: 'Gate failed',
        ruleResults: [{ ruleId: 'R-001', passed: false, message: 'Missing checkpoints' }],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 70 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => {
        fixCalled = true;
        return { output: '{"checkpoints":[]}', success: true, durationMs: 100 };
      }),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 2,
      },
      mockDeps,
    );

    // Gate fails, AI fix is called, then alignment passes → task should pass
    expect(fixCalled).toBe(true);
    expect(result.passed).toBe(true);  // AI fix succeeded, alignment passed
  });

  test('maxRetry reached triggers cleanup and archive', async () => {
    let archiveCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: false,
        summary: 'Always fails',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false,
        score: { totalScore: 40 },
        suggestions: ['Fix checkpoints'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'not aligned' },
          solutionAlignment: { passed: false, detail: 'not aligned' },
          checkpointAlignment: { passed: false, detail: 'not aligned' },
        },
        issues: ['Checkpoint mismatch'],
      })),
      moveTaskToArchive: jest.fn(() => { archiveCalled = true; }),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
    expect(archiveCalled).toBe(true);
  });

  test('alignment fail injects issues and retry', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: false, detail: 'solution mismatch' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Solution does not match root cause'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    // alignment fail → inject issues → writeMeta called
    expect(writeMetaCalled).toBe(true);
    // maxRetry=1, alignment fails, should be cleaned up
    expect(result.passed).toBe(false);
  });
});

// ============================================================
// 3.7 对齐验证三层次测试
// ============================================================

describe('Alignment Verification Three Levels (§3.7)', () => {
  test('rootCauseAlignment failure triggers re-fix', async () => {
    let writeMetaCalled = false;
    let fixCallCount = 0;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => {
        fixCallCount++;
        return { output: '{}', success: true, durationMs: 100 };
      }),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'Root cause mismatch: task missing CA-001' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Root cause mismatch: task missing CA-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    // rootCause fail → inject issues → writeMeta called
    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('solutionAlignment failure triggers re-fix', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: false, detail: 'Solution SOL-001 not linked to CA-001' },
          checkpointAlignment: { passed: true, detail: 'ok' },
        },
        issues: ['Solution SOL-001 not linked to CA-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    expect(result.passed).toBe(false);
  });

  test('checkpointAlignment failure triggers re-fix', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'ok' },
          solutionAlignment: { passed: true, detail: 'ok' },
          checkpointAlignment: { passed: false, detail: 'Missing checkpoint for SOL-001' },
        },
        issues: ['Missing checkpoint for SOL-001'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    expect(result.passed).toBe(false);
  });

  test('all three levels pass returns aligned: true', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: true,
        summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: true,
        score: { totalScore: 80 },
        suggestions: [],
      })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: true,
        checks: {
          rootCauseAlignment: { passed: true, detail: 'Task CA matches report CA-001' },
          solutionAlignment: { passed: true, detail: 'Task SOL matches report SOL-001' },
          checkpointAlignment: { passed: true, detail: 'All checkpoints present' },
        },
        issues: [],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
      },
      mockDeps,
    );

    expect(result.passed).toBe(true);
  });
});

// ============================================================
// 3.8 归档清理测试
// ============================================================

describe('Archive Cleanup (§3.8)', () => {
  test('failed task is moved to archive directory', async () => {
    // Create actual task directory structure
    const taskDir = join(tempDir, '.projmnt4claude', 'tasks', 'TASK-001');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'meta.json'), JSON.stringify({ id: 'TASK-001', status: 'pending' }));

    let archiveDest: string | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: false,
        summary: 'Always fails',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false,
        score: { totalScore: 40 },
        suggestions: ['Fix checkpoints'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', status: 'pending' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'fail' },
          solutionAlignment: { passed: false, detail: 'fail' },
          checkpointAlignment: { passed: false, detail: 'fail' },
        },
        issues: ['All failed'],
      })),
      moveTaskToArchive: jest.fn((taskId: string, cwd: string) => {
        const src = join(cwd, '.projmnt4claude', 'tasks', taskId);
        const dest = join(cwd, '.projmnt4claude', 'archive', taskId);
        const archiveRoot = join(cwd, '.projmnt4claude', 'archive');
        mkdirSync(archiveRoot, { recursive: true });
        mkdirSync(dest, { recursive: true }); // Create task-specific archive dir
        if (existsSync(src)) {
          // Simulate move: copy then delete
          const meta = join(src, 'meta.json');
          if (existsSync(meta)) {
            writeFileSync(join(dest, 'meta.json'), JSON.stringify({ id: taskId, status: 'failed' }));
            rmSync(src, { recursive: true, force: true });
          }
        }
        archiveDest = dest;
      }),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
    expect(archiveDest).not.toBeNull();
    // Verify task moved to archive
    expect(existsSync(join(tempDir, '.projmnt4claude', 'archive', 'TASK-001', 'meta.json'))).toBe(true);
    expect(existsSync(join(tempDir, '.projmnt4claude', 'tasks', 'TASK-001'))).toBe(false);
  });

  test('conversion-status records lastError and lastAttemptAt on failure', async () => {
    let recordedError: string | null = null;
    let recordedTime: string | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001',
        passed: false,
        summary: 'Gate failed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [],
        duration: 100,
        timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({
        passed: false,
        score: { totalScore: 40 },
        suggestions: ['Fix'],
      })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'fail' },
          solutionAlignment: { passed: false, detail: 'fail' },
          checkpointAlignment: { passed: false, detail: 'fail' },
        },
        issues: ['All failed'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn((
        _investigationDir: string,
        _reportPath: string,
        _state: ConversionState,
        detail?: { lastError?: string; lastAttemptAt?: string },
      ) => {
        recordedError = detail?.lastError ?? null;
        recordedTime = detail?.lastAttemptAt ?? null;
      }),
    };

    await gateCheckAndFix(
      {
        taskId: 'TASK-001',
        reportPath: 'report.md',
        investigationDir: tempDir,
        cwd: tempDir,
        maxRetries: 1,
      },
      mockDeps,
    );

    expect(recordedError).not.toBeNull();
    expect(recordedTime).not.toBeNull();
  });
});

// ============================================================
// 拓扑排序测试
// ============================================================

describe('topologicalSort', () => {
  test('sorts reports by dependsOn correctly (B before A)', () => {
    // Create meta.json files for dependency resolution
    const reportDir = join(tempDir, 'sub');
    mkdirSync(reportDir, { recursive: true });

    // Create directories first, then write files
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
      reports: {
        'sub/report-01.md': 'pending',
        'sub/report-02.md': 'pending',
      },
      tasks: {
        'sub/report-01.md': {},
        'sub/report-02.md': {},
      },
      lastRunAt: new Date().toISOString(),
    };

    const sorted = topologicalSort(
      ['sub/report-01.md', 'sub/report-02.md'],
      status,
      tempDir,
    );

    // report-02 has no dependencies, should come first
    expect(sorted[0]).toBe('sub/report-02.md');
    expect(sorted[1]).toBe('sub/report-01.md');
  });

  test('throws on circular dependency', () => {
    const reportDir = join(tempDir, 'sub');
    mkdirSync(reportDir, { recursive: true });

    // Create circular dependency: A depends on B, B depends on A
    mkdirSync(join(reportDir, 'report-A'), { recursive: true });
    writeFileSync(
      join(reportDir, 'report-A', 'meta.json'),
      JSON.stringify({ dependsOn: ['sub/report-B.md'] }),
    );

    mkdirSync(join(reportDir, 'report-B'), { recursive: true });
    writeFileSync(
      join(reportDir, 'report-B', 'meta.json'),
      JSON.stringify({ dependsOn: ['sub/report-A.md'] }),
    );

    const status: ConversionStatus = {
      reports: {
        'sub/report-A.md': 'pending',
        'sub/report-B.md': 'pending',
      },
      tasks: {
        'sub/report-A.md': {},
        'sub/report-B.md': {},
      },
      lastRunAt: new Date().toISOString(),
    };

    expect(() =>
      topologicalSort(['sub/report-A.md', 'sub/report-B.md'], status, tempDir)
    ).toThrow('循环依赖');
  });
});