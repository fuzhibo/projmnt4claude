/**
 * config.ts 单元测试
 *
 * 覆盖: ensureConfigDefaults, readConfig, writeConfig,
 *        getConfigValue, setConfigValue, listConfig, getConfig, setConfig
 *
 * 迁移说明:
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 * - 不使用 mock.module() 避免 global 污染
 * - 直接操作文件系统进行测试
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

import {
  ensureConfigDefaults,
  readConfig,
  writeConfig,
  getConfigValue,
  setConfigValue,
  listConfig,
  getConfig,
  setConfig,
} from '../commands/config.js';
import type { ProjectConfig } from '../types/config.js';
import { DEFAULT_LOGGING, DEFAULT_AI, DEFAULT_TRAINING } from '../types/config.js';

// ── 测试辅助 ──────────────────────────────────────────────
function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    projectName: 'test-project',
    createdAt: '2026-01-01',
    branchPrefix: 'feature/',
    defaultPriority: 'medium',
    ...overrides,
  };
}

/** 模拟 process.exit 使其抛出，阻止后续执行 */
function mockProcessExit() {
  const original = process.exit;
  process.exit = ((code: number) => {
    throw new Error(`process.exit:${code}`);
  }) as any;
  return () => { process.exit = original; };
}

/** 创建测试配置文件 */
function createTestConfigFile(projectDir: string, config: ProjectConfig): void {
  const configPath = path.join(projectDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** 读取测试配置文件 */
function readTestConfigFile(projectDir: string): ProjectConfig | null {
  const configPath = path.join(projectDir, 'config.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// ── ensureConfigDefaults 测试 ───────────────────────────────────
describe('ensureConfigDefaults', () => {
  test('补全缺失的 logging 配置', () => {
    const result = ensureConfigDefaults(baseConfig());
    expect(result.logging).toEqual(DEFAULT_LOGGING);
  });

  test('补全缺失的 ai 配置', () => {
    const result = ensureConfigDefaults(baseConfig());
    expect(result.ai).toEqual(DEFAULT_AI);
  });

  test('补全缺失的 training 配置', () => {
    const result = ensureConfigDefaults(baseConfig());
    expect(result.training).toEqual(DEFAULT_TRAINING);
  });

  test('保留已有的完整子配置', () => {
    const customLogging = { level: 'debug' as const, maxFiles: 10, recordInputs: false, inputMaxLength: 100 };
    const result = ensureConfigDefaults(baseConfig({ logging: customLogging }));
    expect(result.logging).toEqual(customLogging);
  });

  test('部分字段缺失时用默认值填充', () => {
    const result = ensureConfigDefaults(baseConfig({ logging: { level: 'warn' as const } } as any));
    expect(result.logging!.level).toBe('warn');
    expect(result.logging!.maxFiles).toBe(DEFAULT_LOGGING.maxFiles);
    expect(result.logging!.recordInputs).toBe(DEFAULT_LOGGING.recordInputs);
    expect(result.logging!.inputMaxLength).toBe(DEFAULT_LOGGING.inputMaxLength);
  });

  test('不修改原始配置对象', () => {
    const original = baseConfig();
    const copy = JSON.parse(JSON.stringify(original));
    ensureConfigDefaults(original);
    expect(original).toEqual(copy);
  });

  test('ai 保留 customEndpoint 和 providerOptions', () => {
    const result = ensureConfigDefaults(baseConfig({
      ai: { provider: 'openai', customEndpoint: 'http://localhost:1234', providerOptions: { model: 'gpt-4' } },
    }));
    expect(result.ai!.provider).toBe('openai');
    expect(result.ai!.customEndpoint).toBe('http://localhost:1234');
    expect(result.ai!.providerOptions).toEqual({ model: 'gpt-4' });
  });
});

// ── getConfigValue 测试 ─────────────────────────────────────────
describe('getConfigValue', () => {
  const config = baseConfig({ logging: DEFAULT_LOGGING });

  test('获取顶级键值', () => {
    expect(getConfigValue(config, 'projectName')).toBe('test-project');
  });

  test('获取嵌套键值', () => {
    expect(getConfigValue(config, 'logging.level')).toBe('info');
  });

  test('不存在的键返回 undefined', () => {
    expect(getConfigValue(config, 'nonexistent')).toBeUndefined();
  });

  test('嵌套路径中不存在返回 undefined', () => {
    expect(getConfigValue(config, 'logging.nonexistent')).toBeUndefined();
  });
});

// ── setConfigValue 测试 ─────────────────────────────────────────
describe('setConfigValue', () => {
  test('设置顶级键值', () => {
    const result = setConfigValue(baseConfig(), 'projectName', 'new-name');
    expect(result.projectName).toBe('new-name');
  });

  test('设置嵌套键值（JSON 数字）', () => {
    const result = setConfigValue(baseConfig(), 'logging.maxFiles', '50');
    expect((result as any).logging.maxFiles).toBe(50);
  });

  test('设置嵌套键值（字符串）', () => {
    const result = setConfigValue(baseConfig(), 'logging.level', 'debug');
    expect((result as any).logging.level).toBe('debug');
  });

  test('自动创建中间对象', () => {
    const result = setConfigValue(baseConfig(), 'quality.minScore', '85');
    expect((result as any).quality.minScore).toBe(85);
  });
});

// ── readConfig/writeConfig 集成测试 ──────────────────────────────
describe('readConfig/writeConfig 集成测试', () => {
  let env: IsolatedTestEnv;
  let projectDir: string;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    projectDir = env.projectDir;
    // 创建 config.json
    createTestConfigFile(projectDir, baseConfig({ logging: DEFAULT_LOGGING, ai: DEFAULT_AI }));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('readConfig 正确读取配置文件', () => {
    const config = readConfig(env.tempDir);
    expect(config).not.toBeNull();
    expect(config!.projectName).toBe('test-project');
  });

  test('readConfig 项目未初始化时返回 null', () => {
    // 删除 config.json
    const configPath = path.join(projectDir, 'config.json');
    fs.unlinkSync(configPath);
    const config = readConfig(env.tempDir);
    expect(config).toBeNull();
  });

  test('writeConfig 将配置写入文件', () => {
    const newConfig = baseConfig({ projectName: 'updated-project' });
    writeConfig(newConfig, env.tempDir);
    const readBack = readTestConfigFile(projectDir);
    expect(readBack!.projectName).toBe('updated-project');
  });

  test('readConfig JSON 解析失败时返回 null', () => {
    const configPath = path.join(projectDir, 'config.json');
    fs.writeFileSync(configPath, 'not valid json{{{', 'utf-8');
    const config = readConfig(env.tempDir);
    expect(config).toBeNull();
  });
});

// ── listConfig 测试 ─────────────────────────────────────────────
describe('listConfig', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    createTestConfigFile(env.projectDir, baseConfig({ logging: DEFAULT_LOGGING, ai: DEFAULT_AI }));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('成功输出配置信息', () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));
    listConfig(env.tempDir);
    console.log = origLog;
    const output = logs.join('\n');
    expect(output).toContain('test-project');
    expect(output).toContain('## Logging');
    expect(output).toContain('## AI');
  });
});

