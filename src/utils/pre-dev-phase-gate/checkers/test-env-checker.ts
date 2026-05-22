/**
 * Test Environment Checker
 * 测试环境检查器
 *
 * 职责:
 * - 运行任务定义的测试环境检测指令，验证环境是否就绪
 * - 检测指令存储在 task.meta.json 的 testEnvCheckCommands 字段中
 * - 失败类型: A（中断任务，需用户修复环境）
 *
 * @module pre-dev-phase-gate/checkers/test-env-checker
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
  PreDevPhaseRule,
} from '../../../types/pre-dev-phase-gate.js';

const execAsync = promisify(exec);

/**
 * 测试环境检测指令
 *
 * 存储在 task.meta.json 中，由任务创建时定义。
 */
export interface TestEnvCheckCommand {
  /** 指令 ID */
  id: string;

  /** 指令描述 */
  description: string;

  /** 检测命令（shell 命令或脚本路径） */
  command: string;

  /** 预期退出码（默认 0） */
  expectedExitCode?: number;

  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;

  /** 是否必需（默认 true） */
  required?: boolean;
}

/**
 * 单个检测指令执行结果
 */
export interface CheckCommandResult {
  /** 指令 ID */
  id: string;

  /** 指令描述 */
  description: string;

  /** 是否通过 */
  passed: boolean;

  /** 退出码 */
  exitCode: number;

  /** 输出内容 */
  output?: string;

  /** 错误信息 */
  error?: string;

  /** 结果消息 */
  message: string;
}

/**
 * 测试环境检查器配置
 */
export interface TestEnvCheckerConfig {
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;

  /** 默认预期退出码 */
  defaultExpectedExitCode: number;

  /** 默认是否必需 */
  defaultRequired: boolean;
}

/**
 * 默认测试环境检查器配置
 */
export const DEFAULT_TEST_ENV_CHECKER_CONFIG: TestEnvCheckerConfig = {
  defaultTimeout: 30000,
  defaultExpectedExitCode: 0,
  defaultRequired: true,
};

/**
 * 测试环境检查器
 *
 * CP-1: TestEnvChecker 检查器实现正确
 * CP-2: 检测指令执行逻辑完整
 * CP-3: 失败类型为 A（中断任务）
 *
 * 检测指令存储在 task.meta.json 的 testEnvCheckCommands 字段中。
 * 如果未定义检测指令，默认通过检查。
 */
export class TestEnvChecker {
  readonly id = 'R-DEV-PRE-006';
  readonly name = '测试环境检查';
  readonly description = '运行任务定义的测试环境检测指令，验证环境是否就绪';
  readonly failureType = 'A' as const;

  private config: TestEnvCheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<TestEnvCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_TEST_ENV_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行测试环境检查
   *
   * @param context 检查上下文
   * @returns 检查结果
   */
  async check(
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 从任务元数据获取检测指令
    const commands = this.getTestEnvCommands(context);

    // 无检测指令，默认通过
    if (commands.length === 0) {
      return {
        checkId: 'test-env-check',
        checkName: this.name,
        ruleId: this.id,
        passed: true,
        severity: 'info',
        message: '未定义测试环境检测指令，跳过检查',
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 执行所有检测指令
    const results: CheckCommandResult[] = [];
    const failures: string[] = [];

    for (const cmd of commands) {
      const result = await this.executeCommand(cmd);
      results.push(result);

      if (!result.passed && cmd.required !== false) {
        failures.push(`${cmd.id}: ${result.message}`);
      }
    }

    const passed = failures.length === 0;
    const duration = Date.now() - startTime;

    return {
      checkId: 'test-env-check',
      checkName: this.name,
      ruleId: this.id,
      passed,
      severity: passed ? 'info' : 'error',
      message: passed
        ? `所有 ${commands.length} 个检测指令通过`
        : `${failures.length} 个必需检测指令失败`,
      details: {
        results,
        failures,
        totalCommands: commands.length,
        passedCommands: results.filter(r => r.passed).length,
        failedCommands: results.filter(r => !r.passed).length,
        failureType: this.failureType,
      },
      suggestions: passed
        ? undefined
        : [
            '检查检测命令是否正确',
            '确认相关服务是否已启动',
            '验证环境变量是否已配置',
            '检查 task.meta.json 中的 testEnvCheckCommands 配置',
          ],
      duration,
      timestamp,
    };
  }

  /**
   * 从任务元数据获取测试环境检测指令
   */
  private getTestEnvCommands(
    context: PreDevPhaseCheckContext
  ): TestEnvCheckCommand[] {
    // 从任务元数据获取 testEnvCheckCommands 字段
    const taskCommands = context.task.testEnvCheckCommands as
      | TestEnvCheckCommand[]
      | undefined;

    return taskCommands ?? [];
  }

  /**
   * 执行单个检测指令
   */
  private async executeCommand(
    cmd: TestEnvCheckCommand
  ): Promise<CheckCommandResult> {
    const timeout = cmd.timeout ?? this.config.defaultTimeout;
    const expectedExitCode =
      cmd.expectedExitCode ?? this.config.defaultExpectedExitCode;

    try {
      const { stdout, stderr } = await execAsync(cmd.command, {
        timeout,
        cwd: this.cwd,
      });

      return {
        id: cmd.id,
        description: cmd.description,
        passed: true,
        exitCode: 0,
        output: stdout,
        message: '检测通过',
      };
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      const exitCode = execError.code ?? 1;
      const passed = exitCode === expectedExitCode;

      return {
        id: cmd.id,
        description: cmd.description,
        passed,
        exitCode,
        output: execError.stdout ?? '',
        error: execError.stderr ?? execError.message ?? '未知错误',
        message: passed
          ? '检测通过（预期退出码）'
          : `检测失败: 退出码 ${exitCode}`,
      };
    }
  }
}

/**
 * 创建测试环境检查器实例
 */
export function createTestEnvChecker(
  cwd: string,
  config?: Partial<TestEnvCheckerConfig>
): TestEnvChecker {
  return new TestEnvChecker(cwd, config);
}

/**
 * 快速测试环境检查
 */
export async function checkTestEnv(
  context: PreDevPhaseCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<TestEnvCheckerConfig>
): Promise<PreDevPhaseCheckItemResult> {
  const checker = new TestEnvChecker(cwd, config);
  return checker.check(context);
}

/**
 * 规则处理器 - 用于 PreDevPhaseGateCoordinator
 */
export async function checkTestEnvRule(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const cwd = context.cwd;
  const checker = new TestEnvChecker(cwd, rule.config as Partial<TestEnvCheckerConfig>);
  return checker.check(context);
}

export default TestEnvChecker;