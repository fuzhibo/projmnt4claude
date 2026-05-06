/**
 * PhaseHistoryCompleteChecker
 * 阶段历史完整性检查器
 *
 * R-EVAL-PRE-006: phaseHistory 包含必要阶段
 *
 * 检查逻辑:
 * 1. 从任务 phaseHistory 中提取所有已执行阶段名
 * 2. 对比必要阶段列表 (development, code_review, qa)
 * 3. 缺少的阶段作为警告返回（非阻塞）
 *
 * 设计文档: docs/investigation/hd-p14-evaluation-pre-gate-design.md
 * 规则: R-EVAL-PRE-006 (WARNING level)
 *
 * @module pre-eval-gate/checkers/phase-history-checker
 */

import type { PreEvalCheckContext, PreEvalCheckResult, IPreEvalChecker } from '../types.js';

/**
 * 阶段历史完整性检查器
 *
 * 验证任务的 phaseHistory 是否包含所有必要阶段。
 * 缺少阶段仅产生警告，不阻塞评估阶段进入。
 */
export class PhaseHistoryCompleteChecker implements IPreEvalChecker {
  private readonly requiredPhases = ['development', 'code_review', 'qa'];

  /**
   * 执行阶段历史完整性检查
   *
   * @param ctx 检查上下文
   * @returns 检查结果，包含缺失阶段列表
   */
  async check(ctx: PreEvalCheckContext): Promise<PreEvalCheckResult> {
    const { task } = ctx;
    const historyPhases = (task.phaseHistory || []).map(h => h.phase);
    const missing = this.requiredPhases.filter(p => !historyPhases.includes(p));

    return {
      ruleId: 'R-EVAL-PRE-006',
      passed: missing.length === 0,
      severity: 'WARNING',
      message: missing.length === 0
        ? '阶段历史完整'
        : `缺少阶段历史: ${missing.join(', ')}`,
      details: {
        requiredPhases: this.requiredPhases,
        historyPhases,
        missingPhases: missing,
      },
    };
  }
}
