/**
 * QA Post-Gate Rules
 * QA验证阶段后质量门禁规则集合
 *
 * 将 PostQAGateRunner 的 8 条规则迁移到统一门禁框架 (executeRules + GateRule[])。
 *
 * 规则列表 (R-QA-POST-001 ~ R-QA-POST-007 + R-QA-POST-005a):
 * - R-QA-POST-001: QA报告存在
 * - R-QA-POST-002: 报告格式有效
 * - R-QA-POST-003: 测试结果有效
 * - R-QA-POST-004: 测试失败详情
 * - R-QA-POST-005: 人工验证状态收集
 * - R-QA-POST-005a: 人工验证汇总通知
 * - R-QA-POST-006: 检查点状态同步
 * - R-QA-POST-007: 测试覆盖率达标
 *
 * 设计文档: docs/investigation/hd-p13-qa-post-gate-design.md
 * 调查报告: docs/investigation/pipeline-interface-contract-mismatch-investigation-20260626.md
 *
 * @module gate-rules/qa-post-gate-rules
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GateRule, GateCheckContext } from '../../types/harness.js';
import type { CheckpointMetadata } from '../../types/task.js';
import { readTaskMeta } from '../task.js';
import { inferCheckpointAttributesFromPrefix } from '../validation-rules/checkpoint-rules.js';
import {
  executeQAPostGate,
  extractSystemBPrefix,
} from '../checkpoint-verification.js';

// ============================================================
// Helper: QA Report Loading
// ============================================================

interface QAReport {
  version: string;
  taskId: string;
  verdict: 'PASS' | 'NOPASS';
  verifiedAt: string;
  verifier: string;
  summary: string;
  testFailures?: Array<{ testName: string; reason: string; file?: string; severity: string }>;
  failedCheckpoints?: string[];
  recommendations?: string[];
  requiresHuman?: boolean;
  humanVerificationCheckpoints?: string[];
  coverage?: number;
}

function getQAReportPath(cwd: string, taskId: string): string {
  return path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
}

function loadQAReport(reportPath: string): QAReport | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    return JSON.parse(content) as QAReport;
  } catch {
    return null;
  }
}

// ============================================================
// R-QA-POST-001: QA报告存在
// ============================================================

const R_QA_POST_001: GateRule = {
  id: 'R-QA-POST-001',
  name: 'QA报告存在',
  onFailure: {
    targetPhase: 'development',
    reason: 'QA报告不存在，无法进入评估阶段',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    return fs.existsSync(reportPath);
  },
};

// ============================================================
// R-QA-POST-002: 报告格式有效
// ============================================================

const R_QA_POST_002: GateRule = {
  id: 'R-QA-POST-002',
  name: '报告格式有效',
  onFailure: {
    targetPhase: 'development',
    reason: 'QA报告格式无效，无法解析为有效JSON',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    const report = loadQAReport(reportPath);
    if (!report) return false;
    // 验证必要字段
    return !!(report.version && report.taskId && report.verdict && report.verifiedAt);
  },
};

// ============================================================
// R-QA-POST-003: 测试结果有效
// ============================================================

const R_QA_POST_003: GateRule = {
  id: 'R-QA-POST-003',
  name: '测试结果有效',
  onFailure: {
    targetPhase: 'development',
    reason: 'QA测试结果无效 (verdict 必须为 PASS 或 NOPASS)',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    const report = loadQAReport(reportPath);
    if (!report) return false;
    return report.verdict === 'PASS' || report.verdict === 'NOPASS';
  },
};

// ============================================================
// R-QA-POST-004: 测试失败详情
// ============================================================

const R_QA_POST_004: GateRule = {
  id: 'R-QA-POST-004',
  name: '测试失败详情',
  onFailure: {
    targetPhase: 'qa',
    reason: 'QA测试失败但缺少详细失败信息',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    const report = loadQAReport(reportPath);
    if (!report) return true; // 报告不存在时由001处理
    if (report.verdict === 'PASS') return true; // PASS时无需检查
    // NOPASS时必须包含testFailures
    return !!(report.testFailures && report.testFailures.length > 0);
  },
};

// ============================================================
// R-QA-POST-005: 人工验证状态收集
// ============================================================

const R_QA_POST_005: GateRule = {
  id: 'R-QA-POST-005',
  name: '人工验证状态收集',
  onFailure: {
    targetPhase: 'qa',
    reason: '存在待人工验证检查点，已收集到待验证列表',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const taskMeta = await readTaskMeta(ctx.task.id, ctx.cwd);
    if (!taskMeta?.checkpoints) return true;

    const pendingHuman: Array<{ id: string; description: string; taskId: string }> = [];

    for (const cp of taskMeta.checkpoints) {
      const requiresHuman = inferRequiresHuman(cp);
      if (requiresHuman && cp.status !== 'completed') {
        pendingHuman.push({
          id: cp.id,
          description: cp.description,
          taskId: ctx.task.id,
        });
      }
    }

    // 将待验证列表存入 sharedData（供 005a 使用）
    if (ctx.sharedData) {
      ctx.sharedData.set('pendingHumanVerifications', pendingHuman);
    }

    // INFO级别：始终通过，只收集信息
    return true;
  },
};

// ============================================================
// R-QA-POST-005a: 人工验证汇总通知
// ============================================================

const R_QA_POST_005a: GateRule = {
  id: 'R-QA-POST-005a',
  name: '人工验证汇总通知',
  onFailure: {
    targetPhase: 'qa',
    reason: '流水线退出前通知待人工验证检查点',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const pendingHuman = ctx.sharedData?.get('pendingHumanVerifications') as
      | Array<{ id: string; description: string; taskId: string }>
      | undefined;

    if (pendingHuman && pendingHuman.length > 0) {
      // 记录通知信息到 sharedData
      if (ctx.sharedData) {
        ctx.sharedData.set('humanVerificationNotification', {
          count: pendingHuman.length,
          checkpoints: pendingHuman,
          notifiedAt: new Date().toISOString(),
        });
      }
    }

    // INFO级别：始终通过
    return true;
  },
};

// ============================================================
// R-QA-POST-006: 检查点状态同步
// ============================================================

const R_QA_POST_006: GateRule = {
  id: 'R-QA-POST-006',
  name: '检查点状态同步',
  onFailure: {
    targetPhase: 'development',
    reason: 'QA结果与检查点状态不一致',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    const report = loadQAReport(reportPath);
    if (!report) return true; // 报告不存在时由001处理

    const taskMeta = await readTaskMeta(ctx.task.id, ctx.cwd);
    if (!taskMeta?.checkpoints) return true;

    // 只检查QA相关检查点
    const qaCheckpoints = taskMeta.checkpoints.filter(cp =>
      cp.category === 'qa_verification'
    );

    if (report.verdict === 'PASS') {
      // PASS时，非人工验证检查点应已完成
      for (const cp of qaCheckpoints) {
        const requiresHuman = inferRequiresHuman(cp);
        if (!requiresHuman && cp.status !== 'completed') {
          return false;
        }
      }
    }

    return true;
  },
};

// ============================================================
// R-QA-POST-007: 测试覆盖率达标
// ============================================================

/** 默认覆盖率权重 */
const DEFAULT_COVERAGE_WEIGHTS = {
  lines: 0.4,
  branches: 0.3,
  functions: 0.2,
  statements: 0.1,
};

