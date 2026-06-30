/**
 * Evaluation Post-Gate Rules
 * 评估阶段后质量门禁规则集合
 *
 * CP-008: 集成 B 类门禁验证产出
 * - R-EVAL-POST-009: B类门禁验证（调用 executeEvaluationPostGate）
 *
 * @module gate-rules/eval-post-gate-rules
 */

import type { GateRule, GateCheckContext } from '../../types/harness.js';
import {
  executeEvaluationPostGate,
  extractSystemBPrefix,
} from '../checkpoint-verification.js';

// ============================================================
// R-EVAL-POST-009: B类门禁验证
// ============================================================

/**
 * CP-008 B类门禁规则
 * 验证 [script] 检查点产出是否符合 expected
 */
const R_EVAL_POST_009: GateRule = {
  id: 'R-EVAL-POST-009',
  name: 'B类门禁验证',
  onFailure: {
    targetPhase: 'evaluation',
    reason: 'Evaluation B类门禁验证失败：产出不符合预期',
  },
  check: async (ctx: GateCheckContext): Promise<boolean> => {
    const taskMeta = ctx.task;
    if (!taskMeta?.checkpoints?.length) return true; // 无检查点则跳过

    // 筛选 evaluation 相关检查点（script 前缀）
    const evalCheckpoints = taskMeta.checkpoints.filter(cp => {
      const prefix = extractSystemBPrefix(cp.description);
      return prefix === 'script';
    });

    if (evalCheckpoints.length === 0) return true; // 无相关检查点则跳过

    // 从 phaseResult 获取评估结果
    // EvaluationVerdict 包含: result, reason, evalFiles, reportPath, conclusion, details
    const verdict = ctx.phaseResult as {
      evalFiles?: string[];
      reportPath?: string;
      summary?: string;
      conclusion?: string;
      result?: string;
      reason?: string;
      details?: string;
    } | undefined;

    if (!verdict) return true; // 无阶段结果则跳过

    // 适配到 executeEvaluationPostGate 期望的格式
    const adaptedVerdict = {
      evalFiles: verdict.evalFiles,
      reportPath: verdict.reportPath,
      summary: verdict.summary ?? verdict.details ?? verdict.reason,
      conclusion: verdict.conclusion ?? verdict.result,
    };

    // 执行 B 类门禁
    const postGateResult = await executeEvaluationPostGate(
      adaptedVerdict,
      evalCheckpoints,
      ctx.cwd
    );

    // 存储结果到 sharedData 供后续同步使用
    if (ctx.sharedData) {
      ctx.sharedData.set('evalPostGateResult', postGateResult);
    }

    return postGateResult.passed;
  },
};

// ============================================================
// Rule Collection Export
// ============================================================

/**
 * Evaluation Post-Gate 规则集合
 * 仅包含 B 类门禁规则（A 类规则在 hd-assembly-line.ts 中定义）
 */
export const EVAL_POST_GATE_RULES_B: GateRule[] = [
  R_EVAL_POST_009,
];
