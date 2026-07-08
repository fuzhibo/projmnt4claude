import { validateReport, VALIDATION_RULES } from '../report-validator';
import type { InvestigationReport } from '../types';

describe('validateReport error classification (SOL-003)', () => {
  it('should classify errors by investigationAction', () => {
    const report: InvestigationReport = {
      metadata: {} as any,  // metadata-required: block
      rootCauseAnalysis: [],  // root-cause-non-empty: block
      solutions: [],  // solution-non-empty: block
      checkpoints: [
        { prefix: 'invalid-prefix' as any, description: 'test', belongsTo: 'SOL-001' },
      ],
      assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
    };

    const result = validateReport(report);

    // 验证阻断性错误
    expect(result.blockingErrors).toHaveLength(3);
    expect(result.blockingErrors.map(e => e.rule)).toContain('metadata-required');
    expect(result.blockingErrors.map(e => e.rule)).toContain('root-cause-non-empty');
    expect(result.blockingErrors.map(e => e.rule)).toContain('solution-non-empty');

    // 验证警告性错误（从 errors 数组过滤）
    // checkpoint-prefix + checkpoint-belongsto（因为 SOL-001 不存在）
    expect(result.warningErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.warningErrors.map(e => e.rule)).toContain('checkpoint-prefix');

    // 验证所有错误（errors 包含阻断性 + 警告性）
    expect(result.errors.length).toBeGreaterThanOrEqual(5);  // 3 blocking + 2 warning
  });

  it('should not retry on warning-only errors', () => {
    const report: InvestigationReport = {
      metadata: { requirementSource: 'test', investigationDate: '2026-07-08', investigationDir: 'test', language: 'zh' },
      rootCauseAnalysis: [{ id: 'CA-001', title: 'test', description: 'test' }],
      solutions: [{ id: 'SOL-001', title: 'test', description: 'test', correspondsTo: 'CA-001', files: [], expectedChanges: 'none' }],
      checkpoints: [
        { prefix: 'script', description: 'test', belongsTo: 'SOL-001' },  // 有效前缀，有效 belongsTo
      ],
      assessment: { complexity: 'invalid' as any, impactScope: '有限', estimatedMinutes: 30 },  // 无效 complexity
    };

    const result = validateReport(report);

    expect(result.blockingErrors).toHaveLength(0);
    expect(result.warningErrors.length).toBeGreaterThanOrEqual(1);  // assessment-required 警告
    // SOL-003: valid 基于 errors.length，警告也计入 errors，所以 valid = false
    expect(result.valid).toBe(false);
  });

  it('should pass with valid report', () => {
    const report: InvestigationReport = {
      metadata: { requirementSource: 'test', investigationDate: '2026-07-08', investigationDir: 'test', language: 'zh' },
      rootCauseAnalysis: [{ id: 'CA-001', title: 'test', description: 'test' }],
      solutions: [{ id: 'SOL-001', title: 'test', description: 'test', correspondsTo: 'CA-001', files: [], expectedChanges: 'none' }],
      checkpoints: [
        { prefix: 'script', description: 'test', belongsTo: 'SOL-001' },
      ],
      assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
    };

    const result = validateReport(report);

    expect(result.valid).toBe(true);
    expect(result.blockingErrors).toHaveLength(0);
    expect(result.warningErrors).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should correctly identify all blocking rules', () => {
    const blockingRules = VALIDATION_RULES.filter(r => r.investigationAction === 'block');
    const blockingRuleNames = blockingRules.map(r => r.name);

    expect(blockingRuleNames).toContain('metadata-required');
    expect(blockingRuleNames).toContain('root-cause-non-empty');
    expect(blockingRuleNames).toContain('solution-non-empty');
    expect(blockingRuleNames).toContain('ca-sol-correspondence');
  });

  it('should correctly identify all warning rules', () => {
    const warningRules = VALIDATION_RULES.filter(r => r.investigationAction === 'warn');
    const warningRuleNames = warningRules.map(r => r.name);

    expect(warningRuleNames).toContain('checkpoint-prefix');
    expect(warningRuleNames).toContain('checkpoint-belongsto');
    expect(warningRuleNames).toContain('assessment-required');
    expect(warningRuleNames).toContain('id-format');
  });
});