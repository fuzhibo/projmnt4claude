/**
 * Documentation Update Checker
 * 文档更新检查器
 *
 * 职责:
 * - CP-001: 检查文档是否与代码实现一致
 * - CP-002: 验证 API 文档是否更新
 * - CP-003: 检测文档中的过期内容
 *
 * @module post-dev-phase-gate/checkers/doc-update-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseRule,
  PostDevPhaseCheckContext,
  PostDevPhaseCheckItemResult,
} from '../../../types/post-dev-phase-gate.js';

/**
 * 文档更新检查结果
 */
export interface DocUpdateCheckResult {
  /** 检查是否通过 */
  passed: boolean;
  /** 一致性评分 (0-100) */
  consistencyScore: number;
  /** 文档文件总数 */
  totalDocFiles: number;
  /** 已更新文档数 */
  updatedDocs: number;
  /** 过期文档数 */
  outdatedDocs: number;
  /** 缺失文档数 */
  missingDocs: number;
  /** 过期文档列表 */
  outdatedDocList: OutdatedDocInfo[];
  /** 缺失文档列表 */
  missingDocList: MissingDocInfo[];
  /** README 是否存在 */
  readmeExists: boolean;
  /** CHANGELOG 是否更新 */
  changelogUpdated: boolean;
  /** API 文档是否同步 */
  apiDocsSynced: boolean;
  /** 代码注释覆盖率 */
  commentCoverage: number;
}

/**
 * 过期文档信息
 */
export interface OutdatedDocInfo {
  /** 文档路径 */
  docPath: string;
  /** 过期原因 */
  reason: string;
  /** 最后更新时间 */
  lastModified?: string;
  /** 建议操作 */
  suggestion: string;
}

/**
 * 缺失文档信息
 */
export interface MissingDocInfo {
  /** 应该存在的文档路径 */
  expectedPath: string;
  /** 文档类型 */
  docType: 'api' | 'readme' | 'changelog' | 'guide' | 'other';
  /** 缺失原因 */
  reason: string;
}

/**
 * 文件变更信息
 */
interface FileChange {
  path: string;
  modified: boolean;
  added: boolean;
}

