/**
 * Test Environment Config Checker
 * 测试环境配置检查器
 *
 * 职责:
 * - 检查测试环境配置的存在性
 * - 验证配置格式是否正确
 * - 检查任务测试环境建议
 * - 生成测试环境配置
 *
 * @module post-cr-gate/checkers/test-env-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

/**
 * 测试环境配置
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
}

/**
 * 测试环境检查结果
 */
export interface TestEnvCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 检查项 */
  check: string;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * 测试环境配置检查器配置
 */
export interface TestEnvCheckerConfig {
  /** 测试环境配置路径模板 */
  configPath: string;
  /** 是否要求测试命令 */
  requireTestCommands: boolean;
  /** 是否要求环境变量 */
  requireEnvVars: boolean;
  /** 是否自动创建缺失的配置 */
  autoCreate: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_TEST_ENV_CHECKER_CONFIG: TestEnvCheckerConfig = {
  configPath: '.projmnt4claude/outputs/{taskId}/tasks_test_env_adv.json',
  requireTestCommands: true,
  requireEnvVars: false,
  autoCreate: true,
};

/**
 * 测试环境配置检查器
 */
export class TestEnvConfigChecker {
  private config: TestEnvCheckerConfig;
  private cwd: string;

  /**
   * 创建检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<TestEnvCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_TEST_ENV_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行所有测试环境配置检查
   *
   * @param taskId 任务ID
   * @returns 检查结果列表
   */
  async check(taskId: string): Promise<TestEnvCheckResult[]> {
    const results: TestEnvCheckResult[] = [];

    results.push(await this.checkConfigExistence(taskId));
    results.push(await this.checkConfigFormat(taskId));
    results.push(await this.checkTaskHasTestRecommendations(taskId));

    return results;
  }

  /**
   * R-CR-POST-008: 检查测试环境配置存在性
   */
  async checkConfigExistence(taskId: string): Promise<TestEnvCheckResult> {
    const configPath = this.getConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);
    const exists = fs.existsSync(fullPath);

