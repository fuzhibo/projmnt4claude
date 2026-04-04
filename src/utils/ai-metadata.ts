/**
 * AI 元数据助手模块
 *
 * 共享 AI 元数据提取能力，基于 HeadlessAgent 接口实现。
 * 支持需求增强、检查点生成、质量评估、重复检测等功能。
 *
 * 设计原则:
 * - 单次调用 ~500-1000 tokens，~10-15 秒
 * - 严格输出验证: JSON schema 校验 + 失败自动重试 (最多 2 次)
 * - 超时 30 秒/次，Claude 不可用时回退到规则引擎
 * - 只输出 JSON，不要 markdown 代码块包裹
 * - 如果无法判断某个字段，设为 null 而非猜测
 */

import { Logger } from './logger.js';
import { getAgent, type HeadlessAgent, type AgentResult, type AgentInvokeOptions } from './headless-agent.js';
import type { TaskMeta, TaskPriority, TaskType } from '../types/task';
import { inferTaskType, inferTaskPriority } from '../types/task';

// ============================================================
// 架构层级分类 (Layer0-Layer3)
// ============================================================

/**
 * 架构层级枚举
 * 用于任务拆分时按依赖顺序排列
 */
export type ArchitectureLayer = 'Layer0' | 'Layer1' | 'Layer2' | 'Layer3';

/**
 * 层级定义与描述
 */
export const LAYER_DEFINITIONS: Record<ArchitectureLayer, { label: string; description: string; pathPatterns: string[] }> = {
  Layer0: {
    label: '类型定义层',
    description: '基础类型、接口、枚举定义，被所有上层模块依赖',
    pathPatterns: ['src/types/', 'src/interfaces/', 'src/schemas/'],
  },
  Layer1: {
    label: '工具函数层',
    description: '纯函数工具、辅助模块，依赖类型层但不依赖命令层',
    pathPatterns: ['src/utils/', 'src/helpers/', 'src/lib/'],
  },
  Layer2: {
    label: '核心逻辑层',
    description: '核心业务逻辑、数据处理，依赖工具层和类型层',
    pathPatterns: ['src/core/', 'src/services/', 'src/processors/'],
  },
  Layer3: {
    label: '命令/入口层',
    description: 'CLI 命令、入口文件，依赖所有下层模块',
    pathPatterns: ['src/commands/', 'src/index.ts', 'src/cli/'],
  },
};

/**
 * 根据文件路径推断所属架构层级
 */
export function classifyFileToLayer(filePath: string): ArchitectureLayer {
  const normalized = filePath.replace(/\\/g, '/');
  // 从高依赖层（Layer3）到低依赖层（Layer0）匹配
  if (normalized.includes('src/commands/') || normalized.includes('src/cli/') || normalized.endsWith('src/index.ts')) {
    return 'Layer3';
  }
  if (normalized.includes('src/core/') || normalized.includes('src/services/') || normalized.includes('src/processors/')) {
    return 'Layer2';
  }
  if (normalized.includes('src/utils/') || normalized.includes('src/helpers/') || normalized.includes('src/lib/')) {
    return 'Layer1';
  }
  if (normalized.includes('src/types/') || normalized.includes('src/interfaces/') || normalized.includes('src/schemas/')) {
    return 'Layer0';
  }
  // 默认归为工具层
  return 'Layer1';
}

/**
 * 对文件列表按架构层级排序（Layer0 → Layer3）
 */
export function sortFilesByLayer(files: string[]): string[] {
  const layerOrder: Record<ArchitectureLayer, number> = { Layer0: 0, Layer1: 1, Layer2: 2, Layer3: 3 };
  return [...files].sort((a, b) => layerOrder[classifyFileToLayer(a)] - layerOrder[classifyFileToLayer(b)]);
}

/**
 * 将文件列表按层级分组
 */
export function groupFilesByLayer(files: string[]): Map<ArchitectureLayer, string[]> {
  const groups = new Map<ArchitectureLayer, string[]>();
  for (const file of files) {
    const layer = classifyFileToLayer(file);
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer)!.push(file);
  }
  // 按层级排序
  const sorted = new Map<ArchitectureLayer, string[]>();
  const order: ArchitectureLayer[] = ['Layer0', 'Layer1', 'Layer2', 'Layer3'];
  for (const layer of order) {
    if (groups.has(layer)) {
      sorted.set(layer, groups.get(layer)!);
    }
  }
  return sorted;
}

