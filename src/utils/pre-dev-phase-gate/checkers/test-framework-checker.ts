/**
 * Test Framework Checker
 * 测试框架检查器
 *
 * 职责:
 * - 检测项目是否安装了测试框架
 * - 验证测试运行器是否可用
 * - 支持多语言检测: Jest、pytest、go test、cargo test、mvn test
 * - 失败类型: A（中断任务，需用户修复环境）
 *
 * @module pre-dev-phase-gate/checkers/test-framework-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'child_process';
import type {
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 检测结果
 */
export interface FrameworkDetectionResult {
  /** 是否检测到 */
  detected: boolean;

  /** 框架类型 */
  type?: string;

  /** 框架是否就绪 */
  frameworkReady?: boolean;

  /** 配置文件路径 */
  configPath?: string;

  /** 测试命令 */
  testCommand?: string;

  /** 未就绪原因 */
  reason?: string;
}

/**
 * 测试框架检测器接口
 */
export interface TestFrameworkDetector {
  /** 检测框架 */
  detect(cwd: string): Promise<FrameworkDetectionResult>;
}

/**
 * 测试框架检查器配置
 */
export interface TestFrameworkCheckerConfig {
  /** 是否启用检测 */
  enabled: boolean;

  /** 检测超时时间（毫秒） */
  detectionTimeout: number;
}

/**
 * 默认测试框架检查器配置
 */
export const DEFAULT_TEST_FRAMEWORK_CHECKER_CONFIG: TestFrameworkCheckerConfig = {
  enabled: true,
  detectionTimeout: 5000,
};

/**
 * Jest 检测器
 */
class JestDetector implements TestFrameworkDetector {
  async detect(cwd: string): Promise<FrameworkDetectionResult> {
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      return { detected: false };
    }

    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);

      const hasTestScript = pkg.scripts?.test !== undefined;
      const hasJestDep =
        Boolean(pkg.devDependencies?.jest || pkg.dependencies?.jest);
      const hasVitestDep =
        Boolean(pkg.devDependencies?.vitest || pkg.dependencies?.vitest);
      const hasJestConfig =
        fs.existsSync(path.join(cwd, 'jest.config.js')) ||
        fs.existsSync(path.join(cwd, 'jest.config.ts')) ||
        fs.existsSync(path.join(cwd, 'jest.config.json')) ||
        pkg.jest !== undefined;
      const hasVitestConfig =
        fs.existsSync(path.join(cwd, 'vitest.config.ts')) ||
        fs.existsSync(path.join(cwd, 'vitest.config.js'));

      // 检测 Vitest 或 Jest
      if (hasVitestDep || hasVitestConfig) {
        return {
          detected: true,
          type: 'Node.js/Vitest',
          frameworkReady: hasTestScript,
          configPath: hasVitestConfig
            ? path.join(cwd, 'vitest.config.ts')
            : pkgPath,
          testCommand: hasTestScript ? pkg.scripts.test : 'vitest run',
          reason: !hasTestScript ? 'package.json 缺少 test 脚本' : undefined,
        };
      }

      return {
        detected: true,
        type: 'Node.js/Jest',
        frameworkReady: hasTestScript && (hasJestDep || hasJestConfig),
        configPath: pkgPath,
        testCommand: hasTestScript ? pkg.scripts.test : 'npm test',
        reason: !hasTestScript
          ? 'package.json 缺少 test 脚本'
          : !hasJestDep && !hasJestConfig
            ? '未检测到 Jest 依赖或配置'
            : undefined,
      };
    } catch {
      return { detected: false };
    }
  }
}

/**
 * Pytest 检测器
 */
class PytestDetector implements TestFrameworkDetector {
  async detect(cwd: string): Promise<FrameworkDetectionResult> {
    const hasPyFiles = this.hasPythonFiles(cwd);
    if (!hasPyFiles) {
      return { detected: false };
    }

    const pytestAvailable = this.checkPytestAvailable();

    return {
      detected: true,
      type: 'Python/pytest',
      frameworkReady: pytestAvailable,
      testCommand: 'pytest',
      reason: !pytestAvailable ? 'pytest 未安装或不可用' : undefined,
    };
  }

