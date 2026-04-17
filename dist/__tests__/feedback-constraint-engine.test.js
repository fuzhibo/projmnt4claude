import { describe, test, expect } from 'bun:test';
import { jsonParseableRule, nonEmptyOutputRule, JsonFeedbackTemplate, MarkdownFeedbackTemplate, FeedbackConstraintEngineImpl, createJsonFeedbackEngine, createMarkdownFeedbackEngine, createSessionAwareEngine, } from '../utils/feedback-constraint-engine.js';
// Helper: create a simple rule
function makeRule(id, check) {
    return { id, description: `rule ${id}`, check, severity: 'error' };
}
// Helper: create a rule set
function makeRuleSet(name, rules, maxRetries = 2) {
    return { name, outputType: 'json', rules, maxRetriesOnError: maxRetries };
}
// ============== jsonParseableRule ==============
describe('jsonParseableRule', () => {
    test('returns violation for non-string input', () => {
        const result = jsonParseableRule.check(123);
        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('json-parseable');
        expect(result.message).toContain('不是字符串类型');
    });
    test('returns violation for empty string', () => {
        const result = jsonParseableRule.check('');
        expect(result).not.toBeNull();
        expect(result.message).toContain('空字符串');
    });
    test('returns violation for invalid JSON string', () => {
        const result = jsonParseableRule.check('{invalid json}');
        expect(result).not.toBeNull();
        expect(result.message).toContain('JSON 解析失败');
    });
    test('returns null for valid JSON', () => {
        expect(jsonParseableRule.check('{"key": "value"}')).toBeNull();
        expect(jsonParseableRule.check('"hello"')).toBeNull();
        expect(jsonParseableRule.check('42')).toBeNull();
        expect(jsonParseableRule.check('null')).toBeNull();
    });
    test('returns null for valid JSON array', () => {
        expect(jsonParseableRule.check('[1, 2, 3]')).toBeNull();
    });
});
// ============== nonEmptyOutputRule ==============
describe('nonEmptyOutputRule', () => {
    test('returns violation for null', () => {
        const result = nonEmptyOutputRule.check(null);
        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('non-empty-output');
        expect(result.message).toContain('null');
    });
    test('returns violation for undefined', () => {
        const result = nonEmptyOutputRule.check(undefined);
        expect(result).not.toBeNull();
        expect(result.message).toContain('null');
    });
    test('returns violation for whitespace-only string', () => {
        const result = nonEmptyOutputRule.check('   \n\t  ');
        expect(result).not.toBeNull();
        expect(result.message).toContain('空字符串');
    });
    test('returns null for non-empty string', () => {
        expect(nonEmptyOutputRule.check('hello')).toBeNull();
    });
    test('returns null for non-string truthy values', () => {
        expect(nonEmptyOutputRule.check(42)).toBeNull();
        expect(nonEmptyOutputRule.check(true)).toBeNull();
    });
});
// ============== JsonFeedbackTemplate ==============
describe('JsonFeedbackTemplate', () => {
    test('formats violations with all fields into prompt', () => {
        const template = new JsonFeedbackTemplate();
        const violations = [
            { ruleId: 'test-rule', severity: 'error', message: 'something broke', field: 'data.name', value: '""' },
        ];
        const result = template.buildFeedbackPrompt(violations, '{}');
        expect(result).toContain('[ERROR] test-rule');
        expect(result).toContain('something broke');
        expect(result).toContain('字段: data.name');
        expect(result).toContain('值: ""');
        expect(result).toContain('```json');
        expect(result).toContain('{}');
    });
    test('truncates long original output', () => {
        const template = new JsonFeedbackTemplate(10);
        const longOutput = 'a'.repeat(100);
        const result = template.buildFeedbackPrompt([], longOutput);
        expect(result).toContain('已截断');
        expect(result).not.toContain('a'.repeat(100));
    });
    test('omits field and value lines when not present', () => {
        const template = new JsonFeedbackTemplate();
        const violations = [
            { ruleId: 'r1', severity: 'warning', message: 'm1' },
        ];
        const result = template.buildFeedbackPrompt(violations, 'output');
        expect(result).toContain('[WARNING] r1');
        expect(result).not.toContain('字段:');
        expect(result).not.toContain('值:');
    });
    test('enumerates multiple violations', () => {
        const template = new JsonFeedbackTemplate();
        const violations = [
            { ruleId: 'r1', severity: 'error', message: 'm1' },
            { ruleId: 'r2', severity: 'warning', message: 'm2' },
        ];
        const result = template.buildFeedbackPrompt(violations, 'out');
        expect(result).toContain('1. [ERROR] r1');
        expect(result).toContain('2. [WARNING] r2');
    });
});
// ============== MarkdownFeedbackTemplate ==============
describe('MarkdownFeedbackTemplate', () => {
    test('formats violations with field into markdown prompt', () => {
        const template = new MarkdownFeedbackTemplate();
        const violations = [
            { ruleId: 'md-rule', severity: 'error', message: 'bad format', field: 'heading' },
        ];
        const result = template.buildFeedbackPrompt(violations, '# Title');
        expect(result).toContain('**[ERROR] md-rule**');
        expect(result).toContain('bad format');
        expect(result).toContain('`heading`');
        expect(result).toContain('```markdown');
    });
    test('truncates long output at configured limit', () => {
        const template = new MarkdownFeedbackTemplate(20);
        const longOutput = 'x'.repeat(200);
        const result = template.buildFeedbackPrompt([], longOutput);
        expect(result).toContain('已截断');
    });
    test('formats multiple violations with numbering', () => {
        const template = new MarkdownFeedbackTemplate();
        const violations = [
            { ruleId: 'r1', severity: 'error', message: 'e1' },
            { ruleId: 'r2', severity: 'warning', message: 'w1' },
        ];
        const result = template.buildFeedbackPrompt(violations, 'out');
        expect(result).toContain('1. **[ERROR] r1**');
        expect(result).toContain('2. **[WARNING] r2**');
    });
});
// ============== FeedbackConstraintEngineImpl.validate ==============
describe('FeedbackConstraintEngineImpl.validate', () => {
    test('returns empty array when all rules pass', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const alwaysPass = makeRule('pass', () => null);
        engine.addRuleSet(makeRuleSet('ok', [alwaysPass]));
        expect(engine.validate('anything')).toEqual([]);
    });
    test('collects violations from multiple rule sets', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const r1 = makeRule('r1', () => ({ ruleId: 'r1', severity: 'error', message: 'm1' }));
        const r2 = makeRule('r2', () => ({ ruleId: 'r2', severity: 'warning', message: 'm2' }));
        engine.addRuleSet(makeRuleSet('set1', [r1]));
        engine.addRuleSet(makeRuleSet('set2', [r2]));
        const violations = engine.validate('test');
        expect(violations).toHaveLength(2);
        expect(violations[0].ruleId).toBe('r1');
        expect(violations[1].ruleId).toBe('r2');
    });
    test('fills severity from rule when violation lacks it', () => {
        const engine = new FeedbackConstraintEngineImpl();
        // Rule with severity 'warning' but check returns violation without severity
        const rule = {
            id: 'no-sev',
            description: 'test',
            severity: 'warning',
            check: () => ({ ruleId: 'no-sev', severity: undefined, message: 'm' }),
        };
        engine.addRuleSet(makeRuleSet('s', [rule]));
        const violations = engine.validate('x');
        expect(violations[0].severity).toBe('warning');
    });
});
// ============== FeedbackConstraintEngineImpl.shouldRetry ==============
describe('FeedbackConstraintEngineImpl.shouldRetry', () => {
    test('returns false when only warnings present', () => {
        const engine = new FeedbackConstraintEngineImpl();
        engine.addRuleSet(makeRuleSet('s', [makeRule('r', () => null)]));
        const violations = [
            { ruleId: 'r', severity: 'warning', message: 'm' },
        ];
        expect(engine.shouldRetry(violations)).toBe(false);
    });
    test('returns true when errors exist and retries remaining', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const r = makeRule('err', () => ({ ruleId: 'err', severity: 'error', message: 'm' }));
        engine.addRuleSet(makeRuleSet('s', [r], 2));
        const violations = [
            { ruleId: 'err', severity: 'error', message: 'm' },
        ];
        expect(engine.shouldRetry(violations)).toBe(true);
    });
    test('returns false when max retries exceeded for error rule set', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const r = makeRule('err', () => ({ ruleId: 'err', severity: 'error', message: 'm' }));
        engine.addRuleSet(makeRuleSet('s', [r], 1));
        // Simulate retryCount already at max via reflection
        engine.retryCount = 1;
        const violations = [
            { ruleId: 'err', severity: 'error', message: 'm' },
        ];
        expect(engine.shouldRetry(violations)).toBe(false);
    });
});
// ============== FeedbackConstraintEngineImpl.runWithFeedback ==============
// Simple mock invoke helper
function mockInvoke(responses) {
    let i = 0;
    const calls = [];
    return Object.assign(async (prompt, opts) => {
        calls.push([prompt, opts]);
        return responses[Math.min(i++, responses.length - 1)];
    }, { calls, callCount: () => calls.length });
}
describe('FeedbackConstraintEngineImpl.runWithFeedback', () => {
    test('passes on first valid output', async () => {
        const engine = new FeedbackConstraintEngineImpl();
        engine.addRuleSet(makeRuleSet('s', [makeRule('always-pass', () => null)]));
        const invoke = mockInvoke([{ output: '{"ok":true}', exitCode: 0 }]);
        const result = await engine.runWithFeedback(invoke, 'prompt', {});
        expect(result.passed).toBe(true);
        expect(result.violations).toHaveLength(0);
        expect(result.retries).toBe(0);
        expect(invoke.callCount()).toBe(1);
    });
    test('retries on error violations and succeeds on second attempt', async () => {
        const engine = new FeedbackConstraintEngineImpl();
        let callCount = 0;
        const rule = makeRule('flaky', () => {
            callCount++;
            return callCount < 2
                ? { ruleId: 'flaky', severity: 'error', message: 'bad' }
                : null;
        });
        engine.addRuleSet(makeRuleSet('s', [rule], 2));
        const invoke = mockInvoke([
            { output: 'bad', exitCode: 0 },
            { output: 'good', exitCode: 0 },
        ]);
        const result = await engine.runWithFeedback(invoke, 'prompt', {});
        expect(result.passed).toBe(true);
        expect(result.retries).toBe(1);
        expect(invoke.callCount()).toBe(2);
        // Second call should use feedback prompt
        expect(invoke.calls[1][0]).toContain('违规项');
    });
    test('stops retrying and returns failures when max retries exceeded', async () => {
        const engine = new FeedbackConstraintEngineImpl();
        const rule = makeRule('always-fail', () => ({
            ruleId: 'always-fail', severity: 'error', message: 'always fails',
        }));
        engine.addRuleSet(makeRuleSet('s', [rule], 1));
        const invoke = mockInvoke([
            { output: 'bad', exitCode: 0 },
            { output: 'bad2', exitCode: 0 },
        ]);
        const result = await engine.runWithFeedback(invoke, 'prompt', {});
        expect(result.passed).toBe(false);
        expect(result.retries).toBe(1);
        expect(result.violations.length).toBeGreaterThan(0);
        expect(invoke.callCount()).toBe(2); // initial + 1 retry
    });
    test('does not retry when only warnings present', async () => {
        const engine = new FeedbackConstraintEngineImpl();
        const rule = {
            id: 'warn',
            description: 'warn rule',
            severity: 'warning',
            check: () => ({ ruleId: 'warn', severity: 'warning', message: 'just a warning' }),
        };
        engine.addRuleSet(makeRuleSet('s', [rule], 3));
        const invoke = mockInvoke([{ output: 'data', exitCode: 0 }]);
        const result = await engine.runWithFeedback(invoke, 'prompt', {});
        expect(result.passed).toBe(true); // no errors = passed
        expect(result.retries).toBe(0);
        expect(invoke.callCount()).toBe(1);
    });
});
// ============== FeedbackConstraintEngineImpl misc ==============
describe('FeedbackConstraintEngineImpl misc', () => {
    test('setTemplate replaces template', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const md = new MarkdownFeedbackTemplate();
        engine.setTemplate(md);
        const feedback = engine.buildFeedback([{ ruleId: 'r', severity: 'error', message: 'm' }], 'output');
        expect(feedback).toContain('```markdown');
    });
    test('addRuleSet returns this for chaining', () => {
        const engine = new FeedbackConstraintEngineImpl();
        const returned = engine.addRuleSet(makeRuleSet('s', []));
        expect(returned).toBe(engine);
    });
    test('getRetryCount returns current count', () => {
        const engine = new FeedbackConstraintEngineImpl();
        expect(engine.getRetryCount()).toBe(0);
        engine.retryCount = 5;
        expect(engine.getRetryCount()).toBe(5);
    });
    test('reset zeroes retry count and returns this', () => {
        const engine = new FeedbackConstraintEngineImpl();
        engine.retryCount = 10;
        const returned = engine.reset();
        expect(returned).toBe(engine);
        expect(engine.getRetryCount()).toBe(0);
    });
});
// ============== Factory functions ==============
describe('createJsonFeedbackEngine', () => {
    test('creates engine with JSON template and default rules', () => {
        const engine = createJsonFeedbackEngine();
        // Should have nonEmptyOutputRule + jsonParseableRule
        const violations = engine.validate('');
        expect(violations.length).toBeGreaterThan(0);
    });
    test('accepts additional rules', () => {
        const extra = makeRule('extra', () => ({ ruleId: 'extra', severity: 'error', message: 'm' }));
        const engine = createJsonFeedbackEngine([extra]);
        const violations = engine.validate('valid json');
        expect(violations.some((v) => v.ruleId === 'extra')).toBe(true);
    });
    test('respects custom maxRetriesOnError', () => {
        const engine = createJsonFeedbackEngine([], 5);
        // Engine created without errors - verify it doesn't crash
        expect(engine).toBeDefined();
        expect(engine.getRetryCount()).toBe(0);
    });
});
describe('createMarkdownFeedbackEngine', () => {
    test('creates engine with Markdown template', () => {
        const engine = createMarkdownFeedbackEngine();
        const feedback = engine.buildFeedback([{ ruleId: 'r', severity: 'error', message: 'm' }], 'output');
        expect(feedback).toContain('```markdown');
    });
    test('accepts custom rules', () => {
        const extra = makeRule('x', () => ({ ruleId: 'x', severity: 'warning', message: 'w' }));
        const engine = createMarkdownFeedbackEngine([extra]);
        const violations = engine.validate('text');
        expect(violations.some((v) => v.ruleId === 'x')).toBe(true);
    });
});
describe('createSessionAwareEngine', () => {
    test('creates JSON engine with json outputType', () => {
        const engine = createSessionAwareEngine('json');
        // Empty string triggers non-empty + json-parseable rules
        const violations = engine.validate('');
        expect(violations.length).toBeGreaterThanOrEqual(2);
    });
    test('creates Markdown engine with markdown outputType', () => {
        const engine = createSessionAwareEngine('markdown');
        // null triggers non-empty rule only
        const violations = engine.validate(null);
        expect(violations.length).toBeGreaterThanOrEqual(1);
        // Should NOT have json-parseable violation for null
        expect(violations.every((v) => v.ruleId !== 'json-parseable')).toBe(true);
    });
    test('accepts additional rules and custom maxRetries', () => {
        const extra = makeRule('sa', () => ({ ruleId: 'sa', severity: 'error', message: 'm' }));
        const engine = createSessionAwareEngine('json', [extra], 5);
        const violations = engine.validate('valid json');
        expect(violations.some((v) => v.ruleId === 'sa')).toBe(true);
    });
});