// ── getConfig 测试 ──────────────────────────────────────────────
describe('getConfig', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    createTestConfigFile(env.projectDir, baseConfig({ logging: DEFAULT_LOGGING }));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('获取存在的配置项并输出', () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));
    getConfig('logging.level', env.tempDir);
    console.log = origLog;
    expect(logs).toContain('info');
  });

  test('配置项不存在时调用 process.exit', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => getConfig('nonexistent.key', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });
});

// ── setConfig 测试 ──────────────────────────────────────────────
describe('setConfig', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    createTestConfigFile(env.projectDir, baseConfig({ logging: { ...DEFAULT_LOGGING } }));
  });

  afterEach(() => {
    env.cleanup();
  });

  test('设置已知配置项并写入文件', () => {
    const origLog = console.log;
    console.log = () => {};
    setConfig('logging.level', 'debug', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.logging!.level).toBe('debug');
  });

  test('未知配置键被拒绝', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('unknown.key', 'value', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('非法枚举值被拒绝 (logging.level)', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('logging.level', 'INVALID', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('设置布尔类型配置 (training.exportEnabled)', () => {
    createTestConfigFile(env.projectDir, baseConfig({ training: { ...DEFAULT_TRAINING } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('training.exportEnabled', 'true', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.training!.exportEnabled).toBe(true);
  });

  test('非法布尔值被拒绝', () => {
    createTestConfigFile(env.projectDir, baseConfig({ training: DEFAULT_TRAINING }));
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('training.exportEnabled', 'yes', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('数值超范围被拒绝 (logging.maxFiles < 1)', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('logging.maxFiles', '0', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('设置 prompts.* 自定义模板', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: {} }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.dev', 'Custom {name} do {task}', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.dev).toBe('Custom {name} do {task}');
  });

  test('未知 prompts 模板名被拒绝', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('prompts.unknown', 'value', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('设置数字类型配置 (quality.minScore)', () => {
    createTestConfigFile(env.projectDir, baseConfig({ quality: { minScore: 50 } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('quality.minScore', '85', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.quality!.minScore).toBe(85);
  });

  // ── prompts.customRequirements.* 测试 ─────────────────────────────
  test('设置 prompts.customRequirements.dev', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: {} }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.customRequirements.dev', 'Focus on performance optimization', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.customRequirements!.dev).toBe('Focus on performance optimization');
  });

  test('设置 prompts.customRequirements.codeReview', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: { customRequirements: {} } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.customRequirements.codeReview', 'Check for security issues', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.customRequirements!.codeReview).toBe('Check for security issues');
  });

  test('设置 prompts.customRequirements.qa', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: { customRequirements: {} } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.customRequirements.qa', 'Verify edge cases', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.customRequirements!.qa).toBe('Verify edge cases');
  });

  test('设置 prompts.customRequirements.evaluation', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: { customRequirements: {} } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.customRequirements.evaluation', 'Ensure backward compatibility', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.customRequirements!.evaluation).toBe('Ensure backward compatibility');
  });

  test('未知 phase 名被拒绝', () => {
    const restore = mockProcessExit();
    const origError = console.error;
    console.error = () => {};
    expect(() => setConfig('prompts.customRequirements.unknown', 'value', env.tempDir)).toThrow('process.exit:1');
    console.error = origError;
    restore();
  });

  test('清空 customRequirements (空字符串)', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: { customRequirements: { dev: 'old value' } } }));
    const origLog = console.log;
    console.log = () => {};
    setConfig('prompts.customRequirements.dev', '', env.tempDir);
    console.log = origLog;
    const written = readTestConfigFile(env.projectDir);
    expect(written!.prompts!.customRequirements!.dev).toBe('');
  });
});
