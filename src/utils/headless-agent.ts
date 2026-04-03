/**
 * 可插拔 Headless Agent 接口层
 *
 * 抽象 AI Agent 调用为统一接口，支持当前 Claude Code 实现，未来可替换为私有模型。
 * - CP-1: HeadlessAgent 接口定义
 * - CP-2: 核心接口 invoke(prompt, options) -> AgentResult
 * - CP-3: AgentInvokeOptions 类型
 * - CP-4: AgentResult 类型
 * - CP-5: AgentProviderRegistry 注册中心
 * - CP-6: 内置 claude-code provider
 * - CP-7: config.json ai.provider 配置
 * - CP-8: Logger 集成
 */

import { Logger } from './logger.js';
import { runHeadlessClaude, runHeadlessClaudeWithRetry, isRetryableError } from './harness-helpers.js';

// ============================================================
// 类型定义
// ============================================================

/** 输出格式 */
export type AgentOutputFormat = 'text' | 'json' | 'markdown';

/** Agent 调用选项 */
export interface AgentInvokeOptions {
  /** 超时时间（秒） */
  timeout: number;
  /** 允许的工具列表 */
  allowedTools: string[];
  /** 输出格式 */
  outputFormat: AgentOutputFormat;
  /** 最大重试次数（不含首次调用） */
  maxRetries: number;
  /** 期望输出的 JSON Schema（用于结构化输出） */
  schema?: Record<string, unknown>;
  /** 工作目录 */
  cwd: string;
}

/** Agent 调用结果 */
export interface AgentResult {
  /** Agent 输出文本 */
  output: string;
  /** 调用是否成功 */
  success: boolean;
  /** 提供者标识 */
  provider: string;
  /** 调用耗时（毫秒） */
  durationMs: number;
  /** Token 使用量 */
  tokensUsed: number;
  /** 使用的模型名称 */
  model: string;
  /** 错误信息（失败时） */
  error?: string;
  /** Hook 警告（成功但含 hook 错误时） */
  hookWarning?: string;
}

/** Headless Agent 核心接口 */
export interface HeadlessAgent {
  /** 提供者名称 */
  readonly name: string;

  /** 调用 Agent */
  invoke(prompt: string, options: AgentInvokeOptions): Promise<AgentResult>;
}

/** AI 配置（对应 config.json 中 ai 字段） */
export interface AIConfig {
  /** 提供者标识，默认 'claude-code' */
  provider: string;
  /** 提供者专有配置 */
  providerOptions?: Record<string, unknown>;
}

// ============================================================
// AgentProviderRegistry
// ============================================================

class AgentProviderRegistryImpl {
  private providers = new Map<string, HeadlessAgent>();
  private defaultProvider: string = 'claude-code';
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'headless-agent' });
  }

  /** 注册 provider */
  register(provider: HeadlessAgent): void {
    if (this.providers.has(provider.name)) {
      this.logger.warn(`Provider '${provider.name}' 已存在，将被覆盖`);
    }
    this.providers.set(provider.name, provider);
    this.logger.info(`注册 Agent provider: ${provider.name}`);
  }

  /** 获取指定 provider */
  getProvider(name?: string): HeadlessAgent {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Agent provider '${providerName}' 未注册。可用: ${[...this.providers.keys()].join(', ')}`);
    }
    return provider;
  }

  /** 设置默认 provider */
  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`无法设置默认 provider: '${name}' 未注册`);
    }
    this.defaultProvider = name;
    this.logger.info(`默认 Agent provider 设置为: ${name}`);
  }

  /** 获取默认 provider 名称 */
  getDefaultName(): string {
    return this.defaultProvider;
  }

  /** 列出所有已注册 provider */
  listProviders(): string[] {
    return [...this.providers.keys()];
  }
}

/** 全局单例 Registry */
export const agentRegistry = new AgentProviderRegistryImpl();

// ============================================================
// Claude Code Provider（内置）
// ============================================================

/**
 * Claude Code provider
 * 复用 harness-helpers.ts 的 runHeadlessClaude() 实现
 */
export class ClaudeCodeProvider implements HeadlessAgent {
  readonly name = 'claude-code';
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'headless-agent:claude-code' });
  }

  async invoke(prompt: string, options: AgentInvokeOptions): Promise<AgentResult> {
    const startTime = Date.now();
    this.logger.info('调用 Claude Code', {
      timeout: options.timeout,
      allowedTools: options.allowedTools,
      cwd: options.cwd,
    });

    const claudeOptions = {
      prompt,
      allowedTools: options.allowedTools,
      timeout: options.timeout,
      cwd: options.cwd,
    };

    let result;
    if (options.maxRetries > 0) {
      result = await runHeadlessClaudeWithRetry(claudeOptions, {
        maxAttempts: options.maxRetries,
        baseDelay: 60,
      });
    } else {
      result = await runHeadlessClaude(claudeOptions);
    }

    const durationMs = Date.now() - startTime;

    // 提取 token 使用量（从输出中解析，Claude CLI 不直接返回 token 统计）
    const tokensUsed = this.extractTokens(result.output);

    this.logger.info('Claude Code 调用完成', {
      success: result.success,
      durationMs,
      tokensUsed,
    });

    if (result.success) {
      this.logger.logAICost({
        field: 'headless-agent:invoke',
        durationMs,
        inputTokens: 0,
        outputTokens: tokensUsed,
        totalTokens: tokensUsed,
      });
    }

    return {
      output: result.output,
      success: result.success,
      provider: this.name,
      durationMs,
      tokensUsed,
      model: 'claude-code',
      error: result.error,
      hookWarning: result.hookWarning,
    };
  }

  /** 从 Claude 输出中尝试提取 token 信息 */
  private extractTokens(output: string): number {
    // Claude CLI 的 --print 模式不直接输出 token 统计
    // 尝试从可能的 token 报告格式中提取
    const tokenMatch = output.match(/tokens?[:\s]+(\d+)/i);
    return tokenMatch ? parseInt(tokenMatch[1]!, 10) : 0;
  }
}

// ============================================================
// 初始化：注册内置 provider
// ============================================================

/** 注册所有内置 providers（模块加载时自动执行） */
export function initializeProviders(): void {
  if (!agentRegistry.listProviders().includes('claude-code')) {
    agentRegistry.register(new ClaudeCodeProvider());
  }
}

// 模块加载时自动注册
initializeProviders();

// ============================================================
// 配置加载
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getConfigPath } from './path.js';

/** 默认 AI 配置 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'claude-code',
};

/** 从项目 config.json 加载 AI 配置 */
export function loadAIConfig(cwd: string): AIConfig {
  try {
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
      return DEFAULT_AI_CONFIG;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.ai) {
      return DEFAULT_AI_CONFIG;
    }
    return {
      provider: config.ai.provider || DEFAULT_AI_CONFIG.provider,
      providerOptions: config.ai.providerOptions,
    };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

/** 获取当前配置的 Agent */
export function getAgent(cwd: string): HeadlessAgent {
  const aiConfig = loadAIConfig(cwd);
  return agentRegistry.getProvider(aiConfig.provider);
}

/** 便捷方法：通过 provider 直接调用 Agent */
export async function invokeAgent(
  prompt: string,
  options: AgentInvokeOptions,
): Promise<AgentResult> {
  const agent = getAgent(options.cwd);
  return agent.invoke(prompt, options);
}
