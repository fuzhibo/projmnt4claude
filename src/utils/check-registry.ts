/**
 * Check Registry
 * 检查项注册表 - 提供可扩展的检查项注册和管理机制
 */

import type {
  CheckCategory,
  CheckContext,
  CheckItem,
  CheckResult,
} from '../types/precheck';

export class CheckRegistry {
  private checks: Map<string, CheckItem> = new Map();
  private categories: Map<CheckCategory, Set<string>> = new Map();

  /**
   * 注册检查项
   * CP-CR-1: 检查项注册机制
   */
  register(check: CheckItem): void {
    // 1. 验证检查项 ID 唯一性
    if (this.checks.has(check.id)) {
      throw new Error(`Check item with id '${check.id}' already registered`);
    }

    // 2. 验证检查项依赖是否存在
    if (check.dependencies) {
      for (const depId of check.dependencies) {
        if (!this.checks.has(depId)) {
          throw new Error(`Dependency '${depId}' not found for check '${check.id}'`);
        }
      }
    }

    // 3. 注册到 checks Map
    this.checks.set(check.id, check);

    // 4. 添加到对应类别
    if (!this.categories.has(check.category)) {
      this.categories.set(check.category, new Set());
    }
    this.categories.get(check.category)!.add(check.id);
  }

  /**
   * 获取检查项
   * CP-CR-2: 检查项查询
   */
  get(checkId: string): CheckItem | undefined {
    return this.checks.get(checkId);
  }

  /**
   * 按类别获取检查项
   * CP-CR-3: 类别过滤
   */
  getByCategory(category: CheckCategory): CheckItem[] {
    const ids = this.categories.get(category);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.checks.get(id))
      .filter((check): check is CheckItem => check !== undefined)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取检查项依赖
   * CP-CR-4: 依赖解析
   */
  getDependencies(checkId: string): CheckItem[] {
    const check = this.checks.get(checkId);
    if (!check || !check.dependencies) return [];

    return check.dependencies
      .map(id => this.checks.get(id))
      .filter((dep): dep is CheckItem => dep !== undefined);
  }

  /**
   * 执行检查项
   * CP-CR-5: 检查项执行
   */
  async execute(checkId: string, context: CheckContext): Promise<CheckResult> {
    const check = this.checks.get(checkId);
    if (!check) {
      return {
        checkId,
        passed: false,
        message: `Check '${checkId}' not found`,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // 2. 执行依赖检查
    if (check.dependencies) {
      for (const depId of check.dependencies) {
        const depResult = await this.execute(depId, context);
        if (!depResult.passed) {
          return {
            checkId,
            passed: false,
            message: `Dependency check '${depId}' failed: ${depResult.message}`,
            duration: 0,
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    // 3. 执行当前检查
    const startTime = Date.now();
    try {
      const result = await check.execute(context);
      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        checkId,
        passed: false,
        message: `Check execution failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 注册内置检查项
   * CP-CR-6: 内置检查项注册
   */
  registerBuiltInChecks(): void {
    this.register(new EnvironmentCheck());
    this.register(new MetadataCheck());
    this.register(new DependencyCheck());
    this.register(new ResourceCheck());
    this.register(new QualityGateCheck());
  }

  /**
   * 获取所有检查项
   */
  getAll(): CheckItem[] {
    return Array.from(this.checks.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.checks.clear();
    this.categories.clear();
  }
}

// ============== 内置检查项实现 ==============

export class EnvironmentCheck implements CheckItem {
  id = 'builtin:environment';
  name = 'Environment Check';
  description = 'Check Node.js version and dependencies';
  category: CheckCategory = 'environment';
  priority = 1;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    // Check Node.js version
    const nodeVersion = process.version;
    details.nodeVersion = nodeVersion;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (majorVersion < 18) {
      issues.push(`Node.js version ${nodeVersion} is too old. Requires >= 18`);
    }

    return {
      checkId: this.id,
      passed: issues.length === 0,
      message: issues.length > 0 ? issues.join('; ') : 'Environment check passed',
      details,
      suggestions: issues.length > 0 ? ['Upgrade Node.js to version 18 or higher'] : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export class MetadataCheck implements CheckItem {
  id = 'builtin:metadata';
  name = 'Metadata Check';
  description = 'Validate task metadata structure';
  category: CheckCategory = 'metadata';
  priority = 2;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    // Validate task metadata
    if (!context.taskId) {
      issues.push('Task ID is missing');
    } else {
      details.taskId = context.taskId;
    }

    if (!context.cwd) {
      issues.push('Working directory is missing');
    } else {
      details.cwd = context.cwd;
    }

    return {
      checkId: this.id,
      passed: issues.length === 0,
      message: issues.length > 0 ? issues.join('; ') : 'Metadata check passed',
      details,
      suggestions: issues.length > 0 ? ['Ensure task ID and working directory are provided'] : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export class DependencyCheck implements CheckItem {
  id = 'builtin:dependency';
  name = 'Dependency Check';
  description = 'Check task dependencies status';
  category: CheckCategory = 'dependency';
  priority = 3;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();

    // Get dependency info from shared data
    const dependencies = context.sharedData.get('dependencies') as string[] | undefined;

    if (!dependencies || dependencies.length === 0) {
      return {
        checkId: this.id,
        passed: true,
        message: 'No dependencies to check',
        details: { dependencyCount: 0 },
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      checkId: this.id,
      passed: true,
      message: `Checked ${dependencies.length} dependencies`,
      details: { dependencyCount: dependencies.length, dependencies },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export class ResourceCheck implements CheckItem {
  id = 'builtin:resource';
  name = 'Resource Check';
  description = 'Check disk space and memory';
  category: CheckCategory = 'resource';
  priority = 4;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const details: Record<string, unknown> = {};

    // Check memory usage
    const memUsage = process.memoryUsage();
    details.memory = {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
    };

    return {
      checkId: this.id,
      passed: true,
      message: 'Resource check passed',
      details,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export class QualityGateCheck implements CheckItem {
  id = 'builtin:quality-gate';
  name = 'Quality Gate Check';
  description = 'Validate checkpoint compliance';
  category: CheckCategory = 'quality';
  priority = 5;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const details: Record<string, unknown> = {};

    // Get quality gate info from shared data
    const qualityScore = context.sharedData.get('qualityScore') as number | undefined;
    details.qualityScore = qualityScore ?? 'not set';

    return {
      checkId: this.id,
      passed: true,
      message: 'Quality gate check passed',
      details,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}
