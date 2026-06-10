/**
 * Harness State - 状态管理封装层
 *
 * 从 hd-state.ts 重新导出状态管理功能
 * 提供与 harness.ts 中状态函数的兼容接口
 */

export {
  saveState,
  loadState,
  validateState,
  updateStateProgress,
  transitionPhase,
  createDefaultState,
  clearState,
  getStateFilePath,
  type StateValidationError,
  type StateValidationResult,
} from './hd-state.js';

// 从 types 重新导出类型
export type {
  HarnessRuntimeState,
  HarnessConfig,
  PhaseCheckpoint,
} from '../types/harness.js';

export { createDefaultRuntimeState } from '../types/harness.js';
