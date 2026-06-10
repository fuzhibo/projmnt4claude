/**
 * HD State - Harness Design 状态管理模块
 *
 * 提供状态保存、加载、验证和进度更新的核心功能
 * 从 harness.ts 中提取的状态管理逻辑
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HarnessRuntimeState, HarnessConfig, PhaseCheckpoint } from '../types/harness.js';
import { createDefaultRuntimeState } from '../types/harness.js';

/**
 * 状态文件路径
 */
export function getStateFilePath(cwd: string): string {
  return path.join(cwd, '.projmnt4claude', 'harness-state.json');
}

/**
 * 状态验证错误
 */
export interface StateValidationError {
  field: string;
  expectedType: string;
  actualValue: unknown;
  message: string;
}

/**
 * 状态验证结果
 */
export interface StateValidationResult {
  valid: boolean;
  repaired: boolean;
  repairedFields: string[];
  errors: StateValidationError[];
}

/**
 * 验证状态字段
 *
 * CP-007/008/009: validateState 状态验证
 * - 正常输入处理：验证所有必需字段
 * - 边界条件处理：缺失可选字段时提供默认值
 * - 异常输入处理：无效字段记录错误
 */
export function validateState(
  data: Record<string, unknown>,
  cwd: string
): { data: HarnessRuntimeState | null; validation: StateValidationResult } {
  const errors: StateValidationError[] = [];
  const repairedFields: string[] = [];
  let repaired = false;

  // Handle null/undefined data
  if (!data || typeof data !== 'object') {
    return {
      data: null,
      validation: {
        valid: false,
        repaired: false,
        repairedFields: [],
        errors: [{
          field: 'root',
          expectedType: 'object',
          actualValue: data,
          message: 'State data must be a non-null object',
        }],
      },
    };
  }

  // 必需字段检查
  const requiredFields: Array<{ field: string; type: string }> = [
    { field: 'state', type: 'string' },
    { field: 'config', type: 'object' },
    { field: 'taskQueue', type: 'array' },
    { field: 'currentIndex', type: 'number' },
    { field: 'startTime', type: 'string' },
    { field: 'updatedAt', type: 'string' },
  ];

  for (const { field, type } of requiredFields) {
    if (!(field in data)) {
      errors.push({
        field,
        expectedType: type,
        actualValue: undefined,
        message: `Missing required field: ${field}`,
      });
    } else if (typeof data[field] !== type) {
      if (type === 'array' && !Array.isArray(data[field])) {
        errors.push({
          field,
          expectedType: type,
          actualValue: data[field],
          message: `Field ${field} should be ${type}, got ${typeof data[field]}`,
        });
      } else if (type !== 'array' && typeof data[field] !== type) {
        errors.push({
          field,
          expectedType: type,
          actualValue: data[field],
          message: `Field ${field} should be ${type}, got ${typeof data[field]}`,
        });
      }
    }
  }

  // 如果有必需字段错误，返回 null
  if (errors.length > 0) {
    return {
      data: null,
      validation: { valid: false, repaired: false, repairedFields: [], errors },
    };
  }

  // 安全提取 config
  const config = data.config as HarnessConfig;

  // 创建基础状态对象
  const state: HarnessRuntimeState = {
    state: data.state as HarnessRuntimeState['state'],
    config,
    taskQueue: data.taskQueue as string[],
    currentIndex: data.currentIndex as number,
    startTime: data.startTime as string,
    updatedAt: data.updatedAt as string,
    retryCounter: new Map(),
    resumeFrom: new Map(),
    phaseRetryCounters: new Map(),
    taskPhaseCheckpoints: new Map(),
  };

  // 可选字段修复
  // retryCounter - Map 恢复
  if (data.retryCounter && typeof data.retryCounter === 'object') {
    try {
      state.retryCounter = new Map(Object.entries(data.retryCounter as Record<string, number>));
    } catch {
      repaired = true;
      repairedFields.push('retryCounter');
      state.retryCounter = new Map();
    }
  } else {
    repaired = true;
    repairedFields.push('retryCounter');
    state.retryCounter = new Map();
  }

  // resumeFrom - Map 恢复
  if (data.resumeFrom && typeof data.resumeFrom === 'object') {
    try {
      state.resumeFrom = new Map(Object.entries(data.resumeFrom as Record<string, string>));
    } catch {
      repaired = true;
      repairedFields.push('resumeFrom');
      state.resumeFrom = new Map();
    }
  } else {
    repaired = true;
    repairedFields.push('resumeFrom');
    state.resumeFrom = new Map();
  }

  // phaseRetryCounters - Map 恢复
  if (data.phaseRetryCounters && typeof data.phaseRetryCounters === 'object') {
    try {
      state.phaseRetryCounters = new Map(
        Object.entries(data.phaseRetryCounters as Record<string, number>)
      );
    } catch {
      repaired = true;
      repairedFields.push('phaseRetryCounters');
      state.phaseRetryCounters = new Map();
    }
  } else {
    repaired = true;
    repairedFields.push('phaseRetryCounters');
    state.phaseRetryCounters = new Map();
  }

  // taskPhaseCheckpoints - Map 恢复
  if (data.taskPhaseCheckpoints && typeof data.taskPhaseCheckpoints === 'object') {
    try {
      const checkpoints = data.taskPhaseCheckpoints as Record<string, {
        completedPhase: 'development' | 'code_review' | 'qa' | 'evaluation';
        completedAt: string;
      }>;
      state.taskPhaseCheckpoints = new Map(Object.entries(checkpoints));
    } catch {
      repaired = true;
      repairedFields.push('taskPhaseCheckpoints');
      state.taskPhaseCheckpoints = new Map();
    }
  } else {
    repaired = true;
    repairedFields.push('taskPhaseCheckpoints');
    state.taskPhaseCheckpoints = new Map();
  }

  // batchBoundaries - 数组修复
  if (Array.isArray(data.batchBoundaries)) {
    state.batchBoundaries = data.batchBoundaries as number[];
  } else {
    repaired = true;
    repairedFields.push('batchBoundaries');
    state.batchBoundaries = [];
  }

  // batchLabels - 数组修复
  if (Array.isArray(data.batchLabels)) {
    state.batchLabels = data.batchLabels as string[];
  } else {
    repaired = true;
    repairedFields.push('batchLabels');
    state.batchLabels = [];
  }

  // batchParallelizable - 数组修复
  if (Array.isArray(data.batchParallelizable)) {
    state.batchParallelizable = data.batchParallelizable as boolean[];
  } else {
    repaired = true;
    repairedFields.push('batchParallelizable');
    state.batchParallelizable = [];
  }

  // passedTasks - 数组修复
  if (Array.isArray(data.passedTasks)) {
    state.passedTasks = data.passedTasks as string[];
  } else {
    repaired = true;
    repairedFields.push('passedTasks');
    state.passedTasks = [];
  }

  // failedTasks - 数组修复
  if (Array.isArray(data.failedTasks)) {
    state.failedTasks = data.failedTasks as string[];
  } else {
    repaired = true;
    repairedFields.push('failedTasks');
    state.failedTasks = [];
  }

  // retryingTasks - 数组修复
  if (Array.isArray(data.retryingTasks)) {
    state.retryingTasks = data.retryingTasks as string[];
  } else {
    repaired = true;
    repairedFields.push('retryingTasks');
    state.retryingTasks = [];
  }

  return {
    data: state,
    validation: {
      valid: errors.length === 0,
      repaired,
      repairedFields,
      errors,
    },
  };
}

