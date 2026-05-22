/**
 * Output Alignment AI Checker
 * 开发输出对齐 AI 审核检查器
 *
 * 职责:
 * - 使用 AI 审核型检查器模式，调用 invokeAgent 进行审核
 * - 审核开发产物是否与任务要求对齐
 * - 检查功能覆盖度、技术栈符合度、产物纯净度
 * - 失败类型: B（回退到开发阶段重试）
 *
 * @module post-dev-gate/checkers/output-alignment-ai-checker
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
export interface OutputAlignmentAIReviewResult {
  /** 是否通过 */
  passed: boolean;

  /** 功能覆盖度评分 (0-100) */
  coverage: number;

  /** 技术栈是否符合 */
  techStackMatch: boolean;

  /** 产物是否纯净 */
  purity: boolean;

  /** 缺失的功能 */
  missingFeatures: string[];

  /** 额外的产物 */
  extraArtifacts: string[];

  /** 改进建议 */
  suggestions: string[];
}

/**
 * 输出对齐 AI 审核检查器配置
 */
export interface OutputAlignmentAICheckerConfig {
  /** 是否启用 AI 审核 */
  enableAIReview: boolean;

  /** AI 审核超时时间（毫秒） */
  aiReviewTimeout: number;

  /** 最低功能覆盖度分数 */
  minCoverageScore: number;
}

/**
 * 默认输出对齐 AI 审核检查器配置
 */
export const DEFAULT_OUTPUT_ALIGNMENT_AI_CHECKER_CONFIG: OutputAlignmentAICheckerConfig = {
  enableAIReview: true,
  aiReviewTimeout: 60000,
  minCoverageScore: 60,
};

/**
 * 输出对齐 AI 审核检查器
 *
 * CP-1: OutputAlignmentAIChecker 检查器实现正确
 * CP-2: AI 审核逻辑完整
 * CP-3: 失败类型为 B（回退到开发阶段）
 *
 * 审核开发产物是否与任务要求对齐，包括功能覆盖度、技术栈符合度、产物纯净度。
 */
export class OutputAlignmentAIChecker {
  readonly id = 'R-OUTPUT-001-AI';
  readonly name = '开发输出对齐 AI 审核';
  readonly description = '使用 AI 审核开发产物是否与任务要求对齐';
  readonly failureType = 'B' as const;

  private config: OutputAlignmentAICheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<OutputAlignmentAICheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_OUTPUT_ALIGNMENT_AI_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行输出对齐 AI 审核
   *
   * @param context 检查上下文
   * @returns 检查结果
   */
  async check(context: PostDevPhaseCheckContext): Promise<PostDevPhaseCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 获取变更文件列表
    const changedFiles = this.getChangedFiles(context);

    // 执行 AI 审核
    const aiResult = await this.performAIReview(context, changedFiles);

    const duration = Date.now() - startTime;

