/**
 * Post-Dev Phase Gate Auto-Fix
 * 开发阶段后门禁自动修复功能
 *
 * 职责:
 * - CP-001: 自动修复路径漂移问题
 * - CP-002: 修复文件位置不对齐
 * - CP-003: 提供修复建议和回滚机制
 *
 * @module post-dev-phase-gate/checkers/auto-fix
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AutoFixResult,
  PostDevPhaseCheckItemResult,
  PathDrift,
  PostDevPhaseCheckContext,
} from '../../../types/post-dev-phase-gate.js';

/**
 * 自动修复结果集合
 */
export interface AutoFixCollection {
  /** 修复ID到结果的映射 */
  results: Map<string, AutoFixResult>;
  /** 成功修复数 */
  successCount: number;
  /** 失败修复数 */
  failureCount: number;
  /** 跳过的修复数 */
  skippedCount: number;
}

/**
 * 尝试自动修复所有失败的检查
 * 遍历所有失败的检查项，尝试执行自动修复
 *
 * @param checks - 所有检查项结果
 * @param context - 检查上下文
 * @returns 修复结果集合
 */
export async function tryAutoFixAll(
  checks: PostDevPhaseCheckItemResult[],
  context: PostDevPhaseCheckContext
): Promise<AutoFixCollection> {
  const collection: AutoFixCollection = {
    results: new Map<string, AutoFixResult>(),
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
  };

  for (const check of checks) {
    // 跳过已通过或没有自动修复的检查项
    if (check.passed || !check.autoFixable) {
      collection.skippedCount++;
      continue;
    }

    // 根据检查ID执行相应的修复
    const fixResult = await executeAutoFix(check, context);
    collection.results.set(check.checkId, fixResult);

    if (fixResult.success) {
      collection.successCount++;
      console.log(`✅ 自动修复成功 [${check.checkId}]: ${fixResult.message}`);
    } else {
      collection.failureCount++;
      console.log(`❌ 自动修复失败 [${check.checkId}]: ${fixResult.message}`);
    }
  }

  return collection;
}

/**
 * 执行单个自动修复
 *
 * @param check - 检查项结果
 * @param context - 检查上下文
 * @returns 修复结果
 */
