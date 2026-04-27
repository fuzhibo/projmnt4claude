/**
 * PreCheck Orchestrator
 * 预检查编排器 - 统一管理和调度预检查流程
 */

import type {
  CheckPoint,
  OutputConfig,
  PhaseResult,
  PrecheckConfig,
  PrecheckReport,
  PrecheckResult,
} from '../types/precheck';
import { CheckRegistry } from './check-registry';
import { PhaseCoordinator } from './phase-coordinator';
import { ReportGenerator } from './report-generator';

export interface OrchestratorOptions {
  /** 任务 ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 自定义配置 */
  config?: Partial<PrecheckConfig>;
  /** 输出配置 */
  output?: Partial<OutputConfig>;
}

/**
 * 预检查编排器
 * 提供统一的预检查流程编排
 */
export class PrecheckOrchestrator {
  private registry: CheckRegistry;
  private coordinator: PhaseCoordinator;
  private reportGenerator: ReportGenerator;
  private config: PrecheckConfig;

  constructor(config?: Partial<PrecheckConfig>) {
    this.config = this.mergeWithDefaultConfig(config);
    this.registry = new CheckRegistry();
    this.coordinator = new PhaseCoordinator(this.registry, this.config);
    this.reportGenerator = new ReportGenerator(this.config.output);
  }

  /**
   * 创建默认配置
   */
  private mergeWithDefaultConfig(config?: Partial<PrecheckConfig>): PrecheckConfig {
    const defaultConfig: PrecheckConfig = {
      enableCheckpoint: true,
      stopOnFailure: true,
      globalTimeout: 60000,
      phases: [
        {
          name: 'environment',
          description: 'Environment and resource checks',
          enabled: true,
          order: 1,
          stopOnFailure: true,
          timeout: 15000,
          checks: ['builtin:environment', 'builtin:resource', 'builtin:git', 'builtin:disk-space', 'builtin:permissions'],
        },
        {
          name: 'metadata',
          description: 'Task metadata validation',
          enabled: true,
          order: 2,
          stopOnFailure: true,
          timeout: 15000,
          checks: ['builtin:metadata', 'builtin:config', 'builtin:task-contract'],
        },
        {
          name: 'dependency',
          description: 'Task dependency checks',
          enabled: true,
          order: 3,
          stopOnFailure: false,
          timeout: 20000,
          checks: ['builtin:dependency'],
        },
        {
          name: 'quality',
          description: 'Quality gate checks',
          enabled: true,
          order: 4,
          stopOnFailure: false,
          timeout: 20000,
          checks: ['builtin:quality-gate', 'builtin:requirement'],
        },
      ],
      output: {
        formats: ['terminal'],
        outputDir: '.projmnt4claude/reports/precheck',
        verbose: false,
      },
    };

    if (config) {
      return {
        ...defaultConfig,
        ...config,
        output: {
          ...defaultConfig.output,
          ...config.output,
        },
        phases: config.phases ?? defaultConfig.phases,
      };
    }

    return defaultConfig;
  }

  /**
   * 初始化编排器
   * 注册内置检查项和阶段
   */
  initialize(): void {
    // 注册内置检查项
    this.registry.registerBuiltInChecks();

    // 从配置初始化阶段
    this.coordinator.initializeFromConfig();
  }

