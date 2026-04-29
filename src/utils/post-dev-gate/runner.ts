/**
 * Post-Dev Phase Gate Runner
 * 开发阶段后门禁协调器
 *
 * 职责:
 * - CP-001: 协调开发后门禁检查的执行流程
 * - CP-002: 管理多检查器的调度和执行
 * - CP-003: 处理检查结果并生成报告
 * - CP-004: 集成自动修复功能
 *
 * @module post-dev-phase-gate/runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseCheckContext,
  PostDevPhaseGateConfig,
  PostDevPhaseGateResult,
  PostDevPhaseGateReport,
  PostDevPhaseRule,
  PostDevPhaseRuleResult,
  PostDevPhaseCheckItemResult,
  AutoFixResult,
} from '../../types/post-dev-phase-gate.js';
import { DEFAULT_POST_DEV_PHASE_RULES } from '../../types/post-dev-phase-gate.js';
import { readTaskMeta } from '../task.js';
import { outputAlignmentChecker } from './checkers/output-alignment-checker.js';
import { reportIntegrityChecker } from './checkers/report-integrity-checker.js';
import { postDevPhaseAutoFix } from './checkers/auto-fix.js';

/**
 * 开发后门禁运行器
 * PostDevGateRunner - 统一调度后开发门禁检查
 */
export class PostDevGateRunner {
  private config: PostDevPhaseGateConfig;

  constructor(config: Partial<PostDevPhaseGateConfig> = {}) {
    this.config = {
      enabled: true,
      rules: new Map(),
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/post-dev-gate-report.json',
      enableAutoFix: true,
      ...config,
    };
  }

