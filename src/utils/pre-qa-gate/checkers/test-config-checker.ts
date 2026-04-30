/**
 * Test Config Checker
 * 测试环境配置检查器 - 验证测试环境配置是否就绪
 *
 * 职责:
 * - 验证 testConfig 配置是否存在
 * - 验证 harness 测试配置是否完整
 * - 检查测试覆盖率配置
 * - 验证测试命令是否配置
 *
 * @module pre-qa-gate/checkers/test-config-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta, TestConfig } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 测试配置检查项结果
 */
export interface TestConfigCheckResult {
  /** 检查项ID */
  checkId: string;
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 测试配置检查结果
 */
export interface TestConfigCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: TestConfigCheckResult[];
  /** 通过的检查项数 */
  passedCount: number;
  /** 失败的检查项数 */
  failedCount: number;
  /** testConfig 配置 */
  testConfig?: TestConfig;
  /** harness 配置 */
  harnessConfig?: Record<string, unknown>;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 测试配置检查器配置
 */
export interface TestConfigCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 是否要求 testConfig */
  requireTestConfig: boolean;
  /** 是否要求 harness 配置 */
  requireHarnessConfig: boolean;
  /** 是否要求至少一种配置 */
  requireEitherConfig: boolean;
  /** 是否检查测试类型 */
  checkTestType: boolean;
  /** 是否检查测试命令 */
  checkTestCommand: boolean;
  /** 是否检查覆盖率配置 */
  checkCoverageConfig: boolean;
  /** 最低覆盖率要求 (百分比) */
  minCoveragePercent: number;
  /** 合法的测试类型 */
  validTestTypes: string[];
  /** 是否验证测试文件存在性 */
  validateTestFilesExist: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_TEST_CONFIG_CHECKER_CONFIG: TestConfigCheckerConfig = {
  enabled: true,
  requireTestConfig: false,
  requireHarnessConfig: false,
  requireEitherConfig: true,
  checkTestType: true,
  checkTestCommand: true,
  checkCoverageConfig: false,
  minCoveragePercent: 80,
  validTestTypes: ['unit', 'integration', 'e2e', 'benchmark', 'contract', 'performance'],
  validateTestFilesExist: false,
};

// ============== TestConfigChecker 类 ==============

/**
 * 测试环境配置检查器
 *
 * 验证测试环境配置是否完整，确保QA验证可以正常执行。
 */
export class TestConfigChecker {
  private config: TestConfigCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<TestConfigCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_TEST_CONFIG_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行测试配置检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<TestConfigCheckerResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        allPassed: false,
        checks: [{
          checkId: 'task-existence',
          name: '任务存在性检查',
          passed: false,
          message: `任务 ${taskId} 不存在`,
          duration: 0,
          timestamp,
        }],
        passedCount: 0,
        failedCount: 1,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    return this.checkTask(task, taskId, startTime, timestamp);
  }

