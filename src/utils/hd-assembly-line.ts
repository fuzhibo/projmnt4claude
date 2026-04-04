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
} from '../types/harness.js';
import {
  createDefaultExecutionRecord,
} from '../types/harness.js';
import type { TaskMeta, TaskStatus, TaskRole, CheckpointMetadata, CommitHistoryEntry, TransitionNote, PhaseHistoryEntry } from '../types/task.js';
import { Pipeline } from '../types/task.js';
import { readTaskMeta, writeTaskMeta, taskExists, updateTaskStatus, assignRole, incrementReopenCount, recordExecutionStats } from './task.js';
import { getProjectDir } from './path.js';
import { HarnessExecutor } from './harness-executor.js';
import { HarnessCodeReviewer } from './harness-code-reviewer.js';
import { HarnessQATester } from './harness-qa-tester.js';
import { HarnessEvaluator } from './harness-evaluator.js';
import { RetryHandler } from './harness-retry.js';
import { HarnessStatusReporter } from './harness-status-reporter.js';
import { saveRuntimeState } from '../commands/harness.js';
import { listPending, generateVerificationReport, getQueueStats, enqueueBatch } from './harness-verification-queue.js';
import { SEPARATOR_WIDTH } from './format';

/** 重新评估最大次数（独立于重试次数） */
const MAX_REEVALUATE_ATTEMPTS = 2;

export class AssemblyLine {
  private config: HarnessConfig;
  private executor: HarnessExecutor;
  private codeReviewer: HarnessCodeReviewer;
  private qaTester: HarnessQATester;
  private evaluator: HarnessEvaluator;
  private retryHandler: RetryHandler;
  private statusReporter: HarnessStatusReporter;
  private sessionId?: string;

