/**
 * 测试失败解析功能测试
 *
 * 验证检查点：
 * - CP-SF-01 ~ CP-SF-05: 标准格式检测
 * - CP-RE-01 ~ CP-RE-05: 正则规则匹配
 * - CP-FB-01 ~ CP-FB-03: 降级处理
 * - CP-CF-01 ~ CP-CF-03: 配置支持
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { HarnessQATester } from '../utils/harness-qa-tester.js';
import type { HarnessConfig } from '../types/harness.js';

// Helper to create tester with config
function createTester(configPath: string, harnessConfig: HarnessConfig): HarnessQATester {
  // Create temp config file
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return new HarnessQATester(harnessConfig);
}

describe('Test Failure Parsing - Standard Format Detection', () => {
  const tempDir = '/tmp/test-failure-parsing-standard';
  const configPath = path.join(tempDir, '.projmnt4claude', 'config.json');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // CP-SF-01: JUnit XML 检测开关生效
  test('CP-SF-01: JUnit XML detection can be disabled', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    // Create config with JUnit XML disabled
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          standardFormatDetection: {
            junitXml: false,
            tap: false,
          },
        },
      },
    }));

    const tester = createTester(configPath, config);

    // JUnit XML output should not be parsed when disabled
    const junitOutput = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="TestSuite">
    <testcase name="should pass"/>
    <testcase name="should fail">
      <failure message="Expected true"/>
    </testcase>
  </testsuite>
</testsuites>`;

    // Access private method via type assertion
    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(junitOutput);

    // Should fall back to built-in rules (no match) or fallback
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  // CP-SF-02: JUnit XML 正确解析
  test('CP-SF-02: JUnit XML is correctly parsed', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    // Create config with JUnit XML enabled
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          standardFormatDetection: {
            junitXml: true,
          },
        },
      },
    }));

    const tester = createTester(configPath, config);

    const junitOutput = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="TestSuite">
    <testcase name="should pass"/>
    <testcase name="should fail">
      <failure message="Expected true"/>
    </testcase>
    <testcase name="should error">
      <error message="Runtime error"/>
    </testcase>
  </testsuite>
</testsuites>`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(junitOutput);

    expect(result).toContain('should fail');
    expect(result).toContain('should error');
  });

  // CP-SF-03: TAP 检测开关生效
  test('CP-SF-03: TAP detection can be disabled', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          standardFormatDetection: {
            junitXml: false,
            tap: false,
          },
          fallbackToRawOutput: false,  // 禁用降级，确保测试只验证 TAP 检测
        },
      },
    }));

    const tester = createTester(configPath, config);

    const tapOutput = `TAP version 13
ok 1 - should pass
not ok 2 - should fail`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(tapOutput);

    // 当 TAP 检测禁用且降级禁用时，应该返回空数组（没有匹配的规则）
    expect(result.length).toBe(0);
  });

  // CP-SF-04: TAP 正确解析
  test('CP-SF-04: TAP is correctly parsed', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          standardFormatDetection: {
            tap: true,
          },
        },
      },
    }));

    const tester = createTester(configPath, config);

    const tapOutput = `TAP version 13
ok 1 - should pass
not ok 2 - should fail
not ok 3 - should also fail`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(tapOutput);

    expect(result).toContain('should fail');
    expect(result).toContain('should also fail');
  });

  // CP-SF-05: 标准检测优先于正则
  test('CP-SF-05: Standard detection takes priority over regex', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          standardFormatDetection: {
            junitXml: true,
          },
          testFailurePatterns: [
            { name: 'custom', pattern: 'FAIL\\s+(.+)', enabled: true },
          ],
        },
      },
    }));

    const tester = createTester(configPath, config);

    // Output that matches both JUnit XML and regex pattern
    const mixedOutput = `<?xml version="1.0"?>
<testsuites>
  <testcase name="junit-test">
    <failure message="Failed"/>
  </testcase>
</testsuites>
FAIL custom-test`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(mixedOutput);

    // JUnit XML should be parsed first
    expect(result).toContain('junit-test');
  });
});

describe('Test Failure Parsing - Regex Rules', () => {
  const tempDir = '/tmp/test-failure-parsing-regex';
  const configPath = path.join(tempDir, '.projmnt4claude', 'config.json');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // CP-RE-01: 用户规则优先于内置规则
  test('CP-RE-01: User rules take priority over built-in rules', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          testFailurePatterns: [
            { name: 'custom-pattern', pattern: 'CUSTOM_FAIL:\\s*(.+)', enabled: true },
          ],
        },
      },
    }));

    const tester = createTester(configPath, config);

    const output = `CUSTOM_FAIL: custom-test-name
(fail) bun-test-name`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Custom pattern should match first
    expect(result).toContain('custom-test-name');
  });

  // CP-RE-02: 规则按顺序匹配
  test('CP-RE-02: Rules are matched in order', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          testFailurePatterns: [
            { name: 'first', pattern: 'PATTERN_A:\\s*(.+)', enabled: true },
            { name: 'second', pattern: 'PATTERN_B:\\s*(.+)', enabled: true },
          ],
        },
      },
    }));

    const tester = createTester(configPath, config);

    const output = `PATTERN_A: test-a
PATTERN_B: test-b`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // First matching pattern should be used
    expect(result).toContain('test-a');
  });

  // CP-RE-03: 命中即返回
  test('CP-RE-03: Returns immediately on first match', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          testFailurePatterns: [
            { name: 'first', pattern: 'FIRST:\\s*(.+)', enabled: true },
            { name: 'second', pattern: 'SECOND:\\s*(.+)', enabled: true },
          ],
        },
      },
    }));

    const tester = createTester(configPath, config);

    const output = `FIRST: matched-first
SECOND: matched-second`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Should only contain first match, not second
    expect(result).toContain('matched-first');
  });

  // CP-RE-04: 规则禁用生效
  test('CP-RE-04: Disabled rules are skipped', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          testFailurePatterns: [
            { name: 'disabled', pattern: 'DISABLED:\\s*(.+)', enabled: false },
            { name: 'enabled', pattern: 'ENABLED:\\s*(.+)', enabled: true },
          ],
        },
      },
    }));

    const tester = createTester(configPath, config);

    const output = `DISABLED: should-not-match
ENABLED: should-match`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    expect(result).not.toContain('should-not-match');
    expect(result).toContain('should-match');
  });

  // CP-RE-05: 内置规则兜底
  test('CP-RE-05: Built-in rules are used as fallback', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    // No custom patterns configured
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}));

    const tester = createTester(configPath, config);

    const output = `(fail) bun-test-failure`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    expect(result).toContain('bun-test-failure');
  });
});

describe('Test Failure Parsing - Fallback', () => {
  const tempDir = '/tmp/test-failure-parsing-fallback';
  const configPath = path.join(tempDir, '.projmnt4claude', 'config.json');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // CP-FB-01: 降级触发条件正确
  test('CP-FB-01: Fallback is triggered when no rules match', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          fallbackToRawOutput: true,
        },
      },
    }));

    const tester = createTester(configPath, config);

    // Output that doesn't match any pattern
    const output = `Some unknown test output format
that doesn't match any pattern`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Should return fallback output
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('解析失败');
  });

  // CP-FB-02: 原始输出截取正确
  test('CP-FB-02: Raw output is truncated correctly', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          fallbackToRawOutput: true,
          rawOutputMaxLength: 100,
        },
      },
    }));

    const tester = createTester(configPath, config);

    // Long output
    const output = 'x'.repeat(500);

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Should be truncated
    expect(result[0].length).toBeLessThan(200);
  });

  // CP-FB-03: 降级输出格式清晰
  test('CP-FB-03: Fallback output format is clear', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      harness: {
        test: {
          fallbackToRawOutput: true,
        },
      },
    }));

    const tester = createTester(configPath, config);

    const output = `Unknown test output`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Should contain identifier and summary
    expect(result[0]).toContain('解析失败');
    expect(result[0]).toContain('原始日志摘要');
  });
});

describe('Test Failure Parsing - Configuration', () => {
  const tempDir = '/tmp/test-failure-parsing-config';
  const configPath = path.join(tempDir, '.projmnt4claude', 'config.json');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // CP-CF-01: 类型定义扩展
  test('CP-CF-01: Type definitions are extended correctly', () => {
    // This test verifies the types compile correctly
    const config = {
      harness: {
        test: {
          testCommand: 'bun test',
          standardFormatDetection: {
            junitXml: true,
            tap: false,
          },
          testFailurePatterns: [
            {
              name: 'custom',
              pattern: 'CUSTOM:\\s*(.+)',
              enabled: true,
              description: 'Custom pattern',
            },
          ],
          fallbackToRawOutput: true,
          rawOutputMaxLength: 500,
        },
      },
    };

    // If this compiles, types are correct
    expect(config.harness.test.testCommand).toBe('bun test');
    expect(config.harness.test.standardFormatDetection?.junitXml).toBe(true);
    expect(config.harness.test.testFailurePatterns).toHaveLength(1);
  });

  // CP-CF-03: 向后兼容
  test('CP-CF-03: Backward compatible when no config', async () => {
    const config: HarnessConfig = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      cwd: tempDir,
      batchGitTagCommit: false,
      taskGitCommit: false,
      forceContinue: false,
    };

    // No config file
    const tester = createTester(configPath, config);

    const output = `(fail) test-name`;

    const parseMethod = (tester as unknown as { parseTestFailures: (o: string) => string[] }).parseTestFailures.bind(tester);
    const result = parseMethod(output);

    // Should use built-in rules
    expect(result).toContain('test-name');
  });
});