/**
 * 检查文档更新
 * R-DOC-001: 文档更新检查主函数
 *
 * @param rule - 检查规则
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function checkDocUpdates(
  rule: PostDevPhaseRule,
  context: PostDevPhaseCheckContext
): Promise<PostDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as {
      minConsistencyScore?: number;
      requireReadme?: boolean;
      requireChangelog?: boolean;
      requireApiDocs?: boolean;
      docPatterns?: string[];
      codeDocPatterns?: string[];
      maxDocAgeDays?: number;
    } | undefined;

    const minConsistencyScore = config?.minConsistencyScore ?? 60;
    const requireReadme = config?.requireReadme ?? false;
    const requireChangelog = config?.requireChangelog ?? false;
    const requireApiDocs = config?.requireApiDocs ?? false;
    const docPatterns = config?.docPatterns ?? ['docs/**/*.md', '**/*.md'];
    const codeDocPatterns = config?.codeDocPatterns ?? ['src/**/*.ts'];
    const maxDocAgeDays = config?.maxDocAgeDays ?? 30;

    // 获取代码变更
    const codeChanges = await getCodeChanges(context.cwd, context.taskId);

    // 查找文档文件
    const docFiles = findDocFiles(context.cwd, docPatterns);

    // 检查文档同步状态
    const syncStatus = checkDocSyncStatus(docFiles, codeChanges, maxDocAgeDays);

    // 检查必需的文档
    const requiredDocs = checkRequiredDocs(context.cwd, {
      requireReadme,
      requireChangelog,
      requireApiDocs,
    });

    // 检查代码注释覆盖
    const commentCoverage = checkCommentCoverage(context.cwd, codeDocPatterns);

    // 计算一致性评分
    const consistencyScore = calculateConsistencyScore(
      syncStatus,
      requiredDocs,
      commentCoverage,
      docFiles.length
    );

    // 判断是否通过
    const passed =
      consistencyScore >= minConsistencyScore &&
      (!requireReadme || requiredDocs.readmeExists) &&
      (!requireChangelog || requiredDocs.changelogExists) &&
      (!requireApiDocs || requiredDocs.apiDocsExist);

    // 生成结果
    const result: DocUpdateCheckResult = {
      passed,
      consistencyScore,
      totalDocFiles: docFiles.length,
      updatedDocs: syncStatus.updated.length,
      outdatedDocs: syncStatus.outdated.length,
      missingDocs: requiredDocs.missing.length,
      outdatedDocList: syncStatus.outdated,
      missingDocList: requiredDocs.missing,
      readmeExists: requiredDocs.readmeExists,
      changelogUpdated: requiredDocs.changelogUpdated,
      apiDocsSynced: requiredDocs.apiDocsExist,
      commentCoverage,
    };

    // 生成消息
    const message = generateDocMessage(result, minConsistencyScore);

    // 生成建议
    const suggestions = generateDocSuggestions(result);

    return {
      checkId: 'doc-update-check',
      checkName: '文档更新检查',
      ruleId: rule.id,
      passed,
      severity: passed ? 'info' : rule.severity,
      message,
      details: result as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      autoFixable: false, // 文档更新问题通常无法自动修复
    };
  } catch (error) {
    return {
      checkId: 'doc-update-check',
      checkName: '文档更新检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `文档更新检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 获取代码变更
 */
async function getCodeChanges(cwd: string, taskId: string): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  try {
    // 尝试从开发报告获取变更
    const devReportPath = path.join(cwd, '.projmnt4claude', 'outputs', taskId, 'dev-report.json');
    if (fs.existsSync(devReportPath)) {
      const report = JSON.parse(fs.readFileSync(devReportPath, 'utf-8'));
      if (report.changes && Array.isArray(report.changes)) {
        for (const change of report.changes) {
          if (typeof change === 'string') {
            changes.push({ path: change, modified: true, added: false });
          } else {
            changes.push({
              path: change.path || String(change),
              modified: change.status === 'modified',
              added: change.status === 'added',
            });
          }
        }
        return changes;
      }
    }

    // 回退: 扫描 src 目录
    const srcPath = path.join(cwd, 'src');
    if (fs.existsSync(srcPath)) {
      const files = scanSourceFiles(srcPath);
      for (const file of files) {
        const relativePath = path.relative(cwd, file);
        changes.push({ path: relativePath, modified: true, added: false });
      }
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
 * 查找文档文件
 */
function findDocFiles(cwd: string, patterns: string[]): string[] {
  const results: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // 通配符模式
      const files = findFilesByPattern(cwd, pattern);
      results.push(...files);
    } else {
      // 具体路径
      const fullPath = path.join(cwd, pattern);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        results.push(pattern);
      }
    }
  }

  // 去重
  return Array.from(new Set(results));
}

/**
 * 根据模式查找文件
 */
function findFilesByPattern(cwd: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split('/');

  function search(dir: string, patternParts: string[], currentPath: string): void {
    if (patternParts.length === 0) return;

    const currentPattern = patternParts[0];
    if (!currentPattern) return;
    const remainingParts = patternParts.slice(1);

    if (!fs.existsSync(dir)) return;

    if (currentPattern === '**') {
      // 递归所有子目录
      search(dir, remainingParts, currentPath);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
          search(
            path.join(dir, entry.name),
            patternParts,
            path.join(currentPath, entry.name)
          );
        }
      }
    } else if (currentPattern.includes('*')) {
      const regex = new RegExp(
        '^' + currentPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (regex.test(entry.name)) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(currentPath, entry.name);

          if (entry.isDirectory() && remainingParts.length > 0) {
            search(fullPath, remainingParts, relativePath);
          } else if (entry.isFile() && remainingParts.length === 0) {
            results.push(relativePath);
          }
        }
      }
    } else {
      const fullPath = path.join(dir, currentPattern);
      const relativePath = path.join(currentPath, currentPattern);

      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && remainingParts.length > 0) {
          search(fullPath, remainingParts, relativePath);
        } else if (stat.isFile() && remainingParts.length === 0) {
          results.push(relativePath);
        }
      }
    }
  }

  search(cwd, parts, '');
  return results;
}

