/**
 * 质量门禁统一注册表
 *
 * 提供集中式的质量门禁规则注册和执行入口，解决规则分散在多个模块中的问题。
 *
 * 设计理念:
 * 1. 注册中心: 所有规则在此注册，便于发现和管理
 * 2. 阶段分组: 按初始化、转换、执行等阶段组织规则
 * 3. 统一执行: 提供单入口 runQualityGate() 函数
 * 4. 结果聚合: 返回结构化的验证结果
 */

import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import type { ValidationViolation, ValidationRule } from '../types/feedback-constraint.js';
import {
  checkpointNoDuplicate,
  checkpointNoFilePath,
  checkpointCountControl,
  checkpointVerbPrefix,
  checkpointMinLength,
  checkpointRequiredPrefix,
  checkpointHasVerificationCommands,
  metaJsonValid,
} from './validation-rules/checkpoint-rules.js';
import { validateBasicFields, validateCheckpoints, type BasicFieldsValidationResult } from './quality-gate.js';

// ============================================================
// 规则定义和注册
// ============================================================

/** 规则执行阶段类型 */
export type QualityGatePhase = 'initialization' | 'transition' | 'execution' | 'completion';

/** 规则优先级 */
export type RulePriority = 'critical' | 'high' | 'medium' | 'low';

/** 带元数据的规则定义 */
export interface RegisteredRule {
  /** 规则唯一标识 */
  id: string;
  /** 规则描述 */
  description: string;
  /** 规则优先级 */
  priority: RulePriority;
  /** 规则实现的验证函数 */
  rule: ValidationRule;
  /** 适用的任务优先级 (null 表示所有) */
  appliesToPriorities: string[] | null;
  /** 适用的执行阶段 */
  phases: QualityGatePhase[];
}

/** 质量门禁验证结果 */
export interface QualityGateValidationResult {
  /** 是否通过所有规则 */
  passed: boolean;
  /** 验证的阶段 */
  phase: QualityGatePhase;
  /** 任务ID */
  taskId: string;
  /** 违规列表 */
  violations: ValidationViolation[];
  /** 按严重程度分组的违规 */
  errors: ValidationViolation[];
  /** 警告列表 */
  warnings: ValidationViolation[];
  /** 执行时间戳 */
  validatedAt: string;
  /** 执行的规则数量 */
  rulesExecuted: number;
  /** 跳过的规则数量 */
  rulesSkipped: number;
}

/** 批量验证结果 */
export interface BatchValidationResult {
  /** 总任务数 */
  totalTasks: number;
  /** 通过的任务数 */
  passedCount: number;
  /** 失败的任务数 */
  failedCount: number;
  /** 各任务结果 */
  results: Map<string, QualityGateValidationResult>;
  /** 是否全部通过 */
  allPassed: boolean;
}

// ============================================================
// 规则注册表
// ============================================================

/**
 * 质量门禁规则注册表
 *
 * 所有规则在此集中定义，便于统一管理和发现
 */
