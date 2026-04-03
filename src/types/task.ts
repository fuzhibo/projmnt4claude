/**
 * 任务类型
 */
export type TaskType = 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test';

/**
 * 任务优先级
 */
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

/**
 * 任务创建来源
 * 用于追踪任务是由哪个入口创建的
 */
export type TaskCreatedBy =
  | 'cli'              // 通过 task create 命令创建
  | 'init-requirement' // 通过 init-requirement 命令创建
  | 'harness-dev'      // 由 harness 开发阶段创建
  | 'harness-review'   // 由 harness 代码审核阶段创建
  | 'harness-qa'       // 由 harness QA 阶段创建
  | 'harness-eval'     // 由 harness 评估阶段创建
  | 'import';          // 通过导入/迁移创建

/**
 * 任务状态
 */
export type TaskStatus =
  | 'open'          // 待处理
  | 'in_progress'   // 进行中（开发阶段）
  | 'wait_review'   // 等待代码审核
  | 'wait_qa'       // 等待 QA 验证（可以是 AI 或 Human）
  | 'wait_complete' // 等待最终确认（所有检查点完成）
  | 'resolved'      // 已解决
  | 'closed'        // 已关闭
  | 'reopened'      // 已重开
  | 'abandoned'     // 已放弃
  | 'needs_human';  // 需要人工介入

/**
 * 任务历史记录条目
 */
export interface TaskHistoryEntry {
  timestamp: string;       // ISO时间
  action: string;          // 操作描述
  field?: string;          // 变更的字段名
  oldValue?: string;       // 旧值
  newValue?: string;       // 新值
  user?: string;           // 操作用户（可选）
  reason?: string;         // 状态变更原因（如reopen原因）
  relatedIssue?: string;   // 关联的 issue/PR
  verificationDetails?: string; // 验证失败详细信息
}

/**
 * 需求变更历史记录条目
 * 用于追踪任务描述/需求的变化过程
 */
export interface RequirementHistoryEntry {
  timestamp: string;       // ISO时间
  version: number;         // 需求版本号（从1开始）
  previousDescription?: string;  // 之前的描述内容
  newDescription: string;  // 新的描述内容
  changeReason: string;    // 变更原因
  impactAnalysis?: string; // 影响分析
  changedBy?: string;      // 变更人
  relatedIssue?: string;   // 关联的 issue/PR
  affectedCheckpoints?: string[]; // 受影响的检查点ID列表
}

/**
 * 验证方法类型
 * 注意：已移除 'manual' 类型，强制使用具体验证方法
 */
export type VerificationMethod =
  | 'code_review'       // 代码审查
  | 'lint'              // 静态检查
  | 'unit_test'         // 单元测试
  | 'functional_test'   // 功能测试
  | 'integration_test'  // 集成测试
  | 'e2e_test'          // 端到端测试
  | 'architect_review'  // 架构师审查
  | 'automated'         // 自动化验证（通用）
  | 'human_verification'; // 人工验证（需要用户介入）

/**
 * 任务角色类型
 * 用于标识任务当前的处理者角色
 */
export type TaskRole =
  | 'executor'        // 执行者（开发）
  | 'code_reviewer'   // 代码审核员
  | 'qa_tester'       // QA 测试员（可以是 AI 或 Human）
  | 'architect';      // 架构师

/**
 * 检查点类别
 */
export type CheckpointCategory =
  | 'code_review'      // 代码审核类检查点
  | 'qa_verification'; // QA 验证类检查点

/**
 * 检查点验证信息
 */
export interface CheckpointVerification {
  method: VerificationMethod;  // 验证方法（禁止使用 'manual'）
  commands?: string[];         // 验证命令列表
  steps?: string[];            // 验证步骤描述（当无法用命令表达时使用）
  expected?: string;           // 期望结果
  result?: string;             // 实际验证结果
  evidencePath?: string;       // 证据路径（相对路径）
  exitCode?: number;           // 命令退出码
  verifiedAt?: string;         // 验证时间
  verifiedBy?: string;         // 验证者
}

