import type { InvestigationReport, ReviewResult, ReviewIssue } from './types';
import { callAIForJSON } from './ai-integration';
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
  timeout?: number,
  debug?: boolean,
): Promise<ReviewResult> {
  const reportMarkdown = generateReport(report);
  const prompt = await loadAndRenderTemplate('review', { requirement, report: reportMarkdown }, lang, { mode: 'strict' });

  return callAIForJSON<ReviewResult>(
    { prompt, cwd, timeout, debug },
    validateReviewResult,
  );
}

/**
 * 带重试的评审：评审 FAIL → 返回失败结果，不重新生成报告
 * 达到 maxRetry 仍失败则返回最后一次评审结果（pass=false）
 */
export async function reviewReportWithRetry(
  requirement: string,
  report: InvestigationReport,
  options: { cwd: string; lang: 'zh' | 'en'; maxRetry: number; timeout?: number; debug?: boolean },
): Promise<{ report: InvestigationReport; review: ReviewResult }> {
  let lastReview: ReviewResult | undefined;

  for (let attempt = 0; attempt <= options.maxRetry; attempt++) {
    lastReview = await reviewReport(requirement, report, options.cwd, options.lang, options.timeout, options.debug);

    if (lastReview.pass) {
      return { report, review: lastReview };
    }

    if (attempt >= options.maxRetry) {
      // 达到最大重试次数，返回失败结果
      return { report, review: lastReview };
    }
  }

  // 不可达，但 TypeScript 需要返回类型
  throw new Error('reviewReportWithRetry: unreachable');
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