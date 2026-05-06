/**
 * Post-Eval Gate Runner
 * 评估阶段后门禁协调器 - 统一管理和执行评估后置条件检查
 *
 * 职责:
 * - 编排评估后置检查器的执行顺序 (7条规则 R-EVAL-POST-001 ~ 007)
 * - 加载多阶段报告 (dev/code-review/qa/eval)
 * - 聚合各检查器的结果
 * - 根据规则决定是否允许标记任务完成
 * - 生成门禁报告
 *
 * 设计文档: docs/investigation/hd-p15-evaluation-post-gate-design.md
 *
 * @module post-eval-gate/runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskMeta } from '../../types/task.js';
import { readTaskMeta } from '../task.js';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  PostEvalGateDecision,
  PostEvalGateRunResult,
  PostEvalGateReport,
  PostEvalGateRunnerConfig,
  IPostEvalChecker,
  EvalReport,
  DevReport,
  CodeReviewReport,
  QAReport,
} from './types.js';
import { EvalReportExistsChecker } from './checkers/eval-report-existence-checker.js';
import { EvalLogsChecker } from './checkers/eval-logs-checker.js';
import { AllCheckpointsFinalChecker } from './checkers/checkpoints-final-checker.js';
import { FinalStateConsistencyChecker } from './checkers/state-consistency-checker.js';
import { TaskClosableChecker } from './checkers/task-closable-checker.js';

// ============== 内置检查器 ==============

/**
 * R-EVAL-POST-002: 报告格式有效性检查
 * 等级: ERROR (阻塞)
 * JSON 可解析为有效结构
 */
class EvalReportJsonChecker implements IPostEvalChecker {
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { evalReport } = ctx;

    if (!evalReport) {
      return {
        ruleId: 'R-EVAL-POST-002',
        passed: false,
        severity: 'ERROR',
        message: '无法检查报告格式: 评估报告未加载',
      };
    }

    const requiredFields = ['version', 'taskId', 'result', 'evaluatedAt', 'evaluator', 'summary', 'evaluationLogs'];
    const missingFields = requiredFields.filter(field => !(field in evalReport));
    const passed = missingFields.length === 0;

    return {
      ruleId: 'R-EVAL-POST-002',
      passed,
      severity: 'ERROR',
      message: passed
        ? '评估报告格式有效'
        : `评估报告格式无效: 缺少字段 [${missingFields.join(', ')}]`,
      details: { requiredFields, missingFields },
    };
  }
}

/**
 * R-EVAL-POST-003: 评估结果有效性检查
 * 等级: ERROR (阻塞)
 * result ∈ {PASS, NOPASS}
 */
class EvalResultValidChecker implements IPostEvalChecker {
  async check(ctx: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const { evalReport } = ctx;

    if (!evalReport) {
      return {
        ruleId: 'R-EVAL-POST-003',
        passed: false,
        severity: 'ERROR',
        message: '无法检查评估结果: 评估报告未加载',
      };
    }

    const validResults = ['PASS', 'NOPASS'];
    const valid = validResults.includes(evalReport.result);

    return {
      ruleId: 'R-EVAL-POST-003',
      passed: valid,
      severity: 'ERROR',
      message: valid
        ? `评估结果: ${evalReport.result}`
        : `无效评估结果: ${evalReport.result} (应为 PASS 或 NOPASS)`,
      details: { result: evalReport.result, validResults },
    };
  }
}

// R-EVAL-POST-007: TaskClosableChecker 已提取至 ./checkers/task-closable-checker.ts

// ============== 默认配置 ==============

/**
 * 默认评估后门禁运行器配置
 */
export const DEFAULT_POST_EVAL_GATE_RUNNER_CONFIG: PostEvalGateRunnerConfig = {
  enabled: true,
  stopOnFailure: false,
  generateReport: true,
  reportPath: '.projmnt4claude/reports/post-eval-gate-report.json',
  outputsPath: '.projmnt4claude/outputs/{taskId}',
};

// ============== PostEvalGateRunner 类 ==============