/** 默认最小覆盖率阈值 */
const DEFAULT_MIN_COVERAGE = 0.6;

/** 覆盖率报告文件路径列表 */
const COVERAGE_FILES = [
  'coverage/coverage-summary.json',
  'coverage/lcov-report/coverage-summary.json',
  'coverage.json',
];

interface RawCoverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

function loadCoverageData(cwd: string): RawCoverage | null {
  for (const file of COVERAGE_FILES) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const data = JSON.parse(content);
      // 处理不同格式的覆盖率报告
      if (data.total) {
        return {
          lines: data.total.lines?.pct ?? 0,
          branches: data.total.branches?.pct ?? 0,
          functions: data.total.functions?.pct ?? 0,
          statements: data.total.statements?.pct ?? 0,
        };
      }
      if (typeof data.lines === 'number') {
        return {
          lines: data.lines,
          branches: data.branches ?? data.lines,
          functions: data.functions ?? data.lines,
          statements: data.statements ?? data.lines,
        };
      }
    } catch {
      // 继续尝试下一个文件
    }
  }
  return null;
}

function calculateWeightedCoverage(coverage: RawCoverage): number {
  return (
    coverage.lines * DEFAULT_COVERAGE_WEIGHTS.lines +
    coverage.branches * DEFAULT_COVERAGE_WEIGHTS.branches +
    coverage.functions * DEFAULT_COVERAGE_WEIGHTS.functions +
    coverage.statements * DEFAULT_COVERAGE_WEIGHTS.statements
  );
}

