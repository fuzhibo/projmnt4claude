import * as fs from 'fs';
import type { InvestigationReport, SplitPlan, SplitItem, SplitReviewResult, SplitReviewIssue } from './types';
import { loadAndRenderTemplate } from '../prompt-templates/loader';
import { loadCustomRequirements, formatCustomRequirements, loadInvestigationConfig } from './config-reader';

/**
 * 检查是否需要拆分（文件大小超过阈值）
 */
export function shouldSplit(reportPath: string, thresholdKB: number): boolean {
  if (!fs.existsSync(reportPath)) return false;
  const sizeKB = fs.statSync(reportPath).size / 1024;
  return sizeKB > thresholdKB;
}

/**
 * 生成拆分方案
 *
 * SOL-001: 采用文件路径注入方案，AI 通过 Read 工具读取报告内容
 */
export async function generateSplitPlan(
  reportPath: string,
  cwd: string,
  lang: 'zh' | 'en' = 'zh',
): Promise<SplitPlan> {
  const customReqs = loadCustomRequirements(cwd);
  const invConfig = loadInvestigationConfig(cwd);
  const prompt = await loadAndRenderTemplate(
    'split',
    {
      reportPath,
      splitThreshold: String(invConfig.splitThreshold),
      customRequirements: formatCustomRequirements(customReqs.split, 'split', lang),
    },
    lang,
    { mode: 'strict' }
  );

  const { callAIForJSON } = await import('./ai-integration');
  return callAIForJSON<SplitPlan>({ prompt, cwd, allowedTools: ['Read'] }, validateSplitPlan);
}

/**
 * AI 审核拆分方案（六维度，含反阶段拆分检测）
 *
 * SOL-001: 采用文件路径注入方案，AI 通过 Read 工具读取报告内容
 */
export async function reviewSplitPlan(
  reportPath: string,
  splitPlan: SplitPlan,
  cwd: string,
  lang: 'zh' | 'en' = 'zh',
  splitThreshold: number,
): Promise<SplitReviewResult> {
  const planJson = JSON.stringify(splitPlan, null, 2);
  const customReqs = loadCustomRequirements(cwd);
  const prompt = await loadAndRenderTemplate(
    'splitReview',
    {
      reportPath,
      splitPlan: planJson,
      splitThreshold: String(splitThreshold),
      customRequirements: formatCustomRequirements(customReqs.splitReview, 'splitReview', lang),
    },
    lang,
    { mode: 'strict' }
  );

  const { callAIForJSON } = await import('./ai-integration');
  return callAIForJSON<SplitReviewResult>({ prompt, cwd, allowedTools: ['Read'] }, validateSplitReviewResult);
}

/**
 * 完整拆分流程：生成方案 → 审核 → 对每个子项生成子报告
 * 审核失败时重试，达到上限抛出错误
 *
 * SOL-001: 采用文件路径注入方案
 */
export async function executeSplit(
  reportPath: string,
  requirement: string,
  options: { cwd: string; lang: 'zh' | 'en'; maxRetry: number; splitThreshold: number; outputDir: string },
): Promise<InvestigationReport[]> {
  let currentPlan: SplitPlan | undefined;
  let lastReview: SplitReviewResult | undefined;

  // 读取原始报告用于构建子报告
  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  const { parseReport } = await import('./report-parser');
  const report = parseReport(reportContent);

  for (let attempt = 0; attempt <= options.maxRetry; attempt++) {
    currentPlan = await generateSplitPlan(reportPath, options.cwd, options.lang);
    lastReview = await reviewSplitPlan(reportPath, currentPlan, options.cwd, options.lang, options.splitThreshold);

    if (lastReview.pass) break;

    if (attempt >= options.maxRetry) {
      throw new Error(
        `Split plan review failed after ${options.maxRetry} retries. Issues: ${lastReview.issues.map(i => i.description).join('; ')}`,
      );
    }
  }

  if (!currentPlan) throw new Error('Failed to generate split plan');

  // 为每个子项创建子报告
  return currentPlan.items.map((item, i) => buildSubReport(report, item, i));
}

function buildSubReport(parent: InvestigationReport, item: SplitItem, index: number): InvestigationReport {
  return {
    metadata: {
      ...parent.metadata,
      investigationDir: `${parent.metadata.investigationDir}-sub-${String(index + 1).padStart(2, '0')}`,
      parentReport: '../report.md',
      dependsOn: item.dependsOn.length > 0
        ? item.dependsOn.map(d => `sub-${String(d + 1).padStart(2, '0')}.md`)
        : undefined,
    },
    rootCauseAnalysis: parent.rootCauseAnalysis,
    solutions: parent.solutions.filter(sol =>
      parent.rootCauseAnalysis.some(ca => ca.id === sol.correspondsTo),
    ),
    checkpoints: parent.checkpoints,
    assessment: {
      complexity: parent.assessment.complexity,
      impactScope: parent.assessment.impactScope,
      estimatedMinutes: item.estimatedSize * 2,
    },
  };
}

function validateSplitPlan(data: unknown): SplitPlan {
  if (!data || typeof data !== 'object') throw new Error('Invalid split plan: expected object');
  const r = data as Record<string, unknown>;
  if (!Array.isArray(r.items)) throw new Error('Invalid split plan: items must be an array');
  for (const item of r.items as SplitItem[]) {
    if (!item.title || !item.relationship || !item.scope) {
      throw new Error('Invalid split item: missing required fields');
    }
    if (!['parallel', 'hierarchical'].includes(item.relationship)) {
      throw new Error(`Invalid relationship: ${item.relationship}`);
    }
  }
  return { items: r.items as SplitItem[] };
}

function validateSplitReviewResult(data: unknown): SplitReviewResult {
  if (!data || typeof data !== 'object') throw new Error('Invalid split review result: expected object');
  const r = data as Record<string, unknown>;
  if (typeof r.pass !== 'boolean') throw new Error('Invalid: pass must be boolean');
  const s = r.scores as Record<string, number>;
  const dims = ['coverage', 'boundaryClarity', 'independence', 'dependencyReasonability', 'antiPhaseSplitting', 'granularity'];
  if (!s) throw new Error('Invalid: missing scores');
  for (const d of dims) {
    if (typeof s[d] !== 'number') throw new Error(`Invalid: missing score ${d}`);
  }
  return {
    pass: r.pass,
    scores: {
      coverage: s.coverage!,
      boundaryClarity: s.boundaryClarity!,
      independence: s.independence!,
      dependencyReasonability: s.dependencyReasonability!,
      antiPhaseSplitting: s.antiPhaseSplitting!,
      granularity: s.granularity!,
    },
    issues: (r.issues || []) as SplitReviewIssue[],
  };
}