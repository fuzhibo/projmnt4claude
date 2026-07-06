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

/**
 * 将 markdown 文本解析为 InvestigationReport 结构化数据
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
  const depRaw = extractField(markdown, '依赖子报告')
    || extractField(markdown, 'Depends On');
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
  const sectionMd = extractSection(md, '原因分析', 'Root Cause Analysis');
  if (!sectionMd) return items;

  // Collect all matches first to avoid interfering with regex state
  const matches: RegExpExecArray[] = [];
  const re = /### (CA-\d+): (.+)/g;
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
  const sectionMd = extractSection(md, '解决方案', 'Solutions');
  if (!sectionMd) return items;

  // Collect all matches first to avoid interfering with regex state
  const matches: RegExpExecArray[] = [];
  const re = /### (SOL-\d+): (.+)/g;
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

    const correspondsTo = extractInlineField(body, '对应原因', 'Corresponds To') || '';
    const filesRaw = extractInlineField(body, '涉及文件', 'Files') || '';
    const files = filesRaw.split(',').map(s => s.trim()).filter(Boolean);
    const expectedChanges = extractInlineField(body, '预期变更', 'Expected Changes') || '';
    const description = body.split('\n').filter(l => !l.startsWith('- ')).join('\n').trim();

    items.push({ id, title, correspondsTo, description, files, expectedChanges });
  }
  return items;
}

function parseCheckpoints(md: string, options: ParseCheckpointsOptions = {}): ReportCheckpoint[] {
  const items: ReportCheckpoint[] = [];
  const sectionMd = extractSection(md, '检查点覆盖清单', 'Checkpoint Checklist');
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
        section: 'Checkpoint Checklist',
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
  const sectionMd = extractSection(md, '评估', 'Assessment') || '';
  const complexity = extractInlineField(sectionMd, '复杂度', 'Complexity') || 'medium';
  const impactRaw = extractInlineField(sectionMd, '影响范围', 'Impact Scope') || '中等';
  const minutesRaw = extractInlineField(sectionMd, '预估工时', 'Estimated Minutes') || '60';

  return {
    complexity: validateComplexity(complexity),
    impactScope: validateImpactScope(impactRaw),
    estimatedMinutes: parseInt(minutesRaw.replace(/[^\d]/g, ''), 10) || 60,
  };
}

// ---- 工具函数 ----

function extractSection(md: string, zhTitle: string, enTitle: string): string | null {
  const re = new RegExp(`^## (?:${escapeRegex(zhTitle)}|${escapeRegex(enTitle)})\\s*\\n([\\s\\S]*?)(?=^## |\\n## |\\n# |(?![\\s\\S]))`, 'm');
  const m = md.match(re);
  if (!m) return null;
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
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  if (v === '低') return 'low';
  if (v === '中') return 'medium';
  if (v === '高') return 'high';
  return 'medium';
}

function validateImpactScope(v: string): '有限' | '中等' | '广泛' {
  if (v === '有限') return '有限';
  if (v === '中等') return '中等';
  if (v === '广泛') return '广泛';
  if (v === 'limited') return '有限';
  if (v === 'medium' || v === 'moderate') return '中等';
  if (v === 'wide' || v === 'broad' || v === 'extensive') return '广泛';
  return '中等';
}