// ============================================================
// 类型定义
// ============================================================

/** 需求增强结果 */
export interface EnhancedRequirement {
  /** 增强后的标题 (动词开头, 10-50 字符) */
  title: string | null;
  /** 增强后的描述 */
  description: string | null;
  /** 推断的任务类型 */
  type: TaskType | null;
  /** 推断的优先级 (P0/P1/P2/P3) */
  priority: TaskPriority | null;
  /** 推荐角色 */
  recommendedRole: string | null;
  /** 建议的检查点 (每条动词开头) */
  checkpoints: string[] | null;
  /** 依赖建议 */
  dependencies: string[] | null;
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** 检查点增强结果 */
export interface EnhancedCheckpoints {
  /** 增强后的检查点列表 */
  checkpoints: string[];
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** 任务质量评估结果 */
export interface TaskQualityAssessment {
  /** 总体评分 (0-100) */
  score: number;
  /** 问题描述列表 */
  issues: QualityIssue[];
  /** 改进建议 */
  suggestions: string[];
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** 质量问题 */
export interface QualityIssue {
  /** 问题字段 */
  field: string;
  /** 严重程度 */
  severity: 'error' | 'warning' | 'info';
  /** 问题描述 */
  message: string;
}

/** 重复检测组 */
export interface DuplicateGroup {
  /** 组内任务 ID 列表 */
  taskIds: string[];
  /** 相似度 (0-1) */
  similarity: number;
  /** 建议保留的任务 ID */
  keepTaskId: string | null;
  /** 建议原因 */
  reason: string | null;
}

/** 重复检测结果 */
export interface DuplicateDetectionResult {
  /** 检测到的重复组 */
  duplicates: DuplicateGroup[];
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** 陈旧任务评估结果 */
export interface StalenessAssessment {
  /** 是否陈旧 */
  isStale: boolean;
  /** 陈旧程度 (0-1) */
  stalenessScore: number;
  /** 建议动作 */
  suggestedAction: 'keep' | 'close' | 'update' | 'split';
  /** 建议原因 */
  reason: string;
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** Bug 报告分析结果 */
export interface BugReportAnalysis {
  /** 建议的标题 (动词开头) */
  title: string | null;
  /** 结构化描述 */
  description: string | null;
  /** 推断的任务类型 */
  type: TaskType | null;
  /** 推断的优先级 */
  priority: TaskPriority | null;
  /** 建议的检查点 */
  checkpoints: string[] | null;
  /** 根因分析 */
  rootCause: string | null;
  /** 影响范围 */
  impactScope: string | null;
  /** AI 是否可用 */
  aiUsed: boolean;
}

/** AI 调用选项 */
interface AIMetadataCallOptions {
  /** 最大重试次数 (不含首次, 默认 2) */
  maxRetries?: number;
  /** 超时秒数 (默认 30) */
  timeoutSeconds?: number;
  /** 工作目录 */
  cwd: string;
}

// ============================================================
// JSON Schema 定义
// ============================================================

const REQUIREMENT_SCHEMA = {
  type: 'object',
  required: ['title', 'description', 'type', 'priority', 'checkpoints'],
  properties: {
    title: { type: 'string', minLength: 10, maxLength: 50 },
    description: { type: 'string' },
    type: { enum: ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null] },
    priority: { enum: ['P0', 'P1', 'P2', 'P3', null] },
    recommendedRole: { type: ['string', 'null'] },
    checkpoints: {
      type: 'array',
      items: { type: 'string', minLength: 5 },
    },
    dependencies: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
  },
};

const CHECKPOINTS_SCHEMA = {
  type: 'object',
  required: ['checkpoints'],
  properties: {
    checkpoints: {
      type: 'array',
      items: { type: 'string', minLength: 5 },
    },
  },
};

const QUALITY_SCHEMA = {
  type: 'object',
  required: ['score', 'issues', 'suggestions'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'severity', 'message'],
        properties: {
          field: { type: 'string' },
          severity: { enum: ['error', 'warning', 'info'] },
          message: { type: 'string' },
        },
      },
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const DUPLICATES_SCHEMA = {
  type: 'object',
  required: ['duplicates'],
  properties: {
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskIds', 'similarity'],
        properties: {
          taskIds: { type: 'array', items: { type: 'string' } },
          similarity: { type: 'number', minimum: 0, maximum: 1 },
          keepTaskId: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const STALENESS_SCHEMA = {
  type: 'object',
  required: ['isStale', 'stalenessScore', 'suggestedAction', 'reason'],
  properties: {
    isStale: { type: 'boolean' },
    stalenessScore: { type: 'number', minimum: 0, maximum: 1 },
    suggestedAction: { enum: ['keep', 'close', 'update', 'split'] },
    reason: { type: 'string' },
  },
};

const BUG_REPORT_SCHEMA = {
  type: 'object',
  required: ['title', 'description', 'checkpoints'],
  properties: {
    title: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    type: { enum: ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null] },
    priority: { enum: ['P0', 'P1', 'P2', 'P3', null] },
    checkpoints: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
    rootCause: { type: ['string', 'null'] },
    impactScope: { type: ['string', 'null'] },
  },
};

// ============================================================
// 有效的枚举值
// ============================================================

const VALID_TYPES: (TaskType | null)[] = ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null];
const VALID_PRIORITIES: (TaskPriority | null)[] = ['P0', 'P1', 'P2', 'P3', null];
const VALID_ACTIONS: string[] = ['keep', 'close', 'update', 'split'];
const VALID_SEVERITIES: string[] = ['error', 'warning', 'info'];

// ============================================================
// AIMetadataAssistant 类
// ============================================================

export class AIMetadataAssistant {
  private logger: Logger;

  constructor(cwd?: string) {
    this.logger = new Logger({ component: 'ai-metadata', cwd });
  }

  // ----------------------------------------------------------
  // CP-7: enhanceRequirement - 需求增强
  // ----------------------------------------------------------

  /**
   * 增强需求描述，返回完整的元数据
   * 单次调用返回: title, description, type, priority, checkpoints, dependencies
   */
  async enhanceRequirement(description: string, options: AIMetadataCallOptions): Promise<EnhancedRequirement> {
    const prompt = this.buildRequirementPrompt(description);

    const result = await this.invokeWithRetry(prompt, REQUIREMENT_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI 需求增强失败，回退到规则引擎');
      return this.fallbackEnhanceRequirement(description);
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed) {
      this.logger.warn('AI 输出 JSON 解析失败，回退到规则引擎');
      return this.fallbackEnhanceRequirement(description);
    }

    const validation = this.validateRequirement(parsed);
    if (!validation.valid) {
      this.logger.warn('AI 输出校验失败: ' + validation.errors.join(', '));
      return this.fallbackEnhanceRequirement(description);
    }

    return {
      title: this.sanitizeTitle(parsed.title),
      description: typeof parsed.description === 'string' ? parsed.description : null,
      type: VALID_TYPES.includes(parsed.type as TaskType | null) ? parsed.type as TaskType | null : null,
      priority: VALID_PRIORITIES.includes(parsed.priority as TaskPriority | null) ? parsed.priority as TaskPriority | null : null,
      recommendedRole: typeof parsed.recommendedRole === 'string' ? parsed.recommendedRole : null,
      checkpoints: this.sanitizeCheckpoints(parsed.checkpoints),
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies as string[] : null,
      aiUsed: true,
    };
  }

  // ----------------------------------------------------------
  // CP-8: enhanceCheckpoints - 检查点增强
  // ----------------------------------------------------------

  /**
   * 增强检查点列表
   * @param description - 任务描述
   * @param type - 任务类型
   * @param existing - 已有检查点
   */
  async enhanceCheckpoints(
    description: string,
    type: TaskType | undefined,
    existing: string[],
    options: AIMetadataCallOptions,
  ): Promise<EnhancedCheckpoints> {
    const prompt = this.buildCheckpointsPrompt(description, type, existing);

    const result = await this.invokeWithRetry(prompt, CHECKPOINTS_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI 检查点增强失败，回退到规则引擎');
      return { checkpoints: existing, aiUsed: false };
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed || !Array.isArray(parsed.checkpoints)) {
      this.logger.warn('AI 检查点输出解析失败，回退到已有检查点');
      return { checkpoints: existing, aiUsed: false };
    }

    return {
      checkpoints: this.sanitizeCheckpoints(parsed.checkpoints) ?? existing,
      aiUsed: true,
    };
  }

  // ----------------------------------------------------------
  // CP-9: analyzeTaskQuality - 任务质量评估
  // ----------------------------------------------------------

  /**
   * 评估任务质量
   * @param task - 任务元数据
   */
  async analyzeTaskQuality(task: TaskMeta, options: AIMetadataCallOptions): Promise<TaskQualityAssessment> {
    const prompt = this.buildQualityPrompt(task);

    const result = await this.invokeWithRetry(prompt, QUALITY_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI 质量评估失败，回退到规则引擎');
      return this.fallbackAnalyzeQuality(task);
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed) {
      return this.fallbackAnalyzeQuality(task);
    }

    return {
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50,
      issues: this.sanitizeIssues(parsed.issues),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      aiUsed: true,
    };
  }

  // ----------------------------------------------------------
  // CP-10: detectDuplicates - 语义重复检测
  // ----------------------------------------------------------

  /**
   * 检测任务列表中的语义重复
   * @param tasks - 任务元数据列表
   */
  async detectDuplicates(tasks: TaskMeta[], options: AIMetadataCallOptions): Promise<DuplicateDetectionResult> {
    if (tasks.length < 2) {
      return { duplicates: [], aiUsed: false };
    }

    const prompt = this.buildDuplicatesPrompt(tasks);

    const result = await this.invokeWithRetry(prompt, DUPLICATES_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI 重复检测失败，回退到规则引擎');
      return this.fallbackDetectDuplicates(tasks);
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed || !Array.isArray(parsed.duplicates)) {
      return this.fallbackDetectDuplicates(tasks);
    }

    return {
      duplicates: this.sanitizeDuplicates(parsed.duplicates, tasks),
      aiUsed: true,
    };
  }

  // ----------------------------------------------------------
  // CP-11: assessStaleness - 陈旧任务评估
  // ----------------------------------------------------------

  /**
   * 评估任务是否陈旧以及建议动作
   * @param task - 任务元数据
   */
  async assessStaleness(task: TaskMeta, options: AIMetadataCallOptions): Promise<StalenessAssessment> {
    const prompt = this.buildStalenessPrompt(task);

    const result = await this.invokeWithRetry(prompt, STALENESS_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI 陈旧评估失败，回退到规则引擎');
      return this.fallbackAssessStaleness(task);
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed) {
      return this.fallbackAssessStaleness(task);
    }

    return {
      isStale: typeof parsed.isStale === 'boolean' ? parsed.isStale : false,
      stalenessScore: typeof parsed.stalenessScore === 'number' ? Math.max(0, Math.min(1, parsed.stalenessScore)) : 0,
      suggestedAction: VALID_ACTIONS.includes(parsed.suggestedAction as string) ? parsed.suggestedAction as StalenessAssessment['suggestedAction'] : 'keep',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      aiUsed: true,
    };
  }

  // ----------------------------------------------------------
  // CP-12: analyzeBugReport - Bug 报告转需求
  // ----------------------------------------------------------

  /**
   * 将 Bug 报告转为需求文档
   * @param reportContent - Bug 报告内容
   * @param logContext - 可选的日志上下文
   */
  async analyzeBugReport(
    reportContent: string,
    logContext: string | undefined,
    options: AIMetadataCallOptions,
  ): Promise<BugReportAnalysis> {
    const prompt = this.buildBugReportPrompt(reportContent, logContext);

    const result = await this.invokeWithRetry(prompt, BUG_REPORT_SCHEMA, {
      ...options,
      maxRetries: options.maxRetries ?? 2,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });

    if (!result.success) {
      this.logger.warn('AI Bug 报告分析失败，回退到规则引擎');
      return this.fallbackAnalyzeBugReport(reportContent);
    }

    const parsed = this.parseJSON(result.output);
    if (!parsed) {
      return this.fallbackAnalyzeBugReport(reportContent);
    }

    return {
      title: this.sanitizeTitle(parsed.title),
      description: typeof parsed.description === 'string' ? parsed.description : null,
      type: VALID_TYPES.includes(parsed.type as TaskType | null) ? parsed.type as TaskType | null : 'bug',
      priority: VALID_PRIORITIES.includes(parsed.priority as TaskPriority | null) ? parsed.priority as TaskPriority | null : 'P2',
      checkpoints: this.sanitizeCheckpoints(parsed.checkpoints),
      rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : null,
      impactScope: typeof parsed.impactScope === 'string' ? parsed.impactScope : null,
      aiUsed: true,
    };
  }

  // ============================================================
  // Prompt 构建
  // ============================================================

  private buildRequirementPrompt(description: string, errorFeedback?: string): string {
    let prompt = `你是一个项目管理助手。根据以下需求描述，提取结构化元数据。

## 输入
需求描述:
${description}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。
如果无法判断某个字段，设为 null 而非猜测。

## 输出格式
{
  "title": "动词开头，10-50 字符的简洁标题",
  "description": "结构化的详细描述，包含背景、目标、方案要点",
  "type": "bug | feature | research | docs | refactor | test | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "recommendedRole": "推荐角色或 null",
  "checkpoints": ["动词开头的具体验证步骤，每条 5 字符以上"],
  "dependencies": ["依赖项 ID 列表或 null"]
}

## 约束
- title 必须以动词开头，长度 10-50 字符
- checkpoints 每条必须以动词开头，不能是泛泛的阶段名称（如"开发阶段""测试阶段"）
- priority 必须是 P0/P1/P2/P3 之一或 null
- 只输出 JSON

## 任务拆分最佳实践（影响 checkpoints 生成）
1. 单个任务预估耗时控制在 15 分钟以内
2. 按架构层级拆分优先级：Layer0(类型定义) → Layer1(工具函数) → Layer2(核心逻辑) → Layer3(命令入口)
3. 按文件目录边界拆分，每个子任务聚焦同一目录下的文件
4. 检查点必须具体可验证，格式如"实现 XXX 函数""运行 tsc --noEmit 通过"
5. 依赖关系遵循底层先于上层（先改类型，再改工具，再改命令）
6. 如果需求涉及 3 个以上文件或跨 2 个以上目录，应生成粒度更细的检查点，暗示可拆分`;

    if (errorFeedback) {
      prompt += `\n\n## 上次输出错误\n${errorFeedback}\n请修正以上错误并重新输出。`;
    }

    return prompt;
  }

  private buildCheckpointsPrompt(description: string, type: TaskType | undefined, existing: string[]): string {
    const existingStr = existing.length > 0
      ? `\n\n## 已有检查点\n${existing.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';

    return `你是一个项目管理助手。为以下任务生成检查点列表。

## 任务描述
${description}

## 任务类型
${type || '未指定'}${existingStr}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "checkpoints": ["动词开头的具体验证步骤"]
}

## 约束
- 每条检查点必须以动词开头
- 不能是泛泛的阶段名称（如"开发阶段""测试阶段"）
- 每条至少 5 字符
- 只输出 JSON

## 检查点质量规范
1. 每条必须是可独立验证的原子操作，例如"实现 parseConfig 函数"而非"完成配置解析"
2. 引用具体文件路径或函数名，例如"修改 src/utils/foo.ts 中的 bar() 函数"
3. 验证类检查点附带可执行命令，例如"运行 tsc --noEmit 确认类型检查通过"
4. 按架构层级排列：先类型定义 → 再工具函数 → 再核心逻辑 → 最后命令入口
5. 依赖底层完成后再做上层，例如先"定义 XXX 接口"再"实现 XXX 功能"
6. 每个检查点预估耗时不超过 15 分钟，超过则应拆分为多条`;
  }

  private buildQualityPrompt(task: TaskMeta): string {
    return `你是一个项目质量审查助手。评估以下任务的质量。

## 任务数据
${JSON.stringify({
  id: task.id,
  title: task.title,
  description: task.description,
  type: task.type,
  priority: task.priority,
  status: task.status,
  checkpoints: task.checkpoints?.map(c => c.description),
  dependencies: task.dependencies,
}, null, 2)}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "score": 0-100,
  "issues": [
    {"field": "字段名", "severity": "error|warning|info", "message": "问题描述"}
  ],
  "suggestions": ["改进建议列表"]
}

## 评估维度
- 标题: 是否动词开头，是否具体
- 描述: 是否包含足够的上下文和目标
- 检查点: 是否具体可验证（必须引用具体文件路径、函数名或可执行命令）
- 优先级: 是否合理
- 依赖: 是否遗漏关键依赖
- 任务粒度: 单个任务是否控制在15分钟内可完成
- 层级拆分: 涉及多文件时是否按架构层级（类型→工具→核心→命令）拆分检查点
- 只输出 JSON`;
  }

  private buildDuplicatesPrompt(tasks: TaskMeta[]): string {
    const taskSummaries = tasks.slice(0, 50).map(t =>
      `ID: ${t.id}\n标题: ${t.title}\n描述: ${(t.description || '').substring(0, 200)}\n类型: ${t.type}`
    ).join('\n---\n');

    return `你是一个项目管理助手。检测以下任务列表中的语义重复。

## 任务列表
${taskSummaries}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "duplicates": [
    {
      "taskIds": ["重复任务ID列表"],
      "similarity": 0.0-1.0,
      "keepTaskId": "建议保留的任务ID或null",
      "reason": "判断依据或null"
    }
  ]
}

## 约束
- 只报告相似度 >= 0.7 的组
- 只输出 JSON`;
  }

  private buildStalenessPrompt(task: TaskMeta): string {
    const ageMs = Date.now() - new Date(task.updatedAt).getTime();
    const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));

    return `你是一个项目管理助手。评估以下任务是否陈旧。

## 任务数据
${JSON.stringify({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  type: task.type,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  ageDays,
  checkpointCount: task.checkpoints?.length ?? 0,
  completedCheckpoints: task.checkpoints?.filter(c => c.status === 'completed').length ?? 0,
}, null, 2)}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "isStale": true/false,
  "stalenessScore": 0.0-1.0,
  "suggestedAction": "keep | close | update | split",
  "reason": "判断依据"
}

## 约束
- 只输出 JSON`;
  }

  private buildBugReportPrompt(reportContent: string, logContext?: string): string {
    const contextStr = logContext
      ? `\n## 日志上下文\n${logContext.substring(0, 2000)}`
      : '';

