/**
 * Pre-Phase Gate Checker
 * 阶段前质量门禁检查器
 *
 * 职责:
 * - 在任务进入各执行阶段前进行质量检查
 * - 支持 development → code_review → qa → evaluation 各阶段
 * - 提供详细的门禁结果和建议
 *
 * @module pre-phase-gate
 */

import type {
  PrePhaseGateConfig,
  PhaseGateConfig,
  PhaseGateRule,
  PhaseGateRuleType,
  PhaseGateCheckResult,
  PrePhaseGateResult,
  PrePhaseGateContext,
  PrePhaseGateReport,
  PhaseGateDecision,
  PhaseGateRuleHandler,
  PhaseEntryValidation,
  ExecutionPhase,
} from '../types/pre-phase-gate.js';
import {
  createDefaultPhaseGateConfig,
  DEFAULT_DEV_PHASE_RULES,
  DEFAULT_CR_PHASE_RULES,
  DEFAULT_QA_PHASE_RULES,
  DEFAULT_EVAL_PHASE_RULES,
} from '../types/pre-phase-gate.js';
import type { TaskMeta, TaskStatus } from '../types/task.js';
import { normalizeStatus, Pipeline } from '../types/task.js';
import { readTaskMeta } from './task.js';
import { checkQualityGate } from './quality-gate.js';

// ============== 阶段前门禁检查器 ==============

/**
 * 阶段前质量门禁检查器
 *
 * 在任务进入各执行阶段前进行质量检查，
 * 确保任务满足进入该阶段的条件。
 */
export class PrePhaseGateChecker {
  private config: PrePhaseGateConfig;
  private customHandlers: Map<string, PhaseGateRuleHandler>;
  private cwd: string;

  /**
   * 创建阶段前门禁检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PrePhaseGateConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map();

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PrePhaseGateConfig>): PrePhaseGateConfig {
    const defaultConfig = createDefaultPhaseGateConfig();

    return {
      ...defaultConfig,
      ...config,
      phaseGates: config?.phaseGates ?? defaultConfig.phaseGates,
    };
  }

  /**
   * 注册内置规则处理器
   */
  private registerBuiltinHandlers(): void {
    this.customHandlers.set('prerequisite_check', this.handlePrerequisiteCheck.bind(this));
    this.customHandlers.set('artifact_validation', this.handleArtifactValidation.bind(this));
    this.customHandlers.set('quality_score', this.handleQualityScoreCheck.bind(this));
    this.customHandlers.set('status_verification', this.handleStatusVerification.bind(this));
    this.customHandlers.set('checkpoint_validation', this.handleCheckpointValidation.bind(this));
    this.customHandlers.set('dependency_check', this.handleDependencyCheck.bind(this));
  }

  /**
   * 检查任务是否可以进入指定阶段
   *
   * @param taskId 任务ID
   * @param targetPhase 目标阶段
   * @param context 可选的上下文数据
   * @returns 门禁检查结果
   */
  async checkPhaseEntry(
    taskId: string,
    targetPhase: ExecutionPhase,
    context?: Partial<Omit<PrePhaseGateContext, 'taskId' | 'targetPhase' | 'task'>>
  ): Promise<PrePhaseGateResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接允许
    if (!this.config.enabled) {
      return {
        taskId,
        targetPhase,
        decision: 'ALLOW',
        allowed: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        blockingFailures: 0,
        warningCount: 0,
        duration: 0,
        timestamp,
        recommendations: ['阶段前门禁已禁用'],
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        targetPhase,
        decision: 'BLOCK',
        allowed: false,
        ruleResults: [{
          ruleId: 'task-existence',
          ruleName: '任务存在性检查',
          passed: false,
          message: `任务 ${taskId} 不存在`,
          duration: 0,
          timestamp,
        }],
        passedRules: 0,
        failedRules: 1,
        blockingFailures: 1,
        warningCount: 0,
        duration: Date.now() - startTime,
        timestamp,
        recommendations: [`检查任务ID ${taskId} 是否正确`],
      };
    }

    // 创建完整上下文
    const fullContext: PrePhaseGateContext = {
      taskId,
      targetPhase,
      task,
      cwd: this.cwd,
      sharedData: new Map(),
      ...context,
    };

