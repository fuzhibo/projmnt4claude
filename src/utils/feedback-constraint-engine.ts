/**
 * 反馈约束引擎实现
 *
 * 在 Harness Design 模式的开发阶段输出上执行结构化规则验证，
 * 生成反馈提示词并支持带反馈的自动重试循环。
 */

import type {
  FeedbackConstraintEngine,
  FeedbackTemplate,
  ValidationRule,
  ValidationRuleSet,
  ValidationViolation,
  ViolationSeverity,
  EngineResult,
} from '../types/feedback-constraint.js';
import type { AgentResult } from './headless-agent.js';
import { Logger } from './logger.js';
import { randomUUID } from 'crypto';

const logger = new Logger({ component: 'feedback-constraint-engine' });

// ============================================================
// 通用验证规则
// ============================================================

/**
 * JSON 可解析性规则
 * 检查输出是否为合法 JSON 字符串
 */
export const jsonParseableRule: ValidationRule = {
  id: 'json-parseable',
  description: '输出必须是合法的 JSON 字符串',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    if (typeof output !== 'string') {
      return {
        ruleId: 'json-parseable',
        severity: 'error',
        message: '输出不是字符串类型，无法解析为 JSON',
        value: typeof output,
      };
    }

    const trimmed = output.trim();
    if (trimmed.length === 0) {
      return {
        ruleId: 'json-parseable',
        severity: 'error',
        message: '输出为空字符串，无法解析为 JSON',
      };
    }

    try {
      JSON.parse(trimmed);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ruleId: 'json-parseable',
        severity: 'error',
        message: `JSON 解析失败: ${msg}`,
        value: trimmed.slice(0, 100),
      };
    }
  },
};

/**
 * 非空输出规则
 * 检查输出不为空（null、undefined、空字符串、纯空白字符串）
 */
export const nonEmptyOutputRule: ValidationRule = {
  id: 'non-empty-output',
  description: '输出不能为空',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    if (output === null || output === undefined) {
      return {
        ruleId: 'non-empty-output',
        severity: 'error',
        message: '输出为 null 或 undefined',
        value: String(output),
      };
    }

    if (typeof output === 'string' && output.trim().length === 0) {
      return {
        ruleId: 'non-empty-output',
        severity: 'error',
        message: '输出为空字符串或纯空白字符',
      };
    }

    return null;
  },
};

// ============================================================
// 反馈模板实现
// ============================================================

/**
 * JSON 格式反馈模板
 * 将违规信息格式化为面向 Agent 的 JSON 修正提示词
 */
export class JsonFeedbackTemplate implements FeedbackTemplate {
  private truncationLimit: number;

  constructor(truncationLimit: number = 4000) {
    this.truncationLimit = truncationLimit;
  }

  buildFeedbackPrompt(
    violations: ValidationViolation[],
    originalOutput: string,
  ): string {
    const violationLines = violations
      .map(
        (v, i) =>
          `${i + 1}. [${v.severity.toUpperCase()}] ${v.ruleId}: ${v.message}` +
          (v.field ? `\n   字段: ${v.field}` : '') +
          (v.value ? `\n   值: ${v.value}` : ''),
      )
      .join('\n');

    return [
      '上一次输出的 JSON 存在以下问题，请修正后重新输出完整 JSON：',
      '',
      '## 违规项',
      violationLines,
      '',
      '## 原始输出（供参考）',
      '```json',
      originalOutput.length > this.truncationLimit
        ? originalOutput.slice(0, this.truncationLimit) + '\n... (已截断)'
        : originalOutput,
      '```',
      '',
      '请确保：',
      '- 输出是合法的 JSON',
      '- 所有必填字段都存在且类型正确',
      '- 不要输出 JSON 以外的内容',
    ].join('\n');
  }
}

/**
 * Markdown 格式反馈模板
 * 将违规信息格式化为面向 Agent 的 Markdown 修正提示词
 */
export class MarkdownFeedbackTemplate implements FeedbackTemplate {
  private truncationLimit: number;

  constructor(truncationLimit: number = 4000) {
    this.truncationLimit = truncationLimit;
  }

