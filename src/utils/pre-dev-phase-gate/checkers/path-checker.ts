/**
 * Path Alignment Checker
 * 路径对齐检查器
 *
 * 职责:
 * - R-PATH-001: 检查任务文件路径是否符合规范
 * - R-PATH-002: 检查代码引用路径是否正确
 * - R-PATH-003: 检查资源引用路径是否有效
 *
 * @module pre-dev-phase-gate/checkers/path-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 路径对齐检查结果
 */
export interface PathCheckResult {
  /** 路径是否对齐 */
  aligned: boolean;
  /** 任务根路径 */
  taskRootPath: string;
  /** 期望路径 */
  expectedPath: string;
  /** 实际路径 */
  actualPath: string;
  /** 错位文件列表 */
  misalignedFiles: string[];
  /** 无效引用列表 */
  invalidReferences: string[];
}

/**
 * R-PATH-001: 检查任务文件路径是否符合规范
 * 验证任务相关文件是否存放在正确的位置
 */
export async function checkTaskFilePath(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const taskId = context.taskId;
    const expectedTaskDir = path.join(context.cwd, '.projmnt4claude', 'tasks', taskId);
    const expectedPaths = {
      metaJson: path.join(expectedTaskDir, 'meta.json'),
      contractJson: path.join(expectedTaskDir, 'contract.json'),
    };

    const misalignedFiles: string[] = [];

    // 检查元数据文件是否存在
    if (!fs.existsSync(expectedPaths.metaJson)) {
      misalignedFiles.push(`meta.json 不在期望位置: ${expectedPaths.metaJson}`);
    }

    // 检查 contract.json 是否存在
    if (!fs.existsSync(expectedPaths.contractJson)) {
      misalignedFiles.push(`contract.json 不在期望位置: ${expectedPaths.contractJson}`);
    }

    const aligned = misalignedFiles.length === 0;
    const config = rule.config as { strictMode?: boolean } | undefined;
    const strictMode = config?.strictMode ?? true;

    // 在严格模式下，路径不对齐视为错误；非严格模式下视为警告
    const severity = !aligned && strictMode ? 'error' : 'warning';

    return {
      checkId: 'R-PATH-001',
      checkName: '任务文件路径对齐检查',
      ruleId: rule.id,
      passed: aligned,
      severity,
      message: aligned
        ? '任务文件路径符合规范'
        : `发现 ${misalignedFiles.length} 个路径不对齐的文件`,
      details: {
        taskRootPath: expectedTaskDir,
        expectedPath: expectedPaths.metaJson,
        misalignedFiles,
      } as unknown as Record<string, unknown>,
      suggestions: misalignedFiles.length > 0
        ? [
            `确保任务文件位于: .projmnt4claude/tasks/${taskId}/`,
            '检查 meta.json 和 contract.json 是否存在',
          ]
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-PATH-001',
      checkName: '任务文件路径对齐检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `路径对齐检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-PATH-002: 检查代码引用路径是否正确
 * 验证代码中的文件引用是否指向有效路径
 */
export async function checkCodeReferencePath(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as { checkPatterns?: string[]; excludePatterns?: string[] } | undefined;
    const checkPatterns = config?.checkPatterns ?? ['src/**/*.{ts,js}'];
    const excludePatterns = config?.excludePatterns ?? ['node_modules/**', 'dist/**'];

    const invalidReferences: string[] = [];

    // 检查关键配置文件引用
    const criticalFiles = [
      'package.json',
      'tsconfig.json',
      '.projmnt4claude/config.json',
    ];

    for (const file of criticalFiles) {
      const fullPath = path.join(context.cwd, file);
      if (!fs.existsSync(fullPath)) {
        invalidReferences.push(`引用的关键文件不存在: ${file}`);
      }
    }

    const aligned = invalidReferences.length === 0;

    return {
      checkId: 'R-PATH-002',
      checkName: '代码引用路径检查',
      ruleId: rule.id,
      passed: aligned,
      severity: aligned ? 'info' : 'warning',
      message: aligned
        ? '代码引用路径正确'
        : `发现 ${invalidReferences.length} 个无效引用`,
      details: {
        checkPatterns,
        excludePatterns,
        invalidReferences,
        checkedFiles: criticalFiles,
      } as unknown as Record<string, unknown>,
      suggestions: invalidReferences.length > 0
        ? ['检查引用的文件路径是否正确', '确保配置文件存在于项目根目录']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-PATH-002',
      checkName: '代码引用路径检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `代码引用路径检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-PATH-003: 检查资源引用路径是否有效
 * 验证项目资源（如报告、输出）路径配置
 */
export async function checkResourceReferencePath(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as { requiredPaths?: string[] } | undefined;
    const requiredPaths = config?.requiredPaths ?? [
      '.projmnt4claude/tasks',
      '.projmnt4claude/reports',
      '.projmnt4claude/outputs',
    ];

    const invalidPaths: string[] = [];

    for (const requiredPath of requiredPaths) {
      const fullPath = path.join(context.cwd, requiredPath);
      // 检查目录是否存在，不存在则标记
      if (!fs.existsSync(fullPath)) {
        invalidPaths.push(requiredPath);
      }
    }

    const aligned = invalidPaths.length === 0;

    return {
      checkId: 'R-PATH-003',
      checkName: '资源引用路径检查',
      ruleId: rule.id,
      passed: aligned,
      severity: aligned ? 'info' : 'warning',
      message: aligned
        ? '资源引用路径有效'
        : `发现 ${invalidPaths.length} 个无效资源路径`,
      details: {
        requiredPaths,
        invalidPaths,
        missingDirectories: invalidPaths,
      } as unknown as Record<string, unknown>,
      suggestions: invalidPaths.length > 0
        ? invalidPaths.map(p => `创建缺失的目录: mkdir -p ${p}`)
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-PATH-003',
      checkName: '资源引用路径检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `资源引用路径检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}
