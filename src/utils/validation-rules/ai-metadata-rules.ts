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

/**
 * issues 必须是数组类型
 */
export const qualityIssuesArrayType: ValidationRule = {
  id: 'quality-issues-array-type',
  description: 'issues 必须是数组类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('issues' in parsed)) return null;
    if (parsed.issues !== null && !Array.isArray(parsed.issues)) {
      return {
        ruleId: 'quality-issues-array-type',
        severity: 'warning',
        message: `issues 不是数组类型，实际类型: ${typeof parsed.issues}`,
        value: String(parsed.issues),
      };
    }
    return null;
  },
};

/**
 * issues 中每个元素必须包含 field, severity, message 字段且 severity 为有效枚举值
 */
export const qualityIssuesItemStructure: ValidationRule = {
  id: 'quality-issues-item-structure',
  description: 'issues 中每个元素必须包含 field, severity, message 且 severity 为 error/warning/info 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('issues' in parsed) || !Array.isArray(parsed.issues)) return null;
    const validSeverities = ['error', 'warning', 'info'];
    for (let i = 0; i < parsed.issues.length; i++) {
      const item = parsed.issues[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        return {
          ruleId: 'quality-issues-item-structure',
          severity: 'warning',
          message: `issues[${i}] 不是对象类型`,
          value: String(item),
        };
      }
      const missing = ['field', 'severity', 'message'].filter(f => !(f in item));
      if (missing.length > 0) {
        return {
          ruleId: 'quality-issues-item-structure',
          severity: 'warning',
          message: `issues[${i}] 缺少必需字段: ${missing.join(', ')}`,
        };
      }
      if (typeof item.severity === 'string' && !validSeverities.includes(item.severity)) {
        return {
          ruleId: 'quality-issues-item-structure',
          severity: 'warning',
          message: `issues[${i}].severity 值 "${item.severity}" 不是有效枚举值 (error/warning/info)`,
          value: String(item.severity),
        };
      }
    }
    return null;
  },
};

/**
 * suggestions 必须是字符串数组类型
 */
export const qualitySuggestionsArrayType: ValidationRule = {
  id: 'quality-suggestions-array-type',
  description: 'suggestions 必须是字符串数组类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('suggestions' in parsed)) return null;
    if (parsed.suggestions !== null && !Array.isArray(parsed.suggestions)) {
      return {
        ruleId: 'quality-suggestions-array-type',
        severity: 'warning',
        message: `suggestions 不是数组类型，实际类型: ${typeof parsed.suggestions}`,
        value: String(parsed.suggestions),
      };
    }
    if (Array.isArray(parsed.suggestions)) {
      for (let i = 0; i < parsed.suggestions.length; i++) {
        if (typeof parsed.suggestions[i] !== 'string') {
          return {
            ruleId: 'quality-suggestions-array-type',
            severity: 'warning',
            message: `suggestions[${i}] 不是字符串类型，实际类型: ${typeof parsed.suggestions[i]}`,
            value: String(parsed.suggestions[i]),
          };
        }
      }
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

/**
 * duplicates 数组中每个元素必须包含 taskIds 和 similarity 字段
 */
export const duplicatesItemRequiredFields: ValidationRule = {
  id: 'duplicates-item-required-fields',
  description: 'duplicates 中每个元素必须包含 taskIds 和 similarity 字段',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('duplicates' in parsed) || !Array.isArray(parsed.duplicates)) return null;
    for (let i = 0; i < parsed.duplicates.length; i++) {
      const item = parsed.duplicates[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        return {
          ruleId: 'duplicates-item-required-fields',
          severity: 'warning',
          message: `duplicates[${i}] 不是对象类型`,
          value: String(item),
        };
      }
      const missing = ['taskIds', 'similarity'].filter(f => !(f in item));
      if (missing.length > 0) {
        return {
          ruleId: 'duplicates-item-required-fields',
          severity: 'warning',
          message: `duplicates[${i}] 缺少必需字段: ${missing.join(', ')}`,
        };
      }
    }
    return null;
  },
};

/**
 * taskIds 必须是包含至少 2 个字符串的数组
 */
