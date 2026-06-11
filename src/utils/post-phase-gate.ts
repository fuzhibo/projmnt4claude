/**
 * Post-Phase Gate Checker
 * 阶段后质量门禁检查器
 *
 * 职责:
 * - 在任务完成各执行阶段后进行质量检查
 * - 确保阶段产出符合质量标准
 * - 支持 development → code_review → qa → evaluation 各阶段
 * - 提供详细的门禁结果和建议
 *
 * @module post-phase-gate
 */

import type {
  PostPhaseGateConfig,
  PostPhaseGateConfigEntry,
  PostPhaseGateRule,
  PostPhaseGateRuleType,
  PostPhaseGateCheckResult,
  PostPhaseGateResult,
  PostPhaseGateContext,
  PostPhaseGateReport,
  PostPhaseGateDecision,
  PostPhaseGateRuleHandler,
  PhaseExitValidation,
  ExecutionPhase,
  PhaseDeliverable,
} from '../types/post-phase-gate.js';
import {
  createDefaultPostPhaseGateConfig,
  DEFAULT_DEV_POST_PHASE_RULES,
  DEFAULT_CR_POST_PHASE_RULES,
  DEFAULT_QA_POST_PHASE_RULES,
  DEFAULT_EVAL_POST_PHASE_RULES,
} from '../types/post-phase-gate.js';
import type { TaskMeta, TaskStatus } from '../types/task.js';
import { normalizeStatus } from '../types/task.js';
import { readTaskMeta } from './task.js';
import { checkQualityGate } from './quality-gate.js';

// ============== 阶段后门禁检查器 ==============

/**
 * 阶段后质量门禁检查器
 *
 * 在任务完成各执行阶段后进行质量检查，
 * 确保阶段产出符合质量标准。
 */
export class PostPhaseGateChecker {
  private config: PostPhaseGateConfig;
  private customHandlers: Map<string, PostPhaseGateRuleHandler>;
  private cwd: string;

  /**
   * 创建阶段后门禁检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PostPhaseGateConfig>) {
    this.cwd = cwd;
    this.config = this.mergeConfig(config);
    this.customHandlers = new Map();

    // 注册内置规则处理器
    this.registerBuiltinHandlers();
  }

  /**
   * 合并配置
   */
  private mergeConfig(config?: Partial<PostPhaseGateConfig>): PostPhaseGateConfig {
    const defaultConfig = createDefaultPostPhaseGateConfig();

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
    this.customHandlers.set('completion_verification', this.handleCompletionVerification.bind(this));
    this.customHandlers.set('artifact_validation', this.handleArtifactValidation.bind(this));
    this.customHandlers.set('quality_score', this.handleQualityScoreCheck.bind(this));
    this.customHandlers.set('checkpoint_completion', this.handleCheckpointCompletion.bind(this));
    this.customHandlers.set('test_results', this.handleTestResults.bind(this));
    this.customHandlers.set('review_approval', this.handleReviewApproval.bind(this));
    this.customHandlers.set('deliverable_check', this.handleDeliverableCheck.bind(this));
  }

  /**
   * 检查任务是否可以退出指定阶段
   *
   * @param taskId 任务ID
   * @param currentPhase 当前阶段
   * @param context 可选的上下文数据
   * @returns 门禁检查结果
   */
  async checkPhaseExit(
    taskId: string,
    currentPhase: ExecutionPhase,
    context?: Partial<Omit<PostPhaseGateContext, 'taskId' | 'currentPhase' | 'task'>>
  ): Promise<PostPhaseGateResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接允许
    if (!this.config.enabled) {
      return {
        taskId,
        currentPhase,
        decision: 'COMPLETE',
        canExit: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        blockingFailures: 0,
        warningCount: 0,
        duration: 0,
        timestamp,
        recommendations: ['阶段后门禁已禁用'],
        deliverables: [],
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        currentPhase,
        decision: 'INCOMPLETE',
        canExit: false,
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
        deliverables: [],
      };
    }

    // 创建完整上下文
    const fullContext: PostPhaseGateContext = {
      taskId,
      currentPhase,
      task,
      cwd: this.cwd,
      sharedData: new Map(),
      ...context,
    };

    // 获取阶段配置
    const phaseConfig = this.config.phaseGates.get(currentPhase);
    if (!phaseConfig || !phaseConfig.enabled) {
      return {
        taskId,
        currentPhase,
        decision: 'COMPLETE',
        canExit: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        blockingFailures: 0,
        warningCount: 0,
        duration: Date.now() - startTime,
        timestamp,
        recommendations: [`${currentPhase} 阶段后门禁未启用`],
        deliverables: this.generatePhaseDeliverables(currentPhase, fullContext),
      };
    }

