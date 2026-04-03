/**
 * Harness 公共工具模块
 *
 * 提取公共代码，避免重复
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { getProjectDir } from './path.js';

// ============================================================
// 常量定义
// ============================================================

/** 默认超时时间（秒） */
export const DEFAULT_TIMEOUT_SECONDS = 300;

/** 审核阶段超时比例（使用总超时的 1/3） */
export const REVIEW_TIMEOUT_RATIO = 3;

// ============================================================
// 类型定义
// ============================================================

export interface HeadlessClaudeOptions {
  prompt: string;
  allowedTools: string[];
  timeout: number;
  cwd: string;
}

export interface HeadlessClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  hookWarning?: string;
}

/**
 * 分析 Headless Claude 的 exit code 和 stderr，区分 hook 失败和任务失败。
 *
 * Hook 失败（如 SessionEnd hook cancelled）不应阻断流水线：
 * - hook 失败 + stdout 有有效输出 → 视为成功，附带警告
 * - hook 失败 + stdout 为空 → 保守判定为失败
 * - 非 hook 错误 → 真实的任务失败
 */
export function classifyExitResult(
  code: number | null,
  stderr: string,
  stdout: string
): { success: boolean; error?: string; hookWarning?: string } {
  if (code === 0) {
    return { success: true };
  }

  const isHookError = /hook\s+.*\s+failed/i.test(stderr)
    || /Hook cancelled/i.test(stderr)
    || /SessionEnd\s+hook/i.test(stderr);
  const hasOutput = stdout.trim().length > 0;

  if (isHookError && hasOutput) {
    return {
      success: true,
      hookWarning: `Hook 错误已忽略: ${stderr.substring(0, 200)}`,
    };
  }

  if (isHookError && !hasOutput) {
    return {
      success: false,
      error: `Hook 错误导致无输出: ${stderr.substring(0, 200)}`,
    };
  }

  return {
    success: false,
    error: stderr || `进程退出码: ${code}`,
  };
}

export interface ParseVerdictOptions {
  resultField: string;
  reasonField: string;
  listField: string;
  checkpointField: string;
  detailsField?: string;
}

export interface ParsedVerdict {
  passed: boolean;
  reason: string;
  items: string[];
  failedCheckpoints: string[];
  details?: string;
}

// ============================================================
// 公共函数
// ============================================================