/**
 * 检查文档同步状态
 */
function checkDocSyncStatus(
  docFiles: string[],
  codeChanges: FileChange[],
  maxAgeDays: number
): {
  updated: string[];
  outdated: OutdatedDocInfo[];
} {
  const updated: string[] = [];
  const outdated: OutdatedDocInfo[] = [];

  // 检查是否有代码变更对应的文档更新
  const codeChangePaths = new Set(codeChanges.map(c => c.path.toLowerCase()));

  for (const docFile of docFiles) {
    const fullPath = docFile; // 已经是相对路径
    const normalizedDoc = docFile.toLowerCase();

    // 检查是否是 API 文档
    if (normalizedDoc.includes('api') || normalizedDoc.includes('reference')) {
      // 检查对应的源文件是否有变更
      const hasRelatedCodeChange = codeChanges.some(change => {
        const normalizedChange = change.path.toLowerCase();
        // 简单的文件名匹配
        const changeBasename = path.basename(normalizedChange, path.extname(normalizedChange));
        return normalizedDoc.includes(changeBasename);
      });

      if (hasRelatedCodeChange) {
        // 检查文档是否比代码更新
        const docModified = getFileModifiedTime(fullPath);
        const codeModified = Math.max(
          ...codeChanges
            .filter(c => {
              const normalizedChange = c.path.toLowerCase();
              const changeBasename = path.basename(normalizedChange, path.extname(normalizedChange));
              return normalizedDoc.includes(changeBasename);
            })
            .map(() => Date.now()) // 简化处理，假设代码刚修改
        );

        if (docModified && codeModified && docModified < codeModified) {
          outdated.push({
            docPath: docFile,
            reason: 'API 文档可能已过期（代码已更新）',
            lastModified: new Date(docModified).toISOString(),
            suggestion: '检查并更新 API 文档以匹配最新代码',
          });
        } else {
          updated.push(docFile);
        }
      } else {
        updated.push(docFile);
      }
    } else {
      // 检查文档年龄
      const modified = getFileModifiedTime(fullPath);
      if (modified) {
        const ageDays = (Date.now() - modified) / (1000 * 60 * 60 * 24);
        if (ageDays > maxAgeDays) {
          outdated.push({
            docPath: docFile,
            reason: `文档超过 ${maxAgeDays} 天未更新`,
            lastModified: new Date(modified).toISOString(),
            suggestion: '检查文档内容是否仍然准确',
          });
        } else {
          updated.push(docFile);
        }
      } else {
        updated.push(docFile);
      }
    }
  }

  return { updated, outdated };
}

/**
 * 获取文件修改时间
 */
function getFileModifiedTime(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.getTime();
  } catch {
    return null;
  }
}

/**
 * 检查必需文档
 */
