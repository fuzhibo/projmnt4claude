/**
 * pre.ts 单元测试
 *
 * 测试覆盖:
 * - json(): JSON 文件读写工具
 * - toml(): TOML 文件读写工具
 * - Pre 类: pre-commit/pre-publish hook 管理
 *
 * 测试类型:
 * - Mock 环境搭建
 * - 边界条件（空输入、异常输入）
 * - 正常流程
 * - 错误处理
 * - 集成测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { json, toml, Pre, DEFAULT_HOOKS } from '../utils/pre.js';
import type { JsonOps, TomlOps, HookType, PreCheckResult } from '../utils/pre.js';

// ============== Mock 环境工具 ==============

/** 创建临时测试目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-test-'));
}

/** 递归删除目录 */
function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 在目录中创建 git 仓库结构 */
function initGitRepo(dir: string): void {
  const gitDir = path.join(dir, '.git');
  fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });
}

/** 在目录中创建 package.json */
function createPackageJson(dir: string, overrides: Record<string, unknown> = {}): string {
  const pkgPath = path.join(dir, 'package.json');
  const pkg = {
    name: 'test-project',
    version: '1.0.0',
    scripts: { test: 'bun test' },
    ...overrides,
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
  return pkgPath;
}

/** 在目录中创建 bunfig.toml */
function createBunfigToml(dir: string): string {
  const tomlPath = path.join(dir, 'bunfig.toml');
  fs.writeFileSync(tomlPath, [
    '[test]',
    'coverage = true',
    'coverageThreshold = 0.8',
    'testTimeout = 30000',
  ].join('\n'), 'utf-8');
  return tomlPath;
}

// ============== json() 测试 ==============

describe('json()', () => {
  let tempDir: string;
  let jsonPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    jsonPath = path.join(tempDir, 'test.json');
  });

  afterEach(() => {
    rmrf(tempDir);
  });

  describe('正常流程', () => {
    it('写入和读取 JSON 数据', () => {
      const ops = json(jsonPath);
      const data = { name: 'test', version: '1.0.0' };
      ops.write(data);

      const read = ops.read();
      expect(read).toEqual(data);
    });

    it('update 增量更新数据', () => {
      const ops = json(jsonPath);
      ops.write({ name: 'test', count: 1 });

      const result = ops.update((data) => ({ ...data, count: (data as Record<string, unknown>).count as number + 1 }));
      expect((result as Record<string, unknown>).count).toBe(2);
    });

    it('exists 检测文件存在性', () => {
      const ops = json(jsonPath);
      expect(ops.exists()).toBe(false);
      ops.write({ key: 'value' });
      expect(ops.exists()).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('读取不存在的文件抛出错误', () => {
      const ops = json('/nonexistent/path/file.json');
      expect(() => ops.read()).toThrow('JSON file not found');
    });

    it('读取空文件抛出错误', () => {
      fs.writeFileSync(jsonPath, '', 'utf-8');
      const ops = json(jsonPath);
      expect(() => ops.read()).toThrow('JSON file is empty');
    });

    it('写入时自动创建目录', () => {
      const deepPath = path.join(tempDir, 'a', 'b', 'c', 'deep.json');
      const ops = json(deepPath);
      ops.write({ nested: true });
      expect(ops.exists()).toBe(true);
      expect(ops.read()).toEqual({ nested: true });
    });

    it('update 不存在的文件时使用空对象', () => {
      const ops = json(jsonPath);
      const result = ops.update(() => ({ newKey: 'newValue' }));
      expect((result as Record<string, unknown>).newKey).toBe('newValue');
    });

    it('处理复杂嵌套 JSON 结构', () => {
      const ops = json(jsonPath);
      const complex = {
        scripts: { build: 'bun build', test: 'bun test' },
        deps: { lodash: '^4.0.0' },
        nested: { deep: { value: 42 } },
      };
      ops.write(complex);
      expect(ops.read()).toEqual(complex);
    });
  });

  describe('错误处理', () => {
    it('写入无效路径时抛出错误', () => {
      const ops = json('/proc/nonwriteable/file.json');
      expect(() => ops.write({ key: 'value' })).toThrow();
    });

    it('读取非 JSON 内容时抛出错误', () => {
      fs.writeFileSync(jsonPath, 'not json {{{', 'utf-8');
      const ops = json(jsonPath);
      expect(() => ops.read()).toThrow();
    });
  });

  describe('类型安全', () => {
    it('支持泛型类型参数', () => {
      interface MyConfig { port: number; host: string }
      const ops = json<MyConfig>(jsonPath);
      ops.write({ port: 3000, host: 'localhost' });
      const data = ops.read();
      expect(data.port).toBe(3000);
      expect(data.host).toBe('localhost');
    });
  });
});

// ============== toml() 测试 ==============

describe('toml()', () => {
  let tempDir: string;
  let tomlPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    tomlPath = path.join(tempDir, 'test.toml');
  });

  afterEach(() => {
    rmrf(tempDir);
  });

  describe('正常流程', () => {
    it('写入和读取简单 TOML', () => {
      const ops = toml(tomlPath);
      const data = { title: 'test', version: 1 };
      ops.write(data);

      const read = ops.read();
      expect(read.title).toBe('test');
      expect(read.version).toBe(1);
    });

    it('写入和读取 section 格式 TOML', () => {
      const ops = toml(tomlPath);
      ops.write({
        test: {
          coverage: true,
          coverageThreshold: 0.8,
        },
      });

      const read = ops.read();
      expect(read.test).toBeDefined();
      const testSection = read.test as Record<string, unknown>;
      expect(testSection.coverage).toBe(true);
      expect(testSection.coverageThreshold).toBe(0.8);
    });

    it('get 获取指定 key', () => {
      const ops = toml(tomlPath);
      ops.write({ key1: 'value1', key2: 42 });
      expect(ops.get('key1')).toBe('value1');
      expect(ops.get('key2')).toBe(42);
    });

    it('set 设置指定 key', () => {
      const ops = toml(tomlPath);
      ops.write({ existing: 'old' });
      ops.set('existing', 'new');
      expect(ops.get('existing')).toBe('new');
    });

    it('exists 检测文件存在性', () => {
      const ops = toml(tomlPath);
      expect(ops.exists()).toBe(false);
      ops.write({ key: 'value' });
      expect(ops.exists()).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('读取不存在的文件抛出错误', () => {
      const ops = toml('/nonexistent/path/file.toml');
      expect(() => ops.read()).toThrow('TOML file not found');
    });

    it('读取空文件返回空对象', () => {
      fs.writeFileSync(tomlPath, '', 'utf-8');
      const ops = toml(tomlPath);
      expect(ops.read()).toEqual({});
    });

    it('get 不存在的文件返回 undefined', () => {
      const ops = toml('/nonexistent/file.toml');
      expect(ops.get('anything')).toBeUndefined();
    });

    it('set 不存在的文件自动创建', () => {
      const ops = toml(tomlPath);
      ops.set('newKey', 'newValue');
      expect(ops.get('newKey')).toBe('newValue');
    });

    it('写入时自动创建目录', () => {
      const deepPath = path.join(tempDir, 'a', 'b', 'deep.toml');
      const ops = toml(deepPath);
      ops.write({ key: 'value' });
      expect(ops.exists()).toBe(true);
    });
  });

  describe('解析能力', () => {
    it('解析注释行（跳过）', () => {
      const content = [
        '# This is a comment',
        'key = "value"',
        '# Another comment',
      ].join('\n');
      fs.writeFileSync(tomlPath, content, 'utf-8');
      const ops = toml(tomlPath);
      const data = ops.read();
      expect(data.key).toBe('value');
      expect(Object.keys(data).length).toBe(1);
    });

    it('解析布尔值', () => {
      fs.writeFileSync(tomlPath, 'a = true\nb = false\n', 'utf-8');
      const ops = toml(tomlPath);
      const data = ops.read();
      expect(data.a).toBe(true);
      expect(data.b).toBe(false);
    });

    it('解析整数和浮点数', () => {
      fs.writeFileSync(tomlPath, 'count = 42\nratio = 0.8\n', 'utf-8');
      const ops = toml(tomlPath);
      const data = ops.read();
      expect(data.count).toBe(42);
      expect(data.ratio).toBe(0.8);
    });

    it('解析数组值', () => {
      fs.writeFileSync(tomlPath, 'items = ["a", "b"]\n', 'utf-8');
      const ops = toml(tomlPath);
      const data = ops.read();
      expect(data.items).toEqual(['a', 'b']);
    });

    it('解析 section 下的键值对', () => {
      const content = [
        '[test]',
        'coverage = true',
        'threshold = 0.8',
        'reporters = ["text", "lcov"]',
      ].join('\n');
      fs.writeFileSync(tomlPath, content, 'utf-8');
      const ops = toml(tomlPath);
      const data = ops.read();
      const section = data.test as Record<string, unknown>;
      expect(section.coverage).toBe(true);
      expect(section.threshold).toBe(0.8);
      expect(section.reporters).toEqual(['text', 'lcov']);
    });
  });

  describe('序列化能力', () => {
    it('序列化基本类型', () => {
      const ops = toml(tomlPath);
      ops.write({ str: 'hello', num: 42, bool: true, arr: ['a', 'b'] });

      // 读取回验证
      const data = ops.read();
      expect(data.str).toBe('hello');
      expect(data.num).toBe(42);
      expect(data.bool).toBe(true);
      expect(data.arr).toEqual(['a', 'b']);
    });

    it('空值序列化为空字符串', () => {
      const ops = toml(tomlPath);
      ops.write({ nil: null as unknown as string });
      const data = ops.read();
      expect(data.nil).toBe('');
    });
  });
});

// ============== Pre 类测试 ==============

describe('Pre', () => {
  let tempDir: string;
  let pre: Pre;

  beforeEach(() => {
    tempDir = createTempDir();
    initGitRepo(tempDir);
    createPackageJson(tempDir);
    createBunfigToml(tempDir);
    pre = new Pre(tempDir);
  });

  afterEach(() => {
    rmrf(tempDir);
  });

  describe('构造函数', () => {
    it('使用项目根目录初始化', () => {
      expect(pre.projectRoot).toBe(tempDir);
      expect(pre.gitDir).toBe(path.join(tempDir, '.git'));
      expect(pre.packageJsonPath).toBe(path.join(tempDir, 'package.json'));
    });

    it('默认使用 process.cwd()', () => {
      const defaultPre = new Pre();
      expect(defaultPre.projectRoot).toBe(process.cwd());
    });

    it('解析相对路径为绝对路径', () => {
      const relative = new Pre('./');
      expect(path.isAbsolute(relative.projectRoot)).toBe(true);
    });
  });

  describe('DEFAULT_HOOKS 常量', () => {
    it('包含 pre-commit 和 pre-publish 配置', () => {
      expect(DEFAULT_HOOKS['pre-commit']).toBeDefined();
      expect(DEFAULT_HOOKS['pre-publish']).toBeDefined();
    });

    it('每个 hook 都有 type, command, description', () => {
      for (const hook of Object.values(DEFAULT_HOOKS)) {
        expect(hook.type).toBeDefined();
        expect(hook.command).toBeDefined();
        expect(hook.description).toBeDefined();
      }
    });

    it('pre-commit 使用 bun test', () => {
      expect(DEFAULT_HOOKS['pre-commit'].command).toContain('bun test');
    });

    it('pre-publish 使用 bun test --coverage', () => {
      expect(DEFAULT_HOOKS['pre-publish'].command).toContain('--coverage');
    });
  });

  describe('installPreCommit', () => {
    it('创建 pre-commit hook 文件', () => {
      const hookPath = pre.installPreCommit();
      expect(fs.existsSync(hookPath)).toBe(true);
    });

    it('hook 文件包含 bun test 命令', () => {
      const hookPath = pre.installPreCommit();
      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toContain('bun test');
    });

    it('hook 文件包含自动生成标记', () => {
      const hookPath = pre.installPreCommit();
      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toContain('auto-generated by projmnt4claude');
    });

    it('hook 文件是可执行的', () => {
      const hookPath = pre.installPreCommit();
      const stat = fs.statSync(hookPath);
      // 检查可执行位 (0o755)
      expect(stat.mode & 0o111).toBeTruthy();
    });

    it('重复安装不报错（覆盖）', () => {
      pre.installPreCommit();
      expect(() => pre.installPreCommit()).not.toThrow();
    });
  });

  describe('installPrePublish', () => {
    it('在 package.json 中添加 prepublishOnly 脚本', () => {
      pre.installPrePublish();
      const pkg = json<Record<string, unknown>>(path.join(tempDir, 'package.json'));
      const data = pkg.read();
      const scripts = data.scripts as Record<string, string>;
      expect(scripts.prepublishOnly).toBeDefined();
      expect(scripts.prepublishOnly).toContain('--coverage');
    });

    it('保留已有的 scripts', () => {
      pre.installPrePublish();
      const pkg = json<Record<string, unknown>>(path.join(tempDir, 'package.json'));
      const data = pkg.read();
      const scripts = data.scripts as Record<string, string>;
      expect(scripts.test).toBe('bun test'); // 原有 script 保留
    });
  });

  describe('installAll', () => {
    it('同时安装 pre-commit 和 pre-publish', () => {
      pre.installAll();
      expect(pre.isPreCommitInstalled()).toBe(true);
      expect(pre.isPrePublishInstalled()).toBe(true);
    });
  });

  describe('removePreCommit', () => {
    it('移除已安装的 pre-commit hook', () => {
      pre.installPreCommit();
      expect(pre.removePreCommit()).toBe(true);
      expect(pre.isPreCommitInstalled()).toBe(false);
    });

    it('未安装时返回 false', () => {
      expect(pre.removePreCommit()).toBe(false);
    });

    it('不删除非自动生成的 hook', () => {
      const hookPath = path.join(tempDir, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho custom hook\n', 'utf-8');
      expect(pre.removePreCommit()).toBe(false);
      expect(fs.existsSync(hookPath)).toBe(true);
    });
  });

  describe('removePrePublish', () => {
    it('移除 prepublishOnly 脚本', () => {
      pre.installPrePublish();
      expect(pre.removePrePublish()).toBe(true);
      expect(pre.isPrePublishInstalled()).toBe(false);
    });

    it('未安装时返回 false', () => {
      expect(pre.removePrePublish()).toBe(false);
    });
  });

  describe('removeAll', () => {
    it('同时移除所有 hooks', () => {
      pre.installAll();
      pre.removeAll();
      expect(pre.isPreCommitInstalled()).toBe(false);
      expect(pre.isPrePublishInstalled()).toBe(false);
    });
  });

  describe('isPreCommitInstalled', () => {
    it('未安装时返回 false', () => {
      expect(pre.isPreCommitInstalled()).toBe(false);
    });

    it('安装后返回 true', () => {
      pre.installPreCommit();
      expect(pre.isPreCommitInstalled()).toBe(true);
    });

    it('hooks 目录不存在时返回 false', () => {
      const noGitDir = createTempDir();
      const noGitPre = new Pre(noGitDir);
      expect(noGitPre.isPreCommitInstalled()).toBe(false);
      rmrf(noGitDir);
    });
  });

  describe('isPrePublishInstalled', () => {
    it('未安装时返回 false', () => {
      expect(pre.isPrePublishInstalled()).toBe(false);
    });

    it('安装后返回 true', () => {
      pre.installPrePublish();
      expect(pre.isPrePublishInstalled()).toBe(true);
    });

    it('package.json 不存在时返回 false', () => {
      const emptyDir = createTempDir();
      const emptyPre = new Pre(emptyDir);
      expect(emptyPre.isPrePublishInstalled()).toBe(false);
      rmrf(emptyDir);
    });
  });

  describe('runTests', () => {
    it('返回 PreCheckResult 结构', () => {
      // 使用临时目录（没有测试文件会失败但应返回结构化结果）
      const emptyDir = createTempDir();
      initGitRepo(emptyDir);
      createPackageJson(emptyDir);
      const emptyPre = new Pre(emptyDir);

      const result = emptyPre.runTests();
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('duration');
      expect(typeof result.duration).toBe('number');

      rmrf(emptyDir);
    });

    it('duration 是非负数', () => {
      const emptyDir = createTempDir();
      const emptyPre = new Pre(emptyDir);
      const result = emptyPre.runTests();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      rmrf(emptyDir);
    });
  });

  describe('runCoverageCheck', () => {
    it('返回 PreCheckResult 结构', () => {
      const emptyDir = createTempDir();
      initGitRepo(emptyDir);
      createPackageJson(emptyDir);
      const emptyPre = new Pre(emptyDir);

      const result = emptyPre.runCoverageCheck();
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('duration');

      rmrf(emptyDir);
    });

    it('自定义阈值参数', () => {
      const emptyDir = createTempDir();
      const emptyPre = new Pre(emptyDir);
      // 使用高阈值，即使没有测试也不会 panic
      const result = emptyPre.runCoverageCheck(0.99);
      expect(typeof result.passed).toBe('boolean');
      rmrf(emptyDir);
    });
  });
});

// ============== 集成测试 ==============

describe('集成测试: 完整发布流程', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    initGitRepo(tempDir);
    createPackageJson(tempDir);
    createBunfigToml(tempDir);
  });

  afterEach(() => {
    rmrf(tempDir);
  });

  it('完整安装→验证→卸载流程', () => {
    const pre = new Pre(tempDir);

    // 初始状态: 未安装
    expect(pre.isPreCommitInstalled()).toBe(false);
    expect(pre.isPrePublishInstalled()).toBe(false);

    // 安装
    pre.installAll();
    expect(pre.isPreCommitInstalled()).toBe(true);
    expect(pre.isPrePublishInstalled()).toBe(true);

    // 卸载
    pre.removeAll();
    expect(pre.isPreCommitInstalled()).toBe(false);
    expect(pre.isPrePublishInstalled()).toBe(false);
  });

  it('json + toml 配置文件协同工作', () => {
    const pkgOps = json<Record<string, unknown>>(path.join(tempDir, 'package.json'));
    const tomlOps = toml(path.join(tempDir, 'bunfig.toml'));

    // 读取 package.json 验证配置
    const pkg = pkgOps.read();
    expect(pkg.name).toBe('test-project');

    // 读取 bunfig.toml 验证配置
    const config = tomlOps.read();
    const testSection = config.test as Record<string, unknown>;
    expect(testSection.coverage).toBe(true);
    expect(testSection.coverageThreshold).toBe(0.8);

    // 更新 package.json
    pkgOps.update((data) => ({
      ...data,
      scripts: { ...(data.scripts as Record<string, string>), build: 'bun build' },
    }));

    const updated = pkgOps.read();
    const scripts = updated.scripts as Record<string, string>;
    expect(scripts.build).toBe('bun build');
    expect(scripts.test).toBe('bun test');
  });

  it('重复安装幂等性', () => {
    const pre = new Pre(tempDir);
    pre.installAll();
    pre.installAll(); // 再次安装

    expect(pre.isPreCommitInstalled()).toBe(true);
    expect(pre.isPrePublishInstalled()).toBe(true);
  });
});

