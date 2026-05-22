/**
 * Report Integrity AI Checker
 * 开发报告完整性 AI 审核检查器
 *
 * 职责:
 * - 使用 AI 审核型检查器模式，调用 invokeAgent 进行审核
 * - 审核开发报告的内容质量：变更描述清晰度、证据充分性、总结准确性
 * - 失败类型: B（回退到开发阶段重试）
 *
 * @module post-dev-gate/checkers/report-integrity-ai-checker
 */

import { invokeAgent, type AgentInvokeOptions } from '../../headless-agent.js';
import type { TaskMeta } from '../../../types/task.js';
import type { DevReport } from '../../../types/harness.js';
import type {
  PostDevPhaseCheckContext,
  PostDevPhaseCheckResult,
} from '../../../types/post-dev-phase-gate.js';

/**
 * AI 审核结果
 */
export interface AIReviewResult {
  /** 是否通过 */
  passed: boolean;

  /** 各维度评分 */
  scores: {
    changeClarity: number;
    evidenceSufficiency: number;
    summaryAccuracy: number;
  };

  /** 检查点完成是否合理 */
  checkpointReasonable: boolean;

  /** 发现的问题 */
  issues: string[];

  /** 改进建议 */
  suggestions: string[];
}

/**
 * 报告完整性 AI 审核检查器配置
 */
export interface ReportIntegrityAICheckerConfig {
  /** 是否启用 AI 审核 */
  enableAIReview: boolean;

  /** AI 审核超时时间（毫秒） */
  aiReviewTimeout: number;

  /** 最低变更描述清晰度分数 */
  minChangeClarityScore: number;

  /** 最低证据充分性分数 */
  minEvidenceSufficiencyScore: number;

  /** 最低总结准确性分数 */
  minSummaryAccuracyScore: number;
}

/**
 * 默认报告完整性 AI 审核检查器配置
 */
export const DEFAULT_REPORT_INTEGRITY_AI_CHECKER_CONFIG: ReportIntegrityAICheckerConfig = {
  enableAIReview: true,
  aiReviewTimeout: 60000,
  minChangeClarityScore: 60,
  minEvidenceSufficiencyScore: 60,
  minSummaryAccuracyScore: 60,
};

/**
 * 报告完整性 AI 审核检查器
 *
 * CP-1: ReportIntegrityAIChecker 检查器实现正确
 * CP-2: AI 审核逻辑完整
 * CP-3: 失败类型为 B（回退到开发阶段）
 *
 * 审核开发报告的内容质量，包括变更描述清晰度、证据充分性、总结准确性。
 */
export class ReportIntegrityAIChecker {
  readonly id = 'R-OUTPUT-002-AI';
  readonly name = '开发报告完整性 AI 审核';
  readonly description = '使用 AI 审核开发报告的内容质量';
  readonly failureType = 'B' as const;