export const QUALITY_GATE_RULES: Record<string, RegisteredRule> = {
  // ========== 初始化阶段规则 ==========
  'meta-json-valid': {
    id: 'meta-json-valid',
    description: 'meta.json 必须包含必需字段、值合法且 JSON 格式正确',
    priority: 'critical',
    rule: metaJsonValid,
    appliesToPriorities: null, // 所有优先级
    phases: ['initialization', 'transition', 'execution'],
  },

  'checkpoint-array-not-empty': {
    id: 'checkpoint-array-not-empty',
    description: 'P0/P1 任务必须包含至少 2 个结构化检查点',
    priority: 'critical',
    rule: {
      id: 'checkpoint-array-not-empty',
      description: 'P0/P1 任务必须包含至少 2 个结构化检查点',
      severity: 'error',
      check: (task: unknown): ValidationViolation | null => {
        const t = task as TaskMeta;
        if (!t.checkpoints || t.checkpoints.length === 0) {
          if (t.priority === 'P0' || t.priority === 'P1') {
            return {
              ruleId: 'checkpoint-array-not-empty',
              severity: 'error',
              message: `${t.priority} 任务必须包含至少 2 个结构化检查点，当前: 0`,
            };
          }
        }
        return null;
      },
    },
    appliesToPriorities: ['P0', 'P1'],
    phases: ['initialization', 'transition'],
  },

  'checkpoint-required-prefix': {
    id: 'checkpoint-required-prefix',
    description: '检查点描述必须以验证类别前缀开头 ([ai review]/[ai qa]/[human qa]/[script])',
    priority: 'high',
    rule: checkpointRequiredPrefix,
    appliesToPriorities: null,
    phases: ['initialization', 'transition'],
  },

  'checkpoint-has-verification-commands': {
    id: 'checkpoint-has-verification-commands',
    description: '使用自动化验证方法的检查点应包含验证命令或步骤',
    priority: 'medium',
    rule: checkpointHasVerificationCommands,
    appliesToPriorities: null,
    phases: ['initialization', 'transition'],
  },

  // ========== 检查点质量规则 ==========
  'checkpoint-no-duplicate': {
    id: 'checkpoint-no-duplicate',
    description: '检查点描述不允许重复（三层去重）',
    priority: 'high',
    rule: checkpointNoDuplicate,
    appliesToPriorities: null,
    phases: ['initialization'],
  },

  'checkpoint-no-file-path': {
    id: 'checkpoint-no-file-path',
    description: '检查点描述不能是纯文件路径格式',
    priority: 'high',
    rule: checkpointNoFilePath,
    appliesToPriorities: null,
    phases: ['initialization'],
  },

  'checkpoint-count-control': {
    id: 'checkpoint-count-control',
    description: '检查点数量控制在合理范围 (>8 warning, >15 error)',
    priority: 'medium',
    rule: checkpointCountControl,
    appliesToPriorities: null,
    phases: ['initialization'],
  },

  'checkpoint-verb-prefix': {
    id: 'checkpoint-verb-prefix',
    description: '检查点描述应以动词开头',
    priority: 'low',
    rule: checkpointVerbPrefix,
    appliesToPriorities: null,
    phases: ['initialization'],
  },

  'checkpoint-min-length': {
    id: 'checkpoint-min-length',
    description: '每条检查点描述至少 10 个字符',
    priority: 'low',
    rule: checkpointMinLength,
    appliesToPriorities: null,
    phases: ['initialization'],
  },

  // ========== 转换阶段规则 ==========
  'basic-fields-valid': {
    id: 'basic-fields-valid',
    description: '任务基础字段完整性验证 (id, title, description, checkpoints)',
    priority: 'critical',
    rule: {
      id: 'basic-fields-valid',
      description: '任务基础字段完整性验证',
      severity: 'error',
      check: (task: unknown): ValidationViolation | null => {
        const t = task as TaskMeta;
        const result = validateBasicFields(t);
        if (!result.valid) {
          return {
            ruleId: 'basic-fields-valid',
            severity: 'error',
            message: `基础字段验证失败: ${result.errors.join(', ')}`,
          };
        }
        return null;
      },
    },
    appliesToPriorities: null,
    phases: ['transition', 'execution'],
  },

  'status-transition-valid': {
    id: 'status-transition-valid',
    description: '状态转换必须通过有效的 transition note 记录',
    priority: 'high',
    rule: {
      id: 'status-transition-valid',
      description: '状态转换验证',
      severity: 'error',
      check: (task: unknown, context?: { expectedStatus?: string; phase?: string }): ValidationViolation | null => {
        const t = task as TaskMeta;
        const expectedStatus = context?.expectedStatus;
        const phase = context?.phase;

        if (!expectedStatus) return null;

        // 检查状态是否匹配期望
        if (t.status !== expectedStatus) {
          return {
            ruleId: 'status-transition-valid',
            severity: 'error',
            message: `状态不匹配: 期望 ${expectedStatus}, 实际 ${t.status} (阶段: ${phase || 'unknown'})`,
          };
        }

        // 检查最新 transitionNote
        const notes = t.transitionNotes;
        if (!notes || notes.length === 0) {
          return {
            ruleId: 'status-transition-valid',
            severity: 'error',
            message: `transitionNotes 为空，缺少流转记录 (阶段: ${phase || 'unknown'}, 期望状态: ${expectedStatus})`,
          };
        }

        const latest = notes[notes.length - 1]!;
        if (!latest.note || latest.note.trim().length === 0) {
          return {
            ruleId: 'status-transition-valid',
            severity: 'error',
            message: `最新 transitionNote 缺少决策说明 (阶段: ${phase || 'unknown'})`,
          };
        }

        if (latest.toStatus !== expectedStatus) {
          return {
            ruleId: 'status-transition-valid',
            severity: 'error',
            message: `transitionNote.toStatus 不匹配: 期望 ${expectedStatus}, 实际 ${latest.toStatus} (阶段: ${phase || 'unknown'})`,
          };
        }

        return null;
      },
    },
    appliesToPriorities: null,
    phases: ['transition'],
  },
};

