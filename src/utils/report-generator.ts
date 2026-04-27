/**
 * Report Generator
 * 报告生成器 - 统一生成结构化的预检查报告
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  OutputConfig,
  PhaseResult,
  PrecheckReport,
  ReportMetadata,
  ReportSummary,
} from '../types/precheck';

export class ReportGenerator {
  private config: OutputConfig;

  constructor(config: OutputConfig) {
    this.config = config;
  }

  /**
   * 生成完整报告
   * CP-RG-1: 报告生成
   */
  generate(taskId: string, phases: PhaseResult[]): PrecheckReport {
    const summary = this.generateSummary(phases);
    const recommendations = this.generateRecommendations(phases);
    const metadata = this.generateMetadata();

    return {
      taskId,
      summary,
      phases,
      recommendations,
      metadata,
    };
  }

  /**
   * 生成报告摘要
   * CP-RG-2: 摘要生成
   */
  private generateSummary(phases: PhaseResult[]): ReportSummary {
    const totalPhases = phases.length;
    const passedPhases = phases.filter(p => p.passed).length;
    const failedPhases = totalPhases - passedPhases;

    let totalChecks = 0;
    let passedChecks = 0;
    let failedChecks = 0;

    for (const phase of phases) {
      totalChecks += phase.checks.length;
      passedChecks += phase.checks.filter(c => c.passed).length;
      failedChecks += phase.checks.filter(c => !c.passed).length;
    }

    const duration = phases.reduce((sum, p) => sum + p.duration, 0);

    let status: 'passed' | 'failed' | 'partial';
    if (failedPhases === 0) {
      status = 'passed';
    } else if (passedPhases === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    return {
      totalPhases,
      passedPhases,
      failedPhases,
      totalChecks,
      passedChecks,
      failedChecks,
      duration,
      status,
    };
  }

  /**
   * 生成建议
   * CP-RG-3: 建议生成
   */
  private generateRecommendations(phases: PhaseResult[]): string[] {
    const recommendations: string[] = [];

    for (const phase of phases) {
      if (!phase.passed) {
        recommendations.push(`Phase '${phase.phase}' failed. Review the following issues:`);
        for (const error of phase.errors) {
          recommendations.push(`  - ${error}`);
        }
        for (const check of phase.checks.filter(c => !c.passed)) {
          if (check.suggestions) {
            for (const suggestion of check.suggestions) {
              recommendations.push(`  - ${suggestion}`);
            }
          }
        }
      }
    }

    return recommendations;
  }

  /**
   * 生成元数据
   * CP-RG-4: 元数据生成
   */
  private generateMetadata(): ReportMetadata {
    return {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      orchestratorVersion: '1.0.0',
    };
  }

  /**
   * 导出报告
   * CP-RG-5: 报告导出
   */
  async export(report: PrecheckReport, formats?: string[]): Promise<string[]> {
    const formatsToExport = formats || this.config.formats;
    const exportedFiles: string[] = [];

    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    for (const format of formatsToExport) {
      const filepath = await this.exportToFormat(report, format);
      exportedFiles.push(filepath);
    }

    return exportedFiles;
  }

  /**
   * 导出到指定格式
   * CP-RG-6: 格式转换
   */
  private async exportToFormat(report: PrecheckReport, format: string): Promise<string> {
    const baseFilename = `precheck-report-${report.taskId}`;

    switch (format) {
      case 'json':
        return this.exportToJson(report, baseFilename);
      case 'markdown':
        return this.exportToMarkdown(report, baseFilename);
      case 'terminal':
        return this.exportToTerminal(report, baseFilename);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * 导出为 JSON
   * CP-RG-7: JSON 导出
   */
  private exportToJson(report: PrecheckReport, baseFilename: string): string {
    const filepath = path.join(this.config.outputDir, `${baseFilename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    return filepath;
  }

  /**
   * 导出为 Markdown
   * CP-RG-8: Markdown 导出
   */
  private exportToMarkdown(report: PrecheckReport, baseFilename: string): string {
    const filepath = path.join(this.config.outputDir, `${baseFilename}.md`);

    const lines: string[] = [
      `# PreCheck Report: ${report.taskId}`,
      '',
      '## Summary',
      '',
      `- **Status**: ${report.summary.status}`,
      `- **Total Phases**: ${report.summary.totalPhases}`,
      `- **Passed Phases**: ${report.summary.passedPhases}`,
      `- **Failed Phases**: ${report.summary.failedPhases}`,
      `- **Total Checks**: ${report.summary.totalChecks}`,
      `- **Passed Checks**: ${report.summary.passedChecks}`,
      `- **Failed Checks**: ${report.summary.failedChecks}`,
      `- **Duration**: ${report.summary.duration}ms`,
      '',
      '## Phases',
      '',
    ];

    for (const phase of report.phases) {
      lines.push(`### ${phase.phase} ${phase.passed ? '✅' : '❌'}`);
      lines.push('');
      lines.push(`- **Status**: ${phase.passed ? 'PASSED' : 'FAILED'}`);
      lines.push(`- **Duration**: ${phase.duration}ms`);
      lines.push(`- **Timestamp**: ${phase.timestamp}`);
      lines.push('');

      if (phase.checks.length > 0) {
        lines.push('#### Checks');
        lines.push('');
        for (const check of phase.checks) {
          lines.push(`- **${check.checkId}** ${check.passed ? '✅' : '❌'}`);
          lines.push(`  - Message: ${check.message}`);
          if (check.details) {
            lines.push(`  - Details: \`${JSON.stringify(check.details)}\``);
          }
          lines.push('');
        }
      }

      if (phase.errors.length > 0) {
        lines.push('#### Errors');
        lines.push('');
        for (const error of phase.errors) {
          lines.push(`- ${error}`);
        }
        lines.push('');
      }
    }

    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    lines.push('## Metadata');
    lines.push('');
    lines.push(`- **Generated At**: ${report.metadata.generatedAt}`);
    lines.push(`- **Version**: ${report.metadata.version}`);
    lines.push(`- **Orchestrator Version**: ${report.metadata.orchestratorVersion}`);
    lines.push('');

    fs.writeFileSync(filepath, lines.join('\n'));
    return filepath;
  }

  /**
   * 导出为终端格式
   * CP-RG-9: 终端输出
   */
  private exportToTerminal(report: PrecheckReport, baseFilename: string): string {
    const filepath = path.join(this.config.outputDir, `${baseFilename}.txt`);

    const lines: string[] = [
      `═══════════════════════════════════════════════════`,
      `  PreCheck Report: ${report.taskId}`,
      `═══════════════════════════════════════════════════`,
      '',
      `  Status: ${report.summary.status.toUpperCase()}`,
      `  Phases: ${report.summary.passedPhases}/${report.summary.totalPhases} passed`,
      `  Checks: ${report.summary.passedChecks}/${report.summary.totalChecks} passed`,
      `  Duration: ${report.summary.duration}ms`,
      '',
      `───────────────────────────────────────────────────`,
      '  PHASE DETAILS',
      `───────────────────────────────────────────────────`,
      '',
    ];

    for (const phase of report.phases) {
      const icon = phase.passed ? '✓' : '✗';
      lines.push(`  ${icon} ${phase.phase} (${phase.duration}ms)`);

      for (const check of phase.checks) {
        const checkIcon = check.passed ? '  ✓' : '  ✗';
        lines.push(`${checkIcon} ${check.checkId}: ${check.message}`);
      }

      if (phase.errors.length > 0) {
        for (const error of phase.errors) {
          lines.push(`    ! ${error}`);
        }
      }
      lines.push('');
    }

    lines.push(`═══════════════════════════════════════════════════`);

    fs.writeFileSync(filepath, lines.join('\n'));
    return filepath;
  }

  /**
   * 格式化终端输出
   * CP-RG-10: 实时终端输出
   */
  formatForTerminal(report: PrecheckReport): string {
    const lines: string[] = [
      '',
      '╔════════════════════════════════════════════════════════════╗',
      '║              PRECHECK ORCHESTRATOR REPORT                  ║',
      '╚════════════════════════════════════════════════════════════╝',
      '',
      `  Task: ${report.taskId}`,
      `  Status: ${report.summary.status === 'passed' ? '✅ PASSED' : report.summary.status === 'failed' ? '❌ FAILED' : '⚠️  PARTIAL'}`,
      '',
      '  ┌─────────────────────────────────────────────────────────┐',
      '  │ SUMMARY                                                  │',
      '  ├─────────────────────────────────────────────────────────┤',
      `  │ Phases:  ${report.summary.passedPhases}/${report.summary.totalPhases} passed                                      │`,
      `  │ Checks:  ${report.summary.passedChecks}/${report.summary.totalChecks} passed                                      │`,
      `  │ Duration: ${report.summary.duration.toString().padStart(4)}ms                                        │`,
      '  └─────────────────────────────────────────────────────────┘',
      '',
    ];

    for (const phase of report.phases) {
      const phaseIcon = phase.passed ? '✅' : '❌';
      lines.push(`  ${phaseIcon} ${phase.phase}`);
      for (const check of phase.checks) {
        const checkIcon = check.passed ? '  ✓' : '  ✗';
        lines.push(`${checkIcon} ${check.checkId}`);
      }
      lines.push('');
    }

    lines.push('  ════════════════════════════════════════════════════════════');
    lines.push('');

    return lines.join('\n');
  }
}
