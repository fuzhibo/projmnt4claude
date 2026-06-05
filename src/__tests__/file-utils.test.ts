/**
 * file-utils 模块单元测试
 *
 * 测试文件操作工具函数
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import {
  copyTemplateFiles,
  ensureDirectory,
  listDirectoryFiles,
  writeJsonFile,
  readJsonFile,
} from '../utils/file-utils.js';

// ============================================================
// Tests
// ============================================================

describe('ensureDirectory', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  // --- Normal cases ---

  it('should create directory if it does not exist', () => {
    const newDir = path.join(env.tempDir, 'new-dir');
    expect(fs.existsSync(newDir)).toBe(false);

    const result = ensureDirectory(newDir);

    expect(result).toBe(true);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  it('should return true if directory already exists', () => {
    const existingDir = path.join(env.tempDir, 'existing');
    fs.mkdirSync(existingDir);

    const result = ensureDirectory(existingDir);

    expect(result).toBe(true);
  });

  it('should create nested directories', () => {
    const nestedDir = path.join(env.tempDir, 'a', 'b', 'c');

    const result = ensureDirectory(nestedDir);

    expect(result).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  // --- Edge cases ---

  it('should return false for invalid path (mocked scenario)', () => {
    // 测试一个不可能创建的路径（例如在文件上创建目录）
    const filePath = path.join(env.tempDir, 'file.txt');
    fs.writeFileSync(filePath, 'content');

    // 尝试在文件路径上创建目录会失败
    const result = ensureDirectory(filePath);
    // 由于文件存在且不是目录，应该返回 false
    expect(result).toBe(false);
  });
});

describe('copyTemplateFiles', () => {
  let env: IsolatedTestEnv;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
    sourceDir = path.join(env.tempDir, 'source');
    targetDir = path.join(env.tempDir, 'target');
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    env.cleanup();
  });

  // --- Normal cases ---

  it('should copy files from source to target', () => {
    fs.writeFileSync(path.join(sourceDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(sourceDir, 'file2.txt'), 'content2');

    const result = copyTemplateFiles(sourceDir, targetDir);

    expect(result.length).toBe(2);
    expect(fs.existsSync(path.join(targetDir, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'file2.txt'))).toBe(true);
  });

  it('should copy nested directories', () => {
    const nestedDir = path.join(sourceDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, 'file.txt'), 'nested content');

    const result = copyTemplateFiles(sourceDir, targetDir);

    expect(result.length).toBe(1);
    expect(fs.existsSync(path.join(targetDir, 'nested', 'file.txt'))).toBe(true);
  });

  it('should create target directory if it does not exist', () => {
    fs.writeFileSync(path.join(sourceDir, 'file.txt'), 'content');

    expect(fs.existsSync(targetDir)).toBe(false);

    copyTemplateFiles(sourceDir, targetDir);

    expect(fs.existsSync(targetDir)).toBe(true);
  });

  // --- Edge cases ---

  it('should return empty array if source does not exist', () => {
    const result = copyTemplateFiles('/non/existent/path', targetDir);

    expect(result).toEqual([]);
  });

  it('should handle empty source directory', () => {
    const result = copyTemplateFiles(sourceDir, targetDir);

    expect(result).toEqual([]);
    expect(fs.existsSync(targetDir)).toBe(true);
  });
});

describe('listDirectoryFiles', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  // --- Normal cases ---

  it('should list files in directory', () => {
    fs.writeFileSync(path.join(env.tempDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(env.tempDir, 'file2.txt'), 'content2');

    const result = listDirectoryFiles(env.tempDir);

    expect(result.length).toBe(2);
    expect(result.sort()).toEqual(['file1.txt', 'file2.txt']);
  });

  it('should return relative paths by default', () => {
    fs.writeFileSync(path.join(env.tempDir, 'file.txt'), 'content');

    const result = listDirectoryFiles(env.tempDir);

    expect(result[0]).toBe('file.txt');
  });

  it('should return absolute paths when absolute option is true', () => {
    fs.writeFileSync(path.join(env.tempDir, 'file.txt'), 'content');

    const result = listDirectoryFiles(env.tempDir, { absolute: true });

    expect(result[0]).toBe(path.join(env.tempDir, 'file.txt'));
  });

  // --- Recursive option ---

  it('should list files recursively when recursive option is true', () => {
    const nestedDir = path.join(env.tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(env.tempDir, 'root.txt'), 'root');
    fs.writeFileSync(path.join(nestedDir, 'nested.txt'), 'nested');

    const result = listDirectoryFiles(env.tempDir, { recursive: true });

    expect(result.length).toBe(2);
    expect(result.sort()).toEqual(['nested/nested.txt', 'root.txt']);
  });

  it('should not list nested files when recursive is false', () => {
    const nestedDir = path.join(env.tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(env.tempDir, 'root.txt'), 'root');
    fs.writeFileSync(path.join(nestedDir, 'nested.txt'), 'nested');

    const result = listDirectoryFiles(env.tempDir, { recursive: false });

    expect(result).toEqual(['root.txt']);
  });

  // --- Include directories option ---

  it('should include directories when includeDirs is true', () => {
    const nestedDir = path.join(env.tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(env.tempDir, 'file.txt'), 'content');

    const result = listDirectoryFiles(env.tempDir, { includeDirs: true });

    expect(result.sort()).toEqual(['file.txt', 'nested']);
  });

  it('should not include directories by default', () => {
    const nestedDir = path.join(env.tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(env.tempDir, 'file.txt'), 'content');

    const result = listDirectoryFiles(env.tempDir);

    expect(result).toEqual(['file.txt']);
  });

  // --- Edge cases ---

  it('should return empty array for non-existent directory', () => {
    const result = listDirectoryFiles('/non/existent/path');

    expect(result).toEqual([]);
  });

  it('should return empty array for empty directory', () => {
    const result = listDirectoryFiles(env.tempDir);

    expect(result).toEqual([]);
  });
});

describe('writeJsonFile', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  // --- Normal cases ---

  it('should write JSON file with pretty formatting by default', () => {
    const filePath = path.join(env.tempDir, 'test.json');
    const data = { name: 'test', value: 123 };

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('\n'); // Pretty printed
    expect(JSON.parse(content)).toEqual(data);
  });

  it('should write compact JSON when pretty is false', () => {
    const filePath = path.join(env.tempDir, 'test.json');
    const data = { name: 'test' };

    const result = writeJsonFile(filePath, data, { pretty: false });

    expect(result).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('{"name":"test"}');
  });

  it('should create parent directories if needed', () => {
    const filePath = path.join(env.tempDir, 'nested', 'dir', 'test.json');
    const data = { test: true };

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // --- Circular reference handling ---

  it('should handle circular references when handleCircular is true', () => {
    const filePath = path.join(env.tempDir, 'circular.json');
    const data: Record<string, unknown> = { name: 'test' };
    data.self = data; // Create circular reference

    const result = writeJsonFile(filePath, data, { handleCircular: true });

    expect(result).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[Circular Reference]');
  });

  // --- Edge cases ---

  it('should write primitive values', () => {
    const filePath = path.join(env.tempDir, 'primitive.json');

    expect(writeJsonFile(filePath, 'string')).toBe(true);
    expect(writeJsonFile(filePath, 123)).toBe(true);
    expect(writeJsonFile(filePath, true)).toBe(true);
    expect(writeJsonFile(filePath, null)).toBe(true);
  });

  it('should write arrays', () => {
    const filePath = path.join(env.tempDir, 'array.json');
    const data = [1, 2, 3, 'four'];

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toEqual(data);
  });
});

describe('readJsonFile', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  // --- Normal cases ---

  it('should read and parse JSON file', () => {
    const filePath = path.join(env.tempDir, 'test.json');
    const data = { name: 'test', value: 123 };
    fs.writeFileSync(filePath, JSON.stringify(data));

    const result = readJsonFile(filePath);

    expect(result).toEqual(data);
  });

  it('should return typed result with generic', () => {
    interface TestData {
      name: string;
      count: number;
    }
    const filePath = path.join(env.tempDir, 'typed.json');
    const data: TestData = { name: 'typed', count: 42 };
    fs.writeFileSync(filePath, JSON.stringify(data));

    const result = readJsonFile<TestData>(filePath);

    expect(result?.name).toBe('typed');
    expect(result?.count).toBe(42);
  });

  // --- Edge cases ---

  it('should return null for non-existent file', () => {
    const result = readJsonFile('/non/existent/file.json');

    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const filePath = path.join(env.tempDir, 'invalid.json');
    fs.writeFileSync(filePath, 'not valid json {{{');

    const result = readJsonFile(filePath);

    expect(result).toBeNull();
  });

  it('should read primitive values', () => {
    const filePath = path.join(env.tempDir, 'primitive.json');
    fs.writeFileSync(filePath, '"string value"');

    const result = readJsonFile(filePath);

    expect(result).toBe('string value');
  });

  it('should read arrays', () => {
    const filePath = path.join(env.tempDir, 'array.json');
    fs.writeFileSync(filePath, '[1, 2, 3]');

    const result = readJsonFile<number[]>(filePath);

    expect(result).toEqual([1, 2, 3]);
  });
});

describe('writeJsonFile / readJsonFile integration', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ createTasksDir: false, createProjectDir: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  it('should round-trip data correctly', () => {
    const filePath = path.join(env.tempDir, 'roundtrip.json');
    const originalData = {
      string: 'value',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      nested: { deep: 'value' },
    };

    writeJsonFile(filePath, originalData);
    const result = readJsonFile(filePath);

    expect(result).toEqual(originalData);
  });
});