/** 阶段到规则的映射 */
export const PHASE_RULES: Record<QualityGatePhase, string[]> = {
  initialization: [
    'meta-json-valid',
    'checkpoint-array-not-empty',
    'checkpoint-required-prefix',
    'checkpoint-has-verification-commands',
    'checkpoint-no-duplicate',
    'checkpoint-no-file-path',
    'checkpoint-count-control',
    'checkpoint-verb-prefix',
    'checkpoint-min-length',
    'basic-fields-valid',
  ],
  transition: [
    'meta-json-valid',
    'checkpoint-array-not-empty',
    'checkpoint-required-prefix',
    'checkpoint-has-verification-commands',
    'basic-fields-valid',
    'status-transition-valid',
  ],
  execution: [
    'meta-json-valid',
    'basic-fields-valid',
  ],
  completion: [
    'meta-json-valid',
    'basic-fields-valid',
  ],
};

// ============================================================
// 核心执行函数
// ============================================================

/**
 * 执行质量门禁验证（统一入口）
 *
 * 根据指定的阶段运行对应的质量门禁规则，返回结构化的验证结果。
 *
 * @param task - 任务元数据
 * @param phase - 验证阶段
 * @param context - 可选的上下文信息（如期望状态等）
 * @returns 验证结果
 *
 * @example
 * ```typescript
 * // 初始化阶段验证
 * const result = runQualityGate(task, 'initialization');
 * if (!result.passed) {
 *   console.error('质量门禁未通过:', result.errors);
 * }
 *
 * // 转换阶段验证
 * const transitionResult = runQualityGate(task, 'transition', {
 *   expectedStatus: 'wait_review',
 *   phase: 'development'
 * });
 * ```
 */
export function runQualityGate(
  task: TaskMeta,
  phase: QualityGatePhase,
  context?: { expectedStatus?: string; phase?: string }
): QualityGateValidationResult {
  const violations: ValidationViolation[] = [];
  const errors: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];
  let rulesExecuted = 0;
  let rulesSkipped = 0;

  const ruleIds = PHASE_RULES[phase] || [];

  for (const ruleId of ruleIds) {
    const registered = QUALITY_GATE_RULES[ruleId];
    if (!registered) {
      rulesSkipped++;
      continue;
    }

    // 检查是否适用于当前任务优先级
    if (registered.appliesToPriorities !== null) {
      if (!registered.appliesToPriorities.includes(task.priority || 'P2')) {
        rulesSkipped++;
        continue;
      }
    }

    // 执行规则
    try {
      const violation = registered.rule.check(task, context);
      rulesExecuted++;

      if (violation) {
        violations.push(violation);
        if (violation.severity === 'error') {
          errors.push(violation);
        } else {
          warnings.push(violation);
        }
      }
    } catch (err) {
      // 规则执行异常，记录为错误
      const errorViolation: ValidationViolation = {
        ruleId: registered.id,
        severity: 'error',
        message: `规则执行异常: ${err instanceof Error ? err.message : String(err)}`,
      };
      violations.push(errorViolation);
      errors.push(errorViolation);
      rulesExecuted++;
    }
  }

  return {
    passed: errors.length === 0,
    phase,
    taskId: task.id,
    violations,
    errors,
    warnings,
    validatedAt: new Date().toISOString(),
    rulesExecuted,
    rulesSkipped,
  };
}

/**
 * 批量执行质量门禁验证
 *
 * @param tasks - 任务列表
 * @param phase - 验证阶段
 * @returns 批量验证结果
 */
