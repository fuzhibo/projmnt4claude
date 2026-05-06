/**
 * Pre-Eval Gate Runner
 * 评估阶段前门禁协调器 - 统一管理和执行评估前置条件检查
 *
 * 职责:
 * - 编排评估前置检查器的执行顺序
 * - 聚合各检查器的结果
 * - 根据规则决定是否允许进入评估阶段
 * - 生成门禁报告
 *
 * 设计文档: docs/investigation/hd-p14-evaluation-pre-gate-design.md
 *
 * @module pre-eval-gate/runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta } from '../../types/task.js';
import { readTaskMeta } from '../task.js';
import type {
  PreEvalCheckContext,
  PreEvalCheckResult,
  PreEvalGateDecision,
  PreEvalGateRunResult,
  PreEvalGateReport,
  PreEvalGateRunnerConfig,
  IPreEvalChecker,
  QAReport,
} from './types.js';
import { QAPassChecker } from './qa-pass-checker.js';
import { QAReportExistenceChecker } from './checkers/qa-report-existence-checker.js';
import { DevReportChecker } from './checkers/dev-report-checker.js';
import { CodeReviewReportChecker } from './checkers/code-review-report-checker.js';
import { AllCheckpointsCompletedChecker } from './checkers/all-checkpoints-completed-checker.js';
import { PhaseHistoryCompleteChecker } from './checkers/phase-history-checker.js';

// ============== 默认配置 ==============

/**
 * 默认评估前门禁运行器配置
 */
export const DEFAULT_PRE_EVAL_GATE_RUNNER_CONFIG: PreEvalGateRunnerConfig = {
  enabled: true,
  stopOnFailure: false,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/pre-eval-gate-report.json',
  qaReportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
  outputsPath: '.projmnt4claude/outputs/{taskId}',
};

// ============== PreEvalGateRunner 类 ==============

/**
 * 评估阶段前门禁协调器
 *
 * 统一管理和执行评估前置条件检查，协调多个检查器的执行，
 * 根据规则引擎决定是否允许任务进入评估阶段。
 */
