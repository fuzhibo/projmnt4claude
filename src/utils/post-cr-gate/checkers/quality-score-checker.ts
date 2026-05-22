/**
 * Quality Score Checker
 * 代码审核质量分数检查器
 *
 * 职责:
 * - 使用 AI 审核型检查器模式，调用 invokeAgent 进行审核
 * - 实现五个维度的质量分数打分：正确性、可读性、可维护性、测试覆盖率、安全性
 * - 为 Post-CR Gate 提供量化评估能力
 * - 分数范围 0-100
 *
 * @module post-cr-gate/checkers/quality-score-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { invokeAgent, type AgentInvokeOptions } from '../../headless-agent.js';
import type { TaskMeta } from '../../../types/task.js';
import type { DevReport, CodeReviewVerdict } from '../../../types/harness.js';
import type {
  CodeReviewQualityScore,
  DimensionScore,
  QualityScoreCheckerConfig,
  QualityScoreCheckResult,
  AIReviewContext,
  QualityScoreDimension,
} from '../../../types/quality-score.js';
import {
  DEFAULT_QUALITY_SCORE_CHECKER_CONFIG,
  DEFAULT_DIMENSION_WEIGHTS,
  calculateWeightedTotalScore,
  createDefaultQualityScore,
} from '../../../types/quality-score.js';

/**
 * 代码审核质量分数检查器
 *
 * CP-1: QualityScoreChecker 检查器实现正确
 * CP-2: 五个维度评分逻辑完整
 * CP-3: invokeAgent 调用成功并返回分数
 */
export class QualityScoreChecker {
  private config: QualityScoreCheckerConfig;
  private cwd: string;

  constructor(cwd: string, config?: Partial<QualityScoreCheckerConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_QUALITY_SCORE_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行质量分数检查
   *
   * @param context AI 审核上下文
   * @returns 质量分数检查结果
   */
  async check(context: AIReviewContext): Promise<QualityScoreCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // CP-3: invokeAgent 调用成功并返回分数
      const score = await this.performAIReview(context);
      const duration = Date.now() - startTime;

      const passed = score.meetsMinimum;

      return {
        passed,
        check: 'quality_score',
        message: passed
          ? `质量分数达标: ${score.totalScore}/100 (阈值: ${this.config.minScore})`
          : `质量分数未达标: ${score.totalScore}/100 (阈值: ${this.config.minScore})`,
        score,
        duration,
        timestamp,
        details: {
          minScore: this.config.minScore,
          dimensions: score.dimensions.map(d => ({
            dimension: d.dimension,
            score: d.score,
          })),
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        passed: false,
        check: 'quality_score',
        message: `质量分数检查失败: ${errorMessage}`,
        duration,
        timestamp,
        details: {
          error: errorMessage,
          minScore: this.config.minScore,
        },
      };
    }
  }

  /**
   * 执行 AI 审核
   *
   * CP-2: 五个维度评分逻辑完整
   */
  private async performAIReview(context: AIReviewContext): Promise<CodeReviewQualityScore> {
    if (!this.config.enableAIReview) {
      return createDefaultQualityScore(context.taskId, 'AI 审核未启用');
    }

    const prompt = this.buildReviewPrompt(context);
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
        return createDefaultQualityScore(context.taskId, `AI 审核失败: ${result.error || '未知错误'}`);
      }