export function batchRunQualityGate(
  tasks: TaskMeta[],
  phase: QualityGatePhase
): BatchValidationResult {
  const results = new Map<string, QualityGateValidationResult>();
  let passedCount = 0;
  let failedCount = 0;

  for (const task of tasks) {
    const result = runQualityGate(task, phase);
    results.set(task.id, result);

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  return {
    totalTasks: tasks.length,
    passedCount,
    failedCount,
    results,
    allPassed: failedCount === 0,
  };
}

/**
 * 获取指定阶段的所有规则定义
 *
 * @param phase - 验证阶段
 * @returns 规则定义列表
 */
export function getRulesForPhase(phase: QualityGatePhase): RegisteredRule[] {
  const ruleIds = PHASE_RULES[phase] || [];
  return ruleIds
    .map(id => QUALITY_GATE_RULES[id])
    .filter((rule): rule is RegisteredRule => rule !== undefined);
}

/**
 * 获取所有可用规则列表
 *
 * @returns 所有规则定义
 */
export function getAllRules(): RegisteredRule[] {
  return Object.values(QUALITY_GATE_RULES);
}

/**
 * 格式化验证结果为可读字符串
 *
 * @param result - 验证结果
 * @returns 格式化字符串
 */
export function formatValidationResult(result: QualityGateValidationResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  const statusIcon = result.passed ? '✅' : '❌';
  lines.push(separator);
  lines.push(`${statusIcon} 质量门禁验证 [${result.phase}] - ${result.taskId}`);
  lines.push(separator);
  lines.push(`执行规则: ${result.rulesExecuted} | 跳过: ${result.rulesSkipped}`);
  lines.push(`验证时间: ${result.validatedAt}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`❌ 错误 (${result.errors.length}):`);
    for (const error of result.errors) {
      lines.push(`   • ${error.message}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push(`⚠️  警告 (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      lines.push(`   • ${warning.message}`);
    }
    lines.push('');
  }

  if (result.passed) {
    lines.push('✅ 所有质量门禁检查通过！');
  }

  lines.push(separator);

  return lines.join('\n');
}

/**
 * 格式化批量验证结果
 *
 * @param result - 批量验证结果
 * @returns 格式化字符串
 */
export function formatBatchValidationResult(result: BatchValidationResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push(separator);
  lines.push('🚦 批量质量门禁验证结果');
  lines.push(separator);
  lines.push(`总任务: ${result.totalTasks} | ✅ 通过: ${result.passedCount} | ❌ 失败: ${result.failedCount}`);
  lines.push('');

  if (result.failedCount > 0) {
    lines.push('失败的验证:');
    for (const [taskId, taskResult] of result.results) {
      if (!taskResult.passed) {
        lines.push(`   • ${taskId}: ${taskResult.errors.length} 错误, ${taskResult.warnings.length} 警告`);
      }
    }
    lines.push('');
  }

  if (result.allPassed) {
    lines.push('✅ 所有任务通过质量门禁！');
  } else {
    lines.push(`⚠️  ${result.failedCount} 个任务未通过质量门禁`);
  }

  lines.push(separator);

  return lines.join('\n');
}

// ============================================================
// 便捷函数（兼容旧接口）
// ============================================================

/**
 * 验证检查点（兼容旧接口，委托到统一注册表）
 *
 * 此函数保留以保持向后兼容，内部使用新的统一注册表实现。
 *
 * @param task - 任务元数据
 * @returns 违规列表
 */
export function validateCheckpointsWithRegistry(task: TaskMeta): ValidationViolation[] {
  const result = runQualityGate(task, 'initialization');
  return result.violations;
}

/**
 * 验证状态转换（兼容旧接口，委托到统一注册表）
 *
 * 此函数保留以保持向后兼容，内部使用新的统一注册表实现。
 *
 * @param task - 任务元数据
 * @param expectedStatus - 期望状态
 * @param phase - 当前阶段
 * @returns 验证结果
 */
export function validateStatusTransition(
  task: TaskMeta,
  expectedStatus: string,
  phase: string
): { valid: boolean; errors: string[] } {
  const result = runQualityGate(task, 'transition', { expectedStatus, phase });
  return {
    valid: result.passed,
    errors: result.errors.map(e => e.message),
  };
}
