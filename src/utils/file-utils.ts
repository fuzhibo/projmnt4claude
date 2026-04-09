/**
 * 文件工具模块
 * 提供常用的文件操作功能，包括目录管理、文件读写、JSON处理等
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 复制模板文件到目标目录
 * @param sourceDir - 源模板目录
 * @param targetDir - 目标目录
 * @returns 复制成功的文件列表
 */
export function copyTemplateFiles(sourceDir: string, targetDir: string): string[] {
  const copiedFiles: string[] = [];

  // 源目录不存在时返回空数组
  if (!fs.existsSync(sourceDir)) {
    return copiedFiles;
  }

  // 确保目标目录存在
  ensureDirectory(targetDir);

  // 递归复制文件
  const copyRecursive = (src: string, dest: string): void => {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        ensureDirectory(destPath);
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        copiedFiles.push(destPath);
      }
    }
  };

  copyRecursive(sourceDir, targetDir);
  return copiedFiles;
}

/**
 * 确保目录存在，不存在时递归创建
 * @param dir - 目录路径
 * @returns 是否成功创建或目录已存在
 */
export function ensureDirectory(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 列出目录中的文件
 * @param dir - 目录路径
 * @param options - 选项
 * @returns 文件列表（相对路径或绝对路径）
 */
export function listDirectoryFiles(
  dir: string,
  options: {
    recursive?: boolean;
    absolute?: boolean;
    includeDirs?: boolean;
  } = {}
): string[] {
  const { recursive = false, absolute = false, includeDirs = false } = options;

  // 目录不存在时返回空数组
  if (!fs.existsSync(dir)) {
    return [];
  }

  const result: string[] = [];

  const listRecursive = (currentDir: string, prefix: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (includeDirs) {
          result.push(absolute ? fullPath : relativePath);
        }
        if (recursive) {
          listRecursive(fullPath, relativePath);
        }
      } else {
        result.push(absolute ? fullPath : relativePath);
      }
    }
  };

  listRecursive(dir, '');
  return result;
}

/**
 * 将数据写入 JSON 文件
 * @param filePath - 文件路径
 * @param data - 要写入的数据
 * @param options - 选项
 * @returns 是否写入成功
 */
export function writeJsonFile(
  filePath: string,
  data: unknown,
  options: {
    pretty?: boolean;
    space?: number;
    handleCircular?: boolean;
  } = {}
): boolean {
  const { pretty = true, space = 2, handleCircular = true } = options;

  try {
    // 确保父目录存在
    const parentDir = path.dirname(filePath);
    ensureDirectory(parentDir);

    // 处理循环引用
    let jsonString: string;
    if (handleCircular) {
      const seen = new WeakSet<object>();
      jsonString = JSON.stringify(
        data,
        (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular Reference]';
            }
            seen.add(value);
          }
          return value;
        },
        pretty ? space : undefined
      );
    } else {
      jsonString = JSON.stringify(data, null, pretty ? space : undefined);
    }

    fs.writeFileSync(filePath, jsonString, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取 JSON 文件
 * @param filePath - 文件路径
 * @returns 解析后的数据，失败时返回 null
 */
export function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
