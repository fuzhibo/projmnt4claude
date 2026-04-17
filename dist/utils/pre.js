/**
 * 发布流程工具模块
 *
 * 提供 JSON/TOML 文件读写工具和 Pre 类来管理 pre-commit/pre-publish 钩子。
 * 用于建立测试自动化保障机制，确保插件发布质量。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
/**
 * 创建 JSON 文件操作器
 * @param filePath JSON 文件路径
 * @returns JSON 读写操作对象
 */
export function json(filePath) {
    const resolved = path.resolve(filePath);
    return {
        exists() {
            return fs.existsSync(resolved);
        },
        read() {
            if (!fs.existsSync(resolved)) {
                throw new Error(`JSON file not found: ${resolved}`);
            }
            const content = fs.readFileSync(resolved, 'utf-8');
            if (!content.trim()) {
                throw new Error(`JSON file is empty: ${resolved}`);
            }
            return JSON.parse(content);
        },
        write(data) {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(resolved, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        },
        update(updater) {
            const current = fs.existsSync(resolved)
                ? JSON.parse(fs.readFileSync(resolved, 'utf-8') || '{}')
                : {};
            const updated = updater(current);
            fs.writeFileSync(resolved, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
            return updated;
        },
    };
}
/**
 * 简易 TOML 解析器 — 支持简单的键值对和单级 section
 * 仅覆盖 bunfig.toml 所需格式
 */
function parseToml(content) {
    const result = {};
    let currentSection = null;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        // 跳过空行和注释
        if (!line || line.startsWith('#'))
            continue;
        // Section header: [test]
        const sectionMatch = line.match(/^\[(\w+)\]$/);
        if (sectionMatch) {
            const section = sectionMatch[1];
            currentSection = section;
            if (!result[section]) {
                result[section] = {};
            }
            continue;
        }
        // Key-value pair: key = value
        const kvMatch = line.match(/^([\w.]+)\s*=\s*(.+)$/);
        if (kvMatch) {
            const key = kvMatch[1];
            let value = kvMatch[2].trim();
            // 解析值类型
            if (typeof value === 'string') {
                if (value === 'true')
                    value = true;
                else if (value === 'false')
                    value = false;
                else if (/^\d+$/.test(value))
                    value = parseInt(value, 10);
                else if (/^\d+\.\d+$/.test(value))
                    value = parseFloat(value);
                else if (value.startsWith('"') && value.endsWith('"'))
                    value = value.slice(1, -1);
                else if (value.startsWith('[')) {
                    // 简易数组解析: ["a", "b"]
                    try {
                        value = JSON.parse(value);
                    }
                    catch {
                        // 保持字符串
                    }
                }
            }
            if (currentSection) {
                result[currentSection][key] = value;
            }
            else if (!currentSection) {
                result[key] = value;
            }
        }
    }
    return result;
}
/**
 * 将对象序列化为简单 TOML 字符串
 */
function serializeToml(data) {
    const lines = [];
    const topLevel = [];
    const sections = [];
    for (const [key, value] of Object.entries(data)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            sections.push('');
            sections.push(`[${key}]`);
            for (const [subKey, subValue] of Object.entries(value)) {
                sections.push(`${subKey} = ${formatTomlValue(subValue)}`);
            }
        }
        else {
            topLevel.push(`${key} = ${formatTomlValue(value)}`);
        }
    }
    return [...topLevel, ...sections].join('\n') + '\n';
}
function formatTomlValue(value) {
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'string')
        return `"${value}"`;
    if (Array.isArray(value))
        return JSON.stringify(value);
    if (value === null || value === undefined)
        return '""';
    return String(value);
}
/**
 * 创建 TOML 文件操作器
 * @param filePath TOML 文件路径
 * @returns TOML 读写操作对象
 */
