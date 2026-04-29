/**
 * Retry Checker - 重试上下文检查器
 * 实现 P8 开发阶段前质量门禁的重试上下文相关规则
 *
 * 规则覆盖:
 * - R-RETRY-001: 遗留文件检查
 * - R-RETRY-002: 锁文件检查
 * - R-RETRY-003: 开发报告重置检查
 *
 * @module pre-dev-phase-gate/checkers/retry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
  AutoFixResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 遗留文件模式 (不含锁文件，锁文件由 checkLockFiles 专门处理)
 */
const LEGACY_FILE_PATTERNS = [
  /\.tmp$/i,
  /\.temp$/i,
  /^\.cache-/i,
  /^partial-/i,
  /^incomplete-/i,
];

/**
 * 锁文件名称
 */
const LOCK_FILE_NAMES = [
  'task.lock',
  '.claude.lock',
];

/**
 * R-RETRY-001: 遗留文件检查
 * 检查前次失败的遗留文件是否已清理
 * 仅在 context.attempt > 1 时适用
 */
export async function checkLegacyFiles(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  // 仅在重试时适用
  if (context.attempt <= 1 && !context.isResumed) {
    return {
      checkId: 'R-RETRY-001',
      checkName: '遗留文件检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '首次执行，跳过遗留文件检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const taskDir = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId);

    /**
     * 遗留文件条目，包含完整路径和显示名称
     */
    interface LegacyFileEntry {
      /** 完整文件路径 */
      fullPath: string;
      /** 显示名称 */
      displayName: string;
    }

    const legacyFiles: LegacyFileEntry[] = [];

    // 扫描任务目录
    if (fs.existsSync(taskDir)) {
      const files = fs.readdirSync(taskDir);
      for (const file of files) {
        const filePath = path.join(taskDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          // 检查是否匹配遗留文件模式
          const isLegacy = LEGACY_FILE_PATTERNS.some(pattern => pattern.test(file));
          if (isLegacy) {
            legacyFiles.push({ fullPath: filePath, displayName: file });
          }
        }
      }
    }

    const hasLegacyFiles = legacyFiles.length > 0;

    // 创建自动修复函数
    const autoFix = {
      description: `清理 ${legacyFiles.length} 个遗留文件`,
      fix: async (): Promise<AutoFixResult> => {
        try {
          const removed: string[] = [];
          const failed: string[] = [];

          for (const entry of legacyFiles) {
            try {
              if (fs.existsSync(entry.fullPath)) {
                fs.unlinkSync(entry.fullPath);
                removed.push(entry.displayName);
              }
            } catch (error) {
              failed.push(entry.displayName);
            }
          }

          return {
            success: failed.length === 0,
            message: failed.length === 0
              ? `成功清理 ${removed.length} 个遗留文件`
              : `清理完成: ${removed.length} 个成功, ${failed.length} 个失败`,
            details: { removed, failed },
          };
        } catch (error) {
          return {
            success: false,
            message: `清理遗留文件失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };

    return {
      checkId: 'R-RETRY-001',
      checkName: '遗留文件检查',
      ruleId: rule.id,
      passed: !hasLegacyFiles,
      severity: 'warning',
      message: hasLegacyFiles
        ? `发现 ${legacyFiles.length} 个遗留文件: ${legacyFiles.map(f => f.displayName).join(', ')}`
        : '未发现遗留文件',
      details: {
        legacyFiles: legacyFiles.map(f => f.displayName),
        attempt: context.attempt,
        isResumed: context.isResumed,
      },
      suggestions: hasLegacyFiles
        ? [
            '清理遗留临时文件',
            '检查 .cache-* 文件是否需要保留',
          ]
        : undefined,
      autoFixable: hasLegacyFiles,
      autoFix: hasLegacyFiles ? autoFix : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-RETRY-001',
      checkName: '遗留文件检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `检查遗留文件时出错: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-RETRY-002: 锁文件检查
 * 检查是否有残留的锁文件
 */
export async function checkLockFiles(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  // 仅在重试时适用
  if (context.attempt <= 1 && !context.isResumed) {
    return {
      checkId: 'R-RETRY-002',
      checkName: '锁文件检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '首次执行，跳过锁文件检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const foundLocks: { path: string; name: string }[] = [];

    // 检查常见锁文件位置
    const lockFilesToCheck = [
      ...LOCK_FILE_NAMES,
      `.task-${context.taskId}.lock`,
    ];

    for (const lockName of lockFilesToCheck) {
      const lockPath = path.join(context.cwd, lockName);
      if (fs.existsSync(lockPath)) {
        foundLocks.push({ path: lockPath, name: lockName });
      }
    }

    // 检查任务目录中的锁文件
    const taskDir = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId);
    if (fs.existsSync(taskDir)) {
      const files = fs.readdirSync(taskDir);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          const lockPath = path.join(taskDir, file);
          foundLocks.push({ path: lockPath, name: file });
        }
      }
    }

    const hasLockFiles = foundLocks.length > 0;

    // 创建自动修复函数
    const autoFix = {
      description: `删除 ${foundLocks.length} 个锁文件`,
      fix: async (): Promise<AutoFixResult> => {
        try {
          const removed: string[] = [];
          const failed: string[] = [];

          for (const lock of foundLocks) {
            try {
              if (fs.existsSync(lock.path)) {
                fs.unlinkSync(lock.path);
                removed.push(lock.name);
              }
            } catch (error) {
              failed.push(lock.name);
            }
          }

          return {
            success: failed.length === 0,
            message: failed.length === 0
              ? `成功删除 ${removed.length} 个锁文件`
              : `删除完成: ${removed.length} 个成功, ${failed.length} 个失败`,
            details: { removed, failed },
          };
        } catch (error) {
          return {
            success: false,
            message: `删除锁文件失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };

    return {
      checkId: 'R-RETRY-002',
      checkName: '锁文件检查',
      ruleId: rule.id,
      passed: !hasLockFiles,
      severity: 'error',
      message: hasLockFiles
        ? `发现 ${foundLocks.length} 个锁文件: ${foundLocks.map(l => l.name).join(', ')}`
        : '未发现残留锁文件',
      details: {
        lockFiles: foundLocks,
        attempt: context.attempt,
        isResumed: context.isResumed,
      },
      suggestions: hasLockFiles
        ? [
            '删除残留的锁文件',
            '检查是否有其他进程正在运行相同任务',
          ]
        : undefined,
      autoFixable: hasLockFiles,
      autoFix: hasLockFiles ? autoFix : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-RETRY-002',
      checkName: '锁文件检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `检查锁文件时出错: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-RETRY-003: 开发报告重置检查
 * 检查开发报告是否需要重置（重试时）
 */
export async function checkDevReportReset(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  // 仅在重试时适用
  if (context.attempt <= 1 && !context.isResumed) {
    return {
      checkId: 'R-RETRY-003',
      checkName: '开发报告重置检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '首次执行，跳过报告重置检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const reportPath = path.join(
      context.cwd,
      '.projmnt4claude',
      'reports',
      'dev',
      `${context.taskId}-dev-report.json`
    );

    let needsReset = false;
    let reportAttempt = 0;

    if (fs.existsSync(reportPath)) {
      try {
        const reportContent = fs.readFileSync(reportPath, 'utf-8');
        const report = JSON.parse(reportContent);
        reportAttempt = report.metadata?.attempt || 0;

        // 如果报告中的attempt >= 当前attempt，需要重置
        if (reportAttempt >= context.attempt) {
          needsReset = true;
        }
      } catch {
        // 报告文件损坏，需要重置
        needsReset = true;
      }
    }

    // 创建自动修复函数
    const autoFix = {
      description: '归档旧开发报告并创建新报告',
      fix: async (): Promise<AutoFixResult> => {
        try {
          const archiveDir = path.join(context.cwd, '.projmnt4claude', 'reports', 'archive');

          // 确保归档目录存在
          if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
          }

          // 归档旧报告
          if (fs.existsSync(reportPath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archiveName = `${context.taskId}-dev-report-attempt${reportAttempt}-${timestamp}.json`;
            const archivePath = path.join(archiveDir, archiveName);

            fs.renameSync(reportPath, archivePath);
          }

          // 创建新报告框架
          const newReport = {
            taskId: context.taskId,
            attempt: context.attempt,
            startTime: new Date().toISOString(),
            phases: {},
            metadata: {
              attempt: context.attempt,
              isResumed: context.isResumed,
              resetFrom: reportAttempt > 0 ? reportAttempt : undefined,
            },
          };

          // 确保目录存在
          const reportDir = path.dirname(reportPath);
          if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
          }

          fs.writeFileSync(reportPath, JSON.stringify(newReport, null, 2));

          return {
            success: true,
            message: `成功归档旧报告 (attempt ${reportAttempt}) 并创建新报告 (attempt ${context.attempt})`,
            details: {
              archived: reportAttempt > 0,
              oldAttempt: reportAttempt,
              newAttempt: context.attempt,
            },
          };
        } catch (error) {
          return {
            success: false,
            message: `重置开发报告失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };

    return {
      checkId: 'R-RETRY-003',
      checkName: '开发报告重置检查',
      ruleId: rule.id,
      passed: !needsReset,
      severity: 'warning',
      message: needsReset
        ? `开发报告需要重置: 当前attempt=${context.attempt}, 报告attempt=${reportAttempt}`
        : '开发报告状态正常',
      details: {
        needsReset,
        currentAttempt: context.attempt,
        reportAttempt,
        reportPath,
      },
      suggestions: needsReset
        ? [
            '归档旧开发报告',
            '创建新的开发报告',
          ]
        : undefined,
      autoFixable: needsReset,
      autoFix: needsReset ? autoFix : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-RETRY-003',
      checkName: '开发报告重置检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `检查开发报告时出错: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}
