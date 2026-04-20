/**
 * AI 元数据助手
 * 使用 Headless Agent 统一接口增强任务需求分析结果
 * 支持 Claude Code CLI 的插件和 MCP 服务能力
 */

import type { TaskPriority, TaskType } from '../types/task';
import { Logger } from './logger';
import { invokeAgent, AgentInvokeOptions } from './headless-agent.js';
import { buildAgentOptionsFromPreset } from '../types/config.js';

/**
 * AI 调用结果
 */
interface AIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * AI 增强后的需求元数据
 */
export interface AIEnhancedRequirement {
  /** AI 建议的标题 */
  title: string;
  /** AI 建议的优先级 */
  priority: TaskPriority;
  /** AI 建议的优先级理由 */
  priorityReason: string;
  /** AI 建议的推荐角色 */
  recommendedRole: string;
  /** AI 建议的复杂度 */
  estimatedComplexity: 'low' | 'medium' | 'high';
  /** AI 建议的检查点 */
  checkpoints: string[];
  /** AI 建议的潜在依赖 */
  dependencies: string[];
}

/**
 * AI 增强检查点结果
 */
export interface AIEnhancedCheckpoints {
  /** 增强后的检查点列表 */
  checkpoints: string[];
  /** AI 为每个检查点建议的验证方法 */
  verificationHints: string[];
}

/**
 * 任务质量分析结果
 */
export interface TaskQualityAnalysis {
  /** 质量评分 (0-100) */
  score: number;
  /** 问题列表 */
  issues: string[];
  /** 改进建议 */
  suggestions: string[];
  /** 风险评估 */
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * 重复任务检测结果
 */
export interface DuplicateDetectionResult {
  /** 是否检测到重复 */
  hasDuplicates: boolean;
  /** 重复的任务ID列表 */
  duplicateTaskIds: string[];
  /** 相似度分数 (0-1) */
  similarityScores: Record<string, number>;
  /** 检测理由 */
  reasons: string[];
}

/**
 * 任务过时评估结果
 */
export interface StalenessAssessment {
  /** 是否过时 */
  isStale: boolean;
  /** 过时原因 */
  reasons: string[];
  /** 建议的操作 */
  recommendedAction: 'keep' | 'update' | 'archive' | 'delete';
  /** 置信度 (0-1) */
  confidence: number;
}

/**
 * Bug 报告分析结果
 */
export interface BugReportAnalysis {
  /** Bug 严重程度 */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** 影响范围 */
  impact: string;
  /** 可能的根因 */
  possibleRootCauses: string[];
  /** 复现步骤 */
  reproductionSteps: string[];
  /** 建议的修复方案 */
  suggestedFixes: string[];
}

/**
 * 失败回退：返回空结果
 */
function fallbackResult<T>(error: string): AIResult<T> {
  return { success: false, error };
}

/**
 * 安全解析 JSON（从 AI 响应中提取）
 */
function extractJSON<T>(text: string): T | null {
  // 尝试直接解析
  try {
    return JSON.parse(text) as T;
  } catch {
    // 尝试从 markdown code block 中提取
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch?.[1]) {
      try {
        return JSON.parse(jsonMatch[1]) as T;
      } catch {
        // fall through
      }
    }
    // 尝试找到第一个 { ... } 块
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]) as T;
      } catch {
        // fall through
      }
    }
    return null;
  }
}

// ============================================================
// 系统提示词
// ============================================================

const SYSTEM_PROMPT_ENHANCE = `You are a project management assistant. Analyze the given requirement description and return a JSON object with enhanced metadata.

Rules:
- title: concise summary, max 50 characters in the ORIGINAL language (Chinese stays Chinese, English stays English)
- priority: one of P0 (urgent), P1 (high), P2 (medium), P3 (low)
- priorityReason: brief reason for the chosen priority (1 sentence)
- recommendedRole: one of: developer, frontend, backend, qa, writer, security, performance, architect, devops
- estimatedComplexity: one of: low, medium, high
- checkpoints: array of 3-8 specific, verifiable checkpoint descriptions in the original language. Each must reference a concrete deliverable or testable condition.
- dependencies: array of potential prerequisite tasks or external dependencies

Return ONLY valid JSON, no markdown fences.`;

