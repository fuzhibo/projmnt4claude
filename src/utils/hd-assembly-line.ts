/**
 * AssemblyLine - 执行流水线核心
 *
 * 负责任务队列管理和流程编排：
 * - 依赖检查
 * - 开发阶段调度
 * - 代码审核阶段调度
 * - QA 验证阶段调度
 * - 审查阶段调度
 * - 重试逻辑
 * - 状态持久化
 * - 程序化更新（不依赖 AI 记忆）
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type {
  HarnessConfig,
  HarnessRuntimeState,
  ExecutionSummary,
  TaskExecutionRecord,
  DevReport,
  ReviewVerdict,
  CodeReviewVerdict,
  QAVerdict,
  ExecutionTimelineEntry,
  VerdictAction,
  RetryContext,
  PhaseRetryLimits,
  FailureRecord,
} from '../types/harness.js';
import { HarnessPreValidator } from './harness-prevalidation.js';
import {
  createDefaultExecutionRecord,
  DEFAULT_PHASE_RETRY_LIMITS,
} from '../types/harness.js';
import type { TaskMeta, TaskStatus, TaskRole, CheckpointMetadata, CommitHistoryEntry, TransitionNote, PhaseHistoryEntry, FailureReason, TaskFailureReason } from '../types/task.js';
import { Pipeline, normalizeStatus } from '../types/task.js';
import { readTaskMeta, writeTaskMeta, taskExists, updateTaskStatus, assignRole, incrementReopenCount, recordExecutionStats } from './task.js';
import { getProjectDir } from './path.js';
import { HarnessExecutor } from './harness-executor.js';
import { HarnessCodeReviewer } from './harness-code-reviewer.js';
import { HarnessQATester } from './harness-qa-tester.js';
import { HarnessEvaluator } from './harness-evaluator.js';
import { RetryHandler } from './harness-retry.js';
import { HarnessStatusReporter } from './harness-status-reporter.js';
import { saveRuntimeState } from '../commands/harness.js';
import { validateBasicFields, validateCheckpoints } from './quality-gate.js';
import { DependencyGraph, executeFailureCascade } from './dependency-graph/index.js';
import { SEPARATOR_WIDTH } from './format';

/** 阶段类型定义 (P4: 阶段内重试) */
type Phase = 'development' | 'code_review' | 'qa' | 'evaluation';

/** 阶段生命周期结果接口 (P4: 阶段内重试) */
interface PhaseLifecycleResult {
  success: boolean;
  phase: Phase;
  failedAt: 'pre_phase_gate' | 'phase_execution' | 'post_phase_gate' | 'unknown';
  attempt: number;
  reason: string;
  retryable: boolean;
  result?: DevReport | CodeReviewVerdict | QAVerdict | ReviewVerdict;
}

export class AssemblyLine {
  private config: HarnessConfig;
  private executor: HarnessExecutor;
  private codeReviewer: HarnessCodeReviewer;
  private qaTester: HarnessQATester;
  private evaluator: HarnessEvaluator;
  private retryHandler: RetryHandler;
  private statusReporter: HarnessStatusReporter;
  private preValidator: HarnessPreValidator;
  private sessionId?: string;
  /** 各任务的重试上下文，存储前次失败信息供重试时传递给 Claude */
  private taskRetryContexts: Map<string, RetryContext> = new Map();
  /** 执行记录存储（替代 state.records，避免双层状态架构） */
  private executionRecords: Map<string, TaskExecutionRecord> = new Map();

  constructor(config: HarnessConfig, sessionId?: string) {
    this.config = config;
    this.sessionId = sessionId;

    this.taskRetryContexts = new Map();
    this.executor = new HarnessExecutor(config);
    this.codeReviewer = new HarnessCodeReviewer(config);
    this.qaTester = new HarnessQATester(config);
    this.evaluator = new HarnessEvaluator(config);
    this.retryHandler = new RetryHandler(config);
    this.statusReporter = new HarnessStatusReporter(config.cwd, sessionId);
    this.preValidator = new HarnessPreValidator(config.cwd);
  }