export function toml(filePath) {
    const resolved = path.resolve(filePath);
    return {
        exists() {
            return fs.existsSync(resolved);
        },
        read() {
            if (!fs.existsSync(resolved)) {
                throw new Error(`TOML file not found: ${resolved}`);
            }
            const content = fs.readFileSync(resolved, 'utf-8');
            if (!content.trim()) {
                return {};
            }
            return parseToml(content);
        },
        write(data) {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(resolved, serializeToml(data), 'utf-8');
        },
        get(key) {
            const data = fs.existsSync(resolved)
                ? parseToml(fs.readFileSync(resolved, 'utf-8'))
                : {};
            return data[key];
        },
        set(key, value) {
            const data = fs.existsSync(resolved)
                ? parseToml(fs.readFileSync(resolved, 'utf-8'))
                : {};
            data[key] = value;
            fs.writeFileSync(resolved, serializeToml(data), 'utf-8');
        },
    };
}
/** 默认 hook 配置 */
export const DEFAULT_HOOKS = {
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
    projectRoot;
    gitDir;
    packageJsonPath;
    constructor(projectRoot = process.cwd()) {
        this.projectRoot = path.resolve(projectRoot);
        this.gitDir = path.join(this.projectRoot, '.git');
        this.packageJsonPath = path.join(this.projectRoot, 'package.json');
    }
    // ---- Hook 安装 ----
    /** 安装 git pre-commit hook */
    installPreCommit() {
        const hookPath = this.getHookPath('pre-commit');
        const command = DEFAULT_HOOKS['pre-commit'].command;
        this.ensureHooksDir();
        fs.writeFileSync(hookPath, `#!/bin/sh\n# pre-commit hook — auto-generated by projmnt4claude\n${command}\n`, 'utf-8');
        fs.chmodSync(hookPath, 0o755);
        return hookPath;
    }
    /** 安装 pre-publish hook（写入 package.json prepublishOnly 脚本） */
    installPrePublish() {
        const pkg = json(this.packageJsonPath);
        const scripts = (pkg.read().scripts || {});
        scripts.prepublishOnly = DEFAULT_HOOKS['pre-publish'].command;
        pkg.update((data) => ({
            ...data,
            scripts,
        }));
    }
    /** 安装所有 hooks */
    installAll() {
        this.installPreCommit();
        this.installPrePublish();
    }
    // ---- Hook 移除 ----
    /** 移除 git pre-commit hook */
    removePreCommit() {
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
    removePrePublish() {
        const pkg = json(this.packageJsonPath);
        if (!pkg.exists())
            return false;
        const data = pkg.read();
        const scripts = (data.scripts || {});
        if (scripts.prepublishOnly) {
            delete scripts.prepublishOnly;
            pkg.write({ ...data, scripts });
            return true;
        }
        return false;
    }
    /** 移除所有 hooks */
    removeAll() {
        this.removePreCommit();
        this.removePrePublish();
    }
    // ---- 状态检查 ----
    /** 检查 pre-commit hook 是否已安装 */
    isPreCommitInstalled() {
        const hookPath = this.getHookPath('pre-commit');
        if (!fs.existsSync(hookPath))
            return false;
        const content = fs.readFileSync(hookPath, 'utf-8');
        return content.includes('bun test');
    }
    /** 检查 pre-publish hook 是否已安装 */
    isPrePublishInstalled() {
        const pkg = json(this.packageJsonPath);
        if (!pkg.exists())
            return false;
        const data = pkg.read();
        const scripts = (data.scripts || {});
        return !!scripts.prepublishOnly;
    }
    // ---- 测试执行 ----
    /** 运行测试 */
    runTests() {
        const start = Date.now();
        try {
            const output = execSync('bun test 2>&1', {
                cwd: this.projectRoot,
                encoding: 'utf-8',
                timeout: 120_000,
            });
            return { passed: true, output, duration: Date.now() - start };
        }
        catch (err) {
            const error = err;
            return {
                passed: false,
                output: error.stdout || error.message || 'Test execution failed',
                duration: Date.now() - start,
            };
        }
    }
    /** 运行覆盖率检查 */
    runCoverageCheck(threshold = 0.8) {
        const start = Date.now();
        try {
            const output = execSync(`bun test --coverage 2>&1`, {
                cwd: this.projectRoot,
                encoding: 'utf-8',
                timeout: 120_000,
            });
            // 从输出中提取覆盖率百分比
            const coverageMatch = output.match(/(\d+(?:\.\d+)?)\s*%/);
            const coveragePercent = coverageMatch ? parseFloat(coverageMatch[1]) : 0;
            const passed = coveragePercent / 100 >= threshold;
            return {
                passed,
                output: `${output}\nCoverage: ${coveragePercent}% (threshold: ${threshold * 100}%)`,
                duration: Date.now() - start,
            };
        }
        catch (err) {
            const error = err;
            return {
                passed: false,
                output: error.stdout || error.message || 'Coverage check failed',
                duration: Date.now() - start,
            };
        }
    }
    // ---- 内部工具 ----
    /** 获取 git hook 文件路径 */
    getHookPath(type) {
        return path.join(this.gitDir, 'hooks', type);
    }
    /** 确保 hooks 目录存在 */
    ensureHooksDir() {
        const hooksDir = path.join(this.gitDir, 'hooks');
        if (!fs.existsSync(hooksDir)) {
            fs.mkdirSync(hooksDir, { recursive: true });
        }
    }
}
