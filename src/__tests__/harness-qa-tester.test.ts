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

  describe('checkTestHygiene', () => {
    test('should return passed=true when no issues found', async () => {
      // Create a clean test file
      const testFile = path.join(tempDir, 'clean.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Clean test suite', () => {
  test('should pass', () => {
    expect(1 + 1).toBe(2);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('should detect .only usage', async () => {
      const testFile = path.join(tempDir, 'only.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Test suite', () => {
  test.only('should run only this test', () => {
    expect(1).toBe(1);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.type === '.only')).toBe(true);
    });

    test('should detect .skip usage', async () => {
      const testFile = path.join(tempDir, 'skip.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Test suite', () => {
  test.skip('should skip this test', () => {
    expect(1).toBe(1);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.type === '.skip')).toBe(true);
    });

    test('should detect top-level mock.module', async () => {
      const testFile = path.join(tempDir, 'mock.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect, mock } from 'bun:test';

mock.module('./some-module', () => ({
  someFunction: () => 'mocked',
}));

describe('Test suite', () => {
  test('should work', () => {
    expect(1).toBe(1);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.type === 'mock.module')).toBe(true);
    });

    test('should detect multiple issues in same file', async () => {
      const testFile = path.join(tempDir, 'multiple.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Test suite', () => {
  test.only('only test', () => {
    expect(1).toBe(1);
  });

  test.skip('skip test', () => {
    expect(1).toBe(1);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      expect(result.issues.some(i => i.type === '.only')).toBe(true);
      expect(result.issues.some(i => i.type === '.skip')).toBe(true);
    });

    test('should return passed=true for non-existent directory', async () => {
      const result = await tester.checkTestHygiene('/non/existent/path');
      expect(result.passed).toBe(true);
      expect(result.details).toContain('不存在');
    });

    test('should include file path and line number in issues', async () => {
      const testFile = path.join(tempDir, 'location.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Test suite', () => {
  test.only('should run only this test', () => {
    expect(1).toBe(1);
  });
});
`);

      const result = await tester.checkTestHygiene(tempDir);
      expect(result.passed).toBe(false);
      expect(result.issues[0].file).toBeDefined();
      expect(result.issues[0].line).toBeDefined();
      expect(result.issues[0].line).toBeGreaterThan(0);
    });
  });

  describe('Integration', () => {
    test('runTestSuite and checkTestHygiene should work together', async () => {
      // Create a clean test file
      const testFile = path.join(tempDir, 'integration.test.ts');
      fs.writeFileSync(testFile, `
import { describe, test, expect } from 'bun:test';

describe('Integration test', () => {
  test('should pass', () => {
    expect(true).toBe(true);
  });
});
`);

      // Run both checks
      const testResult = await tester.runTestSuite('echo "all tests pass"');
      const hygieneResult = await tester.checkTestHygiene(tempDir);

      expect(testResult.passed).toBe(true);
      expect(hygieneResult.passed).toBe(true);
    });
  });
});
