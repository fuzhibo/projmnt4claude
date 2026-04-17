/**
 * config.ts 单元测试
 *
 * 覆盖: ensureConfigDefaults, readConfig, writeConfig,
 *        getConfigValue, setConfigValue, listConfig, getConfig, setConfig
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import path from 'path';
// ── Mock 函数（在 mock.module 前定义，以便闭包引用） ─────────
const mockIsInitialized = mock((cwd) => true);
const mockGetConfigPath = mock((cwd) => path.join(cwd, '.projmnt4claude', 'config.json'));
const mockReadFileSync = mock(() => '');
const mockWriteFileSync = mock(() => { });
// ── Mock 模块 ──────────────────────────────────────────────
mock.module('../utils/path', () => ({
    isInitialized: mockIsInitialized,
    getConfigPath: mockGetConfigPath,
}));
mock.module('../utils/prompt-templates', () => ({
    PROMPT_TEMPLATE_NAMES: ['dev', 'codeReview', 'qa', 'evaluation', 'requirement'],
    DEFAULT_TEMPLATES: {
        dev: 'Hello {name}, your task is {task}',
        codeReview: 'Review: {code}',
        qa: 'Verify: {task}',
        evaluation: 'Eval: {score}',
        requirement: 'Req: {text}',
    },
}));
mock.module('fs', () => ({
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
}));
import { ensureConfigDefaults, readConfig, writeConfig, getConfigValue, setConfigValue, listConfig, getConfig, setConfig, } from '../commands/config';
import { DEFAULT_LOGGING, DEFAULT_AI, DEFAULT_TRAINING } from '../types/config';
// ── 测试辅助 ──────────────────────────────────────────────
const CWD = '/tmp/test-project';
function baseConfig(overrides = {}) {
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
    process.exit = ((code) => {
        throw new Error(`process.exit:${code}`);
    });
    return () => { process.exit = original; };
}
beforeEach(() => {
    mockIsInitialized.mockClear();
    mockGetConfigPath.mockClear();
    mockReadFileSync.mockClear();
    mockWriteFileSync.mockClear();
    // 默认行为
    mockIsInitialized.mockReturnValue(true);
});
// ── ensureConfigDefaults ───────────────────────────────────
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
        const customLogging = { level: 'debug', maxFiles: 10, recordInputs: false, inputMaxLength: 100 };
        const result = ensureConfigDefaults(baseConfig({ logging: customLogging }));
        expect(result.logging).toEqual(customLogging);
    });
    test('部分字段缺失时用默认值填充', () => {
        const result = ensureConfigDefaults(baseConfig({ logging: { level: 'warn' } }));
        expect(result.logging.level).toBe('warn');
        expect(result.logging.maxFiles).toBe(DEFAULT_LOGGING.maxFiles);
        expect(result.logging.recordInputs).toBe(DEFAULT_LOGGING.recordInputs);
        expect(result.logging.inputMaxLength).toBe(DEFAULT_LOGGING.inputMaxLength);
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
        expect(result.ai.provider).toBe('openai');
        expect(result.ai.customEndpoint).toBe('http://localhost:1234');
        expect(result.ai.providerOptions).toEqual({ model: 'gpt-4' });
    });
});
// ── readConfig ─────────────────────────────────────────────
describe('readConfig', () => {
    test('项目未初始化时返回 null', () => {
        mockIsInitialized.mockReturnValue(false);
        expect(readConfig(CWD)).toBeNull();
    });
    test('正确读取并解析配置文件', () => {
        const configData = baseConfig({ logging: DEFAULT_LOGGING });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        expect(readConfig(CWD)).toEqual(configData);
    });
    test('文件读取失败时返回 null', () => {
        mockReadFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
        expect(readConfig(CWD)).toBeNull();
    });
    test('JSON 解析失败时返回 null', () => {
        mockReadFileSync.mockReturnValueOnce('not valid json{{{');
        expect(readConfig(CWD)).toBeNull();
    });
});
// ── writeConfig ────────────────────────────────────────────
describe('writeConfig', () => {
    test('将配置写入文件', () => {
        const config = baseConfig();
        writeConfig(config, CWD);
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
        const writtenContent = mockWriteFileSync.mock.calls[0][1];
        expect(JSON.parse(writtenContent)).toEqual(config);
    });
});
// ── getConfigValue ─────────────────────────────────────────
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
// ── setConfigValue ─────────────────────────────────────────
describe('setConfigValue', () => {
    test('设置顶级键值', () => {
        const result = setConfigValue(baseConfig(), 'projectName', 'new-name');
        expect(result.projectName).toBe('new-name');
    });
    test('设置嵌套键值（JSON 数字）', () => {
        const result = setConfigValue(baseConfig(), 'logging.maxFiles', '50');
        expect(result.logging.maxFiles).toBe(50);
    });
    test('设置嵌套键值（字符串）', () => {
        const result = setConfigValue(baseConfig(), 'logging.level', 'debug');
        expect(result.logging.level).toBe('debug');
    });
    test('自动创建中间对象', () => {
        const result = setConfigValue(baseConfig(), 'quality.minScore', '85');
        expect(result.quality.minScore).toBe(85);
    });
});
// ── listConfig ─────────────────────────────────────────────
describe('listConfig', () => {
    test('项目未初始化时调用 process.exit', () => {
        mockIsInitialized.mockReturnValue(false);
        const restore = mockProcessExit();
        const errorLogs = [];
        const origError = console.error;
        console.error = (...args) => errorLogs.push(args.join(' '));
        expect(() => listConfig(CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('成功输出配置信息', () => {
        const configData = baseConfig({ logging: DEFAULT_LOGGING, ai: DEFAULT_AI });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        listConfig(CWD);
        console.log = origLog;
        const output = logs.join('\n');
        expect(output).toContain('test-project');
        expect(output).toContain('## 日志');
        expect(output).toContain('## AI');
    });
});
// ── getConfig ──────────────────────────────────────────────
describe('getConfig', () => {
    test('获取存在的配置项并输出', () => {
        const configData = baseConfig({ logging: DEFAULT_LOGGING });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        getConfig('logging.level', CWD);
        console.log = origLog;
        expect(logs).toContain('info');
    });
    test('配置项不存在时调用 process.exit', () => {
        const configData = baseConfig();
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => getConfig('nonexistent.key', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
});
// ── setConfig ──────────────────────────────────────────────
describe('setConfig', () => {
    test('设置已知配置项并写入文件', () => {
        const configData = baseConfig({ logging: { ...DEFAULT_LOGGING } });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const origLog = console.log;
        console.log = () => { };
        setConfig('logging.level', 'debug', CWD);
        console.log = origLog;
        const writtenContent = mockWriteFileSync.mock.calls[0][1];
        const written = JSON.parse(writtenContent);
        expect(written.logging.level).toBe('debug');
    });
    test('未知配置键被拒绝', () => {
        const configData = baseConfig();
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => setConfig('unknown.key', 'value', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('非法枚举值被拒绝 (logging.level)', () => {
        const configData = baseConfig({ logging: DEFAULT_LOGGING });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => setConfig('logging.level', 'INVALID', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('设置布尔类型配置 (training.exportEnabled)', () => {
        const configData = baseConfig({ training: { ...DEFAULT_TRAINING } });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const origLog = console.log;
        console.log = () => { };
        setConfig('training.exportEnabled', 'true', CWD);
        console.log = origLog;
        const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
        expect(written.training.exportEnabled).toBe(true);
    });
    test('非法布尔值被拒绝', () => {
        const configData = baseConfig({ training: DEFAULT_TRAINING });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => setConfig('training.exportEnabled', 'yes', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('数值超范围被拒绝 (logging.maxFiles < 1)', () => {
        const configData = baseConfig({ logging: DEFAULT_LOGGING });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => setConfig('logging.maxFiles', '0', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('设置 prompts.* 自定义模板', () => {
        const configData = baseConfig({ prompts: {} });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const origLog = console.log;
        console.log = () => { };
        setConfig('prompts.dev', 'Custom {name} do {task}', CWD);
        console.log = origLog;
        const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
        expect(written.prompts.dev).toBe('Custom {name} do {task}');
    });
    test('未知 prompts 模板名被拒绝', () => {
        const configData = baseConfig();
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const restore = mockProcessExit();
        const origError = console.error;
        console.error = () => { };
        expect(() => setConfig('prompts.unknown', 'value', CWD)).toThrow('process.exit:1');
        console.error = origError;
        restore();
    });
    test('设置数字类型配置 (quality.minScore)', () => {
        const configData = baseConfig({ quality: { minScore: 50 } });
        mockReadFileSync.mockReturnValueOnce(JSON.stringify(configData));
        const origLog = console.log;
        console.log = () => { };
        setConfig('quality.minScore', '85', CWD);
        console.log = origLog;
        const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
        expect(written.quality.minScore).toBe(85);
    });
});
