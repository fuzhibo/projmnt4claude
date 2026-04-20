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
import { invokeAgent, type AgentInvokeOptions } from './headless-agent.js';
import type { TaskMeta, TaskPriority, TaskType } from '../types/task';
import { inferTaskType, inferTaskPriority } from '../types/task';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { buildAgentOptionsFromPreset } from '../types/config.js';

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

/** AI 语义依赖推断结果 */
export interface SemanticDependency {
  /** 依赖任务 ID（被依赖方） */
  depTaskId: string;
  /** 依赖方任务 ID */
  taskId: string;
  /** AI 推断的依赖原因 */
  reason: string;
}

/** 语义依赖推断整体结果 */
export interface SemanticDependencyResult {
  /** 推断出的语义依赖列表 */
  dependencies: SemanticDependency[];
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

const SEMANTIC_DEPS_SCHEMA = {
  type: 'object',
  required: ['dependencies'],
  properties: {
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'depTaskId', 'reason'],
        properties: {
          taskId: { type: 'string' },
          depTaskId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const SEMANTIC_DEP_SCHEMA = {
  type: 'object',
  required: ['dependencies'],
  properties: {
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'depTaskId', 'reason'],
        properties: {
          taskId: { type: 'string' },
          depTaskId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
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
  private cwd: string;
  private presets: {
    metadataEnhancement: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
    checkpointEnhancement: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
    qualityAnalysis: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
    duplicateDetection: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
    stalenessAssessment: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
    bugAnalysis: { timeout: number; maxRetries: number; allowedTools: string[]; outputFormat: 'text' | 'json' | 'markdown' };
  };

  /**
   * 构造函数：初始化 preset 配置
   * @param cwd - 工作目录
   */
  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.logger = new Logger({ component: 'ai-metadata', cwd });

    // 初始化各场景预设配置
    this.presets = {
      metadataEnhancement: buildAgentOptionsFromPreset('metadataEnhancement', cwd),
      checkpointEnhancement: buildAgentOptionsFromPreset('checkpointEnhancement', cwd),
      qualityAnalysis: buildAgentOptionsFromPreset('qualityAnalysis', cwd),
      duplicateDetection: buildAgentOptionsFromPreset('duplicateDetection', cwd),
      stalenessAssessment: buildAgentOptionsFromPreset('stalenessAssessment', cwd),
      bugAnalysis: buildAgentOptionsFromPreset('bugAnalysis', cwd),
    };

    this.logger.info('AIMetadataAssistant 初始化完成', {
      cwd,
      presets: Object.keys(this.presets),
    });
  }

  /**
   * 私有方法：统一调用 AI
   * 所有公共方法都通过此方法进行 AI 调用
   *
   * @param prompt - 提示词
   * @param scenario - 场景名称
   * @param operation - 操作名称（用于日志）
   * @returns AI 调用结果
   */
  private async callAI<T>(
    prompt: string,
    scenario: 'metadataEnhancement' | 'checkpointEnhancement' | 'qualityAnalysis' | 'duplicateDetection' | 'stalenessAssessment' | 'bugAnalysis',
    operation: string,
  ): Promise<{ success: boolean; data?: T; error?: string; tokensUsed?: { input: number; output: number } }> {
    const startTime = Date.now();

    this.logger.info(`[${operation}] AI 调用开始`, {
      scenario,
      operation,
      promptLength: prompt.length,
    });

    try {
      const preset = this.presets[scenario];
      const agentOptions: AgentInvokeOptions = {
        timeout: preset.timeout,
        allowedTools: preset.allowedTools,
        outputFormat: preset.outputFormat,
        maxRetries: preset.maxRetries,
        cwd: this.cwd,
        dangerouslySkipPermissions: true,
      };

      const agentResult = await invokeAgent(prompt, agentOptions);
      const durationMs = Date.now() - startTime;

      if (!agentResult.success) {
        this.logger.warn(`[${operation}] AI 调用失败，返回回退结果`, {
          error: agentResult.error,
          durationMs,
        });
        return { success: false, error: agentResult.error || 'Agent invocation failed' };
      }

      const parsed = this.parseJSON(agentResult.output);
      if (!parsed) {
        this.logger.warn(`[${operation}] 解析 AI 响应失败`, {
          output: agentResult.output?.slice(0, 200),
          durationMs,
        });
        return { success: false, error: 'Failed to parse AI response as JSON' };
      }

      // 记录 Token 使用量
      const inputTokens = agentResult.tokensUsed
        ? Math.floor(agentResult.tokensUsed * 0.3)
        : Math.floor(prompt.length / 4);
      const outputTokens = agentResult.tokensUsed
        ? Math.floor(agentResult.tokensUsed * 0.7)
        : Math.floor(agentResult.output.length / 4);

      this.logger.logAICost({
        field: operation,
        durationMs,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      });

      this.logger.info(`[${operation}] AI 调用完成`, {
        durationMs,
        tokensUsed: inputTokens + outputTokens,
        model: agentResult.model,
      });

      return {
        success: true,
        data: parsed as T,
        tokensUsed: {
          input: inputTokens,
          output: outputTokens,
        },
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.warn(`[${operation}] AI 调用异常，返回回退结果`, {
        error: err.message,
        durationMs,
      });
      return { success: false, error: err.message || String(err) };
    }
  }

  // ----------------------------------------------------------
  // CP-7: enhanceRequirement - 需求增强
  // ----------------------------------------------------------

  /**
   * 增强需求描述，返回完整的元数据
   * 单次调用返回: title, description, type, priority, checkpoints, dependencies
   * 使用 callAI 统一调用
   */
  async enhanceRequirement(description: string, options?: AIMetadataCallOptions): Promise<EnhancedRequirement> {
    this.logger.info('enhanceRequirement 调用开始', { descriptionLength: description.length });

    const prompt = this.buildRequirementPrompt(description, undefined, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      title: string;
      description: string;
      type: TaskType | null;
      priority: TaskPriority | null;
      recommendedRole: string;
      checkpoints: string[];
      dependencies: string[];
    }>(prompt, 'metadataEnhancement', 'enhanceRequirement');

    if (!result.success || !result.data) {
      this.logger.warn('enhanceRequirement 失败，回退到规则引擎', { error: result.error });
      return this.fallbackEnhanceRequirement(description);
    }

    const data = result.data;
    const validPriorities: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
    const validComplexities = ['low', 'medium', 'high'];
    const validRoles = ['developer', 'frontend', 'backend', 'qa', 'writer', 'security', 'performance', 'architect', 'devops'];

    const enhanced: EnhancedRequirement = {
      title: typeof data.title === 'string' ? data.title : this.sanitizeTitle(data.title) ?? '',
      description: typeof data.description === 'string' ? data.description : null,
      type: VALID_TYPES.includes(data.type as TaskType | null) ? data.type as TaskType | null : inferTaskType(description),
      priority: validPriorities.includes(data.priority as TaskPriority) ? data.priority as TaskPriority : inferTaskPriority(description),
      recommendedRole: typeof data.recommendedRole === 'string' ? data.recommendedRole : 'developer',
      checkpoints: Array.isArray(data.checkpoints)
        ? this.sanitizeCheckpoints(data.checkpoints) ?? []
        : [],
      dependencies: Array.isArray(data.dependencies)
        ? data.dependencies.filter((d: any) => typeof d === 'string' && d.length > 3)
        : [],
      aiUsed: true,
    };

    this.logger.info('enhanceRequirement 完成', {
      title: enhanced.title,
      priority: enhanced.priority,
      checkpointCount: enhanced.checkpoints.length,
    });

    return enhanced;
  }

  // ----------------------------------------------------------
  // CP-8: enhanceCheckpoints - 检查点增强
  // ----------------------------------------------------------

  /**
   * 增强检查点列表
   * @param description - 任务描述
   * @param type - 任务类型
   * @param existing - 已有检查点
   * 使用 callAI 统一调用
   */
  async enhanceCheckpoints(
    description: string,
    type: TaskType | undefined,
    existing: string[],
    options?: AIMetadataCallOptions,
  ): Promise<EnhancedCheckpoints> {
    this.logger.info('enhanceCheckpoints 调用开始', {
      descriptionLength: description.length,
      checkpointCount: existing.length,
      taskType: type,
    });

    const prompt = this.buildCheckpointsPrompt(description, type, existing, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      checkpoints: string[];
    }>(prompt, 'checkpointEnhancement', 'enhanceCheckpoints');

    if (!result.success || !result.data) {
      this.logger.warn('enhanceCheckpoints 失败，回退到已有检查点', { error: result.error });
      return { checkpoints: existing, aiUsed: false };
    }

    const enhanced: EnhancedCheckpoints = {
      checkpoints: Array.isArray(result.data.checkpoints)
        ? this.sanitizeCheckpoints(result.data.checkpoints) ?? existing
        : existing,
      aiUsed: true,
    };

    this.logger.info('enhanceCheckpoints 完成', {
      checkpointCount: enhanced.checkpoints.length,
    });

    return enhanced;
  }

  // ----------------------------------------------------------
  // CP-9: analyzeTaskQuality - 任务质量评估
  // ----------------------------------------------------------

  /**
   * 评估任务质量
   * @param task - 任务元数据
   * 使用 callAI 统一调用
   */
  async analyzeTaskQuality(task: TaskMeta, options?: AIMetadataCallOptions): Promise<TaskQualityAssessment> {
    this.logger.info('analyzeTaskQuality 调用开始', {
      title: task.title,
      descriptionLength: task.description?.length ?? 0,
    });

    const prompt = this.buildQualityPrompt(task, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      score: number;
      issues: QualityIssue[];
      suggestions: string[];
    }>(prompt, 'qualityAnalysis', 'analyzeTaskQuality');

    if (!result.success || !result.data) {
      this.logger.warn('analyzeTaskQuality 失败，回退到规则引擎', { error: result.error });
      return this.fallbackAnalyzeQuality(task);
    }

    const analysis: TaskQualityAssessment = {
      score: typeof result.data.score === 'number' ? Math.max(0, Math.min(100, result.data.score)) : 50,
      issues: this.sanitizeIssues(result.data.issues),
      suggestions: Array.isArray(result.data.suggestions) ? result.data.suggestions : [],
      aiUsed: true,
    };

    this.logger.info('analyzeTaskQuality 完成', {
      score: analysis.score,
      issueCount: analysis.issues.length,
    });

    return analysis;
  }

  // ----------------------------------------------------------
  // CP-10: detectDuplicates - 语义重复检测
  // ----------------------------------------------------------

  /**
   * 检测任务列表中的语义重复
   * @param tasks - 任务元数据列表
   * 使用 callAI 统一调用
   */
  async detectDuplicates(tasks: TaskMeta[], options?: AIMetadataCallOptions): Promise<DuplicateDetectionResult> {
    this.logger.info('detectDuplicates 调用开始', {
      taskCount: tasks.length,
    });

    if (tasks.length < 2) {
      return { duplicates: [], aiUsed: false };
    }

    const prompt = this.buildDuplicatesPrompt(tasks, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      duplicates: DuplicateGroup[];
    }>(prompt, 'duplicateDetection', 'detectDuplicates');

    if (!result.success || !result.data) {
      this.logger.warn('detectDuplicates 失败，回退到规则引擎', { error: result.error });
      return this.fallbackDetectDuplicates(tasks);
    }

    const detectionResult: DuplicateDetectionResult = {
      duplicates: this.sanitizeDuplicates(result.data.duplicates, tasks),
      aiUsed: true,
    };

    this.logger.info('detectDuplicates 完成', {
      duplicateCount: detectionResult.duplicates.length,
    });

    return detectionResult;
  }

  // ----------------------------------------------------------
  // CP-11: assessStaleness - 陈旧任务评估
  // ----------------------------------------------------------

  /**
   * 评估任务是否陈旧以及建议动作
   * @param task - 任务元数据
   * 使用 callAI 统一调用
   */
  async assessStaleness(task: TaskMeta, options?: AIMetadataCallOptions): Promise<StalenessAssessment> {
    this.logger.info('assessStaleness 调用开始', {
      taskId: task.id,
      title: task.title,
      status: task.status,
    });

    const prompt = this.buildStalenessPrompt(task, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      isStale: boolean;
      stalenessScore: number;
      suggestedAction: 'keep' | 'close' | 'update' | 'split';
      reason: string;
    }>(prompt, 'stalenessAssessment', 'assessStaleness');

    if (!result.success || !result.data) {
      this.logger.warn('assessStaleness 失败，回退到规则引擎', { error: result.error });
      return this.fallbackAssessStaleness(task);
    }

    const assessment: StalenessAssessment = {
      isStale: typeof result.data.isStale === 'boolean' ? result.data.isStale : false,
      stalenessScore: typeof result.data.stalenessScore === 'number' ? Math.max(0, Math.min(1, result.data.stalenessScore)) : 0,
      suggestedAction: VALID_ACTIONS.includes(result.data.suggestedAction as string) ? result.data.suggestedAction as StalenessAssessment['suggestedAction'] : 'keep',
      reason: typeof result.data.reason === 'string' ? result.data.reason : '',
      aiUsed: true,
    };

    this.logger.info('assessStaleness 完成', {
      isStale: assessment.isStale,
      suggestedAction: assessment.suggestedAction,
    });

    return assessment;
  }

  // ----------------------------------------------------------
  // CP-12: analyzeBugReport - Bug 报告转需求
  // ----------------------------------------------------------

  /**
   * 将 Bug 报告转为需求文档
   * @param reportContent - Bug 报告内容
   * @param logContext - 可选的日志上下文
   * 使用 callAI 统一调用
   */
  async analyzeBugReport(
    reportContent: string,
    logContext: string | undefined,
    options?: AIMetadataCallOptions,
  ): Promise<BugReportAnalysis> {
    this.logger.info('analyzeBugReport 调用开始', {
      reportLength: reportContent.length,
      hasLogContext: !!logContext,
    });

    const prompt = this.buildBugReportPrompt(reportContent, logContext, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      title: string;
      description: string;
      type: TaskType | null;
      priority: TaskPriority | null;
      checkpoints: string[];
      rootCause: string;
      impactScope: string;
    }>(prompt, 'bugAnalysis', 'analyzeBugReport');

    if (!result.success || !result.data) {
      this.logger.warn('analyzeBugReport 失败，回退到规则引擎', { error: result.error });
      return this.fallbackAnalyzeBugReport(reportContent);
    }

    const data = result.data;
    const analysis: BugReportAnalysis = {
      title: typeof data.title === 'string' ? data.title : this.sanitizeTitle(data.title) ?? null,
      description: typeof data.description === 'string' ? data.description : null,
      type: VALID_TYPES.includes(data.type as TaskType | null) ? data.type as TaskType | null : 'bug',
      priority: VALID_PRIORITIES.includes(data.priority as TaskPriority | null) ? data.priority as TaskPriority | null : 'P2',
      checkpoints: this.sanitizeCheckpoints(data.checkpoints),
      rootCause: typeof data.rootCause === 'string' ? data.rootCause : null,
      impactScope: typeof data.impactScope === 'string' ? data.impactScope : null,
      aiUsed: true,
    };

    this.logger.info('analyzeBugReport 完成', {
      title: analysis.title,
      type: analysis.type,
      priority: analysis.priority,
    });

    return analysis;
  }

  // ----------------------------------------------------------
  // CP-13: inferSemanticDependencies - AI 语义依赖推断
  // ----------------------------------------------------------

  /**
   * 通过 AI 分析任务描述的语义关系，推断任务间隐含的依赖关系
   *
   * @param tasks - 任务元数据列表
   * @param options - AI 调用选项
   * @returns 语义依赖推断结果
   * 使用 callAI 统一调用
   */
  async inferSemanticDependencies(tasks: TaskMeta[], options?: AIMetadataCallOptions): Promise<SemanticDependencyResult> {
    this.logger.info('inferSemanticDependencies 调用开始', {
      taskCount: tasks.length,
    });

    if (tasks.length < 2) {
      return { dependencies: [], aiUsed: false };
    }

    const prompt = this.buildSemanticDependencyPrompt(tasks, options?.cwd ?? this.cwd);

    const result = await this.callAI<{
      dependencies: SemanticDependency[];
    }>(prompt, 'metadataEnhancement', 'inferSemanticDependencies');

    if (!result.success || !result.data) {
      this.logger.warn('inferSemanticDependencies 失败', { error: result.error });
      return { dependencies: [], aiUsed: false };
    }

    // 验证并清洗结果
    const validTaskIds = new Set(tasks.map(t => t.id));
    const deps: SemanticDependency[] = [];

    for (const dep of result.data.dependencies || []) {
      if (
        typeof dep === 'object' && dep !== null &&
        typeof dep.taskId === 'string' &&
        typeof dep.depTaskId === 'string' &&
        typeof dep.reason === 'string' &&
        validTaskIds.has(dep.taskId) &&
        validTaskIds.has(dep.depTaskId) &&
        dep.taskId !== dep.depTaskId
      ) {
        deps.push({
          taskId: dep.taskId,
          depTaskId: dep.depTaskId,
          reason: dep.reason,
        });
      }
    }

    this.logger.info('inferSemanticDependencies 完成', {
      dependencyCount: deps.length,
    });

    return { dependencies: deps, aiUsed: true };
  }

  // ============================================================
  // Prompt 构建
  // ============================================================

  private buildSemanticDependencyPrompt(tasks: TaskMeta[], cwd?: string): string {
    const taskList = tasks.slice(0, 50).map(t =>
      `ID: ${t.id}\n标题: ${t.title}\n描述: ${(t.description || '').substring(0, 150)}`
    ).join('\n---\n');

    const template = loadPromptTemplate('semanticDependency', cwd);
    return resolveTemplate(template, { taskList });
  }

  private buildRequirementPrompt(description: string, errorFeedback?: string, cwd?: string): string {
    const errorFeedbackSection = errorFeedback
      ? `\n\n## 上次输出错误\n${errorFeedback}\n请修正以上错误并重新输出。`
      : '';

    const template = loadPromptTemplate('requirement', cwd);
    return resolveTemplate(template, { description, errorFeedback: errorFeedbackSection });
  }

  private buildCheckpointsPrompt(description: string, type: TaskType | undefined, existing: string[], cwd?: string): string {
    const existingCheckpointsSection = existing.length > 0
      ? `\n\n## 已有检查点\n${existing.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';

    const template = loadPromptTemplate('checkpoints', cwd);
    return resolveTemplate(template, {
      description,
      type: type || '未指定',
      existingCheckpointsSection,
    });
  }

  private buildQualityPrompt(task: TaskMeta, cwd?: string): string {
    const taskData = JSON.stringify({
      id: task.id,
      title: task.title,
      description: task.description,
      type: task.type,
      priority: task.priority,
      status: task.status,
      checkpoints: task.checkpoints?.map(c => c.description),
      dependencies: task.dependencies,
    }, null, 2);

    const template = loadPromptTemplate('quality', cwd);
    return resolveTemplate(template, { taskData });
  }

  private buildDuplicatesPrompt(tasks: TaskMeta[], cwd?: string): string {
    const taskList = tasks.slice(0, 50).map(t =>
      `ID: ${t.id}\n标题: ${t.title}\n描述: ${(t.description || '').substring(0, 200)}\n类型: ${t.type}`
    ).join('\n---\n');

    const template = loadPromptTemplate('duplicates', cwd);
    return resolveTemplate(template, { taskList });
  }

  private buildStalenessPrompt(task: TaskMeta, cwd?: string): string {
    const ageMs = Date.now() - new Date(task.updatedAt).getTime();
    const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));

    const taskData = JSON.stringify({
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
    }, null, 2);

    const template = loadPromptTemplate('staleness', cwd);
    return resolveTemplate(template, { taskData });
  }

  private buildBugReportPrompt(reportContent: string, logContext?: string, cwd?: string): string {
    const logContextSection = logContext
      ? `\n## 日志上下文\n${logContext.substring(0, 2000)}`
      : '';

    const template = loadPromptTemplate('bugReport', cwd);
    return resolveTemplate(template, {
      reportContent: reportContent.substring(0, 4000),
      logContextSection,
    });
  }

  // ============================================================
  // 核心调用逻辑
  // ============================================================

  /**
   * 所有公共方法现在使用 callAI 统一调用 invokeAgent
   * invokeWithEngine 已移除，统一使用 headless-agent 接口
   * CP-1: 所有方法通过 callAI 调用
   * CP-2: 调用时长和 token 使用量被记录
   * CP-3: 失败时正确回退到规则引擎
   */

  // ============================================================
  // JSON 解析与校验
  // ============================================================

  /**
   * 解析 JSON 字符串
   * CP-13: 只输出 JSON，不要 markdown 代码块包裹
   *
   * @internal 用于需求分解等内部功能
   */
  protected parseJSON(output: string): Record<string, unknown> | null {
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
