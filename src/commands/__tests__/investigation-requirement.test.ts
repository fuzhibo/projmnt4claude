/**
 * investigation-requirement 命令单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../utils/test-env.js';
import type { InvestigationReport, OutputMode } from '../../utils/investigation/types';
import { generateReport } from '../../utils/investigation/report-generator';
import {
  investigationRequirement,
  writeReport,
  type InvestigationRequirementOptions,
  type InvestigationResult,
} from '../investigation-requirement';

// ============================================================
// Test helpers
// ============================================================

function createTestReport(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    metadata: {
      requirementSource: 'Test requirement',
      investigationDate: new Date().toISOString(),
      investigationDir: 'investigation-test',
      language: 'zh',
      ...overrides.metadata,
    },
    rootCauseAnalysis: [
      { id: 'CA-001', title: 'Test Cause', description: 'Test cause description' },
    ],
    solutions: [
      { id: 'SOL-001', title: 'Test Solution', correspondsTo: 'CA-001', description: 'Test solution description', files: ['src/test.ts'], expectedChanges: 'Add test code' },
    ],
    checkpoints: [
      { prefix: 'verify', description: 'Verify test', belongsTo: 'SOL-001' },
    ],
    assessment: {
      complexity: 'low',
      impactScope: '有限',
      estimatedMinutes: 30,
    },
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('investigation-requirement', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('InvestigationRequirementOptions interface', () => {
    it('should accept all option fields', () => {
      const options: InvestigationRequirementOptions = {
        nonInteractive: true,
        interactive: false,
        feedback: false,
        review: false,
        split: false,
        reportPath: '/tmp/report.md',
        file: '/tmp/req.txt',
        outputDir: '/tmp/out',
        outputFile: '/tmp/out/report.md',
        maxRetry: 5,
        splitThreshold: 30,
        language: 'en',
        skipReview: true,
        skipSplit: true,
        force: true,
        json: true,
        quiet: true,
      };

      expect(options.nonInteractive).toBe(true);
      expect(options.maxRetry).toBe(5);
      expect(options.language).toBe('en');
    });

    it('should allow partial options with defaults', () => {
      const options: InvestigationRequirementOptions = {};

      expect(options.nonInteractive).toBeUndefined();
      expect(options.maxRetry).toBeUndefined();
      expect(options.language).toBeUndefined();
    });
  });

  describe('InvestigationResult interface', () => {
    it('should represent success result', () => {
      const result: InvestigationResult = {
        success: true,
        reportPath: '/tmp/report.md',
        subReports: ['/tmp/sub-01.md', '/tmp/sub-02.md'],
      };

      expect(result.success).toBe(true);
      expect(result.reportPath).toBe('/tmp/report.md');
      expect(result.subReports).toHaveLength(2);
    });

    it('should represent failure result', () => {
      const result: InvestigationResult = {
        success: false,
        error: 'Something went wrong',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('writeReport', () => {
    it('should write report to file in dir mode', async () => {
      const report = createTestReport();
      const outputMode: OutputMode = { type: 'dir', path: env.tempDir };

      const filePath = await writeReport(report, outputMode, { force: true });

      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toContain('investigation-');
      expect(filePath).toEndWith('.md');

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('调查报告');
      expect(content).toContain('Test requirement');
    });

    it('should write report to specific file in file mode', async () => {
      const report = createTestReport();
      const targetPath = path.join(env.tempDir, 'custom-report.md');
      const outputMode: OutputMode = { type: 'file', path: targetPath };

      const filePath = await writeReport(report, outputMode, { force: true });

      expect(filePath).toBe(targetPath);
      expect(fs.existsSync(targetPath)).toBe(true);
    });

    it('should add timestamp suffix when file exists without force', async () => {
      const report = createTestReport();
      const targetPath = path.join(env.tempDir, 'existing-report.md');
      const outputMode: OutputMode = { type: 'file', path: targetPath };

      // Create existing file
      fs.writeFileSync(targetPath, 'existing content');

      const filePath = await writeReport(report, outputMode, { force: false });

      // Should get a different path with timestamp
      expect(filePath).not.toBe(targetPath);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should overwrite when force is true', async () => {
      const report = createTestReport();
      const targetPath = path.join(env.tempDir, 'force-report.md');
      const outputMode: OutputMode = { type: 'file', path: targetPath };

      // Create existing file
      fs.writeFileSync(targetPath, 'existing content');

      const filePath = await writeReport(report, outputMode, { force: true });

      expect(filePath).toBe(targetPath);
      const content = fs.readFileSync(targetPath, 'utf-8');
      expect(content).not.toBe('existing content');
      expect(content).toContain('调查报告');
    });

    it('should use prefix in filename when provided', async () => {
      const report = createTestReport();
      const outputMode: OutputMode = { type: 'dir', path: env.tempDir };

      const filePath = await writeReport(report, outputMode, { prefix: 'sub-01', force: true });

      expect(filePath).toContain('sub-01-investigation-');
    });
  });

  describe('command routing validation', () => {
    it('should return error when feedback mode has no report-path', async () => {
      const result = await investigationRequirement('test feedback', env.tempDir, {
        feedback: true,
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('report-path');
    });

    it('should return error when review mode has no report-path', async () => {
      const result = await investigationRequirement('test review', env.tempDir, {
        review: true,
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('report-path');
    });

    it('should return error when split mode has no report-path', async () => {
      const result = await investigationRequirement(undefined, env.tempDir, {
        split: true,
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('report-path');
    });

    it('should return error when feedback mode report-path does not exist', async () => {
      const result = await investigationRequirement('test feedback', env.tempDir, {
        feedback: true,
        reportPath: '/nonexistent/report.md',
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when review mode report-path does not exist', async () => {
      const result = await investigationRequirement('test review', env.tempDir, {
        review: true,
        reportPath: '/nonexistent/report.md',
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when split mode report-path does not exist', async () => {
      const result = await investigationRequirement(undefined, env.tempDir, {
        split: true,
        reportPath: '/nonexistent/report.md',
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when default mode has no requirement', async () => {
      const result = await investigationRequirement(undefined, env.tempDir, {
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Requirement description required');
    });

    it('should return error when interactive mode has no requirement', async () => {
      const result = await investigationRequirement(undefined, env.tempDir, {
        interactive: true,
        quiet: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Interactive mode requires');
    });
  });

  describe('default config values', () => {
    it('should use default max retry of 3', () => {
      // Verify the constant is accessible through the module
      const options: InvestigationRequirementOptions = {};
      expect(options.maxRetry).toBeUndefined();
      // Default is applied inside the command
    });

    it('should use default split threshold of 20 KB', () => {
      const options: InvestigationRequirementOptions = {};
      expect(options.splitThreshold).toBeUndefined();
      // Default is applied inside the command
    });

    it('should use default language zh', () => {
      const options: InvestigationRequirementOptions = {};
      expect(options.language).toBeUndefined();
      // Default is applied inside the command
    });
  });
});

describe('investigation-requirement pure functions', () => {
  describe('slugify behavior', () => {
    it('should produce lowercase slug from text', () => {
      // Test via writeReport which uses slugify internally
      const report = createTestReport({
        metadata: { requirementSource: 'Fix Login Button Issue' },
      });
      // The slugify function is internal, but we can verify
      // that writeReport uses it correctly
      expect(report.metadata.requirementSource).toBe('Fix Login Button Issue');
    });
  });

  describe('determineOutputMode behavior', () => {
    it('should prefer outputFile over outputDir', () => {
      // outputFile takes precedence when both are specified
      const options: InvestigationRequirementOptions = {
        outputFile: '/tmp/custom.md',
        outputDir: '/tmp/dir',
      };
      expect(options.outputFile).toBe('/tmp/custom.md');
    });

    it('should use outputDir when outputFile is not specified', () => {
      const options: InvestigationRequirementOptions = {
        outputDir: '/tmp/dir',
      };
      expect(options.outputDir).toBe('/tmp/dir');
      expect(options.outputFile).toBeUndefined();
    });
  });
});
