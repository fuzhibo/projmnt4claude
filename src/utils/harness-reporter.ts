/**
 * HarnessReporter - 报告生成器
 *
 * 负责：
 * - 生成开发报告
 * - 生成审查报告
 * - 生成执行摘要
 * - 格式化报告输出
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarnessConfig,
  ExecutionSummary,
  TaskExecutionRecord,
} from '../types/harness.js';
import { getProjectDir } from './path.js';

/**
 * Summary 结论评估结果
 */
export interface SummaryConclusion {
  /** 结论标记：success / partial-fail / all-fail / anomaly / incomplete */
  verdict: 'success' | 'partial-fail' | 'all-fail' | 'anomaly' | 'incomplete';
  /** 面向用户的结论消息（Markdown） */
  message: string;
}

/**
 * 评估执行摘要结论（CP-14 公共函数）
 *
 * 5 分支逻辑：
 * 1. passed=0 && failed=0 → anomaly（流水线异常终止）
 * 2. passed+failed < totalTasks → incomplete（流水线未完整执行）
 * 3. failed=0 → success（所有任务执行成功）
 * 4. passed>0 → partial-fail（部分任务失败）
 * 5. 其余 → all-fail（所有任务执行失败）
 */
export function evaluateSummaryConclusion(summary: ExecutionSummary): SummaryConclusion {
  const completedTasks = summary.passed + summary.failed;
  const allCounted = completedTasks >= summary.totalTasks;

  // 分支 1: 无任何 verdict 但 totalTasks > 0 — 异常终止
  if (summary.totalTasks > 0 && summary.passed === 0 && summary.failed === 0) {
    return {
      verdict: 'anomaly',
      message: `🚨 **流水线异常终止**: 共 ${summary.totalTasks} 个任务，但未记录任何执行结果。可能由流水线中断或 taskResults 未填充导致。`,
    };
  }

  // 分支 2: passed + failed < totalTasks — 未完整执行
  if (!allCounted) {
    return {
      verdict: 'incomplete',
      message: `🟡 **流水线未完整执行**: ${summary.passed}/${summary.totalTasks} 通过，${summary.failed}/${summary.totalTasks} 失败，${summary.totalTasks - completedTasks} 个任务未执行。`,
    };
  }

  // 分支 3: 全部通过
  if (summary.failed === 0) {
    return {
      verdict: 'success',
      message: '✅ **所有任务执行成功！**',
    };
  }

  // 分支 4: 部分失败
  if (summary.passed > 0) {
    return {
      verdict: 'partial-fail',
      message: `⚠️ **部分任务失败**: ${summary.passed}/${summary.totalTasks} 通过`,
    };
  }

  // 分支 5: 全部失败
  return {
    verdict: 'all-fail',
    message: '❌ **所有任务执行失败**',
  };
}

