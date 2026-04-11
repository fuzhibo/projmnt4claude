/**
 * 发布流程工具模块
 *
 * 提供 JSON/TOML 文件读写工具和 Pre 类来管理 pre-commit/pre-publish 钩子。
 * 用于建立测试自动化保障机制，确保插件发布质量。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============== JSON 工具函数 ==============

/** JSON 文件操作返回结构 */
export interface JsonOps<T = Record<string, unknown>> {
  read: () => T;
  write: (data: T) => void;
  update: (updater: (data: T) => T) => T;
  exists: () => boolean;
}

/**
 * 创建 JSON 文件操作器
 * @param filePath JSON 文件路径
 * @returns JSON 读写操作对象
 */
export function json<T = Record<string, unknown>>(filePath: string): JsonOps<T> {
  const resolved = path.resolve(filePath);

  return {
    exists(): boolean {
      return fs.existsSync(resolved);
    },

    read(): T {
      if (!fs.existsSync(resolved)) {
        throw new Error(`JSON file not found: ${resolved}`);
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      if (!content.trim()) {
        throw new Error(`JSON file is empty: ${resolved}`);
      }
      return JSON.parse(content) as T;
    },

    write(data: T): void {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    },

    update(updater: (data: T) => T): T {
      const current = fs.existsSync(resolved)
        ? JSON.parse(fs.readFileSync(resolved, 'utf-8') || '{}') as T
        : ({} as T);
      const updated = updater(current);
      fs.writeFileSync(resolved, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
      return updated;
    },
  };
}

// ============== TOML 工具函数 ==============

/** TOML 文件操作返回结构 */
export interface TomlOps {
  read: () => Record<string, unknown>;
  write: (data: Record<string, unknown>) => void;
  exists: () => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

/**
 * 简易 TOML 解析器 — 支持简单的键值对和单级 section
 * 仅覆盖 bunfig.toml 所需格式
 */
function parseToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue;

    // Section header: [test]
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1]!;
      currentSection = section;
      if (!result[section]) {
        result[section] = {};
      }
      continue;
    }

    // Key-value pair: key = value
    const kvMatch = line.match(/^([\w.]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      let value: unknown = kvMatch[2]!.trim();

      // 解析值类型
      if (typeof value === 'string') {
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
        else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
        else if ((value as string).startsWith('"') && (value as string).endsWith('"'))
          value = (value as string).slice(1, -1);
        else if ((value as string).startsWith('[')) {
          // 简易数组解析: ["a", "b"]
          try {
            value = JSON.parse(value as string);
          } catch {
            // 保持字符串
          }
        }
      }

      if (currentSection) {
        (result[currentSection] as Record<string, unknown>)[key] = value;
      } else if (!currentSection) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * 将对象序列化为简单 TOML 字符串
 */
function serializeToml(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const topLevel: string[] = [];
  const sections: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sections.push('');
      sections.push(`[${key}]`);
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        sections.push(`${subKey} = ${formatTomlValue(subValue)}`);
      }
    } else {
      topLevel.push(`${key} = ${formatTomlValue(value)}`);
    }
  }

  return [...topLevel, ...sections].join('\n') + '\n';
}

function formatTomlValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === undefined) return '""';
  return String(value);
}

/**
 * 创建 TOML 文件操作器
 * @param filePath TOML 文件路径
 * @returns TOML 读写操作对象
 */
export function toml(filePath: string): TomlOps {
  const resolved = path.resolve(filePath);

  return {
    exists(): boolean {
      return fs.existsSync(resolved);
    },

    read(): Record<string, unknown> {
      if (!fs.existsSync(resolved)) {
        throw new Error(`TOML file not found: ${resolved}`);
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      if (!content.trim()) {
        return {};
      }
      return parseToml(content);
    },

    write(data: Record<string, unknown>): void {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, serializeToml(data), 'utf-8');
    },

    get(key: string): unknown {
      const data = fs.existsSync(resolved)
        ? parseToml(fs.readFileSync(resolved, 'utf-8'))
        : {};
      return data[key];
    },

    set(key: string, value: unknown): void {
      const data = fs.existsSync(resolved)
        ? parseToml(fs.readFileSync(resolved, 'utf-8'))
        : {};
      data[key] = value;
      fs.writeFileSync(resolved, serializeToml(data), 'utf-8');
    },
  };
}

// ============== Pre 类 ==============

/** Hook 类型 */
export type HookType = 'pre-commit' | 'pre-publish';

/** Hook 配置 */
export interface HookConfig {
  type: HookType;
  command: string;
  description: string;
}

/** Pre-check 结果 */
export interface PreCheckResult {
  passed: boolean;
  output: string;
  duration: number;
}

/** 默认 hook 配置 */
export const DEFAULT_HOOKS: Record<HookType, HookConfig> = {
  'pre-commit': {
    type: 'pre-commit',
    command: 'bun test',
    description: 'Run tests before commit',
  },
  'pre-publish': {
    type: 'pre-publish',
    command: 'bun test --coverage',
    description: 'Run tests with coverage before publish',
  },
};

