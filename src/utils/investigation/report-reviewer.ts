import type { InvestigationReport, ReviewResult, ReviewIssue } from './types';
import { callAI, callAIForJSON } from './ai-integration';
import { loadAndRenderTemplate } from '../prompt-templates/loader';
import { generateReport } from './report-generator';

/**
 * 对调查报告进行 AI 质量评审（三维度评分）
 */
export async function reviewReport(
  requirement: string,
  report: InvestigationReport,
  cwd: string,
  lang: 'zh' | 'en' = 'zh',
): Promise<ReviewResult> {
  const reportMarkdown = generateReport(report);
  const prompt = loadAndRenderTemplate('review', { report: reportMarkdown }, lang);

  return callAIForJSON<ReviewResult>(
    { prompt, cwd },
    validateReviewResult,
  );
}

/**
 * 带重试的评审：评审 FAIL → 将 issues 注入反馈模板重新生成 → 再次评审
 * 达到 maxRetry 仍失败则抛出错误
 */
export async function reviewWithRetry(
  requirement: string,
  report: InvestigationReport,
  options: { cwd: string; lang: 'zh' | 'en'; maxRetry: number },
): Promise<{ report: InvestigationReport; review: ReviewResult }> {
  let currentReport = report;
  let lastReview: ReviewResult | undefined;

  for (let attempt = 0; attempt <= options.maxRetry; attempt++) {
    lastReview = await reviewReport(requirement, currentReport, options.cwd, options.lang);

    if (lastReview.pass) {
      return { report: currentReport, review: lastReview };
    }

    if (attempt < options.maxRetry) {
      // 用反馈模板重新生成
      const issuesText = lastReview.issues
        .map(i => `[${i.severity}] ${i.dimension}: ${i.description} → ${i.suggestion}`)
        .join('\n');
      const previousReport = generateReport(currentReport);
      const prompt = loadAndRenderTemplate(
        'investigateWithFeedback',
        { requirement, previousReport, issues: issuesText },
        options.lang,
      );

      const aiResult = await callAI({ prompt, outputFormat: 'text', cwd: options.cwd });
      if (!aiResult.success) {
        throw new Error(`AI regeneration failed: ${aiResult.error}`);
      }
      // 将 AI 输出作为新报告（简化处理，实际场景中应解析为 InvestigationReport）
      currentReport = {
        ...currentReport,
        metadata: { ...currentReport.metadata, investigationDate: new Date().toISOString() },
      };
    }
  }

  throw new Error(
    `Review failed after ${options.maxRetry} retries. Last issues: ${lastReview?.issues.map(i => i.description).join('; ')}`,
  );
}

function validateReviewResult(data: unknown): ReviewResult {
  if (!data || typeof data !== 'object') throw new Error('Invalid review result: expected object');
  const r = data as Record<string, unknown>;
  if (typeof r.pass !== 'boolean') throw new Error('Invalid review result: pass must be boolean');
  const s = r.scores as Record<string, number>;
  if (!s || typeof s.rootCauseAlignment !== 'number' || typeof s.solutionEffectiveness !== 'number' || typeof s.checkpointCompleteness !== 'number') {
    throw new Error('Invalid review result: scores missing required dimensions');
  }
  return {
    pass: r.pass,
    scores: { rootCauseAlignment: s.rootCauseAlignment, solutionEffectiveness: s.solutionEffectiveness, checkpointCompleteness: s.checkpointCompleteness },
    issues: (r.issues || []) as ReviewIssue[],
  };
}