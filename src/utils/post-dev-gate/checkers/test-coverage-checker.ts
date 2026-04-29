/**
 * Test Coverage Checker
 * 测试覆盖检查器
 *
 * 职责:
 * - CP-001: 检查测试覆盖率是否达标
 * - CP-002: 检测未测试的代码
 * - CP-003: 验证测试文件与源文件对应关系
 *
 * @module post-dev-phase-gate/checkers/test-coverage-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseRule,
  PostDevPhaseCheckContext,
  PostDevPhaseCheckItemResult,
} from '../../../types/post-dev-phase-gate.js';

/**
 * 测试覆盖检查结果
 */
export interface TestCoverageCheckResult {
  /** 检查是否通过 */
  passed: boolean;
  /** 覆盖率评分 (0-100) */
  coverageScore: number;
  /** 行覆盖率百分比 */
  lineCoverage: number;
  /** 分支覆盖率百分比 */
  branchCoverage: number;
  /** 函数覆盖率百分比 */
  functionCoverage: number;
  /** 源文件总数 */
  totalSourceFiles: number;
  /** 有测试的文件数 */
  testedFiles: number;
  /** 无测试的文件数 */
  untestedFiles: number;
  /** 无测试文件列表 */
  untestedFileList: string[];
  /** 测试文件总数 */
  totalTestFiles: number;
  /** 测试与源文件对应关系 */
  testSourceMapping: TestSourceMapping[];
  /** 覆盖率报告是否存在 */
  coverageReportExists: boolean;
  /** 覆盖率报告路径 */
  coverageReportPath?: string;
}

/**
 * 测试与源文件映射
 */
export interface TestSourceMapping {
  /** 源文件路径 */
  sourceFile: string;
  /** 对应的测试文件路径 */
  testFile?: string;
  /** 是否有对应的测试 */
  hasTest: boolean;
}

/**
 * 覆盖率数据
 */
interface CoverageData {
  lines: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
}