      return this.parseAIResponse(result.output, context.taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createDefaultQualityScore(context.taskId, `AI 审核异常: ${errorMessage}`);
    }
  }

  /**
   * 构建审核提示词
   */
  private buildReviewPrompt(context: AIReviewContext): string {
    const { task, devReport, codeReviewVerdict, changedFiles } = context;

    const sections: string[] = [
      '# 代码审核质量评分任务',
      '',
      '请对以下代码变更进行质量评分，输出五个维度的分数（0-100）。',
      '',
      '## 评分维度说明',
      '',
      '1. **correctness (正确性)**: 代码逻辑是否正确，是否满足需求',
      '2. **readability (可读性)**: 代码是否易于理解，命名是否清晰',
      '3. **maintainability (可维护性)**: 代码结构是否合理，是否易于修改',
      '4. **testCoverage (测试覆盖率)**: 测试是否充分，是否覆盖关键路径',
      '5. **security (安全性)**: 代码是否存在安全风险',
      '',
      '## 任务信息',
      '',
      `**任务ID**: ${task.id}`,
      `**任务标题**: ${task.title}`,
      `**任务类型**: ${task.type}`,
      `**优先级**: ${task.priority}`,
    ];

    if (task.description) {
      sections.push('', '## 任务描述', '', task.description);
    }

    if (changedFiles && changedFiles.length > 0) {
      sections.push('', '## 变更文件', '', ...changedFiles.map(f => `- ${f}`));
    }

    if (devReport) {
      sections.push('', '## 开发报告摘要', '');
      sections.push(`- 状态: ${devReport.status}`);
      sections.push(`- 变更数: ${devReport.changes.length}`);
      sections.push(`- 证据数: ${devReport.evidence.length}`);
    }

    if (codeReviewVerdict) {
      sections.push('', '## 代码审核结果', '');
      sections.push(`- 结果: ${codeReviewVerdict.result}`);
      sections.push(`- 原因: ${codeReviewVerdict.reason}`);
      if (codeReviewVerdict.codeQualityIssues.length > 0) {
        sections.push('- 问题:');
        codeReviewVerdict.codeQualityIssues.forEach(issue => {
          sections.push(`  - ${issue}`);
        });
      }
    }

    sections.push('', '## 输出格式', '');
    sections.push('请按以下 JSON 格式输出评分结果:');
    sections.push('```json');
    sections.push(JSON.stringify({
      correctness: { score: 85, reason: '评分理由' },
      readability: { score: 80, reason: '评分理由' },
      maintainability: { score: 75, reason: '评分理由' },
      testCoverage: { score: 70, reason: '评分理由' },
      security: { score: 90, reason: '评分理由' },
      summary: '整体评价摘要',
    }, null, 2));
    sections.push('```');

    return sections.join('\n');
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(output: string, taskId: string): CodeReviewQualityScore {
    const dimensions: DimensionScore[] = [];
    let summary = 'AI 审核完成';

    try {
      // 尝试从输出中提取 JSON
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : output;

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      // 解析各维度分数
      const dimensionKeys: QualityScoreDimension[] = [
        'correctness',
        'readability',
        'maintainability',
        'testCoverage',
        'security',
      ];

      for (const key of dimensionKeys) {
        const dimData = parsed[key];
        if (dimData && typeof dimData.score === 'number') {
          dimensions.push({
            dimension: key,
            score: Math.max(0, Math.min(100, dimData.score)),
            reason: dimData.reason || '未提供理由',
            issues: dimData.issues,
            suggestions: dimData.suggestions,
          });
        } else {
          // 默认分数
          dimensions.push({
            dimension: key,
            score: 60,
            reason: '未评分，使用默认值',
          });
        }
      }

      if (parsed.summary) {
        summary = parsed.summary;
      }
    } catch {
      // JSON 解析失败，使用默认分数
      const defaultDims: QualityScoreDimension[] = [
        'correctness',
        'readability',
        'maintainability',
        'testCoverage',
        'security',
      ];

      for (const dim of defaultDims) {
        dimensions.push({
          dimension: dim,
          score: 60,
          reason: '解析失败，使用默认值',
        });
      }

      summary = 'AI 响应解析失败，使用默认分数';
    }

    const totalScore = calculateWeightedTotalScore(dimensions, this.config.dimensionWeights);
    const meetsMinimum = totalScore >= this.config.minScore;

    return {
      totalScore,
      dimensions,
      scoredAt: new Date().toISOString(),
      scoredBy: 'ai_reviewer',
      summary,
      meetsMinimum,
      minimumThreshold: this.config.minScore,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<QualityScoreCheckerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 创建质量分数检查器实例
 */
export function createQualityScoreChecker(
  cwd: string,
  config?: Partial<QualityScoreCheckerConfig>
): QualityScoreChecker {
  return new QualityScoreChecker(cwd, config);
}

/**
 * 快速质量分数检查
 */
export async function quickQualityScoreCheck(
  context: AIReviewContext,
  cwd: string = process.cwd(),
  config?: Partial<QualityScoreCheckerConfig>
): Promise<QualityScoreCheckResult> {
  const checker = new QualityScoreChecker(cwd, config);
  return checker.check(context);
}

export default QualityScoreChecker;