  private config: ReportIntegrityAICheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<ReportIntegrityAICheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_REPORT_INTEGRITY_AI_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行报告完整性 AI 审核
   *
   * @param context 检查上下文
   * @returns 检查结果
   */
  async check(context: PostDevPhaseCheckContext): Promise<PostDevPhaseCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 检查是否有开发报告
    if (!context.devReport) {
      return {
        checkerId: this.id,
        checkerName: this.name,
        passed: false,
        severity: 'error',
        message: '开发报告不存在，无法进行 AI 审核',
        details: {
          failureType: this.failureType,
        },
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 执行 AI 审核
    const aiResult = await this.performAIReview(context);

    const duration = Date.now() - startTime;

    return {
      checkerId: this.id,
      checkerName: this.name,
      passed: aiResult.passed,
      severity: aiResult.passed ? 'info' : 'error',
      message: aiResult.passed
        ? `开发报告质量审核通过`
        : `开发报告质量审核未通过: ${aiResult.issues.join('; ')}`,
      details: {
        scores: aiResult.scores,
        checkpointReasonable: aiResult.checkpointReasonable,
        issues: aiResult.issues,
        suggestions: aiResult.suggestions,
        failureType: this.failureType,
      },
      suggestions: aiResult.suggestions,
      duration,
      timestamp,
    };
  }

  /**
   * 执行 AI 审核
   */
  private async performAIReview(
    context: PostDevPhaseCheckContext
  ): Promise<AIReviewResult> {
    if (!this.config.enableAIReview) {
      return this.getDefaultResult('AI 审核未启用');
    }

    const prompt = this.buildPrompt(context);
    const options: AgentInvokeOptions = {
      timeout: Math.floor(this.config.aiReviewTimeout / 1000),
      allowedTools: ['Read', 'Grep', 'Glob'],
      outputFormat: 'text',
      cwd: this.cwd,
      dangerouslySkipPermissions: true,
    };

    try {
      const result = await invokeAgent(prompt, options);

      if (!result.success) {
        return this.getDefaultResult(`AI 审核失败: ${result.error || '未知错误'}`);
      }

      return this.parseAIResponse(result.output);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.getDefaultResult(`AI 审核异常: ${errorMessage}`);
    }
  }

  /**
   * 构建审核提示词
   */
  private buildPrompt(context: PostDevPhaseCheckContext): string {
    const { task, devReport } = context;

    const sections: string[] = [
      '# 开发报告质量审核',
      '',
      '你是一个代码审核专家，请审核以下开发报告的质量。',
      '',
      '## 任务信息',
      `- 任务ID: ${task.id}`,
      `- 任务标题: ${task.title}`,
      `- 任务类型: ${task.type}`,
      `- 任务优先级: ${task.priority}`,
    ];

    if (task.description) {
      sections.push('', '## 任务描述', '', task.description);
    }

    if (devReport) {
      sections.push('', '## 开发报告', '```json');
      sections.push(JSON.stringify(devReport, null, 2));
      sections.push('```');
    }

    sections.push('', '## 审核要求', '');
    sections.push('请从以下维度评估报告质量：');
    sections.push('');
    sections.push('1. **变更描述清晰度** (0-100分)');
    sections.push('   - changes 列表是否清晰描述了每个变更');
    sections.push('   - 变更描述是否足够具体，便于审查');
    sections.push('');
    sections.push('2. **证据充分性** (0-100分)');
    sections.push('   - evidence 是否提供了足够的验证证据');
    sections.push('   - 证据是否可追溯、可验证');
    sections.push('');
    sections.push('3. **总结准确性** (0-100分)');
    sections.push('   - summary 是否准确概括了开发成果');
    sections.push('   - 是否遗漏重要信息');
    sections.push('');
    sections.push('4. **检查点完成合理性** (通过/不通过)');
    sections.push('   - checkpointsCompleted 是否与实际变更匹配');
    sections.push('   - 是否存在虚假完成');
    sections.push('', '## 输出格式', '');
    sections.push('请按以下 JSON 格式输出评分结果:');
    sections.push('```json');
    sections.push(JSON.stringify({
      passed: true,
      scores: {
        changeClarity: 85,
        evidenceSufficiency: 90,
        summaryAccuracy: 80,
      },
      checkpointReasonable: true,
      issues: ['问题1'],
      suggestions: ['建议1'],
    }, null, 2));
    sections.push('```');
    sections.push('', '请开始审核。');

    return sections.join('\n');
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(output: string): AIReviewResult {
    const defaultResult = this.getDefaultResult('AI 响应解析失败');

    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : output;

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      const scores = {
        changeClarity: Math.max(0, Math.min(100, parsed.scores?.changeClarity ?? 60)),
        evidenceSufficiency: Math.max(0, Math.min(100, parsed.scores?.evidenceSufficiency ?? 60)),
        summaryAccuracy: Math.max(0, Math.min(100, parsed.scores?.summaryAccuracy ?? 60)),
      };

      // 检查是否达到最低分数要求
      const meetsMinScores =
        scores.changeClarity >= this.config.minChangeClarityScore &&
        scores.evidenceSufficiency >= this.config.minEvidenceSufficiencyScore &&
        scores.summaryAccuracy >= this.config.minSummaryAccuracyScore;

      const passed = (parsed.passed ?? true) && meetsMinScores && (parsed.checkpointReasonable ?? true);

      return {
        passed,
        scores,
        checkpointReasonable: parsed.checkpointReasonable ?? true,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    } catch {
      return defaultResult;
    }
  }

  /**
   * 获取默认结果
   */
  private getDefaultResult(reason: string): AIReviewResult {
    return {
      passed: false,
      scores: {
        changeClarity: 0,
        evidenceSufficiency: 0,
        summaryAccuracy: 0,
      },
      checkpointReasonable: false,
      issues: [reason],
      suggestions: ['请检查开发报告内容', '确保报告包含变更描述、验证证据和总结'],
    };
  }
}

/**
 * 创建报告完整性 AI 审核检查器实例
 */
export function createReportIntegrityAIChecker(
  cwd: string,
  config?: Partial<ReportIntegrityAICheckerConfig>
): ReportIntegrityAIChecker {
  return new ReportIntegrityAIChecker(cwd, config);
}

/**
 * 快速报告完整性 AI 审核
 */
export async function checkReportIntegrityAI(
  context: PostDevPhaseCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<ReportIntegrityAICheckerConfig>
): Promise<PostDevPhaseCheckResult> {
  const checker = new ReportIntegrityAIChecker(cwd, config);
  return checker.check(context);
}

export default ReportIntegrityAIChecker;