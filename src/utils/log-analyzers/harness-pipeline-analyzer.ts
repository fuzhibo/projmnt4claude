/**
 * HarnessPipelineAnalyzer - 流水线执行日志分析器
 *
 * 检测 Harness Design 流水线执行中的问题：
 * - 任务卡住（长时间无进展）
 * - 阶段转换失败
 * - 批次执行异常
 * - 质量门禁频繁失败
 */

import type { LogEntry } from '../logger.js';
import {
  type LogAnalyzer,
  type AnalysisCategory,
  type AnalysisStrategy,
  type AnalysisResult,
  type AnalysisFinding,
  type AnalysisContext,
} from '../log-analyzer.js';

export class HarnessPipelineAnalyzer implements LogAnalyzer {
  readonly name = 'harness-pipeline-analyzer';
  readonly category: AnalysisCategory = 'harness-pipeline';
  readonly supportedStrategies: AnalysisStrategy[] = ['rule', 'ai', 'hybrid'];

  async analyze(
    entries: LogEntry[],
    strategy: AnalysisStrategy,
    _context?: AnalysisContext,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: AnalysisFinding[] = [];

    // 筛选流水线相关日志
    const pipelineEntries = entries.filter(e =>
      e.component?.includes('harness') ||
      e.component?.includes('assembly-line') ||
      e.component?.includes('pipeline') ||
      (e.message && (
        e.message.includes('批次') ||
        e.message.includes('阶段') ||
        e.message.includes('流水线') ||
        e.message.includes('assembly') ||
        e.message.includes('phase')
      ))
    );

    // 规则 1: 检测任务卡住
    const stuckEntries = pipelineEntries.filter(e =>
      e.level === 'error' &&
      (e.message.includes('超时') || e.message.includes('timeout') || e.message.includes('stuck'))
    );
    if (stuckEntries.length >= 2) {
      findings.push({
        analyzer: this.name,
        severity: 'error',
        category: this.category,
        title: `检测到 ${stuckEntries.length} 个任务可能卡住`,
        description: '多个任务出现超时，可能导致流水线整体阻塞',
        evidence: stuckEntries.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
        recommendation: '检查被阻塞任务的具体原因，考虑增加超时时间或拆分复杂任务',
        detectedAt: new Date().toISOString(),
      });
    }

    // 规则 2: 检测阶段转换失败
    const transitionErrors = pipelineEntries.filter(e =>
      e.level === 'error' &&
      (e.message.includes('阶段转换') || e.message.includes('transition') || e.message.includes('NOPASS'))
    );
    if (transitionErrors.length >= 3) {
      findings.push({
        analyzer: this.name,
        severity: 'warning',
        category: this.category,
        title: `检测到 ${transitionErrors.length} 次阶段转换失败`,
        description: '频繁的阶段转换失败可能表示代码质量系统性问题',
        evidence: transitionErrors.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
        recommendation: '检查失败任务的评估反馈，关注共性问题',
        detectedAt: new Date().toISOString(),
      });
    }

    // 规则 3: 检测批次失败
    const batchFailures = pipelineEntries.filter(e =>
      e.level === 'error' &&
      (e.message.includes('批次') && (e.message.includes('失败') || e.message.includes('failed')))
    );
    if (batchFailures.length >= 2) {
      findings.push({
        analyzer: this.name,
        severity: 'warning',
        category: this.category,
        title: `检测到 ${batchFailures.length} 个批次执行失败`,
        description: '批次级别的失败会影响整个流水线进度',
        evidence: batchFailures.map(e => `[${e.timestamp}] ${e.message}`),
        recommendation: '检查失败批次中的具体任务，修复后重新执行',
        detectedAt: new Date().toISOString(),
      });
    }

    // 规则 4: 检测质量门禁频繁失败
    const gateFailures = pipelineEntries.filter(e =>
      e.message.includes('质量门禁') || e.message.includes('quality gate') || e.message.includes('quality-gate')
    );
    const failedGates = gateFailures.filter(e =>
      e.message.includes('失败') || e.message.includes('未通过') || e.message.includes('NOPASS')
    );
    if (failedGates.length >= 3) {
      findings.push({
        analyzer: this.name,
        severity: 'warning',
        category: this.category,
        title: `检测到 ${failedGates.length} 次质量门禁未通过`,
        description: '质量门禁频繁失败，任务内容可能需要改进',
        evidence: failedGates.slice(0, 5).map(e => `[${e.timestamp}] ${e.message}`),
        recommendation: '检查质量评分较低的维度，针对性提升任务描述质量',
        detectedAt: new Date().toISOString(),
      });
    }

    return {
      analyzerName: this.name,
      strategy: strategy === 'ai' ? 'ai' : 'rule',
      findings,
      stats: {
        entriesScanned: pipelineEntries.length,
        findingsCount: findings.length,
        durationMs: Date.now() - startTime,
      },
    };
  }
}
