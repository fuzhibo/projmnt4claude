/**
 * Output Alignment Checker
 * 开发输出路径对齐检查器
 *
 * 职责:
 * - CP-001: 检查开发输出文件路径是否与预期一致
 * - CP-002: 检测路径漂移问题
 * - CP-003: 识别缺失和意外的文件
 *
 * @module post-dev-phase-gate/checkers/output-alignment-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseRule,
  PostDevPhaseCheckContext,
  PostDevPhaseCheckItemResult,
  OutputAlignmentCheckResult,
  PathDrift,
} from '../../../types/post-dev-phase-gate.js';

/**
 * 递归查找文件
 * @param dir - 目录路径
 * @param pattern - 文件扩展名模式（如 .ts）
 * @returns 匹配的文件路径列表
 */
function findFilesRecursive(dir: string, pattern?: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳过 node_modules 和 dist
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...findFilesRecursive(fullPath, pattern));
    } else if (entry.isFile()) {
      if (!pattern || entry.name.endsWith(pattern)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * 检查输出路径对齐
 * R-OUTPUT-001: 开发输出路径对齐检查主函数
 *
 * @param rule - 检查规则
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function checkOutputAlignment(
  rule: PostDevPhaseRule,
  context: PostDevPhaseCheckContext
): Promise<PostDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as {
      strictMode?: boolean;
      expectedOutputPaths?: string[];
      allowUnexpectedFiles?: boolean;
    } | undefined;

    const strictMode = config?.strictMode ?? true;
    const allowUnexpectedFiles = config?.allowUnexpectedFiles ?? false;

    // 获取期望的输出路径
    const expectedPaths = config?.expectedOutputPaths ?? getDefaultExpectedPaths(context);

    // 获取实际的输出路径
    const actualPaths = await getActualOutputPaths(context.cwd, context.taskId);

    // 分析路径对齐情况
    const alignmentResult = analyzePathAlignment(
      expectedPaths,
      actualPaths,
      strictMode,
      allowUnexpectedFiles
    );

    // 判断是否通过
    const passed = alignmentResult.aligned &&
      alignmentResult.missingPaths.length === 0 &&
      (allowUnexpectedFiles || alignmentResult.unexpectedPaths.length === 0);

    // 生成消息
    const message = generateAlignmentMessage(alignmentResult);

    // 生成建议
    const suggestions = generateAlignmentSuggestions(alignmentResult);

    return {
      checkId: 'output-alignment-check',
      checkName: '开发输出路径对齐检查',
      ruleId: rule.id,
      passed,
      severity: passed ? 'info' : rule.severity,
      message,
      details: alignmentResult as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      autoFixable: alignmentResult.pathDrifts.some(d => d.autoFixable),
    };
  } catch (error) {
    return {
      checkId: 'output-alignment-check',
      checkName: '开发输出路径对齐检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `输出对齐检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 获取默认期望输出路径
 */
function getDefaultExpectedPaths(context: PostDevPhaseCheckContext): string[] {
  const taskId = context.taskId;
  const patterns = [
    'src/**/*.{ts,js}',
    'tests/**/*.{test,spec}.{ts,js}',
    `docs/${taskId}/**/*.md`,
    `.projmnt4claude/outputs/${taskId}/output.json`,
    `.projmnt4claude/outputs/${taskId}/interface.json`,
  ];

  return patterns;
}

/**
 * 获取实际的输出路径
 */
async function getActualOutputPaths(cwd: string, taskId: string): Promise<string[]> {
  const actualPaths: string[] = [];

  try {
    // 查找源文件
    const srcPath = path.join(cwd, 'src');
    if (fs.existsSync(srcPath)) {
      const srcFiles = findFilesRecursive(srcPath, '.ts');
      actualPaths.push(...srcFiles.map(f => path.relative(cwd, f)));

      const jsFiles = findFilesRecursive(srcPath, '.js');
      actualPaths.push(...jsFiles.map(f => path.relative(cwd, f)));
    }

    // 查找测试文件
    const testDirs = ['tests', '__tests__', path.join('src', '__tests__')];
    for (const testDir of testDirs) {
      const fullTestPath = path.join(cwd, testDir);
      if (fs.existsSync(fullTestPath)) {
        const testFiles = findFilesRecursive(fullTestPath);
        actualPaths.push(...testFiles.map(f => path.relative(cwd, f)));
      }
    }

    // 查找 .test.ts 和 .spec.ts 文件
    const allFiles = findFilesRecursive(cwd);
    const testPatternFiles = allFiles.filter(f => {
      const basename = path.basename(f);
      return basename.includes('.test.') || basename.includes('.spec.');
    });
    actualPaths.push(...testPatternFiles.map(f => path.relative(cwd, f)));

    // 查找输出目录
    const outputDir = path.join(cwd, '.projmnt4claude', 'outputs', taskId);
    if (fs.existsSync(outputDir)) {
      const outputFiles = findFilesRecursive(outputDir);
      actualPaths.push(...outputFiles.map(f => path.relative(cwd, f)));
    }

    // 去重
    return Array.from(new Set(actualPaths));
  } catch {
    return actualPaths;
  }
}

/**
 * 分析路径对齐情况
 */
function analyzePathAlignment(
  expectedPaths: string[],
  actualPaths: string[],
  strictMode: boolean,
  allowUnexpectedFiles: boolean
): OutputAlignmentCheckResult {
  const missingPaths: string[] = [];
  const unexpectedPaths: string[] = [];
  const pathDrifts: PathDrift[] = [];

  // 将期望路径分为具体路径和模式
  const concreteExpectedPaths: string[] = [];
  const expectedPatterns: string[] = [];

  for (const expectedPath of expectedPaths) {
    if (expectedPath.includes('*')) {
      expectedPatterns.push(expectedPath);
    } else {
      concreteExpectedPaths.push(expectedPath);
    }
  }

  // 检查具体期望路径
  for (const expectedPath of concreteExpectedPaths) {
    const normalizedExpected = expectedPath.replace(/\\/g, '/');
    const found = actualPaths.some(actual => {
      const normalizedActual = actual.replace(/\\/g, '/');
      return normalizedActual === normalizedExpected ||
        normalizedActual.endsWith(normalizedExpected);
    });

    if (!found) {
      missingPaths.push(expectedPath);
      pathDrifts.push({
        expectedPath,
        actualPath: '',
        driftType: 'missing',
        autoFixable: false,
      });
    }
  }

  // 检查模式匹配
  for (const pattern of expectedPatterns) {
    // 简化模式匹配检查 - 实际实现可能需要更复杂的 glob 匹配
    const matched = actualPaths.some(actual => {
      const patternRegex = pattern
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*');
      const regex = new RegExp(patternRegex);
      return regex.test(actual);
    });

    if (!matched && strictMode) {
      missingPaths.push(pattern);
    }
  }

  // 检查意外路径（仅在严格模式下）
  if (!allowUnexpectedFiles) {
    for (const actualPath of actualPaths) {
      const normalizedActual = actualPath.replace(/\\/g, '/');

      // 检查是否匹配任何期望路径
      const matchesConcrete = concreteExpectedPaths.some(expected => {
        const normalizedExpected = expected.replace(/\\/g, '/');
        return normalizedActual === normalizedExpected ||
          normalizedActual.endsWith(normalizedExpected);
      });

      // 检查是否匹配任何模式
      const matchesPattern = expectedPatterns.some(ptn => {
        const patternRegex = ptn
          .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
          .replace(/\*/g, '[^/]*')
          .replace(/<<<DOUBLESTAR>>>/g, '.*');
        const regex = new RegExp(patternRegex);
        return regex.test(normalizedActual);
      });

      if (!matchesConcrete && !matchesPattern) {
        unexpectedPaths.push(actualPath);
      }
    }
  }

  return {
    aligned: missingPaths.length === 0 && (allowUnexpectedFiles || unexpectedPaths.length === 0),
    expectedPaths,
    actualPaths,
    missingPaths,
    unexpectedPaths,
    pathDrifts,
  };
}

/**
 * 生成对齐检查消息
 */
function generateAlignmentMessage(result: OutputAlignmentCheckResult): string {
  if (result.aligned) {
    return `输出路径对齐检查通过 (${result.actualPaths.length} 个文件)`;
  }

  const parts: string[] = [];
  if (result.missingPaths.length > 0) {
    parts.push(`${result.missingPaths.length} 个期望文件缺失`);
  }
  if (result.unexpectedPaths.length > 0) {
    parts.push(`${result.unexpectedPaths.length} 个意外文件`);
  }

  return `输出路径对齐检查失败: ${parts.join(', ')}`;
}

/**
 * 生成对齐修复建议
 */
function generateAlignmentSuggestions(result: OutputAlignmentCheckResult): string[] {
  const suggestions: string[] = [];

  if (result.missingPaths.length > 0) {
    suggestions.push(`创建缺失的文件: ${result.missingPaths.join(', ')}`);
    suggestions.push('检查文件是否被错误地创建在其他位置');
  }

  if (result.unexpectedPaths.length > 0) {
    suggestions.push(`检查意外文件: ${result.unexpectedPaths.join(', ')}`);
    suggestions.push('如需保留这些文件，请更新期望路径配置');
  }

  if (result.pathDrifts.length > 0) {
    for (const drift of result.pathDrifts) {
      if (drift.autoFixable) {
        suggestions.push(`可自动修复路径漂移: ${drift.expectedPath} -> ${drift.actualPath}`);
      }
    }
  }

  return suggestions;
}

/**
 * 检查特定路径是否存在
 * R-OUTPUT-001-辅助函数
 */
export function checkPathExists(cwd: string, relativePath: string): boolean {
  const fullPath = path.join(cwd, relativePath);
  return fs.existsSync(fullPath);
}

/**
 * 获取路径漂移详细信息
 * R-OUTPUT-001-辅助函数
 */
export function analyzePathDrift(
  cwd: string,
  expectedPath: string,
  actualPaths: string[]
): PathDrift | null {
  const normalizedExpected = expectedPath.replace(/\\/g, '/');
  const expectedBasename = path.basename(expectedPath);

  // 检查是否有同名文件在不同位置
  for (const actualPath of actualPaths) {
    const normalizedActual = actualPath.replace(/\\/g, '/');
    const actualBasename = path.basename(actualPath);

    if (actualBasename === expectedBasename && normalizedActual !== normalizedExpected) {
      return {
        expectedPath: normalizedExpected,
        actualPath: normalizedActual,
        driftType: 'moved',
        autoFixable: true,
      };
    }

    // 检查是否文件名相似（可能只是大小写或扩展名不同）
    if (actualBasename.toLowerCase() === expectedBasename.toLowerCase()) {
      return {
        expectedPath: normalizedExpected,
        actualPath: normalizedActual,
        driftType: 'renamed',
        autoFixable: true,
      };
    }
  }

  return null;
}

/**
 * 创建 OutputAlignmentChecker 类
 * IPostDevPhaseChecker 接口实现
 */
export class OutputAlignmentChecker {
  readonly id = 'output-alignment-checker';
  readonly name = '输出对齐检查器';
  readonly description = '检查开发输出文件路径是否与预期一致';

  async check(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    return checkOutputAlignment(rule, context);
  }
}

// 导出默认实例
export const outputAlignmentChecker = new OutputAlignmentChecker();
