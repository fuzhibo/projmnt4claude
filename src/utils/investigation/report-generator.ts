import type { InvestigationReport, RootCauseItem, SolutionItem, ReportCheckpoint, ReportAssessment, OutputMode } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 将 InvestigationReport 结构化数据渲染为 markdown 文本
 */
export function generateReport(report: InvestigationReport, lang: 'zh' | 'en' = 'zh'): string {
  const sections: string[] = [];

  sections.push(renderMetadata(report.metadata, lang));
  sections.push(renderRootCauseAnalysis(report.rootCauseAnalysis, lang));
  sections.push(renderSolutions(report.solutions, lang));
  sections.push(renderCheckpoints(report.checkpoints, lang));
  sections.push(renderAssessment(report.assessment, lang));

  return sections.join('\n\n');
}

/**
 * 将报告写入文件系统
 * - 目录模式：写入 dir/report.md
 * - 文件模式：写入指定文件路径
 * @returns 写入的文件路径
 */
export function writeReport(report: InvestigationReport, mode: OutputMode, cwd: string): string {
  const markdown = generateReport(report, report.metadata.language);

  let filePath: string;
  if (mode.type === 'dir') {
    const dir = path.resolve(cwd, mode.path);
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, 'report.md');
  } else {
    const dir = path.dirname(path.resolve(cwd, mode.path));
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.resolve(cwd, mode.path);
  }

  fs.writeFileSync(filePath, markdown, 'utf-8');
  return filePath;
}

function renderMetadata(m: InvestigationReport['metadata'], lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    const lines = [
      '# Investigation Report',
      '',
      `- **Requirement Source**: ${m.requirementSource}`,
      `- **Investigation Date**: ${m.investigationDate}`,
      `- **Investigation Directory**: ${m.investigationDir}`,
      `- **Language**: ${m.language}`,
    ];
    if (m.parentReport) lines.push(`- **Parent Report**: ${m.parentReport}`);
    if (m.dependsOn?.length) lines.push(`- **Depends On**: ${m.dependsOn.join(', ')}`);
    return lines.join('\n');
  }

  const lines = [
    '# 调查报告',
    '',
    `- **需求来源**: ${m.requirementSource}`,
    `- **调查时间**: ${m.investigationDate}`,
    `- **调查目录**: ${m.investigationDir}`,
    `- **语言**: ${m.language}`,
  ];
  if (m.parentReport) lines.push(`- **父报告**: ${m.parentReport}`);
  if (m.dependsOn?.length) lines.push(`- **依赖子报告**: ${m.dependsOn.join(', ')}`);
  return lines.join('\n');
}

function renderRootCauseAnalysis(items: RootCauseItem[], lang: 'zh' | 'en'): string {
  const title = lang === 'en' ? 'Root Cause Analysis' : '原因分析';
  const lines = [`## ${title}`, ''];
  for (const item of items) {
    lines.push(`### ${item.id}: ${item.title}`);
    lines.push('');
    lines.push(item.description);
    lines.push('');
  }
  return lines.join('\n');
}

function renderSolutions(items: SolutionItem[], lang: 'zh' | 'en'): string {
  const title = lang === 'en' ? 'Solutions' : '解决方案';
  const corrLabel = lang === 'en' ? 'Corresponds To' : '对应原因';
  const filesLabel = lang === 'en' ? 'Involved Files' : '涉及文件';
  const changesLabel = lang === 'en' ? 'Expected Changes' : '预期变更';

  const lines = [`## ${title}`, ''];
  for (const item of items) {
    lines.push(`### ${item.id}: ${item.title}`);
    lines.push('');
    lines.push(`- **${corrLabel}**: ${item.correspondsTo}`);
    lines.push(`- **${filesLabel}**: ${item.files.join(', ')}`);
    lines.push(`- **${changesLabel}**: ${item.expectedChanges}`);
    lines.push('');
    lines.push(item.description);
    lines.push('');
  }
  return lines.join('\n');
}

function renderCheckpoints(items: ReportCheckpoint[], lang: 'zh' | 'en'): string {
  const title = lang === 'en' ? 'Checkpoints' : '检查点覆盖清单';
  const lines = [`## ${title}`, ''];
  for (const cp of items) {
    lines.push(`- [${cp.prefix}] ${cp.description} (→ ${cp.belongsTo})`);
  }
  return lines.join('\n');
}

function renderAssessment(a: ReportAssessment, lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    return [
      '## Assessment',
      '',
      `- **Complexity**: ${a.complexity}`,
      `- **Impact Scope**: ${a.impactScope}`,
      `- **Estimated Effort**: ${a.estimatedMinutes} minutes`,
    ].join('\n');
  }

  return [
    '## 评估',
    '',
    `- **复杂度**: ${a.complexity}`,
    `- **影响范围**: ${a.impactScope}`,
    `- **预估工时**: ${a.estimatedMinutes} 分钟`,
  ].join('\n');
}