const SYSTEM_PROMPT_CHECKPOINTS = `You are a project management assistant. Enhance the given checkpoints for a task.

Rules:
- Return a JSON object with "checkpoints" (string[]) and "verificationHints" (string[])
- checkpoints: enhanced version of the input checkpoints, making them more specific and verifiable
- verificationHints: suggested verification method for each checkpoint (e.g., "unit test", "code review", "manual check")
- Keep the original language (Chinese stays Chinese, English stays English)
- Each checkpoint must reference a concrete deliverable or testable condition
- Maximum 8 checkpoints

Return ONLY valid JSON, no markdown fences.`;

const SYSTEM_PROMPT_QUALITY = `You are a project management assistant. Analyze the quality of a task description.

Rules:
- Return a JSON object with:
  - score: number (0-100) representing overall task quality
  - issues: array of identified problems or ambiguities
  - suggestions: array of improvement suggestions
  - riskLevel: one of "low", "medium", "high"

Quality factors to consider:
- Clarity and specificity
- Measurable acceptance criteria
- Appropriate scope
- Clear dependencies
- Realistic complexity

Return ONLY valid JSON, no markdown fences.`;

const SYSTEM_PROMPT_DUPLICATES = `You are a project management assistant. Detect potential duplicate tasks.

Rules:
- Return a JSON object with:
  - hasDuplicates: boolean indicating if similar tasks were found
  - duplicateTaskIds: array of potentially duplicate task IDs
  - similarityScores: object mapping taskId to similarity score (0-1)
  - reasons: array of explanation strings

Return ONLY valid JSON, no markdown fences.`;

const SYSTEM_PROMPT_STALENESS = `You are a project management assistant. Assess if a task has become stale/outdated.

Rules:
- Return a JSON object with:
  - isStale: boolean
  - reasons: array of strings explaining why it's stale
  - recommendedAction: one of "keep", "update", "archive", "delete"
  - confidence: number (0-1)

Consider:
- Time since last update
- Changes in requirements
- Blocked dependencies
- Shifting priorities
- Superseded by other work

Return ONLY valid JSON, no markdown fences.`;

const SYSTEM_PROMPT_BUG_ANALYSIS = `You are a technical analyst. Analyze a bug report and provide structured insights.

Rules:
- Return a JSON object with:
  - severity: one of "critical", "high", "medium", "low"
  - impact: string describing the scope of impact
  - possibleRootCauses: array of potential root causes
  - reproductionSteps: array of steps to reproduce
  - suggestedFixes: array of suggested solutions

Return ONLY valid JSON, no markdown fences.`;

// ============================================================
// AI 元数据助手类
// ============================================================

