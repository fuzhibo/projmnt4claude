/**
 * AI 元数据输出验证规则集
 *
 * 为 AIMetadataAssistant 的各 AI 调用方法提供结构化输出验证，
 * 确保返回的 JSON 包含必需字段且类型正确。
 *
 * 规则作用于原始字符串输出（JSON），在 FeedbackConstraintEngine 的
 * jsonParseableRule / nonEmptyOutputRule 之上叠加业务字段校验。
 */

import type {
  ValidationRule,
  ValidationViolation,
} from '../../types/feedback-constraint.js';
import { checkpointValidationRules } from './checkpoint-rules.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 安全解析 JSON 字符串
 * 返回 null 表示非 JSON 或解析失败（由 jsonParseableRule 处理）
 */
function safeParseJson(output: unknown): Record<string, unknown> | null {
  if (typeof output !== 'string') return null;
  try {
    let text = output.trim();
    // 去除 markdown 代码块包裹
    const match = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (match) text = match[1]!.trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 检查必需字段缺失 */
function checkRequiredFields(
  output: unknown,
  ruleId: string,
  contextName: string,
  fields: string[],
): ValidationViolation | null {
  const parsed = safeParseJson(output);
  if (!parsed) return null; // JSON 解析失败由 jsonParseableRule 处理

  const missing = fields.filter(f => !(f in parsed));
  if (missing.length > 0) {
    return {
      ruleId,
      severity: 'error',
      message: `${contextName}缺少必需字段: ${missing.join(', ')}`,
    };
  }
  return null;
}

// ============================================================
// enhanceRequirement 输出规则
// ============================================================

/**
 * 需求增强输出必须包含 title, type, priority, checkpoints 字段
 */
export const requirementRequiredFields: ValidationRule = {
  id: 'requirement-required-fields',
  description: '需求增强输出必须包含 title, type, priority, checkpoints 字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    return checkRequiredFields(
      output,
      'requirement-required-fields',
      '需求输出',
      ['title', 'type', 'priority', 'checkpoints'],
    );
  },
};

/**
 * title 长度必须在 10-50 字符范围内
 */
export const requirementTitleRange: ValidationRule = {
  id: 'requirement-title-range',
  description: 'title 长度必须在 10-50 字符范围内',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('title' in parsed)) return null;
    const title = parsed.title;
    if (title === null || title === undefined) return null;
    if (typeof title !== 'string') return null;
    if (title.length < 10 || title.length > 50) {
      return {
        ruleId: 'requirement-title-range',
        severity: 'warning',
        message: `title 长度 ${title.length} 不在 10-50 范围内`,
        value: title,
      };
    }
    return null;
  },
};

/**
 * type 必须是有效枚举值 (bug/feature/research/docs/refactor/test/null)
 */
export const requirementTypeEnum: ValidationRule = {
  id: 'requirement-type-enum',
  description: 'type 必须是 bug/feature/research/docs/refactor/test/null 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('type' in parsed)) return null;
    const validTypes = ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null];
    if (!validTypes.includes(parsed.type as string | null)) {
      return {
        ruleId: 'requirement-type-enum',
        severity: 'warning',
        message: `type 值 "${parsed.type}" 不是有效枚举值`,
        value: String(parsed.type),
      };
    }
    return null;
  },
};

/**
 * priority 必须是有效枚举值 (P0/P1/P2/P3/null)
 */
export const requirementPriorityEnum: ValidationRule = {
  id: 'requirement-priority-enum',
  description: 'priority 必须是 P0/P1/P2/P3/null 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('priority' in parsed)) return null;
    const validPriorities = ['P0', 'P1', 'P2', 'P3', null];
    if (!validPriorities.includes(parsed.priority as string | null)) {
      return {
        ruleId: 'requirement-priority-enum',
        severity: 'warning',
        message: `priority 值 "${parsed.priority}" 不是有效枚举值`,
        value: String(parsed.priority),
      };
    }
    return null;
  },
};

/**
 * checkpoints 必须是数组类型
 */
