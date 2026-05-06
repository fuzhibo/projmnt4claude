/**
 * Test Config Checker
 * 测试环境配置检查器 - 验证测试环境配置是否就绪
 *
 * 职责:
 * - 验证 tasks_test_env_adv.json 配置文件存在性 (R-QA-PRE-003)
 * - 验证 JSON 格式有效性
 * - 验证当前任务有测试环境建议 (R-QA-PRE-003a)
 * - 检查 prerequisites 是否满足 (R-QA-PRE-007)
 * - 验证 testConfig 配置是否存在
 * - 验证 harness 测试配置是否完整
 *
 * @module pre-qa-gate/checkers/test-config-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskMeta, TestConfig } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 测试结果类型定义 ==============

/**
 * P11 生成的测试环境配置
 */
export interface TestEnvConfig {
  /** 配置版本 */
  version: string;
  /** 任务ID */
  taskId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 测试环境配置 */
  environment: {
    /** 需要的测试命令 */
    testCommands: string[];
    /** 环境变量 */
    envVars: Record<string, string>;
    /** 依赖服务 */
    dependencies: string[];
  };
  /** 测试建议 */
  recommendations: string[];
  /** 前置条件 */
  prerequisites?: {
    /** 命令行工具 */
    commands?: string[];
    /** 环境变量 */
    envVars?: string[];
    /** 服务 */
    services?: string[];
  };
}

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
  /** 检查级别 */
  severity?: 'error' | 'warning' | 'info';
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
  /** 错误级别失败数 */
  errorCount: number;
  /** 警告级别失败数 */
  warningCount: number;
  /** testConfig 配置 */
  testConfig?: TestConfig;
  /** harness 配置 */
  harnessConfig?: Record<string, unknown>;
  /** P11 测试环境配置 */
  testEnvConfig?: TestEnvConfig | null;
  /** P11 配置文件路径 */
  testEnvConfigPath?: string;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
  /** 反馈建议 */
  feedback?: {
    /** 需要反馈到 P11 的问题 */
    needsP11Feedback: boolean;
    /** 反馈原因 */
    reasons: string[];
    /** 建议操作 */
    suggestedActions: string[];
  };
}

/**
 * 测试配置检查器配置
 */
export interface TestConfigCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** P11 测试环境配置路径模板 */
  testEnvConfigPath: string;
  /** 是否要求 P11 测试环境配置 */
  requireTestEnvConfig: boolean;
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
  /** 是否检查配置格式 (R-QA-PRE-003) */
  checkConfigFormat: boolean;
  /** 是否检查任务建议 (R-QA-PRE-003a) */
  checkTaskRecommendations: boolean;
  /** 是否检查 prerequisites (R-QA-PRE-007) */
  checkPrerequisites: boolean;
  /** 是否自动反馈到 P11 */
  enableP11Feedback: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_TEST_CONFIG_CHECKER_CONFIG: TestConfigCheckerConfig = {
  enabled: true,
  testEnvConfigPath: '.projmnt4claude/outputs/{taskId}/tasks_test_env_adv.json',
  requireTestEnvConfig: true,
  requireTestConfig: false,
  requireHarnessConfig: false,
  requireEitherConfig: true,
  checkTestType: true,
  checkTestCommand: true,
  checkCoverageConfig: false,
  minCoveragePercent: 80,
  validTestTypes: ['unit', 'integration', 'e2e', 'benchmark', 'contract', 'performance'],
  validateTestFilesExist: false,
  checkConfigFormat: true,
  checkTaskRecommendations: true,
  checkPrerequisites: true,
  enableP11Feedback: true,
};

// ============== TestConfigChecker 类 ==============