export const duplicatesTaskIdsValidation: ValidationRule = {
  id: 'duplicates-taskids-validation',
  description: 'taskIds 必须是包含至少 2 个字符串的数组',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('duplicates' in parsed) || !Array.isArray(parsed.duplicates)) return null;
    for (let i = 0; i < parsed.duplicates.length; i++) {
      const item = parsed.duplicates[i] as Record<string, unknown>;
      if (!item || !('taskIds' in item)) continue;
      const taskIds = item.taskIds;
      if (!Array.isArray(taskIds)) {
        return {
          ruleId: 'duplicates-taskids-validation',
          severity: 'warning',
          message: `duplicates[${i}].taskIds 不是数组类型，实际类型: ${typeof taskIds}`,
          value: String(taskIds),
        };
      }
      if (taskIds.length < 2) {
        return {
          ruleId: 'duplicates-taskids-validation',
          severity: 'warning',
          message: `duplicates[${i}].taskIds 长度 ${taskIds.length} 小于最小值 2`,
          value: JSON.stringify(taskIds),
        };
      }
      for (let j = 0; j < taskIds.length; j++) {
        if (typeof taskIds[j] !== 'string') {
          return {
            ruleId: 'duplicates-taskids-validation',
            severity: 'warning',
            message: `duplicates[${i}].taskIds[${j}] 不是字符串类型`,
            value: String(taskIds[j]),
          };
        }
      }
    }
    return null;
  },
};

/**
 * similarity 必须是 0-1 范围内的数字
 */
export const duplicatesSimilarityRange: ValidationRule = {
  id: 'duplicates-similarity-range',
  description: 'similarity 必须是 0-1 范围内的数字',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('duplicates' in parsed) || !Array.isArray(parsed.duplicates)) return null;
    for (let i = 0; i < parsed.duplicates.length; i++) {
      const item = parsed.duplicates[i] as Record<string, unknown>;
      if (!item || !('similarity' in item)) continue;
      const sim = item.similarity;
      if (typeof sim !== 'number' || sim < 0 || sim > 1) {
        return {
          ruleId: 'duplicates-similarity-range',
          severity: 'warning',
          message: `duplicates[${i}].similarity 值 "${sim}" 不在 0-1 范围内`,
          value: String(sim),
        };
      }
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

/**
 * isStale 必须是布尔类型
 */
export const stalenessIsStaleType: ValidationRule = {
  id: 'staleness-is-stale-type',
  description: 'isStale 必须是布尔类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('isStale' in parsed)) return null;
    if (typeof parsed.isStale !== 'boolean') {
      return {
        ruleId: 'staleness-is-stale-type',
        severity: 'warning',
        message: `isStale 不是布尔类型，实际类型: ${typeof parsed.isStale}`,
        value: String(parsed.isStale),
      };
    }
    return null;
  },
};

/**
 * stalenessScore 必须是 0-1 范围内的数字
 */
export const stalenessScoreRange: ValidationRule = {
  id: 'staleness-score-range',
  description: 'stalenessScore 必须是 0-1 范围内的数字',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('stalenessScore' in parsed)) return null;
    const score = parsed.stalenessScore;
    if (typeof score !== 'number' || score < 0 || score > 1) {
      return {
        ruleId: 'staleness-score-range',
        severity: 'warning',
        message: `stalenessScore 值 "${score}" 不在 0-1 范围内`,
        value: String(score),
      };
    }
    return null;
  },
};

/**
 * suggestedAction 必须是有效枚举值 (keep/close/update/split)
 */
export const stalenessActionEnum: ValidationRule = {
  id: 'staleness-action-enum',
  description: 'suggestedAction 必须是 keep/close/update/split 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('suggestedAction' in parsed)) return null;
    const validActions = ['keep', 'close', 'update', 'split'];
    if (!validActions.includes(parsed.suggestedAction as string)) {
      return {
        ruleId: 'staleness-action-enum',
        severity: 'warning',
        message: `suggestedAction 值 "${parsed.suggestedAction}" 不是有效枚举值 (keep/close/update/split)`,
        value: String(parsed.suggestedAction),
      };
    }
    return null;
  },
};

/**
 * reason 必须是字符串类型
 */
