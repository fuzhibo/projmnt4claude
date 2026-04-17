/**
 * 测试辅助工具单元测试
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MockFs, createMockFs, createTestProjectStructure, createTestTask, createTaskWithCheckpoints, createTaskInStatus, mockAIResponse, createMockAICostSummary, MockAIClient, createTestConfig, MockConfigValidator, assertExists, assertValidTask, assertValidCheckpoint, AssertionError, } from './helpers';
describe('MockFs', () => {
    let mockFs;
    beforeEach(() => {
        mockFs = createMockFs();
    });
    test('should create directory', () => {
        mockFs.mkdirSync('/test/dir', { recursive: true });
        expect(mockFs.existsSync('/test/dir')).toBe(true);
    });
    test('should write and read file', () => {
        mockFs.mkdirSync('/test', { recursive: true });
        mockFs.writeFileSync('/test/file.txt', 'Hello World');
        expect(mockFs.readFileSync('/test/file.txt', 'utf-8')).toBe('Hello World');
    });
    test('should check file existence', () => {
        mockFs.mkdirSync('/test', { recursive: true });
        mockFs.writeFileSync('/test/file.txt', 'content');
        expect(mockFs.existsSync('/test/file.txt')).toBe(true);
        expect(mockFs.existsSync('/test/missing.txt')).toBe(false);
    });
    test('should read directory', () => {
        mockFs.mkdirSync('/test', { recursive: true });
        mockFs.writeFileSync('/test/file1.txt', 'content1');
        mockFs.writeFileSync('/test/file2.txt', 'content2');
        const files = mockFs.readdirSync('/test');
        expect(files).toContain('file1.txt');
        expect(files).toContain('file2.txt');
    });
    test('should remove file', () => {
        mockFs.mkdirSync('/test', { recursive: true });
        mockFs.writeFileSync('/test/file.txt', 'content');
        mockFs.rmSync('/test/file.txt');
        expect(mockFs.existsSync('/test/file.txt')).toBe(false);
    });
    test('should check if path is file or directory', () => {
        mockFs.mkdirSync('/test/dir', { recursive: true });
        mockFs.writeFileSync('/test/file.txt', 'content');
        expect(mockFs.statSync('/test/dir').isDirectory()).toBe(true);
        expect(mockFs.statSync('/test/file.txt').isFile()).toBe(true);
    });
});
describe('createTestProjectStructure', () => {
    test('should create project structure', () => {
        const mockFs = createMockFs();
        createTestProjectStructure(mockFs, '/my-project');
        expect(mockFs.existsSync('/my-project/.projmnt4claude/tasks')).toBe(true);
        expect(mockFs.existsSync('/my-project/src/utils')).toBe(true);
        expect(mockFs.existsSync('/my-project/src/commands')).toBe(true);
        expect(mockFs.existsSync('/my-project/src/types')).toBe(true);
        expect(mockFs.existsSync('/my-project/package.json')).toBe(true);
    });
});
describe('createTestTask', () => {
    test('should create task with defaults', () => {
        const task = createTestTask();
        expect(task.id).toBeDefined();
        expect(task.title).toBeDefined();
        expect(task.status).toBe('open');
        expect(task.type).toBe('feature');
        expect(task.priority).toBe('P2');
        expect(task.checkpoints).toEqual([]);
    });
    test('should allow overrides', () => {
        const task = createTestTask({
            id: 'TASK-001',
            title: 'Custom Task',
            status: 'in_progress',
        });
        expect(task.id).toBe('TASK-001');
        expect(task.title).toBe('Custom Task');
        expect(task.status).toBe('in_progress');
    });
});
describe('createTaskWithCheckpoints', () => {
    test('should create task with checkpoints', () => {
        const task = createTaskWithCheckpoints(3);
        expect(task.checkpoints).toHaveLength(3);
        expect(task.checkpoints[0]?.id).toBe('CP-001');
        expect(task.checkpoints[0]?.status).toBe('completed');
        expect(task.checkpoints[1]?.status).toBe('pending');
    });
});
describe('createTaskInStatus', () => {
    test('should create task in specific status', () => {
        const task = createTaskInStatus('resolved');
        expect(task.status).toBe('resolved');
    });
});
describe('mockAIResponse', () => {
    test('should return mock data', async () => {
        const data = { result: 'success' };
        const response = await mockAIResponse(data);
        expect(response).toEqual(data);
    });
    test('should throw error when configured', async () => {
        await expect(mockAIResponse({}, { shouldError: true, errorMessage: 'Test error' })).rejects.toThrow('Test error');
    });
});
describe('createMockAICostSummary', () => {
    test('should create cost summary with defaults', () => {
        const summary = createMockAICostSummary();
        expect(summary.field).toBe('test-field');
        expect(summary.inputTokens).toBe(100);
        expect(summary.outputTokens).toBe(50);
        expect(summary.totalTokens).toBe(150);
    });
    test('should allow overrides', () => {
        const summary = createMockAICostSummary({
            field: 'custom-field',
            inputTokens: 200,
        });
        expect(summary.field).toBe('custom-field');
        expect(summary.inputTokens).toBe(200);
    });
});
describe('MockAIClient', () => {
    let client;
    beforeEach(() => {
        client = new MockAIClient();
    });
    test('should queue and return response', async () => {
        client.queueResponse({ content: 'Hello' });
        const response = await client.sendMessage('test prompt');
        expect(response).toEqual({ content: 'Hello' });
    });
    test('should throw queued error', async () => {
        client.queueError(new Error('AI Error'));
        await expect(client.sendMessage('test')).rejects.toThrow('AI Error');
    });
    test('should track call count', async () => {
        client.queueResponse({});
        await client.sendMessage('test1');
        await client.sendMessage('test2');
        expect(client.getCallCount()).toBe(2);
    });
    test('should reset state', async () => {
        client.queueResponse({});
        await client.sendMessage('test');
        client.reset();
        expect(client.getCallCount()).toBe(0);
    });
});
describe('createTestConfig', () => {
    test('should create config with defaults', () => {
        const config = createTestConfig();
        expect(config.version).toBe('1.0.0');
        expect(config.defaultPriority).toBe('P2');
        expect(config.ai?.provider).toBe('anthropic');
    });
    test('should allow overrides', () => {
        const config = createTestConfig({ version: '2.0.0' });
        expect(config.version).toBe('2.0.0');
    });
});
describe('MockConfigValidator', () => {
    let validator;
    beforeEach(() => {
        validator = new MockConfigValidator();
    });
    test('should validate valid config', () => {
        const result = validator.validate(createTestConfig());
        expect(result).toBe(true);
        expect(validator.getErrors()).toHaveLength(0);
    });
    test('should reject config without version', () => {
        const result = validator.validate({});
        expect(result).toBe(false);
        expect(validator.getErrors()).toContain('Config must have a version');
    });
});
describe('assertExists', () => {
    test('should not throw for existing value', () => {
        expect(() => assertExists('value')).not.toThrow();
    });
    test('should throw for null', () => {
        expect(() => assertExists(null)).toThrow(AssertionError);
    });
    test('should throw for undefined', () => {
        expect(() => assertExists(undefined)).toThrow(AssertionError);
    });
});
describe('assertValidTask', () => {
    test('should not throw for valid task', () => {
        const task = createTestTask();
        expect(() => assertValidTask(task)).not.toThrow();
    });
    test('should throw for task without id', () => {
        const task = createTestTask({ id: '' });
        expect(() => assertValidTask(task)).toThrow(AssertionError);
    });
    test('should throw for task without title', () => {
        const task = createTestTask({ title: '' });
        expect(() => assertValidTask(task)).toThrow(AssertionError);
    });
});
describe('assertValidCheckpoint', () => {
    test('should not throw for valid checkpoint', () => {
        const checkpoint = {
            id: 'CP-001',
            description: 'Test checkpoint',
            status: 'pending',
        };
        expect(() => assertValidCheckpoint(checkpoint)).not.toThrow();
    });
    test('should throw for checkpoint without id', () => {
        const checkpoint = { description: 'Test', status: 'pending' };
        expect(() => assertValidCheckpoint(checkpoint)).toThrow(AssertionError);
    });
});