  buildFeedbackPrompt(
    violations: ValidationViolation[],
    originalOutput: string,
  ): string {
    const violationLines = violations
      .map(
        (v, i) =>
          `${i + 1}. **[${v.severity.toUpperCase()}] ${v.ruleId}**: ${v.message}` +
          (v.field ? ` (字段: \`${v.field}\`)` : ''),
      )
      .join('\n');

    return [
      '上一次输出的 Markdown 内容存在以下问题，请修正后重新输出：',
      '',
      '### 违规项',
      violationLines,
      '',
      '### 原始输出（供参考）',
      '```markdown',
      originalOutput.length > this.truncationLimit
        ? originalOutput.slice(0, this.truncationLimit) + '\n... (已截断)'
        : originalOutput,
      '```',
      '',
      '请确保：',
      '- 输出格式符合 Markdown 规范',
      '- 所有必需的章节和标题都存在',
      '- 内容结构完整、逻辑清晰',
    ].join('\n');
  }
}

// ============================================================
// 反馈约束引擎实现
// ============================================================

/**
 * 反馈约束引擎
 *
 * 核心职责：
 * 1. 验证 Agent 输出是否符合注册的规则集
 * 2. 根据违规严重级别决定是否重试
 * 3. 将违规信息转换为结构化反馈
 * 4. 执行"调用 → 验证 → 反馈 → 重试"循环
 */
export class FeedbackConstraintEngineImpl implements FeedbackConstraintEngine {
  private ruleSets: ValidationRuleSet[] = [];
  private template: FeedbackTemplate;
  private retryCount = 0;

  constructor(template?: FeedbackTemplate) {
    this.template = template ?? new JsonFeedbackTemplate();
  }

  /**
   * 注册验证规则集
   */
  addRuleSet(ruleSet: ValidationRuleSet): this {
    this.ruleSets.push(ruleSet);
    return this;
  }

  /**
   * 设置反馈模板
   */
  setTemplate(template: FeedbackTemplate): this {
    this.template = template;
    return this;
  }

  /**
   * 验证输出是否符合所有已注册规则集中的规则
   */
  validate(output: unknown): ValidationViolation[] {
    const violations: ValidationViolation[] = [];

    for (const ruleSet of this.ruleSets) {
      for (const rule of ruleSet.rules) {
        const violation = rule.check(output);
        if (violation !== null) {
          // 如果规则本身没有指定 severity，使用规则集级别的默认值
          if (!violation.severity) {
            violation.severity = rule.severity;
          }
          violations.push(violation);
        }
      }
    }

    if (violations.length > 0) {
      logger.debug(
        `[FeedbackConstraintEngine] 验证发现 ${violations.length} 个违规项`,
      );
    }

    return violations;
  }