    return `你是一个 Bug 分析助手。将以下 Bug 报告转为结构化需求文档。

## Bug 报告
${reportContent.substring(0, 4000)}${contextStr}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。
如果无法判断某个字段，设为 null 而非猜测。

## 输出格式
{
  "title": "动词开头的标题",
  "description": "结构化描述：背景、复现步骤、期望行为、实际行为",
  "type": "bug | feature | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "checkpoints": ["验证步骤列表或null"],
  "rootCause": "根因分析或null",
  "impactScope": "影响范围或null"
}

## 约束
- title 必须以动词开头
- checkpoints 每条必须以动词开头
- 只输出 JSON`;
  }

  // ============================================================
  // 核心调用逻辑
  // ============================================================

  /**
   * 带重试的 AI 调用
   * CP-3: 失败自动重试 (最多 maxRetries 次) + 错误反馈追加到 prompt
   * CP-5: 超时 30 秒/次
   */
  private async invokeWithRetry(
    prompt: string,
    _schema: Record<string, unknown>,
    options: AIMetadataCallOptions & { maxRetries: number; timeoutSeconds: number },
  ): Promise<AgentResult> {
    const { cwd, maxRetries, timeoutSeconds } = options;
    let lastError: string | undefined;
    let currentPrompt = prompt;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const agent = getAgent(cwd);
        const invokeOptions: AgentInvokeOptions = {
          timeout: timeoutSeconds,
          allowedTools: [],
          outputFormat: 'json',
          maxRetries: 0, // 我们自己管理重试
          cwd,
        };

        const result = await agent.invoke(currentPrompt, invokeOptions);

        if (result.success) {
          // 尝试解析 JSON 验证格式
          const parsed = this.parseJSON(result.output);
          if (parsed) {
            return result;
          }
          // JSON 解析失败，构建错误反馈用于重试
          lastError = `输出不是有效的 JSON。请只输出 JSON，不要包含 markdown 代码块或其他文本。`;
        } else {
          lastError = result.error || '调用失败';
        }

        this.logger.warn(`AI 调用尝试 ${attempt + 1}/${maxRetries + 1} 失败`, {
          error: lastError,
          attempt,
        });

        // 追加错误反馈到 prompt
        if (attempt < maxRetries) {
          currentPrompt = prompt + `\n\n## 上次输出错误\n${lastError}\n请修正以上错误并重新输出纯 JSON。`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn(`AI 调用异常 ${attempt + 1}/${maxRetries + 1}`, { error: lastError });
      }
    }

