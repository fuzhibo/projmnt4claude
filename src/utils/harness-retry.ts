/**
 * RetryHandler - 重试机制
 *
 * 负责：
 * - 判断是否应该重试
 * - 管理重试计数
 * - 指数退避支持
 * - 智能重试条件判断
 */

import { HarnessConfig, ReviewVerdict } from '../types/harness.js';
import { TaskMeta } from '../types/task.js';

export class RetryHandler {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 判断是否应该重试
   */
  async shouldRetry(
    taskId: string,
    retryCounter: Map<string, number>
  ): Promise<boolean> {
    const currentAttempts = retryCounter.get(taskId) || 0;

    // 检查是否超过最大重试次数
    if (currentAttempts >= this.config.maxRetries) {
      console.log(`   ⚠️  已达到最大重试次数 (${this.config.maxRetries})`);
      return false;
    }

    console.log(`   🔄 准备重试 (第 ${currentAttempts + 1}/${this.config.maxRetries} 次)`);

    // 应用退避延迟
    await this.applyBackoff(currentAttempts);

    return true;
  }

  /**
   * 应用指数退避
   */
  private async applyBackoff(attemptNumber: number): Promise<void> {
    // 基础延迟 2 秒，指数增长，最大 30 秒
    const baseDelay = 2000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);

    if (delay > 0) {
      console.log(`   ⏳ 等待 ${(delay / 1000).toFixed(1)}s 后重试...`);
      await this.sleep(delay);
    }
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 判断是否为可重试的错误
   */
  isRetryableError(error: string): boolean {
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /temporarily/i,
      /rate limit/i,
      /资源暂时不可用/,
      /ETIMEDOUT/,
      /ECONNRESET/,
    ];

    return retryablePatterns.some(pattern => pattern.test(error));
  }

  /**
   * 获取重试建议
   */
  getRetryRecommendation(verdict: ReviewVerdict): {
    shouldRetry: boolean;
    reason: string;
    suggestions: string[];
  } {
    const suggestions: string[] = [];

    // 分析失败原因
    if (verdict.failedCriteria.length > 0) {
      suggestions.push('检查未满足的验收标准，确保完全理解需求');
    }

    if (verdict.failedCheckpoints.length > 0) {
      suggestions.push('验证检查点配置是否正确');
    }

    // 判断是否值得重试
    const isTransientError = this.isRetryableError(verdict.reason);
    const hasFixableIssues = verdict.failedCriteria.length > 0 || verdict.failedCheckpoints.length > 0;

    if (isTransientError) {
      return {
        shouldRetry: true,
        reason: '检测到临时性错误，重试可能成功',
        suggestions: [...suggestions, '等待系统恢复后重试'],
      };
    }

    if (hasFixableIssues) {
      return {
        shouldRetry: true,
        reason: '存在可修复的问题',
        suggestions,
      };
    }

    return {
      shouldRetry: false,
      reason: '错误无法通过重试解决',
      suggestions: ['需要人工介入分析问题'],
    };
  }

  /**
   * 计算下次重试的预期延迟
   */
  getNextRetryDelay(attemptNumber: number): number {
    const baseDelay = 2000;
    const maxDelay = 30000;
    return Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
  }

  /**
   * 格式化重试状态
   */
  formatRetryStatus(taskId: string, retryCounter: Map<string, number>): string {
    const attempts = retryCounter.get(taskId) || 0;
    const remaining = this.config.maxRetries - attempts;

    if (remaining <= 0) {
      return `已用完所有重试机会 (${attempts}/${this.config.maxRetries})`;
    }

    return `剩余重试机会: ${remaining}/${this.config.maxRetries}`;
  }
}
