import * as fs from 'fs';
import * as path from 'path';
import type {
  InvestigationReport,
  ReportMetadata,
  RootCauseItem,
  SolutionItem,
  ReportCheckpoint,
  ReportAssessment,
  ParseCheckpointsOptions,
} from './types';
import { CHECKPOINT_REGEX, CheckpointFormat } from './checkpoint-format.js';
import { createLogger } from '../logger.js';
import {
  REPORT_SECTIONS,
  METADATA_FIELDS,
  SOLUTION_FIELDS,
  ASSESSMENT_FIELDS,
  ASSESSMENT_VALUES,
  buildCaHeadingRegex,
  buildSolHeadingRegex,
} from './report-contract.js';

/**
 * 将 markdown 文本解析为 InvestigationReport 结构化数据
 * LOG-04/05: 解析器日志增强
 */
export function parseReport(markdown: string, debug?: boolean): InvestigationReport {
  const logger = createLogger('report-parser', undefined, debug);

  // LOG-04: 解析输入日志
  logger.debug('parseReport input', {
    inputLength: markdown.length,
    inputPreview: markdown.substring(0, 300),
  });

  const metadata = parseMetadata(markdown);
  const rootCauseAnalysis = parseRootCauseAnalysis(markdown);
  const solutions = parseSolutions(markdown);
  const checkpoints = parseCheckpoints(markdown);
  const assessment = parseAssessment(markdown);

  // LOG-05: 解析结果摘要
  logger.debug('parseReport result', {
    metadata: {
      hasSource: !!metadata.requirementSource,
      sourceLength: metadata.requirementSource.length,
    },
    rootCauseCount: rootCauseAnalysis.length,
    solutionCount: solutions.length,
    checkpointCount: checkpoints.length,
  });

  // LOG-05: 空结果警告
  if (rootCauseAnalysis.length === 0 || solutions.length === 0) {
    logger.warn('parseReport returned empty sections', {
      rootCauseCount: rootCauseAnalysis.length,
      solutionCount: solutions.length,
      inputLength: markdown.length,
    });
  }

  return { metadata, rootCauseAnalysis, solutions, checkpoints, assessment };
}

/**
 * 从文件路径读取并解析报告
 */
export function readReport(reportPath: string, cwd: string): InvestigationReport {
  const fullPath = path.resolve(cwd, reportPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return parseReport(content);
}

/**
 * 从报告 markdown 中提取子报告依赖路径
 */
export function extractDependenciesFromMarkdown(markdown: string): string[] {
  const depRaw = extractField(markdown, METADATA_FIELDS.dependsOn.zh)
    || extractField(markdown, METADATA_FIELDS.dependsOn.en);
  if (!depRaw) return [];
  return depRaw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 从 InvestigationReport 结构中提取依赖关系
 * 返回路径 → dependsOn 路径列表的映射
 */
export function extractDependencies(report: InvestigationReport): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const dir = report.metadata.investigationDir;
  if (report.metadata.dependsOn?.length) {
    deps.set(dir, report.metadata.dependsOn);
  }
  return deps;
}

// ---- 内部解析辅助 ----

function parseMetadata(md: string): ReportMetadata {
  const source = extractField(md, METADATA_FIELDS.requirementSource.zh) || extractField(md, METADATA_FIELDS.requirementSource.en) || '';
  const date = extractField(md, METADATA_FIELDS.investigationDate.zh) || extractField(md, METADATA_FIELDS.investigationDate.en) || new Date().toISOString();
  const dir = extractField(md, METADATA_FIELDS.investigationDir.zh) || extractField(md, METADATA_FIELDS.investigationDir.en) || '';
  const langRaw = extractField(md, METADATA_FIELDS.language.zh) || extractField(md, METADATA_FIELDS.language.en) || 'zh';
  const parent = extractField(md, METADATA_FIELDS.parentReport.zh) || extractField(md, METADATA_FIELDS.parentReport.en);

  return {
    requirementSource: source,
    investigationDate: date,
    investigationDir: dir,
    language: langRaw === 'en' ? 'en' : 'zh',
    parentReport: parent || undefined,
    dependsOn: extractDependenciesFromMarkdown(md),
  };
}

function extractField(md: string, label: string): string | null {
  // 支持格式变体：可选加粗、中英文冒号、冒号后可选空格、多行续行
  const re = new RegExp(
    `^- (?:\\*\\*)?${escapeRegex(label)}(?:\\*\\*)?(?::|：)\\s*(.+)$`,
    'm'
  );
  const m = md.match(re);
  if (!m || m[1] === undefined) return null;

  let value = m[1];
  // 支持多行续行（循环捕获连续缩进行）
  let tail = md.slice((m.index ?? 0) + m[0].length);
  while (true) {
    const contMatch = tail.match(/^\n( {2,}|\t)(.*)/);
    if (!contMatch || contMatch[2] === undefined) break;
    value += '\n' + contMatch[2];
    tail = tail.slice(contMatch[0].length);
  }

  return value.trim();
}

function parseRootCauseAnalysis(md: string): RootCauseItem[] {
  const items: RootCauseItem[] = [];
  const sectionMd = extractSection(md, REPORT_SECTIONS.rootCauseAnalysis.zh, REPORT_SECTIONS.rootCauseAnalysis.en);
  if (!sectionMd) return items;

  // Collect all matches first to avoid interfering with regex state
  const matches: RegExpExecArray[] = [];
  const re = buildCaHeadingRegex();
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionMd)) !== null) {
    matches.push(match);
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const id = m[1] ?? '';
    const title = (m[2] ?? '').trim();
    const descStart = (m.index ?? 0) + (m[0]?.length ?? 0);
    const descEnd = i < matches.length - 1 ? (matches[i + 1]?.index ?? sectionMd.length) : sectionMd.length;
    const description = sectionMd.slice(descStart, descEnd).trim();
    items.push({ id, title, description });
  }
  return items;
}

