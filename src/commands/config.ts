import * as fs from 'fs';
import { getConfigPath, isInitialized } from '../utils/path';

interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  maxFiles: number;
  recordInputs: boolean;
  inputMaxLength: number;
}

interface AIConfig {
  provider: 'claude-code' | 'custom-endpoint';
  customEndpoint?: string;
}

interface TrainingConfig {
  exportEnabled: boolean;
  outputDir: string;
}

/**
 * 提示词模板配置
 * 键为模板名称（如 dev, codeReview, qa 等），值为自定义模板字符串
 * 未配置的模板使用内置默认值
 */
interface PromptsConfig {
  [templateName: string]: string;
}

interface QualityConfig {
  /** 最低质量评分阈值 (0-100)，低于此分数判定为 NOPASS (IR-08-06) */
  minScore?: number;
}

interface ProjectConfig {
  projectName: string;
  createdAt: string;
  branchPrefix: string;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  logging?: LoggingConfig;
  ai?: AIConfig;
  training?: TrainingConfig;
  prompts?: PromptsConfig;
  quality?: QualityConfig;
  [key: string]: unknown;
}

/** 日志配置默认值 */
const DEFAULT_LOGGING: LoggingConfig = {
  level: 'info',
  maxFiles: 30,
  recordInputs: true,
  inputMaxLength: 500,
};

/** AI 配置默认值 */
const DEFAULT_AI: AIConfig = {
  provider: 'claude-code',
};

/** 训练数据配置默认值 */
const DEFAULT_TRAINING: TrainingConfig = {
  exportEnabled: false,
  outputDir: '.projmnt4claude/training-data/',
};

/**
 * 确保配置文件包含所有默认配置项
 * 缺失的配置项自动写入默认值
 */
export function ensureConfigDefaults(config: ProjectConfig): ProjectConfig {
  const result = { ...config };

  // logging 配置完整性
  if (!result.logging) {
    result.logging = { ...DEFAULT_LOGGING };
  } else {
    result.logging = {
      level: result.logging.level ?? DEFAULT_LOGGING.level,
      maxFiles: result.logging.maxFiles ?? DEFAULT_LOGGING.maxFiles,
      recordInputs: result.logging.recordInputs ?? DEFAULT_LOGGING.recordInputs,
      inputMaxLength: result.logging.inputMaxLength ?? DEFAULT_LOGGING.inputMaxLength,
    };
  }

  // ai 配置完整性
  if (!result.ai) {
    result.ai = { ...DEFAULT_AI };
  } else {
    result.ai = {
      provider: result.ai.provider ?? DEFAULT_AI.provider,
      ...(result.ai.customEndpoint !== undefined ? { customEndpoint: result.ai.customEndpoint } : {}),
    };
  }

  // training 配置完整性
  if (!result.training) {
    result.training = { ...DEFAULT_TRAINING };
  } else {
    result.training = {
      exportEnabled: result.training.exportEnabled ?? DEFAULT_TRAINING.exportEnabled,
      outputDir: result.training.outputDir ?? DEFAULT_TRAINING.outputDir,
    };
  }

  return result;
}

/**
 * 读取配置文件
 */
export function readConfig(cwd: string = process.cwd()): ProjectConfig | null {
  if (!isInitialized(cwd)) {
    return null;
  }

  const configPath = getConfigPath(cwd);
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * 写入配置文件
 */
export function writeConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const configPath = getConfigPath(cwd);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 获取嵌套键的值
 * 支持点分隔符，如 "branchPrefix" 或 "nested.key"
 */
export function getConfigValue(config: ProjectConfig, key: string): unknown {
  const keys = key.split('.');
  let value: unknown = config;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * 设置嵌套键的值
 */
export function setConfigValue(config: ProjectConfig, key: string, value: string): ProjectConfig {
  const keys = key.split('.');
  const result = { ...config };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (!(k in current) || typeof current[k] !== 'object') {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }

  // 尝试解析 JSON 值，如果失败则作为字符串
  try {
    current[keys[keys.length - 1]!] = JSON.parse(value);
  } catch {
    current[keys[keys.length - 1]!] = value;
  }

  return result;
}

/**
 * 列出所有配置项
 */
export function listConfig(cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('错误: 无法读取配置文件');
    process.exit(1);
  }

  console.log('当前配置:\n');
  console.log(JSON.stringify(config, null, 2));
}

/**
 * 获取指定配置值
 */
export function getConfig(key: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('错误: 无法读取配置文件');
    process.exit(1);
  }

  const value = getConfigValue(config, key);
  if (value === undefined) {
    console.error(`错误: 配置项 '${key}' 不存在`);
    process.exit(1);
  }

  console.log(value);
}

/**
 * 设置指定配置值
 */
export function setConfig(key: string, value: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('错误: 无法读取配置文件');
    process.exit(1);
  }

  const newConfig = setConfigValue(config, key, value);
  writeConfig(newConfig, cwd);

  console.log(`✓ 已设置 ${key} = ${value}`);
}
