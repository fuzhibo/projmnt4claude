/**
 * Test Coverage Checker
 * 测试覆盖率检查器
 *
 * 职责:
 * - TestCoverageChecker: 检查测试覆盖率是否达标 (R-QA-POST-007)
 *
 * 覆盖率来源优先级:
 * 1. qa-report.json 中的 coverage 字段
 * 2. 测试框架生成的覆盖率报告 (coverage-summary.json)
 *
 * 综合覆盖率计算 (加权平均):
 * coverage = (lineCov * 0.4) + (branchCov * 0.3) + (funcCov * 0.2) + (stmtCov * 0.1)
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 *
 * @module post-qa-gate/checkers/coverage-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { QAReport } from '../runner.js';

/**
 * 覆盖率检查结果
 */
export interface CoverageCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 检查项标识 */
  check: string;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * 覆盖率检查器配置
 */
export interface CoverageCheckerConfig {
  /** 最小覆盖率阈值 (0-1) */
  minCoverage: number;
  /** QA报告路径模板 */
  reportPath: string;
  /** 覆盖率报告文件路径列表 */
  coverageFiles: string[];
}

/**
 * 覆盖率权重配置
 */
export interface CoverageWeights {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

/**
 * 原始覆盖率数据
 */
interface RawCoverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

/**
 * 默认覆盖率权重
 */
export const DEFAULT_COVERAGE_WEIGHTS: CoverageWeights = {
  lines: 0.4,
  branches: 0.3,
  functions: 0.2,
  statements: 0.1,
};

/**
 * 默认配置
 */
export const DEFAULT_COVERAGE_CHECKER_CONFIG: CoverageCheckerConfig = {
  minCoverage: 0.6, // 60%
  reportPath: '.projmnt4claude/outputs/{taskId}/qa-report.json',
  coverageFiles: [
    'coverage/coverage-summary.json',
    'coverage/lcov-report/coverage-summary.json',
    'coverage.json',
  ],
};

/**
 * 测试覆盖率检查器
 * R-QA-POST-007 (WARNING级)
 *
 * 检查测试覆盖率是否达到阈值，默认60%
 */
export class TestCoverageChecker {
  private cwd: string;
  private config: CoverageCheckerConfig;
  private weights: CoverageWeights;

