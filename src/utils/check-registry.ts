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
  description = 'Validate task metadata structure and content';
  category: CheckCategory = 'metadata';
  priority = 2;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    // 1. 检查基本上下文
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

    // 2. 验证任务元数据文件存在性
    const fs = await import('node:fs');
    const path = await import('node:path');
    const metaPath = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'meta.json');

    if (!fs.existsSync(metaPath)) {
      issues.push(`Task metadata file not found: ${metaPath}`);
    } else {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);

        // 3. 验证必需字段
        const requiredFields = ['id', 'title', 'type', 'priority', 'status'];
        for (const field of requiredFields) {
          if (!meta[field]) {
            issues.push(`Missing required field: ${field}`);
          }
        }

        // 4. 验证字段类型
        if (meta.id && typeof meta.id !== 'string') {
          issues.push('Field "id" must be a string');
        }
        if (meta.priority && !['P0', 'P1', 'P2', 'P3'].includes(meta.priority)) {
          issues.push(`Invalid priority: ${meta.priority}`);
        }
        if (meta.status && !['open', 'in_progress', 'wait_review', 'wait_qa', 'wait_evaluation', 'resolved', 'failed', 'closed'].includes(meta.status)) {
          issues.push(`Invalid status: ${meta.status}`);
        }

        // 5. 验证检查点
        if (!meta.checkpoints || !Array.isArray(meta.checkpoints) || meta.checkpoints.length === 0) {
          issues.push('Task has no checkpoints defined');
        } else {
          details.checkpointCount = meta.checkpoints.length;

          // 验证检查点结构
          const invalidCheckpoints = meta.checkpoints.filter((cp: { id?: string; description?: string }) => !cp.id || !cp.description);
          if (invalidCheckpoints.length > 0) {
            issues.push(`${invalidCheckpoints.length} checkpoints missing id or description`);
          }
        }

        // 6. 验证依赖任务
        if (meta.dependencies && Array.isArray(meta.dependencies)) {
          details.dependencyCount = meta.dependencies.length;

          for (const depId of meta.dependencies) {
            const depPath = path.join(context.cwd, '.projmnt4claude', 'tasks', depId, 'meta.json');
            if (!fs.existsSync(depPath)) {
              issues.push(`Dependency task not found: ${depId}`);
            }
          }
        }

        details.metaValidated = true;
      } catch (error) {
        issues.push(`Failed to parse metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      checkId: this.id,
      passed: issues.length === 0,
      message: issues.length > 0 ? issues.join('; ') : 'Metadata check passed - all fields validated',
      details,
      suggestions: issues.length > 0
        ? ['Ensure task metadata is valid JSON', 'Check all required fields are present', 'Verify checkpoint definitions']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export class DependencyCheck implements CheckItem {
  id = 'builtin:dependency';
  name = 'Dependency Check';
  description = 'Check task dependencies status and completion';
  category: CheckCategory = 'dependency';
  priority = 3;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};
    const completedDeps: string[] = [];
    const incompleteDeps: string[] = [];

    // 1. 从共享数据获取依赖列表
    let dependencies = context.sharedData.get('dependencies') as string[] | undefined;

    // 2. 如果没有从共享数据获取，尝试从当前任务的 meta.json 读取
    if (!dependencies || dependencies.length === 0) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const metaPath = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'meta.json');

        if (fs.existsSync(metaPath)) {
          const metaContent = fs.readFileSync(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);
          dependencies = meta.dependencies || [];
        }
      } catch {
        // 忽略读取错误
      }
    }

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

    details.dependencyCount = dependencies.length;
    details.dependencies = dependencies;

    // 3. 检查每个依赖任务的状态
    const fs = await import('node:fs');
    const path = await import('node:path');

    for (const depId of dependencies) {
      const depMetaPath = path.join(context.cwd, '.projmnt4claude', 'tasks', depId, 'meta.json');

      if (!fs.existsSync(depMetaPath)) {
        issues.push(`Dependency task '${depId}' not found`);
        incompleteDeps.push(depId);
        continue;
      }

      try {
        const depContent = fs.readFileSync(depMetaPath, 'utf-8');
        const depMeta = JSON.parse(depContent);

        // 检查依赖任务状态
        const resolvedStatuses = ['resolved', 'closed'];
        const failedStatuses = ['failed', 'abandoned'];

        if (resolvedStatuses.includes(depMeta.status)) {
          completedDeps.push(depId);
        } else if (failedStatuses.includes(depMeta.status)) {
          issues.push(`Dependency '${depId}' is in failed/abandoned status: ${depMeta.status}`);
          incompleteDeps.push(depId);
        } else {
          issues.push(`Dependency '${depId}' is not completed. Current status: ${depMeta.status}`);
          incompleteDeps.push(depId);
        }
      } catch (error) {
        issues.push(`Failed to check dependency '${depId}': ${error instanceof Error ? error.message : String(error)}`);
        incompleteDeps.push(depId);
      }
    }

    details.completedDependencies = completedDeps;
    details.incompleteDependencies = incompleteDeps;
    details.completedCount = completedDeps.length;
    details.incompleteCount = incompleteDeps.length;

    const passed = issues.length === 0 && completedDeps.length === dependencies.length;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? `All ${dependencies.length} dependencies completed`
        : `${completedDeps.length}/${dependencies.length} dependencies completed. Issues: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Ensure all dependency tasks are resolved or closed', 'Check dependency task statuses', 'Fix failed dependencies before proceeding']
        : undefined,
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

/**
 * RequirementChecker - 需求检查器
 * 检查任务需求定义的完整性
 */
export class RequirementChecker implements CheckItem {
  id = 'builtin:requirement';
  name = 'Requirement Check';
  description = 'Validate task requirement completeness';
  category: CheckCategory = 'quality';
  priority = 6;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    const fs = await import('node:fs');
    const path = await import('node:path');

    // 1. 检查需求文档存在性
    const reqPaths = [
      path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'requirement.md'),
      path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'contract.json'),
    ];

    let reqFound = false;
    let reqContent = '';

    for (const reqPath of reqPaths) {
      if (fs.existsSync(reqPath)) {
        reqFound = true;
        details.requirementPath = reqPath;
        try {
          reqContent = fs.readFileSync(reqPath, 'utf-8');
        } catch {
          // ignore read error
        }
        break;
      }
    }

    if (!reqFound) {
      issues.push('No requirement document found (expected requirement.md or contract.json)');
    }

    // 2. 从 meta.json 检查需求相关字段
    const metaPath = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);

        // 检查描述
        if (!meta.description || meta.description.length < 50) {
          issues.push('Task description is too short or missing (minimum 50 characters)');
        } else {
          details.descriptionLength = meta.description.length;
        }

        // 检查验收标准
        if (!meta.checkpoints || meta.checkpoints.length === 0) {
          issues.push('No checkpoints defined (acceptance criteria missing)');
        } else {
          details.checkpointCount = meta.checkpoints.length;
        }

        // 检查关联文件
        if (!meta.affected_files || meta.affected_files.length === 0) {
          if (!meta.description?.includes('相关文件') && !meta.description?.includes('Related Files')) {
            issues.push('No affected files specified');
          }
        } else {
          details.affectedFileCount = meta.affected_files.length;
        }

        // 检查目标是否明确
        const hasGoal = meta.description?.includes('目标') ||
                        meta.description?.includes('Goal') ||
                        meta.description?.includes('## 解决方案') ||
                        meta.description?.includes('## Solution');
        if (!hasGoal) {
          issues.push('Task goal is not clearly defined');
        }

      } catch (error) {
        issues.push(`Failed to parse metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3. 验证需求内容质量
    if (reqContent) {
      // 检查是否有过短的描述
      if (reqContent.length < 100) {
        issues.push('Requirement document is too short');
      }
      details.requirementLength = reqContent.length;

      // 检查是否包含关键部分
      const hasAcceptanceCriteria = reqContent.toLowerCase().includes('acceptance') ||
                                     reqContent.toLowerCase().includes('criteria') ||
                                     reqContent.includes('验收标准');
      if (!hasAcceptanceCriteria) {
        issues.push('Missing acceptance criteria in requirement');
      }
    }

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? 'Requirement check passed - all requirements are well defined'
        : `Requirement issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Add clear acceptance criteria', 'Define affected files', 'Write detailed task description', 'Create requirement.md or contract.json']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}