/**
 * 评估阶段后质量门禁协调器
 *
 * 统一管理和执行评估后置条件检查，协调多个检查器的执行，
 * 加载多阶段报告，根据规则引擎决定是否允许标记任务完成。
 *
 * 对齐设计文档 hd-p15-evaluation-post-gate-design.md，实现7条检测规则:
 * - R-EVAL-POST-001: 评估报告存在 (ERROR)
 * - R-EVAL-POST-002: 报告格式有效 (ERROR)
 * - R-EVAL-POST-003: 评估结果有效 (ERROR)
 * - R-EVAL-POST-004: 评估日志完整 (WARNING)
 * - R-EVAL-POST-005: 最终状态一致 (ERROR)
 * - R-EVAL-POST-006: 检查点全部完成 (ERROR)
 * - R-EVAL-POST-007: 任务可关闭 (ERROR)
 */
export class PostEvalGateRunner {
  private config: PostEvalGateRunnerConfig;
  private cwd: string;
  private checkers: IPostEvalChecker[];

  /**
   * 创建门禁运行器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<PostEvalGateRunnerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_POST_EVAL_GATE_RUNNER_CONFIG, ...config };

    // 注册内置检查器 (按规则ID顺序)
    this.checkers = [
      new EvalReportExistsChecker(),
      new EvalReportJsonChecker(),
      new EvalResultValidChecker(),
      new EvalLogsChecker(),
      new FinalStateConsistencyChecker(),
      new AllCheckpointsFinalChecker(),
      new TaskClosableChecker(),
    ];
  }

  /**
   * 执行评估后门禁检查
   *
   * @param taskId 任务ID
   * @returns 门禁运行结果
   */
  async run(taskId: string): Promise<PostEvalGateRunResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了门禁，直接通过
    if (!this.config.enabled) {
      return {
        taskId,
        decision: 'POST_EVAL_PASS',
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
        decision: 'POST_EVAL_FAIL',
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

    // 加载多阶段报告
    const evalReport = this.loadEvalReport(taskId);
    const devReport = this.loadDevReport(taskId);
    const codeReviewReport = this.loadCodeReviewReport(taskId);
    const qaReport = this.loadQAReport(taskId);

    // 创建上下文
    const context: PostEvalCheckContext = {
      taskId,
      task,
      cwd: this.cwd,
      evalReport,
      devReport,
      codeReviewReport,
      qaReport,
    };

    // 执行所有检查器
    const ruleResults: PostEvalCheckResult[] = [];

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
    const allowed = decision === 'POST_EVAL_PASS' || (decision === 'POST_EVAL_WARN' && blockingFailures === 0);

    const runResult: PostEvalGateRunResult = {
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

  // ============== 多阶段报告加载 ==============

  /**
   * 加载评估报告 (evaluation-report.json)
   */
  private loadEvalReport(taskId: string): EvalReport | undefined {
    const reportPath = path.join(
      this.cwd,
      this.config.outputsPath.replace('{taskId}', taskId),
      'evaluation-report.json'
    );

    if (!fs.existsSync(reportPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      return JSON.parse(content) as EvalReport;
    } catch {
      return undefined;
    }
  }

  /**
   * 加载开发报告 (dev-report.json)
   */
  private loadDevReport(taskId: string): DevReport | undefined {
    const reportPath = path.join(
      this.cwd,
      this.config.outputsPath.replace('{taskId}', taskId),
      'dev-report.json'
    );

    if (!fs.existsSync(reportPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      return JSON.parse(content) as DevReport;
    } catch {
      return undefined;
    }
  }

  /**
   * 加载代码审核报告 (code-review-report.json)
   */
  private loadCodeReviewReport(taskId: string): CodeReviewReport | undefined {
    const reportPath = path.join(
      this.cwd,
      this.config.outputsPath.replace('{taskId}', taskId),
      'code-review-report.json'
    );

    if (!fs.existsSync(reportPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      return JSON.parse(content) as CodeReviewReport;
    } catch {
      return undefined;
    }
  }

  /**
   * 加载QA报告 (qa-report.json)
   */
  private loadQAReport(taskId: string): QAReport | undefined {
    const reportPath = path.join(
      this.cwd,
      this.config.outputsPath.replace('{taskId}', taskId),
      'qa-report.json'
    );

    if (!fs.existsSync(reportPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      return JSON.parse(content) as QAReport;
    } catch {
      return undefined;
    }
  }

  // ============== 决策计算 ==============

  /**
   * 计算门禁决策
   */
  private calculateDecision(results: PostEvalCheckResult[], blockingFailures: number): PostEvalGateDecision {
    if (blockingFailures > 0) {
      return 'POST_EVAL_FAIL';
    }

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 0) {
      return 'POST_EVAL_PASS';
    }

    // 有非阻塞失败 (WARNING)，返回警告
    return 'POST_EVAL_WARN';
  }

  // ============== 报告生成 ==============

  /**
   * 生成评估后门禁报告
   */
  generateReport(result: PostEvalGateRunResult): PostEvalGateReport {
    const recommendations: string[] = [];

    for (const ruleResult of result.ruleResults) {
      if (!ruleResult.passed) {
        switch (ruleResult.ruleId) {
          case 'R-EVAL-POST-001':
            recommendations.push('评估报告不存在: 确保 evaluation-report.json 已生成');
            break;
          case 'R-EVAL-POST-002':
            recommendations.push('评估报告格式无效: 检查报告文件格式和必要字段');
            break;
          case 'R-EVAL-POST-003':
            recommendations.push('评估结果无效: 确保结果为 PASS 或 NOPASS');
            break;
          case 'R-EVAL-POST-004':
            recommendations.push('评估日志为空: 补充评估过程日志');
            break;
          case 'R-EVAL-POST-005':
            recommendations.push('状态不一致: 检查各阶段结果与评估结果的一致性');
            break;
          case 'R-EVAL-POST-006':
            recommendations.push('检查点未完成: 完成所有待处理的检查点');
            break;
          case 'R-EVAL-POST-007':
            recommendations.push('任务不满足关闭条件: 确保评估通过且所有检查点完成');
            break;
        }
      }
    }

    if (result.decision === 'POST_EVAL_PASS') {
      recommendations.push('任务满足所有后置条件，可以标记为完成');
    }

    return {
      reportId: `post-eval-gate-report-${result.taskId}-${Date.now()}`,
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
  private async saveReport(report: PostEvalGateReport): Promise<void> {
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
  formatResult(result: PostEvalGateRunResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    const decisionIcon = result.decision === 'POST_EVAL_PASS' ? '✅' :
                        result.decision === 'POST_EVAL_WARN' ? '⚠️ ' : '❌';

    lines.push('');
    lines.push(separator);
    lines.push(`${decisionIcon} 评估阶段后门禁检查: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    lines.push(`📊 决策结果: ${result.decision}`);
    lines.push(`   允许标记任务完成: ${result.allowed ? '是' : '否'}`);
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
  updateConfig(config: Partial<PostEvalGateRunnerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PostEvalGateRunnerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建评估后门禁运行器实例
 */
export function createPostEvalGateRunner(
  cwd: string,
  config?: Partial<PostEvalGateRunnerConfig>
): PostEvalGateRunner {
  return new PostEvalGateRunner(cwd, config);
}

/**
 * 快速执行评估后门禁检查
 */
export async function quickPostEvalGateCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<PostEvalGateRunnerConfig>
): Promise<PostEvalGateRunResult> {
  const runner = new PostEvalGateRunner(cwd, config);
  return runner.run(taskId);
}

/**
 * 批量执行评估后门禁检查
 */
export async function batchPostEvalGateCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<PostEvalGateRunnerConfig>
): Promise<PostEvalGateRunResult[]> {
  const runner = new PostEvalGateRunner(cwd, config);
  const results: PostEvalGateRunResult[] = [];

  for (const taskId of taskIds) {
    const result = await runner.run(taskId);
    results.push(result);
  }

  return results;
}

export default PostEvalGateRunner;
