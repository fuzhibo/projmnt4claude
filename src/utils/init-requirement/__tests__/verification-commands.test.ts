/**
 * verification-commands 单元测试
 *
 * 覆盖检查点 §3.3 - §3.6：
 * - 3.3 技术栈检测: detectProjectConfig 正确识别 Node.js/Go/Python/Rust/unknown
 * - 3.4 验证命令生成: generateVerificationCommands 多技术栈测试
 * - 3.5 测试文件映射: mapSourceToTestFile 多技术栈映射
 * - 3.6 回退与边界: 无构建命令、无测试命令、空任务文件列表
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  detectProjectConfig,
  mapSourceToTestFile,
  generateVerificationCommands,
  type ProjectConfig,
} from '../verification-commands.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `vc-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// §3.3 技术栈检测测试
// ============================================================

describe('detectProjectConfig', () => {
  test('识别 Node.js 项目（存在 package.json）', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'jest', build: 'tsc' },
    }));
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('node');
    expect(config.testCommand).toContain('test');
    expect(config.buildCommand).toContain('build');
  });

  test('识别 Go 项目（存在 go.mod）', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module test\ngo 1.21');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('go');
    expect(config.testCommand).toBe('go test ./...');
  });

  test('识别 Python 项目（存在 pyproject.toml）', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "test"');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('python');
    expect(config.testCommand).toBe('pytest');
  });

  test('识别 Rust 项目（存在 Cargo.toml）', () => {
    writeFileSync(join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('rust');
    expect(config.testCommand).toBe('cargo test');
    expect(config.buildCommand).toBe('cargo build');
  });

  test('未知项目返回 type=unknown', () => {
    const config = detectProjectConfig(tempDir);
    expect(config.type).toBe('unknown');
  });
});

// ============================================================
// §3.5 测试文件映射测试
// ============================================================

describe('mapSourceToTestFile', () => {
  test('Node.js: src/utils/auth.ts → __tests__/auth.test.ts', () => {
    const result = mapSourceToTestFile('src/utils/auth.ts', { type: 'node' } as ProjectConfig);
    expect(result).toBe('__tests__/utils/auth.test.ts');
  });

  test('Go: src/auth.go → src/auth_test.go', () => {
    const result = mapSourceToTestFile('src/auth.go', { type: 'go' } as ProjectConfig);
    expect(result).toBe('src/auth_test.go');
  });

  test('Python: src/auth.py → src/auth_test.py', () => {
    const result = mapSourceToTestFile('src/auth.py', { type: 'python' } as ProjectConfig);
    expect(result).toBe('src/auth_test.py');
  });

  test('Rust: src/auth.rs → tests/auth.rs', () => {
    const result = mapSourceToTestFile('src/auth.rs', { type: 'rust' } as ProjectConfig);
    expect(result).toBe('tests/auth.rs');
  });
});

// ============================================================
// §3.4 验证命令生成测试
// ============================================================

describe('generateVerificationCommands', () => {
  test('test 前缀 + 存在测试文件 → npm test', () => {
    const checkpoint = { prefix: 'test', description: '测试认证流程' } as any;
    const taskFiles = ['src/utils/auth.ts'];
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };
    // Mock existsSync to return true for mapped test file
    const fs = require('node:fs');
    const origExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => p.includes('__tests__') || origExistsSync(p);

    const commands = generateVerificationCommands(checkpoint, taskFiles, config);

    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]).toContain('npm test');

    fs.existsSync = origExistsSync;
  });

  test('test 前缀 + 无测试文件 → 描述模式匹配', () => {
    const checkpoint = { prefix: 'test', description: '测试认证流程' } as any;
    const taskFiles: string[] = [];
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };

    const commands = generateVerificationCommands(checkpoint, taskFiles, config);

    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]).toContain('--testNamePattern');
  });

  test('verify 前缀 → build + test', () => {
    const checkpoint = { prefix: 'verify', description: '验证功能' } as any;
    const config: ProjectConfig = {
      type: 'node',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
    };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toContain('npm run build');
    expect(commands).toContain('npm test');
  });

  test('review 前缀 → git diff', () => {
    const checkpoint = { prefix: 'review', description: '审核代码' } as any;
    const config: ProjectConfig = { type: 'node' };

    const commands = generateVerificationCommands(checkpoint, ['src/auth.ts'], config);

    expect(commands.length).toBe(1);
    expect(commands[0]).toContain('git diff');
  });

  test('implem 前缀 → build', () => {
    const checkpoint = { prefix: 'implem', description: '实现功能' } as any;
    const config: ProjectConfig = { type: 'node', buildCommand: 'npm run build' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toContain('npm run build');
  });

  test('doc 前缀 → build', () => {
    const checkpoint = { prefix: 'doc', description: '更新文档' } as any;
    const config: ProjectConfig = { type: 'node', buildCommand: 'npm run build' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toContain('npm run build');
  });

  test('unknown 技术栈 → 返回空数组', () => {
    const checkpoint = { prefix: 'test', description: '测试' } as any;
    const config: ProjectConfig = { type: 'unknown' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual([]);
  });
});

// ============================================================
// §3.3 技术栈检测测试（扩展：packageManager 和 testFramework）
// ============================================================

describe('detectProjectConfig - packageManager detection', () => {
  test('detects bun package manager (bun.lockb)', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tempDir, 'bun.lockb'), '');
    const config = detectProjectConfig(tempDir);
    expect(config.packageManager).toBe('bun');
  });

  test('detects pnpm package manager (pnpm-lock.yaml)', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '');
    const config = detectProjectConfig(tempDir);
    expect(config.packageManager).toBe('pnpm');
  });

  test('detects yarn package manager (yarn.lock)', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tempDir, 'yarn.lock'), '');
    const config = detectProjectConfig(tempDir);
    expect(config.packageManager).toBe('yarn');
  });

  test('detects npm package manager (package-lock.json)', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tempDir, 'package-lock.json'), '');
    const config = detectProjectConfig(tempDir);
    expect(config.packageManager).toBe('npm');
  });
});

describe('detectProjectConfig - testFramework detection', () => {
  test('detects jest test framework', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test',
      devDependencies: { jest: '^29.0.0' },
    }));
    const config = detectProjectConfig(tempDir);
    expect(config.testFramework).toBe('jest');
  });

  test('detects vitest test framework', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test',
      devDependencies: { vitest: '^1.0.0' },
    }));
    const config = detectProjectConfig(tempDir);
    expect(config.testFramework).toBe('vitest');
  });

  test('detects mocha test framework', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test',
      devDependencies: { mocha: '^10.0.0' },
    }));
    const config = detectProjectConfig(tempDir);
    expect(config.testFramework).toBe('mocha');
  });

  test('detects test framework from dependencies (not just devDependencies)', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: { jest: '^29.0.0' },
    }));
    const config = detectProjectConfig(tempDir);
    expect(config.testFramework).toBe('jest');
  });

  test('no test framework when package.json has no dependencies', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const config = detectProjectConfig(tempDir);
    expect(config.testFramework).toBeUndefined();
  });
});

// ============================================================
// §3.5 测试文件映射测试（扩展：边界和回退）
// ============================================================

describe('mapSourceToTestFile - edge cases', () => {
  test('unknown type returns source file unchanged', () => {
    const result = mapSourceToTestFile('src/auth.ts', { type: 'unknown' } as ProjectConfig);
    expect(result).toBe('src/auth.ts');
  });

  test('Node.js: file not in src/ directory returns unchanged', () => {
    const result = mapSourceToTestFile('lib/auth.ts', { type: 'node' } as ProjectConfig);
    expect(result).toBe('lib/auth.ts');
  });

  test('Go: file without .go extension returns unchanged', () => {
    const result = mapSourceToTestFile('src/auth', { type: 'go' } as ProjectConfig);
    expect(result).toBe('src/auth');
  });

  test('Python: file without .py extension returns unchanged', () => {
    const result = mapSourceToTestFile('src/auth', { type: 'python' } as ProjectConfig);
    expect(result).toBe('src/auth');
  });

  test('Rust: file not in src/ directory returns unchanged', () => {
    const result = mapSourceToTestFile('lib/auth.rs', { type: 'rust' } as ProjectConfig);
    expect(result).toBe('lib/auth.rs');
  });
});

// ============================================================
// §3.4 验证命令生成测试（扩展：边界条件）
// ============================================================

describe('generateVerificationCommands - boundary conditions', () => {
  test('verify prefix with only buildCommand (no testCommand)', () => {
    const checkpoint = { prefix: 'verify', description: '验证功能' } as any;
    const config: ProjectConfig = { type: 'node', buildCommand: 'npm run build' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual(['npm run build']);
  });

  test('verify prefix with only testCommand (no buildCommand)', () => {
    const checkpoint = { prefix: 'verify', description: '验证功能' } as any;
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual(['npm test']);
  });

  test('review prefix with empty taskFiles returns git diff HEAD -- ', () => {
    const checkpoint = { prefix: 'review', description: '审核代码' } as any;
    const config: ProjectConfig = { type: 'node' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual(['git diff HEAD -- ']); // Edge: trailing space
  });

  test('test prefix with description containing quotes', () => {
    const checkpoint = { prefix: 'test', description: '测试"特殊"字符' } as any;
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands[0]).toContain('测试"特殊"字符');
  });
});

describe('generateVerificationCommands - fallback and boundary', () => {
  test('无构建命令: implem 前缀 → 返回空数组', () => {
    const checkpoint = { prefix: 'implem', description: '实现功能' } as any;
    const config: ProjectConfig = { type: 'node' }; // no buildCommand

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual([]);
  });

  test('无测试命令: test 前缀 → 返回空数组', () => {
    const checkpoint = { prefix: 'test', description: '测试功能' } as any;
    const config: ProjectConfig = { type: 'node' }; // no testCommand

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands).toEqual([]);
  });

  test('空任务文件列表: test 前缀 → 回退到描述模式匹配', () => {
    const checkpoint = { prefix: 'test', description: '测试认证流程' } as any;
    const config: ProjectConfig = { type: 'node', testCommand: 'npm test' };

    const commands = generateVerificationCommands(checkpoint, [], config);

    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]).toContain('--testNamePattern');
    expect(commands[0]).toContain('测试认证流程');
  });
});
