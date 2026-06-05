import type {
  InvestigationReport,
  ReportMetadata,
  RootCauseItem,
  SolutionItem,
  ReportCheckpoint,
  ReportAssessment,
  CheckpointPrefix,
} from './types';

/**
 * 将 markdown 文本解析为 InvestigationReport 结构化数据
 * 同时提取子报告依赖路径
 */
export function parseReport(markdown: string): InvestigationReport {
  const metadata = parseMetadata(markdown);
  const rootCauseAnalysis = parseRootCauseAnalysis(markdown);
  const solutions = parseSolutions(markdown);
  const checkpoints = parseCheckpoints(markdown);
  const assessment = parseAssessment(markdown);

  return { metadata, rootCauseAnalysis, solutions, checkpoints, assessment };
}

/**
 * 从报告 markdown 中提取子报告依赖路径
 */
export function extractDependencies(markdown: string): string[] {
  const depLine = markdown.match(/^- \*\*依赖子报告\*\*: (.+)$/m);
  if (!depLine) return [];
  return depLine[1].split(',').map(s => s.trim()).filter(Boolean);
}

// ---- 内部解析辅助 ----

function parseMetadata(md: string): ReportMetadata {
  const source = extractField(md, '需求来源') || extractField(md, 'Requirement Source') || '';
  const date = extractField(md, '调查时间') || extractField(md, 'Investigation Date') || new Date().toISOString();
  const dir = extractField(md, '调查目录') || extractField(md, 'Investigation Dir') || '';
  const langRaw = extractField(md, '语言') || extractField(md, 'Language') || 'zh';
  const parent = extractField(md, '父报告') || extractField(md, 'Parent Report');

  return {
    requirementSource: source,
    investigationDate: date,
    investigationDir: dir,
    language: langRaw === 'en' ? 'en' : 'zh',
    parentReport: parent || undefined,
    dependsOn: extractDependencies(md),
  };
}

function extractField(md: string, label: string): string | null {
  const re = new RegExp(`^- \\*\\*${escapeRegex(label)}\\*\\*: (.+)$`, 'm');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function parseRootCauseAnalysis(md: string): RootCauseItem[] {
  const items: RootCauseItem[] = [];
  const sectionMd = extractSection(md, '原因分析', 'Root Cause Analysis');
  if (!sectionMd) return items;

  const re = /### (CA-\d+): (.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionMd)) !== null) {
    const id = match[1];
    const title = match[2].trim();
    const descStart = match.index + match[0].length;
    const nextMatch = re.exec(sectionMd);
    const descEnd = nextMatch ? nextMatch.index : sectionMd.length;
    re.lastIndex = nextMatch ? nextMatch.index : re.lastIndex;
    const description = sectionMd.slice(descStart, descEnd).trim();
    items.push({ id, title, description });
    if (nextMatch) re.lastIndex = nextMatch.index;
  }
  return items;
}

function parseSolutions(md: string): SolutionItem[] {
  const items: SolutionItem[] = [];
  const sectionMd = extractSection(md, '解决方案', 'Solutions');
  if (!sectionMd) return items;

  const re = /### (SOL-\d+): (.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionMd)) !== null) {
    const id = match[1];
    const title = match[2].trim();
    const descStart = match.index + match[0].length;
    const nextMatch = re.exec(sectionMd);
    const descEnd = nextMatch ? nextMatch.index : sectionMd.length;
    re.lastIndex = nextMatch ? nextMatch.index : re.lastIndex;
    const body = sectionMd.slice(descStart, descEnd).trim();

    const correspondsTo = extractInlineField(body, '对应原因', 'Corresponds To') || '';
    const filesRaw = extractInlineField(body, '涉及文件', 'Files') || '';
    const files = filesRaw.split(',').map(s => s.trim()).filter(Boolean);
    const expectedChanges = extractInlineField(body, '预期变更', 'Expected Changes') || '';
    const description = body.split('\n').filter(l => !l.startsWith('- ')).join('\n').trim();

    items.push({ id, title, correspondsTo, description, files, expectedChanges });
    if (nextMatch) re.lastIndex = nextMatch.index;
  }
  return items;
}

function parseCheckpoints(md: string): ReportCheckpoint[] {
  const items: ReportCheckpoint[] = [];
  const sectionMd = extractSection(md, '检查点', 'Checkpoints');
  if (!sectionMd) return items;

  const validPrefixes = new Set<string>(['verify', 'test', 'review', 'implem', 'doc']);
  const re = /^- \[([a-z]+)\] (.+) \(→ (SOL-\d+)\)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionMd)) !== null) {
    const prefix = match[1];
    if (!validPrefixes.has(prefix)) continue;
    items.push({
      prefix: prefix as CheckpointPrefix,
      description: match[2].trim(),
      belongsTo: match[3],
    });
  }
  return items;
}

function parseAssessment(md: string): ReportAssessment {
  const sectionMd = extractSection(md, '评估', 'Assessment') || '';
  const complexity = extractInlineField(sectionMd, '复杂度', 'Complexity') || 'medium';
  const impactRaw = extractInlineField(sectionMd, '影响范围', 'Impact Scope') || '中等';
  const minutesRaw = extractInlineField(sectionMd, '预估工时', 'Estimated Minutes') || '60';

  return {
    complexity: validateComplexity(complexity),
    impactScope: impactRaw,
    estimatedMinutes: parseInt(minutesRaw.replace(/[^\d]/g, ''), 10) || 60,
  };
}

// ---- 工具函数 ----

function extractSection(md: string, zhTitle: string, enTitle: string): string | null {
  const re = new RegExp(`^## (?:${escapeRegex(zhTitle)}|${escapeRegex(enTitle)})\\s*\\n([\\s\\S]*?)(?=^## |$)`, 'm');
  const m = md.match(re);
  return m ? m[1] : null;
}

function extractInlineField(text: string, zhLabel: string, enLabel: string): string | null {
  const re = new RegExp(`\\*\\*(?:${escapeRegex(zhLabel)}|${escapeRegex(enLabel)})\\*\\*: (.+)$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateComplexity(v: string): 'low' | 'medium' | 'high' {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  if (v === '低') return 'low';
  if (v === '中') return 'medium';
  if (v === '高') return 'high';
  return 'medium';
}