// ============== 性能测试 ==============

describe('性能测试', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmrf(tempDir);
  });

  it('json 大数据量写入/读取性能', () => {
    const jsonPath = path.join(tempDir, 'large.json');
    const ops = json<Record<string, unknown>>(jsonPath);

    // 生成大数据
    const largeData: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      largeData[`key_${i}`] = { value: i, data: `item_${i}` };
    }

    const startWrite = Date.now();
    ops.write(largeData);
    const writeTime = Date.now() - startWrite;

    const startRead = Date.now();
    const read = ops.read();
    const readTime = Date.now() - startRead;

    // 验证数据完整性
    expect(Object.keys(read).length).toBe(1000);
    // 性能断言：写入和读取应在 1 秒内完成
    expect(writeTime).toBeLessThan(1000);
    expect(readTime).toBeLessThan(1000);
  });

  it('toml 大数据量写入/读取性能', () => {
    const tomlPath = path.join(tempDir, 'large.toml');
    const ops = toml(tomlPath);

    const largeData: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      largeData[`key_${i}`] = i;
    }

    const startWrite = Date.now();
    ops.write(largeData);
    const writeTime = Date.now() - startWrite;

    const startRead = Date.now();
    const data = ops.read();
    const readTime = Date.now() - startRead;

    expect(Object.keys(data).length).toBe(100);
    expect(writeTime).toBeLessThan(1000);
    expect(readTime).toBeLessThan(1000);
  });

  it('Pre 安装/卸载批量操作性能', () => {
    initGitRepo(tempDir);
    createPackageJson(tempDir);
    const pre = new Pre(tempDir);

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      pre.installAll();
      pre.removeAll();
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
