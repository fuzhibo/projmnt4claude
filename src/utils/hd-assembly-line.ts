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
} from '../types/harness.js';
import {
  createDefaultExecutionRecord,
} from '../types/harness.js';
import type { TaskMeta, TaskStatus, TaskRole, CheckpointMetadata } from '../types/task.js';
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

    // 报告流水线开始
    this.statusReporter.startPipeline(state.taskQueue.length);

    console.log(`\n🚀 开始执行流水线，共 ${state.taskQueue.length} 个任务\n`);

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
      console.log(`📋 处理任务 [${state.currentIndex + 1}/${state.taskQueue.length}]: ${taskId}`);
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
        this.statusReporter.updateProgress(state.currentIndex, state.taskQueue.length);

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
      }
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

    // 3. 更新状态为 in_progress
    await this.updateTaskStatus(taskId, 'in_progress');
    record.finalStatus = 'in_progress';

    // 4. 开发阶段
    addTimeline('dev_started', '开始开发阶段');
    this.statusReporter.startPhase('development', taskId, '开始开发阶段');
    console.log('\n🔨 开发阶段...');

    let devReport: DevReport;
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
    }

    // 检查开发是否成功
    if (devReport.status !== 'success') {
      console.log(`❌ 开发阶段失败: ${devReport.error || '未知错误'}`);

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
    await this.updateTaskStatus(taskId, 'wait_review');
    record.finalStatus = 'wait_review';
    console.log('✅ 开发完成，等待代码审核');

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
    }

    // 代码审核未通过，进入重试流程
    if (codeReviewVerdict.result !== 'PASS') {
      console.log(`❌ 代码审核未通过: ${codeReviewVerdict.reason}`);
      return this.handleFailure(taskId, record, state, addTimeline, 'code_review');
    }

    // 6.5 同步检查点状态（代码审核通过后）
    this.syncCheckpointStatus(taskId, 'code_review', { codeReviewVerdict });

    // 7. 更新状态为 wait_qa（等待 QA 验证）
    await this.updateTaskStatus(taskId, 'wait_qa');
    record.finalStatus = 'wait_qa';
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
    }

    // QA 验证未通过，进入重试流程
    if (qaVerdict.result !== 'PASS') {
      console.log(`❌ QA 验证未通过: ${qaVerdict.reason}`);
      return this.handleFailure(taskId, record, state, addTimeline, 'qa');
    }

    // 8.4 同步检查点状态（QA 通过后）
    this.syncCheckpointStatus(taskId, 'qa', { qaVerdict });

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

      await this.updateTaskStatus(taskId, 'resolved');
      record.finalStatus = 'resolved';
      record.retryCount = retryCount;
      console.log('✅ 评估通过！');
      addTimeline('completed', '任务完成');
    } else {
      console.log(`❌ 评估未通过: ${verdict.reason}`);
      return this.handleFailure(taskId, record, state, addTimeline, 'evaluation');
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
   * 处理任务失败
   */
  private async handleFailure(
    taskId: string,
    record: TaskExecutionRecord,
    state: HarnessRuntimeState,
    addTimeline: (event: ExecutionTimelineEntry['event'], description: string, data?: Record<string, unknown>) => void,
    phase: 'code_review' | 'qa' | 'evaluation'
  ): Promise<TaskExecutionRecord> {
    const retryCount = state.retryCounter.get(taskId) || 0;

    // 检查是否可以重试
    if (retryCount < this.config.maxRetries) {
      // 递增重开次数并重新加入队列
      this.incrementTaskReopenCount(taskId, `${phase} 阶段失败`);
      // 更新 meta.json 状态为 reopened，确保文件系统状态一致
      await this.updateTaskStatus(taskId, 'reopened', `${phase} 阶段失败，重新入队`);
      state.retryCounter.set(taskId, retryCount + 1);
      state.taskQueue.push(taskId);

      addTimeline('retry', `任务将在 ${phase} 阶段重试 (第 ${retryCount + 1} 次)`);
      console.log(`⚠️  任务将在 ${phase} 阶段重试 (第 ${retryCount + 1} 次)`);

      record.finalStatus = 'reopened';
      record.retryCount = retryCount + 1;
    } else {
      // 超过最大重试次数，放弃任务
      this.updateTaskStatus(taskId, 'abandoned', `超过最大重试次数 (${this.config.maxRetries})`);
      record.finalStatus = 'abandoned';
      record.retryCount = retryCount;

      addTimeline('failed', `超过最大重试次数，任务放弃`);
      console.log(`❌ 超过最大重试次数 (${this.config.maxRetries})，任务放弃`);
    }

    return record;
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
   * 将任务重新加入队列
   */
  requeue(taskId: string, state: HarnessRuntimeState): void {
    state.taskQueue.push(taskId);
  }
}