/**
 * Pre 类 — 管理 pre-commit 和 pre-publish 钩子
 *
 * 职责:
 * - 安装/移除 git pre-commit hook
 * - 管理 package.json 中的 prepublishOnly 脚本
 * - 执行测试和覆盖率检查
 */
export class Pre {
  readonly projectRoot: string;
  readonly gitDir: string;
  readonly packageJsonPath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.gitDir = path.join(this.projectRoot, '.git');
    this.packageJsonPath = path.join(this.projectRoot, 'package.json');
  }

  // ---- Hook 安装 ----

  /** 安装 git pre-commit hook */
  installPreCommit(): string {
    const hookPath = this.getHookPath('pre-commit');
    const command = DEFAULT_HOOKS['pre-commit'].command;

    this.ensureHooksDir();
    fs.writeFileSync(hookPath, `#!/bin/sh\n# pre-commit hook — auto-generated by projmnt4claude\n${command}\n`, 'utf-8');
    fs.chmodSync(hookPath, 0o755);
    return hookPath;
  }

  /** 安装 pre-publish hook（写入 package.json prepublishOnly 脚本） */
  installPrePublish(): void {
    const pkg = json<Record<string, unknown>>(this.packageJsonPath);
    const scripts = (pkg.read().scripts || {}) as Record<string, string>;
    scripts.prepublishOnly = DEFAULT_HOOKS['pre-publish'].command;

    pkg.update((data) => ({
      ...data,
      scripts,
    }));
  }

  /** 安装所有 hooks */
  installAll(): void {
    this.installPreCommit();
    this.installPrePublish();
  }

  // ---- Hook 移除 ----

  /** 移除 git pre-commit hook */
  removePreCommit(): boolean {
    const hookPath = this.getHookPath('pre-commit');
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, 'utf-8');
      if (content.includes('auto-generated by projmnt4claude')) {
        fs.unlinkSync(hookPath);
        return true;
      }
    }
    return false;
  }

  /** 移除 pre-publish hook */
  removePrePublish(): boolean {
    const pkg = json<Record<string, unknown>>(this.packageJsonPath);
    if (!pkg.exists()) return false;

    const data = pkg.read();
    const scripts = (data.scripts || {}) as Record<string, string>;
    if (scripts.prepublishOnly) {
      delete scripts.prepublishOnly;
      pkg.write({ ...data, scripts });
      return true;
    }
    return false;
  }

  /** 移除所有 hooks */
  removeAll(): void {
    this.removePreCommit();
    this.removePrePublish();
  }

  // ---- 状态检查 ----

  /** 检查 pre-commit hook 是否已安装 */
  isPreCommitInstalled(): boolean {
    const hookPath = this.getHookPath('pre-commit');
    if (!fs.existsSync(hookPath)) return false;
    const content = fs.readFileSync(hookPath, 'utf-8');
    return content.includes('bun test');
  }

  /** 检查 pre-publish hook 是否已安装 */
  isPrePublishInstalled(): boolean {
    const pkg = json<Record<string, unknown>>(this.packageJsonPath);
    if (!pkg.exists()) return false;
    const data = pkg.read();
    const scripts = (data.scripts || {}) as Record<string, string>;
    return !!scripts.prepublishOnly;
  }

  // ---- 测试执行 ----

  /** 运行测试 */
  runTests(): PreCheckResult {
    const start = Date.now();
    try {
      const output = execSync('bun test 2>&1', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 120_000,
      });
      return { passed: true, output, duration: Date.now() - start };
    } catch (err: unknown) {
      const error = err as { stdout?: string; message?: string };
      return {
        passed: false,
        output: error.stdout || error.message || 'Test execution failed',
        duration: Date.now() - start,
      };
    }
  }

  /** 运行覆盖率检查 */
  runCoverageCheck(threshold: number = 0.8): PreCheckResult {
    const start = Date.now();
    try {
      const output = execSync(`bun test --coverage 2>&1`, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 120_000,
      });

      // 从输出中提取覆盖率百分比
      const coverageMatch = output.match(/(\d+(?:\.\d+)?)\s*%/);
      const coveragePercent = coverageMatch ? parseFloat(coverageMatch[1]!) : 0;
      const passed = coveragePercent / 100 >= threshold;

      return {
        passed,
        output: `${output}\nCoverage: ${coveragePercent}% (threshold: ${threshold * 100}%)`,
        duration: Date.now() - start,
      };
    } catch (err: unknown) {
      const error = err as { stdout?: string; message?: string };
      return {
        passed: false,
        output: error.stdout || error.message || 'Coverage check failed',
        duration: Date.now() - start,
      };
    }
  }

  // ---- 内部工具 ----

  /** 获取 git hook 文件路径 */
  private getHookPath(type: 'pre-commit' | 'pre-push' | 'prepare-commit-msg'): string {
    return path.join(this.gitDir, 'hooks', type);
  }

  /** 确保 hooks 目录存在 */
  private ensureHooksDir(): void {
    const hooksDir = path.join(this.gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
  }
}
