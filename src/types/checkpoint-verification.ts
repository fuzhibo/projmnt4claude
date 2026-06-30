/**
 * System B 前缀分类
 * 用于 CP-008 B 类门禁的 System B 前缀验证策略
 */
export type SystemBPrefix =
  | 'ai-review'       // [ai review] 代码审查检查点
  | 'ai-qa'           // [ai qa] QA 验证检查点
  | 'human-qa'        // [human qa] 人工 QA 检查点
  | 'script';         // [script] 脚本执行检查点

/**
 * 扩展的验证策略（CP-008 B 类门禁）
 * 在基础 VerificationStrategy 上增加 System B 特有验证字段
 */
export interface SystemBVerificationStrategy {
  /** 是否验证文件产出 */
  verifyFiles: boolean;
  /** 是否验证代码变更 */
  verifyCodeChange: boolean;
  /** 是否验证测试 */
  verifyTests: boolean;
  /** 是否验证覆盖率 */
  verifyCoverage: boolean;
  /** 是否验证报告 */
  verifyReport: boolean;
  /** 是否验证自定义命令 */
  verifyCommands: boolean;
  /** 是否验证 expected 字段（CP-008 新增） */
  verifyExpected: boolean;
}

/**
 * System B 分类策略映射
 */
export const SYSTEM_B_CATEGORY_STRATEGIES: Record<SystemBPrefix, SystemBVerificationStrategy> = {
  'ai-review': {
    verifyFiles: true,
    verifyCodeChange: true,
    verifyTests: false,
    verifyCoverage: false,
    verifyReport: true,
    verifyCommands: false,
    verifyExpected: true,
  },
  'ai-qa': {
    verifyFiles: true,
    verifyCodeChange: false,
    verifyTests: true,
    verifyCoverage: true,
    verifyReport: false,
    verifyCommands: false,
    verifyExpected: true,
  },
  'human-qa': {
    verifyFiles: false,
    verifyCodeChange: false,
    verifyTests: false,
    verifyCoverage: false,
    verifyReport: true,
    verifyCommands: false,
    verifyExpected: true,
  },
  'script': {
    verifyFiles: false,
    verifyCodeChange: false,
    verifyTests: false,
    verifyCoverage: false,
    verifyReport: false,
    verifyCommands: true,
    verifyExpected: true,
  },
};

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
  | 'phase_sync'       // 阶段自动同步（通用）
  | 'phase_sync_dev'   // 开发阶段自动同步
  | 'phase_sync_cr'    // 代码审查阶段自动同步
  | 'phase_sync_qa'    // QA 阶段自动同步
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
    /** CP-008: expected 字段，用于验证产出是否符合预期 */
    expected?: string;
  };
  /** 阶段数据（用于阶段同步验证） */
  phaseData?: {
    phase?: 'development' | 'code_review' | 'qa' | 'evaluation';
    devReport?: { status?: string; files?: string[] };
    codeReviewVerdict?: { result?: string; filesReviewed?: string[]; reportPath?: string; approved?: boolean };
    qaVerdict?: { result?: string; testFiles?: string[]; coverage?: number; approved?: boolean };
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
