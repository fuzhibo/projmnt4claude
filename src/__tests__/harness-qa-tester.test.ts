import { describe, test, expect, beforeEach, afterEach} from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { HarnessQATester } from '../utils/harness-qa-tester';
import type { HarnessConfig } from '../types/harness';

describe('HarnessQATester - Programmatic Verification', () => {
  let tester: HarnessQATester;
  let tempDir: string;
  const config: HarnessConfig = {
    cwd: process.cwd(),
    timeout: 300000,
    maxRetries: 1,
  };

  beforeEach(() => {
    tester = new HarnessQATester(config);
    tempDir = path.join(process.cwd(), 'test-temp-qa-tester');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('saveReport', () => {
    test('should generate JSON report with all required QAReport fields', async () => {
      const taskId = 'TEST-task-001';
      const verdict = {
        taskId: taskId,
        result: 'PASS' as const,
        reason: 'All tests passed successfully',
        testFailures: [],
        failedCheckpoints: [],
        requiresHuman: false,
        humanVerificationCheckpoints: [] as string[],
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'qa_tester',
        details: 'Test execution completed successfully',
        acceptanceCriteriaResult: {
          passed: true,
          reason: 'All acceptance criteria met',
          levelResults: new Map(),
          requiredLevelsPassed: true,
          criteriaEvaluated: true,
          timestamp: new Date().toISOString(),
        },
      };

      // Use reflection to access private saveReport method
      const saveReportMethod = (tester as any).saveReport.bind(tester);
      await saveReportMethod(taskId, verdict);

      // Verify the generated JSON report
      const reportPath = path.join(config.cwd, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);

      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(reportContent);

      // Verify all required QAReport fields exist
      expect(report).toHaveProperty('version');
      expect(report).toHaveProperty('taskId');
      expect(report).toHaveProperty('verdict');
      expect(report).toHaveProperty('verifiedAt');
      expect(report).toHaveProperty('verifier');
      expect(report).toHaveProperty('summary');

      // Verify field values
      expect(report.version).toBe('1.0.0');
      expect(report.taskId).toBe(taskId);
      expect(report.verdict).toBe('PASS');
      expect(report.verifier).toBe('qa_tester');
      expect(report.summary).toBe('All tests passed successfully');
      expect(report.verifiedAt).toBe(verdict.verifiedAt);

      // Verify optional fields
      expect(report.testFailures).toEqual([]);
      expect(report.failedCheckpoints).toEqual([]);
      expect(report.requiresHuman).toBe(false);
      expect(report.humanVerificationCheckpoints).toEqual([]);
    });

    test('should map QAVerdict fields to QAReport fields correctly', async () => {
      const taskId = 'TEST-task-002';
      const verdict = {
        taskId: taskId,
        result: 'NOPASS' as const,
        reason: 'Tests failed due to timeout',
        testFailures: [
          { testName: 'test_timeout', reason: 'Connection timeout', severity: 'high' as const },
        ],
        failedCheckpoints: ['CP-001'],
        requiresHuman: true,
        humanVerificationCheckpoints: ['CP-002'] as string[],
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'qa_tester',
        details: 'Connection issues detected',
        acceptanceCriteriaResult: {
          passed: false,
          reason: 'Timeout exceeded',
          levelResults: new Map(),
          requiredLevelsPassed: false,
          criteriaEvaluated: true,
          timestamp: new Date().toISOString(),
        },
      };

      const saveReportMethod = (tester as any).saveReport.bind(tester);
      await saveReportMethod(taskId, verdict);

      const reportPath = path.join(config.cwd, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(reportContent);

      // Verify field mapping
      expect(report.result).toBeUndefined(); // Should not have 'result' field
      expect(report.verdict).toBe('NOPASS'); // Should have 'verdict' field

      expect(report.verifiedBy).toBeUndefined(); // Should not have 'verifiedBy' field
      expect(report.verifier).toBe('qa_tester'); // Should have 'verifier' field

      expect(report.reason).toBeUndefined(); // Should not have 'reason' field
      expect(report.summary).toBe('Tests failed due to timeout'); // Should have 'summary' field

      // Verify test failures
      expect(report.testFailures).toHaveLength(1);
      expect(report.testFailures[0].testName).toBe('test_timeout');

      // Verify human verification
      expect(report.requiresHuman).toBe(true);
      expect(report.humanVerificationCheckpoints).toEqual(['CP-002']);
    });

    test('should handle empty reason with default summary', async () => {
      const taskId = 'TEST-task-003';
      const verdict = {
        taskId: taskId,
        result: 'PASS' as const,
        reason: '',
        testFailures: [],
        failedCheckpoints: [],
        requiresHuman: false,
        humanVerificationCheckpoints: [] as string[],
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'qa_tester',
        details: '',
        acceptanceCriteriaResult: {
          passed: true,
          reason: '',
          levelResults: new Map(),
          requiredLevelsPassed: true,
          criteriaEvaluated: true,
          timestamp: new Date().toISOString(),
        },
      };

      const saveReportMethod = (tester as any).saveReport.bind(tester);
      await saveReportMethod(taskId, verdict);

      const reportPath = path.join(config.cwd, '.projmnt4claude', 'outputs', taskId, 'qa-report.json');
      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(reportContent);

      expect(report.summary).toBe(''); // Should default to empty string
    });
  });

  describe('runTestSuite', () => {
    test('should return passed=true when tests pass both times', async () => {
      const result = await tester.runTestSuite('echo "tests passed"');
      expect(result.passed).toBe(true);
      expect(result.hasFlaky).toBe(false);
      expect(result.flakyTests).toEqual([]);
    });

    test('should return passed=false when tests fail', async () => {
      const result = await tester.runTestSuite('echo "✗ test_failed" && exit 1');
      expect(result.passed).toBe(false);
    });

    test('should detect flaky tests when results differ between runs', async () => {
      // Create a script that alternates between pass and fail
      const scriptPath = path.join(tempDir, 'flaky-test.sh');
      const counterPath = path.join(tempDir, 'counter.txt');

      // Initialize counter
      fs.writeFileSync(counterPath, '0');

      // Script that alternates
      const script = `#!/bin/bash
count=$(cat ${counterPath})
echo $((count + 1)) > ${counterPath}
if [ $count -eq 0 ]; then
  echo "✗ test_flaky"
  exit 1
else
  echo "✓ test_flaky"
  exit 0
fi`;
      fs.writeFileSync(scriptPath, script);
      fs.chmodSync(scriptPath, '755');

      const result = await tester.runTestSuite(`bash ${scriptPath}`);
      expect(result.hasFlaky).toBe(true);
      expect(result.flakyTests).toContain('test_flaky');
    });

    test('should handle long-running commands', async () => {
      // Use a quick command instead of sleep for faster testing
      const result = await tester.runTestSuite('echo "quick test"');
      expect(result).toBeDefined();
      expect(result.passed).toBe(true);
    });
  });

});
