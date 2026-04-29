/**
 * Code Change Checker
 * 代码变更检查器
 *
 * 职责:
 * - CP-001: 检查代码变更的合理性
 * - CP-002: 检测未预期的修改
 * - CP-003: 验证变更是否符合任务要求
 *
 * @module post-dev-phase-gate/checkers/code-change-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseRule,
  PostDevPhaseCheckContext,
  PostDevPhaseCheckItemResult,
  RuleSeverity,
} from '../../../types/post-dev-phase-gate.js';

/**
 * 代码变更检查结果
 */
export interface CodeChangeCheckResult {
  /** 检查是否通过 */
  passed: boolean;
  /** 变更文件数量 */
  fileCount: number;
  /** 新增文件数量 */
  addedFiles: number;
  /** 修改文件数量 */
  modifiedFiles: number;
  /** 删除文件数量 */
  deletedFiles: number;
  /** 可疑变更数量 */
  suspiciousChanges: number;
  /** 变更文件列表 */
  changedFiles: string[];
  /** 可疑变更详情 */
  suspiciousDetails: SuspiciousChange[];
  /** 变更合理性评分 (0-100) */
  reasonablenessScore: number;
}

/**
 * 可疑变更详情
 */
export interface SuspiciousChange {
  /** 文件路径 */
  filePath: string;
  /** 变更类型 */
  changeType: 'added' | 'modified' | 'deleted';
  /** 可疑原因 */
  reason: string;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high';
}

/**
 * 变更统计信息
 */
interface ChangeStats {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * 检查代码变更
 * R-CHANGE-001: 代码变更合理性检查主函数
 *
 * @param rule - 检查规则
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function checkCodeChanges(
  rule: PostDevPhaseRule,
  context: PostDevPhaseCheckContext
): Promise<PostDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as {
      maxFilesChanged?: number;
      suspiciousPatterns?: string[];
      criticalFiles?: string[];
      minReasonablenessScore?: number;
      allowConfigChanges?: boolean;
      allowTestDeletion?: boolean;
    } | undefined;

    const maxFilesChanged = config?.maxFilesChanged ?? 50;
    const minReasonablenessScore = config?.minReasonablenessScore ?? 60;
    const allowConfigChanges = config?.allowConfigChanges ?? false;
    const allowTestDeletion = config?.allowTestDeletion ?? false;

    // 检测代码变更
    const changes = await detectCodeChanges(context.cwd, context.taskId);

    // 分析变更合理性
    const analysis = analyzeChanges(changes, {
      suspiciousPatterns: config?.suspiciousPatterns ?? getDefaultSuspiciousPatterns(),
      criticalFiles: config?.criticalFiles ?? getDefaultCriticalFiles(),
      allowConfigChanges,
      allowTestDeletion,
    });

    // 计算合理性评分
    const reasonablenessScore = calculateReasonablenessScore(changes, analysis);

    // 判断是否通过
    const totalFiles = changes.added.length + changes.modified.length + changes.deleted.length;
    const passed =
      totalFiles <= maxFilesChanged &&
      analysis.suspicious.length === 0 &&
      reasonablenessScore >= minReasonablenessScore;

    // 生成结果
    const result: CodeChangeCheckResult = {
      passed,
      fileCount: totalFiles,
      addedFiles: changes.added.length,
      modifiedFiles: changes.modified.length,
      deletedFiles: changes.deleted.length,
      suspiciousChanges: analysis.suspicious.length,
      changedFiles: [...changes.added, ...changes.modified, ...changes.deleted],
      suspiciousDetails: analysis.suspicious,
      reasonablenessScore,
    };

    // 生成消息
    const message = generateChangeMessage(result, maxFilesChanged, minReasonablenessScore);

    // 生成建议
    const suggestions = generateChangeSuggestions(result, maxFilesChanged);