  /**
   * 运行执行流水线
   */
  async run(state: HarnessRuntimeState): Promise<ExecutionSummary> {
    const startTime = new Date().toISOString();
    state.state = 'running';
    state.startTime = startTime;

    const hasBatches = (state.batchBoundaries?.length ?? 0) > 0;

    // 报告流水线开始
    // CP-25: 计算唯一任务数（去重，避免重试虚增）
    const uniqueTaskIds = new Set(state.taskQueue);
    this.statusReporter.startPipeline(uniqueTaskIds.size);

    const batchInfo = hasBatches
      ? `，${state.batchBoundaries!.length} 个批次`
      : '';
    console.log(`\n🚀 开始执行流水线，共 ${uniqueTaskIds.size} 个唯一任务 (队列长度 ${state.taskQueue.length})${batchInfo}\n`);

    // ============================================================
    // 【第一轮】预检测循环 (P1-PROB1)
    // ============================================================
    if (!state.preCheckCompleted) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 第一轮：预检测循环');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      state.state = 'pre_checking';

      // CP-P1-1: 初始化两轮循环数据结构
      state.readyTasks = [];
      state.preCheckFailedTasks = [];
      state.pendingPreCheckTasks = [];

      // 获取唯一任务ID列表（去重）
      const uniqueTaskIdsList = [...uniqueTaskIds];

      // 第一轮循环：循环检测所有任务
      const preCheckResult = await this.preValidator.runPreCheckLoop(uniqueTaskIdsList);

      // CP-P1-2: 检查第一轮完成状态
      console.log(`\n📊 预检测完成: ${preCheckResult.stats.passed} 通过, ${preCheckResult.stats.pendingDeps} 依赖未满足, ${preCheckResult.stats.failed} 失败`);

      // 如果有质量门禁失败，记录但不退出（允许继续执行已就绪的任务）
      if (preCheckResult.failedTasks.length > 0) {
        console.log(`\n⚠️  ${preCheckResult.failedTasks.length} 个任务预检测失败，将被跳过`);
        for (const failedTaskId of preCheckResult.failedTasks) {
          const result = preCheckResult.results.find(r => r.taskId === failedTaskId);
          state.preCheckFailedTasks?.push({
            taskId: failedTaskId,
            failedAt: 'pre_check',
            errors: result?.errors || ['预检测失败'],
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // 处理依赖未满足的任务（延后处理）
      if (preCheckResult.pendingTasks.length > 0) {
        console.log(`\n⏳ ${preCheckResult.pendingTasks.length} 个任务依赖未满足，将延后处理`);
        state.pendingPreCheckTasks = preCheckResult.pendingTasks;
      }

      // 所有通过预检测的任务进入 readyTasks
      state.readyTasks = preCheckResult.readyTasks;
      state.preCheckCompleted = true;

      console.log(`\n✅ ${state.readyTasks.length} 个任务通过预检测，进入执行阶段`);

      // 保存状态
      saveRuntimeState(state, this.config.cwd);
    }

    // ============================================================
    // 【第二轮】执行循环
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 第二轮：执行循环');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    state.state = 'executing';

    // CP-P1-3: 使用 readyTasks 进行第二轮执行
    // 如果没有预检测过，使用原始队列
    const executionQueue = state.readyTasks && state.readyTasks.length > 0
      ? state.readyTasks
      : state.taskQueue;

    const initialQueueLength = executionQueue.length;

    while (state.currentIndex < executionQueue.length) {
      const taskId = executionQueue[state.currentIndex];

      if (!taskId) {
        state.currentIndex++;
        continue;
      }

      // 检查任务是否存在
      if (!taskExists(taskId, this.config.cwd)) {
        console.log(`⚠️  任务 ${taskId} 不存在，跳过`);
        state.currentIndex++;
        continue;
      }

      console.log(`\n${'━'.repeat(SEPARATOR_WIDTH)}`);
      const batchPos = this.getBatchPosition(state.currentIndex, state);
      const batchPrefix = batchPos ? `[${batchPos.batchLabel} ${batchPos.taskInBatch}/${batchPos.batchSize}] ` : '';
      console.log(`📋 ${batchPrefix}处理任务 [${state.currentIndex + 1}/${state.taskQueue.length}]: ${taskId}`);
      console.log('━'.repeat(SEPARATOR_WIDTH));

      try {
        // 执行单个任务
        const record = await this.executeTask(taskId, state);

        // 记录结果
        this.executionRecords.set(taskId, record);

        // 任务级状态追踪
        if (!state.passedTasks) state.passedTasks = [];
        if (!state.failedTasks) state.failedTasks = [];
        if (!state.retryingTasks) state.retryingTasks = [];
        if (record.finalStatus === 'resolved' || record.finalStatus === 'closed') {
          state.passedTasks.push(taskId);
          this.statusReporter.recordTaskPassed(taskId);
          // CP-P16-PROGRESS: 任务完成，实时更新进度
          this.statusReporter.completeTaskProgress(taskId, true);
        } else if (record.finalStatus === 'failed') {
          state.failedTasks.push(taskId);
          this.statusReporter.recordTaskFailed(taskId, 'task_failed', 'execution');
          // CP-P16-PROGRESS: 任务失败，实时更新进度
          this.statusReporter.completeTaskProgress(taskId, false);

          // CP-P1-9: 记录失败原因
          if (!state.taskFailureReasons) {
            state.taskFailureReasons = new Map();
          }
          const lastFailedEntry = record.timeline.findLast(e => e.event === 'failed');
          const failureReason: TaskFailureReason = {
            taskId,
            failedAt: lastFailedEntry?.data?.failedAt || 'unknown',
            phase: lastFailedEntry?.data?.phase || 'unknown',
            reason: lastFailedEntry?.description || '执行失败',
            errorDetails: lastFailedEntry?.data?.errorDetails,
            timestamp: new Date().toISOString(),
            attemptNumber: record.retryCount + 1,
          };
          state.taskFailureReasons.set(taskId, failureReason);
          console.log(`   ❌ 任务 ${taskId} 执行失败: ${failureReason.reason}`);
          console.log(`      失败阶段: ${failureReason.phase}`);
          console.log(`      失败位置: ${failureReason.failedAt}`);

          // 上游失败级联：标记依赖该任务的下游任务为 failed
          this.cascadeFailureToDownstream(taskId, state);
          // CP-P1-8: 使用新的级联失败处理函数记录详细原因
          this.markDependentTasksAsFailed(state, taskId, failureReason);
        } else if (record.finalStatus === 'in_progress' && state.taskQueue.includes(taskId)) {
          state.retryingTasks.push(taskId);
          const retryCount = state.retryCounter.get(taskId) || 0;
          // 推断重试阶段：从最近的时间线条目获取
          const lastRetryEntry = record.timeline.findLast(e => e.event === 'retry');
          const retryPhase = lastRetryEntry?.data?.phase as string | undefined;
          const retryReason = lastRetryEntry?.description;
          const phaseLimit = retryPhase ? this.getPhaseRetryLimit(retryPhase as 'development' | 'code_review' | 'qa' | 'evaluation') : this.getPhaseRetryLimit('development');
          this.statusReporter.recordTaskRetrying(taskId, retryCount + 1, phaseLimit, retryPhase || 'development', retryReason);
        }

        // 更新状态
        state.currentIndex++;
        state.updatedAt = new Date().toISOString();

        // 更新进度报告
        const batchCtx = this.getBatchPosition(state.currentIndex, state);
        this.statusReporter.updateProgress(state.currentIndex, state.taskQueue.length,
          batchCtx ? {
            batchIndex: batchCtx.batchIndex,
            totalBatches: batchCtx.totalBatches,
            batchLabel: batchCtx.batchLabel,
          } : undefined
        );

        // 跨批次边界时输出批次摘要
        if (hasBatches && batchPos && batchCtx && batchPos.batchIndex !== batchCtx.batchIndex) {
          this.outputBatchSummary(state, batchPos.batchIndex);
          this.tagBatchCompletion(state, batchPos.batchIndex);
        }

        // 保存状态（用于中断恢复）
        saveRuntimeState(state, this.config.cwd);

      } catch (error) {
        console.error(`❌ 任务 ${taskId} 执行出错:`, error instanceof Error ? error.message : String(error));

        // 记录失败
        const task = readTaskMeta(taskId, this.config.cwd);
        if (task) {
          const record = createDefaultExecutionRecord(task);
          record.finalStatus = 'failed';
          record.timeline.push({
            timestamp: new Date().toISOString(),
            event: 'failed',
            description: `执行出错: ${error instanceof Error ? error.message : String(error)}`,
          });
          this.executionRecords.set(taskId, record);

          // 任务级状态追踪
          if (!state.failedTasks) state.failedTasks = [];
          state.failedTasks.push(taskId);
          this.statusReporter.recordTaskFailed(taskId, error instanceof Error ? error.message : String(error), 'execution');

          // CP-P1-9: 记录异常失败原因
          if (!state.taskFailureReasons) {
            state.taskFailureReasons = new Map();
          }
          const failureReason: TaskFailureReason = {
            taskId,
            failedAt: 'exception',
            phase: 'unknown',
            reason: error instanceof Error ? error.message : '执行异常',
            errorDetails: {
              stack: error instanceof Error ? error.stack : undefined,
              name: error instanceof Error ? error.name : undefined,
              message: error instanceof Error ? error.message : String(error),
            },
            timestamp: new Date().toISOString(),
            attemptNumber: 1,
          };
          state.taskFailureReasons.set(taskId, failureReason);

          console.log(`   ❌ 任务 ${taskId} 执行异常: ${failureReason.reason}`);

          // 上游失败级联
          this.cascadeFailureToDownstream(taskId, state);
          // CP-P1-8: 使用新的级联失败处理函数记录详细原因
          this.markDependentTasksAsFailed(state, taskId, failureReason);
        }

        state.currentIndex++;

        // 跨批次边界时输出批次摘要（错误路径）
        if (hasBatches && batchPos) {
          const nextBatch = this.getBatchPosition(state.currentIndex, state);
          if (nextBatch && batchPos.batchIndex !== nextBatch.batchIndex) {
            this.outputBatchSummary(state, batchPos.batchIndex);
            this.tagBatchCompletion(state, batchPos.batchIndex);
          }
        }
      }
    }

    // 输出最后一个批次的摘要
    if (hasBatches && state.batchBoundaries!.length > 0) {
      this.outputBatchSummary(state, state.batchBoundaries!.length - 1);
      this.tagBatchCompletion(state, state.batchBoundaries!.length - 1);
    }

    // CP-P1-10: 输出失败原因汇总
    this.printFailureSummary(state);

    // 生成摘要
    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

    // CP-25: totalTasks 使用唯一任务ID数，不因重试虚增
    const uniqueTaskCount = uniqueTaskIds.size;
    const records = Array.from(this.executionRecords.values());
    const summary: ExecutionSummary = {
      totalTasks: uniqueTaskCount,
      passed: records.filter(r => r.reviewVerdict?.result === 'PASS').length,
      failed: records.filter(r => r.reviewVerdict?.result === 'NOPASS' || r.devReport.status === 'failed').length,
      totalRetries: Array.from(state.retryCounter.values()).reduce((sum, count) => sum + count, 0),
      duration,
      startTime,
      endTime,
      taskResults: new Map(records.map(r => [r.taskId, r])),
      config: this.config,
    };

    // CP-23: state 仅表示进程级别状态，正常结束均为 completed
    // 个别任务失败记录在 HarnessStatusReport.failedTasks 中
    state.state = 'completed';

    // 完成流水线状态报告
    // CP-23: 始终使用 completePipeline，任务失败信息已在 failedTasks 中
    if (summary.failed === 0) {
      this.statusReporter.completePipeline(`流水线执行完成，${summary.passed}/${uniqueTaskCount} 任务通过`);
    } else {
      this.statusReporter.completePipeline(`流水线执行完成，${summary.passed}/${uniqueTaskCount} 通过，${summary.failed} 失败`);
    }

    return summary;
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    taskId: string,
    state: HarnessRuntimeState
  ): Promise<TaskExecutionRecord> {
    const task = readTaskMeta(taskId, this.config.cwd);
    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    const record = createDefaultExecutionRecord(task);

    // 添加时间线条目
    const addTimeline = (event: ExecutionTimelineEntry['event'], description: string, data?: Record<string, unknown>) => {
      record.timeline.push({
        timestamp: new Date().toISOString(),
        event,
        description,
        data,
      });
    };

    addTimeline('started', `开始执行任务: ${task.title}`);

    // CP-P16-PROGRESS: 开始任务进度追踪
    this.statusReporter.startTaskProgress(taskId, 'development');

    // 1. 检查依赖
    if (!await this.checkDependencies(task)) {
      console.log(`⚠️  依赖未完成，延后处理`);
      addTimeline('failed', '依赖未完成');
      record.finalStatus = 'needs_human';
      return record;
    }

    // 2. 检查任务是否已完成或已失败（跳过不可重试的终态）
    const completedStatuses: TaskStatus[] = ['resolved', 'closed', 'failed'];
    const normalizedTaskStatus = normalizeStatus(task.status) as TaskStatus;
    if (completedStatuses.includes(normalizedTaskStatus)) {
      console.log(`⏭️  任务 ${taskId} 已完成 (状态: ${task.status})，跳过`);
      addTimeline('skipped', `任务已完成，跳过执行: ${task.status}`, { status: task.status });
      record.finalStatus = task.status;
      return record;
    }

    // 3. Phase-skippable pipeline: determine resume phase via decision interface (C2)
    // Replaces deprecated resumeFrom mechanism with state-based determineResumePhase
    const phases = ['development', 'code_review', 'qa', 'evaluation'] as const;
    const resumePhase = this.determineResumePhase(taskId, normalizedTaskStatus, state);
    if (resumePhase === 'skip') {
      console.log(`⏭️  任务 ${taskId} 所有阶段已完成，跳过`);
      addTimeline('skipped', `任务所有阶段已完成，跳过执行`);
      record.finalStatus = task.status;
      return record;
    }
    let resumeIndex = phases.indexOf(resumePhase);

    // Find previous record for rebuilding prerequisite data when skipping phases
    const prevRecord = this.executionRecords.get(taskId);
    if (resumeIndex > 0 && !prevRecord) {
      console.log(`   ⚠️ 未找到前次执行记录，从开发阶段重新开始`);
    }

    // Phase execution loop - handles retries and downgrades gracefully
    let currentPhaseIndex = phases.indexOf(resumePhase);
    let devReport: DevReport | undefined;
    let codeReviewVerdict: CodeReviewVerdict | undefined;
    let qaVerdict: QAVerdict | undefined;

    while (currentPhaseIndex <= 3) {
      const phase = phases[currentPhaseIndex];

      if (phase === 'development') {
        // 4. Development phase (phase index 0)
        const shouldRunDev = currentPhaseIndex <= 0 || !prevRecord;
        if (shouldRunDev) {
          await this.ensureTransition(taskId, 'in_progress', '开始开发阶段');
          record.finalStatus = 'in_progress';

          addTimeline('dev_started', '开始开发阶段');
          this.statusReporter.startPhase('development', taskId, '开始开发阶段');
          console.log('\n🔨 开发阶段...');

          // 计算自适应超时
          const adaptiveTimeout = this.computeAdaptiveTimeout(task);

          // 超时提示：当预估耗时 > 15 分钟时建议拆分
          if ((task.estimatedMinutes ?? 0) > 15) {
            console.log(`   💡 提示: 此任务预估耗时 ${task.estimatedMinutes} 分钟，建议使用 task split 命令拆分为子任务`);
          }

          try {
            // Build retry context for development phase (carries previous failure info)
            const devRetryContext = this.buildRetryContextForPhase(taskId, 'development', state);
            devReport = await this.executor.execute(task, record.contract, adaptiveTimeout, devRetryContext);
            record.devReport = devReport;
            addTimeline('dev_completed', `开发完成: ${devReport.status}`, { status: devReport.status });
            this.statusReporter.completePhase('development', taskId, `开发完成: ${devReport.status}`);
          } catch (error) {
            devReport = {
              taskId,
              status: 'failed',
              changes: [],
              evidence: [],
              checkpointsCompleted: [],
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              duration: 0,
              error: error instanceof Error ? error.message : String(error),
            };
            record.devReport = devReport;
            addTimeline('dev_completed', `开发失败: ${devReport.error}`, { error: devReport.error });
            this.statusReporter.failPhase('development', error instanceof Error ? error : new Error(String(error)), taskId);
          }

          // 检查开发是否成功
          // CP-P4: 阶段内重试，不在此处处理重试逻辑
          if (devReport.status !== 'success') {
            const isTimeout = devReport.status === 'timeout';
            console.log(`❌ 开发阶段${isTimeout ? '超时' : '失败'}: ${devReport.error || '未知错误'}`);
            this.statusReporter.failPhase('development', new Error(devReport.error || '开发阶段失败'), taskId);

            // 存储失败原因到重试上下文
            this.storeFailureContext(taskId, 'development', devReport.error || '开发阶段失败', state);

            // CP-P4: 重试通过 executePhaseLifecycle 的 while 循环在阶段内完成
            // 此处直接标记失败，不再重新入队
            if (isTimeout) {
              // 超时标记为 failed(timeout)
              await this.markTaskFailed(taskId, 'timeout', `开发超时: ${devReport.error || '超过时间限制'}`);
              record.finalStatus = 'failed';
              addTimeline('failed', '开发超时，任务标记为 failed(timeout)');
              console.log(`   ⏰ 任务 ${taskId} 因超时标记为 failed(timeout)`);
            } else {
              // 开发失败，标记为 failed
              await this.markTaskFailed(taskId, 'execution_failed', `开发阶段失败: ${devReport.error || '未知错误'}`);
              record.finalStatus = 'failed';
              addTimeline('failed', '开发阶段失败，任务标记为 failed');
            }

            return record;
          }

          // 4.5 同步检查点状态（开发完成后）
          this.syncCheckpointStatus(taskId, 'development', { devReport });

          // 5. 更新状态为 wait_review（等待代码审核）
          await this.ensureTransition(taskId, 'wait_review', '开发完成，等待代码审核');
          record.finalStatus = 'wait_review';
          const devGateResult = this.validateTransitionCompleteness(taskId, 'wait_review', 'development');
          if (!devGateResult.valid) {
            await this.handleTransitionValidationFailure(taskId, 'wait_review', 'in_progress', 'development', devGateResult.errors);
          }
          console.log('✅ 开发完成，等待代码审核');
          this.savePhaseCheckpoint(taskId, 'development', state);
        } else {
          // Skip development - rebuild prerequisite data from prevRecord
          devReport = prevRecord?.devReport;
          if (devReport) {
            record.devReport = devReport;
            addTimeline('dev_completed', `[恢复] 复用前次开发结果: ${devReport.status}`, { resumed: true, phase: resumePhase });
            console.log(`   ⏩ 跳过开发阶段（已有完成报告）`);
          } else {
            console.log(`   ⚠️ 前次记录缺少开发报告，从开发阶段重新开始`);
            // 降级处理：重新执行开发阶段
            currentPhaseIndex = 0;
            continue;
          }
        }
      }

      if (phase === 'code_review') {
        // 5. Code review phase (phase index 1)
        const shouldRunCR = currentPhaseIndex <= 1;
        if (shouldRunCR) {
          // Ensure devReport is available before code review
          if (!devReport) {
            console.log(`   ⚠️ 代码审核阶段需要开发报告，但数据不可用，重新执行开发阶段`);
            currentPhaseIndex = 0;
            continue;
          }

          // CP-P16-PROGRESS: 更新任务阶段进度
          this.statusReporter.updateTaskPhase(taskId, 'code_review');

          addTimeline('code_review_started', '开始代码审核阶段');
          this.statusReporter.startPhase('code_review', taskId, '开始代码审核阶段');
          console.log('\n🔍 代码审核阶段...');

          try {
            const crRetryContext = this.buildRetryContextForPhase(taskId, 'code_review', state);
            codeReviewVerdict = await this.codeReviewer.review(task, devReport, crRetryContext);
            record.codeReviewVerdict = codeReviewVerdict;
            addTimeline('code_review_completed', `代码审核完成: ${codeReviewVerdict.result}`, { result: codeReviewVerdict.result });
            this.statusReporter.completePhase('code_review', taskId, `代码审核完成: ${codeReviewVerdict.result}`);
          } catch (error) {
            codeReviewVerdict = {
              taskId,
              result: 'NOPASS',
              reason: `代码审核出错: ${error instanceof Error ? error.message : String(error)}`,
              codeQualityIssues: [],
              failedCheckpoints: [],
              reviewedAt: new Date().toISOString(),
              reviewedBy: 'code_reviewer',
            };
            record.codeReviewVerdict = codeReviewVerdict;
            addTimeline('code_review_completed', `代码审核出错: ${codeReviewVerdict.reason}`, { error: codeReviewVerdict.reason });
            this.statusReporter.failPhase('code_review', error instanceof Error ? error : new Error(String(error)), taskId);
          }

          // 代码审核未通过，进入重试流程
          if (codeReviewVerdict.result !== 'PASS') {
            console.log(`❌ 代码审核未通过: ${codeReviewVerdict.reason}`);
            // 假失败检测：审核结果为 NOPASS 但无具体失败项
            if (this.detectFalseFailure('code_review', record)) {
              console.log(`   ⚠️ 检测到可能的假失败：审核标记为 NOPASS 但无具体失败项，重新检查`);
            }
            // 存储失败原因到重试上下文
            this.storeFailureContext(taskId, 'code_review', codeReviewVerdict.reason || '代码审核未通过', state);
            this.statusReporter.failPhase('code_review', new Error(codeReviewVerdict.reason || '代码审核未通过'), taskId);
            // P5: 统一使用 redevelop，移除 minor_fix 复杂分支
            return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'code_review', 'redevelop');
          }

          // 6.5 同步检查点状态（代码审核通过后）
          this.syncCheckpointStatus(taskId, 'code_review', { codeReviewVerdict });

          // 7. 更新状态为 wait_qa（等待 QA 验证）
          await this.ensureTransition(taskId, 'wait_qa', '代码审核通过，等待QA验证');
          record.finalStatus = 'wait_qa';
          const crGateResult = this.validateTransitionCompleteness(taskId, 'wait_qa', 'code_review');
          if (!crGateResult.valid) {
            await this.handleTransitionValidationFailure(taskId, 'wait_qa', 'wait_review', 'code_review', crGateResult.errors);
          }
          console.log('✅ 代码审核通过，等待 QA 验证');
          this.savePhaseCheckpoint(taskId, 'code_review', state);
        } else {
          // Skip code review - rebuild prerequisite data from prevRecord
          codeReviewVerdict = prevRecord?.codeReviewVerdict;
          if (codeReviewVerdict) {
            record.codeReviewVerdict = codeReviewVerdict;
            addTimeline('code_review_completed', `[恢复] 复用前次代码审核结果: ${codeReviewVerdict.result}`, { resumed: true });
            console.log(`   ⏩ 跳过代码审核阶段（已有完成报告）`);
          } else {
            console.log(`   ⚠️ 前次记录缺少代码审核结果，从代码审核阶段重新开始`);
            // 降级处理：重新执行代码审核阶段
            currentPhaseIndex = 1;
            continue;
          }
        }
      }

      if (phase === 'qa') {
        // 6. QA verification phase (phase index 2)
        const shouldRunQA = currentPhaseIndex <= 2;
        if (shouldRunQA) {
          // Ensure codeReviewVerdict is available before QA
          if (!codeReviewVerdict) {
            console.log(`   ⚠️ QA验证阶段需要代码审核结果，但数据不可用，重新执行代码审核阶段`);
            currentPhaseIndex = 1;
            continue;
          }

          // CP-P16-PROGRESS: 更新任务阶段进度
          this.statusReporter.updateTaskPhase(taskId, 'qa');

          addTimeline('qa_started', '开始 QA 验证阶段');
          this.statusReporter.startPhase('qa_verification', taskId, '开始 QA 验证阶段');
          console.log('\n🧪 QA 验证阶段...');

          try {
            // 构建重试上下文：传递前次失败信息给 QA
            const qaRetryContext = this.buildRetryContextForPhase(taskId, 'qa', state);
            qaVerdict = await this.qaTester.verify(task, codeReviewVerdict, qaRetryContext);
            record.qaVerdict = qaVerdict;
            addTimeline('qa_completed', `QA 验证完成: ${qaVerdict.result}`, {
              result: qaVerdict.result,
              requiresHuman: qaVerdict.requiresHuman
            });
            this.statusReporter.completePhase('qa_verification', taskId, `QA 验证完成: ${qaVerdict.result}`);
          } catch (error) {
            qaVerdict = {
              taskId,
              result: 'NOPASS',
              reason: `QA 验证出错: ${error instanceof Error ? error.message : String(error)}`,
              testFailures: [],
              failedCheckpoints: [],
              requiresHuman: false,
              humanVerificationCheckpoints: [],
              verifiedAt: new Date().toISOString(),
              verifiedBy: 'qa_tester',
            };
            record.qaVerdict = qaVerdict;
            addTimeline('qa_completed', `QA 验证出错: ${qaVerdict.reason}`, { error: qaVerdict.reason });
            this.statusReporter.failPhase('qa_verification', error instanceof Error ? error : new Error(String(error)), taskId);
          }

          // QA 验证未通过，进入重试流程
          if (qaVerdict.result !== 'PASS') {
            console.log(`❌ QA 验证未通过: ${qaVerdict.reason}`);
            // 假失败检测：QA 结果为 NOPASS 但无具体失败项
            if (this.detectFalseFailure('qa', record)) {
              console.log(`   ⚠️ 检测到可能的假失败：QA 标记为 NOPASS 但无具体失败项，重新检查`);
            }
            // 存储失败原因到重试上下文
            this.storeFailureContext(taskId, 'qa', qaVerdict.reason || 'QA 验证未通过', state);
            this.statusReporter.failPhase('qa_verification', new Error(qaVerdict.reason || 'QA 验证未通过'), taskId);
            // P5: 统一使用 redevelop，移除 minor_fix 复杂分支
            return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'qa', 'redevelop');
          }

          // 8.4 同步检查点状态（QA 通过后）
          this.syncCheckpointStatus(taskId, 'qa', { qaVerdict });
          // 8.5 QA 通过后转为 wait_evaluation 状态
          await this.ensureTransition(taskId, 'wait_evaluation', 'QA验证通过');
          // 8.6 质量门禁验证（QA 阶段完成后）
          const qaGateResult = this.validateTransitionCompleteness(taskId, 'wait_evaluation', 'qa');
          if (!qaGateResult.valid) {
            await this.handleTransitionValidationFailure(taskId, 'wait_evaluation', 'wait_qa', 'qa', qaGateResult.errors);
          }
          this.savePhaseCheckpoint(taskId, 'qa', state);
        } else {
          // Skip QA - rebuild prerequisite data from prevRecord
          qaVerdict = prevRecord?.qaVerdict;
          if (qaVerdict) {
            record.qaVerdict = qaVerdict;
            addTimeline('qa_completed', `[恢复] 复用前次QA结果: ${qaVerdict.result}`, { resumed: true });
            console.log(`   ⏩ 跳过QA验证阶段（已有完成报告）`);
          } else {
            console.log(`   ⚠️ 前次记录缺少QA验证结果，从QA验证阶段重新开始`);
            // 降级处理：重新执行 QA 阶段
            currentPhaseIndex = 2;
            continue;
          }
        }
      }

      if (phase === 'evaluation') {
        // 7. Final evaluation phase (phase index 3 - always runs)
        // Ensure devReport is available before evaluation
        if (!devReport) {
          console.log(`   ⚠️ 评估阶段需要开发报告，但数据不可用，重新执行开发阶段`);
          currentPhaseIndex = 0;
          continue;
        }

        // CP-P16-PROGRESS: 更新任务阶段进度
        this.statusReporter.updateTaskPhase(taskId, 'evaluation');

        addTimeline('review_started', '开始最终评估阶段');
        this.statusReporter.startPhase('evaluation', taskId, '开始最终评估阶段');
        console.log('\n🎯 最终评估阶段...');

        let verdict: ReviewVerdict;
        try {
          const evalRetryContext = this.buildRetryContextForPhase(taskId, 'evaluation', state);
          verdict = await this.evaluator.evaluate(task, devReport, record.contract, evalRetryContext);
          record.reviewVerdict = verdict;
          addTimeline('review_completed', `评估完成: ${verdict.result}`, { result: verdict.result });
          this.statusReporter.completePhase('evaluation', taskId, `评估完成: ${verdict.result}`);
        } catch (error) {
          verdict = {
            taskId,
            result: 'NOPASS',
            reason: `评估出错: ${error instanceof Error ? error.message : String(error)}`,
            failedCriteria: [],
            failedCheckpoints: [],
            reviewedAt: new Date().toISOString(),
            reviewedBy: 'harness-evaluator',
          };
          record.reviewVerdict = verdict;
          addTimeline('review_completed', `评估出错: ${verdict.reason}`, { error: verdict.reason });
          this.statusReporter.failPhase('evaluation', error instanceof Error ? error : new Error(String(error)), taskId);
        }

        // 11. 根据评估结果更新状态
        if (verdict.result === 'PASS') {
          // 评估通过后，将所有剩余 pending 检查点标记为 completed
          // 防止 resolved 状态与 verification.result=failed 矛盾
          this.syncAllPendingCheckpoints(taskId);

          // CP-1: 评估通过后分配任务角色（激活 assignTaskRole）
          await this.assignTaskRole(taskId, 'executor');

          // CP-7: 先执行状态转换，再验证，最后记录统计（修复竞态条件）
          const retryCount = state.retryCounter.get(taskId) || 0;
          await this.ensureTransition(taskId, 'resolved', '评估通过，任务完成');
          record.finalStatus = 'resolved';

          // 验证状态转换成功
          const evalGateResult = this.validateTransitionCompleteness(taskId, 'resolved', 'evaluation');
          if (!evalGateResult.valid) {
            await this.handleTransitionValidationFailure(taskId, 'resolved', 'wait_qa', 'evaluation', evalGateResult.errors);
          }

          // 状态确认后，再记录执行统计（避免与 ensureTransition 形成读写冲突）
          const taskStartTime = record.timeline[0]?.timestamp;
          const taskDuration = taskStartTime
            ? new Date().getTime() - new Date(taskStartTime).getTime()
            : 0;
          try {
            recordExecutionStats(taskId, {
              duration: taskDuration,
              retryCount,
              completedAt: new Date().toISOString(),
              branch: task.branch,
            }, this.config.cwd);
          } catch (error) {
            console.error(`   ⚠️ 记录执行统计失败: ${error instanceof Error ? error.message : String(error)}`);
          }
          record.retryCount = retryCount;
          console.log('✅ 评估通过！');
          this.savePhaseCheckpoint(taskId, 'evaluation', state);
          addTimeline('completed', '任务完成');
        } else {
          console.log(`❌ 评估未通过: ${verdict.reason}`);
          this.statusReporter.failPhase('evaluation', new Error(verdict.reason || '评估未通过'), taskId);
          const failRecord = await this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'evaluation', verdict.action);
          // 质量门禁验证（评估失败路径）
          const failStatus = failRecord.finalStatus as TaskStatus;
          if (failStatus !== 'abandoned') {
            const evalFailGate = this.validateTransitionCompleteness(taskId, failStatus, 'evaluation');
            if (!evalFailGate.valid) {
              await this.handleTransitionValidationFailure(taskId, failStatus, 'wait_qa', 'evaluation', evalFailGate.errors);
            }
          }
          return failRecord;
        }

        // Evaluation phase completed - exit loop
        break;
      }

      // Increment phase index to move to next phase
      currentPhaseIndex++;
    }

    return record;
  }

