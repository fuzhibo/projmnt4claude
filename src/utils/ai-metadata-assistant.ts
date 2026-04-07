/**
 * AI 元数据助手
 * 使用 Anthropic API 增强任务需求分析结果
 * 无额外 SDK 依赖，直接使用 fetch 调用 API
 */

import type { TaskPriority, TaskType } from '../types/task';
import { Logger } from './logger';

const logger = new Logger({ component: 'ai-metadata-assistant' });

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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

/**
 * 从环境变量获取 API Key
 */
function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || null;
}

/**
 * 调用 Anthropic API
 */
async function callAnthropicAPI(systemPrompt: string, userPrompt: string): Promise<AIResult<string>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: 'ANTHROPIC_API_KEY not set' };
  }

  const startTime = Date.now();
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      return { success: false, error: `API ${response.status}: ${errorText}` };
    }

    const data = await response.json() as any;
    const content = data?.content?.[0]?.text || '';
    const inputTokens = data?.usage?.input_tokens || 0;
    const outputTokens = data?.usage?.output_tokens || 0;
    const durationMs = Date.now() - startTime;

    logger.logAICost({
      field: 'enhanceRequirement',
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });

    return {
      success: true,
      data: content,
      tokensUsed: { input: inputTokens, output: outputTokens },
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * 安全解析 JSON（从 AI 响应中提取）
 */
function extractJSON(text: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 尝试从 markdown code block 中提取
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch?.[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // fall through
      }
    }
    // 尝试找到第一个 { ... } 块
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        // fall through
      }
    }
    return null;
  }
}

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

/**
 * AI 元数据助手类
 * 提供需求分析和检查点增强功能
 */
export class AIMetadataAssistant {
  /**
   * 增强需求分析
   * 调用 AI API 获取增强后的任务元数据
   */
  static async enhanceRequirement(description: string): Promise<AIResult<AIEnhancedRequirement>> {
    const userPrompt = `Analyze this requirement and return enhanced metadata as JSON:

${description}

Return JSON with: title, priority, priorityReason, recommendedRole, estimatedComplexity, checkpoints, dependencies`;

    const result = await callAnthropicAPI(SYSTEM_PROMPT_ENHANCE, userPrompt);

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const parsed = extractJSON(result.data);
    if (!parsed) {
      return { success: false, error: 'Failed to parse AI response as JSON' };
    }

    // 验证并规范化字段
    const validPriorities: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
    const validComplexities = ['low', 'medium', 'high'];
    const validRoles = ['developer', 'frontend', 'backend', 'qa', 'writer', 'security', 'performance', 'architect', 'devops'];

    const enhanced: AIEnhancedRequirement = {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      priority: validPriorities.includes(parsed.priority) ? parsed.priority : 'P2',
      priorityReason: typeof parsed.priorityReason === 'string' ? parsed.priorityReason : '',
      recommendedRole: validRoles.includes(parsed.recommendedRole) ? parsed.recommendedRole : 'developer',
      estimatedComplexity: validComplexities.includes(parsed.estimatedComplexity) ? parsed.estimatedComplexity : 'medium',
      checkpoints: Array.isArray(parsed.checkpoints)
        ? parsed.checkpoints.filter((cp: any) => typeof cp === 'string' && cp.length > 3)
        : [],
      dependencies: Array.isArray(parsed.dependencies)
        ? parsed.dependencies.filter((d: any) => typeof d === 'string' && d.length > 3)
        : [],
    };

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
  static async enhanceCheckpoints(
    description: string,
    existingCheckpoints: string[],
    taskType: TaskType
  ): Promise<AIResult<AIEnhancedCheckpoints>> {
    const userPrompt = `Enhance these checkpoints for a ${taskType} task:

Description: ${description}

Existing checkpoints:
${existingCheckpoints.map((cp, i) => `${i + 1}. ${cp}`).join('\n')}

Return enhanced checkpoints as JSON with "checkpoints" and "verificationHints" arrays.`;

    const result = await callAnthropicAPI(SYSTEM_PROMPT_CHECKPOINTS, userPrompt);

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const parsed = extractJSON(result.data);
    if (!parsed) {
      return { success: false, error: 'Failed to parse AI response as JSON' };
    }

    const enhanced: AIEnhancedCheckpoints = {
      checkpoints: Array.isArray(parsed.checkpoints)
        ? parsed.checkpoints.filter((cp: any) => typeof cp === 'string' && cp.length > 3)
        : [],
      verificationHints: Array.isArray(parsed.verificationHints)
        ? parsed.verificationHints.filter((h: any) => typeof h === 'string')
        : [],
    };

    return {
      success: true,
      data: enhanced,
      tokensUsed: result.tokensUsed,
    };
  }
}
