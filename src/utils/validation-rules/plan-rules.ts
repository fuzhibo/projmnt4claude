/**
 * 计划相关 AI 输出验证规则集
 *
 * 为 inferSemanticDependencies 等 AI 调用方法提供结构化输出验证，
 * 确保返回的 JSON 包含合法的依赖关系字段。
 *
 * 规则作用于原始字符串输出（JSON），在 FeedbackConstraintEngine 的
 * jsonParseableRule / nonEmptyOutputRule 之上叠加业务字段校验。
 */

import type {
  ValidationRule,
  ValidationViolation,
} from '../../types/feedback-constraint.js';

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

// ============================================================
// inferSemanticDependencies 输出规则
// ============================================================

/**
 * 语义依赖输出必须包含 dependencies 数组字段
 */
export const semanticDepsRequiredFields: ValidationRule = {
  id: 'semantic-deps-required-fields',
  description: '语义依赖输出必须包含 dependencies 数组字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed) return null; // JSON 解析失败由 jsonParseableRule 处理
    if (!('dependencies' in parsed)) {
      return {
        ruleId: 'semantic-deps-required-fields',
        severity: 'error',
        message: '语义依赖输出缺少 dependencies 字段',
      };
    }
    return null;
  },
};

/**
 * dependencies 必须是数组类型
 */
export const semanticDepsArrayType: ValidationRule = {
  id: 'semantic-deps-array-type',
  description: 'dependencies 必须是数组类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed)) return null;
    if (!Array.isArray(parsed.dependencies)) {
      return {
        ruleId: 'semantic-deps-array-type',
        severity: 'warning',
        message: `dependencies 不是数组类型，实际类型: ${typeof parsed.dependencies}`,
        value: String(parsed.dependencies),
      };
    }
    return null;
  },
};

/**
 * dependencies 中每个元素必须包含 taskId, depTaskId, reason 字段且均为字符串
 */
export const semanticDepsItemStructure: ValidationRule = {
  id: 'semantic-deps-item-structure',
  description: 'dependencies 中每个元素必须包含 taskId, depTaskId, reason 字段且均为字符串',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        return {
          ruleId: 'semantic-deps-item-structure',
          severity: 'warning',
          message: `dependencies[${i}] 不是对象类型`,
          value: String(item),
        };
      }
      const missing = ['taskId', 'depTaskId', 'reason'].filter(f => !(f in item));
      if (missing.length > 0) {
        return {
          ruleId: 'semantic-deps-item-structure',
          severity: 'warning',
          message: `dependencies[${i}] 缺少必需字段: ${missing.join(', ')}`,
        };
      }
      for (const field of ['taskId', 'depTaskId', 'reason'] as const) {
        if (typeof item[field] !== 'string') {
          return {
            ruleId: 'semantic-deps-item-structure',
            severity: 'warning',
            message: `dependencies[${i}].${field} 不是字符串类型，实际类型: ${typeof item[field]}`,
            field,
            value: String(item[field]),
          };
        }
      }
    }
    return null;
  },
};

/**
 * taskId 与 depTaskId 不应相同（自依赖检查）
 */
export const semanticDepsNoSelfRef: ValidationRule = {
  id: 'semantic-deps-no-self-ref',
  description: 'dependencies 中 taskId 与 depTaskId 不应相同',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') continue;
      if (item.taskId === item.depTaskId && typeof item.taskId === 'string') {
        return {
          ruleId: 'semantic-deps-no-self-ref',
          severity: 'warning',
          message: `dependencies[${i}] 存在自依赖: taskId="${item.taskId}"`,
          value: String(item.taskId),
        };
      }
    }
    return null;
  },
};

/**
 * 依赖数量超过 8 条时触发 warning
 */
export const semanticDepsCountControl: ValidationRule = {
  id: 'semantic-deps-count-control',
  description: '依赖数量超过 8 条时触发 warning',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    const count = parsed.dependencies.length;
    if (count > 8) {
      return {
        ruleId: 'semantic-deps-count-control',
        severity: 'warning',
        message: `依赖数量 ${count} 条，超过 8 条建议上限`,
        value: String(count),
      };
    }
    return null;
  },
};

/**
 * 每条依赖的 reason 最少 10 个字符，否则触发 error
 */
export const semanticDepsReasonMinLength: ValidationRule = {
  id: 'semantic-deps-reason-min-length',
  description: '每条依赖的 reason 最少 10 个字符',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') continue;
      if (typeof item.reason === 'string' && item.reason.trim().length < 10) {
        return {
          ruleId: 'semantic-deps-reason-min-length',
          severity: 'error',
          message: `dependencies[${i}].reason 长度 ${item.reason.trim().length} 不足 10 字符`,
          field: 'reason',
          value: item.reason,
        };
      }
    }
    return null;
  },
};

// ============================================================
// 按方法分组的规则集
// ============================================================

/** inferSemanticDependencies 方法验证规则 */
export const semanticDependencyOutputRules: ValidationRule[] = [
  semanticDepsRequiredFields,
  semanticDepsArrayType,
  semanticDepsItemStructure,
  semanticDepsNoSelfRef,
  semanticDepsCountControl,
  semanticDepsReasonMinLength,
];