export async function runHeadlessClaude(options: HeadlessClaudeOptions): Promise<HeadlessClaudeResult> {
  return new Promise((resolve) => {
    // 注意：prompt 通过 stdin 传递，而不是命令行参数
    // 这样可以避免多行文本作为命令行参数时的解析问题
    const args = [
      '--allowedTools', options.allowedTools.join(','),
      '--print',
    ];

    try {
      const child = spawn('claude', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],  // stdin 改为 pipe 以支持写入
        timeout: options.timeout * 1000,
      });

      // 通过 stdin 传递 prompt
      if (child.stdin) {
        child.stdin.write(options.prompt);
        child.stdin.end();
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const classified = classifyExitResult(code, stderr, stdout);
        resolve({
          success: classified.success,
          output: stdout,
          error: classified.error,
          hookWarning: classified.hookWarning,
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          error: error.message,
        });
      });

    } catch (error) {
      resolve({
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * 检测是否为可重试的 API 错误
 * 统一的 API 重试判断逻辑，供所有 Harness 阶段共用
 *
 * 重试条件: HTTP 429, 500, 网络超时, 进程异常退出
 */
export function isRetryableError(output: string, stderr: string): { retryable: boolean; waitSeconds?: number; reason?: string } {
  const combinedOutput = `${output} ${stderr}`;

  // 429 Rate Limit
  const rateLimitMatch = combinedOutput.match(/API Error:\s*429.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (rateLimitMatch) {
    const resetTime = new Date(rateLimitMatch[1]!);
    const now = new Date();
    const waitSeconds = Math.max(60, Math.ceil((resetTime.getTime() - now.getTime()) / 1000));
    return { retryable: true, waitSeconds, reason: 'API 速率限制 (429)' };
  }

  // 500 Server Error
  if (combinedOutput.includes('API Error: 500') || combinedOutput.includes('"code":"500"')) {
    return { retryable: true, waitSeconds: 30, reason: 'API 服务器错误 (500)' };
  }

  // Network/Connection errors
  if (combinedOutput.includes('ECONNRESET') ||
      combinedOutput.includes('ETIMEDOUT') ||
      combinedOutput.includes('ENOTFOUND') ||
      combinedOutput.includes('network error')) {
    return { retryable: true, waitSeconds: 10, reason: '网络连接错误' };
  }

  return { retryable: false };
}

/**
 * 延迟函数（秒）
 */
export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * API 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数（不含首次调用） */
  maxAttempts: number;
  /** 基础延迟（秒），使用指数退避 */
  baseDelay: number;
}

/**
 * 运行 Headless Claude（带 API 级重试机制）
 *
 * 统一的重试封装，供 Code Review / QA / Evaluation 等阶段共用。
 * 重试条件: HTTP 429, 500, 网络超时, 进程异常退出
 */
export async function runHeadlessClaudeWithRetry(
  options: HeadlessClaudeOptions,
  retryConfig: RetryConfig,
): Promise<HeadlessClaudeResult> {
  const maxAttempts = retryConfig.maxAttempts + 1; // +1 因为第一次不算重试
  let lastResult: HeadlessClaudeResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.log(`   🔄 API 调用重试 (${attempt - 1}/${retryConfig.maxAttempts})...`);
    }

    lastResult = await runHeadlessClaude(options);

    if (lastResult.success) {
      return lastResult;
    }

    // 检查是否为可重试错误
    const errorInfo = isRetryableError(lastResult.output, lastResult.error || '');

    if (!errorInfo.retryable || attempt >= maxAttempts) {
      return lastResult;
    }

    // 计算退避延迟（指数退避）
    const delay = Math.min(errorInfo.waitSeconds || retryConfig.baseDelay, retryConfig.baseDelay * Math.pow(2, attempt - 1));
    console.log(`   ⏳ ${errorInfo.reason}，${delay} 秒后重试...`);

    await sleep(delay);
  }

  return lastResult!;
}

export async function saveReport(reportPath: string, content: string): Promise<void> {
  const dir = path.dirname(reportPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(reportPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`保存报告失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function filterCheckpoints(
  task: TaskMeta,
  filterFn: (checkpoint: CheckpointMetadata) => boolean
): CheckpointMetadata[] {
  if (!task.checkpoints) {
    return [];
  }
  return task.checkpoints.filter(filterFn);
}

export function parseVerdictResult(
  output: string,
  options: ParseVerdictOptions
): ParsedVerdict {
  const result: ParsedVerdict = {
    passed: true,
    reason: '',
    items: [],
    failedCheckpoints: [],
    details: '',
  };

  const resultPattern = new RegExp(`##\\s*${options.resultField}\\s*[:：]\\s*(PASS|NOPASS)`, 'i');
  const resultMatch = output.match(resultPattern);
  if (resultMatch) {
    result.passed = resultMatch[1]!.toUpperCase() === 'PASS';
  }

  const reasonPattern = new RegExp(`##\\s*${options.reasonField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const reasonMatch = output.match(reasonPattern);
  if (reasonMatch) {
    result.reason = reasonMatch[1]!.trim();
  }

  const listPattern = new RegExp(`##\\s*${options.listField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const listMatch = output.match(listPattern);
  if (listMatch) {
    const listText = listMatch[1]!.trim();
    if (listText && listText !== '无' && listText !== 'N/A') {
      result.items = listText.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0);
    }
  }

  const checkpointPattern = new RegExp(`##\\s*${options.checkpointField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const checkpointMatch = output.match(checkpointPattern);
  if (checkpointMatch) {
    const checkpointText = checkpointMatch[1]!.trim();
    if (checkpointText && checkpointText !== '无' && checkpointText !== 'N/A') {
      result.failedCheckpoints = checkpointText.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0);
    }
  }

  if (options.detailsField) {
    const detailsPattern = new RegExp(`##\\s*${options.detailsField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
    const detailsMatch = output.match(detailsPattern);
    if (detailsMatch) {
      result.details = detailsMatch[1]!.trim();
    }
  }

  // 结构化格式未匹配时，增加中文情感判断（排除格式标题干扰）
  if (!resultMatch) {
    const contentWithoutHeaders = output.replace(/^##\s*(?:未满足|未完成|失败|缺失|不通过).*$/gm, '');
    const hasPositive = /(?:通过|✅|成功|符合(?:要求)?|满足(?:标准|要求)?|良好|合格|达标|优秀|验收通过|质量良好|实现|完整|正确|正常|零错误|已实现|均已|无误)/.test(contentWithoutHeaders);
    const hasNegative = /(?:不通过|未通过|❌|失败|不符合|不满足|未满足|不合格|未达标)/.test(contentWithoutHeaders);
    if (hasPositive && !hasNegative) {
      result.passed = true;
      result.reason = '基于输出内容的中文情感判断：通过';
    } else if (hasNegative) {
      result.passed = false;
      result.reason = '基于输出内容的中文情感判断：未通过';
    }
  }

  if (!result.reason) {
    if (output.toLowerCase().includes('pass') && !output.toLowerCase().includes('nopass')) {
      result.passed = true;
      result.reason = '基于输出内容的简单判断';
    } else if (/(?:审查通过|审核通过|验证通过|评估通过|验收通过|所有.*满足|全部.*通过|均已满足|完全符合|质量良好)/.test(output)) {
      result.passed = true;
      result.reason = '基于输出内容的简单判断：包含正向通过关键词';
    } else {
      result.reason = '无法解析判定结果';
    }
  }

  return result;
}

export function getReportDir(taskId: string, cwd: string): string {
  return path.join(getProjectDir(cwd), 'reports', 'harness', taskId);
}

export function getReportPath(taskId: string, reportType: string, cwd: string): string {
  return path.join(getReportDir(taskId, cwd), `${reportType}-report.md`);
}
