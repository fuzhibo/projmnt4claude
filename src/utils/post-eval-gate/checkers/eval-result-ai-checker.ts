/**
 * Eval Result AI Checker
 * 评估结果 AI 审核检查器
 *
 * 职责:
 * - 使用 AI 审核型检查器模式，调用 invokeAgent 进行审核
 * - 审核评估结论是否合理：PASS 结论是否满足验收标准、NOPASS 结论理由是否充分
 * - 失败类型: B（回退到评估阶段重试）
 *
 * @module post-eval-gate/checkers/eval-result-ai-checker
 */

import { invokeAgent, type AgentInvokeOptions } from '../../headless-agent.js';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  EvalReport,
} from '../types.js';

/**
 * 评估结果 AI 审核结果
 */
export interface EvalResultAIReviewResult {
  /** 是否通过 */
  passed: boolean;

  /** 评估结论是否合理 */
  conclusionReasonable: boolean;

  /** 所有验收标准是否满足 */
  allCriteriaMet: boolean;

  /** 所有检查点是否完成 */
  allCheckpointsComplete: boolean;

  /** 证据是否充分 */
  evidenceSufficient: boolean;

  /** 不通过理由是否具体 */
  reasonSpecific: boolean;

  /** 发现的问题 */
  issues: string[];

  /** 改进建议 */
  suggestions: string[];
}

/**
 * 评估结果 AI 审核检查器配置
 */
export interface EvalResultAICheckerConfig {
  /** 是否启用 AI 审核 */
  enableAIReview: boolean;

  /** AI 审核超时时间（毫秒） */
  aiReviewTimeout: number;
}

/**
 * 默认评估结果 AI 审核检查器配置
 */
export const DEFAULT_EVAL_RESULT_AI_CHECKER_CONFIG: EvalResultAICheckerConfig = {
  enableAIReview: true,
  aiReviewTimeout: 60000,
};

/**
 * 评估结果 AI 审核检查器
 *
 * CP-1: EvalResultAIChecker 检查器实现正确
 * CP-2: AI 审核逻辑完整
 * CP-3: 失败类型为 B（回退到评估阶段）
 *
 * 审核评估结论是否合理，包括 PASS 结论是否满足验收标准、NOPASS 结论理由是否充分。
 */
export class EvalResultAIChecker {
  readonly id = 'R-EVAL-POST-003-AI';
  readonly name = '评估结果 AI 审核';
  readonly description = '使用 AI 审核评估结论是否合理';
  readonly failureType = 'B' as const;

  private config: EvalResultAICheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<EvalResultAICheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_EVAL_RESULT_AI_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行评估结果 AI 审核
   *
   * @param context 检查上下文
   * @returns 检查结果
   */
  async check(context: PostEvalCheckContext): Promise<PostEvalCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 检查是否有评估报告
    if (!context.evalReport) {
      return {
        ruleId: this.id,
        passed: false,
        severity: 'ERROR',
        message: '评估报告不存在，无法进行 AI 审核',
        details: {
          failureType: this.failureType,
        },
      };
    }

    // 执行 AI 审核
    const aiResult = await this.performAIReview(context);

    const duration = Date.now() - startTime;

