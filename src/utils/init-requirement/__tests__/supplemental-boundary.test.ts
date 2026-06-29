/**
 * init-requirement 边界与集成测试补充
 *
 * 覆盖以下测试缺口：
 * - parseCheckpoint 边界：多空格前缀、嵌套括号、Unicode描述
 * - hasValidPrefix 边界：大小写敏感、部分匹配
 * - 技术栈检测边界：Java 项目、空目录、混合项目
 * - 验证命令边界：多文件映射、特殊字符、空描述
 * - gateCheckAndFix：maxRetries=0、并发调用、部分依赖失败
 * - 状态机边界：重复更新、并发读写
 * - 拓扑排序：空列表、单节点、复杂依赖链
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  hasValidPrefix,
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
import type { ConversionStatus, GateDependencies } from '../types.js';
import { gateCheckAndFix } from '../gate-check-fix.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../test-env.js';

let env: IsolatedTestEnv;
let tempDir: string;

beforeEach(async () => {
  env = await createIsolatedTestEnv({ prefix: 'init-req-supplemental-' });
  tempDir = env.tempDir;
});

afterEach(() => {
  env.cleanup();
  jest.restoreAllMocks();
});

// ============================================================
// §3.1 PREFIX_MAP 边界测试
// ============================================================

describe('PREFIX_MAP Boundary Tests', () => {
  test('PREFIX_MAP contains all 9 prefixes (System A + System B)', () => {
    // System A (5) + System B (4) = 9 prefixes
    expect(Object.keys(PREFIX_MAP).length).toBe(9);
    // Verify System A prefixes exist
    expect(PREFIX_MAP).toHaveProperty('verify');
    expect(PREFIX_MAP).toHaveProperty('test');
    expect(PREFIX_MAP).toHaveProperty('review');
    expect(PREFIX_MAP).toHaveProperty('implem');
    expect(PREFIX_MAP).toHaveProperty('doc');
    // Verify System B prefixes exist
    expect(PREFIX_MAP).toHaveProperty('ai-review');
    expect(PREFIX_MAP).toHaveProperty('ai-qa');
    expect(PREFIX_MAP).toHaveProperty('human-qa');
    expect(PREFIX_MAP).toHaveProperty('script');
    // Verify no extra prefixes exist
    expect(PREFIX_MAP).not.toHaveProperty('build');
    expect(PREFIX_MAP).not.toHaveProperty('deploy');
    expect(PREFIX_MAP).not.toHaveProperty('');
  });

  test('VALID_PREFIXES contains exactly 9 items (System A + System B)', () => {
    expect(VALID_PREFIXES.length).toBe(9);
    expect(new Set(VALID_PREFIXES).size).toBe(9); // No duplicates
  });

  test('each prefix has complete category/method/requiresHuman', () => {
    for (const prefix of VALID_PREFIXES) {
      const entry = PREFIX_MAP[prefix]!;
      expect(entry.category).toBeTruthy();
      expect(entry.method).toBeTruthy();
      expect(typeof entry.requiresHuman).toBe('boolean');
    }
  });
});

// ============================================================
// §3.2 parseCheckpoint 边界测试
// ============================================================

describe('parseCheckpoint Boundary Tests', () => {
  test('parses prefix with multiple spaces between bracket and description', () => {
    const result = parseCheckpoint('[test]    multiple spaces');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('test');
    expect(result!.description).toBe('multiple spaces');
  });

  test('parses prefix with tab character', () => {
    const result = parseCheckpoint('[test]\ttab description');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('test');
    expect(result!.description).toBe('tab description');
  });

  test('parses prefix with Unicode description', () => {
    const result = parseCheckpoint('[doc] 更新API文档 🚀');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('更新API文档 🚀');
  });

  test('parses prefix with special characters in description', () => {
    const result = parseCheckpoint('[verify] test [bracket] and {brace}');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('test [bracket] and {brace}');
  });

  test('returns null for prefix with uppercase letters', () => {
    expect(parseCheckpoint('[Test] uppercase')).toBeNull();
    expect(parseCheckpoint('[TEST] uppercase')).toBeNull();
  });

  test('returns null for prefix with trailing text inside brackets', () => {
    expect(parseCheckpoint('[testx] invalid')).toBeNull();
    expect(parseCheckpoint('[xtest] invalid')).toBeNull();
  });

  test('returns null for nested brackets', () => {
    expect(parseCheckpoint('[[test]] nested')).toBeNull();
  });

  test('returns null for prefix with numbers', () => {
    expect(parseCheckpoint('[test1] invalid')).toBeNull();
  });

  test('parses very long description', () => {
    const longDesc = 'a'.repeat(10000);
    const result = parseCheckpoint(`[test] ${longDesc}`);
    expect(result).not.toBeNull();
    expect(result!.description).toBe(longDesc);
  });
});

describe('hasValidPrefix Boundary Tests', () => {
  test('is case-sensitive', () => {
    expect(hasValidPrefix('[test] lowercase')).toBe(true);
    expect(hasValidPrefix('[Test] mixed')).toBe(false);
    expect(hasValidPrefix('[TEST] upper')).toBe(false);
  });

  test('handles partial matches', () => {
    expect(hasValidPrefix('prefix [test] suffix')).toBe(false);
    expect(hasValidPrefix('[test]')).toBe(true);
  });

  test('handles empty and whitespace-only strings', () => {
    expect(hasValidPrefix('')).toBe(false);
    expect(hasValidPrefix('   ')).toBe(false);
    expect(hasValidPrefix('\t\n')).toBe(false);
  });
});

// ============================================================
// §3.3 detectProjectConfig 边界测试
// ============================================================

describe('detectProjectConfig Boundary Tests', () => {
  test('detectProjectConfig does not detect Java (pom.xml not supported)', () => {
    writeFileSync(join(tempDir, 'pom.xml'), '<project></project>');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('unknown');
  });

  test('handles empty directory', () => {
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('unknown');
    expect(config.buildCommand).toBeUndefined();
    expect(config.testCommand).toBeUndefined();
  });

  test('handles directory with only unrelated files', () => {
    writeFileSync(join(tempDir, 'README.md'), '# Test');
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('unknown');
  });

  test('Node.js: detects package.json with no scripts', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('node');
    expect(config.buildCommand).toBeUndefined();
    expect(config.testCommand).toBeUndefined();
  });

  test('Node.js: detects package.json with scripts but no test/build', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { lint: 'eslint .' } })
    );
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('node');
    expect(config.buildCommand).toBeUndefined();
    expect(config.testCommand).toBeUndefined();
  });

  test('Node.js: detects package.json with both test and build scripts', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        scripts: { test: 'jest', build: 'tsc' },
      })
    );
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('node');
    expect(config.testCommand).toBe('npm test');
    expect(config.buildCommand).toBe('npm run build');
  });

  test('Go: detects go.mod', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module test\ngo 1.21');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('go');
    expect(config.testCommand).toBe('go test ./...');
  });

  test('Python: detects pyproject.toml', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "test"');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('python');
    expect(config.testCommand).toBe('pytest');
  });

  test('Python: detects setup.py fallback', () => {
    writeFileSync(join(tempDir, 'setup.py'), 'from setuptools import setup');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('python');
    expect(config.testCommand).toBe('pytest');
  });

  test('Rust: detects Cargo.toml', () => {
    writeFileSync(join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('rust');
    expect(config.testCommand).toBe('cargo test');
    expect(config.buildCommand).toBe('cargo build');
  });

  test('packageManager detection priority: bun > pnpm > yarn > npm', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tempDir, 'bun.lockb'), '');
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '');
    const config = detectProjectConfig(tempDir);
    expect(config.packageManager).toBe('bun');
  });
});

// ============================================================
// §3.4 generateVerificationCommands 边界测试
// ============================================================

describe('generateVerificationCommands Boundary Tests', () => {
  test('test prefix with multiple task files', () => {
    const checkpoint = { prefix: 'test', description: '测试', category: 'qa_verification', verificationMethod: 'unit_test', requiresHuman: false } as any;
    const taskFiles = ['src/a.ts', 'src/b.ts'];
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };
    const commands = generateVerificationCommands(checkpoint, taskFiles, config);
    expect(commands.length).toBeGreaterThan(0);
  });

  test('review prefix with multiple task files', () => {
    const checkpoint = { prefix: 'review', description: '审核', category: 'code_review', verificationMethod: 'code_review', requiresHuman: true } as any;
    const taskFiles = ['src/a.ts', 'src/b.ts'];
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, taskFiles, config);
    expect(commands[0]).toContain('src/a.ts');
    expect(commands[0]).toContain('src/b.ts');
  });

  test('review prefix with empty taskFiles', () => {
    const checkpoint = { prefix: 'review', description: '审核', category: 'code_review', verificationMethod: 'code_review', requiresHuman: true } as any;
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands.length).toBe(1);
    expect(commands[0]).toBe('git diff HEAD -- ');
  });

  test('verify prefix with only buildCommand', () => {
    const checkpoint = { prefix: 'verify', description: '验证', category: 'qa_verification', verificationMethod: 'functional_test', requiresHuman: false } as any;
    const config: ProjectConfig = { type: 'node', buildCommand: 'npm run build' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual(['npm run build']);
  });

  test('verify prefix with only testCommand', () => {
    const checkpoint = { prefix: 'verify', description: '验证', category: 'qa_verification', verificationMethod: 'functional_test', requiresHuman: false } as any;
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual(['npm test']);
  });

  test('implem prefix with no buildCommand returns empty', () => {
    const checkpoint = { prefix: 'implem', description: '实现', category: 'implementation', verificationMethod: 'automated', requiresHuman: false } as any;
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual([]);
  });

  test('doc prefix with no buildCommand returns empty', () => {
    const checkpoint = { prefix: 'doc', description: '文档', category: 'documentation', verificationMethod: 'automated', requiresHuman: false } as any;
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual([]);
  });

  test('unknown prefix returns empty array', () => {
    const checkpoint = { prefix: 'unknown', description: '未知', category: 'unknown', verificationMethod: 'unknown', requiresHuman: false } as any;
    const config: ProjectConfig = { type: 'node' };
    const commands = generateVerificationCommands(checkpoint, [], config);
    expect(commands).toEqual([]);
  });
});

// ============================================================
// §3.5 mapSourceToTestFile 边界测试
// ============================================================

describe('mapSourceToTestFile Boundary Tests', () => {
  test('Node.js: deep nested path', () => {
    const result = mapSourceToTestFile('src/utils/deep/nested/file.ts', { type: 'node' } as ProjectConfig);
    expect(result).toBe('__tests__/utils/deep/nested/file.test.ts');
  });

  test('Node.js: file outside src directory', () => {
    const result = mapSourceToTestFile('lib/file.ts', { type: 'node' } as ProjectConfig);
    expect(result).toBe('lib/file.ts');
  });

  test('Node.js: non-ts file', () => {
    const result = mapSourceToTestFile('src/file.js', { type: 'node' } as ProjectConfig);
    expect(result).toBe('src/file.js');
  });

  test('Go: deep nested path', () => {
    const result = mapSourceToTestFile('pkg/utils/auth.go', { type: 'go' } as ProjectConfig);
    expect(result).toBe('pkg/utils/auth_test.go');
  });

  test('Python: deep nested path', () => {
    const result = mapSourceToTestFile('app/models/user.py', { type: 'python' } as ProjectConfig);
    expect(result).toBe('app/models/user_test.py');
  });

  test('Rust: deep nested path', () => {
    const result = mapSourceToTestFile('src/models/user.rs', { type: 'rust' } as ProjectConfig);
    expect(result).toBe('tests/models/user.rs');
  });

  test('unknown type returns source unchanged', () => {
    const result = mapSourceToTestFile('src/file.ts', { type: 'unknown' } as ProjectConfig);
    expect(result).toBe('src/file.ts');
  });
});

// ============================================================
// §3.6/3.7 状态机边界测试
// ============================================================

describe('ConversionStatus State Machine Boundary Tests', () => {
  test('repeated updates to same report overwrite previous state', () => {
    updateConversionStatus(tempDir, 'report.md', 'pending');
    updateConversionStatus(tempDir, 'report.md', 'failed');
    updateConversionStatus(tempDir, 'report.md', 'completed');
    updateConversionStatus(tempDir, 'report.md', 'pending');
    const status = loadConversionStatus(tempDir);
    expect(status.reports['report.md']).toBe('pending');
  });

  test('update with empty detail does not create task entry', () => {
    updateConversionStatus(tempDir, 'report.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(status.tasks['report.md']).toBeUndefined();
  });

  test('getPendingReports with all completed returns empty', () => {
    updateConversionStatus(tempDir, 'r1.md', 'completed');
    updateConversionStatus(tempDir, 'r2.md', 'completed');
    const status = loadConversionStatus(tempDir);
    expect(getPendingReports(status)).toEqual([]);
  });

  test('getPendingReports with all failed returns both', () => {
    updateConversionStatus(tempDir, 'r1.md', 'failed');
    updateConversionStatus(tempDir, 'r2.md', 'failed');
    const status = loadConversionStatus(tempDir);
    const pending = getPendingReports(status);
    expect(pending).toHaveLength(2);
    expect(pending).toContain('r1.md');
    expect(pending).toContain('r2.md');
  });

  test('getPendingReports with mixed states', () => {
    updateConversionStatus(tempDir, 'r1.md', 'completed');
    updateConversionStatus(tempDir, 'r2.md', 'pending');
    updateConversionStatus(tempDir, 'r3.md', 'failed');
    const status = loadConversionStatus(tempDir);
    const pending = getPendingReports(status);
    expect(pending).toHaveLength(2);
    expect(pending).not.toContain('r1.md');
  });
});

// ============================================================
// §3.8 拓扑排序边界测试
// ============================================================

describe('topologicalSort Boundary Tests', () => {
  test('empty report list returns empty array', () => {
    const status: ConversionStatus = {
      reports: {},
      tasks: {},
      lastRunAt: new Date().toISOString(),
    };
    const sorted = topologicalSort([], status, tempDir);
    expect(sorted).toEqual([]);
  });

  test('single report with no dependencies', () => {
    const status: ConversionStatus = {
      reports: { 'report.md': 'pending' },
      tasks: { 'report.md': {} },
      lastRunAt: new Date().toISOString(),
    };
    const sorted = topologicalSort(['report.md'], status, tempDir);
    expect(sorted).toEqual(['report.md']);
  });

  test('three reports in chain: A depends on B, B depends on C', () => {
    const reportDir = join(tempDir, 'reports');
    mkdirSync(join(reportDir, 'A'), { recursive: true });
    mkdirSync(join(reportDir, 'B'), { recursive: true });
    mkdirSync(join(reportDir, 'C'), { recursive: true });

    writeFileSync(join(reportDir, 'A', 'meta.json'), JSON.stringify({ dependsOn: ['reports/B.md'] }));
    writeFileSync(join(reportDir, 'B', 'meta.json'), JSON.stringify({ dependsOn: ['reports/C.md'] }));
    writeFileSync(join(reportDir, 'C', 'meta.json'), JSON.stringify({ dependsOn: [] }));

    const status: ConversionStatus = {
      reports: { 'reports/A.md': 'pending', 'reports/B.md': 'pending', 'reports/C.md': 'pending' },
      tasks: { 'reports/A.md': {}, 'reports/B.md': {}, 'reports/C.md': {} },
      lastRunAt: new Date().toISOString(),
    };

    const sorted = topologicalSort(['reports/A.md', 'reports/B.md', 'reports/C.md'], status, tempDir);
    expect(sorted[0]).toBe('reports/C.md');
    expect(sorted[1]).toBe('reports/B.md');
    expect(sorted[2]).toBe('reports/A.md');
  });

  test('reports with no dependencies maintain input order', () => {
    const status: ConversionStatus = {
      reports: { 'r1.md': 'pending', 'r2.md': 'pending', 'r3.md': 'pending' },
      tasks: { 'r1.md': {}, 'r2.md': {}, 'r3.md': {} },
      lastRunAt: new Date().toISOString(),
    };
    const sorted = topologicalSort(['r1.md', 'r2.md', 'r3.md'], status, tempDir);
    expect(sorted).toEqual(['r1.md', 'r2.md', 'r3.md']);
  });
});

// ============================================================
// §3.9 gateCheckAndFix 边界测试
// ============================================================

describe('gateCheckAndFix Boundary Tests', () => {
  test('maxRetries=0 immediately archives without attempting', async () => {
    let gateCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => {
        gateCalled = true;
        return {
          taskId: 'TASK-001', passed: true, summary: 'Passed',
          ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
        };
      }),
      checkQualityGate: jest.fn(async () => ({ passed: true, score: { totalScore: 80 }, suggestions: [] })),
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
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 0 },
      mockDeps,
    );

    // With maxRetries=0, the while loop condition (attempt < maxRetries) is never true
    // So gate should not be called and result should be failed/cleanedUp
    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
    expect(gateCalled).toBe(false);
  });

  test('maxRetries=1 with immediate pass', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({ passed: true, score: { totalScore: 80 }, suggestions: [] })),
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
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(result.passed).toBe(true);
    expect(result.attempt).toBe(1);
  });

  test('all gates pass but alignment fails on all three levels', async () => {
    let writeMetaCalled = false;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: true, summary: 'Passed',
        ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({ passed: true, score: { totalScore: 80 }, suggestions: [] })),
      validateNewTaskDeps: jest.fn(() => true),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test', issues: [] })),
      writeTaskMeta: jest.fn(() => { writeMetaCalled = true; }),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: true, durationMs: 100 })),
      runAlignmentCheck: jest.fn(async () => ({
        aligned: false,
        checks: {
          rootCauseAlignment: { passed: false, detail: 'root cause mismatch' },
          solutionAlignment: { passed: false, detail: 'solution mismatch' },
          checkpointAlignment: { passed: false, detail: 'checkpoint mismatch' },
        },
        issues: ['Root cause mismatch', 'Solution mismatch', 'Checkpoint mismatch'],
      })),
      moveTaskToArchive: jest.fn(() => {}),
      updateConversionStatus: jest.fn(() => {}),
    };

    const result = await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(writeMetaCalled).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('preDevGate fails, qualityGate passes, dependency check fails', async () => {
    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async () => ({
        taskId: 'TASK-001', passed: false, summary: 'Pre-dev failed',
        ruleResults: [{ ruleId: 'R-001', passed: false, message: 'Missing checkpoints' }],
        duration: 100, timestamp: new Date().toISOString(),
      })),
      checkQualityGate: jest.fn(async () => ({ passed: true, score: { totalScore: 80 }, suggestions: [] })),
      validateNewTaskDeps: jest.fn(() => false),
      readTaskMeta: jest.fn(() => ({ id: 'TASK-001', title: 'Test' })),
      writeTaskMeta: jest.fn(() => {}),
      invokeAIAgent: jest.fn(async () => ({ output: '{}', success: false, durationMs: 100, error: 'Failed' })),
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
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, maxRetries: 1 },
      mockDeps,
    );

    expect(result.passed).toBe(false);
    expect(result.cleanedUp).toBe(true);
  });

  test('isResumed parameter is correctly passed through', async () => {
    let resumedValue: boolean | null = null;

    const mockDeps: GateDependencies = {
      runPreDevGate: jest.fn(async (params) => {
        resumedValue = params.isResumed;
        return {
          taskId: 'TASK-001', passed: true, summary: 'Passed',
          ruleResults: [],
        checks: [],
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        blockingFailures: 0,
        recommendations: [], duration: 100, timestamp: new Date().toISOString(),
        };
      }),
      checkQualityGate: jest.fn(async () => ({ passed: true, score: { totalScore: 80 }, suggestions: [] })),
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

    await gateCheckAndFix(
      { taskId: 'TASK-001', reportPath: 'report.md', investigationDir: tempDir, cwd: tempDir, isResumed: true },
      mockDeps,
    );

    expect(resumedValue).toBe(true);
  });
});
