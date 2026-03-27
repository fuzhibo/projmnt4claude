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
import {
  HarnessConfig,
  HarnessRuntimeState,
  ExecutionSummary,
  TaskExecutionRecord,
  DevReport,
  ReviewVerdict,
  CodeReviewVerdict,
  QAVerdict,
  ExecutionTimelineEntry,
  createDefaultExecutionRecord,
} from '../types/harness.js';
import { TaskMeta, TaskStatus, TaskRole } from '../types/task.js';
import { readTaskMeta, writeTaskMeta, taskExists, updateTaskStatus, assignRole, incrementReopenCount } from './task.js';
import { getProjectDir } from './path.js';
import { HarnessExecutor } from './harness-executor.js';
import { HarnessCodeReviewer } from './harness-code-reviewer.js';
import { HarnessQATester } from './harness-qa-tester.js';
import { HarnessHumanVerifier } from './harness-human-verifier.js';
import { HarnessEvaluator } from './harness-evaluator.js';
import { RetryHandler } from './harness-retry.js';
import { HarnessStatusReporter } from './harness-status-reporter.js';
import { saveRuntimeState } from '../commands/harness.js';

export class AssemblyLine {
  private config: HarnessConfig;
  private executor: HarnessExecutor;
  private codeReviewer: HarnessCodeReviewer;
  private qaTester: HarnessQATester;
  private humanVerifier: HarnessHumanVerifier;
  private evaluator: HarnessEvaluator;
  private retryHandler: RetryHandler;
  private statusReporter: HarnessStatusReporter;

  constructor(config: HarnessConfig, sessionId?: string) {
    this.config = config;
    this.executor = new HarnessExecutor(config);
    this.codeReviewer = new HarnessCodeReviewer(config);
    this.qaTester = new HarnessQATester(config);
    this.humanVerifier = new HarnessHumanVerifier(config);
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

      console.log(`\n${'━'.repeat(50)}`);
      console.log(`📋 处理任务 [${state.currentIndex + 1}/${state.taskQueue.length}]: ${taskId}`);
      console.log('━'.repeat(50));

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

    // 2. 更新状态为 in_progress
    await this.updateTaskStatus(taskId, 'in_progress');
    record.finalStatus = 'in_progress';

    // 3. 开发阶段
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

    // 4. 更新状态为 wait_review（等待代码审核）
    await this.updateTaskStatus(taskId, 'wait_review');
    record.finalStatus = 'wait_review';
    console.log('✅ 开发完成，等待代码审核');

    // 5. 代码审核阶段（新增）
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

    // 6. 更新状态为 wait_qa（等待 QA 验证）
    await this.updateTaskStatus(taskId, 'wait_qa');
    record.finalStatus = 'wait_qa';
    console.log('✅ 代码审核通过，等待 QA 验证');

    // 7. QA 验证阶段（新增）
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

    // 7.5 人工验证阶段（条件触发）
    let humanVerdicts: HumanVerdict[] = [];
    if (qaVerdict.requiresHuman && qaVerdict.humanVerificationCheckpoints.length > 0) {
      addTimeline('human_verification_started', '开始人工验证阶段');
      this.statusReporter.startPhase('human_verification', taskId, '开始人工验证阶段');
      console.log('\n👤 人工验证阶段...');
      console.log(`   需要验证 ${qaVerdict.humanVerificationCheckpoints.length} 个检查点`);

      try {
        humanVerdicts = await this.humanVerifier.requestVerification(task, qaVerdict);
        record.humanVerdicts = humanVerdicts;

        // 检查是否所有人工验证都通过
        const allPassed = humanVerdicts.every(v => v.result === 'PASS');
        if (!allPassed) {
          const failedCheckpoints = humanVerdicts.filter(v => v.result !== 'PASS').map(v => v.checkpointId);
          addTimeline('human_verification_completed', `人工验证未通过`, { failedCheckpoints });
          this.statusReporter.failPhase('human_verification', new Error('人工验证未通过'), taskId);
          console.log(`❌ 人工验证未通过: ${failedCheckpoints.join(', ')}`);
          return this.handleFailure(taskId, record, state, addTimeline, 'human_verification');
        }

        addTimeline('human_verification_completed', '人工验证通过');
        this.statusReporter.completePhase('human_verification', taskId, '人工验证通过');
        console.log('✅ 人工验证通过');
      } catch (error) {
        addTimeline('human_verification_completed', `人工验证出错: ${error instanceof Error ? error.message : String(error)}`);
        this.statusReporter.failPhase('human_verification', error instanceof Error ? error : new Error(String(error)), taskId);
        console.log(`❌ 人工验证出错: ${error instanceof Error ? error.message : String(error)}`);
        return this.handleFailure(taskId, record, state, addTimeline, 'human_verification');
      }
    }

    // 8. 更新状态为 wait_complete
    await this.updateTaskStatus(taskId, 'wait_complete');
    record.finalStatus = 'wait_complete';
    console.log('✅ 所有验证通过，等待最终确认');

    // 9. 最终评估阶段（保留原有 Evaluator）
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

    // 10. 根据评估结果更新状态
    if (verdict.result === 'PASS') {
      await this.updateTaskStatus(taskId, 'resolved');
      record.finalStatus = 'resolved';
      record.retryCount = state.retryCounter.get(taskId) || 0;
      console.log('✅ 评估通过！');
      addTimeline('completed', '任务完成');
    } else {
      console.log(`❌ 评估未通过: ${verdict.reason}`);
      return this.handleFailure(taskId, record, state, addTimeline, 'evaluation');
    }

    return record;
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
  private handleFailure(
    taskId: string,
    record: TaskExecutionRecord,
    state: HarnessRuntimeState,
    addTimeline: (event: ExecutionTimelineEntry['event'], description: string, data?: Record<string, unknown>) => void,
    phase: 'code_review' | 'qa' | 'human_verification' | 'evaluation'
  ): TaskExecutionRecord {
    const retryCount = state.retryCounter.get(taskId) || 0;

    // 检查是否可以重试
    if (retryCount < this.config.maxRetries) {
      // 递增重开次数并重新加入队列
      this.incrementTaskReopenCount(taskId, `${phase} 阶段失败`);
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
   * 将任务重新加入队列
   */
  requeue(taskId: string, state: HarnessRuntimeState): void {
    state.taskQueue.push(taskId);
  }
}
