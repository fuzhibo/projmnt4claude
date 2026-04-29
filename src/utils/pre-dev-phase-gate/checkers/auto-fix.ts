/**
 * Auto Fix - 自动修复工具
 * 提供通用的自动修复功能，用于清理重试上下文中的遗留问题
 *
 * 功能:
 * - 锁文件清理
 * - 开发报告归档
 * - 临时文件清理
 *
 * @module pre-dev-phase-gate/checkers/auto-fix
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AutoFixResult } from '../../../types/pre-dev-phase-gate.js';

/**
 * 临时文件模式
 */
const TEMP_FILE_PATTERNS = [
  /\.tmp$/i,
  /\.temp$/i,
  /^\.cache-/i,
  /^partial-/i,
  /^incomplete-/i,
  /~$/,
  /^#.*#$/,
];

/**
 * 锁文件名称
 */
const LOCK_FILE_NAMES = [
  'task.lock',
  '.claude.lock',
];

/**
 * 清理结果
 */
export interface CleanupResult {
  /** 清理的文件列表 */
  removed: string[];
  /** 清理失败的文件列表 */
  failed: string[];
}

/**
 * 清理锁文件
 * 删除所有残留的锁文件
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID（可选，用于查找任务特定的锁文件）
 * @returns 清理结果
 */