  constructor(config: HarnessConfig, sessionId?: string) {
    this.config = config;
    this.sessionId = sessionId;
    this.executor = new HarnessExecutor(config);
    this.codeReviewer = new HarnessCodeReviewer(config);
    this.qaTester = new HarnessQATester(config);
    this.evaluator = new HarnessEvaluator(config);
    this.retryHandler = new RetryHandler(config);
    this.statusReporter = new HarnessStatusReporter(config.cwd, sessionId);
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
    this.statusReporter.startPipeline(state.taskQueue.length);

    const batchInfo = hasBatches
      ? `，${state.batchBoundaries!.length} 个批次`
      : '';
    console.log(`\n🚀 开始执行流水线，共 ${state.taskQueue.length} 个任务${batchInfo}\n`);

    while (state.currentIndex < state.taskQueue.length) {
      const taskId = state.taskQueue[state.currentIndex];

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
        state.records.push(record);

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
          this.commitBatchChanges(state, batchPos.batchIndex);
        }

        // 保存状态（用于中断恢复）
        saveRuntimeState(state, this.config.cwd);

      } catch (error) {
        console.error(`❌ 任务 ${taskId} 执行出错:`, error instanceof Error ? error.message : String(error));

        // 记录失败
        const task = readTaskMeta(taskId, this.config.cwd);
        if (task) {
          const record = createDefaultExecutionRecord(task);
          record.finalStatus = 'abandoned';
          record.timeline.push({
            timestamp: new Date().toISOString(),
            event: 'failed',
            description: `执行出错: ${error instanceof Error ? error.message : String(error)}`,
          });
          state.records.push(record);
        }

        state.currentIndex++;

        // 跨批次边界时输出批次摘要（错误路径）
        if (hasBatches && batchPos) {
          const nextBatch = this.getBatchPosition(state.currentIndex, state);
          if (nextBatch && batchPos.batchIndex !== nextBatch.batchIndex) {
            this.outputBatchSummary(state, batchPos.batchIndex);
            this.commitBatchChanges(state, batchPos.batchIndex);
          }
        }
      }
    }

    // 输出最后一个批次的摘要
    if (hasBatches && state.batchBoundaries!.length > 0) {
      this.outputBatchSummary(state, state.batchBoundaries!.length - 1);
      this.commitBatchChanges(state, state.batchBoundaries!.length - 1);
    }

    // 生成摘要
    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

    const summary: ExecutionSummary = {
      totalTasks: state.taskQueue.length,
      passed: state.records.filter(r => r.reviewVerdict?.result === 'PASS').length,
      failed: state.records.filter(r => r.reviewVerdict?.result === 'NOPASS' || r.devReport.status === 'failed').length,
      totalRetries: Array.from(state.retryCounter.values()).reduce((sum, count) => sum + count, 0),
      duration,
      startTime,
      endTime,
      taskResults: new Map(state.records.map(r => [r.taskId, r])),
      config: this.config,
    };

    state.state = summary.failed === 0 ? 'completed' : 'failed';

    // 后处理: 扫描并收集 requiresHuman 检查点到验证队列
    this.collectAndEnqueueHumanCheckpoints(state.records);

    // 生成待人工验证报告（如果存在待验证项）
    this.generatePendingVerificationReport();

    // 完成流水线状态报告
    if (summary.failed === 0) {
      this.statusReporter.completePipeline(`流水线执行完成，${summary.passed}/${summary.totalTasks} 任务通过`);
    } else {
      this.statusReporter.failPipeline(new Error(`${summary.failed} 个任务失败`), `流水线执行失败，${summary.failed}/${summary.totalTasks} 任务失败`);
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

    // 1. 检查依赖
    if (!await this.checkDependencies(task, state)) {
      console.log(`⚠️  依赖未完成，延后处理`);
      addTimeline('failed', '依赖未完成');
      record.finalStatus = 'open';
      return record;
    }

    // 2. 检查任务是否已完成
    const completedStatuses: TaskStatus[] = ['resolved', 'closed'];
    if (completedStatuses.includes(task.status)) {
      console.log(`⏭️  任务 ${taskId} 已完成 (状态: ${task.status})，跳过`);
      addTimeline('skipped', `任务已完成，跳过执行: ${task.status}`, { status: task.status });
      record.finalStatus = task.status;
      return record;
    }

    // Check for phase resumption (retest/reevaluate actions)
    const resumePhase = state.resumeFrom?.get(taskId);
    if (resumePhase) {
      state.resumeFrom.delete(taskId);
    }
    const prevRecord = resumePhase
      ? [...state.records].reverse().find(r => r.taskId === taskId)
      : undefined;
    if (resumePhase && !prevRecord) {
      console.log(`   ⚠️ 未找到前次执行记录，从开发阶段重新开始`);
    }
    const effectiveResume = (resumePhase && prevRecord) ? resumePhase : null;

    // 3-4. Development phase (skip if resuming from qa or evaluation)
    let devReport: DevReport;
    if (!effectiveResume) {
      await this.ensureTransition(taskId, 'in_progress', '开始开发阶段');
      record.finalStatus = 'in_progress';

      addTimeline('dev_started', '开始开发阶段');
      this.statusReporter.startPhase('development', taskId, '开始开发阶段');
      console.log('\n🔨 开发阶段...');

      try {
        devReport = await this.executor.execute(task, record.contract);
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
      if (devReport.status !== 'success') {
        console.log(`❌ 开发阶段失败: ${devReport.error || '未知错误'}`);
        this.statusReporter.failPhase('development', new Error(devReport.error || '开发阶段失败'), taskId);

        // 尝试重试
        const shouldRetry = await this.retryHandler.shouldRetry(taskId, state.retryCounter);
        if (shouldRetry) {
          addTimeline('retry', `准备重试 (第 ${state.retryCounter.get(taskId) || 0} 次)`);
          // 重新加入队列
          state.taskQueue.push(taskId);
          state.retryCounter.set(taskId, (state.retryCounter.get(taskId) || 0) + 1);
        } else {
          await this.updateTaskStatus(taskId, 'abandoned');
          record.finalStatus = 'abandoned';
          addTimeline('failed', '超过最大重试次数，任务放弃');
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
    } else {
      // Resume: reuse previous development results
      devReport = prevRecord!.devReport;
      record.devReport = devReport;
      addTimeline('dev_completed', `[恢复] 复用前次开发结果: ${devReport.status}`, { resumed: true, phase: effectiveResume });
      console.log(`   ⏩ 跳过开发阶段（从 ${effectiveResume} 阶段恢复）`);
    }

    // 6. 代码审核阶段（新增）
    addTimeline('code_review_started', '开始代码审核阶段');
    this.statusReporter.startPhase('code_review', taskId, '开始代码审核阶段');
    console.log('\n🔍 代码审核阶段...');

    let codeReviewVerdict: CodeReviewVerdict;
    try {
      codeReviewVerdict = await this.codeReviewer.review(task, devReport);
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
      this.statusReporter.failPhase('code_review', new Error(codeReviewVerdict.reason || '代码审核未通过'), taskId);
      return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'code_review');
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

    // 8. QA 验证阶段（新增）
    addTimeline('qa_started', '开始 QA 验证阶段');
    this.statusReporter.startPhase('qa_verification', taskId, '开始 QA 验证阶段');
    console.log('\n🧪 QA 验证阶段...');

    let qaVerdict: QAVerdict;
    try {
      qaVerdict = await this.qaTester.verify(task, codeReviewVerdict);
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
      this.statusReporter.failPhase('qa_verification', new Error(qaVerdict.reason || 'QA 验证未通过'), taskId);
      return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'qa');
    }

    // 8.4 同步检查点状态（QA 通过后）
    this.syncCheckpointStatus(taskId, 'qa', { qaVerdict });
    // 8.5 质量门禁验证（QA 阶段完成后）
    const qaGateResult = this.validateTransitionCompleteness(taskId, 'wait_qa', 'qa');
    if (!qaGateResult.valid) {
      await this.handleTransitionValidationFailure(taskId, 'wait_qa', 'wait_qa', 'qa', qaGateResult.errors);
    }

    // 9. 最终评估阶段（移除 wait_complete 中间状态，直接进入评估）
    // 注: 人工验证已从流水线阶段移至后处理，不再阻塞评估流程
    addTimeline('review_started', '开始最终评估阶段');
    this.statusReporter.startPhase('evaluation', taskId, '开始最终评估阶段');
    console.log('\n🎯 最终评估阶段...');

    let verdict: ReviewVerdict;
    try {
      verdict = await this.evaluator.evaluate(task, devReport, record.contract);
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

      // CP-3: 记录执行统计到任务 meta
      const retryCount = state.retryCounter.get(taskId) || 0;
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

      await this.ensureTransition(taskId, 'resolved', '评估通过，任务完成');
      record.finalStatus = 'resolved';
      const evalGateResult = this.validateTransitionCompleteness(taskId, 'resolved', 'evaluation');
      if (!evalGateResult.valid) {
        await this.handleTransitionValidationFailure(taskId, 'resolved', 'wait_qa', 'evaluation', evalGateResult.errors);
      }
      record.retryCount = retryCount;
      console.log('✅ 评估通过！');
      addTimeline('completed', '任务完成');
    } else {
      console.log(`❌ 评估未通过: ${verdict.reason}`);
      this.statusReporter.failPhase('evaluation', new Error(verdict.reason || '评估未通过'), taskId);
      return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, 'evaluation', verdict.action);
    }

    return record;
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
        // 开发完成后，标记不属于 code_review/qa/human 的通用检查点
        const belongsToCodeReview = category === 'code_review'
          || method === 'code_review' || method === 'lint' || method === 'architect_review';
        const belongsToQA = category === 'qa_verification'
          || method === 'unit_test' || method === 'functional_test'
          || method === 'integration_test' || method === 'e2e_test';
        const belongsToHuman = checkpoint.requiresHuman || method === 'human_verification';

        if (belongsToCodeReview || belongsToQA || belongsToHuman) return false;

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
          // BUG-014-2: requiresHuman/human_verification 检查点不自动同步，需等待人工验证后处理
          if (checkpoint.requiresHuman || checkpoint.verification?.method === 'human_verification') {
            checkpoint.verification = checkpoint.verification || { method: 'human_verification' };
            checkpoint.verification.result = 'deferred';
            checkpoint.verification.verifiedAt = now;
            checkpoint.verification.verifiedBy = 'post_process_deferred';
            checkpoint.note = `${checkpoint.note ? checkpoint.note + '; ' : ''}等待人工验证（流水线后处理）`;
            updated = true;
            console.log(`   ⏳ 检查点 ${checkpoint.id} 已标记为 deferred（等待人工验证）`);
            continue;
          }
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
   */
  private async checkDependencies(task: TaskMeta, state: HarnessRuntimeState): Promise<boolean> {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    for (const depId of task.dependencies) {
      // 检查是否在当前执行记录中已完成
      const depRecord = state.records.find(r => r.taskId === depId);
      if (depRecord && depRecord.finalStatus === 'resolved') {
        continue;
      }

      // 检查任务状态
      const depTask = readTaskMeta(depId, this.config.cwd);
      if (!depTask) {
        console.log(`⚠️  依赖任务 ${depId} 不存在`);
        continue;
      }

      if (depTask.status !== 'resolved' && depTask.status !== 'closed') {
        console.log(`⚠️  依赖任务 ${depId} 未完成 (状态: ${depTask.status})`);
        return false;
      }
    }

    return true;
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
   * 基于评估者动作的状态路由
   *
   * 根据 architect 评估者输出的 action 关键字驱动不同的状态流转：
   * - resolve: 直接标记为 resolved（评估通过）
   * - redevelop: 从开发阶段重试（消耗重试次数）
   * - retest: 从 QA 阶段重试（消耗重试次数）
   * - reevaluate: 重新评估（不消耗重试次数，独立上限 MAX_REEVALUATE_ATTEMPTS 次）
   * - escalate_human: 转为 needs_human 状态
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

      case 'redevelop': {
        const retryCount = state.retryCounter.get(taskId) || 0;
        if (retryCount >= this.config.maxRetries) {
          await this.ensureTransition(taskId, 'abandoned', `超过最大重试次数 (${this.config.maxRetries})`);
          record.finalStatus = 'abandoned';
          record.retryCount = retryCount;
          addTimeline('failed', '超过最大重试次数，任务放弃');
          console.log(`❌ 超过最大重试次数 (${this.config.maxRetries})，任务放弃`);
          return record;
        }

        // 消耗重试次数，从开发阶段重试（不设 resumeFrom，完整重跑流水线）
        this.incrementTaskReopenCount(taskId, `${phase} 阶段失败，从开发阶段重试`);
        await this.ensureTransition(taskId, 'in_progress', `${phase} 阶段失败，从开发阶段重试`);
        // 设置 resumeAction 和角色感知恢复
        await this.setTaskResumeAction(taskId, 'retry', 'development');
        await this.assignTaskRole(taskId, 'executor');
        // 记录阶段历史
        this.appendPhaseHistory(taskId, { phase: 'development', role: 'executor', verdict: 'NOPASS', timestamp: new Date().toISOString(), analysis: `${phase} 阶段失败，retry from development`, resumeAction: 'retry' });
        state.retryCounter.set(taskId, retryCount + 1);
        state.taskQueue.push(taskId);

        addTimeline('retry', `任务将从开发阶段重试 (第 ${retryCount + 1} 次)`, { action, phase });
        console.log(`⚠️  任务将从开发阶段重试 (第 ${retryCount + 1} 次)`);
        record.finalStatus = 'in_progress';
        record.retryCount = retryCount + 1;
        return record;
      }

      case 'retest': {
        const retryCount = state.retryCounter.get(taskId) || 0;
        if (retryCount >= this.config.maxRetries) {
          await this.ensureTransition(taskId, 'abandoned', `超过最大重试次数 (${this.config.maxRetries})`);
          record.finalStatus = 'abandoned';
          record.retryCount = retryCount;
          addTimeline('failed', '超过最大重试次数，任务放弃');
          console.log(`❌ 超过最大重试次数 (${this.config.maxRetries})，任务放弃`);
          return record;
        }

        // 消耗重试次数，从 QA 阶段重试
        this.incrementTaskReopenCount(taskId, `${phase} 阶段失败，从 QA 阶段重试`);
        await this.ensureTransition(taskId, 'in_progress', `${phase} 阶段失败，从 QA 阶段重试`);
        // 设置 resumeAction 和角色感知恢复
        await this.setTaskResumeAction(taskId, 'retry', 'qa');
        await this.assignTaskRole(taskId, 'qa_tester');
        // 记录阶段历史
        this.appendPhaseHistory(taskId, { phase: 'qa_verification', role: 'qa_tester', verdict: 'NOPASS', timestamp: new Date().toISOString(), analysis: `${phase} 阶段失败，retry from qa`, resumeAction: 'retry' });
        state.retryCounter.set(taskId, retryCount + 1);
        state.resumeFrom.set(taskId, 'qa');
        state.taskQueue.push(taskId);

        addTimeline('retry', `任务将从 QA 阶段重试 (第 ${retryCount + 1} 次)`, { action, phase });
        console.log(`⚠️  任务将从 QA 阶段重试 (第 ${retryCount + 1} 次)`);
        record.finalStatus = 'in_progress';
        record.retryCount = retryCount + 1;
        return record;
      }

      case 'reevaluate': {
        const reevalCount = state.reevaluateCounter?.get(taskId) || 0;
        if (reevalCount >= MAX_REEVALUATE_ATTEMPTS) {
          // 重新评估次数已达上限，回退到 redevelop
          console.log(`⚠️  重新评估次数已达上限 (${MAX_REEVALUATE_ATTEMPTS})，转为从开发阶段重试`);
          return this.handleVerdictBasedTransition(taskId, record, state, addTimeline, phase, 'redevelop');
        }

        // 不消耗重试次数，使用独立的 reevaluateCounter
        await this.ensureTransition(taskId, 'in_progress', `评估不明确，重新评估 (${reevalCount + 1}/${MAX_REEVALUATE_ATTEMPTS})`);
        // 设置 resumeAction 和角色感知恢复
        await this.setTaskResumeAction(taskId, 'retry', 'evaluation');
        await this.assignTaskRole(taskId, 'architect');
        // 记录阶段历史
        this.appendPhaseHistory(taskId, { phase: 'evaluation', role: 'architect', verdict: 'NOPASS', timestamp: new Date().toISOString(), analysis: `评估不明确，重新评估 (${reevalCount + 1}/${MAX_REEVALUATE_ATTEMPTS})`, resumeAction: 'retry' });
        state.reevaluateCounter.set(taskId, reevalCount + 1);
        state.resumeFrom.set(taskId, 'evaluation');
        state.taskQueue.push(taskId);

        addTimeline('retry', `任务将重新评估 (${reevalCount + 1}/${MAX_REEVALUATE_ATTEMPTS})`, { action, reevalCount: reevalCount + 1 });
        console.log(`🔄  任务将重新评估 (${reevalCount + 1}/${MAX_REEVALUATE_ATTEMPTS})`);
        record.finalStatus = 'in_progress';
        return record;
      }

      case 'escalate_human': {
        await this.ensureTransition(taskId, 'needs_human', `architect 建议人工介入 (action: escalate_human)`);
        record.finalStatus = 'needs_human';
        addTimeline('failed', 'architect 建议人工介入', { action });
        console.log('🔴 任务需要人工介入');
        return record;
      }

      default: {
        // 未知 action，安全回退到 redevelop
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

    // 尝试退回到安全状态（仅当 rollbackStatus 与 expectedStatus 不同时）
    if (rollbackStatus !== expectedStatus) {
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
   * 后处理: 扫描已完成任务中的 requiresHuman 检查点并入队
   *
   * BUG-014-2: 人工验证从流水线阶段移至后处理
   * - 流水线完成后统一扫描所有 resolved 任务
   * - 将 requiresHuman 且仍为 pending 的检查点入队到验证队列
   * - 这些检查点的 verification.result 已在 syncAllPendingCheckpoints 中标记为 'deferred'
   */
  private collectAndEnqueueHumanCheckpoints(records: TaskExecutionRecord[]): void {
    let totalEnqueued = 0;

    for (const record of records) {
      // 仅处理已通过评估的任务
      if (record.finalStatus !== 'resolved') continue;

      const task = readTaskMeta(record.taskId, this.config.cwd);
      if (!task?.checkpoints?.length) continue;

      // 收集需要人工验证且仍为 pending 的检查点
      const humanCheckpoints = task.checkpoints.filter(cp =>
        (cp.requiresHuman === true || cp.verification?.method === 'human_verification') && cp.status === 'pending'
      );

      if (humanCheckpoints.length === 0) continue;

      console.log(`\n📋 任务 ${record.taskId}: 发现 ${humanCheckpoints.length} 个待人工验证检查点`);

      // 入队到验证队列
      const queueItems = humanCheckpoints.map(cp => ({
        taskId: task.id,
        taskTitle: task.title,
        checkpointId: cp.id,
        checkpointDescription: cp.description,
        verificationSteps: cp.verification?.commands,
        expectedResult: cp.verification?.expected,
        sessionId: this.sessionId,
      }));

      enqueueBatch(queueItems, this.config.cwd);
      totalEnqueued += queueItems.length;

      console.log(`   ✓ ${queueItems.length} 个检查点已加入人工验证队列`);
    }

    if (totalEnqueued > 0) {
      console.log(`\n📋 后处理完成: 共 ${totalEnqueued} 个检查点已加入人工验证队列`);
      console.log(`   💡 使用 projmnt4claude human-verification list 查看待验证项`);
    }
  }

  /**
   * 生成待人工验证报告
   */
  private generatePendingVerificationReport(): void {
    try {
      const stats = getQueueStats(this.config.cwd);
      if (stats.pending === 0) return;

      console.log(`\n📋 发现 ${stats.pending} 个待人工验证检查点`);

      const report = generateVerificationReport(this.config.cwd, this.sessionId);
      const projectDir = getProjectDir(this.config.cwd);
      const reportDir = path.join(projectDir, 'reports', 'harness');
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const reportPath = path.join(reportDir, `pending-verification-${Date.now()}.md`);
      fs.writeFileSync(reportPath, report, 'utf-8');

      console.log(`   📄 验证报告已生成: ${reportPath}`);
      console.log(`   💡 使用 projmnt4claude human-verification list 查看待验证项`);
      console.log(`   💡 使用 projmnt4claude human-verification approve <taskId> 批准验证`);
    } catch (error) {
      console.error(`   ⚠️ 生成待验证报告失败: ${error instanceof Error ? error.message : String(error)}`);
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
   * 将任务重新加入队列
   */
  requeue(taskId: string, state: HarnessRuntimeState): void {
    state.taskQueue.push(taskId);
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
    const lastRecordByTask = new Map<string, TaskExecutionRecord>();
    for (const record of state.records) {
      if (batchTaskIds.includes(record.taskId)) {
        lastRecordByTask.set(record.taskId, record);
      }
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const taskId of batchTaskIds) {
      const record = lastRecordByTask.get(taskId);
      if (!record) {
        skipped++;
      } else if (record.finalStatus === 'resolved' || record.finalStatus === 'closed') {
        passed++;
      } else if (record.finalStatus === 'abandoned' || record.finalStatus === 'needs_human') {
        failed++;
      } else {
        skipped++;
      }
    }

    const label = labels?.[batchIndex] || `批次 ${batchIndex + 1}`;
    console.log(`\n📊 ${label} 完成: ${passed} 通过, ${failed} 失败, ${skipped} 跳过 (${batchSize} 任务)`);
  }

  /**
   * 批次间自动 git commit
   *
   * 当启用 --batch-git-commit 且跨批次边界时，检查工作区是否有变更，
   * 有则执行 git add -A + git commit，commit message 包含批次标签和统计。
   * dry-run 模式仅输出提示不实际提交。
   */
  private commitBatchChanges(
    state: HarnessRuntimeState,
    batchIndex: number
  ): void {
    if (!this.config.batchGitCommit) return;

    const boundaries = state.batchBoundaries;
    if (!boundaries || boundaries.length === 0) return;

    const label = state.batchLabels?.[batchIndex] || `批次 ${batchIndex + 1}`;

    // 统计该批次的通过/失败数
    const batchStart = boundaries[batchIndex]!;
    const batchEnd = batchIndex + 1 < boundaries.length
      ? boundaries[batchIndex + 1]!
      : state.taskQueue.length;
    const batchTaskIds = new Set(state.taskQueue.slice(batchStart, batchEnd));

    const lastRecordByTask = new Map<string, TaskExecutionRecord>();
    for (const record of state.records) {
      if (batchTaskIds.has(record.taskId)) {
        lastRecordByTask.set(record.taskId, record);
      }
    }

    let passed = 0;
    let failed = 0;
    for (const taskId of batchTaskIds) {
      const record = lastRecordByTask.get(taskId);
      if (record && (record.finalStatus === 'resolved' || record.finalStatus === 'closed')) {
        passed++;
      } else if (record && (record.finalStatus === 'abandoned' || record.finalStatus === 'needs_human')) {
        failed++;
      }
    }

    if (this.config.dryRun) {
      console.log(`\n📝 [dry-run] 将为 ${label} 创建 git commit (${passed} 通过, ${failed} 失败)`);
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

      // 将 commit SHA 写入该批次所有任务的 executionStats.commitHistory
      if (commitSha) {
        const entry: CommitHistoryEntry = {
          sha: commitSha,
          batchLabel: label,
          timestamp: new Date().toISOString(),
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
}
