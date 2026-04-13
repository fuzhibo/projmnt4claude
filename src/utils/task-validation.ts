/**
 * task-validation.ts - 字段更新与关系操作验证
 *
 * 为 analyze-fix-pipeline 中的 writeTaskMeta 调用提供验证层，
 * 确保字段类型合法、关系引用完整、无循环引用。
 * 扩展覆盖: Schema 迁移验证、Checkpoint 操作验证、Backfill 验证。
 */

import type {
  TaskMeta,
  TaskVerification,
  VerificationMethod,
  CheckpointMetadata,
} from '../types/task';
import { CURRENT_TASK_SCHEMA_VERSION } from '../types/task';
import { readTaskMeta, getAllTaskIds, writeTaskMeta } from './task';

// ============================================================
// CP-1: 字段验证规则
// ============================================================

/** 合法优先级值 */
export const VALID_PRIORITIES = [
  'P0', 'P1', 'P2', 'P3',
  'Q1', 'Q2', 'Q3', 'Q4',
] as const;

/** 合法任务类型 */
export const VALID_TYPES = [
  'bug', 'feature', 'research', 'docs', 'refactor', 'test',
] as const;

/** 标题长度限制 */
export const TITLE_MAX_LENGTH = 200;

/** 描述长度限制 */
export const DESCRIPTION_MAX_LENGTH = 10_000;

// ============================================================
// CP-1: Schema 迁移验证规则
// ============================================================

/** Schema 版本验证结果 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** 需要有默认值的数组字段及其默认值 */
const SCHEMA_ARRAY_FIELD_DEFAULTS: Record<string, unknown[]> = {
  dependencies: [],
  history: [],
  checkpoints: [],
  subtaskIds: [],
  discussionTopics: [],
  fileWarnings: [],
  allowedTools: [],
  requirementHistory: [],
  transitionNotes: [],
  phaseHistory: [],
};

/**
 * 验证 schemaVersion 变更是否合法。
 * 规则: 版本必须单调递增，且不超过当前最新版本。
 */
