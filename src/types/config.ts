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
 * - customRequirements: 用户定制需求，按阶段注入到对应 Prompt 中
 *   也可以直接以模板名称为键（向后兼容）
 */
export interface PromptsConfig {
  /** 提示词模板语言，可选，默认为全局 language 设置 */
  language?: 'zh' | 'en';
  /** 自定义模板，键为模板名称，值为模板字符串 */
  customTemplates?: Record<string, string>;
  /**
   * 用户定制需求，按阶段注入到对应 Prompt 中
   * 键为阶段名（dev, codeReview, qa, evaluation），值为该阶段的定制需求内容
   */
  customRequirements?: {
    dev?: string;
    codeReview?: string;
    qa?: string;
    evaluation?: string;
  };
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

/**
 * 标准格式检测配置
 */
export interface StandardFormatDetection {
  /** 是否启用 JUnit XML 检测，默认 false */
  junitXml?: boolean;
  /** 是否启用 TAP 检测，默认 false */
  tap?: boolean;
}

/**
 * 测试失败解析规则
 */
export interface TestFailurePattern {
  /** 规则名称，如 "bun-fail", "jest-fail" */
  name: string;
  /** 正则表达式字符串（序列化用） */
  pattern: string;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 规则描述 */
  description?: string;
}

/**
 * Harness 测试配置
 */
export interface HarnessTestConfig {
  /** 测试命令，默认 'npm test' */
  testCommand?: string;
  /** 标准格式检测配置 */
  standardFormatDetection?: StandardFormatDetection;
  /** 自定义测试失败解析规则（优先于内置规则） */
  testFailurePatterns?: TestFailurePattern[];
  /** 解析失败时是否输出原始日志，默认 true */
  fallbackToRawOutput?: boolean;
  /** 原始输出截取长度，默认 500 */
  rawOutputMaxLength?: number;
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

/**
 * 子进程内存限制配置
 *
 * 通过 cgroup v2 MemoryMax 为 bun/claude 子进程施加硬内存限制，
 * 防止 JSC heap 贪心分配在 harness 长运行中触发系统 OOM。
 *
 * @see docs/investigation-oom/OOM-INVESTIGATION-REPORT.md
 */
export interface HarnessMemoryLimitConfig {
  /** 默认子进程内存上限 (GB)，默认 4 */
  defaultGB?: number;
  /** 特定场景覆盖 */
  overrides?: {
    /** npm run test:coverage 上限 (GB)，默认 8 */
    coverage?: number;
    /** Claude CLI 子 agent 上限 (GB)，默认 8 */
    claudeAgent?: number;
    /** npm run build 上限 (GB)，默认 2 */
    build?: number;
  };
  /** swap 上限 (GB)，默认 0。设为 0 表示禁用 swap */
  swapMaxGB?: number;
  /** 是否启用 cgroup 限制。非 Linux 环境自动禁用。默认 true */
  enabled?: boolean;
}

/** Harness 阶段 CLI 选项配置 */
export interface HarnessPhaseOptions {
  /** 最小模式：跳过 hooks, LSP, plugin sync 等 */
  bare?: boolean;
  /** 禁用会话持久化 */
  noSessionPersistence?: boolean;
  /** MCP 配置文件路径 */
  mcpConfig?: string[];
  /** 仅使用指定 MCP 配置 */
  strictMcpConfig?: boolean;
  /** 插件目录 */
  pluginDir?: string[];
  /** 插件 URL */
  pluginUrl?: string[];
  /** 禁用 skills */
  disableSlashCommands?: boolean;
  /** 努力程度 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** API 预算上限 */
  maxBudgetUsd?: number;
  /** 调试模式 */
  debug?: boolean;
}

/** Harness 配置 */
export interface HarnessConfig {
  /** 各阶段允许的工具列表（覆盖代码默认值） */
  perPhaseTools?: HarnessToolsConfig;
  /** 各阶段 CLI 选项配置 */
  perPhaseOptions?: Record<string, HarnessPhaseOptions>;
  /** 测试相关配置 */
  test?: HarnessTestConfig;
  /** 子进程内存限制配置。默认 defaultGB=4, enabled=true */
  memoryLimit?: HarnessMemoryLimitConfig;
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
