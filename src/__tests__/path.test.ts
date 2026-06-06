/**
 * path 模块单元测试
 *
 * 测试项目路径相关的工具函数
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import {
  getProjectDir,
  getProjDir,
  ensureDir,
  isInitialized,
  getConfigPath,
  getTasksDir,
  getArchiveDir,
  getToolboxDir,
  getBinDir,
  getReportsDir,
  getLogsDir,
} from '../utils/path.js';

// ============================================================
// Tests
// ============================================================

describe('getProjectDir', () => {
  it('should return path with .projmnt4claude suffix', () => {
    const result = getProjectDir('/home/user/project');
    expect(result).toBe('/home/user/project/.projmnt4claude');
  });

  it('should use process.cwd() when no argument provided', () => {
    const result = getProjectDir();
    expect(result).toBe(path.join(process.cwd(), '.projmnt4claude'));
  });

  it('should handle relative paths', () => {
    const result = getProjectDir('./my-project');
    expect(result).toContain('.projmnt4claude');
    expect(result).toContain('my-project');
  });

  it('should handle empty string', () => {
    const result = getProjectDir('');
    expect(result).toBe(path.join('', '.projmnt4claude'));
  });
});

describe('getProjDir', () => {
  it('should be an alias for getProjectDir', () => {
    const cwd = '/test/path';
    expect(getProjDir(cwd)).toBe(getProjectDir(cwd));
  });
});

describe('ensureDir', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  it('should create directory if it does not exist', () => {
    const newDir = path.join(env.tempDir, 'new-directory');
    expect(fs.existsSync(newDir)).toBe(false);

    ensureDir(newDir);

    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  it('should not throw if directory already exists', () => {
    const existingDir = path.join(env.tempDir, 'existing');
    fs.mkdirSync(existingDir);

    expect(() => ensureDir(existingDir)).not.toThrow();
    expect(fs.existsSync(existingDir)).toBe(true);
  });

  it('should create nested directories', () => {
    const nestedDir = path.join(env.tempDir, 'level1', 'level2', 'level3');

    ensureDir(nestedDir);

    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});

describe('isInitialized', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory without using createIsolatedTestEnv
    // because isInitialized tests need to verify actual file system state
    // without mocking
    tempDir = path.join(
      __dirname,
      '..',
      '..',
      '.tmp',
      `path-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should return false when no config.json or tasks exist', () => {
    expect(isInitialized(tempDir)).toBe(false);
  });

  it('should return true when config.json exists', () => {
    const projectDir = getProjectDir(tempDir);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'config.json'), '{}');

    expect(isInitialized(tempDir)).toBe(true);
  });

  it('should return true when tasks directory has valid task', () => {
    const tasksDir = getTasksDir(tempDir);
    const taskDir = path.join(tasksDir, 'TASK-001');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'meta.json'), '{"id":"TASK-001"}');

    expect(isInitialized(tempDir)).toBe(true);
  });

  it('should return false when tasks directory has no valid tasks', () => {
    const tasksDir = getTasksDir(tempDir);
    const taskDir = path.join(tasksDir, 'TASK-001');
    fs.mkdirSync(taskDir, { recursive: true });
    // No meta.json, so not a valid task

    expect(isInitialized(tempDir)).toBe(false);
  });

  it('should use process.cwd() when no argument provided', () => {
    // This tests the default parameter behavior
    const result = isInitialized();
    expect(typeof result).toBe('boolean');
  });
});

describe('path getter functions', () => {
  const testCwd = '/test/project';

  describe('getConfigPath', () => {
    it('should return correct config.json path', () => {
      const result = getConfigPath(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'config.json'));
    });

    it('should use process.cwd() when no argument', () => {
      const result = getConfigPath();
      expect(result).toBe(path.join(process.cwd(), '.projmnt4claude', 'config.json'));
    });
  });

  describe('getTasksDir', () => {
    it('should return correct tasks directory path', () => {
      const result = getTasksDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'tasks'));
    });
  });

  describe('getArchiveDir', () => {
    it('should return correct archive directory path', () => {
      const result = getArchiveDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'archive'));
    });
  });

  describe('getToolboxDir', () => {
    it('should return correct toolbox directory path', () => {
      const result = getToolboxDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'toolbox'));
    });
  });

  describe('getBinDir', () => {
    it('should return correct bin directory path', () => {
      const result = getBinDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'bin'));
    });
  });

  describe('getReportsDir', () => {
    it('should return correct reports directory path', () => {
      const result = getReportsDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'reports'));
    });
  });

  describe('getLogsDir', () => {
    it('should return correct logs directory path', () => {
      const result = getLogsDir(testCwd);
      expect(result).toBe(path.join(testCwd, '.projmnt4claude', 'logs'));
    });
  });
});

describe('path consistency', () => {
  it('all path functions should use same base project directory', () => {
    const cwd = '/consistent/test';

    const projectDir = getProjectDir(cwd);
    const configPath = getConfigPath(cwd);
    const tasksDir = getTasksDir(cwd);
    const archiveDir = getArchiveDir(cwd);
    const toolboxDir = getToolboxDir(cwd);
    const binDir = getBinDir(cwd);
    const reportsDir = getReportsDir(cwd);
    const logsDir = getLogsDir(cwd);

    // All should be under projectDir
    expect(configPath.startsWith(projectDir)).toBe(true);
    expect(tasksDir.startsWith(projectDir)).toBe(true);
    expect(archiveDir.startsWith(projectDir)).toBe(true);
    expect(toolboxDir.startsWith(projectDir)).toBe(true);
    expect(binDir.startsWith(projectDir)).toBe(true);
    expect(reportsDir.startsWith(projectDir)).toBe(true);
    expect(logsDir.startsWith(projectDir)).toBe(true);
  });
});