    // 如果不存在且允许自动创建，尝试创建
    if (!exists && this.config.autoCreate) {
      try {
        await this.generateConfig(taskId);
        return {
          passed: true,
          check: 'config_existence',
          message: `测试环境配置已自动生成: ${configPath}`,
          details: {
            configPath,
            autoCreated: true,
          },
        };
      } catch (error) {
        return {
          passed: false,
          check: 'config_existence',
          message: `测试环境配置不存在且自动生成失败: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            configPath,
            exists: false,
            autoCreateFailed: true,
          },
        };
      }
    }

    return {
      passed: exists,
      check: 'config_existence',
      message: exists
        ? `测试环境配置存在: ${configPath}`
        : `测试环境配置不存在: ${configPath}`,
      details: {
        configPath,
        exists,
      },
    };
  }

  /**
   * R-CR-POST-010: 检查测试环境配置格式有效性
   */
  async checkConfigFormat(taskId: string): Promise<TestEnvCheckResult> {
    const configPath = this.getConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    if (!fs.existsSync(fullPath)) {
      return {
        passed: false,
        check: 'config_format',
        message: '无法检查配置格式: 配置文件不存在',
        details: { configPath },
      };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const config = JSON.parse(content) as TestEnvConfig;

      const requiredFields = ['version', 'taskId', 'generatedAt', 'environment', 'recommendations'];
      const missingFields = requiredFields.filter(field => !(field in config));

      const passed = missingFields.length === 0;

      return {
        passed,
        check: 'config_format',
        message: passed
          ? '测试环境配置格式有效'
          : `测试环境配置格式无效: 缺少字段 [${missingFields.join(', ')}]`,
        details: {
          configPath,
          requiredFields,
          missingFields,
          hasTestCommands: !!config.environment?.testCommands && Array.isArray(config.environment.testCommands),
          hasEnvVars: !!config.environment?.envVars && typeof config.environment.envVars === 'object',
          testCommandCount: config.environment?.testCommands?.length ?? 0,
        },
      };
    } catch (error) {
      return {
        passed: false,
        check: 'config_format',
        message: `配置格式检查失败: ${error instanceof Error ? error.message : String(error)}`,
        details: { configPath },
      };
    }
  }

  /**
   * R-CR-POST-009: 检查任务测试环境建议存在性
   */
  async checkTaskHasTestRecommendations(taskId: string): Promise<TestEnvCheckResult> {
    const task = readTaskMeta(taskId, this.cwd);

    if (!task) {
      return {
        passed: false,
        check: 'task_test_recommendations',
        message: '无法检查测试建议: 任务不存在',
        details: { taskId },
      };
    }

    // 从任务描述中提取测试建议
    const hasTestEnvInDescription = /测试|test|验证|verify|检查|check/i.test(task.description ?? '');

    // 检查是否有 verificationCommands
    const hasVerificationCommands = task.checkpoints?.some(cp =>
      cp.verification?.commands && cp.verification.commands.length > 0
    );

    // 检查是否有 verification.steps
    const hasVerificationSteps = task.checkpoints?.some(cp =>
      cp.verification?.steps && cp.verification.steps.length > 0
    );

    const hasRecommendations = hasTestEnvInDescription || hasVerificationCommands || hasVerificationSteps;

    return {
      passed: hasRecommendations,
      check: 'task_test_recommendations',
      message: hasRecommendations
        ? '任务包含测试环境建议'
        : '任务缺少测试环境建议 (描述中没有测试相关内容或验证命令)',
      details: {
        hasTestEnvInDescription,
        hasVerificationCommands,
        hasVerificationSteps,
        checkpointCount: task.checkpoints?.length ?? 0,
      },
    };
  }

  /**
   * 生成测试环境配置
   *
   * @param taskId 任务ID
   * @returns 生成的配置路径
   */
  async generateConfig(taskId: string): Promise<string> {
    const task = readTaskMeta(taskId, this.cwd);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    const configPath = this.getConfigPath(taskId);
    const fullPath = path.join(this.cwd, configPath);

    // 从检查点提取验证命令
    const testCommands: string[] = [];
    for (const checkpoint of task.checkpoints ?? []) {
      if (checkpoint.verification?.commands) {
        testCommands.push(...checkpoint.verification.commands);
      }
    }

    // 如果检查点没有命令，从任务类型推断
    if (testCommands.length === 0) {
      testCommands.push(...this.inferTestCommands(task));
    }

    const config: TestEnvConfig = {
      version: '1.0.0',
      taskId,
      generatedAt: new Date().toISOString(),
      environment: {
        testCommands: [...new Set(testCommands)], // 去重
        envVars: {
          NODE_ENV: 'test',
          TASK_ID: taskId,
        },
        dependencies: this.inferDependencies(task),
      },
      recommendations: this.generateRecommendations(task, testCommands),
    };

    // 确保目录存在
    const configDir = path.dirname(fullPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, JSON.stringify(config, null, 2));

    return configPath;
  }

  /**
   * 推断测试命令
   */
  private inferTestCommands(task: TaskMeta): string[] {
    const commands: string[] = [];

    // 根据任务类型推断
    switch (task.type) {
      case 'test':
        commands.push('bun test');
        break;
      case 'feature':
        commands.push('bun test');
        commands.push('bun run build');
        break;
      case 'bug':
        commands.push('bun test');
        commands.push('bun run build');
        break;
      case 'refactor':
        commands.push('bun test');
        commands.push('bun run build');
        commands.push('bun run lint');
        break;
      default:
        commands.push('bun test');
    }

    // 检查相关文件类型
    if (task.files?.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) {
      commands.push('bun test --grep "specific"');
    }

    return [...new Set(commands)];
  }

  /**
   * 推断依赖
   */
  private inferDependencies(task: TaskMeta): string[] {
    const dependencies: string[] = [];

    // 根据文件类型推断依赖
    if (task.files?.some(f => f.includes('db') || f.includes('database'))) {
      dependencies.push('database');
    }

    if (task.files?.some(f => f.includes('api') || f.includes('http'))) {
      dependencies.push('api-server');
    }

    if (task.files?.some(f => f.includes('redis') || f.includes('cache'))) {
      dependencies.push('redis');
    }

    return dependencies;
  }

  /**
   * 生成测试建议
   */
  private generateRecommendations(task: TaskMeta, testCommands: string[]): string[] {
    const recommendations: string[] = [
      '运行测试前确保依赖已安装: bun install',
    ];

    if (testCommands.length > 0) {
      recommendations.push(`执行测试命令: ${testCommands.join(', ')}`);
    }

    // 根据任务类型添加特定建议
    if (task.type === 'bug') {
      recommendations.push('重点测试修复的问题场景');
    }

    if (task.priority === 'P0' || task.priority === 'P1') {
      recommendations.push('高优先级任务: 确保所有测试通过后再提交');
    }

    return recommendations;
  }

  /**
   * 读取测试环境配置
   *
   * @param taskId 任务ID
   * @returns 配置内容或 null
   */
  readConfig(taskId: string): TestEnvConfig | null {
    const configPath = this.getConfigPath(taskId);
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
   * 获取配置路径
   */
  private getConfigPath(taskId: string): string {
    return this.config.configPath.replace('{taskId}', taskId);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TestEnvCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 创建测试环境配置检查器实例
 */
export function createTestEnvConfigChecker(
  cwd: string,
  config?: Partial<TestEnvCheckerConfig>
): TestEnvConfigChecker {
  return new TestEnvConfigChecker(cwd, config);
}

/**
 * 快速检查测试环境配置
 */
export async function quickTestEnvCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<TestEnvCheckerConfig>
): Promise<TestEnvCheckResult[]> {
  const checker = new TestEnvConfigChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 生成测试环境配置（便捷函数）
 */
export async function generateTestEnvConfig(
  taskId: string,
  cwd: string = process.cwd()
): Promise<string> {
  const checker = new TestEnvConfigChecker(cwd);
  return checker.generateConfig(taskId);
}

export default TestEnvConfigChecker;
