/**
 * 统一配置类型定义
 *
 * 所有配置相关的类型、默认值集中定义于此，
 * config.ts 和 headless-agent.ts 统一导入。
 */

/** 日志级别 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 日志配置 */
export interface LoggingConfig {
  level: LogLevel;
  maxFiles: number;
  recordInputs: boolean;
  inputMaxLength: number;
}

/**
 * AI 配置（统一类型）
 *
 * 合并了原 config.ts 和 headless-agent.ts 中的 AIConfig 定义。
 * - provider: 提供者标识
 * - customEndpoint: 自定义端点 URL（原 config.ts 字段）
 * - providerOptions: 提供者专有配置（原 headless-agent.ts 字段）
 */
export interface AIConfig {
  provider: string;
  customEndpoint?: string;
  providerOptions?: Record<string, unknown>;
}

/** 训练数据配置 */
export interface TrainingConfig {
  exportEnabled: boolean;
  outputDir: string;
}

/**
 * 提示词模板配置
 *
 * 支持以下配置项：
 * - language: 提示词模板语言，可选，默认为全局 language 设置
 * - customTemplates: 自定义模板，键为模板名称（如 dev, codeReview, qa 等），值为模板字符串
 *   也可以直接以模板名称为键（向后兼容）
 */
export interface PromptsConfig {
  /** 提示词模板语言，可选，默认为全局 language 设置 */
  language?: 'zh' | 'en';
  /** 自定义模板，键为模板名称，值为模板字符串 */
  customTemplates?: Record<string, string>;
  /** 向后兼容：直接以模板名称为键 */
  [templateName: string]: string | 'zh' | 'en' | Record<string, string> | undefined;
}

/** Git Hook 配置 */
export interface GitHookConfig {
  /** 是否启用 git hook 检测和创建（默认 true） */
  enabled: boolean;
}

/** 质量配置 */
export interface QualityConfig {
  /** 最低质量评分阈值 (0-100)，低于此分数判定为 NOPASS */
  minScore?: number;
}

/** Harness 阶段工具配置 */
export interface HarnessToolsConfig {
  /** 开发阶段允许的工具 */
  development?: string[];
  /** 代码审核阶段允许的工具 */
  codeReview?: string[];
  /** QA 验证阶段允许的工具 */
  qaVerification?: string[];
  /** 评估阶段允许的工具 */
  evaluation?: string[];
}

/** Harness 配置 */
export interface HarnessConfig {
  /** 各阶段允许的工具列表（覆盖代码默认值） */
  perPhaseTools?: HarnessToolsConfig;
}

/** 项目配置 */
export interface ProjectConfig {
  projectName: string;
  createdAt: string;
  branchPrefix: string;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  logging?: LoggingConfig;
  ai?: AIConfig;
  training?: TrainingConfig;
  prompts?: PromptsConfig;
  quality?: QualityConfig;
  harness?: HarnessConfig;
  gitHook?: GitHookConfig;
  [key: string]: unknown;
}

/** 日志配置默认值 */
export const DEFAULT_LOGGING: LoggingConfig = {
  level: 'info',
  maxFiles: 30,
  recordInputs: true,
  inputMaxLength: 500,
};

/** AI 配置默认值 */
export const DEFAULT_AI: AIConfig = {
  provider: 'claude-code',
};

/** 训练数据配置默认值 */
export const DEFAULT_TRAINING: TrainingConfig = {
  exportEnabled: false,
  outputDir: '.projmnt4claude/training-data/',
};

/** Git Hook 配置默认值 */
export const DEFAULT_GIT_HOOK: GitHookConfig = {
  enabled: true,
};

/** 日志级别合法值 */
export const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
