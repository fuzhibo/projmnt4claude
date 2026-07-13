import { parseCodeReferences, verifyReference, calculateFactAccuracy } from '../fact-accuracy-verifier';
import type { InvestigationReport } from '../types';

describe('parseCodeReferences', () => {
  it('should parse file path references', () => {
    const text = 'The issue is in src/utils/investigation/types.ts and src/commands/investigation-requirement.ts';
    const refs = parseCodeReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some(r => r.filePath === 'src/utils/investigation/types.ts')).toBe(true);
    expect(refs.some(r => r.filePath === 'src/commands/investigation-requirement.ts')).toBe(true);
  });

  it('should parse function references', () => {
    const text = 'The function validateReport() is defined in src/utils/investigation/report-validator.ts';
    const refs = parseCodeReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse full references with line numbers', () => {
    const text = 'See src/utils/investigation/types.ts:123 for the type definition';
    const refs = parseCodeReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter out invalid paths', () => {
    const text = 'Check https://example.com/file.ts and node_modules/something.ts';
    const refs = parseCodeReferences(text);
    expect(refs.length).toBe(0);
  });
});

describe('verifyReference', () => {
  it('should verify existing file', () => {
    const result = verifyReference(
      { type: 'file', filePath: 'src/utils/investigation/types.ts', rawText: 'src/utils/investigation/types.ts' },
      process.cwd(),
    );
    expect(result.exists).toBe(true);
  });

  it('should reject non-existent file', () => {
    const result = verifyReference(
      { type: 'file', filePath: 'src/non-existent-file.ts', rawText: 'src/non-existent-file.ts' },
      process.cwd(),
    );
    expect(result.exists).toBe(false);
  });

  it('should verify line number in existing file', () => {
    const result = verifyReference(
      { type: 'line', filePath: 'src/utils/investigation/types.ts', lineNumber: 1, rawText: 'types.ts:1' },
      process.cwd(),
    );
    expect(result.exists).toBe(true);
  });

  it('should reject invalid line number', () => {
    const result = verifyReference(
      { type: 'line', filePath: 'src/utils/investigation/types.ts', lineNumber: 99999, rawText: 'types.ts:99999' },
      process.cwd(),
    );
    expect(result.exists).toBe(false);
  });

  it('should verify existing function', () => {
    const result = verifyReference(
      { type: 'function', filePath: 'src/utils/investigation/report-validator.ts', functionName: 'validateReport', rawText: 'report-validator.ts:validateReport' },
      process.cwd(),
    );
    expect(result.exists).toBe(true);
  });
});

describe('calculateFactAccuracy', () => {
  it('should return 100 score when no references', () => {
    const report: InvestigationReport = {
      metadata: { requirementSource: 'test', investigationDate: '2026-07-08', investigationDir: 'test', language: 'zh' },
      rootCauseAnalysis: [{ id: 'CA-001', title: 'test', description: 'This is a detailed root cause analysis description that explains the problem thoroughly and provides sufficient context for understanding the issue at hand with all relevant details included here.' }],
      solutions: [{ id: 'SOL-001', title: 'test', description: 'This is a detailed solution description that explains the proposed fix thoroughly and provides sufficient context for implementing the solution with all relevant implementation details included here.', correspondsTo: 'CA-001', files: [], expectedChanges: 'none' }],
      checkpoints: [{ prefix: 'script', description: 'test', belongsTo: 'SOL-001' }],
      assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
    };

    const result = calculateFactAccuracy(report, process.cwd());
    expect(result.score).toBe(100);
    expect(result.totalReferences).toBe(0);
  });

  it('should detect valid file references', () => {
    const report: InvestigationReport = {
      metadata: { requirementSource: 'test', investigationDate: '2026-07-08', investigationDir: 'test', language: 'zh' },
      rootCauseAnalysis: [{ id: 'CA-001', title: 'test', description: 'The issue is in src/utils/investigation/types.ts and the fix is in src/utils/investigation/report-validator.ts. This is a detailed root cause analysis description that explains the problem thoroughly and provides sufficient context for understanding the issue at hand with all relevant details included here.' }],
      solutions: [{ id: 'SOL-001', title: 'test', description: 'This is a detailed solution description that explains the proposed fix thoroughly and provides sufficient context for implementing the solution with all relevant implementation details included here.', correspondsTo: 'CA-001', files: [], expectedChanges: 'none' }],
      checkpoints: [{ prefix: 'script', description: 'test', belongsTo: 'SOL-001' }],
      assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
    };

    const result = calculateFactAccuracy(report, process.cwd());
    expect(result.totalReferences).toBeGreaterThanOrEqual(1);
    expect(result.validReferences).toBeGreaterThanOrEqual(1);
    expect(result.score).toBe(100);
  });

  it('should detect invalid file references', () => {
    const report: InvestigationReport = {
      metadata: { requirementSource: 'test', investigationDate: '2026-07-08', investigationDir: 'test', language: 'zh' },
      rootCauseAnalysis: [{ id: 'CA-001', title: 'test', description: 'The issue is in src/non-existent-file.ts file. This is a detailed root cause analysis description that explains the problem thoroughly and provides sufficient context for understanding the issue at hand with all relevant details included here.' }],
      solutions: [{ id: 'SOL-001', title: 'test', description: 'This is a detailed solution description that explains the proposed fix thoroughly and provides sufficient context for implementing the solution with all relevant implementation details included here.', correspondsTo: 'CA-001', files: [], expectedChanges: 'none' }],
      checkpoints: [{ prefix: 'script', description: 'test', belongsTo: 'SOL-001' }],
      assessment: { complexity: 'low', impactScope: '有限', estimatedMinutes: 30 },
    };

    const result = calculateFactAccuracy(report, process.cwd());
    expect(result.totalReferences).toBeGreaterThanOrEqual(1);
    expect(result.score).toBe(0);
  });
});