    return {
      ruleId: this.id,
      passed: aiResult.passed,
      severity: aiResult.passed ? 'WARNING' : 'ERROR',
      message: aiResult.passed
        ? `评估结果合理性审核通过`
        : `评估结果合理性审核未通过: ${aiResult.issues.join('; ')}`,
      details: {
        conclusionReasonable: aiResult.conclusionReasonable,
        allCriteriaMet: aiResult.allCriteriaMet,
        allCheckpointsComplete: aiResult.allCheckpointsComplete,
        evidenceSufficient: aiResult.evidenceSufficient,
        reasonSpecific: aiResult.reasonSpecific,
        issues: aiResult.issues,
        suggestions: aiResult.suggestions,
        failureType: this.failureType,
        duration,
      },
    };
  }

  /**
   * 执行 AI 审核
   */
  private async performAIReview(
    context: PostEvalCheckContext
  ): Promise<EvalResultAIReviewResult> {
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
  private buildPrompt(context: PostEvalCheckContext): string {
    const { task, evalReport, devReport, qaReport } = context;

    const sections: string[] = [
      '# 评估结果合理性审核',
      '',
      '你是一个评估审核专家，请审核评估结论是否合理。',
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

    // 添加验收标准
    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      sections.push('', '## 验收标准', '');
      sections.push(...task.acceptanceCriteria.map(c => `- ${c}`));
    }

    // 添加检查点
    if (task.checkpoints && task.checkpoints.length > 0) {
      sections.push('', '## 检查点', '');
      sections.push(...task.checkpoints.map(c => `- ${c.id}: ${c.description || ''}`));
    }

    // 添加开发报告摘要
    if (devReport) {
      sections.push('', '## 开发报告摘要', '');
      sections.push(`- 状态: ${devReport.status}`);
      sections.push(`- 生成时间: ${devReport.generatedAt}`);
    }

    // 添加 QA 报告摘要
    if (qaReport) {
      sections.push('', '## QA 报告摘要', '');
      sections.push(`- 验证结果: ${qaReport.verdict}`);
      sections.push(`- 验证人: ${qaReport.verifier}`);
      sections.push(`- 总结: ${qaReport.summary}`);
      if (qaReport.coverage !== undefined) {
        sections.push(`- 测试覆盖率: ${qaReport.coverage}%`);
      }
    }

    // 添加评估报告
    if (evalReport) {
      sections.push('', '## 评估报告', '```json');
      sections.push(JSON.stringify(evalReport, null, 2));
      sections.push('```');
    }

    sections.push('', '## 审核要求', '');
    sections.push('请判断评估结论是否合理：');
    sections.push('');
    sections.push('1. 如果 result = PASS：');
    sections.push('   - 是否所有验收标准都被满足？');
    sections.push('   - 是否所有检查点都已完成？');
    sections.push('   - 证据是否充分支持 PASS 结论？');
    sections.push('');
    sections.push('2. 如果 result = NOPASS：');
    sections.push('   - 不通过的理由是否具体、可操作？');
    sections.push('   - 是否明确指出了哪些验收标准未满足？');
    sections.push('   - 是否给出了改进建议？');
    sections.push('', '## 输出格式', '');
    sections.push('请按以下 JSON 格式输出审核结果:');
    sections.push('```json');
    sections.push(JSON.stringify({
      passed: true,
      conclusionReasonable: true,
      allCriteriaMet: true,
      allCheckpointsComplete: true,
      evidenceSufficient: true,
      reasonSpecific: true,
      issues: [],
      suggestions: ['建议1'],
    }, null, 2));
    sections.push('```');
    sections.push('', '请开始审核。');

    return sections.join('\n');
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(output: string): EvalResultAIReviewResult {
    const defaultResult = this.getDefaultResult('AI 响应解析失败');

    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : output;

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      const conclusionReasonable = parsed.conclusionReasonable ?? true;
      const allCriteriaMet = parsed.allCriteriaMet ?? true;
      const allCheckpointsComplete = parsed.allCheckpointsComplete ?? true;
      const evidenceSufficient = parsed.evidenceSufficient ?? true;
      const reasonSpecific = parsed.reasonSpecific ?? true;

      const passed = (parsed.passed ?? true) && conclusionReasonable;

      return {
        passed,
        conclusionReasonable,
        allCriteriaMet,
        allCheckpointsComplete,
        evidenceSufficient,
        reasonSpecific,
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
  private getDefaultResult(reason: string): EvalResultAIReviewResult {
    return {
      passed: false,
      conclusionReasonable: false,
      allCriteriaMet: false,
      allCheckpointsComplete: false,
      evidenceSufficient: false,
      reasonSpecific: false,
      issues: [reason],
      suggestions: ['请检查评估结论是否与证据一致', '确保 PASS 结论满足所有验收标准'],
    };
  }
}

/**
 * 创建评估结果 AI 审核检查器实例
 */
export function createEvalResultAIChecker(
  cwd: string,
  config?: Partial<EvalResultAICheckerConfig>
): EvalResultAIChecker {
  return new EvalResultAIChecker(cwd, config);
}

/**
 * 快速评估结果 AI 审核
 */
export async function checkEvalResultAI(
  context: PostEvalCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<EvalResultAICheckerConfig>
): Promise<PostEvalCheckResult> {
  const checker = new EvalResultAIChecker(cwd, config);
  return checker.check(context);
}

export default EvalResultAIChecker;