  /**
   * P4: 阶段生命周期执行方法（含阶段内重试循环）
   *
   * 在每个阶段内部实现 while 循环重试，移除重新入队逻辑。
   * 重试在阶段内完成，不入队，保持队列稳定。
   *
   * @param taskId - 任务ID
   * @param phase - 当前阶段
   * @param state - 运行时状态
   * @param executePhaseFn - 阶段执行函数
   * @param onSuccess - 阶段成功回调
   * @returns PhaseLifecycleResult - 阶段执行结果
   */
  private async executePhaseLifecycle<T extends DevReport | CodeReviewVerdict | QAVerdict | ReviewVerdict>(
    taskId: string,
    phase: Phase,
    state: HarnessRuntimeState,
    executePhaseFn: () => Promise<T>,
    onSuccess: (result: T) => void
  ): Promise<PhaseLifecycleResult> {
    const maxRetries = this.getPhaseRetryLimit(phase);
    let attempt = 0;

    console.log(`\n🔨 [${phase}] 开始阶段执行生命周期 (最多${maxRetries}次重试)`);

    // CP-P4-1: 阶段内 while 循环实现重试
    while (attempt <= maxRetries) {
      attempt++;
      console.log(`\n   [${phase}] 第 ${attempt}/${maxRetries + 1} 次尝试`);

      // 阶段前质量门禁检查
      const canProceed = await this.checkPhasePreConditions(taskId, phase, state);
      if (!canProceed) {
        console.log(`   ❌ 阶段前置条件检查失败`);

        if (attempt <= maxRetries) {
          console.log(`   🔄 前置条件不满足，准备重试...`);
          continue; // CP-P4-2: 阶段内重试，不入队
        }

        return {
          success: false,
          phase,
          failedAt: 'pre_phase_gate',
          attempt,
          reason: `阶段前置条件检查失败`,
          retryable: false,
        };
      }
      console.log(`   ✅ 阶段前置条件检查通过`);

      // 执行阶段
      console.log(`   🔨 执行阶段...`);
      let phaseResult: T;
      try {
        phaseResult = await executePhaseFn();
        onSuccess(phaseResult);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`   ❌ 阶段执行失败: ${errorMsg}`);

        // 存储失败原因到重试上下文
        this.storeFailureContext(taskId, phase, errorMsg, state);

        if (attempt <= maxRetries) {
          console.log(`   🔄 阶段执行失败，准备重试...`);
          this.incrementPhaseRetryCount(taskId, phase, state);
          state.retryCounter.set(taskId, (state.retryCounter.get(taskId) || 0) + 1);
          continue; // CP-P4-2: 阶段内重试，不入队
        }

        return {
          success: false,
          phase,
          failedAt: 'phase_execution',
          attempt,
          reason: `阶段执行失败（${attempt}次尝试）: ${errorMsg}`,
          retryable: false,
        };
      }
      console.log(`   ✅ 阶段执行成功`);

      // 阶段后质量门禁（验证阶段结果）
      const postGatePassed = this.validatePhaseResult(phase, phaseResult);
      if (!postGatePassed) {
        console.log(`   ❌ 阶段后质量门禁失败`);

        if (attempt <= maxRetries) {
          console.log(`   🔄 阶段输出不符合要求，准备重试...`);
          this.incrementPhaseRetryCount(taskId, phase, state);
          state.retryCounter.set(taskId, (state.retryCounter.get(taskId) || 0) + 1);
          continue; // CP-P4-2: 阶段内重试，不入队
        }

        return {
          success: false,
          phase,
          failedAt: 'post_phase_gate',
          attempt,
          reason: `阶段后质量门禁失败（${attempt}次尝试）`,
          retryable: false,
        };
      }
      console.log(`   ✅ 阶段后质量门禁通过`);

      // 阶段执行完成
      console.log(`   ✅ [${phase}] 阶段执行完成（第${attempt}次尝试成功）`);

      return {
        success: true,
        phase,
        attempt,
        result: phaseResult,
        reason: '阶段执行成功',
        retryable: false,
      };
    }

