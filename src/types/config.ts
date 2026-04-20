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
 * AI 场景预设配置
 *
 * 为不同 AI 调用场景定义特定的超时、重试等参数
 */
export interface AIScenarioPreset {
  /** 场景名称 */
  name: string;
  /** 超时时间（秒） */
  timeout: number;
  /** 最大重试次数（不含首次调用） */
  maxRetries: number;
  /** 允许的工具列表 */
  allowedTools: string[];
  /** 输出格式 */
  outputFormat: 'text' | 'json' | 'markdown';
  /** 描述信息 */
  description?: string;
}

/**
 * AI 配置（统一类型）
 *
 * 合并了原 config.ts 和 headless-agent.ts 中的 AIConfig 定义。
 * - provider: 提供者标识
 * - customEndpoint: 自定义端点 URL（原 config.ts 字段）
 * - providerOptions: 提供者专有配置（原 headless-agent.ts 字段）
 * - timeout: 默认超时时间（秒）
 * - maxRetries: 默认最大重试次数
 * - presets: 各场景预设配置
 */
export interface AIConfig {
  provider: string;
  customEndpoint?: string;
  providerOptions?: Record<string, unknown>;
  /** 默认超时时间（秒） */
  timeout?: number;
  /** 默认最大重试次数 */
  maxRetries?: number;
  /** 场景预设配置 */
  presets?: {
    /** 元数据增强场景 */
    metadataEnhancement?: AIScenarioPreset;
    /** 需求分解场景 */
    decomposition?: AIScenarioPreset;
    /** 代码审查场景 */
    codeReview?: AIScenarioPreset;
    /** 质量分析场景 */
    qualityAnalysis?: AIScenarioPreset;
    /** 重复检测场景 */
    duplicateDetection?: AIScenarioPreset;
    /** 过时评估场景 */
    stalenessAssessment?: AIScenarioPreset;
    /** Bug 分析场景 */
    bugAnalysis?: AIScenarioPreset;
    /** 检查点增强场景 */
    checkpointEnhancement?: AIScenarioPreset;
  };
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
  timeout: 60,
  maxRetries: 1,
  presets: {
    metadataEnhancement: {
      name: 'metadataEnhancement',
      timeout: 60,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: '元数据增强：分析需求并返回增强后的任务元数据',
    },
    decomposition: {
      name: 'decomposition',
      timeout: 90,
      maxRetries: 2,
      allowedTools: ['Read', 'Glob', 'Grep'],
      outputFormat: 'text',
      description: '需求分解：将复杂需求分解为多个子任务',
    },
    codeReview: {
      name: 'codeReview',
      timeout: 120,
      maxRetries: 1,
      allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
      outputFormat: 'text',
      description: '代码审查：分析代码并提供审查意见',
    },
    qualityAnalysis: {
      name: 'qualityAnalysis',
      timeout: 60,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: '质量分析：评估任务描述的清晰度和完整性',
    },
    duplicateDetection: {
      name: 'duplicateDetection',
      timeout: 90,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: '重复检测：检测任务是否与其他任务重复',
    },
    stalenessAssessment: {
      name: 'stalenessAssessment',
      timeout: 60,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: '过时评估：评估任务是否已过时',
    },
    bugAnalysis: {
      name: 'bugAnalysis',
      timeout: 60,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: 'Bug分析：从Bug报告中提取结构化信息',
    },
    checkpointEnhancement: {
      name: 'checkpointEnhancement',
      timeout: 60,
      maxRetries: 1,
      allowedTools: [],
      outputFormat: 'text',
      description: '检查点增强：优化检查点使其更具体可验证',
    },
  },
};

/**
 * 获取 AI 场景预设配置
 * @param scenario - 场景名称
 * @param overrides - 可选的覆盖配置
 * @returns 合并后的预设配置
 */
export function getAIPreset(
  scenario: keyof NonNullable<AIConfig['presets']>,
  overrides?: Partial<AIScenarioPreset>
): AIScenarioPreset {
  const preset = DEFAULT_AI.presets?.[scenario];
  if (!preset) {
    throw new Error(`未知的 AI 场景预设: ${String(scenario)}`);
  }
  return {
    ...preset,
    ...overrides,
  };
}

/**
 * 构建 Agent 调用选项
 * @param scenario - 场景名称
 * @param cwd - 工作目录
 * @param overrides - 可选的覆盖配置
 * @returns Agent 调用选项
 */
export function buildAgentOptionsFromPreset(
  scenario: keyof NonNullable<AIConfig['presets']>,
  cwd: string,
  overrides?: Partial<AIScenarioPreset>
): {
  timeout: number;
  allowedTools: string[];
  outputFormat: 'text' | 'json' | 'markdown';
  maxRetries: number;
  cwd: string;
  dangerouslySkipPermissions: boolean;
} {
  const preset = getAIPreset(scenario, overrides);
  return {
    timeout: preset.timeout,
    allowedTools: preset.allowedTools,
    outputFormat: preset.outputFormat,
    maxRetries: preset.maxRetries,
    cwd,
    dangerouslySkipPermissions: true,
  };
}

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
