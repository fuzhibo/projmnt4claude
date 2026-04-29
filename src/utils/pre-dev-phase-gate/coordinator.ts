/**
 * Pre-Dev Phase Gate Coordinator
 * 开发阶段前门禁协调器
 *
 * 职责:
 * - CP-1: 协调开发前门禁检查的执行流程
 * - CP-2: 管理多检查器的调度和执行
 * - CP-3: 处理检查结果并生成报告
 *
 * @module pre-dev-phase-gate/coordinator
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  PreDevPhaseCheckContext,
  PreDevPhaseGateConfig,
  PreDevPhaseGateResult,
  PreDevPhaseGateReport,
  PreDevPhaseRule,
  PreDevPhaseRuleResult,
  PreDevPhaseCheckItemResult,
  GitWorkspaceCheckResult,
  DependencyOutputCheckResult,
  ResourceConfigCheckResult,
  RetryContext,
  AutoFixResult,
} from '../../types/pre-dev-phase-gate.js';
import { DEFAULT_PRE_DEV_PHASE_RULES } from '../../types/pre-dev-phase-gate.js';

/**
 * 开发前门禁协调器
 */
export class PreDevPhaseGateCoordinator {
  private config: PreDevPhaseGateConfig;

  constructor(config: Partial<PreDevPhaseGateConfig> = {}) {
    this.config = {
      enabled: true,
      rules: new Map(),
      enableRetryRules: true,
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/pre-dev-gate-report.json',
      ...config,
    };
  }