export const stalenessReasonType: ValidationRule = {
  id: 'staleness-reason-type',
  description: 'reason 必须是字符串类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('reason' in parsed)) return null;
    if (typeof parsed.reason !== 'string') {
      return {
        ruleId: 'staleness-reason-type',
        severity: 'warning',
        message: `reason 不是字符串类型，实际类型: ${typeof parsed.reason}`,
        value: String(parsed.reason),
      };
    }
    return null;
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

/**
 * type 必须是有效枚举值 (bug/feature/research/docs/refactor/test/null)
 */
export const bugReportTypeEnum: ValidationRule = {
  id: 'bug-report-type-enum',
  description: 'type 必须是 bug/feature/research/docs/refactor/test/null 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('type' in parsed)) return null;
    const validTypes = ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null];
    if (!validTypes.includes(parsed.type as string | null)) {
      return {
        ruleId: 'bug-report-type-enum',
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
export const bugReportPriorityEnum: ValidationRule = {
  id: 'bug-report-priority-enum',
  description: 'priority 必须是 P0/P1/P2/P3/null 之一',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('priority' in parsed)) return null;
    const validPriorities = ['P0', 'P1', 'P2', 'P3', null];
    if (!validPriorities.includes(parsed.priority as string | null)) {
      return {
        ruleId: 'bug-report-priority-enum',
        severity: 'warning',
        message: `priority 值 "${parsed.priority}" 不是有效枚举值`,
        value: String(parsed.priority),
      };
    }
    return null;
  },
};

/**
 * checkpoints 必须是数组或 null 类型
 */
export const bugReportCheckpointsType: ValidationRule = {
  id: 'bug-report-checkpoints-type',
  description: 'checkpoints 必须是数组或 null 类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('checkpoints' in parsed)) return null;
    const cp = parsed.checkpoints;
    if (cp !== null && !Array.isArray(cp)) {
      return {
        ruleId: 'bug-report-checkpoints-type',
        severity: 'warning',
        message: `checkpoints 不是数组或 null 类型，实际类型: ${typeof cp}`,
        value: String(cp),
      };
    }
    return null;
  },
};

/**
 * rootCause 必须是字符串或 null 类型
 */
export const bugReportRootCauseType: ValidationRule = {
  id: 'bug-report-root-cause-type',
  description: 'rootCause 必须是字符串或 null 类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('rootCause' in parsed)) return null;
    const rc = parsed.rootCause;
    if (rc !== null && typeof rc !== 'string') {
      return {
        ruleId: 'bug-report-root-cause-type',
        severity: 'warning',
        message: `rootCause 不是字符串或 null 类型，实际类型: ${typeof rc}`,
        value: String(rc),
      };
    }
    return null;
  },
};

/**
 * impactScope 必须是字符串或 null 类型
 */
export const bugReportImpactScopeType: ValidationRule = {
  id: 'bug-report-impact-scope-type',
  description: 'impactScope 必须是字符串或 null 类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('impactScope' in parsed)) return null;
    const is = parsed.impactScope;
    if (is !== null && typeof is !== 'string') {
      return {
        ruleId: 'bug-report-impact-scope-type',
        severity: 'warning',
        message: `impactScope 不是字符串或 null 类型，实际类型: ${typeof is}`,
        value: String(is),
      };
    }
    return null;
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
export const qualityOutputRules: ValidationRule[] = [
  qualityRequiredFields,
  qualityScoreRange,
  qualityIssuesArrayType,
  qualityIssuesItemStructure,
  qualitySuggestionsArrayType,
];

/** detectDuplicates 方法验证规则 */
export const duplicatesOutputRules: ValidationRule[] = [
  duplicatesRequiredFields,
  duplicatesItemRequiredFields,
  duplicatesTaskIdsValidation,
  duplicatesSimilarityRange,
];

/** assessStaleness 方法验证规则 */
export const stalenessOutputRules: ValidationRule[] = [
  stalenessRequiredFields,
  stalenessIsStaleType,
  stalenessScoreRange,
  stalenessActionEnum,
  stalenessReasonType,
];

/** analyzeBugReport 方法验证规则 */
export const bugReportOutputRules: ValidationRule[] = [
  bugReportRequiredFields,
  bugReportTypeEnum,
  bugReportPriorityEnum,
  bugReportCheckpointsType,
  bugReportRootCauseType,
  bugReportImpactScopeType,
];
