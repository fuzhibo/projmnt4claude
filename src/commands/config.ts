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
 * Ensure config file contains all default configuration items
 * Missing items are auto-populated with defaults
 */
export function ensureConfigDefaults(config: ProjectConfig): ProjectConfig {
  const result = { ...config };

  // logging config completeness
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

  // ai config completeness
  if (!result.ai) {
    result.ai = { ...DEFAULT_AI };
  } else {
    result.ai = {
      provider: result.ai.provider ?? DEFAULT_AI.provider,
      ...(result.ai.customEndpoint !== undefined ? { customEndpoint: result.ai.customEndpoint } : {}),
      ...(result.ai.providerOptions !== undefined ? { providerOptions: result.ai.providerOptions } : {}),
    };
  }

  // training config completeness
  if (!result.training) {
    result.training = { ...DEFAULT_TRAINING };
  } else {
    result.training = {
      exportEnabled: result.training.exportEnabled ?? DEFAULT_TRAINING.exportEnabled,
      outputDir: result.training.outputDir ?? DEFAULT_TRAINING.outputDir,
    };
  }

  // gitHook config completeness
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
 * Read configuration file
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
 * Write configuration file
 */
export function writeConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const configPath = getConfigPath(cwd);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get nested key value
 * Supports dot notation, e.g. "branchPrefix" or "nested.key"
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
 * Set nested key value
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

  // Try to parse JSON value, fallback to string
  try {
    current[keys[keys.length - 1]!] = JSON.parse(value);
  } catch {
    current[keys[keys.length - 1]!] = value;
  }

  return result;
}

// ============================================================
// Config Schema Validation (IR-05-05)
// ============================================================

/** Config key validation rules */
interface ConfigKeySchema {
  type: 'string' | 'number' | 'boolean';
  enum?: string[];
  min?: number;
  max?: number;
}

/** Known config keys and their validation rules */
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
 * Validate config value type and constraints
 */
function validateConfigValue(key: string, value: string, schema: ConfigKeySchema): void {
  switch (schema.type) {
    case 'string':
      if (schema.enum && !schema.enum.includes(value)) {
        console.error(`Error: ${key} only allows: ${schema.enum.join(', ')}`);
        process.exit(1);
      }
      break;
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) {
        console.error(`Error: ${key} requires a number, got '${value}'`);
        process.exit(1);
      }
      if (schema.min !== undefined && num < schema.min) {
        console.error(`Error: ${key} minimum value is ${schema.min}`);
        process.exit(1);
      }
      if (schema.max !== undefined && num > schema.max) {
        console.error(`Error: ${key} maximum value is ${schema.max}`);
        process.exit(1);
      }
      break;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        console.error(`Error: ${key} only allows: true, false`);
        process.exit(1);
      }
      break;
  }
}

/**
 * List all config items (grouped by category)
 *
 * Groups by category: basic, logging, AI, prompts
 * Prompt templates show whether using default or custom
 */