    return {
      checkerId: this.id,
      checkerName: this.name,
      passed: aiResult.passed,
      severity: aiResult.passed ? 'info' : 'error',
      message: aiResult.passed
        ? `开发输出对齐审核通过，功能覆盖度: ${aiResult.coverage}%`
        : `开发输出对齐审核未通过: 功能覆盖度 ${aiResult.coverage}%`,
      details: {
        coverage: aiResult.coverage,
        techStackMatch: aiResult.techStackMatch,
        purity: aiResult.purity,
        missingFeatures: aiResult.missingFeatures,
        extraArtifacts: aiResult.extraArtifacts,
        suggestions: aiResult.suggestions,
        failureType: this.failureType,
        changedFilesCount: changedFiles.length,
      },
      suggestions: aiResult.suggestions,
      duration,
      timestamp,
    };
  }

  /**
   * 获取变更文件列表
   */
  private getChangedFiles(context: PostDevPhaseCheckContext): string[] {
    if (context.devReport?.changes) {
      return context.devReport.changes
        .filter(change => change.type === 'file' || change.path)
        .map(change => change.path || change.description);
    }
    return [];
  }

  /**
   * 执行 AI 审核
   */
  private async performAIReview(
    context: PostDevPhaseCheckContext,
    changedFiles: string[]
  ): Promise<OutputAlignmentAIReviewResult> {
    if (!this.config.enableAIReview) {
      return this.getDefaultResult('AI 审核未启用');
    }

    const prompt = this.buildPrompt(context, changedFiles);
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
  private buildPrompt(
    context: PostDevPhaseCheckContext,
    changedFiles: string[]
  ): string {
    const { task, devReport } = context;

    const sections: string[] = [
      '# 开发输出对齐审核',
      '',
      '你是一个代码审核专家，请审核开发输出是否与任务要求对齐。',
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

    if (changedFiles.length > 0) {
      sections.push('', '## 开发产物清单', '');
      sections.push(...changedFiles.map(f => `- ${f}`));
    }

    if (devReport) {
      sections.push('', '## 开发报告摘要', '');
      sections.push(`- 状态: ${devReport.status}`);
      sections.push(`- 变更数: ${devReport.changes.length}`);
      sections.push(`- 证据数: ${devReport.evidence.length}`);
      if (devReport.summary) {
        sections.push(`- 总结: ${devReport.summary}`);
      }
    }

    sections.push('', '## 审核要求', '');
    sections.push('请判断：');
    sections.push('');
    sections.push('1. **功能覆盖度** (0-100分)');
    sections.push('   - 开发产物是否覆盖了任务描述中的所有功能点');
    sections.push('   - 是否有遗漏的功能');
    sections.push('');
    sections.push('2. **技术栈符合度** (通过/不通过)');
    sections.push('   - 开发产物是否符合任务的技术栈要求');
    sections.push('   - 是否使用了不恰当的技术');
    sections.push('');
    sections.push('3. **产物纯净度** (通过/不通过)');
    sections.push('   - 是否存在与任务无关的额外产物');
    sections.push('   - 是否有过度设计的痕迹');
    sections.push('', '## 输出格式', '');
    sections.push('请按以下 JSON 格式输出审核结果:');
    sections.push('```json');
    sections.push(JSON.stringify({
      passed: true,
      coverage: 85,
      techStackMatch: true,
      purity: true,
      missingFeatures: [],
      extraArtifacts: [],
      suggestions: ['建议1'],
    }, null, 2));
    sections.push('```');
    sections.push('', '请开始审核。');

    return sections.join('\n');
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(output: string): OutputAlignmentAIReviewResult {
    const defaultResult = this.getDefaultResult('AI 响应解析失败');

    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : output;

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      const coverage = Math.max(0, Math.min(100, parsed.coverage ?? 60));
      const techStackMatch = parsed.techStackMatch ?? true;
      const purity = parsed.purity ?? true;

      // 检查是否达到最低覆盖度要求
      const meetsMinCoverage = coverage >= this.config.minCoverageScore;

      const passed = (parsed.passed ?? true) && meetsMinCoverage && techStackMatch;

      return {
        passed,
        coverage,
        techStackMatch,
        purity,
        missingFeatures: Array.isArray(parsed.missingFeatures) ? parsed.missingFeatures : [],
        extraArtifacts: Array.isArray(parsed.extraArtifacts) ? parsed.extraArtifacts : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    } catch {
      return defaultResult;
    }
  }

  /**
   * 获取默认结果
   */
  private getDefaultResult(reason: string): OutputAlignmentAIReviewResult {
    return {
      passed: false,
      coverage: 0,
      techStackMatch: false,
      purity: false,
      missingFeatures: ['无法确定'],
      extraArtifacts: [],
      suggestions: [reason, '请检查开发产物是否与任务要求对齐'],
    };
  }
}

/**
 * 创建输出对齐 AI 审核检查器实例
 */
export function createOutputAlignmentAIChecker(
  cwd: string,
  config?: Partial<OutputAlignmentAICheckerConfig>
): OutputAlignmentAIChecker {
  return new OutputAlignmentAIChecker(cwd, config);
}

/**
 * 快速输出对齐 AI 审核
 */
export async function checkOutputAlignmentAI(
  context: PostDevPhaseCheckContext,
  cwd: string = process.cwd(),
  config?: Partial<OutputAlignmentAICheckerConfig>
): Promise<PostDevPhaseCheckResult> {
  const checker = new OutputAlignmentAIChecker(cwd, config);
  return checker.check(context);
}

export default OutputAlignmentAIChecker;