/**
 * 验证命令生成模块
 *
 * 基于检查点前缀 + 任务相关文件，生成 verification.commands。
 */

import type { ParsedCheckpoint } from './prefix-map.js';
import { existsSync } from 'node:fs';

/**
 * 根据检查点前缀和任务文件列表生成验证命令
 *
 * - test: 优先使用映射的测试文件，否则按描述模式匹配
 * - verify: 完整构建+测试
 * - review: git diff 查看变更
 * - implem/doc: 构建检查
 */
export function generateVerificationCommands(
  checkpoint: ParsedCheckpoint,
  taskFiles: string[],
): string[] {
  switch (checkpoint.prefix) {
    case 'test': {
      const testFiles = taskFiles
        .map(f => f.replace(/src\/(.*)\.ts$/, 'tests/$1.test.ts'))
        .filter(f => existsSync(f));
      return testFiles.length > 0
        ? [`bun test ${testFiles.join(' ')}`]
        : [`bun test --test-name-pattern="${checkpoint.description}"`];
    }
    case 'verify':
      return ['bun run build && bun test'];
    case 'review':
      return [`git diff HEAD -- ${taskFiles.join(' ')}`];
    case 'implem':
      return ['bun run build'];
    case 'doc':
      return ['bun run build'];
  }
}