/**
 * 共享矛盾检测与质量评估映射 (IR-08-04, IR-08-05)
 *
 * 提取自 harness-evaluator.ts 的矛盾检测逻辑，供评估、QA、analyze 共用。
 *
 * 功能：
 * 1. detectContradiction: 检测结果标签与内容的矛盾 (IR-08-05)
 * 2. qualityScoreToVerdict: 质量评分 (0-100) → PASS/NOPASS 映射 (IR-08-04)
 */

// ============== 矛盾检测 ==============

/**
 * 矛盾检测结果
 */
export interface ContradictionResult {
  /** 是否检测到矛盾 */
  hasContradiction: boolean;
  /** 修正后的结果 */
  correctedResult?: 'PASS' | 'NOPASS';
  /** 原始结果 */
  originalResult?: 'PASS' | 'NOPASS';
  /** 修正原因 */
  reason?: string;
}

/** 正向指标：暗示 PASS */
const PASS_INDICATORS = [
  /\b(?:all|every)\s+(?:criteria|standards|requirements|checkpoints?|tests?)\s+(?:met|satisfied|passed|fulfilled|completed|achieved)\b/i,
  /\b(?:successfully\s+)?(?:implemented|completed|verified|passed|satisfied)\b/i,
  /\b(?:good\s+quality|well\s+implemented|code\s+is\s+clean|works?\s+correctly)\b/i,
  /\b(?:验收标准|检查点|所有)\s*(?:已|均|都)?\s*(?:满足|通过|完成|达成)\b/,
  /\b(?:代码质量|实现)\s*(?:良好|优秀|完整|清晰|正确)\b/,
];

/** 负向指标：暗示 NOPASS */
const NOPASS_INDICATORS = [
  /\b(?:fail(?:ed)?|missing|incomplete|error|bug|issue|problem|defect|broken)\b/i,
  /\b(?:不满足|未通过|未完成|缺失|错误|问题|失败|遗漏|不正确)\b/,
  /\b(?:not\s+(?:met|satisfied|passed|implemented|completed|working))\b/i,
];

/**
 * 检测结果标签与内容之间的矛盾
 *
 * 当结果标记为 NOPASS 但内容全是正向描述时，自动修正为 PASS；
 * 反之亦然。
 *
 * @param resultLabel - 标记的结果 (PASS / NOPASS)
 * @param content - 详细内容
 * @returns 矛盾检测结果
 */
export function detectContradiction(
  resultLabel: 'PASS' | 'NOPASS',
  content: string,
): ContradictionResult {
  if (!content || content.trim().length === 0) {
    return { hasContradiction: false };
  }

  const passScore = PASS_INDICATORS.reduce((score, pattern) => {
    const matches = content.match(pattern);
    return score + (matches ? matches.length : 0);
  }, 0);

  const nopassScore = NOPASS_INDICATORS.reduce((score, pattern) => {
    const matches = content.match(pattern);
    return score + (matches ? matches.length : 0);
  }, 0);

  // 强矛盾：说 NOPASS 但内容完全是正向的
  if (resultLabel === 'NOPASS' && passScore >= 3 && nopassScore === 0) {
    return {
      hasContradiction: true,
      originalResult: 'NOPASS',
      correctedResult: 'PASS',
      reason: `内容指示通过 (${passScore} 个正向指标, 0 个负向指标), 但结果标记为 NOPASS`,
    };
  }

  // 强矛盾：说 PASS 但内容描述了失败
  if (resultLabel === 'PASS' && nopassScore >= 3 && passScore === 0) {
    return {
      hasContradiction: true,
      originalResult: 'PASS',
      correctedResult: 'NOPASS',
      reason: `内容指示未通过 (${nopassScore} 个负向指标, 0 个正向指标), 但结果标记为 PASS`,
    };
  }

  return { hasContradiction: false };
}

// ============== 质量评分映射 ==============

/**
 * 将质量评分 (0-100) 映射到 PASS/NOPASS 判定
 *
 * 对齐 analyze.ts 的 calculateContentQuality 输出
 * 与 harness-evaluator 的 PASS/NOPASS 二元判定 (IR-08-04)。
 *
 * @param score - 质量评分 (0-100)
 * @param minScore - 最低通过阈值 (默认 60，可通过 quality.minScore 配置)
 * @returns PASS 或 NOPASS
 */
export function qualityScoreToVerdict(
  score: number,
  minScore: number = 60,
): 'PASS' | 'NOPASS' {
  return score >= minScore ? 'PASS' : 'NOPASS';
}

/**
 * 获取配置的质量最低阈值
 *
 * 从项目配置 quality.minScore 读取，默认 60。
 * 支持 `config set quality.minScore 70` 动态调整。
 */
export function getQualityMinScore(cwd?: string): number {
  try {
    // 延迟导入避免循环依赖
    const { readConfig } = require('../commands/config.js');
    const config = readConfig(cwd);
    if (config) {
      const quality = config.quality as Record<string, unknown> | undefined;
      if (quality && typeof quality.minScore === 'number') {
        const val = quality.minScore;
        if (val >= 0 && val <= 100) return val;
      }
    }
  } catch {
    // 配置读取失败时使用默认值
  }
  return 60;
}
