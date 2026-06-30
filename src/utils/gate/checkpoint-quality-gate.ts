/**
 * 检查点质量门禁组件
 *
 * 来源：CP-004+CP-009+CP-010 设计文档
 * 核心功能：可复用的 A 类门禁组件，整合所有检查点验证器
 *
 * 调用阶段：
 * 1. 任务创建完成后：检测不过触发排错重试机制
 * 2. Pre-Dev Gate：任务执行前复用
 */

import type { CheckpointMetadata } from '../../types/task.js';
import type { ValidationViolation } from '../../types/feedback-constraint.js';
import {
  checkpointRequiredPrefix,
  checkpointScriptHasCommands,
  checkpointConsistencyValidator,
  checkpointHasVerificationCommands,
} from '../validation-rules/checkpoint-rules.js';
import { checkpointMdFormatValidatorAsync } from '../validation-rules/checkpoint-md-format-validator.js';
import { checkpointSyncValidatorAsync } from '../validation-rules/checkpoint-sync-validator.js';

/**
 * 质量门禁结果
 */
export interface GateResult {
  /** 是否通过 */
  passed: boolean;
  /** 违规项列表 */
  violations: ValidationViolation[];
}

/**
 * 质量门禁上下文
 */
export interface CheckpointQualityGateContext {
  /** 任务 ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
}

/**
 * 同步验证器类型
 */
type SyncValidator = {
  id: string;
  check: (output: unknown) => ValidationViolation | null;
};

/**
 * 异步验证器类型
 */
type AsyncValidator = {
  id: string;
  checkAsync: (
    checkpoints: CheckpointMetadata[],
    context?: CheckpointQualityGateContext
  ) => Promise<ValidationViolation | null>;
};

/**
 * 执行检查点质量门禁
 *
 * 整合同步和异步验证器，返回完整的门禁结果
 *
 * @param checkpoints - CheckpointMetadata 数组
 * @param context - 上下文（包含 taskId 和 cwd）
 * @returns GateResult
 */
export async function executeCheckpointQualityGate(
  checkpoints: CheckpointMetadata[],
  context?: CheckpointQualityGateContext
): Promise<GateResult> {
  const violations: ValidationViolation[] = [];

  // ── 同步验证器 ──
  const syncValidators: SyncValidator[] = [
    { id: 'checkpoint-required-prefix', check: checkpointRequiredPrefix.check.bind(checkpointRequiredPrefix) },
    { id: 'checkpoint-script-has-commands', check: checkpointScriptHasCommands.check.bind(checkpointScriptHasCommands) },
    { id: 'checkpoint-consistency-validator', check: checkpointConsistencyValidator.check.bind(checkpointConsistencyValidator) },
    { id: 'checkpoint-has-verification-commands', check: checkpointHasVerificationCommands.check.bind(checkpointHasVerificationCommands) },
  ];

  for (const validator of syncValidators) {
    const result = validator.check(checkpoints);
    if (result) {
      violations.push(result);
    }
  }

  // ── 异步验证器 ──
  if (context?.taskId && context?.cwd) {
    // checkpoint.md 格式验证
    const mdFormatViolation = await checkpointMdFormatValidatorAsync(checkpoints, context);
    if (mdFormatViolation) {
      violations.push(mdFormatViolation);
    }

    // 数据同步一致性验证
    const syncViolation = await checkpointSyncValidatorAsync(checkpoints, context);
    if (syncViolation) {
      violations.push(syncViolation);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * 仅执行同步验证器（快速检查，用于任务创建阶段）
 *
 * @param checkpoints - CheckpointMetadata 数组
 * @returns GateResult
 */
export function executeCheckpointQualityGateSync(
  checkpoints: CheckpointMetadata[]
): GateResult {
  const violations: ValidationViolation[] = [];

  const syncValidators: SyncValidator[] = [
    { id: 'checkpoint-required-prefix', check: checkpointRequiredPrefix.check.bind(checkpointRequiredPrefix) },
    { id: 'checkpoint-script-has-commands', check: checkpointScriptHasCommands.check.bind(checkpointScriptHasCommands) },
    { id: 'checkpoint-consistency-validator', check: checkpointConsistencyValidator.check.bind(checkpointConsistencyValidator) },
    { id: 'checkpoint-has-verification-commands', check: checkpointHasVerificationCommands.check.bind(checkpointHasVerificationCommands) },
  ];

  for (const validator of syncValidators) {
    const result = validator.check(checkpoints);
    if (result) {
      violations.push(result);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * 任务创建质量门禁结果
 */
export interface TaskCreationResult {
  /** 是否成功 */
  success: boolean;
  /** 检查点数组 */
  checkpoints?: CheckpointMetadata[];
  /** 错误信息 */
  error?: string;
  /** 违规项列表 */
  violations?: ValidationViolation[];
  /** 是否允许重试 */
  retryAllowed?: boolean;
}

/**
 * 任务创建完成后执行质量门禁
 *
 * @param checkpoints - CheckpointMetadata 数组
 * @param context - 上下文
 * @returns TaskCreationResult
 */
export async function validateCheckpointsAfterCreation(
  checkpoints: CheckpointMetadata[],
  context: CheckpointQualityGateContext
): Promise<TaskCreationResult> {
  const gateResult = await executeCheckpointQualityGate(checkpoints, context);

  if (!gateResult.passed) {
    // A 类门禁：失败即中断流水线，触发排错重试机制
    return {
      success: false,
      error: `检查点质量门禁失败: ${gateResult.violations.map(v => v.message).join('; ')}`,
      violations: gateResult.violations,
      retryAllowed: true, // 允许排错重试
    };
  }

  return { success: true, checkpoints };
}

/**
 * Pre-Dev Gate 检查结果
 */
export interface PreDevGateResult {
  /** 是否通过 */
  passed: boolean;
  /** 阶段标识 */
  phase: string;
  /** 违规项列表 */
  violations?: ValidationViolation[];
}

/**
 * Pre-Dev Gate 检查点验证（任务执行前复用）
 *
 * @param checkpoints - CheckpointMetadata 数组
 * @param context - 上下文
 * @returns PreDevGateResult
 */
export async function executePreDevCheckpointGate(
  checkpoints: CheckpointMetadata[],
  context: CheckpointQualityGateContext
): Promise<PreDevGateResult> {
  const gateResult = await executeCheckpointQualityGate(checkpoints, context);

  if (!gateResult.passed) {
    return {
      passed: false,
      phase: 'pre-dev',
      violations: gateResult.violations,
    };
  }

  return { passed: true, phase: 'pre-dev' };
}
