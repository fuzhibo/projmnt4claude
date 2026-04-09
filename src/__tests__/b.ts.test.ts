/**
 * file-utils.ts 单元测试
 * 测试文件操作工具函数
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  copyTemplateFiles,
  ensureDirectory,
  listDirectoryFiles,
  writeJsonFile,
  readJsonFile,
} from '../utils/file-utils';

describe('copyTemplateFiles 复制模板文件', () => {
  const testDir = path.join(process.cwd(), 'test-temp', 'copy-template-test');
  const sourceDir = path.join(testDir, 'source');
  const targetDir = path.join(testDir, 'target');

  beforeEach(() => {
    // 清理并创建测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('成功复制模板文件', () => {
    // 创建源文件
    fs.writeFileSync(path.join(sourceDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(sourceDir, 'file2.txt'), 'content2');

    const copied = copyTemplateFiles(sourceDir, targetDir);

    expect(copied).toHaveLength(2);
    expect(fs.existsSync(path.join(targetDir, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'file2.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'file1.txt'), 'utf-8')).toBe('content1');
  });

  test('递归复制子目录', () => {
    const subDir = path.join(sourceDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'nested.txt'), 'nested content');

    const copied = copyTemplateFiles(sourceDir, targetDir);

    expect(copied).toHaveLength(1);
    expect(fs.existsSync(path.join(targetDir, 'subdir', 'nested.txt'))).toBe(true);
  });

  test('源目录不存在时返回空数组', () => {
    const nonExistentSource = path.join(testDir, 'non-existent');

    const copied = copyTemplateFiles(nonExistentSource, targetDir);

    expect(copied).toHaveLength(0);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  test('目标目录已存在时仍正常复制', () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'existing.txt'), 'existing');
    fs.writeFileSync(path.join(sourceDir, 'new.txt'), 'new content');

    const copied = copyTemplateFiles(sourceDir, targetDir);

    expect(copied).toHaveLength(1);
    expect(fs.existsSync(path.join(targetDir, 'new.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'existing.txt'))).toBe(true);
  });
});

describe('ensureDirectory 确保目录存在', () => {
  const testDir = path.join(process.cwd(), 'test-temp', 'ensure-dir-test');

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('目录不存在时创建', () => {
    const newDir = path.join(testDir, 'new-directory');

    const result = ensureDirectory(newDir);

    expect(result).toBe(true);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  test('目录已存在时返回 true', () => {
    fs.mkdirSync(testDir, { recursive: true });

    const result = ensureDirectory(testDir);

    expect(result).toBe(true);
  });

  test('递归创建嵌套目录', () => {
    const nestedDir = path.join(testDir, 'level1', 'level2', 'level3');

    const result = ensureDirectory(nestedDir);

    expect(result).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});

describe('listDirectoryFiles 列出目录文件', () => {
  const testDir = path.join(process.cwd(), 'test-temp', 'list-files-test');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('列出目录文件', () => {
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content2');

    const files = listDirectoryFiles(testDir);

    expect(files).toHaveLength(2);
    expect(files).toContain('file1.txt');
    expect(files).toContain('file2.txt');
  });

  test('空目录返回空数组', () => {
    const files = listDirectoryFiles(testDir);

    expect(files).toEqual([]);
  });

  test('目录不存在时返回空数组', () => {
    const nonExistentDir = path.join(testDir, 'non-existent');

    const files = listDirectoryFiles(nonExistentDir);

    expect(files).toEqual([]);
  });

  test('递归列出子目录文件', () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'root.txt'), 'root');
    fs.writeFileSync(path.join(subDir, 'nested.txt'), 'nested');

    const files = listDirectoryFiles(testDir, { recursive: true });

    expect(files).toHaveLength(2);
    expect(files).toContain('root.txt');
    expect(files).toContain(path.join('subdir', 'nested.txt'));
  });

  test('返回绝对路径', () => {
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'content');

    const files = listDirectoryFiles(testDir, { absolute: true });

    expect(files).toHaveLength(1);
    expect(files[0]).toBe(path.join(testDir, 'file.txt'));
  });

  test('包含目录项', () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'content');

    const files = listDirectoryFiles(testDir, { includeDirs: true });

    expect(files).toHaveLength(2);
    expect(files).toContain('file.txt');
    expect(files).toContain('subdir');
  });
});

describe('writeJsonFile 写入 JSON 文件', () => {
  const testDir = path.join(process.cwd(), 'test-temp', 'write-json-test');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('成功写入 JSON 文件', () => {
    const filePath = path.join(testDir, 'data.json');
    const data = { name: 'test', value: 123 };

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  test('格式化输出', () => {
    const filePath = path.join(testDir, 'formatted.json');
    const data = { name: 'test' };

    writeJsonFile(filePath, data, { pretty: true, space: 2 });

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('\n');
    expect(content).toContain('  ');
  });

  test('紧凑格式输出', () => {
    const filePath = path.join(testDir, 'compact.json');
    const data = { name: 'test' };

    writeJsonFile(filePath, data, { pretty: false });

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('\n  ');
  });

  test('循环引用处理', () => {
    const filePath = path.join(testDir, 'circular.json');
    const data: Record<string, unknown> = { name: 'test' };
    data.self = data; // 创建循环引用

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[Circular Reference]');
  });

  test('自动创建父目录', () => {
    const filePath = path.join(testDir, 'level1', 'level2', 'data.json');
    const data = { test: true };

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('数组数据写入', () => {
    const filePath = path.join(testDir, 'array.json');
    const data = [1, 2, 3, 'test'];

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  test('嵌套对象写入', () => {
    const filePath = path.join(testDir, 'nested.json');
    const data = { level1: { level2: { value: 'deep' } } };

    const result = writeJsonFile(filePath, data);

    expect(result).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });
});

describe('readJsonFile 读取 JSON 文件', () => {
  const testDir = path.join(process.cwd(), 'test-temp', 'read-json-test');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('成功读取 JSON 文件', () => {
    const filePath = path.join(testDir, 'data.json');
    const data = { name: 'test', value: 123 };
    fs.writeFileSync(filePath, JSON.stringify(data));

    const result = readJsonFile(filePath);

    expect(result).toEqual(data);
  });

  test('文件不存在返回 null', () => {
    const filePath = path.join(testDir, 'non-existent.json');

    const result = readJsonFile(filePath);

    expect(result).toBeNull();
  });

  test('无效 JSON 格式处理', () => {
    const filePath = path.join(testDir, 'invalid.json');
    fs.writeFileSync(filePath, 'not valid json {{{');

    const result = readJsonFile(filePath);

    expect(result).toBeNull();
  });

  test('读取数组 JSON', () => {
    const filePath = path.join(testDir, 'array.json');
    const data = [1, 2, 3, 'test'];
    fs.writeFileSync(filePath, JSON.stringify(data));

    const result = readJsonFile(filePath);

    expect(result).toEqual(data);
  });

  test('读取带类型的数据', () => {
    interface TestData {
      id: number;
      name: string;
    }
    const filePath = path.join(testDir, 'typed.json');
    const data: TestData = { id: 1, name: 'test' };
    fs.writeFileSync(filePath, JSON.stringify(data));

    const result = readJsonFile<TestData>(filePath);

    expect(result).toEqual(data);
    expect(result?.id).toBe(1);
    expect(result?.name).toBe('test');
  });

  test('读取空对象', () => {
    const filePath = path.join(testDir, 'empty.json');
    fs.writeFileSync(filePath, '{}');

    const result = readJsonFile(filePath);

    expect(result).toEqual({});
  });

  test('读取空数组', () => {
    const filePath = path.join(testDir, 'empty-array.json');
    fs.writeFileSync(filePath, '[]');

    const result = readJsonFile(filePath);

    expect(result).toEqual([]);
  });
});