const R_QA_POST_007: GateRule = {
  id: 'R-QA-POST-007',
  name: '测试覆盖率达标',
  onFailure: {
    targetPhase: 'qa',
    reason: '测试覆盖率未达标，触发QA内部重试',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    // 优先从QA报告获取覆盖率
    const reportPath = getQAReportPath(ctx.cwd, ctx.task.id);
    const report = loadQAReport(reportPath);
    let coverageValue: number | undefined = report?.coverage;

    // 如果QA报告没有覆盖率，尝试从覆盖率报告文件获取
    if (coverageValue === undefined) {
      const rawCoverage = loadCoverageData(ctx.cwd);
      if (rawCoverage) {
        coverageValue = calculateWeightedCoverage(rawCoverage);
      }
    }

    // 如果都无法获取覆盖率，视为通过（由其他规则处理测试问题）
    if (coverageValue === undefined) return true;

    const passed = coverageValue >= DEFAULT_MIN_COVERAGE;

    if (!passed && ctx.sharedData) {
      // 存储覆盖率缺口数据到 sharedData，供调用方触发QA重试
      const gap = DEFAULT_MIN_COVERAGE - coverageValue;
      const rawCoverage = loadCoverageData(ctx.cwd);
      ctx.sharedData.set('coverageGap', {
        currentCoverage: coverageValue,
        minCoverage: DEFAULT_MIN_COVERAGE,
        gap,
        gapPercent: `${(gap * 100).toFixed(1)}%`,
        coverageDetails: rawCoverage ? {
          lines: rawCoverage.lines,
          branches: rawCoverage.branches,
          functions: rawCoverage.functions,
          statements: rawCoverage.statements,
        } : undefined,
        targetPhase: 'qa',
        message: `覆盖率不足: ${(coverageValue * 100).toFixed(1)}% < ${(DEFAULT_MIN_COVERAGE * 100).toFixed(0)}%`,
      });
    }

    return passed;
  },
};

// ============================================================
// Helper: infer requiresHuman from checkpoint metadata
// ============================================================

function inferRequiresHuman(cp: CheckpointMetadata): boolean {
  // 显式设置
  if (cp.requiresHuman === true) return true;
  if (cp.requiresHuman === false) return false;

  // null/undefined: 根据描述前缀推断
  const prefix = cp.description?.toLowerCase() ?? '';
  if (prefix.startsWith('[human qa]') || prefix.startsWith('[human]')) {
    return true;
  }

  // 使用 checkpoint-rules 中的推断逻辑
  const inferred = inferCheckpointAttributesFromPrefix(cp.description);
  return inferred.requiresHuman ?? false;
}

// ============================================================
// R-QA-POST-008: B类门禁验证 (CP-008)
// ============================================================

/**
 * CP-008 B类门禁规则
 * 验证 [ai qa]/[human qa] 检查点产出是否符合 expected
 */
const R_QA_POST_008: GateRule = {
  id: 'R-QA-POST-008',
  name: 'B类门禁验证',
  onFailure: {
    targetPhase: 'qa',
    reason: 'QA B类门禁验证失败：产出不符合预期',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const taskMeta = ctx.task;
    if (!taskMeta?.checkpoints?.length) return true; // 无检查点则跳过

    // 筛选 qa 相关检查点
    const qaCheckpoints = taskMeta.checkpoints.filter(cp => {
      const prefix = extractSystemBPrefix(cp.description);
      return prefix === 'ai-qa' || prefix === 'human-qa';
    });

    if (qaCheckpoints.length === 0) return true; // 无相关检查点则跳过

    // 从 phaseResult 获取 QA 结果
    // QAVerdict 包含: result, reason, testFiles, coverage, details
    const verdict = ctx.phaseResult as {
      testFiles?: string[];
      coverage?: number;
      passed?: boolean;
      summary?: string;
      result?: string;
      reason?: string;
      details?: string;
    } | undefined;

    if (!verdict) return true; // 无阶段结果则跳过

    // 适配到 executeQAPostGate 期望的格式
    const adaptedVerdict = {
      testFiles: verdict.testFiles,
      coverage: verdict.coverage,
      passed: verdict.passed ?? verdict.result === 'PASS',
      summary: verdict.summary ?? verdict.details ?? verdict.reason,
    };

    // 执行 B 类门禁
    const postGateResult = await executeQAPostGate(
      adaptedVerdict,
      qaCheckpoints,
      ctx.cwd
    );

    // 存储结果到 sharedData 供后续同步使用
    if (ctx.sharedData) {
      ctx.sharedData.set('qaPostGateResult', postGateResult);
    }

    return postGateResult.passed;
  },
};

// ============================================================
// Rule Collection Export
// ============================================================

/**
 * QA Post-Gate 规则集合
 * 按优先级排序 (001 -> 008)
 */
export const QA_POST_GATE_RULES: GateRule[] = [
  R_QA_POST_001,
  R_QA_POST_002,
  R_QA_POST_003,
  R_QA_POST_004,
  R_QA_POST_005,
  R_QA_POST_005a,
  R_QA_POST_006,
  R_QA_POST_007,
  R_QA_POST_008,
];

/**
 * QA Post-Gate 规则集合（严格模式）
 * 包含所有规则，包括可选规则
 */
export const QA_POST_GATE_RULES_STRICT: GateRule[] = QA_POST_GATE_RULES;

/**
 * QA Post-Gate 规则集合（宽松模式）
 * 只包含阻塞性规则（001, 002, 003, 006）
 */
export const QA_POST_GATE_RULES_MINIMAL: GateRule[] = [
  R_QA_POST_001,
  R_QA_POST_002,
  R_QA_POST_003,
  R_QA_POST_006,
];