  private hasPythonFiles(cwd: string): boolean {
    try {
      const files = fs.readdirSync(cwd);
      // 检查根目录是否有 .py 文件
      if (files.some(f => f.endsWith('.py'))) {
        return true;
      }
      // 检查是否有 src 或 tests 目录包含 .py 文件
      const srcDir = path.join(cwd, 'src');
      const testsDir = path.join(cwd, 'tests');
      if (fs.existsSync(srcDir)) {
        const srcFiles = fs.readdirSync(srcDir);
        if (srcFiles.some(f => f.endsWith('.py'))) {
          return true;
        }
      }
      if (fs.existsSync(testsDir)) {
        const testFiles = fs.readdirSync(testsDir);
        if (testFiles.some(f => f.endsWith('.py'))) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private checkPytestAvailable(): boolean {
    try {
      execSync('pytest --version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      // 尝试 python -m pytest
      try {
        execSync('python -m pytest --version', { stdio: 'pipe', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Go Test 检测器
 */
class GoTestDetector implements TestFrameworkDetector {
  async detect(cwd: string): Promise<FrameworkDetectionResult> {
    const hasGoFiles = this.hasGoFiles(cwd);
    if (!hasGoFiles) {
      return { detected: false };
    }

    const goTestAvailable = this.checkGoTestAvailable();

    return {
      detected: true,
      type: 'Go/go test',
      frameworkReady: goTestAvailable,
      testCommand: 'go test ./...',
      reason: !goTestAvailable ? 'go test 不可用' : undefined,
    };
  }

  private hasGoFiles(cwd: string): boolean {
    try {
      const files = fs.readdirSync(cwd);
      return files.some(f => f.endsWith('.go'));
    } catch {
      return false;
    }
  }

  private checkGoTestAvailable(): boolean {
    try {
      execSync('go version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Cargo Test 检测器
 */
class CargoTestDetector implements TestFrameworkDetector {
  async detect(cwd: string): Promise<FrameworkDetectionResult> {
    const cargoPath = path.join(cwd, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) {
      return { detected: false };
    }

    const cargoAvailable = this.checkCargoAvailable();

    return {
      detected: true,
      type: 'Rust/cargo test',
      frameworkReady: cargoAvailable,
      configPath: cargoPath,
      testCommand: 'cargo test',
      reason: !cargoAvailable ? 'cargo 不可用' : undefined,
    };
  }

  private checkCargoAvailable(): boolean {
    try {
      execSync('cargo --version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Maven Test 检测器
 */
class MavenTestDetector implements TestFrameworkDetector {
  async detect(cwd: string): Promise<FrameworkDetectionResult> {
    const pomPath = path.join(cwd, 'pom.xml');
    if (!fs.existsSync(pomPath)) {
      return { detected: false };
    }

    const mavenAvailable = this.checkMavenAvailable();

    return {
      detected: true,
      type: 'Java/mvn test',
      frameworkReady: mavenAvailable,
      configPath: pomPath,
      testCommand: 'mvn test',
      reason: !mavenAvailable ? 'mvn 不可用' : undefined,
    };
  }

  private checkMavenAvailable(): boolean {
    try {
      execSync('mvn --version', { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 测试框架检查器
 *
 * CP-1: TestFrameworkChecker 检查器实现正确
 * CP-2: 多语言检测逻辑完整
 * CP-3: 失败类型为 A（中断任务）
 *
 * 检测项目是否安装了测试框架，这是开发阶段的前置条件。
 */
export class TestFrameworkChecker {
  readonly id = 'R-DEV-PRE-007';
  readonly name = '测试框架检查';
  readonly description = '检测项目是否安装了测试框架';
  readonly failureType = 'A' as const;

  private config: TestFrameworkCheckerConfig;
  private cwd: string;
  private detectors: TestFrameworkDetector[];

  constructor(cwd: string, config?: Partial<TestFrameworkCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_TEST_FRAMEWORK_CHECKER_CONFIG, ...config };
    this.detectors = [
      new JestDetector(),
      new PytestDetector(),
      new GoTestDetector(),
      new CargoTestDetector(),
      new MavenTestDetector(),
    ];
  }

  /**
   * 执行测试框架检查
   *
   * @param context 检查上下文
   * @returns 检查结果
   */
  async check(
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    if (!this.config.enabled) {
      return {
        checkId: 'test-framework-check',
        checkName: this.name,
        ruleId: this.id,
        passed: true,
        severity: 'info',
        message: '测试框架检查已禁用',
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 按优先级检测项目类型
    for (const detector of this.detectors) {
      const result = await detector.detect(this.cwd);
      if (result.detected) {
        const duration = Date.now() - startTime;

        return {
          checkId: 'test-framework-check',
          checkName: this.name,
          ruleId: this.id,
          passed: result.frameworkReady ?? false,
          severity: result.frameworkReady ? 'info' : 'error',
          message: result.frameworkReady
            ? `测试框架就绪: ${result.type}`
            : `测试框架未就绪: ${result.type} - ${result.reason}`,
          details: {
            type: result.type,
            frameworkReady: result.frameworkReady,
            configPath: result.configPath,
            testCommand: result.testCommand,
            reason: result.reason,
            failureType: this.failureType,
          },
          suggestions: result.frameworkReady
            ? undefined
            : this.getSuggestions(result.type),
          duration,
          timestamp,
        };
      }
    }

    // 未检测到任何测试框架
    const duration = Date.now() - startTime;
    return {
      checkId: 'test-framework-check',
      checkName: this.name,
      ruleId: this.id,
      passed: false,
      severity: 'error',
      message: '未检测到测试框架',
      details: {
        failureType: this.failureType,
      },
      suggestions: [
        '安装测试框架: npm install --save-dev jest',
        '或安装 Vitest: npm install --save-dev vitest',
        '配置测试脚本: 在 package.json 中添加 test 脚本',
      ],
      duration,
      timestamp,
    };
  }

  /**
   * 获取修复建议
   */
  private getSuggestions(type?: string): string[] {
    const suggestions: Record<string, string[]> = {
      'Node.js/Jest': [
        '安装 Jest: npm install --save-dev jest',
        '配置测试脚本: 在 package.json 中添加 "test": "jest"',
        '创建 Jest 配置文件: jest.config.js',
      ],
      'Node.js/Vitest': [
        '安装 Vitest: npm install --save-dev vitest',
        '配置测试脚本: 在 package.json 中添加 "test": "vitest run"',
        '创建 Vitest 配置文件: vitest.config.ts',
      ],
      'Python/pytest': [
        '安装 pytest: pip install pytest',
        '或使用: python -m pip install pytest',
      ],
      'Go/go test': [
        '确保 Go 环境已正确安装',
        '运行: go mod download',
      ],
      'Rust/cargo test': [
        '确保 Rust 环境已正确安装',
        '运行: cargo build',
      ],
      'Java/mvn test': [
        '确保 Maven 环境已正确安装',
        '检查 pom.xml 配置',
      ],
    };

    return suggestions[type ?? ''] ?? ['请安装相应的测试框架'];
  }
}

/**
 * 创建测试框架检查器实例
 */
export function createTestFrameworkChecker(
  cwd: string,
  config?: Partial<TestFrameworkCheckerConfig>
): TestFrameworkChecker {
  return new TestFrameworkChecker(cwd, config);
}

/**
 * 快速测试框架检查
 */
export async function checkTestFramework(
  context: PreDevPhaseCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<TestFrameworkCheckerConfig>
): Promise<PreDevPhaseCheckItemResult> {
  const checker = new TestFrameworkChecker(cwd, config);
  return checker.check(context);
}

export default TestFrameworkChecker;