  /**
   * 运行门禁检查
   * CP-001: 门禁执行入口
   *
   * @param context - 检查上下文
   * @returns 门禁检查结果
   */
  async runGate(context: PostDevPhaseCheckContext): Promise<PostDevPhaseGateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return this.createSkippedResult(context.taskId, startTime);
    }

    // 1. 获取适用的规则
    const registry = new PostDevPhaseRuleRegistry();
    const applicableRules = registry.getApplicableRules(context);

    // 2. 按顺序执行规则检查
    const ruleResults: PostDevPhaseRuleResult[] = [];
    const allChecks: PostDevPhaseCheckItemResult[] = [];
    let blockingFailures = 0;

    for (const rule of applicableRules) {
      const ruleResult = await this.executeRule(rule, context);
      ruleResults.push(ruleResult);
      allChecks.push(...ruleResult.checkResults);

      if (!ruleResult.passed && ruleResult.severity === 'error') {
        blockingFailures++;
        if (this.config.stopOnFailure) {
          break;
        }
      }
    }

    // 3. 尝试自动修复（如果启用）
    let autoFixResults: Map<string, AutoFixResult> | undefined;
    if (this.config.enableAutoFix && !allChecks.every(c => c.passed)) {
      autoFixResults = await this.tryAutoFix(allChecks, context);
    }

    // 4. 聚合结果
    const passedCount = ruleResults.filter(r => r.passed).length;
    const failedCount = ruleResults.filter(r => !r.passed && r.severity === 'error').length;
    const warningCount = ruleResults.filter(r => !r.passed && r.severity === 'warning').length;
    const passed = failedCount === 0;

    // 5. 生成建议
    const recommendations = this.generateRecommendations(ruleResults, context);

    // 6. 生成结果汇总
    const summary = this.generateSummary(passedCount, failedCount, warningCount, applicableRules.length);

    const result: PostDevPhaseGateResult = {
      taskId: context.taskId,
      passed,
      summary,
      ruleResults,
      checks: allChecks,
      passedCount,
      failedCount,
      warningCount,
      blockingFailures,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      recommendations,
      autoFixResults,
    };

    // 7. 保存报告
    if (this.config.generateReport) {
      await this.saveReport(result, context);
    }

    return result;
  }

  /**
   * 尝试自动修复失败的检查
   * CP-AF-001: 自动修复入口
   *
   * @param checks - 所有检查项
   * @param context - 检查上下文
   * @returns 修复结果映射
   */
  private async tryAutoFix(
    checks: PostDevPhaseCheckItemResult[],
    context: PostDevPhaseCheckContext
  ): Promise<Map<string, AutoFixResult>> {
    if (!this.config.enableAutoFix) {
      return new Map();
    }

    const collection = await postDevPhaseAutoFix.tryAutoFixAll(checks, context);
    return collection.results;
  }

  /**
   * 执行单个规则
   * CP-002: 规则执行
   *
   * @param rule - 规则定义
   * @param context - 检查上下文
   * @returns 规则检查结果
   */
  private async executeRule(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseRuleResult> {
    const startTime = Date.now();
    const checkResults: PostDevPhaseCheckItemResult[] = [];

    try {
      // 根据规则ID路由到具体检查器
      switch (rule.id) {
        case 'R-OUTPUT-001':
          checkResults.push(await outputAlignmentChecker.check(rule, context));
          break;

        case 'R-OUTPUT-002':
          checkResults.push(await reportIntegrityChecker.check(rule, context));
          break;

        case 'R-OUTPUT-003':
          checkResults.push(await this.checkArtifactValidation(rule, context));
          break;

        case 'R-OUTPUT-004':
          checkResults.push(await this.checkDeliverable(rule, context));
          break;

        // 其他规则按类型处理
        default:
          switch (rule.type) {
            case 'output_alignment':
              checkResults.push(await outputAlignmentChecker.check(rule, context));
              break;

            case 'report_integrity':
              checkResults.push(await reportIntegrityChecker.check(rule, context));
              break;

            case 'artifact_validation':
              checkResults.push(await this.checkArtifactValidation(rule, context));
              break;

            case 'deliverable_check':
              checkResults.push(await this.checkDeliverable(rule, context));
              break;

            default:
              checkResults.push({
                checkId: `${rule.id}-unknown`,
                checkName: '未知检查类型',
                ruleId: rule.id,
                passed: false,
                severity: 'warning',
                message: `未实现的规则类型: ${rule.type}`,
                duration: 0,
                timestamp: new Date().toISOString(),
              });
          }
      }
    } catch (error) {
      checkResults.push({
        checkId: `${rule.id}-error`,
        checkName: '规则执行错误',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `执行规则时发生错误: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }

    const passed = checkResults.every(c => c.passed);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      passed,
      severity: rule.severity,
      checkResults,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 产物验证检查
   * R-OUTPUT-003: 开发产物验证
   */
  private async checkArtifactValidation(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    const startTime = Date.now();

    try {
      const config = rule.config as {
        validateCodeFiles?: boolean;
        validateTestFiles?: boolean;
        validateDocs?: boolean;
      } | undefined;

      const validateCodeFiles = config?.validateCodeFiles ?? true;
      const validateTestFiles = config?.validateTestFiles ?? true;
      const validateDocs = config?.validateDocs ?? true;

      const issues: string[] = [];
      const validated: string[] = [];

      // 验证代码文件
      if (validateCodeFiles) {
        const srcPath = path.join(context.cwd, 'src');
        if (fs.existsSync(srcPath)) {
          validated.push('源代码目录存在');
        } else {
          issues.push('源代码目录不存在');
        }
      }

      // 验证测试文件
      if (validateTestFiles) {
        const testPaths = [
          path.join(context.cwd, 'tests'),
          path.join(context.cwd, '__tests__'),
          path.join(context.cwd, 'src', '__tests__'),
        ];
        const hasTests = testPaths.some(p => fs.existsSync(p));
        if (hasTests) {
          validated.push('测试目录存在');
        } else {
          issues.push('测试目录不存在');
        }
      }

      // 验证文档
      if (validateDocs) {
        const docsPath = path.join(context.cwd, 'docs');
        if (fs.existsSync(docsPath)) {
          validated.push('文档目录存在');
        } else {
          issues.push('文档目录不存在');
        }
      }

      const passed = issues.length === 0;

      return {
        checkId: 'artifact-validation-check',
        checkName: '开发产物验证',
        ruleId: rule.id,
        passed,
        severity: passed ? 'info' : rule.severity,
        message: passed
          ? `产物验证通过 (${validated.join(', ')})`
          : `产物验证失败: ${issues.join(', ')}`,
        details: {
          validated,
          issues,
          config: { validateCodeFiles, validateTestFiles, validateDocs },
        },
        suggestions: issues.length > 0
          ? issues.map(i => `修复: ${i}`)
          : undefined,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'artifact-validation-check',
        checkName: '开发产物验证',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `产物验证失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 可交付物检查
   * R-OUTPUT-004: 开发可交付物检查
   */
  private async checkDeliverable(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    const startTime = Date.now();

    try {
      const config = rule.config as {
        requiredDeliverables?: string[];
      } | undefined;

      const requiredDeliverables = config?.requiredDeliverables ?? ['code', 'tests'];
      const missing: string[] = [];
      const found: string[] = [];

      for (const deliverable of requiredDeliverables) {
        const exists = await this.checkDeliverableExists(deliverable, context);
        if (exists) {
          found.push(deliverable);
        } else {
          missing.push(deliverable);
        }
      }

      const passed = missing.length === 0;

      return {
        checkId: 'deliverable-check',
        checkName: '开发可交付物检查',
        ruleId: rule.id,
        passed,
        severity: passed ? 'info' : rule.severity,
        message: passed
          ? `所有可交付物就绪 (${found.join(', ')})`
          : `缺少可交付物: ${missing.join(', ')}`,
        details: {
          found,
          missing,
          required: requiredDeliverables,
        },
        suggestions: missing.length > 0
          ? missing.map(m => `确保 ${m} 已就绪`)
          : undefined,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'deliverable-check',
        checkName: '开发可交付物检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `可交付物检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查可交付物是否存在
   */
  private async checkDeliverableExists(
    deliverable: string,
    context: PostDevPhaseCheckContext
  ): Promise<boolean> {
    switch (deliverable) {
      case 'code':
        return fs.existsSync(path.join(context.cwd, 'src'));

      case 'tests':
        return fs.existsSync(path.join(context.cwd, 'tests')) ||
          fs.existsSync(path.join(context.cwd, '__tests__')) ||
          fs.existsSync(path.join(context.cwd, 'src', '__tests__'));

      case 'docs':
        return fs.existsSync(path.join(context.cwd, 'docs'));

      case 'report':
        return fs.existsSync(
          path.join(context.cwd, '.projmnt4claude', 'outputs', context.taskId, 'dev-report.json')
        );

      default:
        return false;
    }
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    ruleResults: PostDevPhaseRuleResult[],
    context: PostDevPhaseCheckContext
  ): string[] {
    const recommendations: string[] = [];

    for (const result of ruleResults) {
      for (const check of result.checkResults) {
        if (check.suggestions) {
          recommendations.push(...check.suggestions);
        }
      }
    }

    if (this.config.enableAutoFix) {
      recommendations.push('已启用自动修复，部分问题可能被自动解决');
    }

    return Array.from(new Set(recommendations)); // 去重
  }

  /**
   * 生成结果汇总
   */
  private generateSummary(
    passed: number,
    failed: number,
    warnings: number,
    total: number
  ): string {
    if (failed > 0) {
      return `开发后门禁检查未通过: ${failed} 个错误, ${warnings} 个警告 (共 ${total} 项)`;
    }
    if (warnings > 0) {
      return `开发后门禁检查通过: ${passed}/${total} 项通过，有 ${warnings} 个警告`;
    }
    return `开发后门禁检查全部通过: ${passed}/${total} 项`;
  }

  /**
   * 创建跳过的结果
   */
  private createSkippedResult(taskId: string, startTime: number): PostDevPhaseGateResult {
    return {
      taskId,
      passed: true,
      summary: '开发后门禁检查已禁用，自动通过',
      ruleResults: [],
      checks: [],
      passedCount: 0,
      failedCount: 0,
      warningCount: 0,
      blockingFailures: 0,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      recommendations: ['开发后门禁检查当前已禁用'],
    };
  }

  /**
   * 保存门禁报告
   * CP-003: 报告保存
   */
  private async saveReport(
    result: PostDevPhaseGateResult,
    context: PostDevPhaseCheckContext
  ): Promise<void> {
    if (!this.config.reportPath) return;

    const reportDir = path.dirname(this.config.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report: PostDevPhaseGateReport = {
      reportId: `postdev-${context.taskId}-${Date.now()}`,
      taskId: context.taskId,
      generatedAt: new Date().toISOString(),
      result,
      recommendations: result.recommendations,
      metadata: {
        version: '1.0.0',
        checkerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
        autoFixApplied: result.autoFixResults !== undefined && result.autoFixResults.size > 0,
      },
    };

    fs.writeFileSync(this.config.reportPath, JSON.stringify(report, null, 2));
  }
}

/**
 * 开发后规则注册表
 * CP-004: 规则注册表
 */
export class PostDevPhaseRuleRegistry {
  private rules: PostDevPhaseRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * 注册规则
   */
  registerRule(rule: PostDevPhaseRule): void {
    // 检查ID唯一性
    if (this.rules.some(r => r.id === rule.id)) {
      throw new Error(`Rule '${rule.id}' already registered`);
    }
    this.rules.push(rule);
  }

  /**
   * 获取规则
   */
  getRule(id: string): PostDevPhaseRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): PostDevPhaseRule[] {
    return [...this.rules];
  }

  /**
   * 获取适用于给定上下文的规则
   */
  getApplicableRules(context: PostDevPhaseCheckContext): PostDevPhaseRule[] {
    return this.rules.filter(rule => {
      // 检查规则是否启用
      const ruleConfig = context.config.rules.get(rule.id);
      const enabled = ruleConfig?.enabled ?? rule.enabled;
      if (!enabled) return false;

      // 检查规则是否适用于当前上下文
      if (rule.isApplicable) {
        return rule.isApplicable(context);
      }

      return true;
    });
  }

  /**
   * 按类型获取规则
   */
  getRulesByType(type: string): PostDevPhaseRule[] {
    return this.rules.filter(r => r.type === type);
  }

  /**
   * 清除所有规则
   */
  clear(): void {
    this.rules = [];
  }

  /**
   * 初始化默认规则
   */
  private initializeDefaultRules(): void {
    for (const rule of DEFAULT_POST_DEV_PHASE_RULES) {
      this.rules.push(rule);
    }
  }
}

/**
 * 创建默认运行器
 * CP-005: 工厂函数
 */
export function createPostDevGateRunner(
  config?: Partial<PostDevPhaseGateConfig>
): PostDevGateRunner {
  return new PostDevGateRunner(config);
}

/**
 * 运行开发后门禁检查（便利函数）
 * CP-006: 便利函数
 *
 * @param taskId - 任务ID
 * @param cwd - 工作目录
 * @param config - 可选的门禁配置
 * @returns 门禁检查结果
 */
export async function runPostDevPhaseGate(
  taskId: string,
  cwd: string,
  config?: Partial<PostDevPhaseGateConfig>
): Promise<PostDevPhaseGateResult> {
  // 加载任务元数据
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  // 创建运行器
  const runner = createPostDevGateRunner(config);

  // 构建检查上下文
  const context: PostDevPhaseCheckContext = {
    taskId,
    task,
    cwd,
    config: {
      enabled: true,
      rules: new Map(),
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/post-dev-gate-report.json',
      enableAutoFix: true,
      ...config,
    },
  };

  // 运行门禁检查
  return runner.runGate(context);
}

/**
 * 运行开发后门禁检查并尝试自动修复
 * CP-007: 带自动修复的便利函数
 *
 * @param taskId - 任务ID
 * @param cwd - 工作目录
 * @param config - 可选的门禁配置
 * @returns 门禁检查结果（包含修复结果）
 */
export async function runPostDevPhaseGateWithAutoFix(
  taskId: string,
  cwd: string,
  config?: Partial<PostDevPhaseGateConfig>
): Promise<PostDevPhaseGateResult> {
  // 加载任务元数据
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  // 创建运行器（启用自动修复）
  const runner = createPostDevGateRunner({
    enableAutoFix: true,
    ...config,
  });

  // 构建检查上下文
  const context: PostDevPhaseCheckContext = {
    taskId,
    task,
    cwd,
    config: {
      enabled: true,
      rules: new Map(),
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/post-dev-gate-report.json',
      enableAutoFix: true,
      ...config,
    },
  };

  // 运行门禁检查
  return runner.runGate(context);
}

// 导出检查器
export {
  outputAlignmentChecker,
  reportIntegrityChecker,
  postDevPhaseAutoFix,
};

// 导出默认实例
export const postDevGateRunner = {
  create: createPostDevGateRunner,
  run: runPostDevPhaseGate,
  runWithAutoFix: runPostDevPhaseGateWithAutoFix,
};