    // 获取阶段配置
    const phaseConfig = this.config.phaseGates.get(targetPhase);
    if (!phaseConfig || !phaseConfig.enabled) {
      return {
        taskId,
        targetPhase,
        decision: 'ALLOW',
        allowed: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        blockingFailures: 0,
        warningCount: 0,
        duration: Date.now() - startTime,
        timestamp,
        recommendations: [`${targetPhase} 阶段门禁未启用`],
      };
    }

    // 执行该阶段的所有规则
    const ruleResults: PhaseGateCheckResult[] = [];
    let blockingFailures = 0;
    let failedRules = 0;

    for (const rule of phaseConfig.rules) {
      if (!rule.enabled) continue;

      const result = await this.executeRule(fullContext, rule);
      ruleResults.push(result);

      if (!result.passed) {
        failedRules++;
        if (rule.blocking) {
          blockingFailures++;
          if (this.config.stopOnFailure) {
            break;
          }
        }
      }
    }

    // 计算决策
    const decision = this.calculateDecision(ruleResults, blockingFailures, phaseConfig.blocking);
    const allowed = decision === 'ALLOW' || (decision === 'WARN' && blockingFailures === 0);

    // 生成建议
    const recommendations = this.generateRecommendations(ruleResults, targetPhase);

    return {
      taskId,
      targetPhase,
      decision,
      allowed,
      ruleResults,
      passedRules: ruleResults.filter(r => r.passed).length,
      failedRules,
      blockingFailures,
      warningCount: ruleResults.filter(r => !r.passed && !this.isBlockingRule(r.ruleId, phaseConfig)).length,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      recommendations,
    };
  }

  /**
   * 执行单个规则
   */
  private async executeRule(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const handler = this.customHandlers.get(rule.type);

      if (!handler) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          message: `未找到规则类型 ${rule.type} 的处理器`,
          duration: Date.now() - startTime,
          timestamp,
        };
      }

      const result = await handler(context, rule);
      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed: false,
        message: `规则执行失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp,
      };
    }
  }

  /**
   * 计算门禁决策
   */
  private calculateDecision(
    results: PhaseGateCheckResult[],
    blockingFailures: number,
    phaseBlocking: boolean
  ): PhaseGateDecision {
    // 有阻塞失败
    if (blockingFailures > 0) {
      return phaseBlocking ? 'BLOCK' : 'WARN';
    }

    // 有非阻塞失败
    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'ALLOW';
    }

    return 'WARN';
  }

  /**
   * 判断是否为阻塞规则
   */
  private isBlockingRule(ruleId: string, phaseConfig: PhaseGateConfig): boolean {
    const rule = phaseConfig.rules.find(r => r.id === ruleId);
    return rule?.blocking ?? false;
  }

  // ============== 内置规则处理器 ==============

  /**
   * 前置条件检查处理器
   */
  private async handlePrerequisiteCheck(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task, targetPhase, devReport, codeReviewVerdict, qaVerdict } = context;

    switch (targetPhase) {
      case 'development':
        // 开发阶段：检查任务状态是否为 open 或 in_progress
        const normalizedStatus = normalizeStatus(task.status);
        const canStartDev = ['open', 'in_progress', 'reopened'].includes(normalizedStatus);
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: canStartDev,
          message: canStartDev
            ? `任务状态 ${task.status} 允许开始开发`
            : `任务状态 ${task.status} 不允许开始开发，需要为 open/in_progress/reopened`,
          details: { status: task.status, normalizedStatus },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'code_review':
        // 代码审核阶段：检查开发是否成功完成
        const hasDevReport = devReport !== undefined;
        const devSuccess = hasDevReport && devReport.status === 'success';
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: devSuccess,
          message: devSuccess
            ? '开发阶段成功完成'
            : hasDevReport
              ? `开发阶段未成功: ${devReport.status}`
              : '缺少开发报告，无法进入代码审核阶段',
          details: { hasDevReport, devStatus: devReport?.status },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'qa':
        // QA阶段：检查代码审核是否通过
        const hasCRResult = codeReviewVerdict !== undefined;
        const crPassed = hasCRResult && codeReviewVerdict.result === 'PASS';
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: crPassed,
          message: crPassed
            ? '代码审核通过'
            : hasCRResult
              ? `代码审核未通过: ${codeReviewVerdict.result}`
              : '缺少代码审核结果，无法进入QA阶段',
          details: { hasCRResult, crResult: codeReviewVerdict?.result },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'evaluation':
        // 评估阶段：检查QA是否成功
        const hasQAResult = qaVerdict !== undefined;
        const qaPassed = hasQAResult && qaVerdict.result === 'PASS';
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: qaPassed,
          message: qaPassed
            ? 'QA验证通过'
            : hasQAResult
              ? `QA验证未通过: ${qaVerdict.result}`
              : '缺少QA结果，无法进入评估阶段',
          details: { hasQAResult, qaResult: qaVerdict?.result },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          message: `未知阶段: ${targetPhase}`,
          duration: 0,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * 产物验证处理器
   */
  private async handleArtifactValidation(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task, targetPhase, devReport, codeReviewVerdict } = context;

    switch (targetPhase) {
      case 'code_review':
        // 验证开发产物
        const hasChanges = devReport && devReport.changes && devReport.changes.length > 0;
        const hasEvidence = devReport && devReport.evidence && devReport.evidence.length > 0;
        const artifactsValid = hasChanges || hasEvidence;

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: artifactsValid,
          message: artifactsValid
            ? `开发产物完整: ${devReport!.changes.length} 个变更, ${devReport!.evidence.length} 个证据`
            : '开发产物不完整，缺少变更记录或证据',
          details: {
            changeCount: devReport?.changes.length ?? 0,
            evidenceCount: devReport?.evidence.length ?? 0,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'qa':
        // 验证代码审核产物
        const hasReviewIssues = codeReviewVerdict?.codeQualityIssues && codeReviewVerdict.codeQualityIssues.length > 0;
        const hasFailedCheckpoints = codeReviewVerdict?.failedCheckpoints && codeReviewVerdict.failedCheckpoints.length > 0;

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: true, // 产物存在即可，质量问题由 prerequisite_check 处理
          message: hasReviewIssues || hasFailedCheckpoints
            ? `代码审核产物: ${codeReviewVerdict!.codeQualityIssues.length} 个质量问题, ${codeReviewVerdict!.failedCheckpoints.length} 个失败检查点`
            : '代码审核产物完整',
          details: {
            issueCount: codeReviewVerdict?.codeQualityIssues.length ?? 0,
            failedCheckpointCount: codeReviewVerdict?.failedCheckpoints.length ?? 0,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: true,
          message: `${targetPhase} 阶段无需产物验证`,
          duration: 0,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * 质量分数检查处理器
   */
  private async handleQualityScoreCheck(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task, targetPhase } = context;
    const phaseConfig = this.config.phaseGates.get(targetPhase);
    const minScore = (rule.config?.minScore as number) ?? phaseConfig?.minQualityScore ?? this.config.minQualityScore;

    try {
      // 使用 quality-gate 模块检查质量
      const qualityResult = await checkQualityGate(task.id, {
        enabled: true,
        minQualityScore: minScore,
        requireSolutionConfirmation: false,
        requireAffectedFiles: false,
        requireChangeSize: false,
      }, this.cwd);

      const passed = qualityResult.passed;

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed,
        message: passed
          ? `质量分数检查通过 (${qualityResult.score.totalScore}/${minScore})`
          : `质量分数不足: ${qualityResult.score.totalScore}/${minScore}`,
        details: {
          score: qualityResult.score.totalScore,
          minScore,
          descriptionScore: qualityResult.score.descriptionScore,
          checkpointScore: qualityResult.score.checkpointScore,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed: false,
        message: `质量分数检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 状态验证处理器
   */
  private async handleStatusVerification(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task } = context;
    const normalizedStatus = normalizeStatus(task.status);

    // 检查任务是否处于可执行状态
    const blockedStatuses = ['failed', 'abandoned', 'closed'];
    const canExecute = !blockedStatuses.includes(normalizedStatus);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed: canExecute,
      message: canExecute
        ? `任务状态 ${task.status} 允许执行`
        : `任务状态 ${task.status} 为终态，无法执行`,
      details: { status: task.status, normalizedStatus },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查点验证处理器
   */
  private async handleCheckpointValidation(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task, targetPhase, devReport } = context;

    // 主要针对开发阶段完成后的检查点验证
    if (targetPhase === 'code_review' && devReport) {
      const completedCheckpoints = devReport.checkpointsCompleted || [];
      const totalCheckpoints = task.checkpoints?.length ?? 0;

      // 如果任务没有检查点，直接通过
      if (totalCheckpoints === 0) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: true,
          message: '任务无检查点，跳过验证',
          details: { totalCheckpoints: 0 },
          duration: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // 检查是否所有检查点都已完成
      const checkpointProgress = totalCheckpoints > 0 ? completedCheckpoints.length / totalCheckpoints : 1;
      const passed = checkpointProgress >= 0.5; // 至少完成50%的检查点

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed,
        message: passed
          ? `检查点完成度: ${completedCheckpoints.length}/${totalCheckpoints} (${Math.round(checkpointProgress * 100)}%)`
          : `检查点完成度不足: ${completedCheckpoints.length}/${totalCheckpoints}，需要至少 50%`,
        details: {
          completed: completedCheckpoints.length,
          total: totalCheckpoints,
          progress: checkpointProgress,
        },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed: true,
      message: `${targetPhase} 阶段无需检查点验证`,
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 依赖检查处理器
   */
  private async handleDependencyCheck(
    context: PrePhaseGateContext,
    rule: PhaseGateRule
  ): Promise<PhaseGateCheckResult> {
    const { task } = context;

    if (!task.dependencies || task.dependencies.length === 0) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed: true,
        message: '任务无依赖',
        details: { dependencies: [] },
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const errors: string[] = [];

    for (const depId of task.dependencies) {
      const depTask = readTaskMeta(depId, this.cwd);

      if (!depTask) {
        errors.push(`依赖任务 ${depId} 不存在`);
        continue;
      }

      const normalizedStatus = normalizeStatus(depTask.status);

      if (normalizedStatus === 'failed' || normalizedStatus === 'abandoned') {
        errors.push(`依赖任务 ${depId} 已失败`);
      } else if (normalizedStatus !== 'resolved' && normalizedStatus !== 'closed') {
        errors.push(`依赖任务 ${depId} 未完成 (当前状态: ${depTask.status})`);
      }
    }

    const passed = errors.length === 0;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed,
      message: passed
        ? `所有 ${task.dependencies.length} 个依赖任务已就绪`
        : `依赖任务未就绪: ${errors.join('; ')}`,
      details: {
        dependencies: task.dependencies,
        errors: passed ? undefined : errors,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // ============== 建议生成 ==============

  /**
   * 生成建议
   */
  private generateRecommendations(
    ruleResults: PhaseGateCheckResult[],
    targetPhase: ExecutionPhase
  ): string[] {
    const recommendations: string[] = [];

    for (const result of ruleResults) {
      if (!result.passed) {
        switch (result.ruleId) {
          case 'R-DEV-PRE-001':
            recommendations.push('确保任务状态为 open 或 in_progress 才能开始开发');
            break;
          case 'R-DEV-PRE-002':
            recommendations.push('检查任务状态，确保不是终态任务');
            break;
          case 'R-DEV-PRE-003':
            recommendations.push('提升任务质量: 完善描述、添加检查点、关联文件');
            break;
          case 'R-CR-PRE-001':
            recommendations.push('确保开发阶段产生有效产物');
            break;
          case 'R-CR-PRE-002':
            recommendations.push('完成开发阶段并生成成功报告');
            break;
          case 'R-CR-PRE-003':
            recommendations.push('完成更多检查点以满足最低完成度要求');
            break;
          case 'R-QA-PRE-001':
            recommendations.push('通过代码审核后再进入QA阶段');
            break;
          case 'R-QA-PRE-002':
            recommendations.push('确保代码审核产物完整');
            break;
          case 'R-QA-PRE-003':
            recommendations.push('提升任务质量以满足QA要求');
            break;
          case 'R-EVAL-PRE-001':
            recommendations.push('通过QA验证后再进入评估阶段');
            break;
          case 'R-EVAL-PRE-002':
            recommendations.push('完成所有前置阶段后再进行评估');
            break;
          case 'R-EVAL-PRE-003':
            recommendations.push('提升整体质量以满足最终评估要求');
            break;
          default:
            recommendations.push(`${result.ruleName}: ${result.message}`);
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(`✅ 任务满足进入 ${targetPhase} 阶段的所有条件`);
    }

    return recommendations;
  }

  // ============== 报告生成 ==============

  /**
   * 生成门禁报告
   */
  generateReport(result: PrePhaseGateResult): PrePhaseGateReport {
    return {
      reportId: `phase-gate-${result.taskId}-${result.targetPhase}-${Date.now()}`,
      taskId: result.taskId,
      targetPhase: result.targetPhase,
      generatedAt: new Date().toISOString(),
      result,
      recommendations: result.recommendations,
      metadata: {
        version: '1.0.0',
        checkerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
      },
    };
  }

  /**
   * 格式化门禁结果为终端输出
   */
  formatResult(result: PrePhaseGateResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    const decisionIcon = result.decision === 'ALLOW' ? '✅' :
                        result.decision === 'WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 阶段前门禁检查: ${result.taskId} → ${result.targetPhase}`);
    lines.push(separator);
    lines.push('');

    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入阶段: ${result.allowed ? '是' : '否'}`);
    lines.push('');

    lines.push(`📋 规则统计:`);
    lines.push(`   通过: ${result.passedRules}`);
    lines.push(`   失败: ${result.failedRules}`);
    if (result.warningCount > 0) {
      lines.push(`   警告: ${result.warningCount}`);
    }
    if (result.blockingFailures > 0) {
      lines.push(`   阻塞失败: ${result.blockingFailures}`);
    }
    lines.push('');

    if (result.ruleResults.length > 0) {
      lines.push('🔍 详细结果:');
      lines.push('');

      for (const ruleResult of result.ruleResults) {
        const icon = ruleResult.passed ? '✅' : '❌';
        lines.push(`   ${icon} ${ruleResult.ruleName}`);
        lines.push(`      ${ruleResult.message}`);
        lines.push('');
      }
    }

    if (result.recommendations.length > 0) {
      lines.push('💡 建议:');
      for (const rec of result.recommendations) {
        lines.push(`   - ${rec}`);
      }
      lines.push('');
    }

    lines.push(`⏱️  执行时长: ${result.duration}ms`);
    lines.push('');
    lines.push(separator);

    return lines.join('\n');
  }

  // ============== 配置管理 ==============

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PrePhaseGateConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PrePhaseGateConfig {
    return { ...this.config };
  }

  /**
   * 注册自定义规则处理器
   */
  registerRuleHandler(ruleType: string, handler: PhaseGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加阶段规则
   */
  addPhaseRule(phase: ExecutionPhase, rule: PhaseGateRule): void {
    const phaseConfig = this.config.phaseGates.get(phase);
    if (phaseConfig) {
      // 移除同ID的现有规则
      phaseConfig.rules = phaseConfig.rules.filter(r => r.id !== rule.id);
      phaseConfig.rules.push(rule);
    }
  }

  /**
   * 移除阶段规则
   */
  removePhaseRule(phase: ExecutionPhase, ruleId: string): void {
    const phaseConfig = this.config.phaseGates.get(phase);
    if (phaseConfig) {
      phaseConfig.rules = phaseConfig.rules.filter(r => r.id !== ruleId);
    }
  }
}

// ============== 便捷函数 ==============

/**
 * 创建阶段前门禁检查器实例
 */
export function createPhaseGateChecker(
  cwd: string,
  config?: Partial<PrePhaseGateConfig>
): PrePhaseGateChecker {
  return new PrePhaseGateChecker(cwd, config);
}

/**
 * 快速检查阶段进入权限
 */
export async function quickPhaseGateCheck(
  taskId: string,
  targetPhase: ExecutionPhase,
  cwd: string = process.cwd(),
  context?: Partial<Omit<PrePhaseGateContext, 'taskId' | 'targetPhase' | 'task'>>
): Promise<PrePhaseGateResult> {
  const checker = new PrePhaseGateChecker(cwd);
  return checker.checkPhaseEntry(taskId, targetPhase, context);
}

/**
 * 验证任务是否可以进入阶段
 */
export async function validatePhaseEntry(
  taskId: string,
  targetPhase: ExecutionPhase,
  cwd: string = process.cwd()
): Promise<PhaseEntryValidation> {
  const checker = new PrePhaseGateChecker(cwd);
  const result = await checker.checkPhaseEntry(taskId, targetPhase);

  return {
    canEnter: result.allowed,
    unmetConditions: result.ruleResults
      .filter(r => !r.passed && r.ruleId !== 'task-existence')
      .map(r => r.message),
    suggestedActions: result.recommendations,
  };
}

export default PrePhaseGateChecker;