export class HarnessReporter {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 生成执行摘要报告
   */
  async generateSummaryReport(summary: ExecutionSummary): Promise<void> {
    const reportPath = this.getSummaryReportPath();
    const dir = path.dirname(reportPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = this.formatSummaryReport(summary);
    fs.writeFileSync(reportPath, content, 'utf-8');

    console.log(`\n📄 执行摘要已保存: ${reportPath}`);
  }

  /**
   * 格式化执行摘要报告
   */
  private formatSummaryReport(summary: ExecutionSummary): string {
    // CP-16: 审计日志 — 在报告生成入口点快照 summary 状态
    const auditSnapshot = {
      timestamp: new Date().toISOString(),
      totalTasks: summary.totalTasks,
      passed: summary.passed,
      failed: summary.failed,
      taskResultsSize: summary.taskResults.size,
      passedFailedDelta: summary.totalTasks - (summary.passed + summary.failed),
    };
    console.error(`[CP-16] formatSummaryReport entry: ${JSON.stringify(auditSnapshot)}`);

    const lines: string[] = [];

    lines.push('# Harness Design 执行摘要');
    lines.push('');
    lines.push(`**生成时间**: ${new Date().toISOString()}`);
    lines.push('');

    // 统计概览
    lines.push('## 统计概览');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('|------|------|');
    lines.push(`| 总任务数 | ${summary.totalTasks} |`);
    lines.push(`| ✅ 通过 | ${summary.passed} |`);
    lines.push(`| ❌ 失败 | ${summary.failed} |`);
    lines.push(`| 🔄 重试次数 | ${summary.totalRetries} |`);
    lines.push(`| ⏱️ 总耗时 | ${(summary.duration / 1000).toFixed(1)}s |`);
    lines.push('');

    // 通过率
    const passRate = summary.totalTasks > 0
      ? ((summary.passed / summary.totalTasks) * 100).toFixed(1)
      : '0';
    lines.push(`**通过率**: ${passRate}%`);
    lines.push('');

    // 配置信息
    lines.push('## 执行配置');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({
      maxRetries: summary.config.maxRetries,
      timeout: summary.config.timeout,
      parallel: summary.config.parallel,
      dryRun: summary.config.dryRun,
    }, null, 2));
    lines.push('```');
    lines.push('');

    // 任务结果详情
    lines.push('## 任务结果详情');
    lines.push('');

    const records = Array.from(summary.taskResults.values());

    // 按状态分组
    const passed = records.filter(r => r.reviewVerdict?.result === 'PASS');
    const failed = records.filter(r =>
      r.reviewVerdict?.result === 'NOPASS' || r.devReport.status === 'failed'
    );

    if (passed.length > 0) {
      lines.push('### ✅ 通过的任务');
      lines.push('');
      lines.push('| 任务ID | 标题 | 重试次数 | 耗时 |');
      lines.push('|--------|------|----------|------|');
      for (const record of passed) {
        lines.push(`| ${record.taskId} | ${record.task.title.substring(0, 30)} | ${record.retryCount} | ${(record.devReport.duration / 1000).toFixed(1)}s |`);
      }
      lines.push('');
    }

    if (failed.length > 0) {
      lines.push('### ❌ 失败的任务');
      lines.push('');
      lines.push('| 任务ID | 标题 | 状态 | 原因 |');
      lines.push('|--------|------|------|------|');
      for (const record of failed) {
        const reason = record.reviewVerdict?.reason || record.devReport.error || '未知';
        lines.push(`| ${record.taskId} | ${record.task.title.substring(0, 30)} | ${record.finalStatus} | ${reason.substring(0, 40)} |`);
      }
      lines.push('');
    }

    // 时间线
    lines.push('## 执行时间线');
    lines.push('');
    lines.push('```');
    lines.push(`开始时间: ${summary.startTime}`);
    lines.push(`结束时间: ${summary.endTime}`);
    lines.push(`总耗时: ${(summary.duration / 1000).toFixed(1)}s`);
    lines.push('```');
    lines.push('');

    // 详细报告链接
    lines.push('## 详细报告');
    lines.push('');
    lines.push('各任务的详细报告位于:');
    lines.push('- 开发报告: `.projmnt4claude/reports/harness/{taskId}/dev-report.md`');
    lines.push('- 审查报告: `.projmnt4claude/reports/harness/{taskId}/review-report.md`');
    lines.push('');

    // 结论
    const conclusion = evaluateSummaryConclusion(summary);
    lines.push('## 结论');
    lines.push('');
    lines.push(conclusion.message);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * 获取摘要报告路径
   */
  private getSummaryReportPath(): string {
    const projectDir = getProjectDir(this.config.cwd);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    return path.join(projectDir, 'reports', 'harness', `summary-${timestamp}.md`);
  }

  /**
   * 生成任务报告
   */
  async generateTaskReport(record: TaskExecutionRecord): Promise<void> {
    const taskDir = this.getTaskReportDir(record.taskId);

    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }

    // 生成任务概览
    const overviewPath = path.join(taskDir, 'overview.md');
    const overviewContent = this.formatTaskOverview(record);
    fs.writeFileSync(overviewPath, overviewContent, 'utf-8');
  }