export function validateSchemaVersionChange(
  oldVersion: number | undefined,
  newVersion: number | undefined,
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const old = oldVersion ?? 0;
  const neu = newVersion ?? 0;

  if (neu < old) {
    errors.push(`schemaVersion 不允许降级: ${old} → ${neu}`);
  }

  if (neu > CURRENT_TASK_SCHEMA_VERSION) {
    errors.push(`schemaVersion ${neu} 超过当前最新版本 ${CURRENT_TASK_SCHEMA_VERSION}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证 schema 迁移后字段是否有合法默认值。
 * 规则: 数组字段不允许为 null；达到对应版本后应有对应字段。
 */
export function validateSchemaFieldDefaults(
  task: TaskMeta,
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 数组字段不允许为 null
  for (const [field, defaultValue] of Object.entries(SCHEMA_ARRAY_FIELD_DEFAULTS)) {
    const value = (task as unknown as Record<string, unknown>)[field];
    if (value === null) {
      errors.push(`数组字段 ${field} 为 null，应设为 ${JSON.stringify(defaultValue)}`);
    }
  }

  // schema v1+: reopenCount 和 requirementHistory 应存在
  const version = task.schemaVersion ?? 0;
  if (version >= 1) {
    if (task.reopenCount === undefined) {
      warnings.push(`schema v${version}: reopenCount 未设置，缺少默认值 0`);
    }
    if (task.requirementHistory === undefined) {
      warnings.push(`schema v${version}: requirementHistory 未设置，缺少默认值 []`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Schema 迁移前后对比验证。
 * 在 validatedWriteTaskMeta 中自动调用，对比新旧 task 的 schema 相关字段。
 */
export function validateSchemaMigration(
  oldTask: TaskMeta | null,
  newTask: TaskMeta,
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // schemaVersion 单调递增
  if (oldTask) {
    const versionResult = validateSchemaVersionChange(oldTask.schemaVersion, newTask.schemaVersion);
    errors.push(...versionResult.errors);
    warnings.push(...versionResult.warnings);
  }

  // 字段默认值
  const fieldResult = validateSchemaFieldDefaults(newTask);
  errors.push(...fieldResult.errors);
  warnings.push(...fieldResult.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// CP-2: Checkpoint 验证规则
// ============================================================

/** 合法检查点状态转换映射 */
export const VALID_CHECKPOINT_TRANSITIONS: Record<string, string[]> = {
  pending:    ['completed', 'failed', 'skipped'],
  completed:  ['failed'],        // 完成后可回退为 failed（修正错误）
  failed:     ['pending', 'completed'],  // 可重试
  skipped:    ['pending'],       // 可重新激活
};

/** Checkpoint 操作验证结果 */
export interface CheckpointValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证检查点状态转换是否合法。
 * 规则: pending → completed/failed/skipped, 不可随意跳转。
 */
export function validateCheckpointTransition(
  fromStatus: string,
  toStatus: string,
): CheckpointValidationResult {
  if (fromStatus === toStatus) {
    return { valid: true, errors: [], warnings: [] };
  }

  const allowed = VALID_CHECKPOINT_TRANSITIONS[fromStatus];
  if (!allowed) {
    return {
      valid: false,
      errors: [`未知的检查点状态: ${fromStatus}`],
      warnings: [],
    };
  }

  if (!allowed.includes(toStatus)) {
    return {
      valid: false,
      errors: [`非法检查点状态转换: ${fromStatus} → ${toStatus}`],
      warnings: [],
    };
  }

  return { valid: true, errors: [], warnings: [] };
}

/**
 * 验证检查点 ID 是否存在于任务定义中。
 */
export function validateCheckpointId(
  task: TaskMeta,
  checkpointId: string,
): CheckpointValidationResult {
  if (!task.checkpoints || task.checkpoints.length === 0) {
    return {
      valid: false,
      errors: [`任务 ${task.id} 无检查点，无法验证 checkpoint ID "${checkpointId}"`],
      warnings: [],
    };
  }

  const found = task.checkpoints.some(cp => cp.id === checkpointId);
  if (!found) {
    return {
      valid: false,
      errors: [`检查点 ID "${checkpointId}" 不存在于任务 ${task.id} 中`],
      warnings: [],
    };
  }

  return { valid: true, errors: [], warnings: [] };
}

/**
 * Checkpoint 操作前后对比验证。
 * 在 validatedWriteTaskMeta 中自动调用。
 */
export function validateCheckpointOperations(
  oldTask: TaskMeta | null,
  newTask: TaskMeta,
): CheckpointValidationResult {
  if (!oldTask || !newTask.checkpoints) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const oldCpMap = new Map((oldTask.checkpoints || []).map(cp => [cp.id, cp]));

  for (const newCp of newTask.checkpoints) {
    const oldCp = oldCpMap.get(newCp.id);
    if (oldCp && oldCp.status !== newCp.status) {
      const result = validateCheckpointTransition(oldCp.status, newCp.status);
      if (!result.valid) {
        errors.push(...result.errors.map(e => `[${newCp.id}] ${e}`));
      }
    }
    // 新增的 checkpoint 不需要转换验证，但 ID 不能为空
    if (!newCp.id || newCp.id.trim().length === 0) {
      errors.push('检查点 ID 不能为空');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// CP-2: Backfill 验证规则
// ============================================================

/** 合法的 verification.result 值 */
const VALID_VERIFICATION_RESULTS = ['passed', 'partial', 'failed'] as const;

/** 合法的 VerificationMethod 值 */
const VALID_VERIFICATION_METHODS: VerificationMethod[] = [
  'code_review', 'lint', 'unit_test', 'functional_test',
  'integration_test', 'e2e_test', 'architect_review',
  'automated', 'human_verification',
];

/**
 * 验证 verification 数据格式是否合法。
 * 规则: 必需字段 (verifiedAt, verifiedBy, result) 存在且合法;
 *       checkpointCompletionRate 在 0-100; methods 为合法值。
 */
export function validateVerificationBackfill(
  verification: TaskVerification,
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // verifiedAt
  if (!verification.verifiedAt) {
    errors.push('verification.verifiedAt 不能为空');
  } else if (typeof verification.verifiedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(verification.verifiedAt)) {
    warnings.push('verification.verifiedAt 不是有效的 ISO 时间戳');
  }

  // verifiedBy
  if (!verification.verifiedBy) {
    errors.push('verification.verifiedBy 不能为空');
  }

  // result
  if (!(VALID_VERIFICATION_RESULTS as readonly string[]).includes(verification.result)) {
    errors.push(
      `verification.result "${verification.result}" 不合法，允许值: ${VALID_VERIFICATION_RESULTS.join(', ')}`,
    );
  }

  // checkpointCompletionRate
  if (verification.checkpointCompletionRate !== undefined) {
    if (typeof verification.checkpointCompletionRate !== 'number'
      || verification.checkpointCompletionRate < 0
      || verification.checkpointCompletionRate > 100) {
      errors.push(
        `verification.checkpointCompletionRate ${verification.checkpointCompletionRate} 不在 0-100 范围内`,
      );
    }
  }

  // methods
  if (verification.methods !== undefined && Array.isArray(verification.methods)) {
    for (const method of verification.methods) {
      if (!VALID_VERIFICATION_METHODS.includes(method)) {
        warnings.push(`verification.methods 包含非标准方法: ${method}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Backfill 前后对比验证。
 * 当 verification 字段被新增或修改时自动验证格式。
 */
export function validateBackfillOperation(
  oldTask: TaskMeta | null,
  newTask: TaskMeta,
): SchemaValidationResult {
  // 只在 verification 被新增时验证
  if (newTask.verification && (!oldTask || !oldTask.verification)) {
    return validateVerificationBackfill(newTask.verification);
  }

  // verification 被修改时也验证
  if (newTask.verification && oldTask?.verification
    && JSON.stringify(newTask.verification) !== JSON.stringify(oldTask.verification)) {
    return validateVerificationBackfill(newTask.verification);
  }

  return { valid: true, errors: [], warnings: [] };
}

// ============================================================
// 关系验证规则
// ============================================================

// - parentId 指向的任务必须存在
// - subtaskIds 中的任务必须存在
// - 不允许循环引用（A.parent=B 且 B.parent=A）
// （规则在 validateRelationship 函数中实现）

// ============================================================
// 验证结果类型
// ============================================================

export interface FieldValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RelationshipValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface TaskValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================
// 字段验证函数
// ============================================================

/**
 * 验证单个字段更新值。
 *
 * 规则:
 * - priority: 仅允许 P0-P3 / Q1-Q4
 * - type: 仅允许合法任务类型
 * - title: 非空、不超过 TITLE_MAX_LENGTH
 * - description: 不超过 DESCRIPTION_MAX_LENGTH
 */
export function validateFieldUpdate(
  field: string,
  value: unknown,
): FieldValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (field) {
    case 'priority': {
      if (typeof value !== 'string' || !(VALID_PRIORITIES as readonly string[]).includes(value)) {
        errors.push(`无效优先级 "${value}"，允许值: ${(VALID_PRIORITIES as readonly string[]).join(', ')}`);
      }
      break;
    }
    case 'type': {
      if (typeof value !== 'string' || !(VALID_TYPES as readonly string[]).includes(value)) {
        errors.push(`无效类型 "${value}"，允许值: ${(VALID_TYPES as readonly string[]).join(', ')}`);
      }
      break;
    }
    case 'title': {
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push('标题不能为空');
      } else if (value.length > TITLE_MAX_LENGTH) {
        errors.push(`标题长度 ${value.length} 超过上限 ${TITLE_MAX_LENGTH}`);
      }
      break;
    }
    case 'description': {
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string') {
          errors.push('描述必须为字符串或 null/undefined');
        } else if (value.length > DESCRIPTION_MAX_LENGTH) {
          warnings.push(`描述长度 ${value.length} 超过上限 ${DESCRIPTION_MAX_LENGTH}`);
        }
      }
      break;
    }
    default:
      break;
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// 关系验证函数
// ============================================================

/**
 * 验证关系变更（parentId、subtaskIds）。
 *
 * 规则:
 * - parentId 指向的任务必须存在
 * - subtaskIds 中的任务必须存在
 * - 不允许循环引用
 */
export function validateRelationship(
  taskId: string,
  updates: { parentId?: string | null; subtaskIds?: string[] },
  cwd: string,
): RelationshipValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 验证 parentId
  if (updates.parentId !== undefined && updates.parentId !== null) {
    const parentId = updates.parentId;

    // 自引用检查
    if (parentId === taskId) {
      errors.push(`自引用: 任务 ${taskId} 不能成为自身的父任务`);
    } else {
      // 存在性检查
      const parentTask = readTaskMeta(parentId, cwd);
      if (!parentTask) {
        errors.push(`父任务 "${parentId}" 不存在`);
      } else {
        // 循环引用检查: 沿 parent 链向上遍历
        const visited = new Set<string>([taskId]);
        let current: TaskMeta | null = parentTask;
        while (current) {
          if (visited.has(current.id)) {
            errors.push(`循环父引用: ${taskId} → ... → ${current.id}`);
            break;
          }
          visited.add(current.id);
          if (!current.parentId) break;
          current = readTaskMeta(current.parentId, cwd);
        }
      }
    }
  }

  // 验证 subtaskIds
  if (updates.subtaskIds !== undefined && updates.subtaskIds.length > 0) {
    const allIds = new Set(getAllTaskIds(cwd));
    for (const subtaskId of updates.subtaskIds) {
      if (!allIds.has(subtaskId)) {
        warnings.push(`子任务 "${subtaskId}" 不存在`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// CP-3: 组合验证 + 写入
// ============================================================

/**
 * 写入前验证选项
 */
export interface ValidateBeforeWriteOptions {
  /** 是否验证 Schema 迁移 */
  validateSchema?: boolean;
  /** 是否验证 Checkpoint 操作 */
  validateCheckpoint?: boolean;
  /** 是否验证 Backfill */
  validateBackfill?: boolean;
}

/**
 * 写入前验证任务的所有字段和关系。
 * 包含 Schema 迁移、Checkpoint 操作、Backfill 验证。
 */
export function validateTaskBeforeWrite(
  task: TaskMeta,
  cwd: string,
  oldTask: TaskMeta | null = null,
  options: ValidateBeforeWriteOptions = {},
): TaskValidationResult {
  const {
    validateSchema = true,
    validateCheckpoint = true,
    validateBackfill = true,
  } = options;

  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // 字段验证（始终执行）
  const fields: Array<[string, unknown]> = [
    ['priority', task.priority],
    ['type', task.type],
    ['title', task.title],
    ['description', task.description],
  ];

  for (const [field, value] of fields) {
    const result = validateFieldUpdate(field, value);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  // 关系验证（始终执行）
  const relResult = validateRelationship(
    task.id,
    { parentId: task.parentId, subtaskIds: task.subtaskIds },
    cwd,
  );
  allErrors.push(...relResult.errors);
  allWarnings.push(...relResult.warnings);

  // Schema 迁移验证（可选）
  if (validateSchema) {
    const schemaResult = validateSchemaMigration(oldTask, task);
    allErrors.push(...schemaResult.errors);
    allWarnings.push(...schemaResult.warnings);
  }

  // Checkpoint 操作验证（可选）
  if (validateCheckpoint) {
    const cpResult = validateCheckpointOperations(oldTask, task);
    allErrors.push(...cpResult.errors);
    allWarnings.push(...cpResult.warnings);
  }

  // Backfill 验证（可选）
  if (validateBackfill) {
    const backfillResult = validateBackfillOperation(oldTask, task);
    allErrors.push(...backfillResult.errors);
    allWarnings.push(...backfillResult.warnings);
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

/**
 * 带验证的 writeTaskMeta 包装选项
 */
export interface ValidatedWriteOptions {
  /** 严格模式：验证错误时抛出异常，阻止写入 */
  strict?: boolean;
  /** 验证类型过滤：只验证指定类型 */
  validateSchema?: boolean;
  validateCheckpoint?: boolean;
  validateBackfill?: boolean;
}

/**
 * 带验证的 writeTaskMeta 包装。
 *
 * 验证字段、关系、Schema 迁移、Checkpoint 操作和 Backfill 后输出警告。
 * 在 strict 模式下，验证错误会抛出异常阻止写入；非严格模式下仅输出警告。
 *
 * @returns 验证结果
 * @throws 严格模式下验证错误时抛出 TaskValidationError
 */
export function validatedWriteTaskMeta(
  task: TaskMeta,
  cwd: string,
  options: ValidatedWriteOptions = {},
): { validation: TaskValidationResult } {
  const {
    strict = false,
    validateSchema = true,
    validateCheckpoint = true,
    validateBackfill = true,
  } = options;

  // 读取旧任务用于对比验证
  const oldTask = readTaskMeta(task.id, cwd);
  const validation = validateTaskBeforeWrite(task, cwd, oldTask, {
    validateSchema,
    validateCheckpoint,
    validateBackfill,
  });

  for (const error of validation.errors) {
    if (strict) {
      throw new TaskValidationError(task.id, error);
    }
    console.warn(`  ⚠️  验证错误 (${task.id}): ${error}`);
  }
  for (const warning of validation.warnings) {
    console.warn(`  ⚠️  验证警告 (${task.id}): ${warning}`);
  }

  writeTaskMeta(task, cwd);
  return { validation };
}

/**
 * 任务验证错误
 */
export class TaskValidationError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly validationError: string,
  ) {
    super(`任务 ${taskId} 验证失败: ${validationError}`);
    this.name = 'TaskValidationError';
  }
}