export async function cleanupLockFiles(
  cwd: string,
  taskId?: string
): Promise<AutoFixResult> {
  const startTime = Date.now();
  const result: CleanupResult = {
    removed: [],
    failed: [],
  };

  try {
    // 检查常见锁文件
    const lockFilesToCheck = [...LOCK_FILE_NAMES];

    if (taskId) {
      lockFilesToCheck.push(`.task-${taskId}.lock`);
    }

    for (const lockName of lockFilesToCheck) {
      const lockPath = path.join(cwd, lockName);
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          result.removed.push(lockName);
        }
      } catch (error) {
        result.failed.push(`${lockName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 检查任务目录中的锁文件
    if (taskId) {
      const taskDir = path.join(cwd, '.projmnt4claude', 'tasks', taskId);
      if (fs.existsSync(taskDir)) {
        const files = fs.readdirSync(taskDir);
        for (const file of files) {
          if (file.endsWith('.lock')) {
            const lockPath = path.join(taskDir, file);
            try {
              fs.unlinkSync(lockPath);
              result.removed.push(file);
            } catch (error) {
              result.failed.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
    }

    const success = result.failed.length === 0;
    return {
      success,
      message: success
        ? `成功清理 ${result.removed.length} 个锁文件`
        : `清理完成: ${result.removed.length} 个成功, ${result.failed.length} 个失败`,
      details: {
        removed: result.removed,
        failed: result.failed,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `清理锁文件失败: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * 归档开发报告
 * 将旧报告移动到 reports/archive/ 目录
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID
 * @param currentAttempt - 当前尝试次数
 * @returns 归档结果
 */
export async function archiveDevReport(
  cwd: string,
  taskId: string,
  currentAttempt: number
): Promise<AutoFixResult> {
  const startTime = Date.now();

  try {
    const reportDir = path.join(cwd, '.projmnt4claude', 'reports', 'dev');
    const reportPath = path.join(reportDir, `${taskId}-dev-report.json`);
    const archiveDir = path.join(cwd, '.projmnt4claude', 'reports', 'archive');

    // 检查报告是否存在
    if (!fs.existsSync(reportPath)) {
      return {
        success: true,
        message: '没有需要归档的开发报告',
        details: { reportPath },
      };
    }

    // 读取旧报告获取attempt信息
    let oldAttempt = 0;
    try {
      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(reportContent);
      oldAttempt = report.metadata?.attempt || 0;
    } catch {
      oldAttempt = 0;
    }

    // 确保归档目录存在
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // 生成归档文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `${taskId}-dev-report-attempt${oldAttempt}-${timestamp}.json`;
    const archivePath = path.join(archiveDir, archiveName);

    // 移动文件到归档
    fs.renameSync(reportPath, archivePath);

    return {
      success: true,
      message: `成功归档开发报告 (attempt ${oldAttempt}) 到 ${archivePath}`,
      details: {
        archived: true,
        oldAttempt,
        currentAttempt,
        archivePath,
        originalPath: reportPath,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `归档开发报告失败: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * 创建新的开发报告
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID
 * @param attempt - 当前尝试次数
 * @param isResumed - 是否从恢复状态开始
 * @returns 创建结果
 */
export async function createNewDevReport(
  cwd: string,
  taskId: string,
  attempt: number,
  isResumed: boolean
): Promise<AutoFixResult> {
  const startTime = Date.now();

  try {
    const reportDir = path.join(cwd, '.projmnt4claude', 'reports', 'dev');
    const reportPath = path.join(reportDir, `${taskId}-dev-report.json`);

    // 确保目录存在
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // 创建新报告
    const newReport = {
      taskId,
      attempt,
      startTime: new Date().toISOString(),
      phases: {},
      metadata: {
        attempt,
        isResumed,
        createdAt: new Date().toISOString(),
      },
    };

    fs.writeFileSync(reportPath, JSON.stringify(newReport, null, 2));

    return {
      success: true,
      message: `成功创建新的开发报告 (attempt ${attempt})`,
      details: {
        reportPath,
        attempt,
        isResumed,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `创建开发报告失败: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * 归档并创建新的开发报告
 * 组合操作：先归档旧报告，再创建新报告
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID
 * @param currentAttempt - 当前尝试次数
 * @param isResumed - 是否从恢复状态开始
 * @returns 操作结果
 */
export async function resetDevReport(
  cwd: string,
  taskId: string,
  currentAttempt: number,
  isResumed: boolean
): Promise<AutoFixResult> {
  const startTime = Date.now();

  try {
    // 先归档旧报告
    const archiveResult = await archiveDevReport(cwd, taskId, currentAttempt);

    // 创建新报告
    const createResult = await createNewDevReport(cwd, taskId, currentAttempt, isResumed);

    if (!createResult.success) {
      return createResult;
    }

    const archived = archiveResult.details?.archived as boolean;

    return {
      success: true,
      message: archived
        ? `成功归档旧报告并创建新报告 (attempt ${currentAttempt})`
        : `成功创建新报告 (attempt ${currentAttempt})`,
      details: {
        archived,
        oldAttempt: archiveResult.details?.oldAttempt,
        newAttempt: currentAttempt,
        archiveResult: archived ? archiveResult.details : undefined,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `重置开发报告失败: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * 清理临时文件
 * 删除所有匹配临时文件模式的文件
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID（可选，用于查找任务目录中的临时文件）
 * @returns 清理结果
 */
export async function cleanupTempFiles(
  cwd: string,
  taskId?: string
): Promise<AutoFixResult> {
  const startTime = Date.now();
  const result: CleanupResult = {
    removed: [],
    failed: [],
  };

  try {
    // 清理根目录的临时文件
    const rootFiles = fs.readdirSync(cwd);
    for (const file of rootFiles) {
      const filePath = path.join(cwd, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const isTemp = TEMP_FILE_PATTERNS.some(pattern => pattern.test(file));
        if (isTemp) {
          try {
            fs.unlinkSync(filePath);
            result.removed.push(file);
          } catch (error) {
            result.failed.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // 清理任务目录的临时文件
    if (taskId) {
      const taskDir = path.join(cwd, '.projmnt4claude', 'tasks', taskId);
      if (fs.existsSync(taskDir)) {
        const files = fs.readdirSync(taskDir);
        for (const file of files) {
          const filePath = path.join(taskDir, file);
          const stat = fs.statSync(filePath);

          if (stat.isFile()) {
            const isTemp = TEMP_FILE_PATTERNS.some(pattern => pattern.test(file));
            if (isTemp) {
              try {
                fs.unlinkSync(filePath);
                result.removed.push(`.projmnt4claude/tasks/${taskId}/${file}`);
              } catch (error) {
                result.failed.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        }
      }
    }

    const success = result.failed.length === 0;
    return {
      success,
      message: success
        ? `成功清理 ${result.removed.length} 个临时文件`
        : `清理完成: ${result.removed.length} 个成功, ${result.failed.length} 个失败`,
      details: {
        removed: result.removed,
        failed: result.failed,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `清理临时文件失败: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * 全面清理
 * 执行所有清理操作（锁文件、临时文件、开发报告重置）
 *
 * @param cwd - 工作目录
 * @param taskId - 任务ID
 * @param attempt - 当前尝试次数
 * @param isResumed - 是否从恢复状态开始
 * @returns 综合清理结果
 */
export async function fullCleanup(
  cwd: string,
  taskId: string,
  attempt: number,
  isResumed: boolean
): Promise<AutoFixResult> {
  const startTime = Date.now();
  const results: {
    lockFiles: AutoFixResult | null;
    tempFiles: AutoFixResult | null;
    devReport: AutoFixResult | null;
  } = {
    lockFiles: null,
    tempFiles: null,
    devReport: null,
  };

  try {
    // 清理锁文件
    results.lockFiles = await cleanupLockFiles(cwd, taskId);

    // 清理临时文件
    results.tempFiles = await cleanupTempFiles(cwd, taskId);

    // 重置开发报告
    results.devReport = await resetDevReport(cwd, taskId, attempt, isResumed);

    const allSuccess =
      results.lockFiles.success &&
      results.tempFiles.success &&
      results.devReport.success;

    return {
      success: allSuccess,
      message: allSuccess
        ? '全面清理完成：所有检查项均已处理'
        : '清理完成，但部分操作失败',
      details: {
        lockFiles: results.lockFiles.details,
        tempFiles: results.tempFiles.details,
        devReport: results.devReport.details,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `全面清理失败: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        results,
        error: String(error),
        duration: Date.now() - startTime,
      },
    };
  }
}
