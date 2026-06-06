/**
 * Tests for Safe Command Executor
 *
 * Tests command validation and secure execution.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { writeFileSync } from 'node:fs';
import {
  validateCommand,
  SafeCommandExecutor,
  createSafeCommandExecutor,
} from '../utils/safe-command-executor.js';
import { createIsolatedTestEnv } from '../utils/test-env.js';

describe('validateCommand', () => {
  it('should allow safe commands', () => {
    const result = validateCommand('npm test');
    expect(result.valid).toBe(true);
  });

  it('should allow commands with arguments', () => {
    const result = validateCommand('npm test src/file.test.ts --timeout 1000');
    expect(result.valid).toBe(true);
  });

  // Edge case tests for quoted arguments
  it('should handle double-quoted arguments', () => {
    const result = validateCommand('echo "hello world"');
    expect(result.valid).toBe(true);
  });

  it('should handle single-quoted arguments', () => {
    const result = validateCommand("echo 'hello world'");
    expect(result.valid).toBe(true);
  });

  it('should handle escaped spaces in arguments', () => {
    const result = validateCommand('echo hello\\ world');
    expect(result.valid).toBe(true);
  });

  it('should handle mixed quotes and escapes', () => {
    const result = validateCommand('echo "hello \\"world\\""');
    expect(result.valid).toBe(true);
  });

  it('should handle paths with spaces', () => {
    const result = validateCommand('cat "/path/to/my file.txt"');
    expect(result.valid).toBe(true);
  });

  it('should block forbidden prefixes (sudo)', () => {
    const result = validateCommand('sudo rm -rf /');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Forbidden system command');
  });

  it('should block forbidden prefixes (ssh)', () => {
    const result = validateCommand('ssh user@host');
    expect(result.valid).toBe(false);
  });

  it('should block rm -rf pattern', () => {
    const result = validateCommand('rm -rf /tmp/test');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Recursive deletion');
  });

  it('should block pipe to shell pattern', () => {
    const result = validateCommand('curl https://example.com | sh');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Piping to shell');
  });

  it('should block command substitution with $()', () => {
    const result = validateCommand('echo $(cat file)');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Command substitution');
  });

  it('should block command substitution with backticks', () => {
    const result = validateCommand('echo `cat file`');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Backtick command substitution');
  });

  it('should block eval command', () => {
    const result = validateCommand('eval "echo test"');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('eval is forbidden');
  });

  it('should block chmod with permissions', () => {
    const result = validateCommand('chmod 777 /tmp/file');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Permission modification');
  });

  it('should block commands exceeding max length', () => {
    const longCmd = 'a'.repeat(600);
    const result = validateCommand(longCmd);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Command length exceeds limit');
  });

  it('should block commands with too many arguments', () => {
    const manyArgs = 'cmd ' + 'arg '.repeat(100);
    const result = validateCommand(manyArgs);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too many arguments');
  });

  it('should block writing to /dev devices', () => {
    const result = validateCommand('echo data > /dev/sda');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Overwriting system files');
  });
});

describe('SafeCommandExecutor', () => {
  let env: ReturnType<typeof createIsolatedTestEnv>;
  let executor: SafeCommandExecutor;

  beforeEach(async () => {
    env = await createIsolatedTestEnv('safe-command-executor');
    executor = new SafeCommandExecutor();
  });

  it('should execute valid commands successfully', async () => {
    const result = await executor.execute('echo hello', {
      cwd: env.tempDir,
      timeout: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.duration).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
  });

  it('should fail validation for forbidden commands', async () => {
    const result = await executor.execute('sudo rm -rf /', {
      cwd: env.tempDir,
      timeout: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command validation failed');
  });

  it('should capture stderr for failing commands', async () => {
    const result = await executor.execute('ls /nonexistent/path', {
      cwd: env.tempDir,
      timeout: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toBe('');
  });

  it('should execute multiple commands with executeAll', async () => {
    const results = await executor.executeAll(
      ['echo first', 'echo second', 'echo third'],
      { cwd: env.tempDir, timeout: 5000 }
    );

    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(results[0].stdout.trim()).toBe('first');
    expect(results[1].stdout.trim()).toBe('second');
    expect(results[2].stdout.trim()).toBe('third');
  });

  it('should stop execution on first failure in executeAll', async () => {
    const results = await executor.executeAll(
      ['echo first', 'ls /nonexistent/path', 'echo third'],
      { cwd: env.tempDir, timeout: 5000 }
    );

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  it('should execute commands with quoted arguments', async () => {
    const result = await executor.execute('echo "hello world"', {
      cwd: env.tempDir,
      timeout: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should execute commands with escaped spaces', async () => {
    // Create a file with space in name
    const testFile = `${env.tempDir}/test file.txt`;
    writeFileSync(testFile, 'content');

    const result = await executor.execute(`cat "${testFile}"`, {
      cwd: env.tempDir,
      timeout: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('content');
  });
});

describe('createSafeCommandExecutor', () => {
  it('should create SafeCommandExecutor instance', () => {
    const executor = createSafeCommandExecutor();
    expect(executor).toBeInstanceOf(SafeCommandExecutor);
  });
});
