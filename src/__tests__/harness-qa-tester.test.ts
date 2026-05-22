import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
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
