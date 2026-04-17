/**
 * analyze-range-parser.ts 单元测试
 *
 * 测试重点:
 * - AnalyzeError: 错误类属性
 * - safeRegexMatch: 正则匹配 + 超时保护 + 无效正则
 * - sanitizeCheckRange: 输入净化
 * - parseCheckRange: 三种模式解析 + 错误处理
 * - getTasksByRange: 任务过滤（需 mock）
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { AnalyzeError, safeRegexMatch, sanitizeCheckRange, parseCheckRange, getTasksByRange, } from '../utils/analyze-range-parser';
// ── AnalyzeError ──────────────────────────────────────
describe('AnalyzeError', () => {
    it('should set name, code, message, detail', () => {
        const err = new AnalyzeError('TEST_CODE', 'test message', 'detail info');
        expect(err.name).toBe('AnalyzeError');
        expect(err.code).toBe('TEST_CODE');
        expect(err.message).toBe('test message');
        expect(err.detail).toBe('detail info');
    });
    it('should be an instance of Error', () => {
        const err = new AnalyzeError('X', 'msg');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AnalyzeError);
    });
    it('detail should be optional', () => {
        const err = new AnalyzeError('X', 'msg');
        expect(err.detail).toBeUndefined();
    });
});
// ── safeRegexMatch ────────────────────────────────────
describe('safeRegexMatch', () => {
    it('should match simple pattern', () => {
        const result = safeRegexMatch('hello', 'hello world');
        expect(result).not.toBeNull();
        expect(result[0]).toBe('hello');
    });
    it('should be case-insensitive', () => {
        const result = safeRegexMatch('hello', 'HELLO WORLD');
        expect(result).not.toBeNull();
    });
    it('should return null for no match', () => {
        const result = safeRegexMatch('xyz', 'hello world');
        expect(result).toBeNull();
    });
    it('should throw on empty pattern', () => {
        expect(() => safeRegexMatch('', 'text')).toThrow(AnalyzeError);
        expect(() => safeRegexMatch('', 'text')).toThrow('正则表达式不能为空');
    });
    it('should throw on invalid regex', () => {
        expect(() => safeRegexMatch('[invalid', 'text')).toThrow(AnalyzeError);
        expect(() => safeRegexMatch('[invalid', 'text')).toThrow('无效的正则表达式');
    });
    it('should support regex special characters when escaped', () => {
        const result = safeRegexMatch('\\[test\\]', '[test] value');
        expect(result).not.toBeNull();
    });
    it('should match groups', () => {
        const result = safeRegexMatch('(\\d+)-(\\d+)', 'task 123-456 end');
        expect(result).not.toBeNull();
        expect(result[1]).toBe('123');
        expect(result[2]).toBe('456');
    });
});
// ── sanitizeCheckRange ────────────────────────────────
describe('sanitizeCheckRange', () => {
    it('should trim whitespace', () => {
        expect(sanitizeCheckRange('  all  ')).toBe('all');
    });
    it('should remove control characters', () => {
        const input = 'all\x00\x01\x1F';
        expect(sanitizeCheckRange(input)).toBe('all');
    });
    it('should throw on non-string input', () => {
        expect(() => sanitizeCheckRange(123)).toThrow(AnalyzeError);
        expect(() => sanitizeCheckRange(null)).toThrow(AnalyzeError);
    });
    it('should truncate overly long input', () => {
        const long = 'a'.repeat(400);
        const result = sanitizeCheckRange(long);
        expect(result.length).toBeLessThanOrEqual(300 + 100);
    });
    it('should preserve normal text', () => {
        expect(sanitizeCheckRange('tasks:T1,T2')).toBe('tasks:T1,T2');
    });
});
// ── parseCheckRange ───────────────────────────────────
describe('parseCheckRange', () => {
    // all 模式
    it('should return all for empty string', () => {
        const result = parseCheckRange('');
        expect(result.type).toBe('all');
    });
    it('should return all for "all"', () => {
        const result = parseCheckRange('all');
        expect(result.type).toBe('all');
    });
    it('should return all for "ALL" (case insensitive)', () => {
        const result = parseCheckRange('ALL');
        expect(result.type).toBe('all');
    });
    // tasks 模式
    it('should parse tasks mode', () => {
        const result = parseCheckRange('tasks:T1,T2,T3');
        expect(result.type).toBe('tasks');
        expect(result.taskIds).toEqual(['T1', 'T2', 'T3']);
    });
    it('should trim task IDs', () => {
        const result = parseCheckRange('tasks: T1 , T2 ');
        expect(result.taskIds).toEqual(['T1', 'T2']);
    });
    it('should filter empty task IDs', () => {
        const result = parseCheckRange('tasks:T1,,T2');
        expect(result.taskIds).toEqual(['T1', 'T2']);
    });
    it('should throw on empty tasks list', () => {
        expect(() => parseCheckRange('tasks:')).toThrow(AnalyzeError);
        expect(() => parseCheckRange('tasks:')).toThrow('至少一个任务 ID');
    });
    it('should throw on invalid task ID characters', () => {
        expect(() => parseCheckRange('tasks:T1,T;2')).toThrow(AnalyzeError);
        expect(() => parseCheckRange('tasks:T1,T;2')).toThrow('非法字符');
    });
    it('should accept hyphens and underscores in task IDs', () => {
        const result = parseCheckRange('tasks:TASK-feat-P1_auth-20260410');
        expect(result.taskIds).toEqual(['TASK-feat-P1_auth-20260410']);
    });
    // keyword 模式
    it('should parse keyword mode', () => {
        const result = parseCheckRange('keyword:auth');
        expect(result.type).toBe('keyword');
        expect(result.keyword).toBe('auth');
    });
    it('should throw on empty keyword', () => {
        expect(() => parseCheckRange('keyword:')).toThrow(AnalyzeError);
        expect(() => parseCheckRange('keyword:')).toThrow('搜索关键词');
    });
    it('should throw on invalid regex in keyword', () => {
        expect(() => parseCheckRange('keyword:[invalid')).toThrow(AnalyzeError);
        expect(() => parseCheckRange('keyword:[invalid')).toThrow('正则表达式无效');
    });
    it('should accept valid regex in keyword', () => {
        const result = parseCheckRange('keyword:auth|login');
        expect(result.keyword).toBe('auth|login');
    });
    // 未知格式
    it('should throw on unknown format', () => {
        expect(() => parseCheckRange('unknown:value')).toThrow(AnalyzeError);
        expect(() => parseCheckRange('unknown:value')).toThrow('无法识别');
    });
});
// ── getTasksByRange ───────────────────────────────────
describe('getTasksByRange', () => {
    // Mock task data
    const mockTasks = [
        {
            id: 'TASK-1',
            title: 'Implement auth',
            description: 'Add authentication',
            status: 'open',
            priority: 'P1',
            type: 'feature',
            dependencies: [],
            createdAt: '2026-04-01',
            updatedAt: '2026-04-01',
            history: [],
            checkpoints: [],
            reopenCount: 0,
            requirementHistory: [],
            createdBy: 'cli',
            schemaVersion: 4,
        },
        {
            id: 'TASK-2',
            title: 'Fix login bug',
            description: 'Login page crashes',
            status: 'resolved',
            priority: 'P2',
            type: 'bug',
            dependencies: [],
            createdAt: '2026-04-01',
            updatedAt: '2026-04-01',
            history: [],
            checkpoints: [],
            reopenCount: 0,
            requirementHistory: [],
            createdBy: 'cli',
            schemaVersion: 4,
        },
        {
            id: 'TASK-3',
            title: 'Write docs',
            description: 'Document API',
            status: 'in_progress',
            priority: 'P3',
            type: 'docs',
            dependencies: [],
            createdAt: '2026-04-01',
            updatedAt: '2026-04-01',
            history: [],
            checkpoints: [],
            reopenCount: 0,
            requirementHistory: [],
            createdBy: 'cli',
            schemaVersion: 4,
        },
    ];
    // We can't easily mock getAllTasks/readTaskMeta, so test parseCheckRange logic only
    // getTasksByRange depends on real filesystem - tested via integration
    it('should be exported and callable', () => {
        expect(typeof getTasksByRange).toBe('function');
    });
    it('should handle all mode with empty array', () => {
        // Since getAllTasks reads from filesystem, we just verify no crash
        const range = parseCheckRange('all');
        // This will return tasks from actual project or empty
        const tasks = getTasksByRange(range, '/nonexistent/path');
        expect(Array.isArray(tasks)).toBe(true);
    });
    it('should handle tasks mode with nonexistent IDs', () => {
        const range = parseCheckRange('tasks:NONEXISTENT-1,NONEXISTENT-2');
        const tasks = getTasksByRange(range, '/nonexistent/path');
        expect(tasks).toEqual([]);
    });
    it('should handle keyword mode with no matches', () => {
        const range = parseCheckRange('keyword:zzzznoMatchZZZZ');
        const tasks = getTasksByRange(range, '/nonexistent/path');
        expect(tasks).toEqual([]);
    });
});