export const requirementCheckpointsArray: ValidationRule = {
  id: 'requirement-checkpoints-array',
  description: 'checkpoints 必须是数组类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('checkpoints' in parsed)) return null;
    if (parsed.checkpoints !== null && !Array.isArray(parsed.checkpoints)) {
      return {
        ruleId: 'requirement-checkpoints-array',
        severity: 'warning',
        message: `checkpoints 不是数组类型，实际类型: ${typeof parsed.checkpoints}`,
        value: String(parsed.checkpoints),
      };
    }
    return null;
  },
};

// ============================================================
// analyzeTaskQuality 输出规则
// ============================================================

/**
 * 质量评估输出必须包含 score, issues, suggestions 字段
 */
export const qualityRequiredFields: ValidationRule = {
  id: 'quality-required-fields',
  description: '质量评估输出必须包含 score, issues, suggestions 字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    return checkRequiredFields(
      output,
      'quality-required-fields',
      '质量评估输出',
      ['score', 'issues', 'suggestions'],
    );
  },
};

/**
 * score 必须是 0-100 范围内的数字
 */
export const qualityScoreRange: ValidationRule = {
  id: 'quality-score-range',
  description: 'score 必须是 0-100 范围内的数字',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('score' in parsed)) return null;
    const score = parsed.score;
    if (typeof score !== 'number' || score < 0 || score > 100) {
      return {
        ruleId: 'quality-score-range',
        severity: 'warning',
        message: `score 值 "${score}" 不在 0-100 范围内`,
        value: String(score),
      };
    }
    return null;
  },
};

// ============================================================
// detectDuplicates 输出规则
// ============================================================

/**
 * 重复检测输出必须包含 duplicates 数组字段
 */
export const duplicatesRequiredFields: ValidationRule = {
  id: 'duplicates-required-fields',
  description: '重复检测输出必须包含 duplicates 数组字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed) return null;
    if (!('duplicates' in parsed) || !Array.isArray(parsed.duplicates)) {
      return {
        ruleId: 'duplicates-required-fields',
        severity: 'error',
        message: '重复检测输出缺少 duplicates 数组字段',
      };
    }
    return null;
  },
};

// ============================================================
// assessStaleness 输出规则
// ============================================================

/**
 * 陈旧评估输出必须包含 isStale, stalenessScore, suggestedAction, reason 字段
 */
export const stalenessRequiredFields: ValidationRule = {
  id: 'staleness-required-fields',
  description: '陈旧评估输出必须包含 isStale, stalenessScore, suggestedAction, reason 字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    return checkRequiredFields(
      output,
      'staleness-required-fields',
      '陈旧评估输出',
      ['isStale', 'stalenessScore', 'suggestedAction', 'reason'],
    );
  },
};

// ============================================================
// analyzeBugReport 输出规则
// ============================================================

/**
 * Bug 报告分析输出必须包含 title, description, checkpoints 字段
 */
export const bugReportRequiredFields: ValidationRule = {
  id: 'bug-report-required-fields',
  description: 'Bug 报告分析输出必须包含 title, description, checkpoints 字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    return checkRequiredFields(
      output,
      'bug-report-required-fields',
      'Bug 报告分析输出',
      ['title', 'description', 'checkpoints'],
    );
  },
};

// ============================================================
// 按方法分组的规则集
// ============================================================

/** enhanceRequirement 方法验证规则 */
export const requirementOutputRules: ValidationRule[] = [
  requirementRequiredFields,
  requirementTitleRange,
  requirementTypeEnum,
  requirementPriorityEnum,
  requirementCheckpointsArray,
  ...checkpointValidationRules,
];

/** analyzeTaskQuality 方法验证规则 */
export const qualityOutputRules: ValidationRule[] = [qualityRequiredFields, qualityScoreRange];

/** detectDuplicates 方法验证规则 */
export const duplicatesOutputRules: ValidationRule[] = [duplicatesRequiredFields];

/** assessStaleness 方法验证规则 */
export const stalenessOutputRules: ValidationRule[] = [stalenessRequiredFields];

/** analyzeBugReport 方法验证规则 */
export const bugReportOutputRules: ValidationRule[] = [bugReportRequiredFields];