/**
 * 需要验证命令的验证方法类型
 * functional_test 等自动化验证方法必须包含 commands 或 steps
 */
const METHODS_REQUIRING_COMMANDS: VerificationMethod[] = [
  'functional_test',
  'unit_test',
  'integration_test',
  'e2e_test',
  'automated',
  'lint',
];

/**
 * 校验检查点的验证信息是否完整
 * - functional_test 等自动化方法必须有 commands 或 steps
 * - 返回校验结果和警告信息
 */
export function validateCheckpointVerification(
  checkpoint: { description: string; verification?: CheckpointVerification }
): { valid: boolean; warning?: string } {
  if (!checkpoint.verification) {
    return { valid: true };
  }

  const { method, commands, steps } = checkpoint.verification;

  if (METHODS_REQUIRING_COMMANDS.includes(method)) {
    const hasCommands = commands && commands.length > 0;
    const hasSteps = steps && steps.length > 0;

    if (!hasCommands && !hasSteps) {
      return {
        valid: false,
        warning: `检查点 "${checkpoint.description}" 的验证方法为 ${method}，但缺少 commands 或 steps`,
      };
    }
  }

  return { valid: true };
}

/**
 * 任务级验证信息
 * 当任务状态变为 resolved 时自动填充
 */
export interface TaskVerification {
  /** 验证时间 (resolved 时间) */
  verifiedAt: string;
  /** 验证者 (system 或用户名) */
  verifiedBy: string;
  /** 验证方法汇总 (来自检查点) */
  methods?: VerificationMethod[];
  /** 检查点完成率 */
  checkpointCompletionRate?: number;
  /** 验证结果: passed | partial | failed */
  result: 'passed' | 'partial' | 'failed';
  /** 备注 */
  note?: string;
}

/**
 * 任务级 Hook 类型
 */
export type TaskHookType =
  | 'preTaskCreate'     // 任务创建前
  | 'postTaskCreate'    // 任务创建后
  | 'preTaskUpdate'     // 任务更新前（关键！状态变更前）
  | 'postTaskUpdate'    // 任务更新后
  | 'preTaskComplete'   // 任务完成前（关键！验证检查点）
  | 'postTaskComplete'; // 任务完成后

/**
 * 任务级 Hook 配置
 */
export interface TaskHookConfig {
  enabled: boolean;
  hooks: {
    preTaskUpdate?: boolean;
    preTaskComplete?: boolean;
    postTaskUpdate?: boolean;
    postTaskComplete?: boolean;
  };
  scriptPath?: string;  // 自定义验证脚本路径
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook 执行上下文
 */
export interface HookExecutionContext {
  hookType: TaskHookType;
  taskId: string;
  oldStatus?: TaskStatus;
  newStatus?: TaskStatus;
  taskData: TaskMeta;
  cwd: string;
}

/**
 * Hook 执行结果
 */
export interface HookResult {
  success: boolean;
  message?: string;
  details?: string[];
  shouldBlock?: boolean;  // 是否阻止操作
}

/**
 * 验证错误
 */
export interface ValidationError {
  code: string;
  message: string;
  details?: string[];
}

/**
 * 验证警告
 */
export interface ValidationWarning {
  code: string;
  message: string;
  details?: string[];
}

/**
 * 任务验证结果
 */
export interface TaskValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  evidenceCollected: string[];
}

/**
 * 检查点元数据
 */
export interface CheckpointMetadata {
  id: string;                      // 检查点ID，如 CP-001 或 CP-check-screenshot
  description: string;             // 描述（与 checkpoint.md 中的文本对应）
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  category?: CheckpointCategory;   // 检查点类别（代码审核/QA验证）
  requiredRole?: TaskRole;         // 执行此检查点所需角色
  requiresHuman?: boolean;         // 是否需要人工验证
  note?: string;                   // 备注
  verification?: CheckpointVerification;
  createdAt: string;
  updatedAt: string;
}

/**
 * 批次提交历史条目
 * 用于追踪 harness pipeline 批次 git commit 与任务的关联
 */
