import type { InvestigationReport, RootCauseItem, SolutionItem, ReportCheckpoint, ReportAssessment } from './types';

/**
 * 将 InvestigationReport 结构化数据渲染为 markdown 文本
 */
export function generateReport(report: InvestigationReport): string {
  const sections: string[] = [];

  sections.push(renderMetadata(report.metadata));
  sections.push(renderRootCauseAnalysis(report.rootCauseAnalysis));
  sections.push(renderSolutions(report.solutions));
  sections.push(renderCheckpoints(report.checkpoints));
  sections.push(renderAssessment(report.assessment));

  return sections.join('\n\n');
}

function renderMetadata(m: InvestigationReport['metadata']): string {
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

function renderRootCauseAnalysis(items: RootCauseItem[]): string {
  const lines = ['## 原因分析', ''];
  for (const item of items) {
    lines.push(`### ${item.id}: ${item.title}`);
    lines.push('');
    lines.push(item.description);
    lines.push('');
  }
  return lines.join('\n');
}

function renderSolutions(items: SolutionItem[]): string {
  const lines = ['## 解决方案', ''];
  for (const item of items) {
    lines.push(`### ${item.id}: ${item.title}`);
    lines.push('');
    lines.push(`- **对应原因**: ${item.correspondsTo}`);
    lines.push(`- **涉及文件**: ${item.files.join(', ')}`);
    lines.push(`- **预期变更**: ${item.expectedChanges}`);
    lines.push('');
    lines.push(item.description);
    lines.push('');
  }
  return lines.join('\n');
}

function renderCheckpoints(items: ReportCheckpoint[]): string {
  const lines = ['## 检查点', ''];
  for (const cp of items) {
    lines.push(`- [${cp.prefix}] ${cp.description} (→ ${cp.belongsTo})`);
  }
  return lines.join('\n');
}

function renderAssessment(a: ReportAssessment): string {
  const lines = [
    '## 评估',
    '',
    `- **复杂度**: ${a.complexity}`,
    `- **影响范围**: ${a.impactScope}`,
    `- **预估工时**: ${a.estimatedMinutes} 分钟`,
  ];
  return lines.join('\n');
}