/**
 * 保存状态
 *
 * CP-001/002/003: saveState 保存状态
 * - 正常输入处理：序列化状态并写入文件
 * - 边界条件处理：空 Map 序列化为空对象
 * - 异常输入处理：目录不存在时创建目录
 */
export function saveState(state: HarnessRuntimeState, cwd: string): void {
  const statePath = getStateFilePath(cwd);

  // 确保目录存在
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 序列化状态
  const data = {
    ...state,
    stateFormatVersion: 2,
    retryCounter: Object.fromEntries(state.retryCounter),
    resumeFrom: Object.fromEntries(state.resumeFrom || new Map()),
    phaseRetryCounters: Object.fromEntries(state.phaseRetryCounters || new Map()),
    taskPhaseCheckpoints: Object.fromEntries(state.taskPhaseCheckpoints || new Map()),
  };

  fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 加载状态
 *
 * CP-004/005/006: loadState 加载状态
 * - 正常输入处理：读取并解析状态文件
 * - 边界条件处理：文件不存在返回 null
 * - 异常输入处理：无效 JSON 返回 null
 */
export function loadState(cwd: string): HarnessRuntimeState | null {
  const statePath = getStateFilePath(cwd);

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');

    // 空文件处理
    if (!content.trim()) {
      return null;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(content);
    } catch {
      // JSON 解析失败
      return null;
    }

    // 基础结构检查
    if (!data || typeof data !== 'object') {
      return null;
    }

    // 版本检查
    const version = data.stateFormatVersion ?? 0;
    if (version < 1 || version > 2) {
      return null;
    }

    // v1 → v2 自动迁移
    if (version === 1) {
      data.stateFormatVersion = 2;
    }

    // 验证状态
    const { data: validatedState } = validateState(data, cwd);

    return validatedState;
  } catch {
    return null;
  }
}

