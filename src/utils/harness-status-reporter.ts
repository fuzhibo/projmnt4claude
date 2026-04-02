/**
 * HarnessStatusReporter - 流水线状态报告器
 *
 * 负责将流水线执行状态写入文件，供 AI 读取和报告
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarnessStatusReport,
  HarnessReportPhase,
  PhaseHistoryEntry,
} from '../types/harness.js';
import { createDefaultStatusReport } from '../types/harness.js';
import { getProjectDir } from './path.js';

/**
 * 状态报告器类
 *
 * 使用方式：
 * ```typescript
 * const reporter = new HarnessStatusReporter(cwd, sessionId);
 *
 * // 开始阶段
 * reporter.startPhase('development', taskId, '开始开发...');
 *
 * // 完成阶段
 * reporter.completePhase('development', taskId, '开发完成');
 *
 * // 更新进度
 * reporter.updateProgress(2, 5);
 *
 * // 失败
 * reporter.failPhase('development', error, taskId);
 * ```
 */
export class HarnessStatusReporter {
  private statusPath: string;
  private sessionId?: string;
  private currentReport: HarnessStatusReport;
  private lastBatchContext?: { batchIndex: number; totalBatches: number; batchLabel: string };

  constructor(cwd: string, sessionId?: string) {
    this.statusPath = path.join(getProjectDir(cwd), 'harness-status.json');
    this.sessionId = sessionId;
    this.currentReport = this.createInitialReport();
  }

  /**
   * 获取状态文件路径
   */
  getStatusPath(): string {
    return this.statusPath;
  }

  /**
   * 获取当前报告
   */
  getCurrentReport(): HarnessStatusReport {
    return this.currentReport;
  }

  /**
   * 更新状态
   */
  updateStatus(update: Partial<HarnessStatusReport>): void {
    this.currentReport = {
      ...this.currentReport,
      ...update,
      timestamp: new Date().toISOString(),
    };
    this.writeStatus();
  }

  /**
   * 开始新阶段
   */
  startPhase(phase: HarnessReportPhase, taskId?: string, message?: string): void {
    const entry: PhaseHistoryEntry = {
      phase,
      taskId,
      status: 'started',
      timestamp: new Date().toISOString(),
      message,
    };

    this.currentReport.phaseHistory.push(entry);
    this.currentReport.currentPhase = phase;
    this.currentReport.currentTaskId = taskId;
    this.currentReport.message = message || this.getPhaseMessage(phase, 'started');
    this.currentReport.timestamp = new Date().toISOString();

    this.writeStatus();
    this.logToConsole(phase, 'started', message);
  }

  /**
   * 完成当前阶段
   */
  completePhase(phase: HarnessReportPhase, taskId?: string, message?: string): void {
    // 找到最近的开始条目并更新
    const lastEntry = [...this.currentReport.phaseHistory]
      .reverse()
      .find(e => e.phase === phase && e.status === 'started');

    if (lastEntry) {
      lastEntry.status = 'completed';
      lastEntry.duration = Date.now() - new Date(lastEntry.timestamp).getTime();
      if (message) lastEntry.message = message;
    }

    this.currentReport.message = message || this.getPhaseMessage(phase, 'completed');
    this.currentReport.timestamp = new Date().toISOString();

    this.writeStatus();
    this.logToConsole(phase, 'completed', message);
  }

  /**
   * 阶段失败
   */
  failPhase(phase: HarnessReportPhase, error: Error, taskId?: string): void {
    const lastEntry = [...this.currentReport.phaseHistory]
      .reverse()
      .find(e => e.phase === phase && e.status === 'started');

    if (lastEntry) {
      lastEntry.status = 'failed';
      lastEntry.duration = Date.now() - new Date(lastEntry.timestamp).getTime();
      lastEntry.message = error.message;
    }

    this.currentReport.state = 'failed';
    this.currentReport.error = {
      code: 'PHASE_FAILED',
      message: error.message,
      taskId,
    };
    this.currentReport.message = `${this.getPhaseMessage(phase, 'failed')}: ${error.message}`;
    this.currentReport.timestamp = new Date().toISOString();

    this.writeStatus();
    this.logToConsole(phase, 'failed', error.message);
  }

