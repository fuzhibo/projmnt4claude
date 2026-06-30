/**
 * Code Review Post-Gate Rules
 * 代码审查阶段后质量门禁规则集合
 *
 * CP-008: 集成 B 类门禁验证产出
 * - R-CR-POST-011: B类门禁验证（调用 executeCodeReviewPostGate）
 *
 * @module gate-rules/cr-post-gate-rules
 */

import type { GateRule, GateCheckContext } from '../../types/harness.js';
import type { CodeReviewVerdict } from '../../types/harness.js';
import {
  executeCodeReviewPostGate,
  extractSystemBPrefix,
} from '../checkpoint-verification.js';

// ============================================================
// Helper: Get CodeReview Verdict from phaseResult
// ============================================================

function getCodeReviewVerdict(ctx: GateCheckContext): CodeReviewVerdict | null {
  const verdict = ctx.phaseResult as CodeReviewVerdict | undefined;
  if (!verdict) return null;
  return verdict;
}

// ============================================================
// R-CR-POST-011: B类门禁验证
// ============================================================

/**
 * CP-008 B类门禁规则
 * 验证 [ai review] 检查点产出是否符合 expected
 */
const R_CR_POST_011: GateRule = {
  id: 'R-CR-POST-011',
  name: 'B类门禁验证',
  onFailure: {
    targetPhase: 'code_review',
    reason: 'Code Review B类门禁验证失败：产出不符合预期',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const taskMeta = ctx.task;
    if (!taskMeta?.checkpoints?.length) return true; // 无检查点则跳过

    // 筛选 code_review 相关检查点
    const reviewCheckpoints = taskMeta.checkpoints.filter(cp => {
      const prefix = extractSystemBPrefix(cp.description);
      return prefix === 'ai-review';
    });

    if (reviewCheckpoints.length === 0) return true; // 无相关检查点则跳过

    const verdict = getCodeReviewVerdict(ctx);
    if (!verdict) return true; // 无阶段结果则跳过

    // 适配 CodeReviewVerdict 到 executeCodeReviewPostGate 期望的格式
    // CodeReviewVerdict 包含: result, reason, codeQualityIssues, failedCheckpoints, details
    const adaptedVerdict = {
      // 使用 codeQualityIssues 作为审查的文件/问题列表
      filesReviewed: verdict.codeQualityIssues,
      // reportPath 可从 details 或其他字段推断（如果存在）
      reportPath: undefined as string | undefined,
      summary: verdict.details ?? verdict.reason,
    };

    // 执行 B 类门禁
    const postGateResult = await executeCodeReviewPostGate(
      adaptedVerdict,
      reviewCheckpoints,
      ctx.cwd
    );

    // 存储结果到 sharedData 供后续同步使用
    if (ctx.sharedData) {
      ctx.sharedData.set('crPostGateResult', postGateResult);
    }

    return postGateResult.passed;
  },
};

// ============================================================
// Rule Collection Export
// ============================================================

/**
 * Code Review Post-Gate 规则集合
 * 仅包含 B 类门禁规则（A 类规则在 hd-assembly-line.ts 中定义）
 */
export const CR_POST_GATE_RULES_B: GateRule[] = [
  R_CR_POST_011,
];