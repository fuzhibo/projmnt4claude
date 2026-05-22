/**
 * Eval Logs AI Checker
 * 评估日志 AI 审核检查器
 *
 * 职责:
 * - 使用 AI 审核型检查器模式，调用 invokeAgent 进行审核
 * - 审核评估日志的质量：验收标准覆盖度、检查点验证完整性、过程连贯性、结论一致性
 * - 失败类型: B（回退到评估阶段重试）
 *
 * @module post-eval-gate/checkers/eval-logs-ai-checker
 */

import { invokeAgent, type AgentInvokeOptions } from '../../headless-agent.js';
import type {
  PostEvalCheckContext,
  PostEvalCheckResult,
  EvalReport,
} from '../types.js';

/**
 * 评估日志 AI 审核结果
 */
export interface EvalLogsAIReviewResult {
  /** 是否通过 */
  passed: boolean;

  /** 验收标准覆盖度评分 (0-100) */
  coverage: number;

  /** 检查点验证完整性 */
  checkpointComplete: boolean;

  /** 过程连贯性 */
  processCoherent: boolean;

  /** 结论一致性 */
  conclusionConsistent: boolean;

  /** 遗漏的验收标准 */
  missingCriteria: string[];

  /** 跳过的检查点 */
  skippedCheckpoints: string[];

  /** 发现的问题 */
  issues: string[];

  /** 改进建议 */
  suggestions: string[];
}

/**
 * 评估日志 AI 审核检查器配置
 */
export interface EvalLogsAICheckerConfig {
  /** 是否启用 AI 审核 */
  enableAIReview: boolean;

  /** AI 审核超时时间（毫秒） */
  aiReviewTimeout: number;

  /** 最低验收标准覆盖度分数 */
  minCoverageScore: number;
}

/**
 * 默认评估日志 AI 审核检查器配置
 */
export const DEFAULT_EVAL_LOGS_AI_CHECKER_CONFIG: EvalLogsAICheckerConfig = {
  enableAIReview: true,
  aiReviewTimeout: 60000,
  minCoverageScore: 60,
};

/**
 * 评估日志 AI 审核检查器
 *
 * CP-1: EvalLogsAIChecker 检查器实现正确
 * CP-2: AI 审核逻辑完整
 * CP-3: 失败类型为 B（回退到评估阶段）
 *
 * 审核评估日志的质量，包括验收标准覆盖度、检查点验证完整性、过程连贯性、结论一致性。
 */
export class EvalLogsAIChecker {
  readonly id = 'R-EVAL-POST-004-AI';
  readonly name = '评估日志 AI 审核';
  readonly description = '使用 AI 审核评估日志的质量';
  readonly failureType = 'B' as const;

  private config: EvalLogsAICheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<EvalLogsAICheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_EVAL_LOGS_AI_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行评估日志 AI 审核
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
        ? `评估日志质量审核通过，验收标准覆盖度: ${aiResult.coverage}%`
        : `评估日志质量审核未通过: ${aiResult.issues.join('; ')}`,
      details: {
        coverage: aiResult.coverage,
        checkpointComplete: aiResult.checkpointComplete,
        processCoherent: aiResult.processCoherent,
        conclusionConsistent: aiResult.conclusionConsistent,
        missingCriteria: aiResult.missingCriteria,
        skippedCheckpoints: aiResult.skippedCheckpoints,
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
  ): Promise<EvalLogsAIReviewResult> {
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
    const { task, evalReport } = context;

    const sections: string[] = [
      '# 评估日志质量审核',
      '',
      '你是一个评估审核专家，请审核以下评估日志的质量。',
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

    // 添加评估报告
    if (evalReport) {
      sections.push('', '## 评估报告', '```json');
      sections.push(JSON.stringify(evalReport, null, 2));
      sections.push('```');
    }

    sections.push('', '## 审核要求', '');
    sections.push('请判断：');
    sections.push('');
    sections.push('1. **验收标准覆盖度** (0-100分)');
    sections.push('   - 评估日志是否覆盖了所有验收标准');
    sections.push('   - 是否有遗漏的验收标准');
    sections.push('');
    sections.push('2. **检查点验证完整性** (通过/不通过)');
    sections.push('   - 是否验证了所有检查点');
    sections.push('   - 是否有跳过的检查点且无合理理由');
    sections.push('');
    sections.push('3. **过程连贯性** (通过/不通过)');
    sections.push('   - 评估过程是否连贯、有逻辑');
    sections.push('   - 是否有跳跃或遗漏的验证步骤');
    sections.push('');
    sections.push('4. **结论一致性** (通过/不通过)');
    sections.push('   - 评估结论是否与日志内容一致');
    sections.push('   - 是否存在结论与证据矛盾的情况');
    sections.push('', '## 输出格式', '');
    sections.push('请按以下 JSON 格式输出审核结果:');
    sections.push('```json');
    sections.push(JSON.stringify({
      passed: true,
      coverage: 85,
      checkpointComplete: true,
      processCoherent: true,
      conclusionConsistent: true,
      missingCriteria: [],
      skippedCheckpoints: [],
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
  private parseAIResponse(output: string): EvalLogsAIReviewResult {
    const defaultResult = this.getDefaultResult('AI 响应解析失败');

    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : output;

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      const coverage = Math.max(0, Math.min(100, parsed.coverage ?? 60));
      const checkpointComplete = parsed.checkpointComplete ?? true;
      const processCoherent = parsed.processCoherent ?? true;
      const conclusionConsistent = parsed.conclusionConsistent ?? true;

      // 检查是否达到最低覆盖度要求
      const meetsMinCoverage = coverage >= this.config.minCoverageScore;

      const passed = (parsed.passed ?? true) && meetsMinCoverage && checkpointComplete && processCoherent;

      return {
        passed,
        coverage,
        checkpointComplete,
        processCoherent,
        conclusionConsistent,
        missingCriteria: Array.isArray(parsed.missingCriteria) ? parsed.missingCriteria : [],
        skippedCheckpoints: Array.isArray(parsed.skippedCheckpoints) ? parsed.skippedCheckpoints : [],
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
  private getDefaultResult(reason: string): EvalLogsAIReviewResult {
    return {
      passed: false,
      coverage: 0,
      checkpointComplete: false,
      processCoherent: false,
      conclusionConsistent: false,
      missingCriteria: ['无法确定'],
      skippedCheckpoints: [],
      issues: [reason],
      suggestions: ['请检查评估日志是否完整', '确保评估过程覆盖所有验收标准'],
    };
  }
}

/**
 * 创建评估日志 AI 审核检查器实例
 */
export function createEvalLogsAIChecker(
  cwd: string,
  config?: Partial<EvalLogsAICheckerConfig>
): EvalLogsAIChecker {
  return new EvalLogsAIChecker(cwd, config);
}

/**
 * 快速评估日志 AI 审核
 */
export async function checkEvalLogsAI(
  context: PostEvalCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<EvalLogsAICheckerConfig>
): Promise<PostEvalCheckResult> {
  const checker = new EvalLogsAIChecker(cwd, config);
  return checker.check(context);
}

export default EvalLogsAIChecker;