    return {
      output: '',
      success: false,
      provider: 'none',
      durationMs: 0,
      tokensUsed: 0,
      model: '',
      error: lastError || `AI 调用失败，已重试 ${maxRetries} 次`,
    };
  }

  // ============================================================
  // JSON 解析与校验
  // ============================================================

  /**
   * 解析 JSON 字符串
   * CP-13: 只输出 JSON，不要 markdown 代码块包裹
   */
  private parseJSON(output: string): Record<string, unknown> | null {
    if (!output || !output.trim()) return null;

    let text = output.trim();

    // 去除可能的 markdown 代码块包裹
    const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (codeBlockMatch) {
      text = codeBlockMatch[1]!.trim();
    }

    try {
      return JSON.parse(text);
    } catch {
      // 尝试提取 JSON 对象（可能前后有额外文本）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * 校验需求增强结果
   */
  private validateRequirement(parsed: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (parsed.title !== null && typeof parsed.title !== 'string') {
      errors.push('title 必须是 string 或 null');
    }
    if (parsed.title !== null && typeof parsed.title === 'string') {
      if (parsed.title.length < 10 || parsed.title.length > 50) {
        errors.push(`title 长度 ${parsed.title.length} 不在 10-50 范围内`);
      }
    }
    if (!VALID_TYPES.includes(parsed.type as TaskType | null)) {
      errors.push(`type "${parsed.type}" 不是有效值`);
    }
    if (!VALID_PRIORITIES.includes(parsed.priority as TaskPriority | null)) {
      errors.push(`priority "${parsed.priority}" 不是有效值`);
    }
    if (!Array.isArray(parsed.checkpoints) && parsed.checkpoints !== null) {
      errors.push('checkpoints 必须是数组或 null');
    }

    return { valid: errors.length === 0, errors };
  }

  // ============================================================
  // 数据清洗
  // ============================================================

  /**
   * 清洗标题
   * CP-14: 动词开头，10-50 字符
   */
  private sanitizeTitle(title: unknown): string | null {
    if (typeof title !== 'string' || !title.trim()) return null;

    let t = title.trim();
    // 截断到 50 字符
    if (t.length > 50) t = t.substring(0, 50);

    return t.length >= 10 ? t : null;
  }

  /**
   * 清洗检查点列表
   * CP-15: 每条动词开头，不能是泛泛的阶段名称
   */
  private sanitizeCheckpoints(checkpoints: unknown): string[] | null {
    if (!Array.isArray(checkpoints)) return null;

    const genericPatterns = /^(?:开发阶段|测试阶段|设计阶段|评审阶段|部署阶段|实施阶段|开发|测试|设计|评审|部署|实施|完成)$/;

    const result = checkpoints
      .filter((c): c is string => typeof c === 'string' && c.trim().length >= 5)
      .map(c => c.trim())
      .filter(c => !genericPatterns.test(c));

    return result.length > 0 ? result : null;
  }

  /**
   * 清洗质量问题列表
   */
  private sanitizeIssues(issues: unknown): QualityIssue[] {
    if (!Array.isArray(issues)) return [];

    return issues
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .filter(i => typeof i.field === 'string' && typeof i.message === 'string')
      .map(i => ({
        field: i.field as string,
        severity: VALID_SEVERITIES.includes(i.severity as string) ? (i.severity as 'error' | 'warning' | 'info') : 'info',
        message: i.message as string,
      }));
  }

  /**
   * 清洗重复检测组
   */
  private sanitizeDuplicates(duplicates: unknown[], tasks: TaskMeta[]): DuplicateGroup[] {
    const taskIds = new Set(tasks.map(t => t.id));

    return duplicates
      .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
      .filter(d => Array.isArray(d.taskIds) && d.taskIds.length >= 2)
      .filter(d => {
        const ids = (d.taskIds as string[]).filter(id => taskIds.has(id));
        return ids.length >= 2;
      })
      .map(d => ({
        taskIds: (d.taskIds as string[]).filter(id => taskIds.has(id)),
        similarity: typeof d.similarity === 'number' ? Math.max(0, Math.min(1, d.similarity)) : 0.7,
        keepTaskId: typeof d.keepTaskId === 'string' ? d.keepTaskId : null,
        reason: typeof d.reason === 'string' ? d.reason : null,
      }))
      .filter(d => d.similarity >= 0.7);
  }

  // ============================================================
  // 规则引擎回退 (CP-5)
  // ============================================================

  /**
   * 规则引擎: 需求增强
   */
  private fallbackEnhanceRequirement(description: string): EnhancedRequirement {
    return {
      title: null,
      description: null,
      type: inferTaskType(description),
      priority: inferTaskPriority(description),
      recommendedRole: null,
      checkpoints: null,
      dependencies: null,
      aiUsed: false,
    };
  }

  /**
   * 规则引擎: 质量评估
   */
  private fallbackAnalyzeQuality(task: TaskMeta): TaskQualityAssessment {
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];
    let score = 60;

    // 标题检查
    if (!task.title || task.title.length < 10) {
      issues.push({ field: 'title', severity: 'warning', message: '标题过短，建议 10 字符以上' });
      score -= 10;
    }

    // 描述检查
    if (!task.description || task.description.length < 20) {
      issues.push({ field: 'description', severity: 'warning', message: '描述不充分' });
      score -= 15;
      suggestions.push('添加更详细的需求描述，包含背景、目标和方案');
    }

    // 检查点检查
    const checkpointCount = task.checkpoints?.length ?? 0;
    if (checkpointCount === 0) {
      issues.push({ field: 'checkpoints', severity: 'warning', message: '缺少检查点' });
      score -= 10;
      suggestions.push('添加具体可验证的检查点');
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      issues,
      suggestions,
      aiUsed: false,
    };
  }

  /**
   * 规则引擎: 重复检测 (基于标题相似度)
   */
  private fallbackDetectDuplicates(tasks: TaskMeta[]): DuplicateDetectionResult {
    const duplicates: DuplicateGroup[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i]!;
        const b = tasks[j]!;

        // 简单的标题词重叠检测
        const wordsA = new Set(a.title.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2));
        const wordsB = new Set(b.title.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2));
        const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
        const union = new Set([...wordsA, ...wordsB]);
        const similarity = union.size > 0 ? intersection.size / union.size : 0;