  /**
   * 根据违规项判断是否应重试
   * 仅当存在 error 级别违规且未超过任意规则集的重试上限时返回 true
   */
  shouldRetry(violations: ValidationViolation[]): boolean {
    const hasErrors = violations.some((v) => v.severity === 'error');
    if (!hasErrors) {
      return false;
    }

    // 检查是否所有含 error 级违规的规则集都未超出重试上限
    for (const ruleSet of this.ruleSets) {
      const errorViolationsInSet = violations.filter(
        (v) =>
          v.severity === 'error' &&
          ruleSet.rules.some((r) => r.id === v.ruleId),
      );

      if (errorViolationsInSet.length > 0) {
        if (this.retryCount >= ruleSet.maxRetriesOnError) {
          logger.debug(
            `[FeedbackConstraintEngine] 规则集 "${ruleSet.name}" 已达到最大重试次数 (${ruleSet.maxRetriesOnError})`,
          );
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 构建反馈信息
   */
  buildFeedback(
    violations: ValidationViolation[],
    originalOutput: string,
  ): string {
    return this.template.buildFeedbackPrompt(violations, originalOutput);
  }

  /**
   * 带反馈的执行循环
   *
   * 流程：
   * 1. 使用 invokeFn 调用 Agent
   * 2. 验证输出
   * 3. 如果存在违规且应该重试，生成反馈并重新调用
   * 4. 重试时使用 session 连续性（--session-id + --resume），
   *    Claude 可在前次完整上下文中进行修正
   * 5. 重复直到通过或达到重试上限
   */
  async runWithFeedback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invokeFn: any,
    prompt: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
  ): Promise<EngineResult> {
    this.retryCount = 0;
    let currentPrompt = prompt;
    let lastResult: AgentResult;

    // 生成 session ID 用于重试时的上下文连续性
    const sessionId = `fce-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let currentOptions = { ...options, sessionId };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 调用 Agent
      lastResult = await invokeFn(currentPrompt, currentOptions);

      const output = lastResult.output;

      // 验证输出
      const violations = this.validate(output);

      // 无违规，通过
      if (violations.length === 0) {
        logger.debug(
          `[FeedbackConstraintEngine] 验证通过 (重试 ${this.retryCount} 次, session: ${sessionId})`,
        );
        return {
          result: lastResult,
          violations: [],
          retries: this.retryCount,
          passed: true,
          sessionContinuity: {
            used: this.retryCount > 0,
            sessionId,
          },
        };
      }

      // 存在违规但不应重试（仅有 warning 或已超出重试上限）
      if (!this.shouldRetry(violations)) {
        const hasErrors = violations.some((v) => v.severity === 'error');
        logger.debug(
          `[FeedbackConstraintEngine] 验证未通过，不再重试 (错误: ${hasErrors}, 重试: ${this.retryCount})`,
        );
        return {
          result: lastResult,
          violations,
          retries: this.retryCount,
          passed: !hasErrors,
          sessionContinuity: {
            used: this.retryCount > 0,
            sessionId,
          },
        };
      }

      // 生成反馈并准备重试
      this.retryCount++;

      // Session 模式下 Claude 已有前次输出，仅发送违规摘要避免 token 浪费
      const violationSummary = violations
        .map((v, i) => `${i + 1}. [${v.severity.toUpperCase()}] ${v.ruleId}: ${v.message}`)
        .join('\n');

      currentPrompt = [
        '上一次输出存在以下格式问题，请修正后重新输出：',
        '',
        violationSummary,
        '',
        `这是第 ${this.retryCount} 次重试（session 已包含前次完整输出）。`,
      ].join('\n');

      // 重试时恢复同一 session，Claude 可看到前次完整输出
      currentOptions = {
        ...options,
        sessionId,
        resumeSession: true,
        forkSession: false,
      };

      logger.debug(
        `[FeedbackConstraintEngine] 准备第 ${this.retryCount} 次重试 (session: ${sessionId})，违规项: ${violations.map((v) => v.ruleId).join(', ')}`,
      );
    }
  }

  /**
   * 获取当前重试计数
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * 重置重试计数
   */
  reset(): this {
    this.retryCount = 0;
    return this;
  }
}

/**
 * 便捷工厂函数：创建预配置 JSON 验证引擎
 */
export function createJsonFeedbackEngine(
  additionalRules: ValidationRule[] = [],
  maxRetriesOnError = 2,
): FeedbackConstraintEngineImpl {
  const engine = new FeedbackConstraintEngineImpl(new JsonFeedbackTemplate());
  engine.addRuleSet({
    name: 'json-output',
    outputType: 'json',
    rules: [nonEmptyOutputRule, jsonParseableRule, ...additionalRules],
    maxRetriesOnError,
  });
  return engine;
}

/**
 * 便捷工厂函数：创建预配置 Markdown 验证引擎
 */
export function createMarkdownFeedbackEngine(
  rules: ValidationRule[] = [],
  maxRetriesOnError = 2,
): FeedbackConstraintEngineImpl {
  const engine = new FeedbackConstraintEngineImpl(
    new MarkdownFeedbackTemplate(),
  );
  engine.addRuleSet({
    name: 'markdown-output',
    outputType: 'markdown',
    rules: [nonEmptyOutputRule, ...rules],
    maxRetriesOnError,
  });
  return engine;
}

/**
 * Session 感知的验证引擎工厂
 *
 * 创建使用 CLI session 连续性（--session-id + --resume）的引擎实例。
 * 重试时在同一 session 中继续，Claude 可在前次完整上下文中进行修正，
 * 避免重试 prompt 丢失原始任务上下文的问题。
 *
 * @param outputType - 输出格式：json 或 markdown
 * @param rules - 额外验证规则
 * @param maxRetriesOnError - error 级违规最大重试次数
 */
export function createSessionAwareEngine(
  outputType: 'json' | 'markdown' = 'json',
  rules: ValidationRule[] = [],
  maxRetriesOnError = 2,
): FeedbackConstraintEngineImpl {
  const template = outputType === 'json'
    ? new JsonFeedbackTemplate()
    : new MarkdownFeedbackTemplate();
  const baseRules = outputType === 'json'
    ? [nonEmptyOutputRule, jsonParseableRule, ...rules]
    : [nonEmptyOutputRule, ...rules];

  const engine = new FeedbackConstraintEngineImpl(template);
  engine.addRuleSet({
    name: `${outputType}-session-aware`,
    outputType,
    rules: baseRules,
    maxRetriesOnError,
  });
  return engine;
}