/**
 * AI 元数据助手类
 * 提供需求分析和检查点增强功能
 * 所有AI调用通过 callAI 统一方法完成，支持插件和MCP服务
 */
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
    this.logger = new Logger({ component: 'ai-metadata-assistant' });

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
    operation: string
  ): Promise<AIResult<T>> {
    const startTime = Date.now();

    this.logger.info(`[${operation}] AI 调用开始`, {
      scenario,
      operation,
      promptLength: prompt.length,
    });

    try {
      const preset = this.presets[scenario];
      const agentOptions: AgentInvokeOptions = {
        ...preset,
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
        return fallbackResult<T>(agentResult.error || 'Agent invocation failed');
      }

      const parsed = extractJSON<T>(agentResult.output);
      if (!parsed) {
        this.logger.warn(`[${operation}] 解析 AI 响应失败`, {
          output: agentResult.output?.slice(0, 200),
          durationMs,
        });
        return fallbackResult<T>('Failed to parse AI response as JSON');
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
        data: parsed,
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
      return fallbackResult<T>(err.message || String(err));
    }
  }

  /**
   * 增强需求分析
   * 调用 AI Agent 获取增强后的任务元数据
   */
  async enhanceRequirement(description: string): Promise<AIResult<AIEnhancedRequirement>> {
    this.logger.info('enhanceRequirement 调用开始', { descriptionLength: description.length });

    const prompt = `${SYSTEM_PROMPT_ENHANCE}

Analyze this requirement and return enhanced metadata as JSON:

${description}

Return JSON with: title, priority, priorityReason, recommendedRole, estimatedComplexity, checkpoints, dependencies`;

    const result = await this.callAI<AIEnhancedRequirement>(
      prompt,
      'metadataEnhancement',
      'enhanceRequirement'
    );

    if (!result.success || !result.data) {
      this.logger.warn('enhanceRequirement 失败，返回回退结果', { error: result.error });
      return result;
    }

    // 验证并规范化字段
    const validPriorities: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
    const validComplexities = ['low', 'medium', 'high'];
    const validRoles = ['developer', 'frontend', 'backend', 'qa', 'writer', 'security', 'performance', 'architect', 'devops'];

    const enhanced: AIEnhancedRequirement = {
      title: typeof result.data.title === 'string' ? result.data.title : '',
      priority: validPriorities.includes(result.data.priority) ? result.data.priority : 'P2',
      priorityReason: typeof result.data.priorityReason === 'string' ? result.data.priorityReason : '',
      recommendedRole: validRoles.includes(result.data.recommendedRole) ? result.data.recommendedRole : 'developer',
      estimatedComplexity: validComplexities.includes(result.data.estimatedComplexity)
        ? result.data.estimatedComplexity
        : 'medium',
      checkpoints: Array.isArray(result.data.checkpoints)
        ? result.data.checkpoints.filter((cp: any) => typeof cp === 'string' && cp.length > 3)
        : [],
      dependencies: Array.isArray(result.data.dependencies)
        ? result.data.dependencies.filter((d: any) => typeof d === 'string' && d.length > 3)
        : [],
    };

    this.logger.info('enhanceRequirement 完成', {
      title: enhanced.title,
      priority: enhanced.priority,
      checkpointCount: enhanced.checkpoints.length,
    });

    return {
      success: true,
      data: enhanced,
      tokensUsed: result.tokensUsed,
    };
  }

  /**
   * 增强检查点
   * 在规则引擎生成检查点后，调用 AI 进一步优化
   */
  async enhanceCheckpoints(
    description: string,
    existingCheckpoints: string[],
    taskType: TaskType
  ): Promise<AIResult<AIEnhancedCheckpoints>> {
    this.logger.info('enhanceCheckpoints 调用开始', {
      descriptionLength: description.length,
      checkpointCount: existingCheckpoints.length,
      taskType,
    });

    const prompt = `${SYSTEM_PROMPT_CHECKPOINTS}

Enhance these checkpoints for a ${taskType} task:

Description: ${description}

Existing checkpoints:
${existingCheckpoints.map((cp, i) => `${i + 1}. ${cp}`).join('\n')}

Return enhanced checkpoints as JSON with "checkpoints" and "verificationHints" arrays.`;

    const result = await this.callAI<AIEnhancedCheckpoints>(
      prompt,
      'checkpointEnhancement',
      'enhanceCheckpoints'
    );

    if (!result.success || !result.data) {
      this.logger.warn('enhanceCheckpoints 失败，返回回退结果', { error: result.error });
      return result;
    }

    const enhanced: AIEnhancedCheckpoints = {
      checkpoints: Array.isArray(result.data.checkpoints)
        ? result.data.checkpoints.filter((cp: any) => typeof cp === 'string' && cp.length > 3)
        : [],
      verificationHints: Array.isArray(result.data.verificationHints)
        ? result.data.verificationHints.filter((h: any) => typeof h === 'string')
        : [],
    };

    this.logger.info('enhanceCheckpoints 完成', {
      checkpointCount: enhanced.checkpoints.length,
      hintCount: enhanced.verificationHints.length,
    });

    return {
      success: true,
      data: enhanced,
      tokensUsed: result.tokensUsed,
    };
  }

  /**
   * 分析任务质量
   * 评估任务描述的清晰度、完整性和可执行性
   */
  async analyzeTaskQuality(title: string, description: string): Promise<AIResult<TaskQualityAnalysis>> {
    this.logger.info('analyzeTaskQuality 调用开始', {
      title,
      descriptionLength: description.length,
    });

    const prompt = `${SYSTEM_PROMPT_QUALITY}

Analyze this task:

Title: ${title}
Description: ${description}

Return a JSON object with: score (0-100), issues (array), suggestions (array), riskLevel (low/medium/high)`;

    const result = await this.callAI<TaskQualityAnalysis>(prompt, 'qualityAnalysis', 'analyzeTaskQuality');

    if (!result.success || !result.data) {
      this.logger.warn('analyzeTaskQuality 失败，返回回退结果', { error: result.error });
      return result;
    }

    const validRiskLevels = ['low', 'medium', 'high'];
    const analysis: TaskQualityAnalysis = {
      score: typeof result.data.score === 'number' ? Math.max(0, Math.min(100, result.data.score)) : 50,
      issues: Array.isArray(result.data.issues) ? result.data.issues.filter((i: any) => typeof i === 'string') : [],
      suggestions: Array.isArray(result.data.suggestions)
        ? result.data.suggestions.filter((s: any) => typeof s === 'string')
        : [],
      riskLevel: validRiskLevels.includes(result.data.riskLevel) ? result.data.riskLevel : 'medium',
    };

    this.logger.info('analyzeTaskQuality 完成', {
      score: analysis.score,
      riskLevel: analysis.riskLevel,
      issueCount: analysis.issues.length,
    });

    return {
      success: true,
      data: analysis,
      tokensUsed: result.tokensUsed,
    };
  }

  /**
   * 检测重复任务
   * 分析任务是否与其他任务重复或高度相似
   */
  async detectDuplicates(
    title: string,
    description: string,
    existingTasks: Array<{ id: string; title: string; description: string }>
  ): Promise<AIResult<DuplicateDetectionResult>> {
    this.logger.info('detectDuplicates 调用开始', {
      title,
      descriptionLength: description.length,
      existingTaskCount: existingTasks.length,
    });

    const tasksContext = existingTasks.map((t) => `Task ${t.id}: ${t.title}\n${t.description}`).join('\n\n---\n\n');

    const prompt = `${SYSTEM_PROMPT_DUPLICATES}

Analyze if this task is a duplicate of existing tasks:

NEW TASK:
Title: ${title}
Description: ${description}

EXISTING TASKS:
${tasksContext}

Return a JSON object with: hasDuplicates (boolean), duplicateTaskIds (array), similarityScores (object), reasons (array)`;

    const result = await this.callAI<DuplicateDetectionResult>(prompt, 'duplicateDetection', 'detectDuplicates');

    if (!result.success || !result.data) {
      this.logger.warn('detectDuplicates 失败，返回回退结果', { error: result.error });
      return result;
    }

    const detectionResult: DuplicateDetectionResult = {
      hasDuplicates: typeof result.data.hasDuplicates === 'boolean' ? result.data.hasDuplicates : false,
      duplicateTaskIds: Array.isArray(result.data.duplicateTaskIds)
        ? result.data.duplicateTaskIds.filter((id: any) => typeof id === 'string')
        : [],
      similarityScores:
        typeof result.data.similarityScores === 'object' && result.data.similarityScores !== null
          ? result.data.similarityScores
          : {},
      reasons: Array.isArray(result.data.reasons)
        ? result.data.reasons.filter((r: any) => typeof r === 'string')
        : [],
    };

    this.logger.info('detectDuplicates 完成', {
      hasDuplicates: detectionResult.hasDuplicates,
      duplicateCount: detectionResult.duplicateTaskIds.length,
    });

    return {
      success: true,
      data: detectionResult,
      tokensUsed: result.tokensUsed,
    };
  }

  /**
   * 评估任务过时性
   * 判断任务是否因时间、需求变化等原因变得过时
   */
  async assessStaleness(
    taskId: string,
    title: string,
    description: string,
    createdAt: string,
    lastUpdatedAt: string,
    status: string
  ): Promise<AIResult<StalenessAssessment>> {
    this.logger.info('assessStaleness 调用开始', {
      taskId,
      title,
      status,
      createdAt,
      lastUpdatedAt,
    });

    const prompt = `${SYSTEM_PROMPT_STALENESS}

Assess if this task has become stale:

Task ID: ${taskId}
Title: ${title}
Description: ${description}
Created: ${createdAt}
Last Updated: ${lastUpdatedAt}
Status: ${status}

Return a JSON object with: isStale (boolean), reasons (array), recommendedAction (keep/update/archive/delete), confidence (0-1)`;

    const result = await this.callAI<StalenessAssessment>(prompt, 'stalenessAssessment', 'assessStaleness');

    if (!result.success || !result.data) {
      this.logger.warn('assessStaleness 失败，返回回退结果', { error: result.error });
      return result;
    }

    const validActions = ['keep', 'update', 'archive', 'delete'];
    const assessment: StalenessAssessment = {
      isStale: typeof result.data.isStale === 'boolean' ? result.data.isStale : false,
      reasons: Array.isArray(result.data.reasons)
        ? result.data.reasons.filter((r: any) => typeof r === 'string')
        : [],
      recommendedAction: validActions.includes(result.data.recommendedAction)
        ? result.data.recommendedAction
        : 'keep',
      confidence: typeof result.data.confidence === 'number' ? Math.max(0, Math.min(1, result.data.confidence)) : 0.5,
    };

    this.logger.info('assessStaleness 完成', {
      isStale: assessment.isStale,
      recommendedAction: assessment.recommendedAction,
      confidence: assessment.confidence,
    });

    return {
      success: true,
      data: assessment,
      tokensUsed: result.tokensUsed,
    };
  }

  /**
   * 分析 Bug 报告
   * 从 Bug 描述中提取结构化信息
   */
  async analyzeBugReport(
    bugTitle: string,
    bugDescription: string,
    environment?: string
  ): Promise<AIResult<BugReportAnalysis>> {
    this.logger.info('analyzeBugReport 调用开始', {
      bugTitle,
      descriptionLength: bugDescription.length,
      hasEnvironment: !!environment,
    });

    const envContext = environment ? `\nEnvironment: ${environment}` : '';

    const prompt = `${SYSTEM_PROMPT_BUG_ANALYSIS}

Analyze this bug report:

Title: ${bugTitle}
Description: ${bugDescription}${envContext}

Return a JSON object with: severity (critical/high/medium/low), impact (string), possibleRootCauses (array), reproductionSteps (array), suggestedFixes (array)`;

    const result = await this.callAI<BugReportAnalysis>(prompt, 'bugAnalysis', 'analyzeBugReport');

    if (!result.success || !result.data) {
      this.logger.warn('analyzeBugReport 失败，返回回退结果', { error: result.error });
      return result;
    }

    const validSeverities = ['critical', 'high', 'medium', 'low'];
    const analysis: BugReportAnalysis = {
      severity: validSeverities.includes(result.data.severity) ? result.data.severity : 'medium',
      impact: typeof result.data.impact === 'string' ? result.data.impact : '',
      possibleRootCauses: Array.isArray(result.data.possibleRootCauses)
        ? result.data.possibleRootCauses.filter((r: any) => typeof r === 'string')
        : [],
      reproductionSteps: Array.isArray(result.data.reproductionSteps)
        ? result.data.reproductionSteps.filter((s: any) => typeof s === 'string')
        : [],
      suggestedFixes: Array.isArray(result.data.suggestedFixes)
        ? result.data.suggestedFixes.filter((f: any) => typeof f === 'string')
        : [],
    };

    this.logger.info('analyzeBugReport 完成', {
      severity: analysis.severity,
      rootCauseCount: analysis.possibleRootCauses.length,
      fixSuggestionCount: analysis.suggestedFixes.length,
    });

    return {
      success: true,
      data: analysis,
      tokensUsed: result.tokensUsed,
    };
  }
}