function parseSolutions(md: string): SolutionItem[] {
  const items: SolutionItem[] = [];
  const sectionMd = extractSection(md, REPORT_SECTIONS.solutions.zh, REPORT_SECTIONS.solutions.en);
  if (!sectionMd) return items;

  // Collect all matches first to avoid interfering with regex state
  const matches: RegExpExecArray[] = [];
  const re = buildSolHeadingRegex();
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionMd)) !== null) {
    matches.push(match);
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const id = m[1] ?? '';
    const title = (m[2] ?? '').trim();
    const descStart = (m.index ?? 0) + (m[0]?.length ?? 0);
    const descEnd = i < matches.length - 1 ? (matches[i + 1]?.index ?? sectionMd.length) : sectionMd.length;
    const body = sectionMd.slice(descStart, descEnd).trim();

    const correspondsTo = extractInlineField(body, SOLUTION_FIELDS.correspondsTo.zh, SOLUTION_FIELDS.correspondsTo.en) || '';
    const filesRaw = extractInlineField(body, SOLUTION_FIELDS.files.zh, SOLUTION_FIELDS.files.en) || '';
    const files = filesRaw.split(',').map(s => s.trim()).filter(Boolean);
    const expectedChanges = extractInlineField(body, SOLUTION_FIELDS.expectedChanges.zh, SOLUTION_FIELDS.expectedChanges.en) || '';
    const description = body.split('\n').filter(l => !l.startsWith('- ')).join('\n').trim();

    items.push({ id, title, correspondsTo, description, files, expectedChanges });
  }
  return items;
}

