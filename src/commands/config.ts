import * as fs from 'fs';
import { getConfigPath, isInitialized } from '../utils/path';
import { PROMPT_TEMPLATE_NAMES, DEFAULT_TEMPLATES } from '../utils/prompt-templates';
import {
  type ProjectConfig,
  type AIConfig,
  type LoggingConfig,
  type TrainingConfig,
  type GitHookConfig,
  DEFAULT_LOGGING,
  DEFAULT_AI,
  DEFAULT_TRAINING,
  DEFAULT_GIT_HOOK,
} from '../types/config.js';

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
      ...(result.ai.providerOptions !== undefined ? { providerOptions: result.ai.providerOptions } : {}),
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

  // gitHook 配置完整性
  if (!result.gitHook) {
    result.gitHook = { ...DEFAULT_GIT_HOOK };
  } else {
    result.gitHook = {
      enabled: result.gitHook.enabled ?? DEFAULT_GIT_HOOK.enabled,
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

// ============================================================
// Config Schema 验证 (IR-05-05)
// ============================================================

/** 配置键验证规则 */
interface ConfigKeySchema {
  type: 'string' | 'number' | 'boolean';
  enum?: string[];
  min?: number;
  max?: number;
}

/** 已知配置项及其验证规则 */
const CONFIG_SCHEMA: Record<string, ConfigKeySchema> = {
  'projectName': { type: 'string' },
  'branchPrefix': { type: 'string' },
  'defaultPriority': { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
  'logging.level': { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
  'logging.maxFiles': { type: 'number', min: 1 },
  'logging.recordInputs': { type: 'boolean' },
  'logging.inputMaxLength': { type: 'number', min: 0 },
  'ai.provider': { type: 'string' },
  'ai.customEndpoint': { type: 'string' },
  'training.exportEnabled': { type: 'boolean' },
  'training.outputDir': { type: 'string' },
  'quality.minScore': { type: 'number', min: 0, max: 100 },
  'gitHook.enabled': { type: 'boolean' },
};

/**
 * 验证配置值类型和约束
 */
function validateConfigValue(key: string, value: string, schema: ConfigKeySchema): void {
  switch (schema.type) {
    case 'string':
      if (schema.enum && !schema.enum.includes(value)) {
        console.error(`错误: ${key} 仅允许: ${schema.enum.join(', ')}`);
        process.exit(1);
      }
      break;
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) {
        console.error(`错误: ${key} 需要数字值，得到 '${value}'`);
        process.exit(1);
      }
      if (schema.min !== undefined && num < schema.min) {
        console.error(`错误: ${key} 最小值为 ${schema.min}`);
        process.exit(1);
      }
      if (schema.max !== undefined && num > schema.max) {
        console.error(`错误: ${key} 最大值为 ${schema.max}`);
        process.exit(1);
      }
      break;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        console.error(`错误: ${key} 仅允许: true, false`);
        process.exit(1);
      }
      break;
  }
}

/**
 * 列出所有配置项（分类展示）
 *
 * 按类别分组展示：基础、日志、AI、提示词
 * 提示词模板标注使用默认或自定义
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

  // 基础配置
  console.log('## 基础');
  console.log(`  projectName: ${config.projectName}`);
  console.log(`  branchPrefix: ${config.branchPrefix}`);
  console.log(`  defaultPriority: ${config.defaultPriority}`);
  console.log('');

  // 日志配置
  console.log('## 日志');
  const logging = config.logging;
  if (logging) {
    console.log(`  logging.level: ${logging.level}`);
    console.log(`  logging.maxFiles: ${logging.maxFiles}`);
    console.log(`  logging.recordInputs: ${logging.recordInputs}`);
    console.log(`  logging.inputMaxLength: ${logging.inputMaxLength}`);
  } else {
    console.log('  (使用默认值)');
  }
  console.log('');

  // AI 配置
  console.log('## AI');
  const ai = config.ai;
  if (ai) {
    console.log(`  ai.provider: ${ai.provider}`);
    if (ai.customEndpoint) {
      console.log(`  ai.customEndpoint: ${ai.customEndpoint}`);
    }
  } else {
    console.log('  (使用默认值)');
  }
  console.log('');

  // 训练数据配置
  console.log('## 训练数据');
  const training = config.training;
  if (training) {
    console.log(`  training.exportEnabled: ${training.exportEnabled}`);
    console.log(`  training.outputDir: ${training.outputDir}`);
  } else {
    console.log('  (使用默认值)');
  }
  console.log('');

  // 质量配置
  console.log('## 质量');
  const quality = config.quality;
  if (quality?.minScore !== undefined) {
    console.log(`  quality.minScore: ${quality.minScore}`);
  } else {
    console.log('  (使用默认值)');
  }
  console.log('');

  // Git Hook 配置
  console.log('## Git Hook');
  const gitHook = config.gitHook;
  if (gitHook) {
    console.log(`  gitHook.enabled: ${gitHook.enabled}`);
  } else {
    console.log('  (使用默认值)');
  }
  console.log('');

  // 提示词模板
  console.log('## 提示词模板');
  const prompts = config.prompts as Record<string, string> | undefined;
  for (const name of PROMPT_TEMPLATE_NAMES) {
    const hasCustom = prompts && typeof prompts[name] === 'string';
    const label = hasCustom ? '自定义' : '默认';
    console.log(`  ${name}: [${label}]`);
  }
  console.log('');
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
 * 设置指定配置值（带 Schema 验证）
 *
 * 验证规则：
 * - 拒绝未知配置键
 * - logging.level: 仅允许 debug/info/warn/error
 * - prompts.*: 检查模板名称和变量格式
 * - 数值/布尔类型严格校验
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

  // 1. prompts.* 特殊验证（模板名称 + 变量格式）
  if (key.startsWith('prompts.')) {
    const templateName = key.substring('prompts.'.length);
    if (!PROMPT_TEMPLATE_NAMES.includes(templateName as any)) {
      console.error(`错误: 未知提示词模板名称 '${templateName}'。可选: ${PROMPT_TEMPLATE_NAMES.join(', ')}`);
      process.exit(1);
    }
    // Check template has valid {variable} placeholders
    const variables = value.match(/\{(\w+)\}/g);
    if (variables) {
      const defaultTemplate = DEFAULT_TEMPLATES[templateName as keyof typeof DEFAULT_TEMPLATES];
      if (defaultTemplate) {
        const defaultVars = new Set((defaultTemplate.match(/\{(\w+)\}/g) || []).map(v => v));
        const customVars = new Set(variables);
        const missing = [...defaultVars].filter(v => !customVars.has(v));
        if (missing.length > 0) {
          console.warn(`警告: 自定义模板缺少默认模板中的变量: ${missing.join(', ')}`);
          console.warn('缺少变量可能导致提示词中出现未替换的占位符。');
        }
      }
    }
  } else if (key in CONFIG_SCHEMA) {
    // 2. 已知配置项：按 schema 验证类型和约束
    validateConfigValue(key, value, CONFIG_SCHEMA[key]!);
  } else {
    // 3. 未知配置键：拒绝
    console.error(`错误: 未知配置项 '${key}'`);
    console.error(`可设置的配置项: ${Object.keys(CONFIG_SCHEMA).join(', ')}, prompts.*`);
    process.exit(1);
  }

  const newConfig = setConfigValue(config, key, value);
  writeConfig(newConfig, cwd);

  console.log(`✓ 已设置 ${key} = ${value}`);
}