function checkRequiredDocs(
  cwd: string,
  requirements: {
    requireReadme: boolean;
    requireChangelog: boolean;
    requireApiDocs: boolean;
  }
): {
  readmeExists: boolean;
  changelogExists: boolean;
  changelogUpdated: boolean;
  apiDocsExist: boolean;
  missing: MissingDocInfo[];
} {
  const missing: MissingDocInfo[] = [];

  // 检查 README
  const readmeExists = checkFileExists(cwd, ['README.md', 'readme.md', 'Readme.md']);
  if (requirements.requireReadme && !readmeExists) {
    missing.push({
      expectedPath: 'README.md',
      docType: 'readme',
      reason: '项目缺少 README 文件',
    });
  }

  // 检查 CHANGELOG
  const changelogExists = checkFileExists(cwd, ['CHANGELOG.md', 'changelog.md', 'CHANGES.md']);
  const changelogUpdated = checkChangelogUpdated(cwd);
  if (requirements.requireChangelog && !changelogExists) {
    missing.push({
      expectedPath: 'CHANGELOG.md',
      docType: 'changelog',
      reason: '项目缺少 CHANGELOG 文件',
    });
  }

  // 检查 API 文档
  const apiDocsExist =
    checkFileExists(cwd, ['docs/api.md', 'API.md', 'docs/api/README.md']) ||
    fs.existsSync(path.join(cwd, 'docs', 'api'));
  if (requirements.requireApiDocs && !apiDocsExist) {
    missing.push({
      expectedPath: 'docs/api.md',
      docType: 'api',
      reason: '项目缺少 API 文档',
    });
  }

  return {
    readmeExists,
    changelogExists,
    changelogUpdated,
    apiDocsExist,
    missing,
  };
}

/**
 * 检查文件是否存在
 */
function checkFileExists(cwd: string, possibleNames: string[]): boolean {
  for (const name of possibleNames) {
    if (fs.existsSync(path.join(cwd, name))) {
      return true;
    }
  }
  return false;
}

/**
 * 检查 CHANGELOG 是否已更新
 */
function checkChangelogUpdated(cwd: string): boolean {
  const changelogPaths = [
    path.join(cwd, 'CHANGELOG.md'),
    path.join(cwd, 'changelog.md'),
    path.join(cwd, 'CHANGES.md'),
  ];

  for (const changelogPath of changelogPaths) {
    if (fs.existsSync(changelogPath)) {
      try {
        const content = fs.readFileSync(changelogPath, 'utf-8');
        // 检查是否有最近的版本条目
        const recentVersionPattern = /##?\s*\[?\d+\.\d+/;
        return recentVersionPattern.test(content);
      } catch {
        return false;
      }
    }
  }

  return false;
}

/**
 * 检查代码注释覆盖率
 */
function checkCommentCoverage(cwd: string, patterns: string[]): number {
  let totalFiles = 0;
  let documentedFiles = 0;

  for (const pattern of patterns) {
    const files = findFilesByPattern(cwd, pattern);

    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        totalFiles++;
        const fullPath = path.join(cwd, file);

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          // 检查是否有 JSDoc 注释或模块注释
          if (
            content.includes('/**') ||
            content.includes('/*') ||
            content.includes('//') && content.split('\n').filter(l => l.trim().startsWith('//')).length > 3
          ) {
            documentedFiles++;
          }
        } catch {
          // 忽略读取错误
        }
      }
    }
  }

  return totalFiles > 0 ? Math.round((documentedFiles / totalFiles) * 100) : 100;
}

/**
 * 计算一致性评分
 */
function calculateConsistencyScore(
  syncStatus: { updated: string[]; outdated: OutdatedDocInfo[] },
  requiredDocs: {
    readmeExists: boolean;
    changelogExists: boolean;
    apiDocsExist: boolean;
    missing: MissingDocInfo[];
  },
  commentCoverage: number,
  totalDocFiles: number
): number {
  let score = 100;

  // 文档同步扣分
  if (syncStatus.outdated.length > 0) {
    score -= Math.min(30, syncStatus.outdated.length * 5);
  }

  // 必需文档缺失扣分
  if (!requiredDocs.readmeExists) score -= 15;
  if (!requiredDocs.changelogExists) score -= 10;
  if (!requiredDocs.apiDocsExist) score -= 10;

  // 缺失文档扣分
  score -= requiredDocs.missing.length * 10;

  // 注释覆盖率扣分
  score -= Math.max(0, (100 - commentCoverage) * 0.2);

  // 文档数量调整
  if (totalDocFiles === 0) {
    score -= 30;
  }

  return Math.max(0, Math.round(score));
}

/**
 * 生成文档检查消息
 */