    // 重试次数耗尽
    return {
      success: false,
      phase,
      failedAt: 'unknown',
      attempt,
      reason: `重试次数耗尽（${attempt}次尝试）`,
      retryable: false,
    };
  }

  /**
   * 检查阶段前置条件
   */
  private async checkPhasePreConditions(
    taskId: string,
    phase: Phase,
    state: HarnessRuntimeState
  ): Promise<boolean> {
    // 验证任务存在
    const task = readTaskMeta(taskId, this.config.cwd);
    if (!task) {
      console.log(`   ⚠️ 任务 ${taskId} 不存在`);
      return false;
    }

    // 验证依赖是否完成
    if (phase === 'development') {
      const depsCompleted = await this.checkDependencies(task);
      if (!depsCompleted) {
        console.log(`   ⏳ 依赖未完成，延后处理`);
        return false;
      }
    }

    return true;
  }

  /**
   * 验证阶段结果
   */
  private validatePhaseResult(
    phase: Phase,
    result: DevReport | CodeReviewVerdict | QAVerdict | ReviewVerdict
  ): boolean {
    switch (phase) {
      case 'development':
        return (result as DevReport).status === 'success';
      case 'code_review':
        return (result as CodeReviewVerdict).result === 'PASS';
      case 'qa':
        return (result as QAVerdict).result === 'PASS';
      case 'evaluation':
        return (result as ReviewVerdict).result === 'PASS';
      default:
        return false;
    }
  }

  /**
   * 保存阶段检查点到运行时状态
   * 在每个阶段完成后立即调用，确保护进程崩溃时可从该检查点恢复
   */
  private savePhaseCheckpoint(
    taskId: string,
    completedPhase: 'development' | 'code_review' | 'qa' | 'evaluation',
    state: HarnessRuntimeState
  ): void {
    state.taskPhaseCheckpoints.set(taskId, {
      completedPhase,
      completedAt: new Date().toISOString(),
    });
    saveRuntimeState(state, this.config.cwd);
    console.log(`   💾 检查点已保存: ${taskId} @ ${completedPhase}`);
  }

  /**
   * 同步检查点状态
   * 在流水线阶段完成后，根据阶段结果自动更新对应检查点为 completed
   */
  private syncCheckpointStatus(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa',
    phaseData?: {
      devReport?: DevReport;
      codeReviewVerdict?: CodeReviewVerdict;
      qaVerdict?: QAVerdict;
    }
  ): void {
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (!task?.checkpoints?.length) return;

      const now = new Date().toISOString();
      let updated = false;

      for (const checkpoint of task.checkpoints) {
        // 跳过已完成/已跳过的检查点
        if (checkpoint.status === 'completed' || checkpoint.status === 'skipped') continue;

        const shouldComplete = this.matchCheckpointToPhase(checkpoint, phase, phaseData);
        if (!shouldComplete) continue;

        checkpoint.status = 'completed';
        checkpoint.updatedAt = now;
        checkpoint.note = `${phase} 阶段通过后自动同步`;

        if (!checkpoint.verification) {
          checkpoint.verification = { method: 'automated' };
        }
        checkpoint.verification.result = 'passed';
        checkpoint.verification.verifiedAt = now;
        checkpoint.verification.verifiedBy = `${phase}_phase`;

        updated = true;
        console.log(`   ✓ 检查点 ${checkpoint.id} 已自动标记为 completed (${phase})`);
      }

      if (updated) {
        writeTaskMeta(task, this.config.cwd);
      }
    } catch (error) {
      console.error(`   ⚠️ 同步检查点状态失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 判断检查点是否应在指定阶段后标记为完成
   */
  private matchCheckpointToPhase(
    checkpoint: CheckpointMetadata,
    phase: 'development' | 'code_review' | 'qa',
    phaseData?: {
      devReport?: DevReport;
      codeReviewVerdict?: CodeReviewVerdict;
      qaVerdict?: QAVerdict;
    }
  ): boolean {
    const method = checkpoint.verification?.method;
    const category = checkpoint.category;

    switch (phase) {
      case 'development': {
        // 开发完成后，标记不属于 code_review/qa 的通用检查点
        const belongsToCodeReview = category === 'code_review'
          || method === 'code_review' || method === 'lint' || method === 'architect_review';
        const belongsToQA = category === 'qa_verification'
          || method === 'unit_test' || method === 'functional_test'
          || method === 'integration_test' || method === 'e2e_test';

        if (belongsToCodeReview || belongsToQA) return false;

        // 通用检查点：开发成功即完成
        return true;
      }

      case 'code_review': {
        // 代码审核通过后，标记 code_review 类型检查点
        const isCodeReviewType = category === 'code_review'
          || method === 'code_review'
          || method === 'lint'
          || method === 'architect_review';
        return isCodeReviewType;
      }

      case 'qa': {
        // QA 通过后，标记 QA 类型检查点（排除人工验证）
        if (checkpoint.requiresHuman) return false;
        const isQAType = category === 'qa_verification'
          || method === 'unit_test'
          || method === 'functional_test'
          || method === 'integration_test'
          || method === 'e2e_test'
          || method === 'automated';
        return isQAType;
      }

      default:
        return false;
    }
  }

  /**
   * 评估通过后，将所有剩余 pending 检查点标记为 completed
   * 防止 resolved 状态下 verification.result=failed / checkpointCompletionRate=0 的矛盾
   */
  private syncAllPendingCheckpoints(taskId: string): void {
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (!task?.checkpoints?.length) return;

      const now = new Date().toISOString();
      let updated = false;

      for (const checkpoint of task.checkpoints) {
        if (checkpoint.status === 'pending') {
          checkpoint.status = 'completed';
          checkpoint.updatedAt = now;
          checkpoint.note = `${checkpoint.note ? checkpoint.note + '; ' : ''}评估通过后自动同步`;

          if (!checkpoint.verification) {
            checkpoint.verification = { method: 'automated' };
          }
          checkpoint.verification.result = 'passed';
          checkpoint.verification.verifiedAt = now;
          checkpoint.verification.verifiedBy = 'evaluation_sync';

          updated = true;
          console.log(`   ✓ 检查点 ${checkpoint.id} 已在评估通过后自动标记为 completed`);
        }
      }

      if (updated) {
        writeTaskMeta(task, this.config.cwd);
      }
    } catch (error) {
      console.error(`   ⚠️ 评估通过后同步检查点状态失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查依赖是否完成
   *
   * 支持轮询等待 in_progress 状态的依赖任务：
   * - 轮询间隔：5 秒
   * - 超时时间：30 分钟（1800 秒）
   * - 如果依赖完成（resolved/closed），返回 true
   * - 如果依赖失败（failed/abandoned），返回 false
   * - 如果超时，返回 false
   *
   * 简化实现：直接从 task.meta.json 读取依赖任务状态，
   * 不再使用 state.records 内存缓存层。
   * 在单进程串行执行模式下，文件读取性能足够且避免状态不一致风险。
   */
  private async checkDependencies(task: TaskMeta): Promise<boolean> {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    const POLLING_INTERVAL_MS = 5000; // 5 秒轮询间隔
    const TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟超时
    const startTime = Date.now();

    // 轮询循环，直到所有依赖完成或超时
    while (Date.now() - startTime < TIMEOUT_MS) {
      let allDependenciesCompleted = true;
      let hasFailedDependency = false;

      for (const depId of task.dependencies) {
        // 直接从文件读取依赖任务状态
        const depTask = readTaskMeta(depId, this.config.cwd);
        if (!depTask) {
          console.log(`⚠️  依赖任务 ${depId} 不存在`);
          continue;
        }

        const normalizedStatus = normalizeStatus(depTask.status);

        // 检查依赖是否已完成
        if (normalizedStatus === 'resolved' || normalizedStatus === 'closed') {
          continue; // 依赖已完成，继续检查下一个
        }

        // 检查依赖是否已失败
        if (normalizedStatus === 'failed' || normalizedStatus === 'abandoned') {
          console.log(`⚠️  依赖任务 ${depId} 已失败 (状态: ${depTask.status})`);
          hasFailedDependency = true;
          break;
        }

        // 依赖仍在进行中（in_progress 或其他中间状态）
        allDependenciesCompleted = false;
        console.log(`⏳ 等待依赖任务 ${depId} 完成 (状态: ${depTask.status})...`);
      }

      // 如果发现有失败的依赖，立即返回 false
      if (hasFailedDependency) {
        return false;
      }

      // 如果所有依赖都已完成，返回 true
      if (allDependenciesCompleted) {
        return true;
      }

      // 等待轮询间隔后再次检查
      console.log(`   ⏱️  轮询等待中... (${Math.round((Date.now() - startTime) / 1000)}s / ${TIMEOUT_MS / 1000}s)`);
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
    }

    // 超时
    console.log(`⚠️  依赖检查超时 (${TIMEOUT_MS / 1000 / 60} 分钟)`);
    return false;
  }

  /**
   * 更新任务状态（程序化更新）
   */
  private async updateTaskStatus(taskId: string, status: TaskStatus, reason?: string): Promise<void> {
    try {
      updateTaskStatus(taskId, status, this.config.cwd, reason);
    } catch (error) {
      console.error(`更新任务状态失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 标记任务为 failed 并记录 failureReason
   */
  private async markTaskFailed(taskId: string, reason: FailureReason, message: string): Promise<void> {
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (task) {
        task.failureReason = reason;
        writeTaskMeta(task, this.config.cwd);
      }
      await this.ensureTransition(taskId, 'failed', message);
    } catch (error) {
      console.error(`标记任务失败失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 上游失败级联：当任务失败时，将依赖该任务的下游任务标记为 failed
   *
   * 使用 dependency-graph/cascade.ts 的 executeFailureCascade 替代内联线性扫描，
   * 支持多级传递级联（A→B→C），而非仅直接依赖。
   */
  private cascadeFailureToDownstream(failedTaskId: string, state: HarnessRuntimeState): void {
    // 收集队列中剩余任务的元数据
    const remainingMeta = new Map<string, TaskMeta>();
    for (let i = state.currentIndex + 1; i < state.taskQueue.length; i++) {
      const taskId = state.taskQueue[i];
      if (taskId && !remainingMeta.has(taskId)) {
        const task = readTaskMeta(taskId, this.config.cwd);
        if (task) remainingMeta.set(taskId, task);
      }
    }

    if (remainingMeta.size === 0) return;

    // 通过依赖图模块计算级联影响（支持多级传递）
    const graph = DependencyGraph.fromTasks([...remainingMeta.values()]);
    const completedTaskIds = new Set(
      Array.from(this.executionRecords.values())
        .filter(r => r.finalStatus === 'resolved')
        .map(r => r.taskId)
    );
    const { affectedTasks } = executeFailureCascade(
      failedTaskId, graph, this.config.cwd, completedTaskIds
    );

    if (affectedTasks.length === 0) return;

    // 对受影响任务执行标记和记录
    const affectedSet = new Set(affectedTasks);
    const toRemove: number[] = [];
    const now = new Date().toISOString();

    for (let i = state.currentIndex + 1; i < state.taskQueue.length; i++) {
      const downstreamId = state.taskQueue[i];
      if (!downstreamId || !affectedSet.has(downstreamId)) continue;

      const downstreamTask = remainingMeta.get(downstreamId);
      if (!downstreamTask) continue;

      console.log(`   ⛓️  上游失败级联: 任务 ${downstreamId} 因上游 ${failedTaskId} 失败，标记为 failed(upstream_failed)`);

      // 标记下游任务为 failed
      try {
        const previousStatus = downstreamTask.status;
        downstreamTask.status = 'failed';
        downstreamTask.failureReason = 'upstream_failed';
        downstreamTask.updatedAt = now;
        if (!downstreamTask.transitionNotes) {
          downstreamTask.transitionNotes = [];
        }
        downstreamTask.transitionNotes.push({
          timestamp: now,
          fromStatus: previousStatus,
          toStatus: 'failed',
          note: `上游任务 ${failedTaskId} 失败，级联标记为 failed(upstream_failed)`,
          author: 'assembly-line-cascade',
        });
        writeTaskMeta(downstreamTask, this.config.cwd);
      } catch (err) {
        console.error(`   ⚠️ 级联标记 ${downstreamId} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 创建执行记录
      const cascadeRecord = createDefaultExecutionRecord(downstreamTask);
      cascadeRecord.finalStatus = 'failed';
      cascadeRecord.timeline.push({
        timestamp: now,
        event: 'failed',
        description: `上游任务 ${failedTaskId} 失败，级联跳过`,
        data: { upstreamTaskId: failedTaskId, failureReason: 'upstream_failed' },
      });
      this.executionRecords.set(downstreamId, cascadeRecord);

      if (!state.failedTasks) state.failedTasks = [];
      state.failedTasks.push(downstreamId);

      this.statusReporter.recordTaskFailed(downstreamId, `upstream_failed: ${failedTaskId}`, 'cascade');

      // 存储上游失败信息到重试上下文（CP-19: 供 task reopen 恢复时使用）
      this.taskRetryContexts.set(downstreamId, {
        previousFailureReason: `上游任务 ${failedTaskId} 失败，级联标记为 failed`,
        previousPhase: 'development',
        attemptNumber: 1,
        upstreamFailureInfo: {
          taskId: failedTaskId,
          reason: 'upstream_failed',
          failedAt: now,
        },
      });

      toRemove.push(i);
    }

    // 从队列中移除被级联失败的任务（倒序移除以避免索引偏移）
    for (let i = toRemove.length - 1; i >= 0; i--) {
      state.taskQueue.splice(toRemove[i]!, 1);
    }
  }

  /**
   * 分配任务角色（程序化更新）
   */
  private async assignTaskRole(taskId: string, role: TaskRole): Promise<void> {
    try {
      assignRole(taskId, role, this.config.cwd);
    } catch (error) {
      console.error(`分配任务角色失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 递增重开次数（程序化更新）
   */
  private async incrementTaskReopenCount(taskId: string, reason: string): Promise<void> {
    try {
      incrementReopenCount(taskId, reason, this.config.cwd);
    } catch (error) {
      console.error(`递增重开次数失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * P5: 基于评估者动作的状态路由（简化版）
   *
   * 根据 architect 评估者输出的 action 关键字驱动不同的状态流转：
   * - resolve: 直接标记为 resolved（评估通过）
   * - redevelop: 从开发阶段重试（消耗重试次数，统一使用阶段内重试）
   * - escalate_human: 转为 needs_human 状态
   *
   * P5 变更：移除 minor_fix, retest, reevaluate 复杂分支
   * 所有重试统一通过 executePhaseLifecycle 的阶段内重试处理
   */
  private async handleVerdictBasedTransition(
    taskId: string,
    record: TaskExecutionRecord,
    state: HarnessRuntimeState,
    addTimeline: (event: ExecutionTimelineEntry['event'], description: string, data?: Record<string, unknown>) => void,
    phase: 'code_review' | 'qa' | 'evaluation',
    verdictAction?: VerdictAction,
  ): Promise<TaskExecutionRecord> {
    // 确定有效的 action
    // 对于 code_review/qa 阶段（无 architect verdict），默认 redevelop
    const action: VerdictAction = verdictAction ?? 'redevelop';

    switch (action) {
      case 'resolve': {
        // architect 判定通过，直接 resolved
        await this.ensureTransition(taskId, 'resolved', `architect 建议完成 (action: resolve, phase: ${phase})`);
        record.finalStatus = 'resolved';
        addTimeline('completed', 'architect 建议完成', { action, phase });
        console.log('✅ architect 建议完成任务');
        return record;
      }

      case 'redevelop':
      case 'minor_fix': {
        // CP-10: minor_fix 和 redevelop 都从开发阶段重试
        const devPhaseLimit = this.getPhaseRetryLimit('development');
        const devRetryCount = this.getPhaseRetryCount(taskId, 'development', state);
        if (devRetryCount >= devPhaseLimit) {
          await this.markTaskFailed(taskId, 'max_retries_exceeded', `开发阶段重试次数已达上限 (${devPhaseLimit})`);
          record.finalStatus = 'failed';
          record.retryCount = devRetryCount;
          addTimeline('failed', `开发阶段重试次数已达上限 (${devPhaseLimit})，任务标记为 failed`);
          console.log(`❌ 开发阶段重试次数已达上限 (${devPhaseLimit})，任务标记为 failed`);
          return record;
        }

        // P5: 统一使用阶段内重试，消耗重试次数，从开发阶段重试
        this.incrementTaskReopenCount(taskId, `${phase} 阶段失败，从开发阶段重试`);
        await this.ensureTransition(taskId, 'in_progress', `${phase} 阶段失败，从开发阶段重试`);
        // 设置 resumeAction 和角色感知恢复
        await this.setTaskResumeAction(taskId, 'retry', 'development');
        await this.assignTaskRole(taskId, 'executor');
        // 记录阶段历史
        this.appendPhaseHistory(taskId, { phase: 'development', role: 'executor', verdict: 'NOPASS', timestamp: new Date().toISOString(), analysis: `${phase} 阶段失败，retry from development`, resumeAction: 'retry' });
        this.incrementPhaseRetryCount(taskId, 'development', state);
        state.retryCounter.set(taskId, (state.retryCounter.get(taskId) || 0) + 1);

        addTimeline('retry', `任务将从开发阶段重试 (第 ${devRetryCount + 1}/${devPhaseLimit} 次)`, { action, phase });
        console.log(`⚠️  任务将从开发阶段重试 (第 ${devRetryCount + 1}/${devPhaseLimit} 次)`);
        this.statusReporter.recordTaskRetrying(taskId, devRetryCount + 1, devPhaseLimit, 'development', `${phase} 阶段失败，从开发阶段重试`);
        record.finalStatus = 'in_progress';
        record.retryCount = devRetryCount + 1;
        // P5: 返回记录，由 executeTask 的阶段循环处理重试
        return record;
      }

      case 'retest': {
        // CP-11: retest 从 QA 阶段重试
        const qaPhaseLimit = this.getPhaseRetryLimit('qa');
        const qaRetryCount = this.getPhaseRetryCount(taskId, 'qa', state);
        if (qaRetryCount >= qaPhaseLimit) {
          // QA 重试次数用尽，回退到开发阶段重试
          console.log(`⚠️  QA 阶段重试次数已达上限 (${qaPhaseLimit})，回退到开发阶段重试`);
          return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, phase, 'redevelop');
        }

        await this.ensureTransition(taskId, 'wait_qa', `${phase} 阶段失败，从 QA 阶段重试`);
        this.incrementPhaseRetryCount(taskId, 'qa', state);
        addTimeline('retry', `任务将从 QA 阶段重试 (第 ${qaRetryCount + 1}/${qaPhaseLimit} 次)`, { action, phase });
        console.log(`⚠️  任务将从 QA 阶段重试 (第 ${qaRetryCount + 1}/${qaPhaseLimit} 次)`);
        record.finalStatus = 'wait_qa';
        return record;
      }

      case 'reevaluate': {
        // CP-12: reevaluate 从评估阶段重试
        // Check reevaluateCounter limit (MAX_REEVALUATE_ATTEMPTS = 2)
        const MAX_REEVALUATE_ATTEMPTS = 2;
        const reevaluateCount = state.reevaluateCounter.get(taskId) || 0;
        if (reevaluateCount >= MAX_REEVALUATE_ATTEMPTS) {
          // 评估重试次数用尽，回退到开发阶段重试
          console.log(`⚠️  评估重试次数已达上限 (${MAX_REEVALUATE_ATTEMPTS})，回退到开发阶段重试`);
          return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, phase, 'redevelop');
        }

        await this.ensureTransition(taskId, 'wait_evaluation', `${phase} 阶段失败，从评估阶段重试`);
        this.incrementPhaseRetryCount(taskId, 'evaluation', state);
        // CP-12: reevaluate increments reevaluateCounter but not retryCounter
        state.reevaluateCounter.set(taskId, reevaluateCount + 1);
        addTimeline('retry', `任务将从评估阶段重试 (第 ${reevaluateCount + 1}/${MAX_REEVALUATE_ATTEMPTS} 次)`, { action, phase });
        console.log(`⚠️  任务将从评估阶段重试 (第 ${reevaluateCount + 1}/${MAX_REEVALUATE_ATTEMPTS} 次)`);
        record.finalStatus = 'wait_evaluation';
        return record;
      }

      case 'escalate_human': {
        // CP-17: escalate_human 转到 open 状态（人工处理）
        await this.ensureTransition(taskId, 'open', `architect 建议人工介入 (action: escalate_human)`);
        record.finalStatus = 'open';
        addTimeline('failed', 'architect 建议人工介入', { action });
        console.log('🔴 任务需要人工介入');
        return record;
      }

      default: {
        // P5: 未知 action，安全回退到 redevelop（简化后的唯一重试路径）
        console.log(`⚠️  未知的 verdict action: ${action}，回退到 redevelop`);
        return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, phase, 'redevelop');
      }
    }
  }

  /**
   * 程序化状态变更保证
   *
   * 执行状态转换并验证转换是否成功，最多重试 3 次。
   * 确保文件系统中的任务状态与预期一致。
   * 同时写入 transitionNote 记录流转上下文。
   */
  private async ensureTransition(
    taskId: string,
    targetStatus: TaskStatus,
    reason?: string,
  ): Promise<void> {
    const MAX_ENSURE_ATTEMPTS = 3;

    // 先读取当前状态用于记录 fromStatus
    const taskBefore = readTaskMeta(taskId, this.config.cwd);
    const fromStatus = taskBefore?.status;

    for (let attempt = 1; attempt <= MAX_ENSURE_ATTEMPTS; attempt++) {
      try {
        await this.updateTaskStatus(taskId, targetStatus, reason);

        // 验证转换是否生效
        const task = readTaskMeta(taskId, this.config.cwd);
        if (task?.status === targetStatus) {
          // 写入 transitionNote（附带 author/decision/analysis/context）
          this.addTransitionNote(task, fromStatus, targetStatus, reason);
          return; // 转换已验证
        }

        if (attempt < MAX_ENSURE_ATTEMPTS) {
          console.log(`   ⚠️ ensureTransition: 状态验证未通过 (尝试 ${attempt}/${MAX_ENSURE_ATTEMPTS})，重试...`);
        }
      } catch (error) {
        if (attempt < MAX_ENSURE_ATTEMPTS) {
          console.log(`   ⚠️ ensureTransition: 转换失败 (尝试 ${attempt}/${MAX_ENSURE_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    console.error(`   ❌ ensureTransition: 无法验证 ${taskId} 的状态转换为 ${targetStatus} (已尝试 ${MAX_ENSURE_ATTEMPTS} 次)`);
  }

  /**
   * 写入 transitionNote 到任务元数据
   * 每次状态变更时追加完整的流转上下文
   */
  private addTransitionNote(
    task: TaskMeta,
    fromStatus: TaskStatus | undefined,
    toStatus: TaskStatus,
    reason?: string,
  ): void {
    try {
      if (!task.transitionNotes) {
        task.transitionNotes = [];
      }
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: fromStatus || 'open',
        toStatus,
        note: reason || `状态流转至 ${toStatus}`,
        author: 'assembly-line',
      });
      writeTaskMeta(task, this.config.cwd);
    } catch (error) {
      console.error(`   ⚠️ 写入 transitionNote 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 验证阶段流转完整性
   *
   * 在每个阶段完成后程序化检测：
   * 1. 任务状态是否正确变更为预期值
   * 2. 最新 transitionNote 条目是否包含有效的决策记录（note 非空且 toStatus 匹配）
   *
   * @param taskId - 任务ID
   * @param expectedStatus - 阶段完成后期望的任务状态
   * @param phase - 阶段名称（用于日志和错误信息）
   * @returns 验证结果
   */
  private validateTransitionCompleteness(
    taskId: string,
    expectedStatus: TaskStatus,
    phase: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (!task) {
        errors.push(`任务 ${taskId} 不存在，无法验证流转完整性`);
        return { valid: false, errors };
      }

      // 复用 quality-gate.ts 的 validateBasicFields 做基础字段兜底检查
      const basicResult = validateBasicFields(task);
      if (!basicResult.valid) {
        if (this.config.forceContinue) {
          console.warn(`   ⚠️ 基础字段验证失败 (--force-continue 跳过阻塞):`);
          for (const err of basicResult.errors) {
            console.warn(`      - ${err}`);
          }
        } else {
          errors.push(...basicResult.errors);
        }
      }

      // 复用 quality-gate.ts 的 validateCheckpoints 做检查点结构验证
      // 确保初始化阶段和转换阶段的检查点规则一致
      const checkpointViolations = validateCheckpoints(task);
      if (checkpointViolations.length > 0) {
        if (this.config.forceContinue) {
          console.warn(`   ⚠️ 检查点验证失败 (--force-continue 跳过阻塞):`);
          for (const violation of checkpointViolations) {
            console.warn(`      - [${violation.severity}] ${violation.message}`);
          }
        } else {
          for (const violation of checkpointViolations) {
            errors.push(`[${violation.severity}] ${violation.message}`);
          }
        }
      }

      // 检查 1: 任务状态是否与期望一致
      if (task.status !== expectedStatus) {
        errors.push(
          `状态不匹配: 期望 ${expectedStatus}, 实际 ${task.status} (阶段: ${phase})`
        );
      }

      // 检查 2: 最新 transitionNote 是否包含有效决策记录
      const notes = task.transitionNotes;
      if (!notes || notes.length === 0) {
        errors.push(
          `transitionNotes 为空，缺少流转记录 (阶段: ${phase}, 期望状态: ${expectedStatus})`
        );
      } else {
        const latest = notes[notes.length - 1]!;
        // 检查 note 字段（决策说明）非空
        if (!latest.note || latest.note.trim().length === 0) {
          errors.push(
            `最新 transitionNote 缺少决策说明 (阶段: ${phase})`
          );
        }
        // 检查 toStatus 与期望一致
        if (latest.toStatus !== expectedStatus) {
          errors.push(
            `transitionNote.toStatus 不匹配: 期望 ${expectedStatus}, 实际 ${latest.toStatus} (阶段: ${phase})`
          );
        }
      }

      if (errors.length > 0) {
        console.error(`   🚨 质量门禁验证失败 [${phase} -> ${expectedStatus}]:`);
        for (const err of errors) {
          console.error(`      - ${err}`);
        }
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      const errMsg = `验证异常: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errMsg);
      console.error(`   🚨 质量门禁验证异常 [${phase}]: ${errMsg}`);
      return { valid: false, errors };
    }
  }

  /**
   * 处理质量门禁验证失败
   *
   * 记录告警日志并将任务退回到安全状态（前一阶段的状态），
   * 同时追加质量门禁失败的 transitionNote 记录。
   *
   * @param taskId - 任务ID
   * @param expectedStatus - 验证期望的状态
   * @param rollbackStatus - 退回到的安全状态
   * @param phase - 阶段名称
   * @param errors - 验证失败的错误列表
   */
  private async handleTransitionValidationFailure(
    taskId: string,
    expectedStatus: TaskStatus,
    rollbackStatus: TaskStatus,
    phase: string,
    errors: string[],
  ): Promise<void> {
    console.error(`\n   🚨 质量门禁失败 [${phase}]: 任务 ${taskId}`);
    console.error(`   期望状态: ${expectedStatus}, 退回到: ${rollbackStatus}`);
    for (const err of errors) {
      console.error(`   - ${err}`);
    }

    // 追加质量门禁失败记录到 transitionNotes
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (task) {
        if (!task.transitionNotes) {
          task.transitionNotes = [];
        }
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: expectedStatus,
          toStatus: task.status,
          note: `质量门禁验证失败 [${phase}]: ${errors.join('; ')}`,
          author: 'quality-gate',
        });
        writeTaskMeta(task, this.config.cwd);
      }
    } catch (err) {
      console.error(`   ⚠️ 记录质量门禁失败信息时出错: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 尝试退回到安全状态（当实际状态与期望不一致时）
    const currentTask = readTaskMeta(taskId, this.config.cwd);
    if (currentTask && currentTask.status !== expectedStatus) {
      try {
        await this.updateTaskStatus(taskId, rollbackStatus, `质量门禁验证失败，退回 [${phase}]`);
        console.warn(`   ⚠️ 已退回任务 ${taskId} 到 ${rollbackStatus} 状态`);
      } catch (err) {
        console.error(`   ❌ 退回状态失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * 设置任务恢复动作和恢复阶段
   */
  private async setTaskResumeAction(
    taskId: string,
    action: 'retry' | 'next',
    resumeFrom: string,
  ): Promise<void> {
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (!task) return;
      task.resumeAction = action;
      writeTaskMeta(task, this.config.cwd);
    } catch (error) {
      console.error(`   ⚠️ 设置 resumeAction 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 角色感知恢复逻辑
   * 根据 resumeAction 和已完成的阶段确定恢复点（阶段+角色）
   */
  private determineResumePoint(task: TaskMeta): { phase: string; role: TaskRole } | null {
    const phaseHistory = task.phaseHistory || [];
    const resumeAction = task.resumeAction;

    if (!resumeAction || phaseHistory.length === 0) {
      // 无历史或无动作，从开发阶段开始
      return { phase: 'development', role: 'executor' };
    }

    return Pipeline.determineResumePoint(phaseHistory, resumeAction as 'retry' | 'next');
  }

  // ============================================================
  // C2: 恢复决策逻辑层 — 根据任务状态和检查点决定从哪个阶段恢复
  // ============================================================

  /**
   * 任务状态 → 恢复阶段映射表
   * 将 meta.json 中的任务状态映射到对应的流水线阶段
   */
  static readonly STATUS_RESUME_PHASE: Record<string, 'development' | 'code_review' | 'qa' | 'evaluation' | 'skip'> = {
    open: 'development',
    in_progress: 'development',
    wait_review: 'code_review',
    wait_qa: 'qa',
    wait_evaluation: 'evaluation',
    resolved: 'skip',
    closed: 'skip',
    failed: 'skip',
    abandoned: 'skip',
  };

  /**
   * 每个阶段所需的前置报告文件
   */
  static readonly PHASE_PREREQUISITES: Record<string, string[]> = {
    development: [],
    code_review: ['dev-report.md'],
    qa: ['dev-report.md', 'code-review-report.md'],
    evaluation: ['dev-report.md', 'code-review-report.md', 'qa-report.md'],
  };

  /**
   * 三级优先级恢复决策
   *
   * 优先级1: harness-state.json 的 taskPhaseCheckpoints（最精确）
   * 优先级2: STATUS_RESUME_PHASE 状态映射
   * 优先级3: 前置报告文件完整性验证（失败则降级为 development）
   *
   * @param taskId 任务 ID
   * @param status 任务当前状态
   * @param state 运行时状态（含 taskPhaseCheckpoints）
   * @returns 决定的恢复阶段，'skip' 表示跳过
   */
  determineResumePhase(
    taskId: string,
    status: TaskStatus,
    state: HarnessRuntimeState,
  ): 'development' | 'code_review' | 'qa' | 'evaluation' | 'skip' {
    // 优先级1: 检查 harness-state.json 的 taskPhaseCheckpoints（最精确）
    const checkpoint = state.taskPhaseCheckpoints?.get(taskId);
    if (checkpoint) {
      const nextPhase = this.nextPhaseAfter(checkpoint.completedPhase);
      if (nextPhase === 'skip' || nextPhase === null) {
        // 所有阶段已完成，跳过
        return 'skip';
      }
      // 验证前置报告完整性
      if (this.validatePrerequisites(taskId, nextPhase)) {
        return nextPhase;
      }
      // 验证失败降级为 development
      console.log(`   ⚠️ taskPhaseCheckpoints 指向 ${nextPhase} 但前置报告不完整，降级为 development`);
      return 'development';
    }

    // 优先级2: 降级到 STATUS_RESUME_PHASE 状态映射
    const mappedPhase = AssemblyLine.STATUS_RESUME_PHASE[status];
    if (!mappedPhase || mappedPhase === 'skip') {
      return 'skip';
    }

    // 旧状态迁移: wait_qa + qa-report.md 存在 → 自动转为 wait_evaluation
    if (status === 'wait_qa') {
      const projectDir = getProjectDir(this.config.cwd);
      const qaReportPath = path.join(projectDir, 'reports', 'harness', taskId, 'qa-report.md');
      if (fs.existsSync(qaReportPath)) {
        const content = fs.readFileSync(qaReportPath, 'utf-8');
        if (content.trim().length > 0) {
          console.log(`   📋 检测到 wait_qa 但 qa-report.md 已存在，自动迁移为 wait_evaluation`);
          return 'evaluation';
        }
      }
    }

    // 优先级3: 验证前置报告文件完整性
    if (!this.validatePrerequisites(taskId, mappedPhase)) {
      console.log(`   ⚠️ 状态 ${status} 映射到 ${mappedPhase} 但前置报告不完整，降级为 development`);
      return 'development';
    }

    return mappedPhase;
  }

  /**
   * 获取指定阶段之后的下一个阶段
   */
  private nextPhaseAfter(
    completedPhase: 'development' | 'code_review' | 'qa' | 'evaluation',
  ): 'code_review' | 'qa' | 'evaluation' | 'skip' | null {
    const order: Array<'development' | 'code_review' | 'qa' | 'evaluation'> = ['development', 'code_review', 'qa', 'evaluation'];
    const idx = order.indexOf(completedPhase);
    if (idx < 0 || idx >= order.length - 1) {
      return 'skip'; // evaluation 之后没有下一阶段
    }
    return order[idx + 1] as 'code_review' | 'qa' | 'evaluation';
  }

  /**
   * 前置报告完整性验证
   *
   * 检查指定阶段所需的所有前置报告文件是否存在且非空
   *
   * @param taskId 任务 ID
   * @param phase 要恢复的阶段
   * @returns true = 所有前置报告完整
   */
  validatePrerequisites(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
  ): boolean {
    const required = AssemblyLine.PHASE_PREREQUISITES[phase];
    if (!required || required.length === 0) {
      return true; // development 阶段不需要前置报告
    }

    const projectDir = getProjectDir(this.config.cwd);
    const reportDir = path.join(projectDir, 'reports', 'harness', taskId);

    for (const reportFile of required) {
      const filePath = path.join(reportDir, reportFile);
      if (!fs.existsSync(filePath)) {
        return false;
      }
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length === 0) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  // ============================================================
  // 重试上下文和阶段独立重试辅助方法
  // ============================================================

  /**
   * 获取指定阶段的独立重试上限
   */
  private getPhaseRetryLimit(phase: 'development' | 'code_review' | 'qa' | 'evaluation'): number {
    const limits = this.config.phaseRetryLimits ?? DEFAULT_PHASE_RETRY_LIMITS;
    return limits[phase];
  }

  /**
   * 获取指定任务的指定阶段已重试次数
   */
  private getPhaseRetryCount(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
    state: HarnessRuntimeState,
  ): number {
    const key = `${taskId}:${phase}`;
    return state.phaseRetryCounters?.get(key) || 0;
  }

  /**
   * 递增指定任务的指定阶段重试计数器
   */
  private incrementPhaseRetryCount(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
    state: HarnessRuntimeState,
  ): void {
    if (!state.phaseRetryCounters) {
      state.phaseRetryCounters = new Map();
    }
    const key = `${taskId}:${phase}`;
    const current = state.phaseRetryCounters.get(key) || 0;
    state.phaseRetryCounters.set(key, current + 1);
  }

  /**
   * 构建指定阶段的重试上下文（供 Claude 会话使用）
   *
   * P6 Enhanced: 构建完整的重试上下文，包含失败历史、洞察和建议
   * - CP-P6-1: 包含 previousErrors
   * - CP-P6-2: 包含 accumulatedInsights
   * - CP-P6-3: 包含 suggestedFixes
   */
  private buildRetryContextForPhase(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
    state: HarnessRuntimeState,
  ): RetryContext | undefined {
    const stored = this.taskRetryContexts.get(taskId);
    const phaseKey = `${taskId}:${phase}`;
    const attemptNumber = this.getPhaseRetryCount(taskId, phase, state) + 1;
    const maxRetries = this.getPhaseRetryLimit(phase);

    // P6: 从 failureHistory 获取完整的失败历史
    const failureHistory = state.failureHistory?.get(phaseKey) || [];

    // CP-P6-1: 构建 previousErrors
    const previousErrors = failureHistory.map(f => f.error);

    // CP-P6-2: 提取 accumulatedInsights
    const accumulatedInsights = this.extractInsights(failureHistory);

    // CP-P6-3: 生成 suggestedFixes
    const suggestedFixes = this.generateSuggestedFixes(failureHistory);

    // 如果没有存储的上下文且没有失败历史，返回 undefined
    if (!stored && failureHistory.length === 0) return undefined;

    return {
      // 保留原有字段
      previousFailureReason: stored?.previousFailureReason ?? (failureHistory.length > 0 ? failureHistory[failureHistory.length - 1]!.error : undefined),
      previousPhase: stored?.previousPhase ?? phase,
      attemptNumber,
      maxRetries,
      partialProgress: stored?.partialProgress,
      upstreamFailureInfo: stored?.upstreamFailureInfo,

      // P6 增强字段
      previousErrors,
      accumulatedInsights,
      suggestedFixes,
      failureHistory,
    };
  }

  /**
   * 存储失败上下文供重试时使用
   *
   * P6 Enhanced: 同时记录到 failureHistory 以支持完整的重试上下文
   */
  private storeFailureContext(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
    reason: string,
    state: HarnessRuntimeState,
  ): void {
    const existing = this.taskRetryContexts.get(taskId);
    const phaseRetryCount = this.getPhaseRetryCount(taskId, phase, state);

    // Collect partial progress from previous record
    const prevRecord = this.executionRecords.get(taskId);
    const partialProgress: RetryContext['partialProgress'] = {};
    if (prevRecord) {
      const completedCheckpoints: string[] = [];
      if (prevRecord.devReport?.checkpointsCompleted) {
        completedCheckpoints.push(...prevRecord.devReport.checkpointsCompleted);
      }
      const passedPhases: string[] = [];
      if (prevRecord.codeReviewVerdict?.result === 'PASS') passedPhases.push('code_review');
      if (prevRecord.qaVerdict?.result === 'PASS') passedPhases.push('qa');
      if (completedCheckpoints.length > 0) partialProgress.completedCheckpoints = completedCheckpoints;
      if (passedPhases.length > 0) partialProgress.passedPhases = passedPhases;
    }

    // 更新 taskRetryContexts（向后兼容）
    this.taskRetryContexts.set(taskId, {
      previousFailureReason: reason,
      previousPhase: phase,
      attemptNumber: phaseRetryCount + 1,
      maxRetries: this.getPhaseRetryLimit(phase),
      partialProgress: Object.keys(partialProgress).length > 0 ? partialProgress : existing?.partialProgress,
      upstreamFailureInfo: existing?.upstreamFailureInfo,
      // P6 字段
      previousErrors: [],
      accumulatedInsights: [],
      suggestedFixes: [],
    });

    // P6: 记录到 failureHistory
    this.recordFailure(taskId, phase, phaseRetryCount + 1, reason, state);
  }

  // ============================================================
  // P6 Enhanced: 重试上下文智能分析
  // ============================================================

  /**
   * 记录失败到 failureHistory
   *
   * CP-P6: 存储完整的失败历史供重试时分析
   */
  private recordFailure(
    taskId: string,
    phase: 'development' | 'code_review' | 'qa' | 'evaluation',
    attempt: number,
    error: string,
    state: HarnessRuntimeState,
  ): void {
    const phaseKey = `${taskId}:${phase}`;

    if (!state.failureHistory) {
      state.failureHistory = new Map();
    }

    const history = state.failureHistory.get(phaseKey) || [];

    // 错误分类
    const errorType = this.classifyError(error);

    // 提取洞察（基于历史 + 当前）
    const insights = this.extractInsights([...history, { attempt, timestamp: '', phase, error, errorType }]);

    const record = {
      attempt,
      timestamp: new Date().toISOString(),
      phase,
      error,
      errorType,
      insights,
    };

    history.push(record);
    state.failureHistory.set(phaseKey, history);
  }

  /**
   * 错误分类
   *
   * 根据错误内容分类为：syntax, import, test, type, lint, other
   */
  private classifyError(error: string): string {
    const lowerError = error.toLowerCase();

    if (lowerError.includes('syntax') || lowerError.includes('syntaxerror') || lowerError.includes('unexpected token')) {
      return 'syntax';
    }
    if (lowerError.includes('import') || lowerError.includes('require') || lowerError.includes('module') || lowerError.includes('cannot find')) {
      return 'import';
    }
    if (lowerError.includes('test') || lowerError.includes('assert') || lowerError.includes('expect') || lowerError.includes('spec')) {
      return 'test';
    }
    if (lowerError.includes('type') || lowerError.includes('typescript') || lowerError.includes('typeerror') || lowerError.includes('is not assignable')) {
      return 'type';
    }
    if (lowerError.includes('lint') || lowerError.includes('eslint') || lowerError.includes('prettier') || lowerError.includes('style')) {
      return 'lint';
    }
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return 'timeout';
    }
    if (lowerError.includes('api') || lowerError.includes('rate limit') || lowerError.includes('429') || lowerError.includes('5')) {
      return 'api';
    }
    return 'other';
  }

  /**
   * 提取洞察（CP-P6-2）
   *
   * 从失败历史中提取模式和洞察
   */
  private extractInsights(failureHistory: { attempt: number; error: string; errorType?: string }[]): string[] {
    const insights: string[] = [];

    if (failureHistory.length === 0) {
      return insights;
    }

    // 分析错误模式
    const errorTypes = new Map<string, number>();

    for (const record of failureHistory) {
      const errorType = record.errorType || this.classifyError(record.error);
      errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
    }

    // 生成洞察
    for (const [errorType, count] of errorTypes) {
      if (count > 1) {
        insights.push(`重复错误: ${errorType} 出现了 ${count} 次`);
      }
    }

    // 分析最后一次失败的特殊洞察
    const lastFailure = failureHistory[failureHistory.length - 1];
    if (!lastFailure) return insights;

    const lastError = lastFailure.error.toLowerCase();

    if (lastError.includes('syntax') || lastError.includes('unexpected token')) {
      insights.push('语法错误模式: 需要更仔细的代码生成，检查括号、引号、分号匹配');
    }

    if (lastError.includes('test') || lastError.includes('assert') || lastError.includes('expect')) {
      insights.push('测试失败模式: 需要更全面的测试覆盖和边界条件处理');
    }

    if (lastError.includes('import') || lastError.includes('require') || lastError.includes('module')) {
      insights.push('导入错误模式: 需要检查模块依赖和导入路径');
    }

    if (lastError.includes('type') || lastError.includes('typescript') || lastError.includes('is not assignable')) {
      insights.push('类型错误模式: 需要更严格的类型检查和类型定义');
    }

    if (lastError.includes('timeout') || lastError.includes('timed out')) {
      insights.push('超时模式: 任务可能过于复杂，考虑拆分或优化实现');
    }

    // 根据重试次数添加洞察
    if (failureHistory.length >= 2) {
      insights.push('多次失败: 建议尝试不同的实现方法');
    }

    if (failureHistory.length >= 3) {
      insights.push('持续失败: 考虑简化实现方案或检查外部依赖');
    }

    return insights;
  }

  /**
   * 生成修复建议（CP-P6-3）
   *
   * 根据错误类型和重试历史生成具体的修复建议
   */
  private generateSuggestedFixes(failureHistory: { attempt: number; error: string; errorType?: string }[]): string[] {
    const fixes: string[] = [];

    if (failureHistory.length === 0) {
      return fixes;
    }

    const lastFailure = failureHistory[failureHistory.length - 1];
    if (!lastFailure) return fixes;

    const error = lastFailure.error.toLowerCase();
    const errorType = lastFailure.errorType || this.classifyError(lastFailure.error);

    // 根据错误类型生成建议
    switch (errorType) {
      case 'syntax':
        fixes.push('使用代码检查工具验证语法: npx tsc --noEmit');
        fixes.push('检查括号、引号是否匹配');
        fixes.push('检查分号使用是否一致');
        fixes.push('检查代码缩进和格式');
        break;

      case 'import':
        fixes.push('检查导入路径是否正确');
        fixes.push('确认依赖包已安装: npm install 或 bun install');
        fixes.push('检查模块导出/导入语法 (ESM vs CommonJS)');
        fixes.push('检查 tsconfig.json 的 paths 配置');
        break;

      case 'test':
        fixes.push('运行测试查看详细错误: npm test');
        fixes.push('检查测试数据和预期结果');
        fixes.push('确认测试环境配置正确');
        fixes.push('检查异步测试是否正确等待');
        break;

      case 'type':
        fixes.push('运行类型检查: npx tsc --noEmit');
        fixes.push('检查类型定义文件 (.d.ts)');
        fixes.push('确认泛型参数正确');
        fixes.push('检查接口和类型别名定义');
        break;

      case 'lint':
        fixes.push('运行代码格式化: npx prettier --write');
        fixes.push('运行 ESLint 自动修复: npx eslint --fix');
        fixes.push('检查项目代码规范配置');
        break;

      case 'timeout':
        fixes.push('考虑将任务拆分为更小的子任务');
        fixes.push('检查是否有无限循环或阻塞操作');
        fixes.push('优化算法复杂度');
        break;

      case 'api':
        fixes.push('检查 API 限流情况，稍后重试');
        fixes.push('检查 API 认证和权限');
        fixes.push('查看 API 服务状态页面');
        break;

      default:
        fixes.push('仔细查看错误日志，定位问题根源');
        fixes.push('检查相关文件是否存在语法或逻辑错误');
    }

    // 根据重试次数调整策略
    if (failureHistory.length >= 2) {
      fixes.push('尝试不同的实现方法，避免重复同样错误');
      fixes.push('回顾之前的失败，分析共同模式');
    }

    if (failureHistory.length >= 3) {
      fixes.push('考虑简化实现方案，先实现核心功能');
      fixes.push('检查是否有外部依赖或环境问题');
      fixes.push('可能需要人工介入分析');
    }

    return fixes;
  }

  /**
   * 假失败检测：检测审核/QA 结果标记为 NOPASS 但无具体失败项的情况
   *
   * 返回 true 表示可能是假失败。这不自动修正结果，仅输出警告供诊断。
   */
  private detectFalseFailure(
    phase: 'code_review' | 'qa',
    record: TaskExecutionRecord,
  ): boolean {
    if (phase === 'code_review') {
      const verdict = record.codeReviewVerdict;
      if (!verdict) return false;
      if (!verdict.reason || verdict.reason.trim().length === 0) return true;
      if (verdict.codeQualityIssues.length === 0 && verdict.failedCheckpoints.length === 0) return true;
    }
    if (phase === 'qa') {
      const verdict = record.qaVerdict;
      if (!verdict) return false;
      if (!verdict.reason || verdict.reason.trim().length === 0) return true;
      if (verdict.testFailures.length === 0 && verdict.failedCheckpoints.length === 0) return true;
    }
    return false;
  }

  /**
   * 恢复前校验前一阶段结果文件完整性
   *
   * 检查各阶段的报告文件是否存在且非空。
   * 如果文件缺失或为空，返回 false 表示不应恢复而应重新执行。
   */
  private validatePreviousPhaseResults(
    taskId: string,
    resumePhase: string | null,
  ): boolean {
    if (!resumePhase) return true;

    const projectDir = getProjectDir(this.config.cwd);
    const reportDir = path.join(projectDir, 'reports', 'harness', taskId);

    const checks: { file: string; label: string }[] = [];

    switch (resumePhase) {
      case 'qa':
        // Resuming from QA: need dev report and code review report
        checks.push({ file: path.join(reportDir, 'dev-report.md'), label: '开发报告' });
        checks.push({ file: path.join(reportDir, 'code-review-report.md'), label: '代码审核报告' });
        break;
      case 'evaluation':
        // Resuming from evaluation: need all previous reports
        checks.push({ file: path.join(reportDir, 'dev-report.md'), label: '开发报告' });
        checks.push({ file: path.join(reportDir, 'code-review-report.md'), label: '代码审核报告' });
        checks.push({ file: path.join(reportDir, 'qa-report.md'), label: 'QA报告' });
        break;
      case 'code_review':
        // Resuming from code review: need dev report
        checks.push({ file: path.join(reportDir, 'dev-report.md'), label: '开发报告' });
        break;
      case 'development':
        // Resuming from development: no previous results needed
        return true;
    }

    for (const check of checks) {
      if (!fs.existsSync(check.file)) {
        console.log(`   ⚠️ 缺少${check.label}: ${check.file}`);
        return false;
      }
      try {
        const content = fs.readFileSync(check.file, 'utf-8');
        if (content.trim().length === 0) {
          console.log(`   ⚠️ ${check.label}为空: ${check.file}`);
          return false;
        }
      } catch {
        console.log(`   ⚠️ 读取${check.label}失败: ${check.file}`);
        return false;
      }
    }

    return true;
  }

  /**
   * 计算自适应超时（秒）
   *
   * 基于 task.estimatedMinutes 计算超时：
   * - 有预估: estimatedMinutes * 60 * 2（双倍余量），上限 60 分钟
   * - 无预估: 使用 config.timeout 兜底（默认 5 分钟）
   */
  private computeAdaptiveTimeout(task: TaskMeta): number | undefined {
    const estimated = task.estimatedMinutes;
    if (!estimated || estimated <= 0) {
      return undefined; // 无预估，使用 config.timeout 兜底
    }

    const TIMEOUT_MULTIPLIER = 2; // 双倍余量
    const MAX_TIMEOUT_SECONDS = 60 * 60; // 上限 60 分钟

    const computed = Math.min(estimated * 60 * TIMEOUT_MULTIPLIER, MAX_TIMEOUT_SECONDS);
    console.log(`   ⏱️  自适应超时: 预估 ${estimated} 分钟 → 超时 ${computed / 60} 分钟 (${computed} 秒)`);
    return computed;
  }

  /**
   * 追加阶段历史条目
   */
  private appendPhaseHistory(
    taskId: string,
    entry: { phase: string; role: TaskRole; verdict: 'PASS' | 'NOPASS'; timestamp: string; analysis?: string; resumeAction?: 'retry' | 'next' },
  ): void {
    try {
      const task = readTaskMeta(taskId, this.config.cwd);
      if (!task) return;
      if (!task.phaseHistory) {
        task.phaseHistory = [];
      }
      task.phaseHistory.push(entry as PhaseHistoryEntry);
      writeTaskMeta(task, this.config.cwd);
    } catch (error) {
      console.error(`   ⚠️ 追加阶段历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 强制标记流水线状态为失败（公共方法）
   *
   * 供 harnessCommand() 在 catch 块或信号处理中调用，
   * 确保 harness-status.json 不会永远停留在 running 状态。
   */
  forceFailStatus(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.statusReporter.forceFailStatus('failed', message);
  }

  /**
   * 输出批次级摘要
   *
   * 当完成一个批次的所有任务后，统计该批次的通过/失败/跳过情况
   */
  private outputBatchSummary(state: HarnessRuntimeState, batchIndex: number): void {
    const boundaries = state.batchBoundaries!;
    const labels = state.batchLabels;
    const batchStart = boundaries[batchIndex]!;
    const batchEnd = batchIndex + 1 < boundaries.length
      ? boundaries[batchIndex + 1]!
      : state.taskQueue.length;
    const batchSize = batchEnd - batchStart;

    const batchTaskIds = state.taskQueue.slice(batchStart, batchEnd);

    // 使用每个任务的最新记录（处理重试情况）
    // this.executionRecords 已存储每个任务的最新记录
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const taskId of batchTaskIds) {
      const record = this.executionRecords.get(taskId);
      if (!record) {
        skipped++;
      } else if (record.finalStatus === 'resolved' || record.finalStatus === 'closed') {
        passed++;
      } else if (record.finalStatus === 'abandoned' || record.finalStatus === 'failed') {
        failed++;
      } else {
        skipped++;
      }
    }

    const label = labels?.[batchIndex] || `批次 ${batchIndex + 1}`;
    console.log(`\n📊 ${label} 完成: ${passed} 通过, ${failed} 失败, ${skipped} 跳过 (${batchSize} 任务)`);
  }

  /**
   * 批次间自动 git tag + commit
   *
   * 当启用 --batch-git-tag-commit 且跨批次边界时，
   * 检查工作区是否有变更，有则执行 git add -A + git commit，
   * 然后创建 git tag 标记批次完成。
   *
   * tag 格式: batch-{N}-{timestamp}
   * commit message: harness: batch N completed (X passed, Y failed, Z file changes)
   *
   * dry-run 模式仅输出提示不实际提交。
   */
  private tagBatchCompletion(
    state: HarnessRuntimeState,
    batchIndex: number
  ): void {
    if (!this.config.batchGitTagCommit) return;

    const boundaries = state.batchBoundaries;
    if (!boundaries || boundaries.length === 0) return;

    const label = state.batchLabels?.[batchIndex] || `批次 ${batchIndex + 1}`;

    // 统计该批次的通过/失败数
    const batchStart = boundaries[batchIndex]!;
    const batchEnd = batchIndex + 1 < boundaries.length
      ? boundaries[batchIndex + 1]!
      : state.taskQueue.length;
    const batchTaskIds = new Set(state.taskQueue.slice(batchStart, batchEnd));

    let passed = 0;
    let failed = 0;
    for (const taskId of batchTaskIds) {
      const record = this.executionRecords.get(taskId);
      if (record && (record.finalStatus === 'resolved' || record.finalStatus === 'closed')) {
        passed++;
      } else if (record && (record.finalStatus === 'abandoned' || record.finalStatus === 'failed')) {
        failed++;
      }
    }

    if (this.config.dryRun) {
      const tagHint = this.config.batchGitTagCommit ? ' + git tag (batch-{N}-{timestamp})' : '';
      console.log(`\n📝 [dry-run] 将为 ${label} 创建 git commit${tagHint} (${passed} 通过, ${failed} 失败)`);
      return;
    }

    try {
      // 检查是否有未提交的变更
      const statusOutput = execSync('git status --porcelain', {
        cwd: this.config.cwd,
        encoding: 'utf-8',
        timeout: 10000,
      });

      if (!statusOutput.trim()) {
        console.log(`\n📦 ${label}: 无文件变更，跳过 git commit`);
        // batchGitTagCommit 模式下仍需创建 tag 标记批次完成
        if (this.config.batchGitTagCommit) {
          try {
            const batchNumber = batchIndex + 1;
            const timestamp = Math.floor(Date.now() / 1000);
            const tagName = `batch-${batchNumber}-${timestamp}`;
            execSync(`git tag ${tagName}`, {
              cwd: this.config.cwd,
              encoding: 'utf-8',
              timeout: 10000,
            });
            console.log(`   🏷️  已创建 git tag: ${tagName}`);
          } catch (tagError) {
            console.error(`   ⚠️ 创建 git tag 失败: ${tagError instanceof Error ? tagError.message : String(tagError)}`);
          }
        }
        return;
      }

      const changedFiles = statusOutput.trim().split('\n').length;

      // git add + commit
      execSync('git add -A', {
        cwd: this.config.cwd,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const commitMessage = `harness: ${label} 完成 (${passed} 通过, ${failed} 失败, ${changedFiles} 文件变更)`;
      const commitOutput = execSync(`git commit -m ${JSON.stringify(commitMessage)}`, {
        cwd: this.config.cwd,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // 提取 commit SHA（优先从 commit 输出解析，回退到 git rev-parse HEAD）
      let commitSha = '';
      const shaMatch = commitOutput.match(/\[.+?\s+([0-9a-f]{7,40})\]/);
      if (shaMatch) {
        commitSha = shaMatch[1]!;
      } else {
        try {
          commitSha = execSync('git rev-parse HEAD', {
            cwd: this.config.cwd,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
        } catch {
          // 无法获取 SHA，留空
        }
      }

      console.log(`\n📦 ${label}: 已提交 ${changedFiles} 个文件变更 (git commit${commitSha ? ` ${commitSha.substring(0, 7)}` : ''})`);

      // 创建 git tag（仅 --batch-git-tag-commit 模式）
      let tagName = '';
      if (this.config.batchGitTagCommit) {
        try {
          const batchNumber = batchIndex + 1;
          const timestamp = Math.floor(Date.now() / 1000);
          tagName = `batch-${batchNumber}-${timestamp}`;
          execSync(`git tag ${tagName}`, {
            cwd: this.config.cwd,
            encoding: 'utf-8',
            timeout: 10000,
          });
          console.log(`   🏷️  已创建 git tag: ${tagName}`);
        } catch (tagError) {
          console.error(`   ⚠️ 创建 git tag 失败: ${tagError instanceof Error ? tagError.message : String(tagError)}`);
          tagName = '';
        }
      }

      // 将 commit SHA 写入该批次所有任务的 executionStats.commitHistory
      if (commitSha) {
        const entry: CommitHistoryEntry = {
          sha: commitSha,
          batchLabel: label,
          timestamp: new Date().toISOString(),
          ...(tagName ? { tagName } : {}),
        };
        for (const taskId of batchTaskIds) {
          try {
            const task = readTaskMeta(taskId, this.config.cwd);
            if (task) {
              if (!task.executionStats) {
                task.executionStats = {
                  duration: 0,
                  retryCount: 0,
                  completedAt: new Date().toISOString(),
                  commitHistory: [entry],
                };
              } else {
                if (!task.executionStats.commitHistory) {
                  task.executionStats.commitHistory = [];
                }
                task.executionStats.commitHistory.push(entry);
              }
              writeTaskMeta(task, this.config.cwd);
            }
          } catch (err) {
            console.error(`   ⚠️ 写入 ${taskId} 的 commitHistory 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (error) {
      console.error(`   ⚠️ 批次 git commit 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取当前索引在批次中的位置信息
   *
   * 根据 state.batchBoundaries 计算当前任务属于哪个批次，
   * 以及在批次内的相对位置
   */
  private getBatchPosition(
    currentIndex: number,
    state: HarnessRuntimeState
  ): { batchIndex: number; totalBatches: number; batchLabel: string; taskInBatch: number; batchSize: number } | null {
    const boundaries = state.batchBoundaries;
    const labels = state.batchLabels;
    if (!boundaries || boundaries.length === 0) {
      return null;
    }

    // 找到当前索引所属的批次（二分查找：最后一个 start <= currentIndex 的批次）
    let batchIndex = 0;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (currentIndex >= boundaries[i]!) {
        batchIndex = i;
        break;
      }
    }

    const batchStart = boundaries[batchIndex]!;
    const batchEnd = batchIndex + 1 < boundaries.length
      ? boundaries[batchIndex + 1]!
      : state.taskQueue.length;
    const batchSize = batchEnd - batchStart;
    const taskInBatch = currentIndex - batchStart + 1;

    return {
      batchIndex,
      totalBatches: boundaries.length,
      batchLabel: labels?.[batchIndex] || `批次 ${batchIndex + 1}`,
      taskInBatch,
      batchSize,
    };
  }

  // ============================================================
  // P1-PROB1: Cascade Failure Handling & Failure Reason Recording
  // ============================================================

  /**
   * CP-P1-8: 标记依赖失败任务为失败（级联）
   *
   * 当一个任务失败时，递归标记所有依赖该任务的下游任务为失败。
   * 使用 taskFailureReasons 记录详细的失败原因，用于后续复盘。
   */
  private async markDependentTasksAsFailed(
    state: HarnessRuntimeState,
    failedTaskId: string,
    failureReason: TaskFailureReason
  ): Promise<number> {
    let cascadeCount = 0;

    if (!state.taskFailureReasons) {
      state.taskFailureReasons = new Map();
    }
    if (!state.failedTasks) {
      state.failedTasks = [];
    }

    // 收集队列中所有任务的元数据，查找依赖关系
    const allTaskMeta = new Map<string, TaskMeta>();
    for (const taskId of state.taskQueue) {
      if (taskId && !allTaskMeta.has(taskId)) {
        const task = readTaskMeta(taskId, this.config.cwd);
        if (task) allTaskMeta.set(taskId, task);
      }
    }

    // 遍历所有任务，查找依赖失败任务的任务
    for (const taskId of allTaskMeta.keys()) {
      // 跳过已处理的任务
      if (
        state.passedTasks?.includes(taskId) ||
        state.failedTasks.includes(taskId) ||
        taskId === failedTaskId
      ) {
        continue;
      }

      const task = allTaskMeta.get(taskId);
      if (task && task.dependencies && task.dependencies.includes(failedTaskId)) {
        // 级联标记为失败
        state.failedTasks.push(taskId);

        // 记录失败原因（标记为上游依赖失败）
        const cascadeFailureReason: TaskFailureReason = {
          taskId,
          failedAt: 'dependency_check',
          phase: 'pre_execution',
          reason: `上游依赖任务 ${failedTaskId} 执行失败`,
          errorDetails: {
            upstreamTaskId: failedTaskId,
            upstreamFailureReason: failureReason.reason,
            upstreamFailedAt: failureReason.failedAt,
          },
          timestamp: new Date().toISOString(),
          attemptNumber: 0,
          isCascadeFailure: true,
        };
        state.taskFailureReasons.set(taskId, cascadeFailureReason);

        cascadeCount++;
        console.log(`   ⚠️ 任务 ${taskId} 因上游依赖 ${failedTaskId} 失败而被连带标记为失败`);

        // 更新任务元数据
        try {
          const previousStatus = task.status;
          task.status = 'failed';
          task.failureReason = 'upstream_failed';
          task.updatedAt = new Date().toISOString();
          if (!task.transitionNotes) {
            task.transitionNotes = [];
          }
          task.transitionNotes.push({
            timestamp: new Date().toISOString(),
            fromStatus: previousStatus,
            toStatus: 'failed',
            note: `上游任务 ${failedTaskId} 失败，级联标记为 failed(upstream_failed)`,
            author: 'assembly-line-cascade',
          });
          writeTaskMeta(task, this.config.cwd);
        } catch (err) {
          console.error(`   ⚠️ 级联标记 ${taskId} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }

        // 递归处理下游任务的下游任务
        cascadeCount += await this.markDependentTasksAsFailed(state, taskId, cascadeFailureReason);
      }
    }

    return cascadeCount;
  }

  /**
   * CP-P1-8: 标记因上游失败而被阻塞的任务为失败
   *
   * 当没有可执行任务时，检查所有被阻塞任务，
   * 如果它们的上游依赖已失败，则连带标记为失败。
   */
  private markCascadeFailedTasks(state: HarnessRuntimeState): number {
    let cascadeCount = 0;

    if (!state.taskFailureReasons) {
      state.taskFailureReasons = new Map();
    }
    if (!state.failedTasks) {
      state.failedTasks = [];
    }

    const executionQueue = state.readyTasks && state.readyTasks.length > 0
      ? state.readyTasks
      : state.taskQueue;

    for (const taskId of executionQueue) {
      // 跳过已处理的任务
      if (
        state.passedTasks?.includes(taskId) ||
        state.failedTasks.includes(taskId)
      ) {
        continue;
      }

      // 检查依赖是否因上游失败而不满足
      const dependencyStatus = this.checkDependencyFailureStatus(state, taskId);

      if (dependencyStatus.hasFailedDependency) {
        // 级联标记为失败
        state.failedTasks.push(taskId);

        // 记录失败原因
        const cascadeFailureReason: TaskFailureReason = {
          taskId,
          failedAt: 'dependency_check',
          phase: 'pre_execution',
          reason: `上游依赖任务 ${dependencyStatus.failedDependencyId} 执行失败`,
          errorDetails: {
            upstreamTaskId: dependencyStatus.failedDependencyId,
            upstreamFailureReason: dependencyStatus.failureReason,
          },
          timestamp: new Date().toISOString(),
          attemptNumber: 0,
          isCascadeFailure: true,
        };
        state.taskFailureReasons.set(taskId, cascadeFailureReason);

        cascadeCount++;
        console.log(`   ⚠️ 任务 ${taskId} 因上游依赖失败而被连带标记为失败`);
      }
    }

    return cascadeCount;
  }

  /**
   * 检查任务的依赖失败状态
   */
  private checkDependencyFailureStatus(
    state: HarnessRuntimeState,
    taskId: string
  ): { hasFailedDependency: boolean; failedDependencyId?: string; failureReason?: string } {
    const task = readTaskMeta(taskId, this.config.cwd);

    if (!task || !task.dependencies || task.dependencies.length === 0) {
      return { hasFailedDependency: false };
    }

    // 检查每个依赖任务的状态
    for (const depTaskId of task.dependencies) {
      if (state.failedTasks?.includes(depTaskId)) {
        const failureReason = state.taskFailureReasons?.get(depTaskId);
        return {
          hasFailedDependency: true,
          failedDependencyId: depTaskId,
          failureReason: failureReason?.reason || '未知原因',
        };
      }
    }

    return { hasFailedDependency: false };
  }

  /**
   * CP-P1-10: 输出失败原因汇总（用于复盘）
   */
  private printFailureSummary(state: HarnessRuntimeState): void {
    if (!state.taskFailureReasons || state.taskFailureReasons.size === 0) {
      return;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 失败原因汇总（用于复盘）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 按失败类型分组
    const directFailures: TaskFailureReason[] = [];
    const cascadeFailures: TaskFailureReason[] = [];

    state.taskFailureReasons.forEach((reason) => {
      if (reason.isCascadeFailure) {
        cascadeFailures.push(reason);
      } else {
        directFailures.push(reason);
      }
    });

    // 输出直接失败
    if (directFailures.length > 0) {
      console.log('【直接失败】');
      directFailures.forEach((reason, index) => {
        console.log(`\n  ${index + 1}. 任务: ${reason.taskId}`);
        console.log(`     失败阶段: ${reason.phase}`);
        console.log(`     失败位置: ${reason.failedAt}`);
        console.log(`     失败原因: ${reason.reason}`);
        console.log(`     尝试次数: ${reason.attemptNumber}`);
        console.log(`     时间: ${reason.timestamp}`);
        if (reason.errorDetails) {
          console.log(`     详情: ${JSON.stringify(reason.errorDetails, null, 2)}`);
        }
      });
    }

    // 输出级联失败
    if (cascadeFailures.length > 0) {
      console.log('\n【级联失败（上游依赖失败）】');
      cascadeFailures.forEach((reason, index) => {
        console.log(`\n  ${index + 1}. 任务: ${reason.taskId}`);
        console.log(`     上游任务: ${reason.errorDetails?.upstreamTaskId}`);
        console.log(`     上游失败原因: ${reason.errorDetails?.upstreamFailureReason}`);
        console.log(`     时间: ${reason.timestamp}`);
      });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}
