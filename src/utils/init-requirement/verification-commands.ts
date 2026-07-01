/**
 * 验证命令生成模块
 *
 * 基于检查点前缀 + 任务相关文件 + 项目技术栈配置，生成 verification.commands。
 * 支持多技术栈自动检测（Node.js/Go/Python/Rust）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedCheckpoint } from './prefix-map.js';

// ============================================================
// 技术栈检测
// ============================================================

export interface ProjectConfig {
  /** 项目类型 */
  type: 'node' | 'go' | 'python' | 'rust' | 'java' | 'unknown';
  /** 包管理器 */
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  /** 测试框架 */
  testFramework?: 'jest' | 'vitest' | 'mocha' | 'pytest' | 'go-test' | 'cargo-test';
  /** 构建命令 */
  buildCommand?: string;
  /** 测试命令 */
  testCommand?: string;
  /** 测试文件匹配模式 */
  testFilePattern?: string;
}

/** 检测包管理器 */
function detectPackageManager(cwd: string): ProjectConfig['packageManager'] {
  if (existsSync(path.join(cwd, 'bun.lockb')) || existsSync(path.join(cwd, 'bun.lock'))) {
    return 'bun';
  }
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(path.join(cwd, 'package-lock.json'))) {
    return 'npm';
  }
  return undefined;
}

/** 检测测试框架 */
function detectTestFramework(pkg?: Record<string, unknown>): ProjectConfig['testFramework'] {
  if (!pkg) return undefined;
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  const deps = (pkg.dependencies as Record<string, string>) || {};
  const allDeps = { ...deps, ...devDeps };

  if (allDeps.jest) return 'jest';
  if (allDeps.vitest) return 'vitest';
  if (allDeps.mocha) return 'mocha';
  return undefined;
}

/** 自动检测项目技术栈配置 */
export function detectProjectConfig(cwd: string): ProjectConfig {
  // Node.js
  const packageJsonPath = path.join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const packageManager = detectPackageManager(cwd);
    const testFramework = detectTestFramework(pkg);

    // Determine test command based on package manager + test framework
    let testCommand: string | undefined;
    if (pkg.scripts?.test) {
      const pm = packageManager === 'bun' ? 'bun' : packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm';
      testCommand = `${pm} test`;
    }

    let buildCommand: string | undefined;
    if (pkg.scripts?.build) {
      const pm = packageManager === 'bun' ? 'bun' : packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm';
      buildCommand = `${pm} run build`;
    }

    return {
      type: 'node',
      packageManager,
      testFramework,
      buildCommand,
      testCommand,
      testFilePattern: '**/__tests__/*.test.ts',
    };
  }

  // Go
  if (existsSync(path.join(cwd, 'go.mod'))) {
    return {
      type: 'go',
      testCommand: 'go test ./...',
      testFilePattern: '**/*_test.go',
    };
  }

  // Python
  if (existsSync(path.join(cwd, 'pyproject.toml')) || existsSync(path.join(cwd, 'setup.py'))) {
    return {
      type: 'python',
      testCommand: 'pytest',
      testFilePattern: '**/test_*.py',
    };
  }

  // Rust
  if (existsSync(path.join(cwd, 'Cargo.toml'))) {
    return {
      type: 'rust',
      testCommand: 'cargo test',
      buildCommand: 'cargo build',
      testFilePattern: '**/tests/*.rs',
    };
  }

  return { type: 'unknown' };
}

// ============================================================
// 测试文件映射
// ============================================================

/** 将源文件映射到对应的测试文件 */
export function mapSourceToTestFile(sourceFile: string, config: ProjectConfig): string {
  switch (config.type) {
    case 'node':
      return sourceFile.replace(/src\/(.*)\.ts$/, '__tests__/$1.test.ts');
    case 'go':
      return sourceFile.replace(/\.go$/, '_test.go');
    case 'python':
      return sourceFile.replace(/\.py$/, '_test.py');
    case 'rust':
      return sourceFile.replace(/src\/(.*)\.rs$/, 'tests/$1.rs');
    default:
      return sourceFile;
  }
}

// ============================================================
// 验证命令生成
// ============================================================

/**
 * 根据检查点前缀、任务文件和项目技术栈生成验证命令
 *
 * @param checkpoint - 解析后的检查点
 * @param taskFiles - 任务相关文件列表
 * @param projectConfig - 项目技术栈配置
 * @returns 验证命令列表
 */
export function generateVerificationCommands(
  checkpoint: ParsedCheckpoint,
  taskFiles: string[],
  projectConfig: ProjectConfig,
): string[] {
  const { type, buildCommand, testCommand } = projectConfig;

  switch (checkpoint.prefix) {
    case 'ai-qa': {
      if (!testCommand) return [];
      const mappedTestFiles = taskFiles
        .map(f => mapSourceToTestFile(f, projectConfig))
        .filter(f => existsSync(f));

      if (mappedTestFiles.length > 0) {
        return [`${testCommand} ${mappedTestFiles.join(' ')}`];
      }
      // Fallback: pattern match by description
      return [`${testCommand} --testNamePattern="${checkpoint.description}"`];
    }

    case 'human-qa': {
      const commands: string[] = [];
      if (buildCommand) commands.push(buildCommand);
      if (testCommand) commands.push(testCommand);
      return commands;
    }

    case 'ai-review':
      return [`git diff HEAD -- ${taskFiles.join(' ')}`];

    case 'script':
      return buildCommand ? [buildCommand] : [];

    default:
      return [];
  }
}