    return {
      checkId: 'code-change-check',
      checkName: '代码变更检查',
      ruleId: rule.id,
      passed,
      severity: passed ? 'info' : rule.severity,
      message,
      details: result as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      autoFixable: false, // 代码变更问题通常无法自动修复
    };
  } catch (error) {
    return {
      checkId: 'code-change-check',
      checkName: '代码变更检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `代码变更检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 检测代码变更
 * 通过分析 git diff 或检查文件系统变化
 */
async function detectCodeChanges(cwd: string, taskId: string): Promise<ChangeStats> {
  const changes: ChangeStats = {
    added: [],
    modified: [],
    deleted: [],
  };

  try {
    // 尝试从开发报告中获取变更信息
    const devReportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
    if (fs.existsSync(devReportPath)) {
      const report = JSON.parse(fs.readFileSync(devReportPath, 'utf-8'));
      if (report.changes && Array.isArray(report.changes)) {
        for (const change of report.changes) {
          if (typeof change === 'string') {
            changes.modified.push(change);
          } else if (change.path) {
            const target = change.status === 'added' ? changes.added :
                          change.status === 'deleted' ? changes.deleted :
                          changes.modified;
            target.push(change.path);
          }
        }
        return changes;
      }
    }

    // 回退: 扫描源文件目录
    const srcPath = path.join(cwd, 'src');
    if (fs.existsSync(srcPath)) {
      const files = scanSourceFiles(srcPath);
      changes.modified = files.map(f => path.relative(cwd, f));
    }

    return changes;
  } catch {
    return changes;
  }
}

/**
 * 扫描源文件
 */
function scanSourceFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...scanSourceFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * 分析变更
 */
function analyzeChanges(
  changes: ChangeStats,
  options: {
    suspiciousPatterns: string[];
    criticalFiles: string[];
    allowConfigChanges: boolean;
    allowTestDeletion: boolean;
  }
): { suspicious: SuspiciousChange[] } {
  const suspicious: SuspiciousChange[] = [];

  const allFiles = [...changes.added, ...changes.modified, ...changes.deleted];

  for (const file of allFiles) {
    const normalizedPath = file.replace(/\\/g, '/').toLowerCase();
    const changeType: SuspiciousChange['changeType'] = changes.added.includes(file)
      ? 'added'
      : changes.deleted.includes(file)
      ? 'deleted'
      : 'modified';

    // 检查可疑模式
    for (const pattern of options.suspiciousPatterns) {
      if (normalizedPath.includes(pattern.toLowerCase())) {
        suspicious.push({
          filePath: file,
          changeType,
          reason: `匹配可疑模式: ${pattern}`,
          severity: 'medium',
        });
        break;
      }
    }

    // 检查关键文件变更
    for (const critical of options.criticalFiles) {
      if (normalizedPath.includes(critical.toLowerCase())) {
        suspicious.push({
          filePath: file,
          changeType,
          reason: `关键文件被修改: ${critical}`,
          severity: 'high',
        });
        break;
      }
    }

    // 检查配置文件变更
    if (!options.allowConfigChanges && isConfigFile(normalizedPath)) {
      suspicious.push({
        filePath: file,
        changeType,
        reason: '配置文件变更 (可能需要额外审查)',
        severity: 'low',
      });
    }

    // 检查测试文件删除
    if (!options.allowTestDeletion && changeType === 'deleted' && isTestFile(normalizedPath)) {
      suspicious.push({
        filePath: file,
        changeType,
        reason: '测试文件被删除',
        severity: 'high',
      });
    }
  }

  return { suspicious };
}

/**
 * 判断是否为配置文件
 */
function isConfigFile(filePath: string): boolean {
  const configPatterns = [
    'package.json',
    'tsconfig.json',
    '.eslintrc',
    '.prettierrc',
    'vite.config',
    'webpack.config',
    '.env',
    'dockerfile',
    '.github/',
  ];
  return configPatterns.some(pattern => filePath.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * 判断是否为测试文件
 */
function isTestFile(filePath: string): boolean {
  const testPatterns = ['.test.', '.spec.', '__tests__', '__mocks__'];
  return testPatterns.some(pattern => filePath.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * 计算变更合理性评分
 */
function calculateReasonablenessScore(
  changes: ChangeStats,
  analysis: { suspicious: SuspiciousChange[] }
): number {
  const totalFiles = changes.added.length + changes.modified.length + changes.deleted.length;

  if (totalFiles === 0) {
    return 100;
  }

  // 基础分
  let score = 100;

  // 根据文件数量扣分
  if (totalFiles > 20) {
    score -= Math.min(20, (totalFiles - 20) * 0.5);
  }

  // 根据可疑变更扣分
  for (const suspicious of analysis.suspicious) {
    switch (suspicious.severity) {
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 10;
        break;
      case 'low':
        score -= 5;
        break;
    }
  }

  // 测试文件删除惩罚
  const testDeletions = changes.deleted.filter(f => isTestFile(f)).length;
  if (testDeletions > 0) {
    score -= testDeletions * 10;
  }

  return Math.max(0, Math.round(score));
}

/**
 * 生成检查消息
 */
function generateChangeMessage(
  result: CodeChangeCheckResult,
  maxFiles: number,
  minScore: number
): string {
  if (result.passed) {
    return `代码变更检查通过 (${result.fileCount} 个文件变更, 评分: ${result.reasonablenessScore})`;
  }

  const parts: string[] = [];

  if (result.fileCount > maxFiles) {
    parts.push(`${result.fileCount} 个文件变更超过阈值 ${maxFiles}`);
  }

  if (result.suspiciousChanges > 0) {
    parts.push(`${result.suspiciousChanges} 个可疑变更`);
  }

  if (result.reasonablenessScore < minScore) {
    parts.push(`合理性评分 ${result.reasonablenessScore} 低于阈值 ${minScore}`);
  }

  return `代码变更检查失败: ${parts.join(', ')}`;
}

/**
 * 生成修复建议
 */
function generateChangeSuggestions(
  result: CodeChangeCheckResult,
  maxFiles: number
): string[] {
  const suggestions: string[] = [];

  if (result.fileCount > maxFiles) {
    suggestions.push(`变更文件过多 (${result.fileCount} > ${maxFiles}), 建议拆分任务`);
    suggestions.push('检查是否包含不必要的文件变更');
  }

  if (result.suspiciousChanges > 0) {
    suggestions.push('审查以下可疑变更:');
    for (const detail of result.suspiciousDetails) {
      suggestions.push(`  - [${detail.severity.toUpperCase()}] ${detail.filePath}: ${detail.reason}`);
    }
  }

  if (result.deletedFiles > 0) {
    suggestions.push(`确认 ${result.deletedFiles} 个删除操作是预期的`);
  }

  if (result.reasonablenessScore < 60) {
    suggestions.push('建议进行代码审查以确保变更合理性');
  }

  return suggestions;
}

/**
 * 获取默认可疑模式
 */
function getDefaultSuspiciousPatterns(): string[] {
  return [
    'todo',
    'fixme',
    'hack',
    'workaround',
    'temporary',
    'temp_',
    '_temp',
    'console.log',
    'debugger',
    'eval(',
    'innerHTML',
    'document.write',
  ];
}

/**
 * 获取默认关键文件列表
 */
function getDefaultCriticalFiles(): string[] {
  return [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.gitignore',
    'LICENSE',
    'README.md',
    'CLAUDE.md',
  ];
}

/**
 * 获取变更统计
 * R-CHANGE-001-辅助函数
 */
export async function getChangeStats(
  cwd: string,
  taskId: string
): Promise<{ added: number; modified: number; deleted: number } | null> {
  try {
    const changes = await detectCodeChanges(cwd, taskId);
    return {
      added: changes.added.length,
      modified: changes.modified.length,
      deleted: changes.deleted.length,
    };
  } catch {
    return null;
  }
}

/**
 * 检查是否存在可疑变更
 * R-CHANGE-001-辅助函数
 */
export async function hasSuspiciousChanges(
  cwd: string,
  taskId: string
): Promise<{ hasSuspicious: boolean; count: number; details: SuspiciousChange[] }> {
  const changes = await detectCodeChanges(cwd, taskId);
  const analysis = analyzeChanges(changes, {
    suspiciousPatterns: getDefaultSuspiciousPatterns(),
    criticalFiles: getDefaultCriticalFiles(),
    allowConfigChanges: false,
    allowTestDeletion: false,
  });

  return {
    hasSuspicious: analysis.suspicious.length > 0,
    count: analysis.suspicious.length,
    details: analysis.suspicious,
  };
}

/**
 * 创建 CodeChangeChecker 类
 * IPostDevPhaseChecker 接口实现
 */
export class CodeChangeChecker {
  readonly id = 'code-change-checker';
  readonly name = '代码变更检查器';
  readonly description = '检查代码变更的合理性和预期性';

  async check(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    return checkCodeChanges(rule, context);
  }
}

// 导出默认实例
export const codeChangeChecker = new CodeChangeChecker();