export function listConfig(cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('Error: Cannot read configuration file');
    process.exit(1);
  }

  // Basic config
  console.log('## Basic');
  console.log(`  projectName: ${config.projectName}`);
  console.log(`  branchPrefix: ${config.branchPrefix}`);
  console.log(`  defaultPriority: ${config.defaultPriority}`);
  console.log('');

  // Logging config
  console.log('## Logging');
  const logging = config.logging;
  if (logging) {
    console.log(`  logging.level: ${logging.level}`);
    console.log(`  logging.maxFiles: ${logging.maxFiles}`);
    console.log(`  logging.recordInputs: ${logging.recordInputs}`);
    console.log(`  logging.inputMaxLength: ${logging.inputMaxLength}`);
  } else {
    console.log('  (using defaults)');
  }
  console.log('');

  // AI config
  console.log('## AI');
  const ai = config.ai;
  if (ai) {
    console.log(`  ai.provider: ${ai.provider}`);
    if (ai.customEndpoint) {
      console.log(`  ai.customEndpoint: ${ai.customEndpoint}`);
    }
  } else {
    console.log('  (using defaults)');
  }
  console.log('');

  // Training data config
  console.log('## Training');
  const training = config.training;
  if (training) {
    console.log(`  training.exportEnabled: ${training.exportEnabled}`);
    console.log(`  training.outputDir: ${training.outputDir}`);
  } else {
    console.log('  (using defaults)');
  }
  console.log('');

  // Quality config
  console.log('## Quality');
  const quality = config.quality;
  if (quality?.minScore !== undefined) {
    console.log(`  quality.minScore: ${quality.minScore}`);
  } else {
    console.log('  (using defaults)');
  }
  console.log('');

  // Git Hook config
  console.log('## Git Hook');
  const gitHook = config.gitHook;
  if (gitHook) {
    console.log(`  gitHook.enabled: ${gitHook.enabled}`);
  } else {
    console.log('  (using defaults)');
  }
  console.log('');

  // Prompt templates
  console.log('## Prompt Templates');
  const prompts = config.prompts as Record<string, string> | undefined;
  for (const name of PROMPT_TEMPLATE_NAMES) {
    const hasCustom = prompts && typeof prompts[name] === 'string';
    const label = hasCustom ? 'custom' : 'default';
    console.log(`  ${name}: [${label}]`);
  }
  console.log('');
}

/**
 * Get a specific config value
 */
export function getConfig(key: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('Error: Cannot read configuration file');
    process.exit(1);
  }

  const value = getConfigValue(config, key);
  if (value === undefined) {
    console.error(`Error: Config key '${key}' does not exist`);
    process.exit(1);
  }

  console.log(value);
}

/**
 * Set a specific config value (with schema validation)
 *
 * Validation rules:
 * - Reject unknown config keys
 * - logging.level: only allows debug/info/warn/error
 * - prompts.*: check template name and variable format
 * - strict validation for number/boolean types
 */
export function setConfig(key: string, value: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const config = readConfig(cwd);
  if (!config) {
    console.error('Error: Cannot read configuration file');
    process.exit(1);
  }

  // 1. prompts.* special validation (template name + variable format)
  if (key.startsWith('prompts.')) {
    const templateName = key.substring('prompts.'.length);
    if (!PROMPT_TEMPLATE_NAMES.includes(templateName as any)) {
      console.error(`Error: Unknown prompt template name '${templateName}'. Options: ${PROMPT_TEMPLATE_NAMES.join(', ')}`);
      process.exit(1);
    }
    // Check template has valid {variable} placeholders
    const variables = value.match(/\{(\w+)\}/g);
    if (variables) {
      const defaultTemplate = DEFAULT_TEMPLATES[templateName as keyof typeof DEFAULT_TEMPLATES];
      if (defaultTemplate) {
        // Check variables against both language versions
        const zhVars = new Set((defaultTemplate.zh.match(/\{(\w+)\}/g) || []).map(v => v));
        const enVars = new Set((defaultTemplate.en.match(/\{(\w+)\}/g) || []).map(v => v));
        const customVars = new Set(variables);
        // Check missing in zh (typically has more variables due to Chinese text)
        const missingZh = [...zhVars].filter(v => !customVars.has(v));
        if (missingZh.length > 0) {
          console.warn(`Warning: Custom template missing variables from default: ${missingZh.join(', ')}`);
          console.warn('Missing variables may cause unsubstituted placeholders in prompts.');
        }
      }
    }
  } else if (key in CONFIG_SCHEMA) {
    // 2. Known config keys: validate type and constraints by schema
    validateConfigValue(key, value, CONFIG_SCHEMA[key]!);
  } else {
    // 3. Unknown config keys: reject
    console.error(`Error: Unknown config key '${key}'`);
    console.error(`Available keys: ${Object.keys(CONFIG_SCHEMA).join(', ')}, prompts.*`);
    process.exit(1);
  }

  const newConfig = setConfigValue(config, key, value);
  writeConfig(newConfig, cwd);

  console.log(`✓ Set ${key} = ${value}`);
}
