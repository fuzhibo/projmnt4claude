/**
 * AssemblyLine - 执行流水线核心
 *
 * 负责任务队列管理和流程编排：
 * - 依赖检查
 * - 开发阶段调度
 * - 审查阶段调度
 * - 重试逻辑
 * - 状态持久化
 */

import * as path from 'path';
import {
  HarnessConfig,
  HarnessRuntimeState,
  ExecutionSummary,
  TaskExecutionRecord,
  DevReport,
  ReviewVerdict,
  ExecutionTimelineEntry,
  createDefaultExecutionRecord,
} from '../types/harness.js';
import { TaskMeta, TaskStatus } from '../types/task.js';
import { readTaskMeta, writeTaskMeta, taskExists } from './task.js';
import { getProjectDir } from './path.js';
import { HarnessExecutor } from './harness-executor.js';
import { HarnessEvaluator } from './harness-evaluator.js';
import { RetryHandler } from './harness-retry.js';
import { saveRuntimeState } from '../commands/harness.js';

export class AssemblyLine {
  private config: HarnessConfig;
  private executor: HarnessExecutor;
  private evaluator: HarnessEvaluator;
  private retryHandler: RetryHandler;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.executor = new HarnessExecutor(config);
    this.evaluator = new HarnessEvaluator(config);
    this.retryHandler = new RetryHandler(config);
  }

  /**
   * 运行执行流水线
   */
  async run(state: HarnessRuntimeState): Promise<ExecutionSummary> {
    const startTime = new Date().toISOString();
    state.state = 'running';
    state.startTime = startTime;

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
      record.finalStatus = 'blocked';
      return record;
    }

    // 2. 更新状态为 in_progress
    await this.updateTaskStatus(taskId, 'in_progress');
    record.finalStatus = 'in_progress';

    // 3. 开发阶段
    addTimeline('dev_started', '开始开发阶段');
    console.log('\n🔨 开发阶段...');

    let devReport: DevReport;
    try {
      devReport = await this.executor.execute(task, record.contract);
      record.devReport = devReport;
      addTimeline('dev_completed', `开发完成: ${devReport.status}`, { status: devReport.status });
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

    // 4. 更新状态为 wait_complete
    await this.updateTaskStatus(taskId, 'wait_complete');
    record.finalStatus = 'wait_complete';
    console.log('✅ 开发完成，等待审查');

    // 5. 审查阶段（上下文隔离）
    addTimeline('review_started', '开始审查阶段');
    console.log('\n🔍 审查阶段...');

    let verdict: ReviewVerdict;
    try {
      verdict = await this.evaluator.evaluate(task, devReport, record.contract);
      record.reviewVerdict = verdict;
      addTimeline('review_completed', `审查完成: ${verdict.result}`, { result: verdict.result });
    } catch (error) {
      verdict = {
        taskId,
        result: 'NOPASS',
        reason: `审查出错: ${error instanceof Error ? error.message : String(error)}`,
        failedCriteria: [],
        failedCheckpoints: [],
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'harness-evaluator',
      };
      record.reviewVerdict = verdict;
      addTimeline('review_completed', `审查出错: ${verdict.reason}`, { error: verdict.reason });
    }

    // 6. 根据审查结果更新状态
    if (verdict.result === 'PASS') {
      await this.updateTaskStatus(taskId, 'resolved');
      record.finalStatus = 'resolved';
      record.retryCount = state.retryCounter.get(taskId) || 0;
      console.log('✅ 审查通过！');
      addTimeline('completed', '任务完成');
    } else {
      console.log(`❌ 审查未通过: ${verdict.reason}`);

      // 尝试重试
      const shouldRetry = await this.retryHandler.shouldRetry(taskId, state.retryCounter);
      if (shouldRetry) {
        addTimeline('retry', `准备重试 (第 ${state.retryCounter.get(taskId) || 0} 次)`);
        // 重新加入队列
        state.taskQueue.push(taskId);
        state.retryCounter.set(taskId, (state.retryCounter.get(taskId) || 0) + 1);
        // 重置状态为 open
        await this.updateTaskStatus(taskId, 'reopened');
        record.finalStatus = 'reopened';
      } else {
        await this.updateTaskStatus(taskId, 'closed');
        record.finalStatus = 'closed';
        addTimeline('failed', '超过最大重试次数，任务关闭');
      }
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
   * 更新任务状态
   */
  private async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    try {
      updateTaskStatusUtil(taskId, status, this.config.cwd);
    } catch (error) {
      console.error(`更新任务状态失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 将任务重新加入队列
   */
  requeue(taskId: string, state: HarnessRuntimeState): void {
    state.taskQueue.push(taskId);
  }
}