  constructor(
    cwd: string,
    config?: Partial<CoverageCheckerConfig>,
    weights?: Partial<CoverageWeights>
  ) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_COVERAGE_CHECKER_CONFIG, ...config };
    this.weights = { ...DEFAULT_COVERAGE_WEIGHTS, ...weights };
  }

  async check(taskId: string): Promise<CoverageCheckResult> {
    // 优先从 qa-report.json 获取覆盖率
    let coverage: number | undefined;
    let source = 'unknown';

    const reportPath = this.config.reportPath.replace('{taskId}', taskId);
    const fullPath = path.join(this.cwd, reportPath);

    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const report = JSON.parse(content) as QAReport;
        if (report.coverage !== undefined) {
          coverage = report.coverage;
          source = 'qa-report.json';
        }
      } catch {
        // 解析失败，继续
      }
    }

    // 如果 qa-report.json 中没有覆盖率，从覆盖率报告文件计算
    let details: RawCoverage | undefined;
    if (coverage === undefined) {
      const result = this.calculateCoverageFromReports();
      coverage = result.coverage;
      details = result.details;
      source = result.source;
    }

    // 无覆盖率数据时（任务无关联测试文件），跳过检查视为通过
    if (coverage === undefined) {
      return {
        passed: true,
        check: 'test_coverage',
        message: '无覆盖率数据，跳过覆盖率检查（任务可能无关联测试文件）',
        details: {
          coverage: undefined,
          minCoverage: this.config.minCoverage,
          skipped: true,
          reason: 'no_coverage_data',
        },
      };
    }

    const passed = coverage >= this.config.minCoverage;

    return {
      passed,
      check: 'test_coverage',
      message: passed
        ? `测试覆盖率达标: ${(coverage * 100).toFixed(1)}% >= ${(this.config.minCoverage * 100).toFixed(0)}%`
        : `测试覆盖率未达标: ${(coverage * 100).toFixed(1)}% < ${(this.config.minCoverage * 100).toFixed(0)}%`,
      details: {
        coverage,
        minCoverage: this.config.minCoverage,
        coveragePercent: `${(coverage * 100).toFixed(1)}%`,
        thresholdPercent: `${(this.config.minCoverage * 100).toFixed(0)}%`,
        source,
        weights: this.weights,
        ...(details ? {
          breakdown: {
            lines: `${(details.lines * 100).toFixed(1)}%`,
            branches: `${(details.branches * 100).toFixed(1)}%`,
            functions: `${(details.functions * 100).toFixed(1)}%`,
            statements: `${(details.statements * 100).toFixed(1)}%`,
          },
        } : {}),
        suggestions: passed ? undefined : this.generateSuggestions(coverage, details),
      },
    };
  }

  /**
   * 从测试框架报告计算综合覆盖率
   */
  private calculateCoverageFromReports(): {
    coverage: number;
    details: RawCoverage;
    source: string;
  } {
    for (const file of this.config.coverageFiles) {
      const filePath = path.join(this.cwd, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const raw = this.parseCoverageData(content);
          const weightedCoverage =
            raw.lines * this.weights.lines +
            raw.branches * this.weights.branches +
            raw.functions * this.weights.functions +
            raw.statements * this.weights.statements;

          return {
            coverage: Math.round(weightedCoverage * 1000) / 1000,
            details: raw,
            source: file,
          };
        } catch {
          // 解析失败，尝试下一个文件
        }
      }
    }

    // 默认返回0
    return {
      coverage: 0,
      details: { lines: 0, branches: 0, functions: 0, statements: 0 },
      source: 'default',
    };
  }

  /**
   * 解析覆盖率数据
   */
  private parseCoverageData(content: Record<string, unknown>): RawCoverage {
    const total = content.total as Record<string, Record<string, number>> | undefined;
    if (total) {
      return {
        lines: (total.lines?.pct ?? 0) / 100,
        branches: (total.branches?.pct ?? 0) / 100,
        functions: (total.functions?.pct ?? 0) / 100,
        statements: (total.statements?.pct ?? 0) / 100,
      };
    }

    return {
      lines: ((content as Record<string, Record<string, number>>).lines?.pct ?? 0) / 100,
      branches: ((content as Record<string, Record<string, number>>).branches?.pct ?? 0) / 100,
      functions: ((content as Record<string, Record<string, number>>).functions?.pct ?? 0) / 100,
      statements: ((content as Record<string, Record<string, number>>).statements?.pct ?? 0) / 100,
    };
  }

  /**
   * 生成改进建议
   */
  private generateSuggestions(coverage: number, details?: RawCoverage): string[] {
    const suggestions: string[] = [];

    suggestions.push(
      `当前覆盖率 ${(coverage * 100).toFixed(1)}% 低于阈值 ${(this.config.minCoverage * 100).toFixed(0)}%`
    );
    suggestions.push('建议为未覆盖的代码添加测试用例');

    if (details) {
      // 找出最低的覆盖率维度
      const dimensions = [
        { name: '行覆盖率', value: details.lines },
        { name: '分支覆盖率', value: details.branches },
        { name: '函数覆盖率', value: details.functions },
        { name: '语句覆盖率', value: details.statements },
      ];

      const lowest = dimensions.reduce((min, d) => d.value < min.value ? d : min);
      suggestions.push(`重点关注${lowest.name}: ${(lowest.value * 100).toFixed(1)}%`);
    }

    return suggestions;
  }
}

/**
 * 创建测试覆盖率检查器实例
 */
export function createCoverageChecker(
  cwd: string,
  config?: Partial<CoverageCheckerConfig>,
  weights?: Partial<CoverageWeights>
): TestCoverageChecker {
  return new TestCoverageChecker(cwd, config, weights);
}

/**
 * 快速检查测试覆盖率
 */
export async function quickCoverageCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CoverageCheckerConfig>,
  weights?: Partial<CoverageWeights>
): Promise<CoverageCheckResult> {
  const checker = new TestCoverageChecker(cwd, config, weights);
  return checker.check(taskId);
}

export default TestCoverageChecker;
