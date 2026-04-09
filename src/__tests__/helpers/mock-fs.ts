/**
 * 文件系统 Mock 工具
 * 用于单元测试中模拟文件系统操作
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 虚拟文件系统条目
 */
export interface MockFsEntry {
  type: 'file' | 'directory';
  content?: string;
  children?: Map<string, MockFsEntry>;
}

/**
 * 文件系统 Mock 类
 * 提供内存中的虚拟文件系统，无需实际磁盘操作
 */
export class MockFs {
  private root: Map<string, MockFsEntry> = new Map();
  private cwd: string = '/mock';

  /**
   * 重置文件系统
   */
  reset(): void {
    this.root.clear();
    this.cwd = '/mock';
  }

  /**
   * 设置当前工作目录
   */
  setCwd(cwd: string): void {
    this.cwd = path.normalize(cwd);
  }

  /**
   * 获取当前工作目录
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * 创建目录
   */
  mkdirSync(dirPath: string, options?: { recursive?: boolean }): void {
    const normalizedPath = this.normalizePath(dirPath);
    const parts = normalizedPath.split('/').filter(Boolean);

    let current = this.root;
    for (const part of parts) {
      if (!current.has(part)) {
        current.set(part, {
          type: 'directory',
          children: new Map(),
        });
      }
      const entry = current.get(part)!;
      if (entry.type !== 'directory') {
        throw new Error(`ENOTDIR: not a directory, mkdir '${dirPath}'`);
      }
      current = entry.children!;
    }
  }

  /**
   * 写入文件
   */
  writeFileSync(filePath: string, content: string): void {
    const normalizedPath = this.normalizePath(filePath);
    const dir = path.dirname(normalizedPath);
    const basename = path.basename(normalizedPath);

    const parentDir = this.getDirectory(dir);
    if (!parentDir) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }

    parentDir.set(basename, {
      type: 'file',
      content,
    });
  }

  /**
   * 读取文件
   */
  readFileSync(filePath: string, encoding?: string): string | Buffer {
    const normalizedPath = this.normalizePath(filePath);
    const entry = this.getEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }

    if (entry.type !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, read`);
    }

    return encoding === 'utf-8' || encoding === 'utf8'
      ? entry.content!
      : Buffer.from(entry.content!);
  }

  /**
   * 检查文件是否存在
   */
  existsSync(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    return this.getEntry(normalizedPath) !== null;
  }

  /**
   * 读取目录
   */
  readdirSync(dirPath: string): string[] {
    const normalizedPath = this.normalizePath(dirPath);
    const entry = this.getEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`);
    }

    if (entry.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory, scandir '${dirPath}'`);
    }

    return Array.from(entry.children!.keys());
  }

  /**
   * 删除文件或目录
   */
  rmSync(targetPath: string, options?: { recursive?: boolean }): void {
    const normalizedPath = this.normalizePath(targetPath);
    const dir = path.dirname(normalizedPath);
    const basename = path.basename(normalizedPath);

    const parentDir = this.getDirectory(dir);
    if (!parentDir || !parentDir.has(basename)) {
      throw new Error(`ENOENT: no such file or directory, stat '${targetPath}'`);
    }

    const entry = parentDir.get(basename)!;
    if (entry.type === 'directory' && entry.children!.size > 0 && !options?.recursive) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${targetPath}'`);
    }

    parentDir.delete(basename);
  }

  /**
   * 获取文件状态
   */
  statSync(filePath: string): { isFile: () => boolean; isDirectory: () => boolean } {
    const normalizedPath = this.normalizePath(filePath);
    const entry = this.getEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
    }

    return {
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'directory',
    };
  }

  /**
   * 规范化路径
   */
  private normalizePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return path.normalize(inputPath);
    }
    return path.normalize(path.join(this.cwd, inputPath));
  }

  /**
   * 获取目录条目
   */
  private getDirectory(dirPath: string): Map<string, MockFsEntry> | null {
    if (dirPath === '/' || dirPath === '.') {
      return this.root;
    }

    const parts = dirPath.split('/').filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      if (!current.has(part)) {
        return null;
      }
      const entry = current.get(part)!;
      if (entry.type !== 'directory') {
        return null;
      }
      current = entry.children!;
    }

    return current;
  }

  /**
   * 获取文件/目录条目
   */
  private getEntry(filePath: string): MockFsEntry | null {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    const parentDir = this.getDirectory(dir);

    if (!parentDir) {
      return null;
    }

    return parentDir.get(basename) || null;
  }
}

/**
 * 创建文件系统 Mock 实例
 */
export function createMockFs(): MockFs {
  return new MockFs();
}

/**
 * 创建临时测试目录结构
 */
export function createTestProjectStructure(mockFs: MockFs, basePath: string = '/test-project'): void {
  // 创建项目目录结构
  mockFs.mkdirSync(`${basePath}/.projmnt4claude/tasks`, { recursive: true });
  mockFs.mkdirSync(`${basePath}/src/utils`, { recursive: true });
  mockFs.mkdirSync(`${basePath}/src/commands`, { recursive: true });
  mockFs.mkdirSync(`${basePath}/src/types`, { recursive: true });

  // 创建基本配置文件
  mockFs.writeFileSync(
    `${basePath}/package.json`,
    JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
  );
}

/**
 * 模拟 fs 模块的辅助函数
 */
export function mockFsModule(mockFs: MockFs): typeof fs {
  return {
    ...fs,
    mkdirSync: (path: string, options?: any) => mockFs.mkdirSync(path, options),
    writeFileSync: (path: string, content: string) => mockFs.writeFileSync(path, content),
    readFileSync: (path: string, encoding?: any) => mockFs.readFileSync(path, encoding) as any,
    existsSync: (path: string) => mockFs.existsSync(path),
    readdirSync: (path: string) => mockFs.readdirSync(path),
    rmSync: (path: string, options?: any) => mockFs.rmSync(path, options),
    statSync: (path: string) => mockFs.statSync(path) as any,
  } as typeof fs;
}