  /**
   * 格式化任务概览
   */
  private formatTaskOverview(record: TaskExecutionRecord): string {
    const lines: string[] = [];

    lines.push(`# 任务概览 - ${record.taskId}`);
    lines.push('');
    lines.push(`**标题**: ${record.task.title}`);
    lines.push(`**类型**: ${record.task.type}`);
    lines.push(`**优先级**: ${record.task.priority}`);
    lines.push(`**最终状态**: ${record.finalStatus}`);
    lines.push(`**重试次数**: ${record.retryCount}`);
    lines.push('');

    // Sprint Contract
    lines.push('## Sprint Contract');
    lines.push('');
    if (record.contract.acceptanceCriteria.length > 0) {
      lines.push('### 验收标准');
      record.contract.acceptanceCriteria.forEach((criteria, i) => {
        lines.push(`${i + 1}. ${criteria}`);
      });
      lines.push('');
    }

    // Checkpoints now from task.checkpoints directly
    const taskCheckpoints = record.task.checkpoints || [];
    if (taskCheckpoints.length > 0) {
      lines.push('### 检查点');
      taskCheckpoints.forEach((cp, i) => {
        lines.push(`${i + 1}. [${cp.id}] ${cp.description}`);
      });
      lines.push('');
    }

    // 开发阶段
    lines.push('## 开发阶段');
    lines.push('');
    lines.push(`- **状态**: ${record.devReport.status}`);
    lines.push(`- **耗时**: ${(record.devReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- **证据数量**: ${record.devReport.evidence.length}`);
    lines.push(`- **完成检查点**: ${record.devReport.checkpointsCompleted.length}/${taskCheckpoints.length}`);
    lines.push('');

    // 审查阶段
    if (record.reviewVerdict) {
      lines.push('## 审查阶段');
      lines.push('');
      lines.push(`- **结果**: ${record.reviewVerdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`);
      lines.push(`- **原因**: ${record.reviewVerdict.reason}`);
      lines.push('');

      if (record.reviewVerdict.failedCriteria.length > 0) {
        lines.push('### 未满足的标准');
        record.reviewVerdict.failedCriteria.forEach(criteria => {
          lines.push(`- ${criteria}`);
        });
        lines.push('');
      }

      if (record.reviewVerdict.failedCheckpoints.length > 0) {
        lines.push('### 未完成的检查点');
        record.reviewVerdict.failedCheckpoints.forEach(checkpoint => {
          lines.push(`- ${checkpoint}`);
        });
        lines.push('');
      }
    }

    // 时间线
    lines.push('## 执行时间线');
    lines.push('');
    lines.push('| 时间 | 事件 | 描述 |');
    lines.push('|------|------|------|');
    for (const entry of record.timeline) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      lines.push(`| ${time} | ${entry.event} | ${entry.description} |`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * 获取任务报告目录
   */
  private getTaskReportDir(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'reports', 'harness', taskId);
  }

  /**
   * 生成 JSON 格式的摘要
   */
  generateJSONSummary(summary: ExecutionSummary): string {
    const data = {
      totalTasks: summary.totalTasks,
      passed: summary.passed,
      failed: summary.failed,
      totalRetries: summary.totalRetries,
      duration: summary.duration,
      startTime: summary.startTime,
      endTime: summary.endTime,
      passRate: summary.totalTasks > 0
        ? ((summary.passed / summary.totalTasks) * 100).toFixed(1) + '%'
        : '0%',
      tasks: Array.from(summary.taskResults.values()).map(record => ({
        taskId: record.taskId,
        title: record.task.title,
        type: record.task.type,
        priority: record.task.priority,
        finalStatus: record.finalStatus,
        retryCount: record.retryCount,
        devStatus: record.devReport.status,
        devDuration: record.devReport.duration,
        reviewResult: record.reviewVerdict?.result,
        reviewReason: record.reviewVerdict?.reason,
      })),
    };

    return JSON.stringify(data, null, 2);
  }
}