export interface CommitHistoryEntry {
  /** Git commit SHA */
  sha: string;
  /** 批次标签（如 "批次 1"） */
  batchLabel: string;
  /** 提交时间 (ISO) */
  timestamp: string;
}

/**
 * 执行统计信息
 */
export interface ExecutionStats {
  /** 执行耗时(毫秒) */
  duration: number;
  /** 重试次数 */
  retryCount: number;
  /** 执行完成时间 */
  completedAt: string;
  /** 分支信息 */
  branch?: string;
  /** 标签信息 */
  tags?: string[];
  /** 批次提交历史（harness pipeline 批次 git commit SHA 追踪） */
  commitHistory?: CommitHistoryEntry[];
}

/**
 * 当前任务元数据 schema 版本
 * 每次规范变更时递增，analyze 命令据此进行增量迁移
 *
 * 版本历史:
 * - 0: 无 schemaVersion 字段（旧版任务）
 * - 1: 添加 reopenCount + requirementHistory（legacy_schema）
 * - 2: pipeline_status 规范化 + verdict_action_schema 验证
 */
export const CURRENT_TASK_SCHEMA_VERSION = 3;

/**
 * 流水线中间状态列表
 * 这些状态仅用于 harness pipeline 执行期间，旧任务若停留在此状态
 * 表示 pipeline 中断或使用了旧版规范
 */
export const PIPELINE_INTERMEDIATE_STATUSES: TaskStatus[] = [
  'wait_review',
  'wait_qa',
  'wait_complete',
  'needs_human',
];

/**
 * 流水线状态迁移映射
 * 旧版 pipeline 中间状态 → 最新规范状态
 */
export const PIPELINE_STATUS_MIGRATION_MAP: Record<string, TaskStatus> = {
  'needs_human': 'open',       // 需要人工介入 → 重置为待处理
  'wait_review': 'in_progress', // 等待代码审核 → 回到开发中
  'wait_qa': 'in_progress',    // 等待 QA → 回到开发中
  'wait_complete': 'resolved',  // 等待最终确认 → 标记为已解决
};

/**
 * 任务元数据接口
 */
export interface TaskMeta {
  id: string;              // 任务ID
  title: string;           // 标题
  description?: string;    // 描述（可选）
  type: TaskType;          // 任务类型
  priority: TaskPriority;  // 优先级
  status: TaskStatus;      // 状态
  dependencies: string[];  // 依赖的任务ID列表
  recommendedRole?: string; // 推荐角色
  branch?: string;         // 关联分支
  needsDiscussion?: boolean; // 是否需要讨论
  discussionTopics?: string[]; // 讨论主题列表
  checkpointConfirmationToken?: string; // 检查点确认令牌
  checkpoints?: CheckpointMetadata[];  // 检查点元数据
  parentId?: string;       // 父任务ID（子任务时使用）
  subtaskIds?: string[];   // 子任务ID列表（父任务时使用）
  createdAt: string;       // ISO时间
  updatedAt: string;       // ISO时间
  history: TaskHistoryEntry[]; // 历史记录
  reopenCount?: number;    // 重开次数（任务被重新打开的次数）
  requirementHistory?: RequirementHistoryEntry[]; // 需求变更历史
  verification?: TaskVerification; // 任务级验证信息（resolved时自动填充）
  executionStats?: ExecutionStats; // 执行统计信息（流水线完成后记录）
  fileWarnings?: string[];        // 创建时引用但不存在的文件路径
  createdBy?: TaskCreatedBy;      // 任务创建来源
  schemaVersion?: number;         // schema 版本号，用于增量迁移
}

/**
 * 任务ID解析结果
 */
export interface TaskIdInfo {
  valid: boolean;
  format: 'new' | 'old' | 'unknown';
  type?: TaskType;
  priority?: string;
  slug?: string;
  date?: string;
  raw: string;
}

/**
 * 待人工验证条目
 * 用于在 headless 模式下收集需要人工验证的检查点
 */
