/**
 * Debug Logger - 调试日志记录器
 *
 * 为 Harness 流水线提供详细的调试日志记录能力
 * 仅在 --debug 模式启用时记录
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DebugLoggerOptions {
  /** 项目根目录 */
  cwd: string;
  /** 是否启用调试模式 */
  enabled: boolean;
}

export interface DebugLogEntry {
  /** 时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** 阶段 */
  phase: string;
  /** 消息 */
  message: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

export class DebugLogger {
  private options: DebugLoggerOptions;
  private logDir: string;

  constructor(options: DebugLoggerOptions) {
    this.options = options;
    this.logDir = path.join(options.cwd, '.projmnt4claude', 'logs', 'debug');

    if (options.enabled) {
      this.ensureLogDir();
    }
  }

  /**
   * 检查调试模式是否启用
   */
  isEnabled(): boolean {
    return this.options.enabled;
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 获取任务日志目录
   */
  private getTaskLogDir(taskId: string): string {
    const taskDir = path.join(this.logDir, taskId);
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    return taskDir;
  }

  /**
   * 记录提示词
   */
  logPrompt(taskId: string, phase: string, prompt: string): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, `${phase}-prompt.md`);

    const content = `# Prompt - ${phase}\n\n**Task**: ${taskId}\n**Phase**: ${phase}\n**Time**: ${new Date().toISOString()}\n**Length**: ${prompt.length} chars\n\n---\n\n${prompt}`;

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * 记录 AI 响应
   */
  logAIResponse(taskId: string, phase: string, response: string, metadata?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, `${phase}-ai-response.json`);

    const data = {
      taskId,
      phase,
      timestamp: new Date().toISOString(),
      responseLength: response.length,
      response,
      metadata,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 记录阶段转换
   */
  logPhaseTransition(taskId: string, fromPhase: string, toPhase: string, reason?: string): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, 'phase-transition.log');

    const entry = `[${new Date().toISOString()}] ${fromPhase} -> ${toPhase}${reason ? ` | Reason: ${reason}` : ''}\n`;

    fs.appendFileSync(filePath, entry, 'utf-8');
  }

  /**
   * 记录重试上下文
   */
  logRetryContext(taskId: string, phase: string, retryContext: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, `${phase}-retry-context.json`);

    const data = {
      taskId,
      phase,
      timestamp: new Date().toISOString(),
      retryContext,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 记录错误
   */
  logError(taskId: string, phase: string, error: Error, context?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, `${phase}-error.log`);

    const content = `# Error - ${phase}\n\n**Task**: ${taskId}\n**Phase**: ${phase}\n**Time**: ${new Date().toISOString()}\n\n## Error Message\n\n${error.message}\n\n## Stack Trace\n\n\`\`\`\n${error.stack || 'No stack trace'}\n\`\`\`\n\n## Context\n\n\`\`\`json\n${JSON.stringify(context || {}, null, 2)}\n\`\`\`\n`;

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * 记录通用调试信息
   */
  log(taskId: string, phase: string, message: string, data?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const taskDir = this.getTaskLogDir(taskId);
    const filePath = path.join(taskDir, 'debug.log');

    const entry = `[${new Date().toISOString()}] [${phase}] ${message}${data ? ` | ${JSON.stringify(data)}` : ''}\n`;

    fs.appendFileSync(filePath, entry, 'utf-8');
  }
}