/**
 * 测试环境配置检查器
 *
 * 验证测试环境配置是否完整，确保QA验证可以正常执行。
 * 包含对 P11 生成的 tasks_test_env_adv.json 的验证。
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
          severity: 'error',
        }],
        passedCount: 0,
        failedCount: 1,
        errorCount: 1,
        warningCount: 0,
        duration: Date.now() - startTime,
        timestamp,
        feedback: {
          needsP11Feedback: false,
          reasons: ['任务不存在'],
          suggestedActions: ['检查任务ID是否正确', '确认任务已创建'],
        },
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

    // ========== P11 测试环境配置检查 ==========

    // R-QA-PRE-003: 测试环境配置存在性检查
    if (this.config.requireTestEnvConfig || this.config.checkConfigFormat) {
      checks.push(await this.checkTestEnvConfigExists(taskId));
    }

    // R-QA-PRE-003a: 测试环境配置格式和任务建议检查
    if (this.config.checkConfigFormat || this.config.checkTaskRecommendations) {
      checks.push(await this.checkTestEnvConfigFormat(taskId));
      checks.push(await this.checkTaskHasTestRecommendations(taskId, task));
    }

    // R-QA-PRE-007: Prerequisites 检查
    if (this.config.checkPrerequisites) {
      checks.push(await this.checkPrerequisites(taskId));
    }

    // ========== 传统测试配置检查 ==========

    // 检查传统配置存在性
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

    // 计算结果
    const passedCount = checks.filter(c => c.passed).length;
    const failedChecks = checks.filter(c => !c.passed);
    const failedCount = failedChecks.length;
    const errorCount = failedChecks.filter(c => c.severity === 'error').length;
    const warningCount = failedChecks.filter(c => c.severity === 'warning').length;

    // 只有当没有错误级别失败时才算全部通过
    const allPassed = errorCount === 0;

    // 生成反馈
    const feedback = this.generateFeedback(checks, taskId);

    // 读取 P11 配置（如果存在）
    const testEnvConfig = this.readTestEnvConfig(taskId);
    const testEnvConfigPath = this.getTestEnvConfigPath(taskId);

    return {
      taskId,
      allPassed,
      checks,
      passedCount,
      failedCount,
      errorCount,
      warningCount,
      testConfig: task.testConfig,
      harnessConfig: task.harness ? {
        runner: task.harness.runner,
        testCommand: task.harness.testCommand,
        coverage: task.harness.coverage,
      } : undefined,
      testEnvConfig,
      testEnvConfigPath,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      feedback,
    };
  }

  // ========== P11 测试环境配置检查方法 ==========

  /**
   * R-QA-PRE-003: 检查测试环境配置文件存在性
   */
  private async checkTestEnvConfigExists(taskId: string): Promise<TestConfigCheckResult> {
    const startTime = Date.now();
    const configPath = this.getTestEnvConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);
    const exists = fs.existsSync(fullPath);

    const passed = !this.config.requireTestEnvConfig || exists;
    const severity = this.config.requireTestEnvConfig ? 'error' : 'warning';

    return {
      checkId: 'R-QA-PRE-003',
      name: '测试环境配置存在性检查',
      passed,
      message: exists
        ? `P11 测试环境配置存在: ${configPath}`
        : `P11 测试环境配置不存在: ${configPath}`,
      details: {
        configPath,
        exists,
        required: this.config.requireTestEnvConfig,
        rule: 'R-QA-PRE-003',
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      severity,
    };
  }

  /**
   * R-QA-PRE-003a (Part 1): 检查测试环境配置格式有效性
   */
  private async checkTestEnvConfigFormat(taskId: string): Promise<TestConfigCheckResult> {
    const startTime = Date.now();
    const configPath = this.getTestEnvConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    if (!fs.existsSync(fullPath)) {
      return {
        checkId: 'R-QA-PRE-003a-format',
        name: '测试环境配置格式检查',
        passed: !this.config.checkConfigFormat,
        message: '无法检查配置格式: P11 配置文件不存在',
        details: {
          configPath,
          exists: false,
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: this.config.checkConfigFormat ? 'error' : 'warning',
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const config = JSON.parse(content) as TestEnvConfig;

      const requiredFields = ['version', 'taskId', 'generatedAt', 'environment', 'recommendations'];
      const missingFields = requiredFields.filter(field => !(field in config));

      const passed = missingFields.length === 0;

      return {
        checkId: 'R-QA-PRE-003a-format',
        name: '测试环境配置格式检查',
        passed,
        message: passed
          ? 'P11 测试环境配置格式有效'
          : `P11 测试环境配置格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          configPath,
          requiredFields,
          missingFields,
          hasTestCommands: !!config.environment?.testCommands && Array.isArray(config.environment.testCommands),
          hasEnvVars: !!config.environment?.envVars && typeof config.environment.envVars === 'object',
          testCommandCount: config.environment?.testCommands?.length ?? 0,
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: passed ? undefined : 'error',
      };
    } catch (error) {
      return {
        checkId: 'R-QA-PRE-003a-format',
        name: '测试环境配置格式检查',
        passed: false,
        message: `配置格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          configPath,
          error: error instanceof Error ? error.message : String(error),
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: 'error',
      };
    }
  }

  /**
   * R-QA-PRE-003a (Part 2): 检查任务是否有测试环境建议
   */
  private async checkTaskHasTestRecommendations(
    taskId: string,
    task: TaskMeta
  ): Promise<TestConfigCheckResult> {
    const startTime = Date.now();
    const configPath = this.getTestEnvConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    // 首先检查配置文件是否存在
    if (!fs.existsSync(fullPath)) {
      return {
        checkId: 'R-QA-PRE-003a-recommendations',
        name: '任务测试建议检查',
        passed: false,
        message: '无法检查测试建议: P11 配置文件不存在',
        details: {
          configPath,
          exists: false,
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: 'error',
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const config = JSON.parse(content) as TestEnvConfig;

      // 检查是否有测试建议
      const hasRecommendations = config.recommendations &&
        Array.isArray(config.recommendations) &&
        config.recommendations.length > 0;

      // 检查是否有测试命令
      const hasTestCommands = config.environment?.testCommands &&
        Array.isArray(config.environment.testCommands) &&
        config.environment.testCommands.length > 0;

      // 检查是否与当前任务匹配
      const matchesTask = config.taskId === taskId;

      const passed = hasRecommendations && hasTestCommands && matchesTask;

      const issues: string[] = [];
      if (!matchesTask) {
        issues.push(`配置中的任务ID (${config.taskId}) 与当前任务 (${taskId}) 不匹配`);
      }
      if (!hasRecommendations) {
        issues.push('配置中缺少测试建议 (recommendations)');
      }
      if (!hasTestCommands) {
        issues.push('配置中缺少测试命令 (environment.testCommands)');
      }

      return {
        checkId: 'R-QA-PRE-003a-recommendations',
        name: '任务测试建议检查',
        passed,
        message: passed
          ? `任务有完整的测试环境建议: ${config.recommendations.length} 条建议, ${config.environment.testCommands.length} 个测试命令`
          : `任务测试建议不完整: ${issues.join('; ')}`,
        details: {
          configPath,
          hasRecommendations,
          recommendationCount: config.recommendations?.length ?? 0,
          hasTestCommands,
          testCommandCount: config.environment?.testCommands?.length ?? 0,
          matchesTask,
          configTaskId: config.taskId,
          currentTaskId: taskId,
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: passed ? undefined : 'error',
      };
    } catch (error) {
      return {
        checkId: 'R-QA-PRE-003a-recommendations',
        name: '任务测试建议检查',
        passed: false,
        message: `检查测试建议失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          configPath,
          error: error instanceof Error ? error.message : String(error),
          rule: 'R-QA-PRE-003a',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: 'error',
      };
    }
  }

  /**
   * R-QA-PRE-007: 检查 prerequisites 是否满足
   */
  private async checkPrerequisites(taskId: string): Promise<TestConfigCheckResult> {
    const startTime = Date.now();
    const configPath = this.getTestEnvConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    if (!fs.existsSync(fullPath)) {
      return {
        checkId: 'R-QA-PRE-007',
        name: '前置条件满足性检查',
        passed: true,
        message: 'P11 配置文件不存在，跳过 prerequisites 检查',
        details: {
          configPath,
          exists: false,
          skipped: true,
          rule: 'R-QA-PRE-007',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: 'info',
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const config = JSON.parse(content) as TestEnvConfig;

      // 如果没有 prerequisites 配置，视为通过
      if (!config.prerequisites) {
        return {
          checkId: 'R-QA-PRE-007',
          name: '前置条件满足性检查',
          passed: true,
          message: '配置中没有 prerequisites 要求',
          details: {
            configPath,
            hasPrerequisites: false,
            rule: 'R-QA-PRE-007',
          },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          severity: 'info',
        };
      }

      const prereq = config.prerequisites;
      const missingCommands: string[] = [];
      const missingEnvVars: string[] = [];
      const missingServices: string[] = [];

      // 检查命令行工具
      if (prereq.commands && Array.isArray(prereq.commands)) {
        for (const cmd of prereq.commands) {
          if (!this.checkCommandExists(cmd)) {
            missingCommands.push(cmd);
          }
        }
      }

      // 检查环境变量
      if (prereq.envVars && Array.isArray(prereq.envVars)) {
        for (const envVar of prereq.envVars) {
          if (!process.env[envVar]) {
            missingEnvVars.push(envVar);
          }
        }
      }

      // 检查服务（仅检查标记，实际服务检查需要额外实现）
      if (prereq.services && Array.isArray(prereq.services)) {
        // 服务检查是复杂的，这里仅记录需要检查的服务
        // 实际实现可能需要通过网络检查或调用外部工具
        missingServices.push(...prereq.services);
      }

      const allPassed = missingCommands.length === 0 && missingEnvVars.length === 0;

      return {
        checkId: 'R-QA-PRE-007',
        name: '前置条件满足性检查',
        passed: allPassed,
        message: allPassed
          ? '所有前置条件已满足'
          : `前置条件未满足: ${[
            missingCommands.length > 0 ? `缺少命令: ${missingCommands.join(', ')}` : '',
            missingEnvVars.length > 0 ? `缺少环境变量: ${missingEnvVars.join(', ')}` : '',
          ].filter(Boolean).join('; ')}`,
        details: {
          configPath,
          hasPrerequisites: true,
          requiredCommands: prereq.commands ?? [],
          requiredEnvVars: prereq.envVars ?? [],
          requiredServices: prereq.services ?? [],
          missingCommands,
          missingEnvVars,
          missingServices,
          rule: 'R-QA-PRE-007',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: allPassed ? 'info' : 'warning',
      };
    } catch (error) {
      return {
        checkId: 'R-QA-PRE-007',
        name: '前置条件满足性检查',
        passed: false,
        message: `检查 prerequisites 失败: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          configPath,
          error: error instanceof Error ? error.message : String(error),
          rule: 'R-QA-PRE-007',
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        severity: 'warning',
      };
    }
  }

  /**
   * 检查命令是否存在
   */
  private checkCommandExists(cmd: string): boolean {
    try {
      // 使用 which/where 命令检查命令是否存在
      const { execSync } = require('child_process');
      const isWindows = process.platform === 'win32';
      const checkCmd = isWindows ? `where ${cmd}` : `which ${cmd}`;

      execSync(checkCmd, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取 P11 测试环境配置
   */
  private readTestEnvConfig(taskId: string): TestEnvConfig | null {
    const configPath = this.getTestEnvConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as TestEnvConfig;
    } catch {
      return null;
    }
  }

  /**
   * 获取 P11 测试环境配置路径
   */
  private getTestEnvConfigPath(taskId: string): string {
    return this.config.testEnvConfigPath.replace('{taskId}', taskId);
  }

  // ========== 传统测试配置检查方法 ==========

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
        severity: this.config.checkCoverageConfig ? 'warning' : undefined,
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
      severity: passed ? undefined : 'warning',
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
      severity: passed ? undefined : 'warning',
    };
  }

  // ========== 反馈生成 ==========

  /**
   * 生成反馈建议
   */
  private generateFeedback(
    checks: TestConfigCheckResult[],
    taskId: string
  ): { needsP11Feedback: boolean; reasons: string[]; suggestedActions: string[] } {
    const reasons: string[] = [];
    const suggestedActions: string[] = [];

    // 检查 R-QA-PRE-003 失败
    const configExistsCheck = checks.find(c => c.checkId === 'R-QA-PRE-003');
    if (configExistsCheck && !configExistsCheck.passed) {
      reasons.push('P11 测试环境配置文件不存在');
      suggestedActions.push(`运行 P11 重新生成 tasks_test_env_adv.json: node dist/projmnt4claude.js post-cr-gate run ${taskId}`);
    }

    // 检查 R-QA-PRE-003a 格式检查失败
    const formatCheck = checks.find(c => c.checkId === 'R-QA-PRE-003a-format');
    if (formatCheck && !formatCheck.passed) {
      reasons.push('P11 测试环境配置文件格式无效');
      suggestedActions.push('检查 P11 配置生成逻辑，确保包含所有必要字段');
      suggestedActions.push(`手动修复配置文件: ${this.getTestEnvConfigPath(taskId)}`);
    }

    // 检查 R-QA-PRE-003a 建议检查失败
    const recommendationsCheck = checks.find(c => c.checkId === 'R-QA-PRE-003a-recommendations');
    if (recommendationsCheck && !recommendationsCheck.passed) {
      reasons.push('P11 测试环境配置缺少测试建议或命令');
      suggestedActions.push('在 P11 中添加更多测试建议和验证命令');
    }

    // 检查 R-QA-PRE-007 失败
    const prereqCheck = checks.find(c => c.checkId === 'R-QA-PRE-007');
    if (prereqCheck && !prereqCheck.passed && prereqCheck.severity === 'warning') {
      const details = prereqCheck.details;
      if (details?.missingCommands && (details.missingCommands as string[]).length > 0) {
        suggestedActions.push(`安装缺失的命令行工具: ${(details.missingCommands as string[]).join(', ')}`);
      }
      if (details?.missingEnvVars && (details.missingEnvVars as string[]).length > 0) {
        suggestedActions.push(`设置缺失的环境变量: ${(details.missingEnvVars as string[]).join(', ')}`);
      }
    }

    return {
      needsP11Feedback: reasons.length > 0,
      reasons,
      suggestedActions,
    };
  }

  // ========== 配置管理 ==========

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
    if (result.errorCount > 0) {
      lines.push(`   └─ 错误: ${result.errorCount}`);
    }
    if (result.warningCount > 0) {
      lines.push(`   └─ 警告: ${result.warningCount}`);
    }
  }
  lines.push('');

  // 显示 P11 配置信息
  if (result.testEnvConfigPath) {
    lines.push('📁 P11 测试环境配置:');
    lines.push(`   路径: ${result.testEnvConfigPath}`);
    if (result.testEnvConfig) {
      lines.push(`   版本: ${result.testEnvConfig.version}`);
      lines.push(`   生成时间: ${result.testEnvConfig.generatedAt}`);
      lines.push(`   测试命令: ${result.testEnvConfig.environment?.testCommands?.length ?? 0} 个`);
      lines.push(`   测试建议: ${result.testEnvConfig.recommendations?.length ?? 0} 条`);
    } else {
      lines.push(`   状态: 未找到`);
    }
    lines.push('');
  }

  // 显示传统配置摘要
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

  // 显示检查结果详情
  if (result.checks.length > 0) {
    lines.push('🔍 详细结果:');
    lines.push('');

    // 按规则分组显示
    const p11Checks = result.checks.filter(c => c.checkId.startsWith('R-QA-PRE'));
    const otherChecks = result.checks.filter(c => !c.checkId.startsWith('R-QA-PRE'));

    if (p11Checks.length > 0) {
      lines.push('  【P11 测试环境配置检查】');
      for (const check of p11Checks) {
        const icon = check.passed ? '✅' : '❌';
        const severityLabel = check.severity ? `[${check.severity.toUpperCase()}] ` : '';
        lines.push(`   ${icon} ${severityLabel}${check.name} (${check.checkId})`);
        lines.push(`      ${check.message}`);
        lines.push('');
      }
    }

    if (otherChecks.length > 0) {
      lines.push('  【传统测试配置检查】');
      for (const check of otherChecks) {
        const icon = check.passed ? '✅' : '❌';
        const severityLabel = check.severity ? `[${check.severity.toUpperCase()}] ` : '';
        lines.push(`   ${icon} ${severityLabel}${check.name}`);
        lines.push(`      ${check.message}`);
        lines.push('');
      }
    }
  }

  // 显示反馈建议
  if (result.feedback && result.feedback.needsP11Feedback) {
    lines.push('🔄 P11 反馈建议:');
    lines.push(`   需要反馈: 是`);
    if (result.feedback.reasons.length > 0) {
      lines.push('   原因:');
      for (const reason of result.feedback.reasons) {
        lines.push(`      • ${reason}`);
      }
    }
    if (result.feedback.suggestedActions.length > 0) {
      lines.push('   建议操作:');
      for (const action of result.feedback.suggestedActions) {
        lines.push(`      → ${action}`);
      }
    }
    lines.push('');
  }

  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

/**
 * 格式化 P11 反馈为简短消息
 *
 * @param result 检查结果
 * @returns 反馈消息
 */
export function formatP11Feedback(result: TestConfigCheckerResult): string {
  if (!result.feedback || !result.feedback.needsP11Feedback) {
    return '✅ P11 测试环境配置检查通过，无需反馈';
  }

  const lines: string[] = [];
  lines.push('🔄 需要反馈到 P11:');
  lines.push('');

  for (const reason of result.feedback.reasons) {
    lines.push(`  ❌ ${reason}`);
  }

  if (result.feedback.suggestedActions.length > 0) {
    lines.push('');
    lines.push('建议操作:');
    for (const action of result.feedback.suggestedActions) {
      lines.push(`  → ${action}`);
    }
  }

  return lines.join('\n');
}

export default TestConfigChecker;