/**
 * 检查测试覆盖
 * R-COVERAGE-001: 测试覆盖率检查主函数
 *
 * @param rule - 检查规则
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function checkTestCoverage(
  rule: PostDevPhaseRule,
  context: PostDevPhaseCheckContext
): Promise<PostDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as {
      minLineCoverage?: number;
      minBranchCoverage?: number;
      minFunctionCoverage?: number;
      minOverallScore?: number;
      requireCoverageReport?: boolean;
      sourcePatterns?: string[];
      testPatterns?: string[];
    } | undefined;

    const minLineCoverage = config?.minLineCoverage ?? 60;
    const minBranchCoverage = config?.minBranchCoverage ?? 50;
    const minFunctionCoverage = config?.minFunctionCoverage ?? 60;
    const minOverallScore = config?.minOverallScore ?? 60;
    const requireCoverageReport = config?.requireCoverageReport ?? false;
    const sourcePatterns = config?.sourcePatterns ?? ['src/**/*.ts'];
    const testPatterns = config?.testPatterns ?? ['**/*.test.ts', '**/*.spec.ts'];

    // 查找源文件
    const sourceFiles = findSourceFiles(context.cwd, sourcePatterns);

    // 查找测试文件
    const testFiles = findTestFiles(context.cwd, testPatterns);

    // 建立测试与源文件映射
    const testSourceMapping = buildTestSourceMapping(sourceFiles, testFiles, context.cwd);

    // 获取覆盖率数据
    const coverageData = await loadCoverageData(context.cwd);

    // 计算覆盖率评分
    const coverageScore = calculateCoverageScore(testSourceMapping, coverageData);

    // 计算各项指标
    const testedFiles = testSourceMapping.filter(m => m.hasTest).length;
    const untestedFiles = testSourceMapping.filter(m => !m.hasTest);
    const untestedFileList = untestedFiles.map(m => m.sourceFile);

    // 判断是否通过
    const passed =
      coverageData.lineCoverage >= minLineCoverage &&
      coverageData.branchCoverage >= minBranchCoverage &&
      coverageData.functionCoverage >= minFunctionCoverage &&
      coverageScore >= minOverallScore &&
      (!requireCoverageReport || coverageData.exists);

    // 生成结果
    const result: TestCoverageCheckResult = {
      passed,
      coverageScore,
      lineCoverage: coverageData.lineCoverage,
      branchCoverage: coverageData.branchCoverage,
      functionCoverage: coverageData.functionCoverage,
      totalSourceFiles: sourceFiles.length,
      testedFiles,
      untestedFiles: untestedFiles.length,
      untestedFileList,
      totalTestFiles: testFiles.length,
      testSourceMapping,
      coverageReportExists: coverageData.exists,
      coverageReportPath: coverageData.path,
    };

    // 生成消息
    const message = generateCoverageMessage(
      result,
      minLineCoverage,
      minBranchCoverage,
      minFunctionCoverage,
      minOverallScore
    );

    // 生成建议
    const suggestions = generateCoverageSuggestions(result, minLineCoverage);

    return {
      checkId: 'test-coverage-check',
      checkName: '测试覆盖检查',
      ruleId: rule.id,
      passed,
      severity: passed ? 'info' : rule.severity,
      message,
      details: result as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      autoFixable: false, // 测试覆盖问题无法自动修复
    };
  } catch (error) {
    return {
      checkId: 'test-coverage-check',
      checkName: '测试覆盖检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `测试覆盖检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 查找源文件
 */
function findSourceFiles(cwd: string, patterns: string[]): string[] {
  const results: string[] = [];

  for (const pattern of patterns) {
    const files = globMatch(cwd, pattern);
    results.push(...files);
  }

  // 去重并过滤测试文件
  return Array.from(new Set(results)).filter(f => !isTestFile(f));
}

/**
 * 查找测试文件
 */
function findTestFiles(cwd: string, patterns: string[]): string[] {
  const results: string[] = [];

  for (const pattern of patterns) {
    const files = globMatch(cwd, pattern);
    results.push(...files);
  }

  return Array.from(new Set(results));
}

/**
 * 简单的 glob 匹配实现
 */
function globMatch(cwd: string, pattern: string): string[] {
  const results: string[] = [];

  // 解析模式
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const parts = normalizedPattern.split('/');

  // 递归搜索
  function search(dir: string, patternParts: string[], currentPath: string): void {
    if (patternParts.length === 0) {
      return;
    }

    const currentPattern = patternParts[0];
    if (!currentPattern) {
      return;
    }
    const remainingParts = patternParts.slice(1);

    if (!fs.existsSync(dir)) {
      return;
    }

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
      // 通配符匹配
      const regex = new RegExp(
        '^' + currentPattern.replace(/\./g, '\\.').replace(/\*\*/g, '<<<DOTSTAR>>>').replace(/\*/g, '[^/]*').replace(/<<<DOTSTAR>>>/g, '.*') + '$'
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
      // 精确匹配
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
 * 判断是否为测试文件
 */
function isTestFile(filePath: string): boolean {
  const testPatterns = ['.test.', '.spec.', '__tests__', '__mocks__'];
  const normalizedPath = filePath.toLowerCase();
  return testPatterns.some(pattern => normalizedPath.includes(pattern.toLowerCase()));
}

/**
 * 建立测试与源文件映射
 */
function buildTestSourceMapping(
  sourceFiles: string[],
  testFiles: string[],
  cwd: string
): TestSourceMapping[] {
  return sourceFiles.map(sourceFile => {
    const testFile = findCorrespondingTestFile(sourceFile, testFiles, cwd);
    return {
      sourceFile,
      testFile,
      hasTest: !!testFile,
    };
  });
}

/**
 * 查找对应的测试文件
 */
function findCorrespondingTestFile(
  sourceFile: string,
  testFiles: string[],
  cwd: string
): string | undefined {
  // 提取文件名（不含扩展名）
  const basename = path.basename(sourceFile, path.extname(sourceFile));
  const dir = path.dirname(sourceFile);

  // 可能的测试文件名
  const possibleTestNames = [
    `${basename}.test.ts`,
    `${basename}.test.js`,
    `${basename}.spec.ts`,
    `${basename}.spec.js`,
  ];

  // 可能的测试文件路径
  const possiblePaths = [
    ...possibleTestNames.map(name => path.join(dir, name)),
    ...possibleTestNames.map(name => path.join(dir, '__tests__', name)),
    ...possibleTestNames.map(name => {
      // tests/ 目录下对应路径
      const relativeDir = dir.startsWith('src/') ? dir.slice(4) : dir;
      return path.join('tests', relativeDir, name);
    }),
  ];

  // 查找匹配的测试文件
  for (const testPath of possiblePaths) {
    const matched = testFiles.find(tf => {
      const normalizedTest = tf.replace(/\\/g, '/').toLowerCase();
      const normalizedPath = testPath.replace(/\\/g, '/').toLowerCase();
      return normalizedTest === normalizedPath || normalizedTest.endsWith(normalizedPath);
    });
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

/**
 * 加载覆盖率数据
 */
async function loadCoverageData(cwd: string): Promise<{
  exists: boolean;
  path?: string;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
}> {
  const coveragePaths = [
    'coverage/coverage-summary.json',
    'coverage/lcov-report/coverage-summary.json',
    '.nyc_output/coverage-summary.json',
  ];

  for (const coveragePath of coveragePaths) {
    const fullPath = path.join(cwd, coveragePath);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const data = JSON.parse(content);

        // 解析覆盖率数据
        const total = data.total || data;
        const lines = total.lines || total.line || { pct: 0 };
        const branches = total.branches || total.branch || { pct: 0 };
        const functions = total.functions || total.function || { pct: 0 };

        return {
          exists: true,
          path: coveragePath,
          lineCoverage: typeof lines.pct === 'number' ? lines.pct : 0,
          branchCoverage: typeof branches.pct === 'number' ? branches.pct : 0,
          functionCoverage: typeof functions.pct === 'number' ? functions.pct : 0,
        };
      } catch {
        // 继续尝试下一个路径
      }
    }
  }

  // 默认值
  return {
    exists: false,
    lineCoverage: 0,
    branchCoverage: 0,
    functionCoverage: 0,
  };
}

/**
 * 计算覆盖率评分
 */
function calculateCoverageScore(
  mapping: TestSourceMapping[],
  coverageData: {
    lineCoverage: number;
    branchCoverage: number;
    functionCoverage: number;
  }
): number {
  if (mapping.length === 0) {
    return 100;
  }

  // 计算有测试的文件比例
  const testedRatio = mapping.filter(m => m.hasTest).length / mapping.length;

  // 综合评分: 测试比例占40%, 覆盖率数据占60%
  const coverageAverage =
    (coverageData.lineCoverage + coverageData.branchCoverage + coverageData.functionCoverage) / 3;

  const score = testedRatio * 40 + (coverageAverage * 0.6);

  return Math.round(score);
}

/**
 * 生成覆盖率检查消息
 */
function generateCoverageMessage(
  result: TestCoverageCheckResult,
  minLine: number,
  minBranch: number,
  minFunction: number,
  minScore: number
): string {
  if (result.passed) {
    return `测试覆盖检查通过 (评分: ${result.coverageScore}, 行覆盖: ${result.lineCoverage}%)`;
  }

  const parts: string[] = [];

  if (result.lineCoverage < minLine) {
    parts.push(`行覆盖率 ${result.lineCoverage}% 低于阈值 ${minLine}%`);
  }

  if (result.branchCoverage < minBranch) {
    parts.push(`分支覆盖率 ${result.branchCoverage}% 低于阈值 ${minBranch}%`);
  }

  if (result.functionCoverage < minFunction) {
    parts.push(`函数覆盖率 ${result.functionCoverage}% 低于阈值 ${minFunction}%`);
  }

  if (result.coverageScore < minScore) {
    parts.push(`综合评分 ${result.coverageScore} 低于阈值 ${minScore}`);
  }

  if (!result.coverageReportExists) {
    parts.push('未找到覆盖率报告');
  }

  return `测试覆盖检查失败: ${parts.join(', ')}`;
}

/**
 * 生成覆盖率修复建议
 */
function generateCoverageSuggestions(
  result: TestCoverageCheckResult,
  minLineCoverage: number
): string[] {
  const suggestions: string[] = [];

  if (result.untestedFiles > 0) {
    suggestions.push(`${result.untestedFiles} 个源文件缺少测试:`);
    for (const file of result.untestedFileList.slice(0, 5)) {
      suggestions.push(`  - ${file}`);
    }
    if (result.untestedFileList.length > 5) {
      suggestions.push(`  ... 还有 ${result.untestedFileList.length - 5} 个文件`);
    }
  }

  if (result.lineCoverage < minLineCoverage) {
    suggestions.push(`行覆盖率不足 (${result.lineCoverage}% < ${minLineCoverage}%)`);
    suggestions.push('建议为未覆盖的代码行添加单元测试');
  }

  if (result.branchCoverage < 50) {
    suggestions.push('分支覆盖率较低，建议添加边界条件测试');
  }

  if (result.coverageScore < 60) {
    suggestions.push('综合测试覆盖率较低，建议增加测试用例');
  }

  if (!result.coverageReportExists) {
    suggestions.push('运行测试并生成覆盖率报告:');
    suggestions.push('  npm run test -- --coverage');
  }

  return suggestions;
}

/**
 * 获取测试覆盖统计
 * R-COVERAGE-001-辅助函数
 */
export async function getTestCoverageStats(
  cwd: string
): Promise<{
  totalSourceFiles: number;
  testedFiles: number;
  coveragePercent: number;
} | null> {
  try {
    const sourceFiles = findSourceFiles(cwd, ['src/**/*.ts']);
    const testFiles = findTestFiles(cwd, ['**/*.test.ts', '**/*.spec.ts']);
    const mapping = buildTestSourceMapping(sourceFiles, testFiles, cwd);
    const testedFiles = mapping.filter(m => m.hasTest).length;

    return {
      totalSourceFiles: sourceFiles.length,
      testedFiles,
      coveragePercent: sourceFiles.length > 0
        ? Math.round((testedFiles / sourceFiles.length) * 100)
        : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 获取未测试文件列表
 * R-COVERAGE-001-辅助函数
 */
export async function getUntestedFiles(cwd: string): Promise<string[]> {
  try {
    const sourceFiles = findSourceFiles(cwd, ['src/**/*.ts']);
    const testFiles = findTestFiles(cwd, ['**/*.test.ts', '**/*.spec.ts']);
    const mapping = buildTestSourceMapping(sourceFiles, testFiles, cwd);

    return mapping.filter(m => !m.hasTest).map(m => m.sourceFile);
  } catch {
    return [];
  }
}

/**
 * 创建 TestCoverageChecker 类
 * IPostDevPhaseChecker 接口实现
 */
export class TestCoverageChecker {
  readonly id = 'test-coverage-checker';
  readonly name = '测试覆盖检查器';
  readonly description = '检查测试覆盖率是否达标';

  async check(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    return checkTestCoverage(rule, context);
  }
}

// 导出默认实例
export const testCoverageChecker = new TestCoverageChecker();