function generateDocMessage(result: DocUpdateCheckResult, minScore: number): string {
  if (result.passed) {
    return `文档更新检查通过 (一致性评分: ${result.consistencyScore}, ${result.totalDocFiles} 个文档文件)`;
  }

  const parts: string[] = [];

  if (result.consistencyScore < minScore) {
    parts.push(`一致性评分 ${result.consistencyScore} 低于阈值 ${minScore}`);
  }

  if (result.outdatedDocs > 0) {
    parts.push(`${result.outdatedDocs} 个文档可能已过期`);
  }

  if (result.missingDocs > 0) {
    parts.push(`${result.missingDocs} 个必需文档缺失`);
  }

  if (!result.readmeExists) {
    parts.push('缺少 README 文件');
  }

  return `文档更新检查失败: ${parts.join(', ')}`;
}

/**
 * 生成文档修复建议
 */
function generateDocSuggestions(result: DocUpdateCheckResult): string[] {
  const suggestions: string[] = [];

  if (result.outdatedDocs > 0) {
    suggestions.push('以下文档可能已过期，需要更新:');
    for (const doc of result.outdatedDocList.slice(0, 5)) {
      suggestions.push(`  - ${doc.docPath}: ${doc.reason}`);
    }
    if (result.outdatedDocList.length > 5) {
      suggestions.push(`  ... 还有 ${result.outdatedDocList.length - 5} 个文档`);
    }
  }

  if (result.missingDocs > 0) {
    suggestions.push('创建缺失的文档:');
    for (const doc of result.missingDocList) {
      suggestions.push(`  - ${doc.expectedPath}: ${doc.reason}`);
    }
  }

  if (!result.readmeExists) {
    suggestions.push('创建 README.md 文件，包含项目介绍、安装和使用说明');
  }

  if (!result.changelogUpdated) {
    suggestions.push('更新 CHANGELOG.md，记录本次变更');
  }

  if (result.commentCoverage < 50) {
    suggestions.push(`代码注释覆盖率较低 (${result.commentCoverage}%)，建议添加更多注释`);
  }

  return suggestions;
}

/**
 * 获取文档统计
 * R-DOC-001-辅助函数
 */
export async function getDocStats(cwd: string): Promise<{
  totalDocs: number;
  outdatedCount: number;
  missingReadme: boolean;
} | null> {
  try {
    const docFiles = findDocFiles(cwd, ['docs/**/*.md', '**/*.md']);
    const codeChanges: FileChange[] = [];
    const syncStatus = checkDocSyncStatus(docFiles, codeChanges, 30);
    const readmeExists = checkFileExists(cwd, ['README.md', 'readme.md']);

    return {
      totalDocs: docFiles.length,
      outdatedCount: syncStatus.outdated.length,
      missingReadme: !readmeExists,
    };
  } catch {
    return null;
  }
}

/**
 * 检查文档是否需要更新
 * R-DOC-001-辅助函数
 */
export async function needsDocUpdate(cwd: string): Promise<{
  needsUpdate: boolean;
  outdatedDocs: string[];
}> {
  try {
    const docFiles = findDocFiles(cwd, ['docs/**/*.md', '**/*.md']);
    const codeChanges: FileChange[] = [];
    const syncStatus = checkDocSyncStatus(docFiles, codeChanges, 30);

    return {
      needsUpdate: syncStatus.outdated.length > 0,
      outdatedDocs: syncStatus.outdated.map(d => d.docPath),
    };
  } catch {
    return { needsUpdate: false, outdatedDocs: [] };
  }
}

/**
 * 创建 DocUpdateChecker 类
 * IPostDevPhaseChecker 接口实现
 */
export class DocUpdateChecker {
  readonly id = 'doc-update-checker';
  readonly name = '文档更新检查器';
  readonly description = '检查文档是否与代码实现同步';

  async check(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    return checkDocUpdates(rule, context);
  }
}

// 导出默认实例
export const docUpdateChecker = new DocUpdateChecker();
