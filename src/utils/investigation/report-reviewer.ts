import type { InvestigationReport, ReviewResult, ReviewIssue } from './types';
import { callAIForJSON } from './ai-integration';
import { loadAndRenderTemplate } from '../prompt-templates/loader';
import { generateReport } from './report-generator';
import { createLogger } from '../logger';
import { loadCustomRequirements, formatCustomRequirements } from './config-reader';

/**
 * 对调查报告进行 AI 质量评审（三维度评分）
 * LOG-08: AI 评审器日志
 */
export async function reviewReport(
  requirement: string,
  report: InvestigationReport,
  cwd: string,
  lang: 'zh' | 'en' = 'zh',
  timeout?: number,
  debug?: boolean,
): Promise<ReviewResult> {
  const logger = createLogger('report-reviewer', cwd);
  const reportMarkdown = generateReport(report);
  const customReqs = loadCustomRequirements(cwd);

  // LOG-08: 评审输入日志
  logger.debug('reviewReport input', {
    requirementLength: requirement.length,
    requirementPreview: requirement.substring(0, 200),
    reportLength: reportMarkdown.length,
    reportPreview: reportMarkdown.substring(0, 500),
    reportStructure: {
      rootCauseCount: report.rootCauseAnalysis.length,
      solutionCount: report.solutions.length,
      checkpointCount: report.checkpoints.length,
    },
  });

  const prompt = await loadAndRenderTemplate(
    'review',
    {
      requirement,
      report: reportMarkdown,
      customRequirements: formatCustomRequirements(customReqs.review, 'review', lang),
    },
    lang,
    { mode: 'strict' }
  );

  const result = await callAIForJSON<ReviewResult>(
    { prompt, cwd, timeout, debug, allowedTools: ['Read'] },
    validateReviewResult,
  );

  // LOG-08: 评审输出日志
  logger.debug('reviewReport output', {
    pass: result.pass,
    scores: result.scores,
    issuesCount: result.issues.length,
    criticalIssues: result.issues.filter(i => i.severity === 'critical').length,
    majorIssues: result.issues.filter(i => i.severity === 'major').length,
    issuesPreview: result.issues.slice(0, 5).map(i => ({
      dimension: i.dimension,
      severity: i.severity,
      description: i.description.substring(0, 100),
    })),
  });

  // LOG-08: 高分但空内容警告
  if (result.pass && report.rootCauseAnalysis.length === 0) {
    logger.warn('reviewReport passed with empty rootCauseAnalysis', {
      scores: result.scores,
      pass: result.pass,
    });
  }

  return result;
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
  if (!s || typeof s.rootCauseAlignment !== 'number' || typeof s.solutionEffectiveness !== 'number' || typeof s.checkpointCompleteness !== 'number' || typeof s.factAccuracy !== 'number') {
    throw new Error('Invalid review result: scores missing required dimensions');
  }
  return {
    pass: r.pass,
    scores: { rootCauseAlignment: s.rootCauseAlignment, solutionEffectiveness: s.solutionEffectiveness, checkpointCompleteness: s.checkpointCompleteness, factAccuracy: s.factAccuracy },
    issues: (r.issues || []) as ReviewIssue[],
  };
}