export class PreEvalGateRunner {
  private config: PreEvalGateRunnerConfig;
  private cwd: string;
  private checkers: IPreEvalChecker[];

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PreEvalGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_PRE_EVAL_GATE_RUNNER_CONFIG, ...config };

    // 注册内置检查器
    this.checkers = [
      new QAPassChecker(),
      new QAReportExistenceChecker(),
      new DevReportChecker(),
      new CodeReviewReportChecker(),
      new AllCheckpointsCompletedChecker(),
      new PhaseHistoryCompleteChecker(),
    ];
  }

  /**
   * 执行评估前门禁检查
   *
   * @param taskId 任务ID
   * @returns 门禁运行结果
   */
  async run(taskId: string): Promise<PreEvalGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'PRE_EVAL_PASS',
        allowed: true,
        ruleResults: [],
        passedRules: 0,
        failedRules: 0,
        warningCount: 0,
        blockingFailures: 0,
        duration: 0,
        timestamp,
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        decision: 'PRE_EVAL_FAIL',
        allowed: false,
        ruleResults: [{
          ruleId: 'task-existence',
          passed: false,
          severity: 'ERROR',
          message: `任务 ${taskId} 不存在`,
        }],
        passedRules: 0,
        failedRules: 1,
        warningCount: 0,
        blockingFailures: 1,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 加载QA报告
    const qaReport = this.loadQAReport(taskId);

    // 创建上下文
    const context: PreEvalCheckContext = {
      taskId,
      task,
      cwd: this.cwd,
      qaReport,
    };

    // 执行所有检查器
    const ruleResults: PreEvalCheckResult[] = [];

    for (const checker of this.checkers) {
      const result = await checker.check(context);
      if (Array.isArray(result)) {
        ruleResults.push(...result);
      } else {
        ruleResults.push(result);
      }

      // 如果有阻塞失败且配置了停止，提前退出
      if (this.config.stopOnFailure) {
        const hasBlockingFailure = ruleResults.some(
          r => !r.passed && r.severity === 'ERROR'
        );
        if (hasBlockingFailure) break;
      }
    }

    // 计算统计
    const passedRules = ruleResults.filter(r => r.passed).length;
    const failedRules = ruleResults.filter(r => !r.passed).length;
    const warningCount = ruleResults.filter(r => !r.passed && r.severity === 'WARNING').length;
    const blockingFailures = ruleResults.filter(r => !r.passed && r.severity === 'ERROR').length;

    // 计算决策
    const decision = this.calculateDecision(ruleResults, blockingFailures);
    const allowed = decision === 'PRE_EVAL_PASS' || (decision === 'PRE_EVAL_WARN' && blockingFailures === 0);

    const runResult: PreEvalGateRunResult = {
      taskId,
      decision,
      allowed,
      ruleResults,
      passedRules,
      failedRules,
      warningCount,
      blockingFailures,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    // 生成报告
    if (this.config.generateReport) {
      const report = this.generateReport(runResult);
      await this.saveReport(report);
    }

    return runResult;
  }

  /**
   * 加载QA报告
   */
  private loadQAReport(taskId: string): QAReport | undefined {
    const qaReportPath = this.config.qaReportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, qaReportPath);

    if (!fs.existsSync(fullPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as QAReport;
    } catch {
      return undefined;
    }
  }

  /**
   * 计算门禁决策
   */
  private calculateDecision(results: PreEvalCheckResult[], blockingFailures: number): PreEvalGateDecision {
    if (blockingFailures > 0) {
      return 'PRE_EVAL_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'PRE_EVAL_PASS';
    }

    // 有非阻塞失败 (WARNING)，返回警告
    return 'PRE_EVAL_WARN';
  }

  // ============== 报告生成 ==============

  /**
   * 生成评估前门禁报告
   */
  generateReport(result: PreEvalGateRunResult): PreEvalGateReport {
    const recommendations: string[] = [];

    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'R-EVAL-PRE-001':
            recommendations.push('QA验证未通过: 请先完成QA验证并确保结果为 PASS');
            break;
          case 'R-EVAL-PRE-002':
            recommendations.push('开发报告缺失: 确保 dev-report.json 已生成');
            break;
          case 'R-EVAL-PRE-003':
            recommendations.push('代码审核报告缺失: 确保 code-review-report.json 已生成');
            break;
          case 'R-EVAL-PRE-004':
            recommendations.push('QA报告缺失: 确保 qa-report.json 已生成');
            break;
          case 'R-EVAL-PRE-005':
            recommendations.push('检查点未完成: 完成所有待处理的检查点');
            break;
          case 'R-EVAL-PRE-006':
            recommendations.push('阶段历史不完整: 确保 development、code_review、qa 阶段已执行');
            break;
        }
      }
    }

    if (result.decision === 'PRE_EVAL_PASS') {
      recommendations.push('✅ 任务满足评估条件，可以进入评估阶段');
    }

    return {
      reportId: `pre-eval-gate-report-${result.taskId}-${Date.now()}`,
      taskId: result.taskId,
      generatedAt: new Date().toISOString(),
      result,
      recommendations,
      metadata: {
        version: '1.0.0',
        runnerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
      },
    };
  }

  /**
   * 保存门禁报告
   */
  private async saveReport(report: PreEvalGateReport): Promise<void> {
    if (!this.config.reportPath) return;

    const reportDir = path.dirname(path.join(this.cwd, this.config.reportPath));
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(this.cwd, this.config.reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * 格式化门禁结果为终端输出
   */
  formatResult(result: PreEvalGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    const decisionIcon = result.decision === 'PRE_EVAL_PASS' ? '✅' :
                        result.decision === 'PRE_EVAL_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 评估阶段前门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许进入评估阶段: ${result.allowed ? '是' : '否'}`);
    lines.push('');

    lines.push('📋 规则统计:');
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
        const icon = ruleResult.passed ? '✅' : ruleResult.severity === 'ERROR' ? '❌' : '⚠️ ';
        lines.push(`   ${icon} [${ruleResult.ruleId}]`);
        lines.push(`      ${ruleResult.message}`);
        lines.push('');
      }
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
  updateConfig(config: Partial<PreEvalGateRunnerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PreEvalGateRunnerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建评估前门禁运行器实例
 */
export function createPreEvalGateRunner(
  cwd: string,
  config?: Partial<PreEvalGateRunnerConfig>
): PreEvalGateRunner {
  return new PreEvalGateRunner(cwd, config);
}

/**
 * 快速执行评估前门禁检查
 */
export async function quickPreEvalGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PreEvalGateRunnerConfig>
): Promise<PreEvalGateRunResult> {
  const runner = new PreEvalGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行评估前门禁检查
 */
export async function batchPreEvalGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PreEvalGateRunnerConfig>
): Promise<PreEvalGateRunResult[]> {
  const runner = new PreEvalGateRunner(cwd, config);
  const results: PreEvalGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PreEvalGateRunner;
