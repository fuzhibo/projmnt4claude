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
    // 注意：--allowedTools 必须在 --print 之前，否则 Claude CLI 会报错
    // "Input must be provided either through stdin or as a prompt argument when using --print"
    const args = [
      '--allowedTools', options.allowedTools.join(','),
      '--print',
      options.prompt,
    ];

    try {
      const child = spawn('claude', args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeout * 1000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr || `进程退出码: ${code}` : undefined,
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
    result.passed = resultMatch[1].toUpperCase() === 'PASS';
  }

  const reasonPattern = new RegExp(`##\\s*${options.reasonField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const reasonMatch = output.match(reasonPattern);
  if (reasonMatch) {
    result.reason = reasonMatch[1].trim();
  }

  const listPattern = new RegExp(`##\\s*${options.listField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const listMatch = output.match(listPattern);
  if (listMatch) {
    const listText = listMatch[1].trim();
    if (listText && listText !== '无' && listText !== 'N/A') {
      result.items = listText.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0);
    }
  }

  const checkpointPattern = new RegExp(`##\\s*${options.checkpointField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
  const checkpointMatch = output.match(checkpointPattern);
  if (checkpointMatch) {
    const checkpointText = checkpointMatch[1].trim();
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
      result.details = detailsMatch[1].trim();
    }
  }

  if (!result.reason) {
    if (output.toLowerCase().includes('pass') && !output.toLowerCase().includes('nopass')) {
      result.passed = true;
      result.reason = '基于输出内容的简单判断';
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