function parseCheckpoints(md: string, options: ParseCheckpointsOptions = {}): ReportCheckpoint[] {
  const items: ReportCheckpoint[] = [];
  const sectionMd = extractSection(md, REPORT_SECTIONS.checkpoints.zh, REPORT_SECTIONS.checkpoints.en);
  if (!sectionMd) return items;

  const tolerance = options.tolerance ?? 'normal';
  const warnOnInvalid = options.warnOnInvalidFormat ?? false;
  const inferBelongsTo = options.inferBelongsTo ?? true;

  // 收集所有可能的检查点行（用于日志和回退）
  const unparsedLines: string[] = [];

  // 根据容错级别选择解析策略
  if (tolerance === 'strict') {
    // strict: 仅使用完整格式
    parseWithRegex(CHECKPOINT_REGEX.full, true);
  } else if (tolerance === 'loose') {
    // loose: 仅使用极简格式
    parseWithRegex(CHECKPOINT_REGEX.simple, false);
  } else {
    // normal: 三层回退解析 (full -> simple -> minimal)
    // 层级1: 完整格式（支持可选 belongsTo）
    parseWithRegex(CHECKPOINT_REGEX.full, false);

    // 层级2: 如果匹配数不足，尝试简化格式
    if (items.length === 0) {
      parseWithRegex(CHECKPOINT_REGEX.simple, false);
    }

    // 层级3: 如果仍无匹配，尝试极简格式（宽松空格）
    if (items.length === 0) {
      const minimalRe = /^-\s*\[([a-z][a-z\s-]*?)\]\s*(.+)$/gm;
      parseWithRegex(minimalRe, false);
    }
  }

  // 记录未解析的行
  if (warnOnInvalid && unparsedLines.length > 0) {
    const logger = createLogger('report-parser');
    for (const line of unparsedLines) {
      logger.warn('checkpoint line not parsed', {
        line: line.trim(),
        section: REPORT_SECTIONS.checkpoints.en,
        tolerance,
      });
    }
  }

  return items;

  // 内部辅助：使用指定正则解析检查点
  function parseWithRegex(re: RegExp, requireBelongsTo: boolean): void {
    // null 守卫：TypeScript 不保留跨嵌套函数的类型收窄
    if (!sectionMd) return;
    const localRe = new RegExp(re.source, 'gm');
    let match: RegExpExecArray | null;
    while ((match = localRe.exec(sectionMd)) !== null) {
      const prefixRaw = (match[1] ?? '').trim();
      const description = (match[2] ?? '').trim();
      const belongsToRaw = match[3] ?? '';
      const belongsTo = requireBelongsTo
        ? belongsToRaw
        : (belongsToRaw || (inferBelongsTo ? CheckpointFormat.inferBelongsToFromContext(sectionMd, match.index ?? 0) : ''));

      const normalizedPrefix = CheckpointFormat.normalizePrefix(prefixRaw);
      if (!normalizedPrefix) {
        unparsedLines.push(match[0]);
        continue;
      }

      items.push({
        prefix: normalizedPrefix,
        description,
        belongsTo,
      });
    }
  }
}

function parseAssessment(md: string): ReportAssessment {
  const sectionMd = extractSection(md, REPORT_SECTIONS.assessment.zh, REPORT_SECTIONS.assessment.en) || '';
  const complexity = extractInlineField(sectionMd, ASSESSMENT_FIELDS.complexity.zh, ASSESSMENT_FIELDS.complexity.en) || 'medium';
  const impactRaw = extractInlineField(sectionMd, ASSESSMENT_FIELDS.impactScope.zh, ASSESSMENT_FIELDS.impactScope.en) || '中等';
  const minutesRaw = extractInlineField(sectionMd, ASSESSMENT_FIELDS.estimatedMinutes.zh, ASSESSMENT_FIELDS.estimatedMinutes.en) || '60';

  return {
    complexity: validateComplexity(complexity),
    impactScope: validateImpactScope(impactRaw),
    estimatedMinutes: parseInt(minutesRaw.replace(/[^\d]/g, ''), 10) || 60,
  };
}

// ---- 工具函数 ----

// LOG-04: 章节提取日志增强
function extractSection(md: string, zhTitle: string, enTitle: string): string | null {
  const logger = createLogger('report-parser');
  const re = new RegExp(`^## (?:${escapeRegex(zhTitle)}|${escapeRegex(enTitle)})\\s*\\n([\\s\\S]*?)(?=^## |\\n## |\\n# |(?![\\s\\S]))`, 'm');
  const m = md.match(re);
  if (!m) {
    logger.debug('extractSection not found', {
      zhTitle,
      enTitle,
      inputPreview: md.substring(0, 500),
    });
    return null;
  }
  return m[1] ?? null;
}

function extractInlineField(text: string, zhLabel: string, enLabel: string): string | null {
  const re = new RegExp(`(?:\\*\\*)?(?:${escapeRegex(zhLabel)}|${escapeRegex(enLabel)})(?:\\*\\*)?(?::|：)\\s*(.+)$`, 'm');
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateComplexity(v: string): 'low' | 'medium' | 'high' {
  const opts = ASSESSMENT_VALUES.complexity.options;
  if ((opts as readonly string[]).includes(v)) return v as 'low' | 'medium' | 'high';
  const mapped = ASSESSMENT_VALUES.complexity.zhMapping[v as keyof typeof ASSESSMENT_VALUES.complexity.zhMapping];
  if (mapped) return mapped;
  return ASSESSMENT_VALUES.complexity.fallback;
}

function validateImpactScope(v: string): '有限' | '中等' | '广泛' {
  const opts = ASSESSMENT_VALUES.impactScope.options;
  if ((opts as readonly string[]).includes(v)) return v as '有限' | '中等' | '广泛';
  const mapped = ASSESSMENT_VALUES.impactScope.enMapping[v as keyof typeof ASSESSMENT_VALUES.impactScope.enMapping];
  if (mapped) return mapped;
  return ASSESSMENT_VALUES.impactScope.fallback;
}