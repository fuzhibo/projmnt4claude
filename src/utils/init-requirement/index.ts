/**
 * init-requirement 基础架构模块入口
 *
 * 导出所有公开 API，供 commands/init-requirement 使用
 */

// 类型
export type {
  ParsedCheckpoint,
  ConversionState,
  ConversionTaskDetail,
  ConversionStatus,
  GateFixResult,
  AlignmentResult,
  GateFailureSource,
  GateFailure,
  GateDependencies,
} from './types.js';

export { DEFAULT_QUALITY_GATE_CONFIG } from './types.js';

// 前缀映射与检查点解析
export {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  hasValidPrefix,
} from './prefix-map.js';

export type { CheckpointPrefix } from './prefix-map.js';

// 验证命令生成
export { generateVerificationCommands } from './verification-commands.js';

// 转换状态管理
export {
  loadConversionStatus,
  createEmptyConversionStatus,
  updateConversionStatus,
  getPendingReports,
  topologicalSort,
} from './conversion-status.js';

// 门禁检查与修正
export { gateCheckAndFix } from './gate-check-fix.js';