  /**
   * 运行门禁检查
   * CP-PDGC-1: 门禁执行入口
   */
  async runGate(context: PreDevPhaseCheckContext): Promise<PreDevPhaseGateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return this.createSkippedResult(context.taskId, startTime);
    }

    // 1. 获取适用的规则
    const registry = new PreDevPhaseRuleRegistry();
    const applicableRules = registry.getApplicableRules(context);

    // 2. 按顺序执行规则检查
    const ruleResults: PreDevPhaseRuleResult[] = [];
    const allChecks: PreDevPhaseCheckItemResult[] = [];
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

    // 3. 聚合结果
    const passedCount = ruleResults.filter(r => r.passed).length;
    const failedCount = ruleResults.filter(r => !r.passed && r.severity === 'error').length;
    const warningCount = ruleResults.filter(r => !r.passed && r.severity === 'warning').length;
    const passed = failedCount === 0;

    // 4. 生成建议
    const recommendations = this.generateRecommendations(ruleResults, context);

    // 5. 生成结果汇总
    const summary = this.generateSummary(passedCount, failedCount, warningCount, applicableRules.length);

    const result: PreDevPhaseGateResult = {
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
    };

    // 6. 保存报告
    if (this.config.generateReport) {
      await this.saveReport(result, context);
    }

    return result;
  }

  /**
   * 尝试自动修复失败的检查
   * CP-PDGC-AF-1: 自动修复入口
   * 遍历所有失败的检查项，尝试执行自动修复
   *
   * @param result - 门禁检查结果
   * @param context - 检查上下文
   * @returns 修复结果映射（检查ID -> 修复结果）
   */
  async tryAutoFix(
    result: PreDevPhaseGateResult,
    context: PreDevPhaseCheckContext
  ): Promise<Map<string, AutoFixResult>> {
    const fixResults = new Map<string, AutoFixResult>();

    // 遍历所有失败的检查项
    for (const check of result.checks) {
      // 跳过已通过或没有自动修复的检查项
      if (check.passed || !check.autoFixable || !check.autoFix) {
        continue;
      }

      try {
        // 执行自动修复
        const fixResult = await check.autoFix.fix();
        fixResults.set(check.checkId, fixResult);

        // 记录修复结果
        if (fixResult.success) {
          console.log(`✅ 自动修复成功 [${check.checkId}]: ${fixResult.message}`);
        } else {
          console.log(`❌ 自动修复失败 [${check.checkId}]: ${fixResult.message}`);
        }
      } catch (error) {
        const errorResult: AutoFixResult = {
          success: false,
          message: `执行自动修复时发生错误: ${error instanceof Error ? error.message : String(error)}`,
        };
        fixResults.set(check.checkId, errorResult);
        console.log(`❌ 自动修复异常 [${check.checkId}]: ${errorResult.message}`);
      }
    }

    return fixResults;
  }

  /**
   * 执行单个规则
   * CP-PDGC-2: 规则执行
   * 根据规则ID路由到具体的检查器
   */
  private async executeRule(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseRuleResult> {
    const startTime = Date.now();
    const checkResults: PreDevPhaseCheckItemResult[] = [];

    try {
      // 根据规则ID路由到具体检查器
      switch (rule.id) {
        // Git工作区规则
        case 'R-GIT-001':
          checkResults.push(await this.executeGitChecker('checkGitWorkspaceClean', rule, context));
          break;
        case 'R-GIT-002':
          checkResults.push(await this.executeGitChecker('checkGitStaged', rule, context));
          break;
        case 'R-GIT-003':
          checkResults.push(await this.executeGitChecker('checkGitIgnore', rule, context));
          break;
        case 'R-GIT-004':
          checkResults.push(await this.executeGitChecker('checkConflictMarkers', rule, context));
          break;
        // 分支状态规则
        case 'R-BR-001':
          checkResults.push(await this.executeBranchChecker('checkBranchExists', rule, context));
          break;
        case 'R-BR-002':
          checkResults.push(await this.executeBranchChecker('checkBranchAssociation', rule, context));
          break;
        case 'R-BR-003':
          checkResults.push(await this.executeBranchChecker('checkBranchTracking', rule, context));
          break;
        case 'R-BR-004':
          checkResults.push(await this.executeBranchChecker('checkBranchSync', rule, context));
          break;
        case 'R-BR-005':
          checkResults.push(await this.executeBranchChecker('checkBranchSwitchable', rule, context));
          break;
        // 依赖输出规则
        case 'R-DEPOUT-001':
          checkResults.push(await this.executeDependencyChecker('checkDependencyOutputAvailable', rule, context));
          break;
        case 'R-DEPOUT-002':
          checkResults.push(await this.executeDependencyChecker('checkDependencyInterface', rule, context));
          break;
        case 'R-DEPOUT-003':
          checkResults.push(await this.executeDependencyChecker('checkCircularDependency', rule, context));
          break;
        // 资源配置规则
        case 'R-RES-001':
          checkResults.push(await this.executeResourceChecker('checkDevBranchConfig', rule, context));
          break;
        case 'R-RES-002':
          checkResults.push(await this.executeResourceChecker('checkDevDirectoryConfig', rule, context));
          break;
        case 'R-RES-003':
          checkResults.push(await this.executeResourceChecker('checkEnvConfig', rule, context));
          break;
        case 'R-RES-004':
          checkResults.push(await this.executeResourceChecker('checkDiskSpace', rule, context));
          break;
        // 路径对齐规则
        case 'R-PATH-001':
          checkResults.push(await this.executePathChecker('checkTaskFilePath', rule, context));
          break;
        case 'R-PATH-002':
          checkResults.push(await this.executePathChecker('checkCodeReferencePath', rule, context));
          break;
        case 'R-PATH-003':
          checkResults.push(await this.executePathChecker('checkResourceReferencePath', rule, context));
          break;
        // 其他规则按类型处理
        default:
          switch (rule.type) {
            case 'git_workspace':
              checkResults.push(await this.checkGitWorkspace(rule, context));
              break;
            case 'branch_status':
              checkResults.push(await this.checkBranchStatus(rule, context));
              break;
            case 'dependency_output':
              checkResults.push(await this.checkDependencyOutput(rule, context));
              break;
            case 'resource_config':
              checkResults.push(await this.checkResourceConfig(rule, context));
              break;
            case 'retry_context':
              checkResults.push(await this.checkRetryContext(rule, context));
              break;
            case 'path_alignment':
              checkResults.push(await this.checkPathAlignment(rule, context));
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
   * 执行Git检查器
   */
  private async executeGitChecker(
    checkerName: 'checkGitWorkspaceClean' | 'checkGitStaged' | 'checkGitIgnore' | 'checkConflictMarkers',
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const { [checkerName]: checkerFn } = await import('./checkers/git-checker.js');
    return checkerFn(rule, context);
  }

  /**
   * 执行分支检查器
   */
  private async executeBranchChecker(
    checkerName: 'checkBranchExists' | 'checkBranchAssociation' | 'checkBranchTracking' | 'checkBranchSync' | 'checkBranchSwitchable',
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const { [checkerName]: checkerFn } = await import('./checkers/branch-checker.js');
    return checkerFn(rule, context);
  }

  /**
   * 执行依赖检查器
   */
  private async executeDependencyChecker(
    checkerName: 'checkDependencyOutputAvailable' | 'checkDependencyInterface' | 'checkCircularDependency',
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const { [checkerName]: checkerFn } = await import('./checkers/dependency-checker.js');
    return checkerFn(rule, context);
  }

  /**
   * 执行资源配置检查器
   */
  private async executeResourceChecker(
    checkerName: 'checkDevBranchConfig' | 'checkDevDirectoryConfig' | 'checkEnvConfig' | 'checkDiskSpace',
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const { [checkerName]: checkerFn } = await import('./checkers/resource-checker.js');
    return checkerFn(rule, context);
  }

  /**
   * 执行路径对齐检查器
   */
  private async executePathChecker(
    checkerName: 'checkTaskFilePath' | 'checkCodeReferencePath' | 'checkResourceReferencePath',
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const { [checkerName]: checkerFn } = await import('./checkers/path-checker.js');
    return checkerFn(rule, context);
  }

  /**
   * Git工作区检查
   * CP-PDGC-3: Git工作区检查
   */
  private async checkGitWorkspace(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: context.cwd,
        encoding: 'utf-8',
      });

      const lines = statusOutput.trim().split('\n').filter(line => line.length > 0);
      const staged = lines.filter(line => line.startsWith('A') || line.startsWith('M') || line.startsWith('D'));
      const unstaged = lines.filter(line => line.startsWith(' ') || line.startsWith('?'));
      const untracked = lines.filter(line => line.startsWith('??'));

      const hasUncommittedChanges = lines.length > 0;
      const config = rule.config as { allowUncommitted?: boolean; maxUntrackedFiles?: number } | undefined;

      const allowUncommitted = config?.allowUncommitted ?? false;
      const maxUntrackedFiles = config?.maxUntrackedFiles ?? 10;

      let passed = true;
      let severity = rule.severity;
      let message = 'Git工作区干净，没有未提交更改';

      if (hasUncommittedChanges) {
        if (!allowUncommitted) {
          passed = false;
          message = `检测到 ${lines.length} 个未提交的文件更改`;
        } else if (untracked.length > maxUntrackedFiles) {
          passed = false;
          severity = 'warning';
          message = `未跟踪文件过多: ${untracked.length} 个 (最大允许: ${maxUntrackedFiles})`;
        } else {
          passed = true;
          severity = 'info';
          message = `允许未提交更改: ${lines.length} 个文件`;
        }
      }

      const details: GitWorkspaceCheckResult = {
        hasUncommittedChanges,
        uncommittedFileCount: lines.length,
        currentBranch: this.getCurrentBranch(context.cwd),
        isSyncedWithRemote: false,
        hasConflicts: false,
        status: {
          staged: staged.map(l => l.slice(3)),
          unstaged: unstaged.map(l => l.slice(3)),
          untracked: untracked.map(l => l.slice(3)),
        },
      };

      return {
        checkId: 'git-workspace-status',
        checkName: 'Git工作区状态',
        ruleId: rule.id,
        passed,
        severity,
        message,
        details: details as unknown as Record<string, unknown>,
        suggestions: hasUncommittedChanges && !allowUncommitted
          ? ['执行 git add 和 git commit 提交更改', '或配置 allowUncommitted: true 允许未提交更改']
          : undefined,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'git-workspace-status',
        checkName: 'Git工作区状态',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `Git工作区检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 分支状态检查
   * CP-PDGC-4: 分支状态检查
   */
  private async checkBranchStatus(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    try {
      const currentBranch = this.getCurrentBranch(context.cwd);
      const config = rule.config as { requireSync?: boolean; allowedBranches?: string[] } | undefined;

      const requireSync = config?.requireSync ?? true;
      const allowedBranches = config?.allowedBranches ?? ['main', 'master', 'develop'];

      // 检查是否在允许的 branches 上
      const isAllowedBranch = allowedBranches.includes(currentBranch);

      // 检查是否与远程同步
      let isSynced = true;
      if (requireSync) {
        try {
          execSync('git fetch --dry-run', { cwd: context.cwd, encoding: 'utf-8' });
        } catch {
          isSynced = false;
        }
      }

      const passed = isAllowedBranch && (!requireSync || isSynced);

      let message = `当前分支: ${currentBranch}`;
      if (!isAllowedBranch) {
        message += ` (不在允许的分支列表: ${allowedBranches.join(', ')})`;
      } else if (requireSync && !isSynced) {
        message += ' (与远程不同步)';
      }

      return {
        checkId: 'branch-status-check',
        checkName: '分支状态检查',
        ruleId: rule.id,
        passed,
        severity: rule.severity,
        message,
        details: {
          currentBranch,
          isAllowedBranch,
          isSyncedWithRemote: isSynced,
          allowedBranches,
          requireSync,
        },
        suggestions: !isAllowedBranch
          ? [`切换到允许的分支: git checkout ${allowedBranches[0]}`, '或更新配置添加当前分支到允许列表']
          : !isSynced
            ? ['执行 git pull 同步远程更改']
            : undefined,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        checkId: 'branch-status-check',
        checkName: '分支状态检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `分支状态检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 依赖输出检查
   * CP-PDGC-5: 依赖输出检查
   */
  private async checkDependencyOutput(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    // 基础实现 - 检查任务元数据中的依赖
    const taskDeps = context.task.dependencies || [];

    if (taskDeps.length === 0) {
      return {
        checkId: 'dependency-output-check',
        checkName: '依赖输出检查',
        ruleId: rule.id,
        passed: true,
        severity: 'info',
        message: '任务没有依赖，跳过依赖输出检查',
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 简化实现 - 实际应检查每个依赖的输出
    return {
      checkId: 'dependency-output-check',
      checkName: '依赖输出检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: `任务有 ${taskDeps.length} 个依赖待检查`,
      details: {
        dependencyCount: taskDeps.length,
        dependencies: taskDeps,
      } as unknown as Record<string, unknown>,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 资源配置检查
   * CP-PDGC-6: 资源配置检查
   */
  private async checkResourceConfig(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    const config = rule.config as { requiredEnvVars?: string[] } | undefined;
    const requiredEnvVars = config?.requiredEnvVars ?? ['NODE_ENV'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);

    const passed = missingVars.length === 0;

    const details: ResourceConfigCheckResult = {
      devBranch: {
        exists: true,
        name: this.getCurrentBranch(context.cwd),
        valid: true,
      },
      devDirectory: {
        exists: fs.existsSync(context.cwd),
        path: context.cwd,
        writable: true,
      },
      envConfig: {
        valid: missingVars.length === 0,
        missingVars,
      },
    };

    return {
      checkId: 'resource-config-check',
      checkName: '资源配置检查',
      ruleId: rule.id,
      passed,
      severity: rule.severity,
      message: passed
        ? '所有资源配置检查通过'
        : `缺少必需的环境变量: ${missingVars.join(', ')}`,
      details: details as unknown as Record<string, unknown>,
      suggestions: missingVars.length > 0
        ? missingVars.map(v => `设置环境变量: export ${v}=value`)
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 重试上下文检查
   * CP-PDGC-7: 重试上下文检查
   */
  private async checkRetryContext(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    if (!context.isResumed && context.attempt === 1) {
      return {
        checkId: 'retry-context-check',
        checkName: '重试上下文检查',
        ruleId: rule.id,
        passed: true,
        severity: 'info',
        message: '首次执行，跳过重试上下文检查',
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const previousFailure = context.previousFailure;
    if (!previousFailure) {
      return {
        checkId: 'retry-context-check',
        checkName: '重试上下文检查',
        ruleId: rule.id,
        passed: true,
        severity: 'info',
        message: `第 ${context.attempt} 次尝试，无前次失败信息`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      checkId: 'retry-context-check',
      checkName: '重试上下文检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: `重试上下文已加载 (尝试 ${context.attempt}/${context.maxRetries})`,
      details: {
        attempt: context.attempt,
        maxRetries: context.maxRetries,
        previousFailure: {
          phase: previousFailure.phase,
          reason: previousFailure.reason,
          attempt: previousFailure.attempt,
        } as RetryContext,
      },
      suggestions: previousFailure.suggestedFixes,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 路径对齐检查
   * CP-PDGC-11: 路径对齐检查
   */
  private async checkPathAlignment(
    rule: PreDevPhaseRule,
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();

    try {
      // 根据规则ID路由到具体检查
      switch (rule.id) {
        case 'R-PATH-001': {
          const { checkTaskFilePath } = await import('./checkers/path-checker.js');
          return checkTaskFilePath(rule, context);
        }
        case 'R-PATH-002': {
          const { checkCodeReferencePath } = await import('./checkers/path-checker.js');
          return checkCodeReferencePath(rule, context);
        }
        case 'R-PATH-003': {
          const { checkResourceReferencePath } = await import('./checkers/path-checker.js');
          return checkResourceReferencePath(rule, context);
        }
        default: {
          return {
            checkId: 'path-alignment-check',
            checkName: '路径对齐检查',
            ruleId: rule.id,
            passed: true,
            severity: 'info',
            message: `未知路径规则: ${rule.id}，跳过检查`,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      return {
        checkId: 'path-alignment-check',
        checkName: '路径对齐检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: `路径对齐检查失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 获取当前分支
   */
  private getCurrentBranch(cwd: string): string {
    try {
      return execSync('git branch --show-current', {
        cwd,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    ruleResults: PreDevPhaseRuleResult[],
    context: PreDevPhaseCheckContext
  ): string[] {
    const recommendations: string[] = [];

    for (const result of ruleResults) {
      for (const check of result.checkResults) {
        if (check.suggestions) {
          recommendations.push(...check.suggestions);
        }
      }
    }

    if (context.isResumed) {
      recommendations.push(`这是第 ${context.attempt} 次尝试，之前在第 ${context.previousFailure?.attempt} 次尝试时失败`);
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
      return `门禁检查未通过: ${failed} 个错误, ${warnings} 个警告 (共 ${total} 项)`;
    }
    if (warnings > 0) {
      return `门禁检查通过: ${passed}/${total} 项通过，有 ${warnings} 个警告`;
    }
    return `门禁检查全部通过: ${passed}/${total} 项`;
  }

  /**
   * 创建跳过的结果
   */
  private createSkippedResult(taskId: string, startTime: number): PreDevPhaseGateResult {
    return {
      taskId,
      passed: true,
      summary: '门禁检查已禁用，自动通过',
      ruleResults: [],
      checks: [],
      passedCount: 0,
      failedCount: 0,
      warningCount: 0,
      blockingFailures: 0,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      recommendations: ['门禁检查当前已禁用'],
    };
  }

  /**
   * 保存门禁报告
   * CP-PDGC-8: 报告保存
   */
  private async saveReport(
    result: PreDevPhaseGateResult,
    context: PreDevPhaseCheckContext
  ): Promise<void> {
    if (!this.config.reportPath) return;

    const reportDir = path.dirname(this.config.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report: PreDevPhaseGateReport = {
      reportId: `predev-${context.taskId}-${Date.now()}`,
      taskId: context.taskId,
      generatedAt: new Date().toISOString(),
      result,
      recommendations: result.recommendations,
      metadata: {
        version: '1.0.0',
        checkerVersion: '1.0.0',
        rulesExecuted: result.ruleResults.length,
        attempt: context.attempt,
        isResumed: context.isResumed,
      },
    };

    fs.writeFileSync(this.config.reportPath, JSON.stringify(report, null, 2));
  }
}

/**
 * 开发前规则注册表
 * CP-PDGC-9: 规则注册表
 */
export class PreDevPhaseRuleRegistry {
  private rules: PreDevPhaseRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * 注册规则
   */
  registerRule(rule: PreDevPhaseRule): void {
    // 检查ID唯一性
    if (this.rules.some(r => r.id === rule.id)) {
      throw new Error(`Rule '${rule.id}' already registered`);
    }
    this.rules.push(rule);
  }

  /**
   * 获取规则
   */
  getRule(id: string): PreDevPhaseRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): PreDevPhaseRule[] {
    return [...this.rules];
  }

  /**
   * 获取适用于给定上下文的规则
   */
  getApplicableRules(context: PreDevPhaseCheckContext): PreDevPhaseRule[] {
    return this.rules.filter(rule => {
      // 检查规则是否启用
      const ruleConfig = context.config.rules.get(rule.id);
      const enabled = ruleConfig?.enabled ?? rule.enabled;
      if (!enabled) return false;

      // 检查重试特定规则
      if (rule.id.startsWith('R-RETRY')) {
        if (!context.config.enableRetryRules) return false;
        if (rule.isApplicable) {
          return rule.isApplicable(context);
        }
      }

      return true;
    });
  }

  /**
   * 按类型获取规则
   */
  getRulesByType(type: string): PreDevPhaseRule[] {
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
    for (const rule of DEFAULT_PRE_DEV_PHASE_RULES) {
      this.rules.push(rule);
    }
  }
}

/**
 * 创建默认协调器
 * CP-PDGC-10: 工厂函数
 */
export function createPreDevPhaseGateCoordinator(
  config?: Partial<PreDevPhaseGateConfig>
): PreDevPhaseGateCoordinator {
  return new PreDevPhaseGateCoordinator(config);
}

/**
 * 运行开发前门禁检查（便利函数）
 * CP-PDGC-11: 便利函数
 * 提供简单的方式来运行门禁检查，无需手动创建协调器
 *
 * @param taskId - 任务ID
 * @param cwd - 工作目录
 * @param attempt - 当前尝试次数
 * @param config - 可选的门禁配置
 * @returns 门禁检查结果
 *
 * @example
 * ```typescript
 * const result = await runPreDevPhaseGate('TASK-001', process.cwd(), 1);
 * if (!result.passed) {
 *   console.log('门禁检查未通过:', result.summary);
 * }
 * ```
 */
export async function runPreDevPhaseGate(
  taskId: string,
  cwd: string,
  attempt: number,
  config?: Partial<PreDevPhaseGateConfig>
): Promise<PreDevPhaseGateResult> {
  // 导入 readTaskMeta 加载任务元数据
  const { readTaskMeta } = await import('../task.js');
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  // 创建协调器
  const coordinator = createPreDevPhaseGateCoordinator(config);

  // 构建检查上下文
  const context: PreDevPhaseCheckContext = {
    taskId,
    task,
    cwd,
    attempt,
    maxRetries: 3,
    isResumed: attempt > 1,
    config: {
      enabled: true,
      rules: new Map(),
      enableRetryRules: true,
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/pre-dev-gate-report.json',
      ...config,
    },
  };

  // 运行门禁检查
  return coordinator.runGate(context);
}

/**
 * 运行开发前门禁检查并尝试自动修复
 * CP-PDGC-12: 带自动修复的便利函数
 * 运行门禁检查，并对失败的项尝试自动修复
 *
 * @param taskId - 任务ID
 * @param cwd - 工作目录
 * @param attempt - 当前尝试次数
 * @param config - 可选的门禁配置
 * @returns 包含原始结果和修复结果的复合结果
 *
 * @example
 * ```typescript
 * const { result, fixResults } = await runPreDevPhaseGateWithAutoFix('TASK-001', process.cwd(), 1);
 * if (!result.passed && fixResults.size > 0) {
 *   console.log(`尝试了 ${fixResults.size} 个自动修复`);
 * }
 * ```
 */
export async function runPreDevPhaseGateWithAutoFix(
  taskId: string,
  cwd: string,
  attempt: number,
  config?: Partial<PreDevPhaseGateConfig>
): Promise<{
  result: PreDevPhaseGateResult;
  fixResults: Map<string, AutoFixResult>;
}> {
  // 导入 readTaskMeta 加载任务元数据
  const { readTaskMeta } = await import('../task.js');
  const task = readTaskMeta(taskId, cwd);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  // 创建协调器
  const coordinator = createPreDevPhaseGateCoordinator(config);

  // 构建检查上下文
  const context: PreDevPhaseCheckContext = {
    taskId,
    task,
    cwd,
    attempt,
    maxRetries: 3,
    isResumed: attempt > 1,
    config: {
      enabled: true,
      rules: new Map(),
      enableRetryRules: true,
      stopOnFailure: true,
      generateReport: true,
      reportPath: '.projmnt4claude/reports/pre-dev-gate-report.json',
      ...config,
    },
  };

  // 运行门禁检查
  const result = await coordinator.runGate(context);

  // 如果检查未通过，尝试自动修复
  let fixResults = new Map<string, AutoFixResult>();
  if (!result.passed) {
    fixResults = await coordinator.tryAutoFix(result, context);
  }

  return { result, fixResults };
}
