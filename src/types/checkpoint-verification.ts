/**
 * 检查点产出验证类型定义
 * 用于假成功检测机制
 */

/**
 * 检查点分类
 * 用于选择验证策略
 */
export type CheckpointOutputCategory =
  | 'implementation'   // 实现类检查点：验证代码变更
  | 'testing'          // 测试类检查点：验证测试文件和覆盖率
  | 'documentation'    // 文档类检查点：验证文档文件
  | 'review'           // 审核类检查点：验证审核记录
  | 'deployment'       // 部署类检查点：验证部署产物
  | 'configuration'    // 配置类检查点：验证配置文件
  | 'custom';          // 自定义检查点：需要自定义验证逻辑

/**
 * 验证结果
 */
export type VerificationResult = 'verified' | 'unverified' | 'failed' | 'skipped';

/**
 * 验证来源
 */
export type VerificationSource =
  | 'cli_manual'       // CLI 手动标记
  | 'phase_sync'       // 阶段自动同步
  | 'check_completed'  // checkCompletedCheckpoints 检测
  | 'analyze_fix';     // analyze --fix 修复

/**
 * 验证记录
 * 统一的验证记录格式，用于追踪产出验证结果
 */
export interface VerificationRecord {
  /** 验证来源 */
  source: VerificationSource;
  /** 验证结果 */
  result: VerificationResult;
  /** 验证证据（文件路径、命令输出等） */
  evidence?: string[];
  /** 验证者（系统或用户） */
  verifiedBy: string;
  /** 验证时间 */
  verifiedAt: string;
  /** 验证失败原因 */
  failureReason?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 验证策略
 * 定义如何验证特定类别的检查点
 */
export interface VerificationStrategy {
  /** 检查点类别 */
  category: CheckpointOutputCategory;
  /** 验证方法描述 */
  description: string;
  /** 证据类型列表（如：file_exists, test_passed, review_approved） */
  evidenceTypes: string[];
  /** 是否需要人工确认 */
  requiresHumanConfirmation: boolean;
  /** 自动验证函数名（可选） */
  autoVerifyFunction?: string;
}

/**
 * 验证上下文
 * 传递给验证器的上下文信息
 */
export interface VerificationContext {
  /** 任务 ID */
  taskId: string;
  /** 检查点 ID */
  checkpointId: string;
  /** 检查点描述 */
  checkpointDescription: string;
  /** 检查点类别 */
  category: CheckpointOutputCategory;
  /** 工作目录 */
  cwd: string;
  /** 验证来源 */
  source: VerificationSource;
  /** 已有的验证信息 */
  existingVerification?: {
    method?: string;
    result?: string;
    evidencePath?: string;
  };
  /** 阶段数据（用于阶段同步验证） */
  phaseData?: {
    phase?: 'development' | 'code_review' | 'qa' | 'evaluation';
    devReport?: unknown;
    codeReviewVerdict?: unknown;
    qaVerdict?: unknown;
  };
}

/**
 * 验证输出
 * 验证器的返回结果
 */
export interface VerificationOutput {
  /** 验证结果 */
  result: VerificationResult;
  /** 验证记录 */
  record: VerificationRecord;
  /** 警告信息（假成功检测） */
  warnings?: string[];
  /** 建议操作 */
  suggestedActions?: string[];
}