  /**
   * 执行预检查
   * @param options 执行选项
   * @returns 预检查结果
   */
  async run(options: OrchestratorOptions): Promise<PrecheckResult> {
    const startTime = Date.now();
    const { taskId, cwd } = options;

    // 合并自定义配置
    if (options.config) {
      this.config = this.mergeWithDefaultConfig(options.config);
      this.coordinator = new PhaseCoordinator(this.registry, this.config);
      this.reportGenerator = new ReportGenerator(this.config.output);
    }

    // 确保已初始化
    if (this.registry.getAll().length === 0) {
      this.initialize();
    }

    // 执行所有阶段
    const phaseResults = await this.coordinator.executeAll(taskId, cwd);

    // 生成检查点
    const completedPhases = phaseResults
      .filter(r => r.passed)
      .map(r => r.phase);
    const currentPhase = phaseResults.find(r => !r.passed)?.phase || null;

    const checkpoint: CheckPoint = {
      taskId,
      completedPhases,
      currentPhase,
      phaseResults,
      sharedData: {},
      createdAt: new Date().toISOString(),
    };

    // 汇总结果
    const passed = phaseResults.every(r => r.passed);
    const duration = Date.now() - startTime;

    return {
      taskId,
      passed,
      phases: phaseResults,
      summary: {
        totalPhases: phaseResults.length,
        passedPhases: phaseResults.filter(r => r.passed).length,
        failedPhases: phaseResults.filter(r => !r.passed).length,
        totalChecks: phaseResults.reduce((sum, p) => sum + p.checks.length, 0),
        passedChecks: phaseResults.reduce((sum, p) => sum + p.checks.filter(c => c.passed).length, 0),
        failedChecks: phaseResults.reduce((sum, p) => sum + p.checks.filter(c => !c.passed).length, 0),
        duration,
        status: passed ? 'passed' : phaseResults.some(r => r.passed) ? 'partial' : 'failed',
      },
      checkpoint: this.config.enableCheckpoint ? checkpoint : undefined,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 执行预检查并生成报告
   * @param options 执行选项
   * @returns 预检查报告
   */
  async runWithReport(options: OrchestratorOptions): Promise<PrecheckReport> {
    const result = await this.run(options);

    // 生成报告
    const report = this.reportGenerator.generate(
      result.taskId,
      result.phases,
    );

    // 导出报告
    if (this.config.output.formats.length > 0) {
      await this.reportGenerator.export(report);
    }

    return report;
  }

  /**
   * 从检查点恢复执行
   * @param taskId 任务 ID
   * @param cwd 工作目录
   * @returns 预检查结果
   */
  async resume(taskId: string, cwd: string): Promise<PrecheckResult | null> {
    const checkpoint = this.coordinator.loadCheckpoint(taskId);
    if (!checkpoint) {
      return null;
    }

    const phaseResults = await this.coordinator.resumeFromCheckpoint(checkpoint, cwd);

    const passed = phaseResults.every(r => r.passed);
    const duration = phaseResults.reduce((sum, p) => sum + p.duration, 0);

    return {
      taskId,
      passed,
      phases: phaseResults,
      summary: {
        totalPhases: phaseResults.length,
        passedPhases: phaseResults.filter(r => r.passed).length,
        failedPhases: phaseResults.filter(r => !r.passed).length,
        totalChecks: phaseResults.reduce((sum, p) => sum + p.checks.length, 0),
        passedChecks: phaseResults.reduce((sum, p) => sum + p.checks.filter(c => c.passed).length, 0),
        failedChecks: phaseResults.reduce((sum, p) => sum + p.checks.filter(c => !c.passed).length, 0),
        duration,
        status: passed ? 'passed' : phaseResults.some(r => r.passed) ? 'partial' : 'failed',
      },
      checkpoint: checkpoint as CheckPoint,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取注册表
   */
  getRegistry(): CheckRegistry {
    return this.registry;
  }

  /**
   * 获取阶段协调器
   */
  getCoordinator(): PhaseCoordinator {
    return this.coordinator;
  }

  /**
   * 获取报告生成器
   */
  getReportGenerator(): ReportGenerator {
    return this.reportGenerator;
  }

  /**
   * 获取配置
   */
  getConfig(): PrecheckConfig {
    return this.config;
  }

  /**
   * 清除检查点
   */
  clearCheckpoint(taskId: string): void {
    this.coordinator.clearCheckpoint(taskId);
  }

  /**
   * 检查是否有检查点
   */
  hasCheckpoint(taskId: string): boolean {
    return this.coordinator.hasCheckpoint(taskId);
  }
}

// 导出便捷函数
export async function runPrecheck(
  taskId: string,
  cwd: string,
  config?: Partial<PrecheckConfig>,
): Promise<PrecheckResult> {
  const orchestrator = new PrecheckOrchestrator(config);
  return orchestrator.run({ taskId, cwd, config });
}

export async function runPrecheckWithReport(
  taskId: string,
  cwd: string,
  config?: Partial<PrecheckConfig>,
): Promise<PrecheckReport> {
  const orchestrator = new PrecheckOrchestrator(config);
  return orchestrator.runWithReport({ taskId, cwd, config });
}
