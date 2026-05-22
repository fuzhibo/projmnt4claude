/**
 * Quality Score Types
 * 代码审核质量分数类型定义
 *
 * 职责:
 * - 定义质量分数的多维度评分结构
 * - 支持五个维度的质量评分：正确性、可读性、可维护性、测试覆盖率、安全性
 * - 为 Post-CR Gate 提供量化评估能力
 *
 * @module quality-score
 */

/**
 * 质量分数维度
 */
export type QualityScoreDimension =
  | 'correctness'    // 正确性：代码逻辑是否正确
  | 'readability'    // 可读性：代码是否易于理解
  | 'maintainability' // 可维护性：代码是否易于维护
  | 'testCoverage'   // 测试覆盖率：测试是否充分
  | 'security';      // 安全性：代码是否存在安全风险

/**
 * 单个维度的评分详情
 */
export interface DimensionScore {
  /** 维度名称 */
  dimension: QualityScoreDimension;
  /** 分数 (0-100) */
  score: number;
  /** 评分理由 */
  reason: string;
  /** 发现的问题列表 */
  issues?: string[];
  /** 改进建议 */
  suggestions?: string[];
}

/**
 * 代码审核质量分数
 * 由 AI 审核型检查器生成，供 Post-CR Gate 验证
 */
export interface CodeReviewQualityScore {
  /** 总分 (0-100)，加权平均 */
  totalScore: number;
  /** 各维度评分详情 */
  dimensions: DimensionScore[];
  /** 评分时间戳 */
  scoredAt: string;
  /** 评分者 (通常为 'ai_reviewer') */
  scoredBy: string;
  /** 评分依据摘要 */
  summary: string;
  /** 是否达到最低分数要求 */
  meetsMinimum: boolean;
  /** 最低分数阈值 */
  minimumThreshold: number;
}

/**
 * 质量分数检查器配置
 */
export interface QualityScoreCheckerConfig {
  /** 最低质量分数阈值 (0-100) */
  minScore: number;
  /** 各维度权重配置 */
  dimensionWeights: Record<QualityScoreDimension, number>;
  /** 是否启用 AI 审核 */
  enableAIReview: boolean;
  /** AI 审核超时时间 (毫秒) */
  aiReviewTimeout: number;
  /** 是否在低分时阻塞 */
  blockingOnLowScore: boolean;
}

/**
 * 默认维度权重配置
 * 权重总和应为 1.0
 */
export const DEFAULT_DIMENSION_WEIGHTS: Record<QualityScoreDimension, number> = {
  correctness: 0.30,      // 正确性权重最高
  readability: 0.20,      // 可读性次之
  maintainability: 0.20,  // 可维护性
  testCoverage: 0.15,     // 测试覆盖率
  security: 0.15,         // 安全性
};

/**
 * 默认质量分数检查器配置
 */
export const DEFAULT_QUALITY_SCORE_CHECKER_CONFIG: QualityScoreCheckerConfig = {
  minScore: 60,
  dimensionWeights: DEFAULT_DIMENSION_WEIGHTS,
  enableAIReview: true,
  aiReviewTimeout: 60000, // 60 秒
  blockingOnLowScore: false,
};

/**
 * 质量分数检查结果
 */
export interface QualityScoreCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 检查项名称 */
  check: string;
  /** 结果消息 */
  message: string;
  /** 质量分数详情 */
  score?: CodeReviewQualityScore;
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * AI 审核请求上下文
 */
export interface AIReviewContext {
  /** 任务 ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 任务元数据 */
  task: import('./task.js').TaskMeta;
  /** 开发报告 */
  devReport?: import('./harness.js').DevReport;
  /** 代码审核结果 */
  codeReviewVerdict?: import('./harness.js').CodeReviewVerdict;
  /** 变更文件列表 */
  changedFiles?: string[];
}

/**
 * AI 审核响应
 */
export interface AIReviewResponse {
  /** 是否成功 */
  success: boolean;
  /** 质量分数 */
  score?: CodeReviewQualityScore;
  /** 错误信息 */
  error?: string;
  /** 原始输出 */
  rawOutput?: string;
}

/**
 * 计算加权总分
 */
export function calculateWeightedTotalScore(
  dimensions: DimensionScore[],
  weights: Record<QualityScoreDimension, number> = DEFAULT_DIMENSION_WEIGHTS
): number {
  if (dimensions.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const dim of dimensions) {
    const weight = weights[dim.dimension] ?? 0;
    weightedSum += dim.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  return Math.round(weightedSum / totalWeight);
}

/**
 * 检查分数是否达标
 */
export function isScoreAcceptable(
  score: CodeReviewQualityScore,
  minScore: number
): boolean {
  return score.totalScore >= minScore;
}

/**
 * 创建默认质量分数
 * 用于初始化或错误回退场景
 */
export function createDefaultQualityScore(
  taskId: string,
  reason: string
): CodeReviewQualityScore {
  const now = new Date().toISOString();
  const defaultDimensions: DimensionScore[] = [
    { dimension: 'correctness', score: 0, reason: '未评分' },
    { dimension: 'readability', score: 0, reason: '未评分' },
    { dimension: 'maintainability', score: 0, reason: '未评分' },
    { dimension: 'testCoverage', score: 0, reason: '未评分' },
    { dimension: 'security', score: 0, reason: '未评分' },
  ];

  return {
    totalScore: 0,
    dimensions: defaultDimensions,
    scoredAt: now,
    scoredBy: 'default',
    summary: reason,
    meetsMinimum: false,
    minimumThreshold: 60,
  };
}