/**
 * 更新状态进度
 *
 * CP-010/011/012: updateStateProgress 更新进度
 * - 正常输入处理：更新 currentIndex 和 updatedAt
 * - 边界条件处理：index 超出范围时调整
 * - 异常输入处理：无效状态不更新
 */
export function updateStateProgress(
  state: HarnessRuntimeState,
  updates: {
    currentIndex?: number;
    passedTask?: string;
    failedTask?: string;
    retryingTask?: string;
    retryIncrement?: { taskId: string; count: number };
    phaseCheckpoint?: {
      taskId: string;
      phase: 'development' | 'code_review' | 'qa' | 'evaluation';
      completedAt: string;
    };
    phaseRetryIncrement?: { taskId: string; phase: string; count: number };
    state?: HarnessRuntimeState['state'];
  }
): HarnessRuntimeState {
  const newState = { ...state };

  // 更新时间戳
  newState.updatedAt = new Date().toISOString();

  // 更新 currentIndex
  if (updates.currentIndex !== undefined) {
    // 边界检查
    const maxIndex = newState.taskQueue.length - 1;
    const newIndex = Math.max(0, Math.min(updates.currentIndex, maxIndex));
    newState.currentIndex = newIndex;
  }

  // 更新状态
  if (updates.state !== undefined) {
    newState.state = updates.state;
  }

  // 添加 passed task
  if (updates.passedTask !== undefined) {
    if (!newState.passedTasks?.includes(updates.passedTask)) {
      newState.passedTasks = [...(newState.passedTasks || []), updates.passedTask];
    }
    // 从 retrying 移除
    newState.retryingTasks = newState.retryingTasks?.filter(t => t !== updates.passedTask) || [];
  }

  // 添加 failed task
  if (updates.failedTask !== undefined) {
    if (!newState.failedTasks?.includes(updates.failedTask)) {
      newState.failedTasks = [...(newState.failedTasks || []), updates.failedTask];
    }
    // 从 retrying 移除
    newState.retryingTasks = newState.retryingTasks?.filter(t => t !== updates.failedTask) || [];
  }

  // 添加 retrying task
  if (updates.retryingTask !== undefined) {
    if (!newState.retryingTasks?.includes(updates.retryingTask)) {
      newState.retryingTasks = [...(newState.retryingTasks || []), updates.retryingTask];
    }
  }

  // 增加重试计数
  if (updates.retryIncrement !== undefined) {
    const { taskId, count } = updates.retryIncrement;
    const current = newState.retryCounter.get(taskId) || 0;
    newState.retryCounter = new Map(newState.retryCounter);
    newState.retryCounter.set(taskId, current + count);
  }

  // 增加 phase 重试计数
  if (updates.phaseRetryIncrement !== undefined) {
    const { taskId, phase, count } = updates.phaseRetryIncrement;
    const key = `${taskId}:${phase}`;
    const current = newState.phaseRetryCounters.get(key) || 0;
    newState.phaseRetryCounters = new Map(newState.phaseRetryCounters);
    newState.phaseRetryCounters.set(key, current + count);
  }

  // 更新 phase checkpoint
  if (updates.phaseCheckpoint !== undefined) {
    const { taskId, phase, completedAt } = updates.phaseCheckpoint;
    newState.taskPhaseCheckpoints = new Map(newState.taskPhaseCheckpoints);
    newState.taskPhaseCheckpoints.set(taskId, { completedPhase: phase, completedAt });
  }

  return newState;
}

/**
 * 阶段状态转换
 *
 * CP-013/014/015: phase 状态转换
 * - 正常输入处理：正确转换到目标阶段
 * - 边界条件处理：无效阶段不转换
 * - 异常输入处理：空状态返回默认状态
 */
export function transitionPhase(
  state: HarnessRuntimeState,
  taskId: string,
  targetPhase: 'development' | 'code_review' | 'qa' | 'evaluation'
): HarnessRuntimeState {
  if (!taskId || !targetPhase) {
    return state;
  }

  const newState = { ...state };
  newState.updatedAt = new Date().toISOString();

  // 更新 resumeFrom 指向目标阶段
  newState.resumeFrom = new Map(newState.resumeFrom);
  newState.resumeFrom.set(taskId, targetPhase);

  return newState;
}

/**
 * 创建默认状态
 */
export function createDefaultState(config: HarnessConfig): HarnessRuntimeState {
  return createDefaultRuntimeState(config);
}

/**
 * 清理状态文件
 */
export function clearState(cwd: string): void {
  const statePath = getStateFilePath(cwd);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}