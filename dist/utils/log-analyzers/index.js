/**
 * 内置日志分析器集合
 *
 * 导出所有内置分析器，供 LogAnalyzerRegistry 注册使用。
 */
export { HeadlessClaudeAnalyzer } from './headless-claude-analyzer.js';
export { HarnessPipelineAnalyzer } from './harness-pipeline-analyzer.js';
export { APIErrorAnalyzer } from './api-error-analyzer.js';
export { PerformanceAnalyzer } from './performance-analyzer.js';
import { HeadlessClaudeAnalyzer } from './headless-claude-analyzer.js';
import { HarnessPipelineAnalyzer } from './harness-pipeline-analyzer.js';
import { APIErrorAnalyzer } from './api-error-analyzer.js';
import { PerformanceAnalyzer } from './performance-analyzer.js';
/** 获取所有内置分析器实例 */
export function getBuiltInAnalyzers() {
    return [
        new HeadlessClaudeAnalyzer(),
        new HarnessPipelineAnalyzer(),
        new APIErrorAnalyzer(),
        new PerformanceAnalyzer(),
    ];
}
