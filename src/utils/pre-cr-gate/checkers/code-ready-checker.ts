/**
 * Code Ready Checker
 * 代码就绪检查器 - 验证代码是否准备好进行代码审核
 *
 * 职责:
 * - 验证代码文件是否存在
 * - 验证代码语法有效性
 * - 验证代码构建可执行性
 * - 验证代码变更合理性
 *
 * @module pre-cr-gate/checkers/code-ready-checker
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { TaskMeta } from '../../../types/task.js';
import { readTaskMeta } from '../../task.js';

// ============== 检查结果类型定义 ==============

/**
 * 代码就绪检查项结果
 */
export interface CodeReadyCheckResult {
  /** 检查项ID */
  checkId: string;
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 代码就绪检查结果
 */
export interface CodeReadyCheckerResult {
  /** 任务ID */
  taskId: string;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 检查项结果列表 */
  checks: CodeReadyCheckResult[];
  /** 通过的检查项数 */
  passedCount: number;
  /** 失败的检查项数 */
  failedCount: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
}

/**
 * 代码就绪检查器配置
 */
export interface CodeReadyCheckerConfig {
  /** 是否启用检查 */
  enabled: boolean;
  /** 是否检查文件存在性 */
  checkFileExistence: boolean;
  /** 是否检查语法有效性 */
  checkSyntaxValidity: boolean;
  /** 是否检查构建可执行性 */
  checkBuildability: boolean;
  /** 是否检查变更大小 */
  checkChangeSize: boolean;
  /** 最大变更行数 */
  maxChangeLines: number;
  /** 是否检查二进制文件 */
  checkBinaryFiles: boolean;
  /** 支持的语法检查文件扩展名 */
  syntaxCheckExtensions: string[];
  /** 构建命令 */
  buildCommand: string;
  /** 语法检查命令（根据文件类型动态选择） */
  getSyntaxCheckCommand: (filePath: string) => string | null;
}

/**
 * 默认配置
 */
export const DEFAULT_CODE_READY_CHECKER_CONFIG: CodeReadyCheckerConfig = {
  enabled: true,
  checkFileExistence: true,
  checkSyntaxValidity: true,
  checkBuildability: true,
  checkChangeSize: true,
  maxChangeLines: 500,
  checkBinaryFiles: true,
  syntaxCheckExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md'],
  buildCommand: 'bun run build',
  getSyntaxCheckCommand: (filePath: string): string | null => {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'npx tsc --noEmit';
      case '.js':
      case '.jsx':
        return 'npx eslint --no-eslintrc --parser-options ecmaVersion:2022';
      case '.json':
        return 'node -e "JSON.parse(require(\'fs\').readFileSync(process.argv[1]))"';
      default:
        return null;
    }
  },
};

// ============== CodeReadyChecker 类 ==============

/**
 * 代码就绪检查器
 *
 * 专门用于验证代码是否准备好进行代码审核，确保代码文件
 * 存在、语法正确且可以成功构建。
 */
export class CodeReadyChecker {
  private config: CodeReadyCheckerConfig;
  private cwd: string;

  /**
   * 创建代码就绪检查器实例
   *
   * @param cwd 工作目录
   * @param config 可选配置
   */
  constructor(cwd: string, config?: Partial<CodeReadyCheckerConfig>) {
    this.cwd = cwd;
    this.config = {
      ...DEFAULT_CODE_READY_CHECKER_CONFIG,
      ...config,
    };
  }

  /**
   * 执行代码就绪检查
   *
   * @param taskId 任务ID
   * @returns 检查结果
   */
  async check(taskId: string): Promise<CodeReadyCheckerResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // 如果禁用了检查，直接返回通过
    if (!this.config.enabled) {
      return {
        taskId,
        allPassed: true,
        checks: [{
          checkId: 'disabled',
          name: '检查已禁用',
          passed: true,
          message: '代码就绪检查已禁用',
          duration: 0,
          timestamp,
        }],
        passedCount: 1,
        failedCount: 0,
        duration: 0,
        timestamp,
      };
    }