export interface PendingVerification {
  /** 任务ID */
  taskId: string;
  /** 任务标题 */
  taskTitle: string;
  /** 检查点ID */
  checkpointId: string;
  /** 检查点描述 */
  checkpointDescription: string;
  /** 验证步骤 */
  verificationSteps?: string[];
  /** 期望结果 */
  expectedResult?: string;
  /** 入队时间 */
  enqueuedAt: string;
  /** 验证状态: pending | approved | rejected */
  status: 'pending' | 'approved' | 'rejected';
  /** 验证人 */
  verifiedBy?: string;
  /** 验证时间 */
  verifiedAt?: string;
  /** 验证反馈 */
  feedback?: string;
  /** 关联的流水线会话ID */
  sessionId?: string;
}

/**
 * 待验证队列文件结构
 */
export interface PendingVerificationQueue {
  /** 队列版本 */
  version: 1;
  /** 队列条目 */
  items: PendingVerification[];
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 创建默认任务元数据
 */
export function createDefaultTaskMeta(
  id: string,
  title: string,
  type: TaskType = 'feature',
  description?: string,
  createdBy?: TaskCreatedBy
): TaskMeta {
  const now = new Date().toISOString();
  return {
    id,
    title,
    description,
    type,
    priority: 'P2',
    status: 'open',
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy,
    schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
  };
}

/**
 * 验证任务ID格式
 * 支持多种格式:
 * - 新格式: TASK-{type}-{priority}-{slug}-{date}
 * - 旧格式: TASK-001
 * - 任意格式: 只要是非空字符串且包含字母、数字、连字符
 */
export function isValidTaskId(id: string): boolean {
  if (!id || id.trim().length === 0) {
    return false;
  }
  // 放宽验证：允许任何非空字符串作为任务ID
  return /^[a-zA-Z0-9\-_]+$/.test(id);
}

/**
 * 解析任务ID
 */
export function parseTaskId(id: string): TaskIdInfo {
  // 旧格式: TASK-001
  if (/^TASK-\d{3,}$/.test(id)) {
    return {
      valid: true,
      format: 'old',
      raw: id,
    };
  }

  // 新格式: TASK-{type}-{priority}-{slug}-{date}
  const newFormat = /^TASK-(bug|feature|research|docs|refactor|test)-([PQ]\d)-([a-z0-9\-]+)-(\d{8})(?:-\d+)?$/;
  const match = id.match(newFormat);

  if (match) {
    return {
      valid: true,
      format: 'new',
      type: match[1] as TaskType,
      priority: match[2],
      slug: match[3],
      date: match[4],
      raw: id,
    };
  }

  // 兼容旧的新格式（没有type）: TASK-P1-user-auth-open-auth-20260306
  const legacyFormat = /^TASK-([PQ]\d)-([a-z0-9\-]+)-([a-z]+)-([a-z0-9]+)-(\d{8})(?:-\d+)?$/;
  const legacyMatch = id.match(legacyFormat);

  if (legacyMatch) {
    return {
      valid: true,
      format: 'new', // 标记为新格式但缺少type
      priority: legacyMatch[1],
      slug: legacyMatch[2],
      date: legacyMatch[5],
      raw: id,
    };
  }

  // 宽松格式：TASK-{任意内容}
  if (id.startsWith('TASK-') && id.length > 5) {
    return {
      valid: true,
      format: 'unknown',
      raw: id,
    };
  }

  return {
    valid: false,
    format: 'unknown',
    raw: id,
  };
}

/**
 * 检查是否为旧格式任务ID
 */
export function isOldFormatTaskId(id: string): boolean {
  return /^TASK-\d{3,}$/.test(id);
}

/**
 * 检查是否需要转换（旧格式或缺少type的新格式）
 */
export function needsConversion(id: string): boolean {
  const info = parseTaskId(id);
  return info.valid && (info.format === 'old' || !info.type);
}

/**
 * 生成任务ID (新格式)
 * 格式: TASK-{type}-{priority}-{slug}-{date}
 * 例如: TASK-feature-P1-user-auth-20260306
 */
export function generateTaskId(
  type: TaskType,
  priority: TaskPriority,
  title: string,
  existingIds: string[] = []
): string {
  // 从标题生成 slug
  // 第一步：尝试提取 ASCII 单词和数字
  const asciiParts = title.match(/[a-zA-Z][a-zA-Z0-9]*|\d+/g);
  let slug: string;

  if (asciiParts && asciiParts.length > 0) {
    // 标题包含英文/数字部分，直接使用
    slug = asciiParts
      .join('-')
      .toLowerCase()
      .substring(0, 40);
  } else {
    // 纯非ASCII标题（如中文），使用类型缩写+哈希生成有意义标识
    const typePrefix: Record<string, string> = {
      feature: 'feat',
      bugfix: 'fix',
      refactor: 'ref',
      docs: 'doc',
      test: 'test',
      chore: 'chore',
    };
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
    }
    const prefix = typePrefix[type] || 'task';
    slug = `${prefix}-${Math.abs(hash).toString(36)}`;
  }