// ============================================================
// 向后兼容的静态方法封装
// ============================================================

/**
 * 向后兼容：静态方法封装
 * 保留静态方法以保持向后兼容性，内部创建实例调用
 */
export namespace AIMetadataAssistant {
  /**
   * 增强需求分析（向后兼容）
   */
  export async function enhanceRequirement(
    description: string,
    cwd = process.cwd()
  ): Promise<AIResult<AIEnhancedRequirement>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.enhanceRequirement(description);
  }

  /**
   * 增强检查点（向后兼容）
   */
  export async function enhanceCheckpoints(
    description: string,
    existingCheckpoints: string[],
    taskType: TaskType,
    cwd = process.cwd()
  ): Promise<AIResult<AIEnhancedCheckpoints>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.enhanceCheckpoints(description, existingCheckpoints, taskType);
  }

  /**
   * 分析任务质量（向后兼容）
   */
  export async function analyzeTaskQuality(
    title: string,
    description: string,
    cwd = process.cwd()
  ): Promise<AIResult<TaskQualityAnalysis>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.analyzeTaskQuality(title, description);
  }

  /**
   * 检测重复任务（向后兼容）
   */
  export async function detectDuplicates(
    title: string,
    description: string,
    existingTasks: Array<{ id: string; title: string; description: string }>,
    cwd = process.cwd()
  ): Promise<AIResult<DuplicateDetectionResult>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.detectDuplicates(title, description, existingTasks);
  }

  /**
   * 评估任务过时性（向后兼容）
   */
  export async function assessStaleness(
    taskId: string,
    title: string,
    description: string,
    createdAt: string,
    lastUpdatedAt: string,
    status: string,
    cwd = process.cwd()
  ): Promise<AIResult<StalenessAssessment>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.assessStaleness(taskId, title, description, createdAt, lastUpdatedAt, status);
  }

  /**
   * 分析 Bug 报告（向后兼容）
   */
  export async function analyzeBugReport(
    bugTitle: string,
    bugDescription: string,
    environment?: string,
    cwd = process.cwd()
  ): Promise<AIResult<BugReportAnalysis>> {
    const assistant = new AIMetadataAssistant(cwd);
    return assistant.analyzeBugReport(bugTitle, bugDescription, environment);
  }
}