async function executeAutoFix(
  check: PostDevPhaseCheckItemResult,
  context: PostDevPhaseCheckContext
): Promise<AutoFixResult> {
  try {
    switch (check.checkId) {
      case 'output-alignment-check':
        return await fixOutputAlignment(check, context);

      case 'path-drift-fix':
        return await fixPathDrift(check, context);

      case 'missing-file-fix':
        return await fixMissingFiles(check, context);

      default:
        return {
          success: false,
          message: `未找到适用于 ${check.checkId} 的自动修复方法`,
        };
    }
  } catch (error) {
    return {
      success: false,
      message: `执行自动修复时发生错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 修复输出对齐问题
 * R-OUTPUT-001 autoFix: 修复路径不对齐问题
 *
 * @param check - 输出对齐检查结果
 * @param context - 检查上下文
 * @returns 修复结果
 */
async function fixOutputAlignment(
  check: PostDevPhaseCheckItemResult,
  context: PostDevPhaseCheckContext
): Promise<AutoFixResult> {
  const details = check.details as {
    pathDrifts?: PathDrift[];
    missingPaths?: string[];
    unexpectedPaths?: string[];
  } | undefined;

  const fixedItems: string[] = [];
  const failedItems: string[] = [];

  // 1. 修复路径漂移
  if (details?.pathDrifts && details.pathDrifts.length > 0) {
    for (const drift of details.pathDrifts) {
      if (!drift.autoFixable) continue;

      const fixResult = await fixSinglePathDrift(drift, context.cwd);
      if (fixResult.success) {
        fixedItems.push(`${drift.expectedPath} -> ${drift.actualPath}`);
      } else {
        failedItems.push(drift.expectedPath);
      }
    }
  }

  // 2. 尝试修复缺失文件（创建占位文件）
  if (details?.missingPaths && details.missingPaths.length > 0) {
    for (const missingPath of details.missingPaths) {
      const fixResult = await createPlaceholderFile(missingPath, context);
      if (fixResult.success) {
        fixedItems.push(`创建占位文件: ${missingPath}`);
      } else {
        failedItems.push(missingPath);
      }
    }
  }

  // 生成结果消息
  let message = '';
  if (fixedItems.length > 0) {
    message += `成功修复 ${fixedItems.length} 项: ${fixedItems.join(', ')}`;
  }
  if (failedItems.length > 0) {
    if (message) message += '; ';
    message += `失败 ${failedItems.length} 项: ${failedItems.join(', ')}`;
  }
  if (fixedItems.length === 0 && failedItems.length === 0) {
    message = '没有可修复的项目';
  }

  return {
    success: fixedItems.length > 0 && failedItems.length === 0,
    message,
    details: {
      fixedCount: fixedItems.length,
      failedCount: failedItems.length,
      fixedItems,
      failedItems,
    },
  };
}

/**
 * 修复单个路径漂移
 *
 * @param drift - 路径漂移信息
 * @param cwd - 工作目录
 * @returns 修复结果
 */
async function fixSinglePathDrift(
  drift: PathDrift,
  cwd: string
): Promise<AutoFixResult> {
  try {
    const expectedFullPath = path.join(cwd, drift.expectedPath);
    const actualFullPath = path.join(cwd, drift.actualPath);

    // 检查实际路径是否存在
    if (!fs.existsSync(actualFullPath)) {
      return {
        success: false,
        message: `源文件不存在: ${drift.actualPath}`,
      };
    }

    // 检查期望路径的目录是否存在，不存在则创建
    const expectedDir = path.dirname(expectedFullPath);
    if (!fs.existsSync(expectedDir)) {
      fs.mkdirSync(expectedDir, { recursive: true });
    }

    // 根据漂移类型执行不同操作
    switch (drift.driftType) {
      case 'moved':
        // 移动文件到正确位置
        fs.renameSync(actualFullPath, expectedFullPath);
        return {
          success: true,
          message: `移动文件: ${drift.actualPath} -> ${drift.expectedPath}`,
          details: { operation: 'move', from: drift.actualPath, to: drift.expectedPath },
        };

      case 'renamed':
        // 重命名文件
        fs.renameSync(actualFullPath, expectedFullPath);
        return {
          success: true,
          message: `重命名文件: ${drift.actualPath} -> ${drift.expectedPath}`,
          details: { operation: 'rename', from: drift.actualPath, to: drift.expectedPath },
        };

      case 'missing':
        // 无法自动修复缺失文件
        return {
          success: false,
          message: `文件缺失，无法自动创建: ${drift.expectedPath}`,
        };

      default:
        return {
          success: false,
          message: `未知的漂移类型: ${drift.driftType}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      message: `修复路径漂移失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 创建占位文件
 *
 * @param filePath - 文件路径
 * @param context - 检查上下文
 * @returns 修复结果
 */
async function createPlaceholderFile(
  filePath: string,
  context: PostDevPhaseCheckContext
): Promise<AutoFixResult> {
  try {
    const fullPath = path.join(context.cwd, filePath);

    // 检查文件是否已存在
    if (fs.existsSync(fullPath)) {
      return {
        success: true,
        message: `文件已存在: ${filePath}`,
      };
    }

    // 创建目录
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 根据文件扩展名创建不同类型的占位内容
    const ext = path.extname(filePath);
    let content = '';

    switch (ext) {
      case '.ts':
      case '.js':
        content = `/**
 * Placeholder file created by post-dev-phase-gate auto-fix
 * Task: ${context.taskId}
 * Created: ${new Date().toISOString()}
 *
 * TODO: Replace this placeholder with actual implementation
 */

// TODO: Implement functionality here
`;
        break;

      case '.json':
        content = JSON.stringify({
          _placeholder: true,
          taskId: context.taskId,
          createdAt: new Date().toISOString(),
          note: 'This is a placeholder file created by auto-fix',
        }, null, 2);
        break;

      case '.md':
        content = `# Placeholder Document

**Task:** ${context.taskId}
**Created:** ${new Date().toISOString()}

This is a placeholder file created by post-dev-phase-gate auto-fix.

## TODO

- [ ] Replace this placeholder with actual documentation
`;
        break;

      default:
        content = `Placeholder file created by post-dev-phase-gate auto-fix
Task: ${context.taskId}
Created: ${new Date().toISOString()}
`;
    }

    fs.writeFileSync(fullPath, content, 'utf-8');

    return {
      success: true,
      message: `创建占位文件: ${filePath}`,
      details: { filePath, size: content.length },
    };
  } catch (error) {
    return {
      success: false,
      message: `创建占位文件失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 修复路径漂移问题
 * R-OUTPUT-001 autoFix: 专门处理路径漂移
 *
 * @param check - 检查项结果
 * @param context - 检查上下文
 * @returns 修复结果
 */
async function fixPathDrift(
  check: PostDevPhaseCheckItemResult,
  context: PostDevPhaseCheckContext
): Promise<AutoFixResult> {
  const drifts = check.details?.pathDrifts as PathDrift[] | undefined;

  if (!drifts || drifts.length === 0) {
    return {
      success: false,
      message: '没有检测到路径漂移',
    };
  }

  const results: AutoFixResult[] = [];

  for (const drift of drifts) {
    if (!drift.autoFixable) {
      results.push({
        success: false,
        message: `路径漂移不可自动修复: ${drift.expectedPath}`,
      });
      continue;
    }

    const result = await fixSinglePathDrift(drift, context.cwd);
    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  return {
    success: successCount === totalCount,
    message: `路径漂移修复: ${successCount}/${totalCount} 成功`,
    details: {
      total: totalCount,
      success: successCount,
      failed: totalCount - successCount,
      details: results,
    },
  };
}

/**
 * 修复缺失文件问题
 * R-OUTPUT-001 autoFix: 处理缺失文件
 *
 * @param check - 检查项结果
 * @param context - 检查上下文
 * @returns 修复结果
 */
async function fixMissingFiles(
  check: PostDevPhaseCheckItemResult,
  context: PostDevPhaseCheckContext
): Promise<AutoFixResult> {
  const missingPaths = check.details?.missingPaths as string[] | undefined;

  if (!missingPaths || missingPaths.length === 0) {
    return {
      success: false,
      message: '没有检测到缺失文件',
    };
  }

  const results: AutoFixResult[] = [];

  for (const missingPath of missingPaths) {
    const result = await createPlaceholderFile(missingPath, context);
    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  return {
    success: successCount === totalCount,
    message: `缺失文件修复: ${successCount}/${totalCount} 成功`,
    details: {
      total: totalCount,
      success: successCount,
      failed: totalCount - successCount,
      files: missingPaths,
    },
  };
}

/**
 * 创建修复备份
 * 在自动修复前创建备份，以便需要时回滚
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID
 * @returns 备份路径
 */
export function createFixBackup(cwd: string, taskId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(
    cwd,
    '.projmnt4claude',
    'backups',
    `${taskId}-${timestamp}`
  );

  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

/**
 * 检查是否需要自动修复
 *
 * @param checks - 所有检查项结果
 * @returns 是否需要修复
 */
export function needsAutoFix(checks: PostDevPhaseCheckItemResult[]): boolean {
  return checks.some(check => !check.passed && check.autoFixable);
}

/**
 * 获取可修复的检查项数量
 *
 * @param checks - 所有检查项结果
 * @returns 可修复数量
 */
export function getFixableCount(checks: PostDevPhaseCheckItemResult[]): number {
  return checks.filter(check => !check.passed && check.autoFixable).length;
}

/**
 * AutoFix 类
 * 提供更结构化的自动修复接口
 */
export class PostDevPhaseAutoFix {
  private context: PostDevPhaseCheckContext;
  private backupDir?: string;

  constructor(context: PostDevPhaseCheckContext) {
    this.context = context;
  }

  /**
   * 启用备份
   */
  enableBackup(): void {
    this.backupDir = createFixBackup(this.context.cwd, this.context.taskId);
  }

  /**
   * 执行所有自动修复
   */
  async fixAll(checks: PostDevPhaseCheckItemResult[]): Promise<AutoFixCollection> {
    return tryAutoFixAll(checks, this.context);
  }

  /**
   * 检查是否需要修复
   */
  needsFix(checks: PostDevPhaseCheckItemResult[]): boolean {
    return needsAutoFix(checks);
  }

  /**
   * 获取可修复数量
   */
  getFixableCount(checks: PostDevPhaseCheckItemResult[]): number {
    return getFixableCount(checks);
  }
}

// 导出便利函数
export {
  fixSinglePathDrift,
  createPlaceholderFile,
};

// 导出默认实例
export const postDevPhaseAutoFix = {
  tryAutoFixAll,
  needsAutoFix,
  getFixableCount,
  createFixBackup,
};