    // 读取任务元数据
    const task = readTaskMeta(taskId, this.cwd);
    if (!task) {
      return {
        taskId,
        allPassed: false,
        checks: [{
          checkId: 'task-existence',
          name: '任务存在性检查',
          passed: false,
          message: `任务 ${taskId} 不存在`,
          duration: 0,
          timestamp,
        }],
        passedCount: 0,
        failedCount: 1,
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    // 执行各项检查
    const checks: CodeReadyCheckResult[] = [];

    // 1. 代码文件存在性检查
    if (this.config.checkFileExistence) {
      checks.push(await this.checkFileExistence(task));
    }

    // 2. 语法有效性检查
    if (this.config.checkSyntaxValidity) {
      checks.push(await this.checkSyntaxValidity(task));
    }

    // 3. 构建可执行性检查
    if (this.config.checkBuildability) {
      checks.push(await this.checkBuildability());
    }

    // 4. 变更大小检查
    if (this.config.checkChangeSize) {
      checks.push(await this.checkChangeSize(task));
    }

    // 5. 二进制文件检查
    if (this.config.checkBinaryFiles) {
      checks.push(await this.checkBinaryFiles(task));
    }

    // 计算结果
    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const allPassed = failedCount === 0;

    return {
      taskId,
      allPassed,
      checks,
      passedCount,
      failedCount,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查代码文件存在性
   */
  private async checkFileExistence(task: TaskMeta): Promise<CodeReadyCheckResult> {
    const startTime = Date.now();

    const filesToCheck: string[] = [];

    // 收集需要检查的文件
    if (task.affected_files) {
      filesToCheck.push(...task.affected_files);
    }

    if (task.files) {
      filesToCheck.push(...task.files);
    }

    // 如果没有配置任何文件
    if (filesToCheck.length === 0) {
      return {
        checkId: 'file-existence',
        name: '代码文件存在性检查',
        passed: true,
        message: '未配置相关文件，跳过存在性检查',
        details: {
          totalFiles: 0,
          existingFiles: [],
          missingFiles: [],
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查文件存在性
    const existingFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const filePath of filesToCheck) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.cwd, filePath);

      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      } else {
        missingFiles.push(filePath);
      }
    }

    const passed = missingFiles.length === 0;

    return {
      checkId: 'file-existence',
      name: '代码文件存在性检查',
      passed,
      message: passed
        ? `所有代码文件已存在 (${existingFiles.length}/${filesToCheck.length})`
        : `缺少代码文件: ${missingFiles.join(', ')}`,
      details: {
        totalFiles: filesToCheck.length,
        existingFiles,
        missingFiles,
        affectedFiles: task.affected_files ?? [],
        files: task.files ?? [],
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查语法有效性
   */
  private async checkSyntaxValidity(task: TaskMeta): Promise<CodeReadyCheckResult> {
    const startTime = Date.now();

    const filesToCheck: string[] = [];

    // 收集需要检查的文件
    if (task.affected_files) {
      filesToCheck.push(...task.affected_files);
    }

    if (task.files) {
      filesToCheck.push(...task.files);
    }

    // 过滤出需要检查语法的文件
    const syntaxCheckFiles = filesToCheck.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return this.config.syntaxCheckExtensions.includes(ext);
    });

    // 如果没有需要检查语法的文件
    if (syntaxCheckFiles.length === 0) {
      return {
        checkId: 'syntax-validity',
        name: '语法有效性检查',
        passed: true,
        message: '没有需要检查语法的文件',
        details: {
          totalFiles: 0,
          validFiles: [],
          invalidFiles: [],
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查每个文件的语法
    const validFiles: Array<{ path: string; message: string }> = [];
    const invalidFiles: Array<{ path: string; error: string }> = [];

    for (const filePath of syntaxCheckFiles) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.cwd, filePath);

      if (!fs.existsSync(fullPath)) {
        invalidFiles.push({ path: filePath, error: '文件不存在' });
        continue;
      }

      const result = await this.validateFileSyntax(fullPath, filePath);
      if (result.valid) {
        validFiles.push({ path: filePath, message: result.message || '语法有效' });
      } else {
        invalidFiles.push({ path: filePath, error: result.error || '语法错误' });
      }
    }

    const passed = invalidFiles.length === 0;

    return {
      checkId: 'syntax-validity',
      name: '语法有效性检查',
      passed,
      message: passed
        ? `所有文件语法有效 (${validFiles.length}/${syntaxCheckFiles.length})`
        : `${invalidFiles.length} 个文件语法错误: ${invalidFiles.map(f => `${f.path}(${f.error})`).join(', ')}`,
      details: {
        totalFiles: syntaxCheckFiles.length,
        validFiles: validFiles.map(f => f.path),
        invalidFiles,
        checkedExtensions: this.config.syntaxCheckExtensions,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 验证单个文件的语法
   */
  private async validateFileSyntax(
    fullPath: string,
    relativePath: string
  ): Promise<{ valid: boolean; message?: string; error?: string }> {
    const ext = path.extname(fullPath).toLowerCase();

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');

      switch (ext) {
        case '.json': {
          try {
            JSON.parse(content);
            return { valid: true, message: 'JSON 格式有效' };
          } catch (e) {
            return { valid: false, error: `JSON 解析错误: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        case '.ts':
        case '.tsx': {
          // 使用 TypeScript 编译器检查语法
          const result = await this.runCommand('npx', ['tsc', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'node', fullPath], { cwd: this.cwd, timeout: 30000 });
          if (result.success) {
            return { valid: true, message: 'TypeScript 语法有效' };
          } else {
            return { valid: false, error: result.stderr || 'TypeScript 语法错误' };
          }
        }

        case '.js':
        case '.jsx': {
          // 使用 Node.js 解析 JavaScript
          try {
            // 使用 esprima 或类似的解析器，或者简单的语法检查
            new Function(content);
            return { valid: true, message: 'JavaScript 语法有效' };
          } catch (e) {
            return { valid: false, error: `JavaScript 语法错误: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        case '.md': {
          // Markdown 文件检查基本格式
          if (content.length === 0) {
            return { valid: false, error: 'Markdown 文件为空' };
          }
          return { valid: true, message: 'Markdown 格式有效' };
        }

        default:
          return { valid: true, message: `不检查 ${ext} 文件的语法` };
      }
    } catch (error) {
      return { valid: false, error: `读取文件失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 检查构建可执行性
   */
  private async checkBuildability(): Promise<CodeReadyCheckResult> {
    const startTime = Date.now();

    // 检查是否有构建配置文件
    const buildConfigs = ['package.json', 'tsconfig.json', 'vite.config.ts', 'webpack.config.js'];
    const hasBuildConfig = buildConfigs.some(config =>
      fs.existsSync(path.join(this.cwd, config))
    );

    if (!hasBuildConfig) {
      return {
        checkId: 'buildability',
        name: '构建可执行性检查',
        passed: true,
        message: '未找到构建配置，跳过构建检查',
        details: {
          hasBuildConfig: false,
          buildCommand: this.config.buildCommand,
          output: null,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查 package.json 中的 build 脚本
    const packageJsonPath = path.join(this.cwd, 'package.json');
    let hasBuildScript = false;

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        hasBuildScript = !!packageJson.scripts?.build;
      } catch {
        // 忽略解析错误
      }
    }

    if (!hasBuildScript) {
      return {
        checkId: 'buildability',
        name: '构建可执行性检查',
        passed: true,
        message: '没有配置 build 脚本，跳过构建检查',
        details: {
          hasBuildConfig: true,
          hasBuildScript: false,
          buildCommand: this.config.buildCommand,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 执行构建命令
    const buildResult = await this.runCommand('bun', ['run', 'build'], {
      cwd: this.cwd,
      timeout: 120000,
    });

    const passed = buildResult.success;

    return {
      checkId: 'buildability',
      name: '构建可执行性检查',
      passed,
      message: passed
        ? '代码构建成功'
        : `代码构建失败: ${buildResult.stderr || buildResult.stdout || '未知错误'}`,
      details: {
        hasBuildConfig: true,
        hasBuildScript: true,
        buildCommand: this.config.buildCommand,
        exitCode: buildResult.exitCode,
        output: buildResult.stdout,
        error: buildResult.stderr,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查变更大小
   */
  private async checkChangeSize(task: TaskMeta): Promise<CodeReadyCheckResult> {
    const startTime = Date.now();

    const filesToCheck: string[] = [];

    // 收集需要检查的文件
    if (task.affected_files) {
      filesToCheck.push(...task.affected_files);
    }

    if (task.files) {
      filesToCheck.push(...task.files);
    }

    if (filesToCheck.length === 0) {
      return {
        checkId: 'change-size',
        name: '变更大小检查',
        passed: true,
        message: '未配置相关文件，跳过变更大小检查',
        details: {
          totalFiles: 0,
          totalLines: 0,
          maxLines: this.config.maxChangeLines,
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 计算总变更行数
    let totalLines = 0;
    const fileLineCounts: Array<{ path: string; lines: number }> = [];

    for (const filePath of filesToCheck) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.cwd, filePath);

      if (!fs.existsSync(fullPath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n').length;
        totalLines += lines;
        fileLineCounts.push({ path: filePath, lines });
      } catch {
        // 忽略读取错误
      }
    }

    const passed = totalLines <= this.config.maxChangeLines;

    return {
      checkId: 'change-size',
      name: '变更大小检查',
      passed,
      message: passed
        ? `变更行数在合理范围内 (${totalLines} <= ${this.config.maxChangeLines})`
        : `变更行数过多 (${totalLines} > ${this.config.maxChangeLines})，建议拆分任务`,
      details: {
        totalFiles: filesToCheck.length,
        totalLines,
        maxLines: this.config.maxChangeLines,
        fileLineCounts,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查二进制文件
   */
  private async checkBinaryFiles(task: TaskMeta): Promise<CodeReadyCheckResult> {
    const startTime = Date.now();

    const filesToCheck: string[] = [];

    // 收集需要检查的文件
    if (task.affected_files) {
      filesToCheck.push(...task.affected_files);
    }

    if (task.files) {
      filesToCheck.push(...task.files);
    }

    if (filesToCheck.length === 0) {
      return {
        checkId: 'binary-files',
        name: '二进制文件检查',
        passed: true,
        message: '未配置相关文件，跳过二进制文件检查',
        details: {
          totalFiles: 0,
          binaryFiles: [],
        },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 检查二进制文件
    const binaryExtensions = ['.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite'];
    const binaryFiles: string[] = [];

    for (const filePath of filesToCheck) {
      const ext = path.extname(filePath).toLowerCase();
      if (binaryExtensions.includes(ext)) {
        binaryFiles.push(filePath);
      }
    }

    const passed = binaryFiles.length === 0;

    return {
      checkId: 'binary-files',
      name: '二进制文件检查',
      passed,
      message: passed
        ? '没有大型二进制文件变更'
        : `发现 ${binaryFiles.length} 个二进制文件: ${binaryFiles.join(', ')}`,
      details: {
        totalFiles: filesToCheck.length,
        binaryFiles,
        binaryExtensions,
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 运行命令
   */
  private runCommand(
    command: string,
    args: string[],
    options: { cwd: string; timeout?: number }
  ): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = options.timeout ?? 60000;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: `命令执行超时 (${timeout}ms)`,
        });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: error.message,
        });
      });
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CodeReadyCheckerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CodeReadyCheckerConfig {
    return { ...this.config };
  }
}

// ============== 便捷函数 ==============

/**
 * 创建代码就绪检查器实例
 *
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns CodeReadyChecker 实例
 */
export function createCodeReadyChecker(
  cwd: string,
  config?: Partial<CodeReadyCheckerConfig>
): CodeReadyChecker {
  return new CodeReadyChecker(cwd, config);
}

/**
 * 快速执行代码就绪检查
 *
 * @param taskId 任务ID
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果
 */
export async function quickCodeReadyCheck(
  taskId: string,
  cwd: string = process.cwd(),
  config?: Partial<CodeReadyCheckerConfig>
): Promise<CodeReadyCheckerResult> {
  const checker = new CodeReadyChecker(cwd, config);
  return checker.check(taskId);
}

/**
 * 批量执行代码就绪检查
 *
 * @param taskIds 任务ID列表
 * @param cwd 工作目录
 * @param config 可选配置
 * @returns 检查结果列表
 */
export async function batchCodeReadyCheck(
  taskIds: string[],
  cwd: string = process.cwd(),
  config?: Partial<CodeReadyCheckerConfig>
): Promise<CodeReadyCheckerResult[]> {
  const checker = new CodeReadyChecker(cwd, config);
  const results: CodeReadyCheckerResult[] = [];

  for (const taskId of taskIds) {
    const result = await checker.check(taskId);
    results.push(result);
  }

  return results;
}

/**
 * 格式化检查结果为终端输出
 *
 * @param result 检查结果
 * @returns 格式化字符串
 */
export function formatCodeReadyResult(result: CodeReadyCheckerResult): string {
  const lines: string[] = [];
  const separator = '━'.repeat(60);

  lines.push('');
  lines.push(separator);
  lines.push(`${result.allPassed ? '✅' : '❌'} 代码就绪检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  // 总体结果
  lines.push(`📊 总体结果: ${result.allPassed ? '通过' : '失败'}`);
  lines.push(`   通过: ${result.passedCount}/${result.checks.length}`);
  lines.push(`   失败: ${result.failedCount}/${result.checks.length}`);
  lines.push('');

  // 详细结果
  if (result.checks.length > 0) {
    lines.push('🔍 详细结果:');
    lines.push('');

    for (const check of result.checks) {
      const icon = check.passed ? '✅' : '❌';
      lines.push(`   ${icon} ${check.name}`);
      lines.push(`      ${check.message}`);
      lines.push('');
    }
  }

  // 执行时长
  lines.push(`⏱️  执行时长: ${result.duration}ms`);
  lines.push('');
  lines.push(separator);

  return lines.join('\n');
}

export default CodeReadyChecker;