  // 生成日期字符串
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // 生成新格式 ID
  let newId = `TASK-${type}-${priority}-${slug}-${date}`;

  // 检查是否已存在
  if (existingIds.includes(newId)) {
    let counter = 1;
    while (existingIds.includes(`${newId}-${counter}`)) {
      counter++;
    }
    newId = `${newId}-${counter}`;
  }

  return newId;
}

/**
 * 转换旧格式任务ID为新格式
 */
export function convertTaskId(
  oldId: string,
  type: TaskType,
  priority: TaskPriority,
  title: string,
  existingIds: string[] = []
): string {
  // 如果已经是新格式且有type，直接返回
  const info = parseTaskId(oldId);
  if (info.format === 'new' && info.type) {
    return oldId;
  }

  // 生成新格式ID
  return generateTaskId(type, priority, title, existingIds);
}

/**
 * 从标题推断任务类型
 */
export function inferTaskType(title: string): TaskType {
  const lowerTitle = title.toLowerCase();

  // Bug 关键词
  if (/\b(fix|bug|error|issue|crash|broken|fail|problem|修复|错误|问题|故障)\b/.test(lowerTitle)) {
    return 'bug';
  }

  // Research 关键词
  if (/\b(research|investigate|analyze|study|explore|调研|研究|分析|探索)\b/.test(lowerTitle)) {
    return 'research';
  }

  // Docs 关键词
  if (/\b(doc|document|readme|guide|manual|文档|说明|指南)\b/.test(lowerTitle)) {
    return 'docs';
  }

  // Refactor 关键词
  if (/\b(refactor|clean|improve|optimize|restructure|重构|优化|改进)\b/.test(lowerTitle)) {
    return 'refactor';
  }

  // Test 关键词
  if (/\b(test|spec|coverage|测试|单元测试|集成测试)\b/.test(lowerTitle)) {
    return 'test';
  }

  // 默认为 feature
  return 'feature';
}

/**
 * 从标题推断优先级
 */
export function inferTaskPriority(title: string): TaskPriority {
  const lowerTitle = title.toLowerCase();

  if (/\b(urgent|critical|asap|紧急|严重|立即)\b/.test(lowerTitle)) {
    return 'P0';
  }

  if (/\b(important|high|优先|重要)\b/.test(lowerTitle)) {
    return 'P1';
  }

  if (/\b(low|optional|可选|低)\b/.test(lowerTitle)) {
    return 'P3';
  }

  return 'P2';
}

/**
 * 生成下一个任务ID (旧格式，保持兼容)
 */
export function generateNextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) {
    return 'TASK-001';
  }

  const numbers = existingIds
    .map(id => {
      const match = id.match(/^TASK-(\d+)$/);
      return match ? parseInt(match[1]!, 10) : 0;
    })
    .filter(n => n > 0);

  const maxNumber = Math.max(...numbers, 0);
  return `TASK-${String(maxNumber + 1).padStart(3, '0')}`;
}