        if (similarity >= 0.7) {
          const key = [a.id, b.id].sort().join(',');
          if (!seen.has(key)) {
            seen.add(key);
            duplicates.push({
              taskIds: [a.id, b.id],
              similarity,
              keepTaskId: null,
              reason: `标题词汇重叠度 ${Math.round(similarity * 100)}%`,
            });
          }
        }
      }
    }

    return { duplicates, aiUsed: false };
  }

  /**
   * 规则引擎: 陈旧评估
   */
  private fallbackAssessStaleness(task: TaskMeta): StalenessAssessment {
    const ageMs = Date.now() - new Date(task.updatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    let stalenessScore = 0;
    let suggestedAction: StalenessAssessment['suggestedAction'] = 'keep';
    let reason = '';

    if (ageDays > 90) {
      stalenessScore = 0.9;
      suggestedAction = 'close';
      reason = `任务已 ${Math.round(ageDays)} 天未更新，建议关闭`;
    } else if (ageDays > 30) {
      stalenessScore = 0.6;
      suggestedAction = 'update';
      reason = `任务已 ${Math.round(ageDays)} 天未更新，建议审查相关性`;
    } else if (ageDays > 14) {
      stalenessScore = 0.3;
      suggestedAction = 'keep';
      reason = `任务 ${Math.round(ageDays)} 天前更新，仍有一定时效性`;
    } else {
      stalenessScore = 0.1;
      suggestedAction = 'keep';
      reason = '任务近期有更新';
    }

    return {
      isStale: stalenessScore >= 0.6,
      stalenessScore,
      suggestedAction,
      reason,
      aiUsed: false,
    };
  }

  /**
   * 规则引擎: Bug 报告分析
   */
  private fallbackAnalyzeBugReport(reportContent: string): BugReportAnalysis {
    return {
      title: null,
      description: reportContent.substring(0, 500) || null,
      type: 'bug',
      priority: inferTaskPriority(reportContent),
      checkpoints: null,
      rootCause: null,
      impactScope: null,
      aiUsed: false,
    };
  }
}