  /**
   * 更新进度
   */
  updateProgress(
    completedTasks: number,
    totalTasks: number,
    batchContext?: { batchIndex: number; totalBatches: number; batchLabel: string }
  ): void {
    this.currentReport.completedTasks = completedTasks;
    this.currentReport.totalTasks = totalTasks;
    this.currentReport.progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    this.currentReport.timestamp = new Date().toISOString();
    if (batchContext) {
      this.currentReport.message = `${batchContext.batchLabel} (${batchContext.batchIndex + 1}/${batchContext.totalBatches}) - ${completedTasks}/${totalTasks} 完成`;
      this.lastBatchContext = batchContext;
    }
    this.writeStatus();
  }

  /**
   * 标记流水线开始
   */
  startPipeline(totalTasks: number, message?: string): void {
    this.currentReport = {
      ...this.currentReport,
      state: 'running',
      currentPhase: 'initialization',
      totalTasks,
      completedTasks: 0,
      progress: 0,
      message: message || `开始执行流水线，共 ${totalTasks} 个任务`,
      timestamp: new Date().toISOString(),
    };
    this.writeStatus();
    this.logToConsole('initialization', 'started', this.currentReport.message);
  }

  /**
   * 标记流水线完成
   */
  completePipeline(message?: string): void {
    this.currentReport = {
      ...this.currentReport,
      state: 'completed',
      currentPhase: 'completed',
      progress: 100,
      message: message || '流水线执行完成',
      timestamp: new Date().toISOString(),
    };
    this.writeStatus();
    this.logToConsole('completed', 'completed', this.currentReport.message);
  }

  /**
   * 标记流水线失败
   */
  failPipeline(error: Error, message?: string): void {
    this.currentReport = {
      ...this.currentReport,
      state: 'failed',
      currentPhase: 'failed',
      error: {
        code: 'PIPELINE_FAILED',
        message: error.message,
      },
      message: message || `流水线执行失败: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
    this.writeStatus();
    this.logToConsole('failed', 'failed', this.currentReport.message);
  }

  /**
   * 写入状态文件
   */
  private writeStatus(): void {
    const dir = path.dirname(this.statusPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statusPath, JSON.stringify(this.currentReport, null, 2), 'utf-8');
  }

  /**
   * 输出到控制台（供 AI 感知）
   */
  private logToConsole(phase: HarnessReportPhase, status: string, message?: string): void {
    const progress = `${this.currentReport.completedTasks}/${this.currentReport.totalTasks}`;
    const statusIcon = status === 'started' ? '▶' : status === 'completed' ? '✓' : '✗';
    const progressLabel = this.lastBatchContext
      ? `批次 ${this.lastBatchContext.batchIndex + 1}/${this.lastBatchContext.totalBatches} ${this.lastBatchContext.batchLabel} | 任务 ${progress}`
      : progress;
    console.log(`[Harness] ${statusIcon} [${progressLabel}] ${phase}${message ? ` - ${message}` : ''}`);
  }

  /**
   * 创建初始报告
   */
  private createInitialReport(): HarnessStatusReport {
    return createDefaultStatusReport(this.sessionId);
  }

  /**
   * 获取阶段消息
   */
  private getPhaseMessage(phase: HarnessReportPhase, status: 'started' | 'completed' | 'failed'): string {
    const messages: Record<HarnessReportPhase, Record<string, string>> = {
      idle: { started: '流水线就绪', completed: '流水线就绪', failed: '流水线错误' },
      initialization: { started: '初始化中...', completed: '初始化完成', failed: '初始化失败' },
      development: { started: '开发阶段进行中...', completed: '开发阶段完成', failed: '开发阶段失败' },
      code_review: { started: '代码审核中...', completed: '代码审核完成', failed: '代码审核失败' },
      qa_verification: { started: 'QA 验证中...', completed: 'QA 验证完成', failed: 'QA 验证失败' },
      human_verification: { started: '人工验证中...', completed: '人工验证完成', failed: '人工验证失败' },
      evaluation: { started: '最终评估中...', completed: '最终评估完成', failed: '最终评估失败' },
      completed: { started: '流水线完成', completed: '流水线完成', failed: '流水线失败' },
      failed: { started: '流水线失败', completed: '流水线失败', failed: '流水线失败' },
    };
    return messages[phase]?.[status] || phase;
  }
}
