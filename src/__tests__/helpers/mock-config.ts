/**
 * 配置 Mock 工具
 * 用于测试中模拟项目配置
 */

import type { Projmnt4ClaudeConfig } from '../../types/config';

/**
 * 默认测试配置
 */
export const DEFAULT_TEST_CONFIG: Projmnt4ClaudeConfig = {
  version: '1.0.0',
  defaultPriority: 'P2',
  taskIdPrefix: 'TASK',
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
    temperature: 0.7,
  },
};

/**
 * 创建测试配置
 */
export function createTestConfig(overrides?: Partial<Projmnt4ClaudeConfig>): Projmnt4ClaudeConfig {
  return {
    ...DEFAULT_TEST_CONFIG,
    ...overrides,
  };
}

/**
 * 创建最小配置
 */
export function createMinimalConfig(): Projmnt4ClaudeConfig {
  return {
    version: '1.0.0',
  };
}

/**
 * 创建 AI 配置
 */
export function createAIConfig(overrides?: Partial<Projmnt4ClaudeConfig['ai']>): Projmnt4ClaudeConfig {
  return createTestConfig({
    ai: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 4000,
      temperature: 0.7,
      ...overrides,
    },
  });
}

/**
 * 配置验证器 Mock
 */
export class MockConfigValidator {
  private errors: string[] = [];

  /**
   * 验证配置
   */
  validate(config: Projmnt4ClaudeConfig): boolean {
    this.errors = [];

    if (!config.version) {
      this.errors.push('Config must have a version');
    }

    if (config.ai) {
      if (!config.ai.provider) {
        this.errors.push('AI config must have a provider');
      }
    }

    return this.errors.length === 0;
  }

  /**
   * 获取验证错误
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * 重置错误
   */
  reset(): void {
    this.errors = [];
  }
}

/**
 * 环境变量 Mock
 */
export function mockEnvironment(env: Record<string, string | undefined>): void {
  const originalEnv = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // 返回清理函数
  return () => {
    for (const key of Object.keys(env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  };
}

/**
 * 常见的测试环境配置
 */
export const TEST_ENVIRONMENTS = {
  ci: {
    CI: 'true',
    NODE_ENV: 'test',
  },
  development: {
    NODE_ENV: 'development',
    DEBUG: 'true',
  },
  production: {
    NODE_ENV: 'production',
  },
} as const;

/**
 * 临时修改环境变量
 */
export function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};

  for (const key of Object.keys(env)) {
    original[key] = process.env[key];
    process.env[key] = env[key];
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Mock 配置存储
 */
export class MockConfigStore {
  private configs = new Map<string, Projmnt4ClaudeConfig>();

  /**
   * 保存配置
   */
  save(key: string, config: Projmnt4ClaudeConfig): void {
    this.configs.set(key, { ...config });
  }

  /**
   * 加载配置
   */
  load(key: string): Projmnt4ClaudeConfig | undefined {
    return this.configs.get(key);
  }

  /**
   * 检查是否存在
   */
  has(key: string): boolean {
    return this.configs.has(key);
  }

  /**
   * 删除配置
   */
  delete(key: string): boolean {
    return this.configs.delete(key);
  }

  /**
   * 清空所有配置
   */
  clear(): void {
    this.configs.clear();
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.configs.keys());
  }
}