    // 执行该阶段的所有规则
    const ruleResults: PostPhaseGateCheckResult[] = [];
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
    const canExit = decision === 'COMPLETE' || (decision === 'NEEDS_FIX' && blockingFailures === 0);

    // 生成建议
    const recommendations = this.generateRecommendations(ruleResults, currentPhase);

    // 生成阶段产出物
    const deliverables = this.generatePhaseDeliverables(currentPhase, fullContext);

    return {
      taskId,
      currentPhase,
      decision,
      canExit,
      ruleResults,
      passedRules: ruleResults.filter(r => r.passed).length,
      failedRules,
      blockingFailures,
      warningCount: ruleResults.filter(r => !r.passed && !this.isBlockingRule(r.ruleId, phaseConfig)).length,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      recommendations,
      deliverables,
    };
  }

  /**
   * 执行单个规则
   */
  private async executeRule(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
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
    results: PostPhaseGateCheckResult[],
    blockingFailures: number,
    phaseBlocking: boolean
  ): PostPhaseGateDecision {
    // 有阻塞失败
    if (blockingFailures > 0) {
      return phaseBlocking ? 'INCOMPLETE' : 'NEEDS_FIX';
    }

    // 有非阻塞失败
    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'COMPLETE';
    }

    return 'NEEDS_FIX';
  }

  /**
   * 判断是否为阻塞规则
   */
  private isBlockingRule(ruleId: string, phaseConfig: PostPhaseGateConfigEntry): boolean {
    const rule = phaseConfig.rules.find(r => r.id === ruleId);
    return rule?.blocking ?? false;
  }

  // ============== 内置规则处理器 ==============

  /**
   * 阶段完成验证处理器
   */
  private async handleCompletionVerification(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { task, currentPhase, devReport, codeReviewVerdict, qaVerdict } = context;

    switch (currentPhase) {
      case 'development':
        // 验证开发阶段是否成功完成
        const hasDevReport = devReport !== undefined;
        const devSuccess = hasDevReport && devReport.status === 'success';
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: devSuccess,
          message: devSuccess
            ? '开发阶段成功完成'
            : hasDevReport
              ? `开发阶段未完成: ${devReport.status}`
              : '缺少开发报告',
          details: { hasDevReport, devStatus: devReport?.status },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'code_review':
        // 验证代码审核阶段是否成功完成
        const hasCRVerdict = codeReviewVerdict !== undefined;
        const crCompleted = hasCRVerdict && ['PASS', 'NOPASS', 'CONDITIONAL'].includes(codeReviewVerdict.result);
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: crCompleted,
          message: crCompleted
            ? `代码审核阶段已完成: ${codeReviewVerdict.result}`
            : hasCRVerdict
              ? `代码审核未完成: ${codeReviewVerdict.result}`
              : '缺少代码审核结果',
          details: { hasCRVerdict, crResult: codeReviewVerdict?.result },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'qa':
        // 验证QA阶段是否成功完成
        const hasQAVerdict = qaVerdict !== undefined;
        const qaCompleted = hasQAVerdict && ['PASS', 'FAIL'].includes(qaVerdict.result);
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: qaCompleted,
          message: qaCompleted
            ? `QA阶段已完成: ${qaVerdict.result}`
            : hasQAVerdict
              ? `QA未完成: ${qaVerdict.result}`
              : '缺少QA结果',
          details: { hasQAVerdict, qaResult: qaVerdict?.result },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'evaluation':
        // 验证评估阶段是否成功完成
        const taskStatus = normalizeStatus(task.status);
        const evalCompleted = ['resolved', 'closed'].includes(taskStatus);
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: evalCompleted,
          message: evalCompleted
            ? `评估阶段已完成，任务状态: ${task.status}`
            : `评估阶段未完成，任务状态: ${task.status}`,
          details: { status: task.status, normalizedStatus: taskStatus },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          message: `未知阶段: ${currentPhase}`,
          duration: 0,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * 产物验证处理器
   */
  private async handleArtifactValidation(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { currentPhase, devReport, codeReviewVerdict, qaVerdict } = context;

    switch (currentPhase) {
      case 'development':
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

      case 'code_review':
        // 验证代码审核产物
        const hasReviewResult = codeReviewVerdict !== undefined;
        const hasIssues = codeReviewVerdict?.codeQualityIssues !== undefined;

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: hasReviewResult,
          message: hasReviewResult
            ? `代码审核产物完整${hasIssues ? `，包含 ${codeReviewVerdict.codeQualityIssues.length} 个质量问题` : ''}`
            : '代码审核产物不完整',
          details: {
            hasReviewResult,
            issueCount: codeReviewVerdict?.codeQualityIssues?.length ?? 0,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'qa':
        // 验证QA产物
        const hasQAResult = qaVerdict !== undefined;

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: hasQAResult,
          message: hasQAResult
            ? 'QA产物完整'
            : 'QA产物不完整',
          details: { hasQAResult },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'evaluation':
        // 评估阶段不需要额外产物验证
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: true,
          message: '评估阶段产物验证通过',
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          message: `未知阶段: ${currentPhase}`,
          duration: 0,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * 质量分数检查处理器
   */
  private async handleQualityScoreCheck(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { task, currentPhase } = context;
    const phaseConfig = this.config.phaseGates.get(currentPhase);
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
   * 检查点完成度验证处理器
   */
  private async handleCheckpointCompletion(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { task, currentPhase, devReport } = context;
    const phaseConfig = this.config.phaseGates.get(currentPhase);
    const minRate = (rule.config?.minCompletionRate as number) ?? phaseConfig?.minCheckpointCompletionRate ?? 0.8;

    const completedCheckpoints = devReport?.checkpointsCompleted || [];
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

    const completionRate = totalCheckpoints > 0 ? completedCheckpoints.length / totalCheckpoints : 1;
    const passed = completionRate >= minRate;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed,
      message: passed
        ? `检查点完成度: ${completedCheckpoints.length}/${totalCheckpoints} (${Math.round(completionRate * 100)}%)`
        : `检查点完成度不足: ${completedCheckpoints.length}/${totalCheckpoints} (${Math.round(completionRate * 100)}%)，需要至少 ${Math.round(minRate * 100)}%`,
      details: {
        completed: completedCheckpoints.length,
        total: totalCheckpoints,
        completionRate,
        minRate,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 测试结果验证处理器
   */
  private async handleTestResults(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { currentPhase, qaVerdict } = context;

    if (currentPhase !== 'qa') {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        passed: true,
        message: `${currentPhase} 阶段无需测试结果验证`,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // QA阶段：验证测试结果是否通过
    const hasQAResult = qaVerdict !== undefined;
    const qaPassed = hasQAResult && qaVerdict.result === 'PASS';

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed: qaPassed,
      message: qaPassed
        ? 'QA测试通过'
        : hasQAResult
          ? `QA测试未通过: ${qaVerdict.result}`
          : '缺少QA测试结果',
      details: {
        hasQAResult,
        qaResult: qaVerdict?.result,
        reason: qaVerdict?.reason,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 审核批准验证处理器
   */
  private async handleReviewApproval(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { currentPhase, codeReviewVerdict, qaVerdict } = context;

    switch (currentPhase) {
      case 'code_review':
        // 代码审核阶段：验证是否获得批准
        const hasCRResult = codeReviewVerdict !== undefined;
        const crApproved = hasCRResult && codeReviewVerdict.result === 'PASS';

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: crApproved,
          message: crApproved
            ? '代码审核已通过'
            : hasCRResult
              ? `代码审核未通过: ${codeReviewVerdict.result}`
              : '缺少代码审核结果',
          details: {
            hasCRResult,
            crResult: codeReviewVerdict?.result,
            reviewedBy: codeReviewVerdict?.reviewedBy,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      case 'qa':
        // QA阶段：验证是否获得批准
        const hasQAResult = qaVerdict !== undefined;
        const qaApproved = hasQAResult && qaVerdict.result === 'PASS';

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: qaApproved,
          message: qaApproved
            ? 'QA已通过'
            : hasQAResult
              ? `QA未通过: ${qaVerdict.result}`
              : '缺少QA结果',
          details: {
            hasQAResult,
            qaResult: qaVerdict?.result,
            verifiedBy: qaVerdict?.verifiedBy,
          },
          duration: 0,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed: true,
          message: `${currentPhase} 阶段无需审核批准验证`,
          duration: 0,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * 可交付物检查处理器
   */
  private async handleDeliverableCheck(
    context: PostPhaseGateContext,
    rule: PostPhaseGateRule
  ): Promise<PostPhaseGateCheckResult> {
    const { currentPhase, devReport, codeReviewVerdict, qaVerdict } = context;

    const deliverables = this.generatePhaseDeliverables(currentPhase, context);
    const missingDeliverables = deliverables.filter(d => d.status === 'missing');
    const passed = missingDeliverables.length === 0;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed,
      message: passed
        ? `${currentPhase} 阶段所有可交付物已就绪`
        : `${currentPhase} 阶段缺少 ${missingDeliverables.length} 个可交付物`,
      details: {
        deliverableCount: deliverables.length,
        missingCount: missingDeliverables.length,
        deliverables: deliverables.map(d => ({ id: d.id, status: d.status })),
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // ============== 产出物生成 ==============

  /**
   * 生成阶段产出物
   */
  private generatePhaseDeliverables(
    currentPhase: ExecutionPhase,
    context: PostPhaseGateContext
  ): PhaseDeliverable[] {
    const { task, devReport, codeReviewVerdict, qaVerdict } = context;
    const deliverables: PhaseDeliverable[] = [];

    switch (currentPhase) {
      case 'development':
        // 开发阶段产出物
        deliverables.push({
          id: 'dev-code-changes',
          name: '代码变更',
          type: 'code',
          status: devReport?.changes && devReport.changes.length > 0 ? 'complete' : 'missing',
          description: '开发阶段产生的代码变更',
        });
        deliverables.push({
          id: 'dev-evidence',
          name: '开发证据',
          type: 'artifact',
          status: devReport?.evidence && devReport.evidence.length > 0 ? 'complete' : 'partial',
          description: '开发过程的证据记录',
        });
        deliverables.push({
          id: 'dev-report',
          name: '开发报告',
          type: 'report',
          status: devReport ? 'complete' : 'missing',
          description: '开发阶段完成报告',
        });
        break;

      case 'code_review':
        // 代码审核阶段产出物
        deliverables.push({
          id: 'cr-verdict',
          name: '代码审核结果',
          type: 'report',
          status: codeReviewVerdict ? 'complete' : 'missing',
          description: '代码审核裁决结果',
        });
        deliverables.push({
          id: 'cr-issues',
          name: '代码质量问题清单',
          type: 'document',
          status: codeReviewVerdict?.codeQualityIssues ? 'complete' : 'partial',
          description: '代码审核发现的质量问题',
        });
        break;

      case 'qa':
        // QA阶段产出物
        deliverables.push({
          id: 'qa-verdict',
          name: 'QA验证结果',
          type: 'report',
          status: qaVerdict ? 'complete' : 'missing',
          description: 'QA验证裁决结果',
        });
        deliverables.push({
          id: 'qa-test-results',
          name: '测试结果',
          type: 'test',
          status: qaVerdict?.result === 'PASS' ? 'complete' : 'partial',
          description: 'QA测试结果',
        });
        break;

      case 'evaluation':
        // 评估阶段产出物
        deliverables.push({
          id: 'eval-task-status',
          name: '任务最终状态',
          type: 'report',
          status: ['resolved', 'closed'].includes(normalizeStatus(task.status)) ? 'complete' : 'missing',
          description: '任务评估后的最终状态',
        });
        break;
    }

    return deliverables;
  }

  // ============== 建议生成 ==============

  /**
   * 生成建议
   */
  private generateRecommendations(
    ruleResults: PostPhaseGateCheckResult[],
    currentPhase: ExecutionPhase
  ): string[] {
    const recommendations: string[] = [];

    for (const result of ruleResults) {
      if (!result.passed) {
        switch (result.ruleId) {
          case 'R-DEV-POST-001':
            recommendations.push('确保开发阶段成功完成并生成报告');
            break;
          case 'R-DEV-POST-002':
            recommendations.push('添加代码变更记录和开发证据');
            break;
          case 'R-DEV-POST-003':
            recommendations.push('完成更多检查点以满足最低完成度要求');
            break;
          case 'R-DEV-POST-004':
            recommendations.push('确保所有开发可交付物已就绪');
            break;
          case 'R-CR-POST-001':
            recommendations.push('完成代码审核阶段');
            break;
          case 'R-CR-POST-002':
            recommendations.push('通过代码审核后再退出此阶段');
            break;
          case 'R-CR-POST-003':
            recommendations.push('确保代码审核产物完整');
            break;
          case 'R-CR-POST-004':
            recommendations.push('提升代码质量以满足分数要求');
            break;
          case 'R-QA-POST-001':
            recommendations.push('完成QA验证阶段');
            break;
          case 'R-QA-POST-002':
            recommendations.push('修复测试失败问题');
            break;
          case 'R-QA-POST-003':
            recommendations.push('通过QA验证后再退出此阶段');
            break;
          case 'R-QA-POST-004':
            recommendations.push('确保QA可交付物完整');
            break;
          case 'R-EVAL-POST-001':
            recommendations.push('完成评估阶段');
            break;
          case 'R-EVAL-POST-002':
            recommendations.push('确保评估可交付物完整');
            break;
          case 'R-EVAL-POST-003':
            recommendations.push('提升整体质量以满足最终要求');
            break;
          case 'R-EVAL-POST-004':
            recommendations.push('完成所有阶段后再退出评估');
            break;
          default:
            recommendations.push(`${result.ruleName}: ${result.message}`);
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(`✅ 任务满足退出 ${currentPhase} 阶段的所有条件`);
    }

    return recommendations;
  }

  // ============== 报告生成 ==============

  /**
   * 生成门禁报告
   */
  generateReport(result: PostPhaseGateResult): PostPhaseGateReport {
    return {
      reportId: `post-phase-gate-${result.taskId}-${result.currentPhase}-${Date.now()}`,
      taskId: result.taskId,
      currentPhase: result.currentPhase,
      generatedAt: new Date().toISOString(),
      result,
      recommendations: result.recommendations,
      deliverables: result.deliverables,
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
  formatResult(result: PostPhaseGateResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    const decisionIcon = result.decision === 'COMPLETE' ? '✅' :
                        result.decision === 'NEEDS_FIX' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 阶段后门禁检查: ${result.taskId} ← ${result.currentPhase}`);
    lines.push(separator);
    lines.push('');

    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许退出阶段: ${result.canExit ? '是' : '否'}`);
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

    if (result.deliverables.length > 0) {
      lines.push('📦 阶段产出物:');
      lines.push('');

      for (const deliverable of result.deliverables) {
        const icon = deliverable.status === 'complete' ? '✅' :
                    deliverable.status === 'partial' ? '⚠️ ' : '❌';
        lines.push(`   ${icon} ${deliverable.name} (${deliverable.type})`);
        if (deliverable.description) {
          lines.push(`      ${deliverable.description}`);
        }
      }
      lines.push('');
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
  updateConfig(config: Partial<PostPhaseGateConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PostPhaseGateConfig {
    return { ...this.config };
  }

  /**
   * 注册自定义规则处理器
   */
  registerRuleHandler(ruleType: string, handler: PostPhaseGateRuleHandler): void {
    this.customHandlers.set(ruleType, handler);
  }

  /**
   * 添加阶段规则
   */
  addPhaseRule(phase: ExecutionPhase, rule: PostPhaseGateRule): void {
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
 * 创建阶段后门禁检查器实例
 */
export function createPostPhaseGateChecker(
  cwd: string,
  config?: Partial<PostPhaseGateConfig>
): PostPhaseGateChecker {
  return new PostPhaseGateChecker(cwd, config);
}

/**
 * 快速检查阶段退出权限
 */
export async function quickPostPhaseGateCheck(
  taskId: string,
  currentPhase: ExecutionPhase,
  cwd: string = process.cwd(),
  context?: Partial<Omit<PostPhaseGateContext, 'taskId' | 'currentPhase' | 'task'>>
): Promise<PostPhaseGateResult> {
  const checker = new PostPhaseGateChecker(cwd);
  return checker.checkPhaseExit(taskId, currentPhase, context);
}

/**
 * 验证任务是否可以退出阶段
 */
export async function validatePhaseExit(
  taskId: string,
  currentPhase: ExecutionPhase,
  cwd: string = process.cwd()
): Promise<PhaseExitValidation> {
  const checker = new PostPhaseGateChecker(cwd);
  const result = await checker.checkPhaseExit(taskId, currentPhase);

  return {
    canExit: result.canExit,
    unmetConditions: result.ruleResults
      .filter(r => !r.passed && r.ruleId !== 'task-existence')
      .map(r => r.message),
    suggestedActions: result.recommendations,
    allowForceExit: result.blockingFailures === 0 && result.failedRules > 0,
    forceExitRisks: result.blockingFailures > 0
      ? ['存在阻塞性失败，强制退出可能导致质量问题']
      : undefined,
  };
}

export default PostPhaseGateChecker;