  /**
   * 直接检查任务对象
   */
  private async checkTask(
    task: TaskMeta,
    taskId: string,
    startTime: number,
    timestamp: string
  ): Promise<TestConfigCheckerResult> {
    const checks: TestConfigCheckResult[] = [];

    // 检查配置存在性
    const configExistsCheck = this.checkConfigExists(task);
    checks.push(configExistsCheck);

    // 检查 testConfig
    if (task.testConfig) {
      checks.push(this.checkTestType(task));
      checks.push(this.checkCoverageConfiguration(task));

      if (this.config.validateTestFilesExist) {
        const fileCheck = await this.checkTestFilesExist(task);
        checks.push(fileCheck);
      }
    }

    // 检查 harness 配置
    if (task.harness) {
      checks.push(this.checkHarnessConfig(task));
    }

    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const allPassed = failedCount === 0;

    return {
      taskId,
      allPassed,
      checks,
      passedCount,
      failedCount,
      testConfig: task.testConfig,
      harnessConfig: task.harness ? {
        runner: task.harness.runner,
        testCommand: task.harness.testCommand,
        coverage: task.harness.coverage,
      } : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查配置存在性
   */
  private checkConfigExists(task: TaskMeta): TestConfigCheckResult {
    const startTime = Date.now();

    const hasTestConfig = !!task.testConfig;
    const hasHarnessConfig = !!task.harness;
    const hasEitherConfig = hasTestConfig || hasHarnessConfig;

    let passed = true;
    const errors: string[] = [];

    if (this.config.requireTestConfig && !hasTestConfig) {
      passed = false;
      errors.push('未配置 testConfig');
    }

    if (this.config.requireHarnessConfig && !hasHarnessConfig) {
      passed = false;
      errors.push('未配置 harness');
    }

    if (this.config.requireEitherConfig && !hasEitherConfig) {
      passed = false;
      errors.push('未配置 testConfig 或 harness');
    }

    return {
      checkId: 'config-exists',
      name: '测试配置存在性检查',
      passed,
      message: passed
        ? this.getConfigExistsMessage(hasTestConfig, hasHarnessConfig)
        : `测试配置缺失: ${errors.join('; ')}`,
      details: {
        hasTestConfig,
        hasHarnessConfig,
        hasEitherConfig,
        requireTestConfig: this.config.requireTestConfig,
        requireHarnessConfig: this.config.requireHarnessConfig,
        requireEitherConfig: this.config.requireEitherConfig,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取配置存在性消息
   */
  private getConfigExistsMessage(hasTestConfig: boolean, hasHarnessConfig: boolean): string {
    if (hasTestConfig && hasHarnessConfig) {
      return '已配置 testConfig 和 harness';
    } else if (hasTestConfig) {
      return '已配置 testConfig';
    } else if (hasHarnessConfig) {
      return '已配置 harness';
    } else {
      return '未配置测试环境 (如不要求则正常)';
    }
  }

  /**
   * 检查测试类型
   */
  private checkTestType(task: TaskMeta): TestConfigCheckResult {
    const startTime = Date.now();

    if (!task.testConfig) {
      return {
        checkId: 'test-type',
        name: '测试类型检查',
        passed: true,
        message: '未配置 testConfig，跳过测试类型检查',
        details: { hasTestConfig: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const testType = task.testConfig.type;
    const hasTestType = !!testType;
    const isValidType = hasTestType &&
      this.config.validTestTypes.includes(testType.toLowerCase());

    const passed = !this.config.checkTestType || (hasTestType && isValidType);

    return {
      checkId: 'test-type',
      name: '测试类型检查',
      passed,
      message: passed
        ? hasTestType
          ? `测试类型有效: ${testType}`
          : '未指定测试类型 (如不要求则正常)'
        : !hasTestType
          ? '未指定测试类型'
          : `无效的测试类型: ${testType} (有效类型: ${this.config.validTestTypes.join(', ')})`,
      details: {
        hasTestConfig: true,
        testType,
        hasTestType,
        isValidType,
        validTypes: this.config.validTestTypes,
        checkTestType: this.config.checkTestType,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查覆盖率配置
   */
  private checkCoverageConfiguration(task: TaskMeta): TestConfigCheckResult {
    const startTime = Date.now();

    if (!task.testConfig) {
      return {
        checkId: 'coverage-config',
        name: '覆盖率配置检查',
        passed: true,
        message: '未配置 testConfig，跳过覆盖率检查',
        details: { hasTestConfig: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const coverage = task.testConfig.coverage;
    const hasCoverageConfig = !!coverage;

    if (!hasCoverageConfig) {
      return {
        checkId: 'coverage-config',
        name: '覆盖率配置检查',
        passed: !this.config.checkCoverageConfig,
        message: '未配置覆盖率要求',
        details: {
          hasTestConfig: true,
          hasCoverageConfig: false,
          checkCoverageConfig: this.config.checkCoverageConfig,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const minLines = coverage.minLines;
    const meetsMinCoverage = minLines !== undefined &&
                             minLines >= this.config.minCoveragePercent;

    const passed = !this.config.checkCoverageConfig || meetsMinCoverage;

    return {
      checkId: 'coverage-config',
      name: '覆盖率配置检查',
      passed,
      message: passed
        ? `覆盖率配置有效: 最低 ${minLines ?? '未设定'}%`
        : `覆盖率要求过低: ${minLines}% < ${this.config.minCoveragePercent}%`,
      details: {
        hasTestConfig: true,
        hasCoverageConfig: true,
        minLines,
        minCoveragePercent: this.config.minCoveragePercent,
        meetsMinCoverage,
        checkCoverageConfig: this.config.checkCoverageConfig,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查 harness 配置
   */
  private checkHarnessConfig(task: TaskMeta): TestConfigCheckResult {
    const startTime = Date.now();

    if (!task.harness) {
      return {
        checkId: 'harness-config',
        name: 'Harness 配置检查',
        passed: true,
        message: '未配置 harness，跳过检查',
        details: { hasHarnessConfig: false },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const harness = task.harness;
    const errors: string[] = [];

    if (this.config.checkTestCommand && !harness.testCommand) {
      errors.push('未配置 testCommand');
    }

    const passed = errors.length === 0;

    return {
      checkId: 'harness-config',
      name: 'Harness 配置检查',
      passed,
      message: passed
        ? `Harness 配置有效 (runner: ${harness.runner ?? '未指定'})`
        : `Harness 配置问题: ${errors.join('; ')}`,
      details: {
        hasHarnessConfig: true,
        runner: harness.runner,
        hasTestCommand: !!harness.testCommand,
        hasCoverage: !!harness.coverage,
        checkTestCommand: this.config.checkTestCommand,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查测试文件存在性
   */
  private async checkTestFilesExist(task: TaskMeta): Promise<TestConfigCheckResult> {
    const startTime = Date.now();

    // 获取测试文件列表
    const testFiles: string[] = [];

    if (task.testConfig?.testFiles) {
      testFiles.push(...task.testConfig.testFiles);
    }

    if (task.files) {
      const filesTestFiles = task.files.filter(f =>
        f.includes('.test.') ||
        f.includes('.spec.') ||
        f.includes('__tests__')
      );
      testFiles.push(...filesTestFiles);
    }

    if (testFiles.length === 0) {
      return {
        checkId: 'test-files-exist',
        name: '测试文件存在性检查',
        passed: true,
        message: '未指定测试文件，跳过存在性检查',
        details: {
          testFilesSpecified: false,
          validateTestFilesExist: this.config.validateTestFilesExist,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查文件是否存在
    const missingFiles: string[] = [];
    const existingFiles: string[] = [];

    for (const filePath of testFiles) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.cwd, filePath);

      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      } else {
        missingFiles.push(filePath);
      }
    }

    const passed = missingFiles.length === 0;

    return {
      checkId: 'test-files-exist',
      name: '测试文件存在性检查',
      passed,
      message: passed
        ? `所有测试文件存在 (${existingFiles.length} 个)`
        : `缺少测试文件: ${missingFiles.join(', ')}`,
      details: {
        testFilesSpecified: true,
        totalFiles: testFiles.length,
        existingFiles: existingFiles.length,
        missingFiles: missingFiles.length,
        missingFilesList: missingFiles,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 更新配置
   *
   * @param config 部分配置
   */
  updateConfig(config: Partial<TestConfigCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): TestConfigCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建测试环境配置检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns TestConfigChecker 实例
 */
export function createTestConfigChecker(
  cwd: string,
  config?: Partial<TestConfigCheckerConfig>
): TestConfigChecker {
  return new TestConfigChecker(cwd, config);
}

/**
 * 快速执行测试环境配置检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickTestConfigCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<TestConfigCheckerConfig>
): Promise<TestConfigCheckerResult> {
  const checker = new TestConfigChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行测试环境配置检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchTestConfigCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<TestConfigCheckerConfig>
): Promise<TestConfigCheckerResult[]> {
  const checker = new TestConfigChecker(cwd, config);
  const results: TestConfigCheckerResult[] = [];

  for (const taskId of taskIds) {
    const result = await checker.check(taskId);
    results.push(result);
  }

  return results;
}

/**
 * 格式化检查结果为终端输出
 *
 * @param result 检查结果
 * @returns 格式化字符串
 */
export function formatTestConfigResult(result: TestConfigCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  const decisionIcon = result.allPassed ? '✅' : '❌';

  lines.push('');
  lines.push(separator);
  lines.push(`${decisionIcon} 测试环境配置检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  lines.push(`📊 检查结果: ${result.allPassed ? '通过' : '未通过'}`);
  lines.push(`   通过: ${result.passedCount} / ${result.checks.length}`);
  if (result.failedCount > 0) {
    lines.push(`   失败: ${result.failedCount}`);
  }
  lines.push('');

  // 显示配置摘要
  if (result.testConfig) {
    lines.push('📝 TestConfig 配置:');
    lines.push(`   类型: ${result.testConfig.type ?? '未指定'}`);
    if (result.testConfig.coverage) {
      lines.push(`   覆盖率: ${result.testConfig.coverage.minLines ?? '未设定'}%`);
    }
    lines.push('');
  }

  if (result.harnessConfig) {
    lines.push('🔧 Harness 配置:');
    lines.push(`   Runner: ${result.harnessConfig.runner ?? '未指定'}`);
    lines.push(`   TestCommand: ${result.harnessConfig.testCommand ? '已配置' : '未配置'}`);
    lines.push('');
  }

  if (result.checks.length > 0) {
    lines.push('🔍 详细结果:');
    lines.push('');

    for (const check of result.checks) {
      const icon = check.passed ? '✅' : '❌';
      lines.push(`   ${icon} ${check.name}`);
      lines.push(`      ${check.message}`);
      lines.push('');
    }
  }

  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

export default TestConfigChecker;
