/**
 * Phase Coordinator
 * 阶段协调器 - 管理多阶段预检查的执行流程
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CheckPhase,
  CheckPoint,
  CheckpointData,
  PhaseConfig,
  PhaseContext,
  PhaseResult,
  PrecheckConfig,
} from '../types/precheck';
import { CheckRegistry } from './check-registry';

export class PhaseCoordinator {
  private phases: Map<string, CheckPhase> = new Map();
  private registry: CheckRegistry;
  private config: PrecheckConfig;

  constructor(registry: CheckRegistry, config: PrecheckConfig) {
    this.registry = registry;
    this.config = config;
  }

  /**
   * 注册检查阶段
   * CP-PC-1: 阶段注册
   */
  registerPhase(phase: CheckPhase): void {
    // 1. 验证阶段名称唯一性
    if (this.phases.has(phase.name)) {
      throw new Error(`Phase '${phase.name}' already registered`);
    }

    // 2. 验证检查项存在性
    for (const check of phase.checks) {
      const existingCheck = this.registry.get(check.id);
      if (!existingCheck) {
        throw new Error(`Check '${check.id}' in phase '${phase.name}' not found in registry`);
      }
    }

    // 3. 注册阶段
    this.phases.set(phase.name, phase);
  }

  /**
   * 执行所有阶段
   * CP-PC-2: 阶段执行流程
   */
  async executeAll(taskId: string, cwd: string): Promise<PhaseResult[]> {
    const results: PhaseResult[] = [];
    const sortedPhases = this.getSortedPhases();

    // 1. 加载检查点（如果存在）
    let checkpoint: CheckpointData | null = null;
    if (this.config.enableCheckpoint) {
      checkpoint = this.loadCheckpoint(taskId);
    }

    // 2. 确定起始阶段
    let startIndex = 0;
    if (checkpoint && checkpoint.currentPhase) {
      const checkpointIndex = sortedPhases.findIndex(p => p.name === checkpoint!.currentPhase);
      if (checkpointIndex >= 0) {
        // 从断点继续
        startIndex = checkpointIndex;
        results.push(...checkpoint.phaseResults);
      }
    }

    // 3. 按顺序执行阶段
    const sharedData = new Map<string, unknown>();
    if (checkpoint) {
      // 恢复共享数据
      for (const [key, value] of Object.entries(checkpoint.sharedData)) {
        sharedData.set(key, value);
      }
    }

    const context: PhaseContext = {
      taskId,
      cwd,
      config: this.config,
      sharedData,
    };

    for (let i = startIndex; i < sortedPhases.length; i++) {
      const phase = sortedPhases[i];
      const result = await this.executePhase(phase.name, context);
      results.push(result);

      // 4. 保存检查点
      if (this.config.enableCheckpoint) {
        const checkpointData: CheckpointData = {
          version: '1.0.0',
          taskId,
          status: result.passed ? 'in_progress' : 'failed',
          completedPhases: results.filter(r => r.passed).map(r => r.phase),
          currentPhase: i < sortedPhases.length - 1 ? sortedPhases[i + 1].name : null,
          phaseResults: results,
          sharedData: Object.fromEntries(sharedData),
          createdAt: checkpoint?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.saveCheckpoint(checkpointData);
      }

      // 失败时停止
      if (!result.passed && phase.stopOnFailure) {
        break;
      }
    }

    return results;
  }

  /**
   * 执行单个阶段
   * CP-PC-3: 单阶段执行
   */
  async executePhase(
    phaseName: string,
    context: PhaseContext,
  ): Promise<PhaseResult> {
    const startTime = Date.now();

    // 1. 获取阶段配置
    const phase = this.phases.get(phaseName);
    if (!phase) {
      return {
        phase: phaseName,
        passed: false,
        duration: Date.now() - startTime,
        checks: [],
        errors: [`Phase '${phaseName}' not found`],
        timestamp: new Date().toISOString(),
      };
    }

    // 2. 创建阶段执行上下文
    const checkContext = {
      taskId: context.taskId,
      cwd: context.cwd,
      phase: phaseName,
      sharedData: context.sharedData,
      logger: {
        debug: (msg: string) => console.debug(`[${phaseName}] ${msg}`),
        info: (msg: string) => console.info(`[${phaseName}] ${msg}`),
        warn: (msg: string) => console.warn(`[${phaseName}] ${msg}`),
        error: (msg: string) => console.error(`[${phaseName}] ${msg}`),
      },
    };

    // 3. 执行阶段内所有检查项
    const checkResults = [];
    const errors: string[] = [];

    for (const check of phase.checks) {
      try {
        const result = await this.registry.execute(check.id, checkContext);
        checkResults.push(result);

        if (!result.passed && phase.stopOnFailure) {
          errors.push(`Check '${check.id}' failed: ${result.message}`);
          break;
        }
      } catch (error) {
        const errorMsg = `Check '${check.id}' threw error: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        checkResults.push({
          checkId: check.id,
          passed: false,
          message: errorMsg,
          duration: 0,
          timestamp: new Date().toISOString(),
        });

        if (phase.stopOnFailure) {
          break;
        }
      }
    }

    // 4. 聚合结果
    const passed = errors.length === 0 && checkResults.every(r => r.passed);

    return {
      phase: phaseName,
      passed,
      duration: Date.now() - startTime,
      checks: checkResults,
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 从检查点恢复执行
   * CP-PC-4: 检查点恢复
   */
  async resumeFromCheckpoint(
    checkpoint: CheckpointData,
    cwd: string,
  ): Promise<PhaseResult[]> {
    return this.executeAll(checkpoint.taskId, cwd);
  }

  /**
   * 获取已排序的阶段列表
   * CP-PC-5: 阶段排序
   */
  getSortedPhases(): CheckPhase[] {
    return Array.from(this.phases.values())
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 检查是否有检查点
   * CP-PC-6: 检查点检测
   */
  hasCheckpoint(taskId: string): boolean {
    if (!this.config.enableCheckpoint) return false;
    const checkpointPath = this.getCheckpointPath(taskId);
    return fs.existsSync(checkpointPath);
  }

  /**
   * 获取检查点路径
   */
  private getCheckpointPath(taskId: string): string {
    const checkpointDir = this.config.checkpointPath || path.join('.projmnt4claude', 'checkpoints');
    return path.join(checkpointDir, `${taskId}-checkpoint.json`);
  }

  /**
   * 加载检查点
   * CP-PC-7: 检查点加载
   */
  loadCheckpoint(taskId: string): CheckpointData | null {
    const checkpointPath = this.getCheckpointPath(taskId);
    if (!fs.existsSync(checkpointPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(checkpointPath, 'utf-8');
      return JSON.parse(data) as CheckpointData;
    } catch {
      return null;
    }
  }

  /**
   * 保存检查点
   * CP-PC-8: 检查点保存
   */
  saveCheckpoint(checkpoint: CheckpointData): void {
    const checkpointPath = this.getCheckpointPath(checkpoint.taskId);
    const checkpointDir = path.dirname(checkpointPath);

    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * 清除检查点
   */
  clearCheckpoint(taskId: string): void {
    const checkpointPath = this.getCheckpointPath(taskId);
    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
    }
  }

  /**
   * 从配置初始化阶段
   */
  initializeFromConfig(): void {
    for (const phaseConfig of this.config.phases) {
      if (!phaseConfig.enabled) continue;

      const checks = phaseConfig.checks
        .map(checkId => this.registry.get(checkId))
        .filter((check): check is NonNullable<typeof check> => check !== undefined);

      this.registerPhase({
        name: phaseConfig.name,
        description: phaseConfig.description,
        order: phaseConfig.order,
        checks,
        stopOnFailure: phaseConfig.stopOnFailure,
        timeout: phaseConfig.timeout,
      });
    }
  }

  /**
   * 获取阶段
   */
  getPhase(name: string): CheckPhase | undefined {
    return this.phases.get(name);
  }

  /**
   * 获取所有阶段
   */
  getAllPhases(): CheckPhase[] {
    return this.getSortedPhases();
  }

  /**
   * 清空阶段
   */
  clear(): void {
    this.phases.clear();
  }
}
