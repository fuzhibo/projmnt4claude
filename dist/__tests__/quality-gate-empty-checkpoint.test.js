/**
 * 质量门禁 - 空检查点数组验证测试
 *
 * 测试重点:
 * - validateCheckpoints: 验证空检查点数组的处理
 * - P0/P1 任务: 必须包含检查点，空数组应返回 error
 * - P2/P3 任务: 建议包含检查点，空数组返回 warning
 */
import { describe, it, expect } from 'bun:test';
import { validateCheckpoints } from '../utils/quality-gate.js';
// 辅助函数：创建测试任务
function createTestTask(overrides = {}) {
    return {
        id: 'TEST-TASK-001',
        title: '测试任务',
        description: '这是一个测试任务描述，用于验证空检查点数组的处理逻辑。',
        type: 'feature',
        status: 'open',
        priority: 'P1',
        dependencies: [],
        subtaskIds: [],
        checkpoints: [],
        history: [],
        discussionTopics: [],
        fileWarnings: [],
        allowedTools: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}
describe('validateCheckpoints - 空检查点数组验证', () => {
    // ========== P0 任务测试 ==========
    describe('P0 优先级任务', () => {
        it('空检查点数组应返回 error 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P0-001',
                priority: 'P0',
                checkpoints: [],
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-not-empty');
            expect(violations[0].severity).toBe('error');
            expect(violations[0].message).toContain('P0');
            expect(violations[0].message).toContain('必须包含至少 2 个结构化检查点');
        });
        it('undefined 检查点应返回 error 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P0-002',
                priority: 'P0',
                checkpoints: undefined,
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-not-empty');
            expect(violations[0].severity).toBe('error');
        });
    });
    // ========== P1 任务测试 ==========
    describe('P1 优先级任务', () => {
        it('空检查点数组应返回 error 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P1-001',
                priority: 'P1',
                checkpoints: [],
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-not-empty');
            expect(violations[0].severity).toBe('error');
            expect(violations[0].message).toContain('P1');
            expect(violations[0].message).toContain('必须包含至少 2 个结构化检查点');
        });
        it('undefined 检查点应返回 error 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P1-002',
                priority: 'P1',
                checkpoints: undefined,
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-not-empty');
            expect(violations[0].severity).toBe('error');
        });
    });
    // ========== P2 任务测试 ==========
    describe('P2 优先级任务', () => {
        it('空检查点数组应返回 warning 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P2-001',
                priority: 'P2',
                checkpoints: [],
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-empty');
            expect(violations[0].severity).toBe('warning');
            expect(violations[0].message).toContain('建议添加检查点');
        });
        it('undefined 检查点应返回 warning 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P2-002',
                priority: 'P2',
                checkpoints: undefined,
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-empty');
            expect(violations[0].severity).toBe('warning');
        });
    });
    // ========== P3 任务测试 ==========
    describe('P3 优先级任务', () => {
        it('空检查点数组应返回 warning 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P3-001',
                priority: 'P3',
                checkpoints: [],
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-empty');
            expect(violations[0].severity).toBe('warning');
            expect(violations[0].message).toContain('建议添加检查点');
        });
        it('undefined 检查点应返回 warning 级别违规', () => {
            const task = createTestTask({
                id: 'TASK-P3-002',
                priority: 'P3',
                checkpoints: undefined,
            });
            const violations = validateCheckpoints(task);
            expect(violations).toHaveLength(1);
            expect(violations[0].ruleId).toBe('checkpoint-array-empty');
            expect(violations[0].severity).toBe('warning');
        });
    });
    // ========== 有检查点的任务（对照组） ==========
    describe('有检查点的任务', () => {
        it('P0 任务有检查点时不应返回空数组违规', () => {
            const task = createTestTask({
                id: 'TASK-P0-003',
                priority: 'P0',
                checkpoints: [
                    {
                        id: 'CP-001',
                        description: '[ai review] 验证用户登录功能',
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                    {
                        id: 'CP-002',
                        description: '[ai qa] 运行单元测试',
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                ],
            });
            const violations = validateCheckpoints(task);
            // 不应该有空数组违规
            const emptyArrayViolation = violations.find(v => v.ruleId === 'checkpoint-array-not-empty' || v.ruleId === 'checkpoint-array-empty');
            expect(emptyArrayViolation).toBeUndefined();
        });
        it('P2 任务有检查点时不应返回空数组违规', () => {
            const task = createTestTask({
                id: 'TASK-P2-003',
                priority: 'P2',
                checkpoints: [
                    {
                        id: 'CP-001',
                        description: '[ai review] 实现功能',
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                ],
            });
            const violations = validateCheckpoints(task);
            const emptyArrayViolation = violations.find(v => v.ruleId === 'checkpoint-array-not-empty' || v.ruleId === 'checkpoint-array-empty');
            expect(emptyArrayViolation).toBeUndefined();
        });
    });
    // ========== 边界情况测试 ==========
    describe('边界情况', () => {
        it('优先级未设置时，空检查点应返回 warning', () => {
            const task = createTestTask({
                id: 'TASK-NO-PRIORITY',
                priority: undefined,
                checkpoints: [],
            });
            const violations = validateCheckpoints(task);
            // 当优先级不是 P0/P1 时，应返回 warning
            expect(violations).toHaveLength(1);
            expect(violations[0].severity).toBe('warning');
        });
    });
});
