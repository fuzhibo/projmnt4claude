/**
 * Resource Checker - 资源配置检查器
 * 实现 P8 开发阶段前质量门禁的资源相关规则
 *
 * 规则覆盖:
 * - R-RES-001: 开发分支配置检查
 * - R-RES-002: 开发目录配置检查
 * - R-RES-003: 环境变量配置检查
 * - R-RES-004: 磁盘空间检查
 *
 * @module pre-dev-phase-gate/checkers/resource
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
  ResourceConfigCheckResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 资源检查结果
 */
export interface ResourceCheckResult {
  /** 开发分支配置 */
  devBranch: {
    exists: boolean;
    name: string;
    valid: boolean;
  };
  /** 开发目录配置 */
  devDirectory: {
    exists: boolean;
    path: string;
    writable: boolean;
  };
  /** 环境配置 */
  envConfig: {
    valid: boolean;
    missingVars: string[];
  };
  /** 磁盘空间 */
  diskSpace?: {
    available: number;
    required: number;
    sufficient: boolean;
  };
}

/**
 * R-RES-001: 开发分支配置检查
 * 检查开发分支是否存在且配置正确
 */
export async function checkDevBranchConfig(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const targetBranch = context.task.branch;

  if (!targetBranch) {
    return {
      checkId: 'R-RES-001',
      checkName: '开发分支配置检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务未配置分支，跳过检查',
      details: {
        branchConfigured: false,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 检查分支是否存在
    execSync(`git rev-parse --verify ${targetBranch}`, {
      cwd: context.cwd,
      encoding: 'utf-8',
    });

    const branchExists = true;

    // 检查分支名称是否符合约定
    const config = rule.config as { allowedPrefixes?: string[]; pattern?: string } | undefined;
    const allowedPrefixes = config?.allowedPrefixes ?? ['feature/', 'bugfix/', 'hotfix/', 'task/'];
    const pattern = config?.pattern;

    let validName = false;
    const lowerBranch = targetBranch.toLowerCase();

    // 检查前缀
    const hasValidPrefix = allowedPrefixes.some(prefix =>
      lowerBranch.startsWith(prefix.toLowerCase())
    );

    // 检查自定义模式
    let matchesPattern = true;
    if (pattern) {
      matchesPattern = new RegExp(pattern).test(targetBranch);
    }

    validName = hasValidPrefix && matchesPattern;

    const passed = branchExists && validName;

    return {
      checkId: 'R-RES-001',
      checkName: '开发分支配置检查',
      ruleId: rule.id,
      passed,
      severity: rule.severity,
      message: passed
        ? `分支配置正确: ${targetBranch}`
        : branchExists
          ? `分支名称不符合约定: ${targetBranch}`
          : `分支不存在: ${targetBranch}`,
      details: {
        branchConfigured: true,
        targetBranch,
        branchExists,
        validName,
        hasValidPrefix,
        matchesPattern,
        allowedPrefixes,
        pattern,
      } as unknown as Record<string, unknown>,
      suggestions: !passed
        ? branchExists
          ? [
              `分支名称应符合以下约定之一:`,
              ...allowedPrefixes.map(p => `  - ${p}*`),
              ...(pattern ? [`  - 匹配正则: ${pattern}`] : []),
              `示例: feature/${context.task.id}-description`,
            ]
          : [
              `创建分支: git checkout -b ${targetBranch}`,
              '或更新任务的分支配置',
            ]
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      checkId: 'R-RES-001',
      checkName: '开发分支配置检查',
      ruleId: rule.id,
      passed: false,
      severity: rule.severity,
      message: `分支不存在: ${targetBranch}`,
      details: {
        branchConfigured: true,
        targetBranch,
        branchExists: false,
      },
      suggestions: [
        `创建分支: git checkout -b ${targetBranch}`,
        '或更新任务的分支配置',
      ],
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-RES-002: 开发目录配置检查
 * 检查开发目录是否存在且可写
 */
export async function checkDevDirectoryConfig(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    // 检查工作目录是否存在
    const dirExists = fs.existsSync(context.cwd);

    if (!dirExists) {
      return {
        checkId: 'R-RES-002',
        checkName: '开发目录配置检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `工作目录不存在: ${context.cwd}`,
        details: {
          path: context.cwd,
          exists: false,
          writable: false,
        },
        suggestions: [
          `创建工作目录: mkdir -p ${context.cwd}`,
          '或检查工作目录配置',
        ],
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查目录是否可写
    let writable = false;
    try {
      const testFile = path.join(context.cwd, `.write-test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      writable = true;
    } catch {
      writable = false;
    }

    // 检查必需子目录
    const config = rule.config as { requiredSubdirs?: string[] } | undefined;
    const requiredSubdirs = config?.requiredSubdirs ?? ['src', '.projmnt4claude/tasks'];

    const missingSubdirs: string[] = [];
    for (const subdir of requiredSubdirs) {
      const subdirPath = path.join(context.cwd, subdir);
      if (!fs.existsSync(subdirPath)) {
        missingSubdirs.push(subdir);
      }
    }

    const passed = writable && missingSubdirs.length === 0;

    return {
      checkId: 'R-RES-002',
      checkName: '开发目录配置检查',
      ruleId: rule.id,
      passed,
      severity: rule.severity,
      message: passed
        ? '开发目录配置正确'
        : !writable
          ? `工作目录不可写: ${context.cwd}`
          : `缺少 ${missingSubdirs.length} 个必需子目录`,
      details: {
        path: context.cwd,
        exists: true,
        writable,
        requiredSubdirs,
        missingSubdirs,
      } as unknown as Record<string, unknown>,
      suggestions: !passed
        ? !writable
          ? [
              `检查目录权限: ls -la ${context.cwd}`,
              '确保当前用户有写权限',
            ]
          : [
              `创建缺失的子目录:`,
              ...missingSubdirs.map(d => `  mkdir -p ${d}`),
            ]
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-RES-002',
      checkName: '开发目录配置检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * R-RES-003: 环境变量配置检查
 * 检查必需的环境变量是否已配置
 */
export async function checkEnvConfig(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  const config = rule.config as { requiredEnvVars?: string[]; optionalEnvVars?: string[] } | undefined;
  const requiredEnvVars = config?.requiredEnvVars ?? ['NODE_ENV'];
  const optionalEnvVars = config?.optionalEnvVars ?? [];

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const configuredVars: Record<string, string | undefined> = {};

  // 检查必需变量
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    configuredVars[envVar] = value;
    if (!value) {
      missingRequired.push(envVar);
    }
  }

  // 检查可选变量
  for (const envVar of optionalEnvVars) {
    const value = process.env[envVar];
    if (!value) {
      missingOptional.push(envVar);
    }
  }

  const passed = missingRequired.length === 0;

  return {
    checkId: 'R-RES-003',
    checkName: '环境变量配置检查',
    ruleId: rule.id,
    passed,
    severity: rule.severity,
    message: passed
      ? `所有 ${requiredEnvVars.length} 个必需环境变量已配置`
      : `缺少 ${missingRequired.length} 个必需环境变量`,
    details: {
      requiredEnvVars,
      optionalEnvVars,
      missingRequired,
      missingOptional,
      configuredVars,
    } as unknown as Record<string, unknown>,
    suggestions: missingRequired.length > 0
      ? [
          '设置缺失的环境变量:',
          ...missingRequired.map(v => `  export ${v}=value`),
          '',
          '或在 .env 文件中添加:',
          ...missingRequired.map(v => `${v}=value`),
        ]
      : missingOptional.length > 0
        ? [
            '可选环境变量未配置:',
            ...missingOptional.map(v => `  ${v}`),
          ]
        : undefined,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * R-RES-004: 磁盘空间检查
 * 检查可用磁盘空间是否足够
 */
export async function checkDiskSpace(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();

  const config = rule.config as { minFreeSpaceMB?: number; minFreeSpacePercent?: number } | undefined;
  const minFreeSpaceMB = config?.minFreeSpaceMB ?? 100; // 默认100MB
  const minFreeSpacePercent = config?.minFreeSpacePercent ?? 10; // 默认10%

  try {
    // 获取磁盘空间信息（Linux/Mac）
    let availableMB = 0;
    let totalMB = 0;
    let usedPercent = 0;

    try {
      // 尝试使用 df 命令
      const dfOutput = execSync(`df -m "${context.cwd}" | tail -1`, {
        encoding: 'utf-8',
      }).trim();

      const parts = dfOutput.split(/\s+/);
      if (parts.length >= 4) {
        totalMB = parseInt(parts[1], 10) || 0;
        availableMB = parseInt(parts[3], 10) || 0;
        usedPercent = parseInt(parts[4]?.replace('%', '') || '0', 10);
      }
    } catch {
      // df 命令失败，使用 Node.js 的 statfs（Node 18+）
      try {
        const statfs = fs.statfsSync || fs.statSync;
        const stats = statfs(context.cwd);
        if (stats && 'bavail' in stats) {
          const blockSize = stats.bsize;
          availableMB = Math.floor((stats.bavail * blockSize) / (1024 * 1024));
          totalMB = Math.floor((stats.blocks * blockSize) / (1024 * 1024));
          usedPercent = Math.floor(((stats.blocks - stats.bfree) / stats.blocks) * 100);
        }
      } catch {
        // 无法获取磁盘空间信息
      }
    }

    const freePercent = 100 - usedPercent;
    const sufficientSpace = availableMB >= minFreeSpaceMB && freePercent >= minFreeSpacePercent;

    return {
      checkId: 'R-RES-004',
      checkName: '磁盘空间检查',
      ruleId: rule.id,
      passed: sufficientSpace,
      severity: rule.severity,
      message: sufficientSpace
        ? `磁盘空间充足: ${availableMB}MB 可用 (${freePercent}% 空闲)`
        : availableMB < minFreeSpaceMB
          ? `磁盘空间不足: ${availableMB}MB 可用 (需要 ${minFreeSpaceMB}MB)`
          : `磁盘空间不足: ${freePercent}% 空闲 (需要 ${minFreeSpacePercent}%)`,
      details: {
        availableMB,
        totalMB,
        usedPercent,
        freePercent,
        minFreeSpaceMB,
        minFreeSpacePercent,
        sufficient: sufficientSpace,
      } as unknown as Record<string, unknown>,
      suggestions: !sufficientSpace
        ? [
            '清理磁盘空间:',
            '  1. 删除临时文件: rm -rf /tmp/*',
            '  2. 清理包管理器缓存',
            '  3. 删除不必要的依赖',
            '  4. 清理旧的构建输出',
          ]
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      checkId: 'R-RES-004',
      checkName: '磁盘空间检查',
      ruleId: rule.id,
      passed: true, // 无法检查时默认通过
      severity: 'warning',
      message: `无法检查磁盘空间: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}
