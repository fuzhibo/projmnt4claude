/**
 * 任务类型
 */
export type TaskType = 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test';

/**
 * 任务优先级
 */
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

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
  | 'abandoned';    // 已放弃

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
  expected?: string;           // 期望结果
  result?: string;             // 实际验证结果
  evidencePath?: string;       // 证据路径（相对路径）
  exitCode?: number;           // 命令退出码
  verifiedAt?: string;         // 验证时间
  verifiedBy?: string;         // 验证者
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
 * 创建默认任务元数据
 */
export function createDefaultTaskMeta(
  id: string,
  title: string,
  type: TaskType = 'feature',
  description?: string
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
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);

  // 中文标题（或纯非ASCII标题）经过上述处理后 slug 为空，
  // 使用标题的短哈希作为有意义的标识
  if (!slug) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
    }
    slug = `t${Math.abs(hash).toString(36)}`;
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
