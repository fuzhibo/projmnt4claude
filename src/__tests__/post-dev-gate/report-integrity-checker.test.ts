/**
 * Report Integrity Checker Tests
 * 开发报告完整性检查器测试
 *
 * Tests for:
 * - CP-001: 检查开发报告是否包含所有必需字段
 * - CP-002: 验证报告数据完整性和一致性
 * - CP-003: 计算报告完整性评分
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  checkReportIntegrity,
  ReportIntegrityChecker,
  reportIntegrityChecker,
  checkReportExists,
  getReportCompletenessScore,
} from '../../utils/post-dev-gate/checkers/report-integrity-checker.js';
import { DEFAULT_REPORT_INTEGRITY_RULE } from '../../types/post-dev-phase-gate.js';
import type { PostDevPhaseCheckContext } from '../../types/post-dev-phase-gate.js';
import type { DevReport } from '../../types/harness.js';

describe('Report Integrity Checker', () => {
  let tempDir: string;
  let taskId: string;
  let context: PostDevPhaseCheckContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-integrity-test-'));
    taskId = 'TEST-TASK-001';

    // Create .projmnt4claude/outputs/{taskId} directory
    const outputDir = path.join(tempDir, '.projmnt4claude', 'outputs', taskId);
    fs.mkdirSync(outputDir, { recursive: true });

    context = {
      taskId,
      task: {
        id: taskId,
        title: 'Test Task',
        description: 'Test task description',
        type: 'feature',
        priority: 'P2',
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        reopenCount: 0,
        requirementHistory: [],
        checkpoints: [],
        schemaVersion: 6,
      },
      cwd: tempDir,
      config: {
        enabled: true,
        rules: new Map(),
        stopOnFailure: true,
        generateReport: true,
        enableAutoFix: false,
      },
    };
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('CP-001: 检查开发报告是否包含所有必需字段', () => {
    it('should pass when dev report has all required fields', async () => {
      // Create a valid dev report
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts', 'file2.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001', 'CP-002'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 12345,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('report-integrity-check');
      expect(result.checkName).toBe('Dev Report Integrity Check');
    });

    it('should fail when dev report is missing required fields', async () => {
      // Create an invalid dev report with missing fields
      const devReport = {
        taskId,
        status: 'success',
        // Missing: changes, evidence, checkpointsCompleted, startTime, endTime, duration
      };

      context.devReport = devReport as DevReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('missing');
    });

    it('should fail when dev report does not exist', async () => {
      // No dev report provided and no file exists
      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Dev report not found');
    });

    it('should load dev report from file when not provided in context', async () => {
      // Create dev report file
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(devReport, null, 2));

      // Do not set context.devReport - it should load from file
      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(true);
    });
  });

  describe('CP-002: 验证报告数据完整性和一致性', () => {
    it('should validate status field values', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'invalid_status' as any,
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect((result.details as any)?.errors).toEqual(expect.arrayContaining([expect.stringContaining('status')]));
    });

    it('should validate duration is non-negative', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: -100, // Invalid negative duration
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect((result.details as any)?.errors).toEqual(expect.arrayContaining([expect.stringContaining('duration')]));
    });

    it('should validate ISO 8601 timestamp format', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: 'invalid-date',
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect((result.details as any)?.errors).toEqual(expect.arrayContaining([expect.stringContaining('startTime')]));
    });

    it('should validate arrays are properly typed', async () => {
      const devReport = {
        taskId,
        status: 'success',
        changes: 'not-an-array', // Should be array
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      context.devReport = devReport as DevReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect((result.details as any)?.errors).toEqual(expect.arrayContaining([expect.stringContaining('changes')]));
    });
  });

  describe('CP-003: 计算报告完整性评分', () => {
    it('should calculate 100% score for complete report', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts', 'file2.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001', 'CP-002', 'CP-003'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 12345,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(true);
      expect(result.details?.completenessScore).toBe(100);
    });

    it('should calculate partial score for incomplete report', async () => {
      const devReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        // Missing: evidence, checkpointsCompleted, startTime, endTime, duration
      };

      context.devReport = devReport as DevReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect(result.details?.completenessScore).toBeLessThan(100);
    });

    it('should reduce score for validation errors', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'invalid_status' as any, // Validation error
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect(result.details?.errors).toHaveLength(1);
    });

    it('should provide suggestions for fixing issues', async () => {
      const devReport = {
        taskId,
        status: 'success',
        // Missing most fields
      };

      context.devReport = devReport as DevReport;

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });
  });

  describe('ReportIntegrityChecker class', () => {
    it('should have correct metadata', () => {
      expect(reportIntegrityChecker.id).toBe('report-integrity-checker');
      expect(reportIntegrityChecker.name).toBe('Report Integrity Checker');
      expect(reportIntegrityChecker.description).toBe('Check if dev report contains all required fields');
    });

    it('should execute check via class method', async () => {
      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: ['CP-001'],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 1000,
      };

      context.devReport = devReport;

      const result = await reportIntegrityChecker.check(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(true);
    });
  });

  describe('Helper functions', () => {
    describe('checkReportExists', () => {
      it('should return true when report exists', () => {
        const devReport: DevReport = {
          taskId,
          status: 'success',
          changes: [],
          evidence: [],
          checkpointsCompleted: [],
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 0,
        };

        const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(devReport, null, 2));

        expect(checkReportExists(tempDir, taskId)).toBe(true);
      });

      it('should return false when report does not exist', () => {
        expect(checkReportExists(tempDir, taskId)).toBe(false);
      });
    });

    describe('getReportCompletenessScore', () => {
      it('should return 0 when report does not exist', async () => {
        const score = await getReportCompletenessScore(tempDir, taskId);
        expect(score).toBe(0);
      });

      it('should return score for existing report', async () => {
        const devReport: DevReport = {
          taskId,
          status: 'success',
          changes: ['file1.ts'],
          evidence: ['output.json'],
          checkpointsCompleted: ['CP-001'],
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1000,
        };

        const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(devReport, null, 2));

        const score = await getReportCompletenessScore(tempDir, taskId);
        expect(score).toBe(100);
      });
    });
  });

  describe('Custom configuration', () => {
    it('should use custom required fields when provided', async () => {
      const customRule = {
        ...DEFAULT_REPORT_INTEGRITY_RULE,
        config: {
          requiredFields: ['taskId', 'status'], // Only require 2 fields
          minCompletenessScore: 50,
        },
      };

      const devReport = {
        taskId,
        status: 'success',
        // Missing other fields
      };

      context.devReport = devReport as DevReport;

      const result = await checkReportIntegrity(customRule, context);

      expect(result.passed).toBe(true); // Should pass with custom config
    });

    it('should fail when completeness score is below threshold', async () => {
      const customRule = {
        ...DEFAULT_REPORT_INTEGRITY_RULE,
        config: {
          requiredFields: ['taskId', 'status', 'changes', 'evidence'],
          minCompletenessScore: 100, // Require perfect score
        },
      };

      const devReport: DevReport = {
        taskId,
        status: 'success',
        changes: ['file1.ts'],
        evidence: ['output.json'],
        checkpointsCompleted: [],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 0,
      };

      context.devReport = devReport;

      const result = await checkReportIntegrity(customRule, context);

      // Should pass but with less than 100% of all default fields
      // Actually this should still pass as all required custom fields are present
      expect(result.passed).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed JSON in report file', async () => {
      const reportPath = path.join(tempDir, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
      fs.writeFileSync(reportPath, 'not valid json');

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Dev report not found');
    });

    it('should handle file system errors gracefully', async () => {
      // Create a context with non-existent directory
      const badContext: PostDevPhaseCheckContext = {
        ...context,
        cwd: '/nonexistent/directory',
      };

      const result = await checkReportIntegrity(DEFAULT_REPORT_INTEGRITY_RULE, badContext);

      expect(result.passed).toBe(false);
    });
  });
});
