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
import { type AIConfig, DEFAULT_AI, type HarnessToolsConfig } from '../types/config.js';
import type { TaskMeta } from '../types/task.js';

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
  /** 跳过权限确认（对应 --dangerously-skip-permissions） */
  dangerouslySkipPermissions?: boolean;
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
  /** 捕获的 stderr 输出 */
  stderr?: string;
  /** 进程退出码 */
  exitCode?: number;
}

/** Headless Agent 核心接口 */
export interface HeadlessAgent {
  /** 提供者名称 */
  readonly name: string;

  /** 调用 Agent */
  invoke(prompt: string, options: AgentInvokeOptions): Promise<AgentResult>;
}

// ============================================================
// Provider → CLI flag 翻译
// ============================================================

/**
 * 将 AgentInvokeOptions 映射为 claude CLI 参数
 *
 * 提供从抽象 provider 选项到具体 CLI flag 的翻译层，
 * 使不同 provider 的参数格式可以正确适配 CLI。
 */
export function translateOptionsToCliArgs(options: AgentInvokeOptions): string[] {
  const args: string[] = ['--print'];

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', options.allowedTools.join(','));
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (options.outputFormat === 'json') {
    args.push('--output-format', 'json');
  }

  return args;
}

// ============================================================
// 阶段默认工具 & 3级优先级链
// ============================================================

/** 各阶段硬编码的默认工具列表 */
const PHASE_DEFAULT_TOOLS: Record<string, string[]> = {
  development: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
  codeReview: ['Read', 'Bash', 'Grep', 'Glob'],
  qaVerification: ['Read', 'Bash', 'Grep', 'Glob'],
  evaluation: ['Read', 'Bash', 'Grep', 'Glob'],
};

/** Harness 阶段名称到 config perPhaseTools 键的映射 */
const PHASE_CONFIG_KEY: Record<string, keyof HarnessToolsConfig> = {
  development: 'development',
  codeReview: 'codeReview',
  code_review: 'codeReview',
  qaVerification: 'qaVerification',
  qa_verification: 'qaVerification',
  evaluation: 'evaluation',
};

/**
 * 按三级优先级链解析有效工具列表
 *
 * Level 1: TaskMeta.allowedTools（任务级限制，过滤下级工具）
 * Level 2: config.harness.perPhaseTools[phase]（阶段级配置）
 * Level 3: PHASE_DEFAULT_TOOLS[phase]（代码默认值）
 *
 * @param phase - 阶段名称（development/codeReview/qaVerification/evaluation）
 * @param cwd - 工作目录（用于读取 config）
 * @param task - 可选的任务元数据（提供任务级 allowedTools）
 * @returns { tools: string[], skipPermissions: boolean }
 */
export function buildEffectiveTools(
  phase: string,
  cwd: string,
  task?: TaskMeta,
): { tools: string[]; skipPermissions: boolean } {
  // Level 3: 代码默认值
  const codeDefaults = PHASE_DEFAULT_TOOLS[phase] || ['Read', 'Bash', 'Grep', 'Glob'];

  // Level 2: config 阶段级配置
  const configKey = PHASE_CONFIG_KEY[phase];
  let phaseTools = codeDefaults;
  try {
    const configPath = getConfigPath(cwd);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const configPhaseTools = config?.harness?.perPhaseTools?.[configKey || phase];
      if (Array.isArray(configPhaseTools) && configPhaseTools.length > 0) {
        phaseTools = configPhaseTools;
      }
    }
  } catch {
    // 配置读取失败，使用代码默认值
  }

  // Level 1: TaskMeta 任务级限制
  if (task?.allowedTools && task.allowedTools.length > 0) {
    // 任务指定了 allowedTools → 过滤阶段工具，不跳过权限
    const taskToolSet = new Set(task.allowedTools);
    const effectiveTools = phaseTools.filter(t => taskToolSet.has(t));
    return { tools: effectiveTools, skipPermissions: false };
  }

  // 无任务级限制 → 使用阶段工具，跳过权限（向后兼容）
  return { tools: phaseTools, skipPermissions: true };
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
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      outputFormat: options.outputFormat,
    });

    const claudeOptions = {
      prompt,
      allowedTools: options.allowedTools,
      timeout: options.timeout,
      cwd: options.cwd,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      outputFormat: options.outputFormat === 'json' ? 'json' : undefined,
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

    // 从输出中提取 token 使用量（支持 JSON/text 格式）
    const tokensUsed = this.extractTokens(result.output);
    const model = this.extractModel(result.output);

    this.logger.info('Claude Code 调用完成', {
      success: result.success,
      durationMs,
      tokensUsed,
      model,
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
      model,
      error: result.error,
      hookWarning: result.hookWarning,
      stderr: result.stderr,
    };
  }

  /**
   * 从 Claude 输出中提取 token 使用量
   *
   * 支持三种格式：
   * 1. JSON 输出（--output-format json）：解析 usage 字段
   * 2. JSONL 输出（--output-format stream-json）：逐行解析累计
   * 3. 文本输出：正则匹配 token 报告
   *
   * 限制：Claude CLI --print 模式的 text 输出不包含 token 统计，
   * 使用 --output-format json 可获得更准确的统计。
   */
  private extractTokens(output: string): number {
    // 策略 1：尝试解析为单个 JSON 对象（--output-format json）
    try {
      const jsonOutput = JSON.parse(output);
      if (jsonOutput && typeof jsonOutput === 'object') {
        const usage = jsonOutput.usage;
        if (usage) {
          return (usage.input_tokens || 0) + (usage.output_tokens || 0);
        }
      }
    } catch {
      // 非 JSON 格式，继续尝试其他策略
    }

    // 策略 2：尝试解析为 JSONL（--output-format stream-json）
    let totalTokens = 0;
    let foundJsonl = false;
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        foundJsonl = true;
        if (obj?.usage) {
          totalTokens += (obj.usage.input_tokens || 0) + (obj.usage.output_tokens || 0);
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
    if (foundJsonl && totalTokens > 0) return totalTokens;

    // 策略 3：正则匹配文本中的 token 报告（兜底）
    const tokenMatch = output.match(/tokens?[:\s]+(\d+)/i);
    return tokenMatch ? parseInt(tokenMatch[1]!, 10) : 0;
  }

  /** 从 Claude 输出中提取模型名称 */
  private extractModel(output: string): string {
    try {
      const jsonOutput = JSON.parse(output);
      if (jsonOutput?.model) return jsonOutput.model;
    } catch {
      // 非 JSON
    }
    return 'claude-code';
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

/** 从项目 config.json 加载 AI 配置 */
export function loadAIConfig(cwd: string): AIConfig {
  try {
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
      return DEFAULT_AI;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.ai) {
      return DEFAULT_AI;
    }
    return {
      provider: config.ai.provider || DEFAULT_AI.provider,
      customEndpoint: config.ai.customEndpoint,
      providerOptions: config.ai.providerOptions,
    };
  } catch {
    return DEFAULT_AI;
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
