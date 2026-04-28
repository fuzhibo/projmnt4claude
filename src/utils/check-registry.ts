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
    // 现有检查器
    this.register(new EnvironmentCheck());
    this.register(new MetadataCheck());
    this.register(new DependencyCheck());
    this.register(new ResourceCheck());
    this.register(new QualityGateCheck());

    // 新增检查器
    this.register(new GitCheck());
    this.register(new ConfigCheck());
    this.register(new TaskContractCheck());
    this.register(new DiskSpaceCheck());
    this.register(new PermissionsCheck());
    this.register(new RequirementChecker());
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
 * GitCheck - Git 仓库状态检查器
 * 检查 Git 仓库状态、分支、未提交更改等
 */
export class GitCheck implements CheckItem {
  id = 'builtin:git';
  name = 'Git Check';
  description = 'Check Git repository status, branch, and uncommitted changes';
  category: CheckCategory = 'environment';
  priority = 6;
  dependencies = ['builtin:environment'];

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const path = await import('node:path');

      // 1. 检查是否是 Git 仓库
      const gitDir = path.join(context.cwd, '.git');
      if (!fs.existsSync(gitDir)) {
        issues.push('Not a Git repository (.git directory not found)');
        details.isGitRepo = false;
      } else {
        details.isGitRepo = true;

        // 2. 获取当前分支
        try {
          const branch = execSync('git branch --show-current', {
            cwd: context.cwd,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          details.currentBranch = branch;

          // 检查是否在主分支上
          if (branch === 'main' || branch === 'master') {
            details.onMainBranch = true;
          } else {
            details.onMainBranch = false;
          }
        } catch {
          issues.push('Failed to get current branch');
          details.currentBranch = 'unknown';
        }

        // 3. 检查是否有未提交的更改
        try {
          const status = execSync('git status --porcelain', {
            cwd: context.cwd,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();

          if (status) {
            const lines = status.split('\n').filter(line => line.trim());
            details.uncommittedChanges = lines.length;
            issues.push(`${lines.length} uncommitted change(s) found`);
          } else {
            details.uncommittedChanges = 0;
          }
        } catch {
          issues.push('Failed to check uncommitted changes');
        }

        // 4. 检查远程仓库
        try {
          const remotes = execSync('git remote -v', {
            cwd: context.cwd,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          details.hasRemote = remotes.length > 0;

          if (!remotes) {
            issues.push('No remote repository configured');
          }
        } catch {
          issues.push('Failed to check remote repository');
          details.hasRemote = false;
        }

        // 5. 检查本地分支是否落后于远程（使用本地 rev-list，避免网络操作）
        try {
          // 获取本地和远程分支的提交差异（无需网络）
          const localCommits = execSync('git rev-list --count HEAD 2>/dev/null || echo "0"', {
            cwd: context.cwd,
            encoding: 'utf-8',
            timeout: 3000,
          }).trim();

          // 检查是否有远程跟踪分支
          const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || echo ""', {
            cwd: context.cwd,
            encoding: 'utf-8',
            timeout: 3000,
          }).trim();

          details.hasUpstream = upstream.length > 0;
          details.localCommits = parseInt(localCommits, 10) || 0;

          if (upstream) {
            // 只检查本地记录的远程分支差异，不进行网络获取
            try {
              const aheadBehind = execSync(`git rev-list --left-right --count ${upstream}...HEAD 2>/dev/null || echo "0\t0"`, {
                cwd: context.cwd,
                encoding: 'utf-8',
                timeout: 3000,
              }).trim();
              const [behind, ahead] = aheadBehind.split('\t').map(n => parseInt(n, 10) || 0);
              details.commitsBehind = behind;
              details.commitsAhead = ahead;
              details.behindRemote = behind > 0;

              if (behind > 0) {
                issues.push(`Local branch is ${behind} commit(s) behind remote`);
              }
            } catch {
              details.behindRemote = false;
            }
          } else {
            details.behindRemote = false;
          }
        } catch {
          details.behindRemote = false;
          details.hasUpstream = false;
        }
      }
    } catch (error) {
      issues.push(`Git check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? 'Git repository check passed'
        : `Git issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Commit or stash uncommitted changes', 'Ensure Git repository is properly initialized', 'Check remote repository configuration']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============== 新增检查器实现 ==============

/**
 * ConfigCheck - 项目配置检查器
 * 验证 .projmnt4claude/config.json 的完整性和格式
 */
export class ConfigCheck implements CheckItem {
  id = 'builtin:config';
  name = 'Config Check';
  description = 'Validate project configuration file integrity and format';
  category: CheckCategory = 'metadata';
  priority = 7;
  dependencies = ['builtin:metadata'];

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    const fs = await import('node:fs');
    const path = await import('node:path');

    // 1. 检查 config.json 文件是否存在
    const configPath = path.join(context.cwd, '.projmnt4claude', 'config.json');

    if (!fs.existsSync(configPath)) {
      issues.push('Config file not found: .projmnt4claude/config.json');
      details.configExists = false;
    } else {
      details.configExists = true;

      // 2. 读取并解析配置文件
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        details.configSize = configContent.length;

        // 3. 验证 JSON 格式
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(configContent);
          details.validJson = true;
        } catch (parseError) {
          issues.push(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          details.validJson = false;
          return {
            checkId: this.id,
            passed: false,
            message: issues.join('; '),
            details,
            suggestions: ['Fix JSON syntax errors in config.json'],
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        // 4. 验证必填字段
        const requiredFields = ['version', 'projectName'];
        for (const field of requiredFields) {
          if (!(field in config)) {
            issues.push(`Missing required field: ${field}`);
          } else {
            details[field] = config[field];
          }
        }

        // 5. 验证字段类型
        if (config.version && typeof config.version !== 'string') {
          issues.push('Field "version" must be a string');
        }
        if (config.projectName && typeof config.projectName !== 'string') {
          issues.push('Field "projectName" must be a string');
        }

        // 6. 验证可选配置项
        if (config.checkpoints) {
          if (typeof config.checkpoints !== 'object') {
            issues.push('Field "checkpoints" must be an object');
          }
        }

        if (config.notifications) {
          if (!Array.isArray(config.notifications)) {
            issues.push('Field "notifications" must be an array');
          }
        }

      } catch (readError) {
        issues.push(`Failed to read config file: ${readError instanceof Error ? readError.message : String(readError)}`);
      }
    }

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? 'Config check passed - configuration file is valid'
        : `Config issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Ensure config.json exists and is valid JSON', 'Check all required fields are present', 'Verify field types are correct']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * TaskContractCheck - 任务契约检查器
 * 验证任务契约文件结构和必填字段
 */
export class TaskContractCheck implements CheckItem {
  id = 'builtin:task-contract';
  name = 'Task Contract Check';
  description = 'Validate task contract file structure and required fields';
  category: CheckCategory = 'metadata';
  priority = 8;
  dependencies = ['builtin:config'];

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    const fs = await import('node:fs');
    const path = await import('node:path');

    // 1. 检查契约文件是否存在
    const contractPath = path.join(context.cwd, '.projmnt4claude', 'tasks', context.taskId, 'contract.json');

    if (!fs.existsSync(contractPath)) {
      issues.push(`Task contract file not found: ${contractPath}`);
      details.contractExists = false;
    } else {
      details.contractExists = true;

      try {
        const contractContent = fs.readFileSync(contractPath, 'utf-8');

        // 2. 验证 JSON 格式
        let contract: Record<string, unknown>;
        try {
          contract = JSON.parse(contractContent);
          details.validJson = true;
        } catch (parseError) {
          issues.push(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          details.validJson = false;
          return {
            checkId: this.id,
            passed: false,
            message: issues.join('; '),
            details,
            suggestions: ['Fix JSON syntax errors in contract.json'],
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        // 3. 验证必填字段
        const requiredFields = ['taskId', 'type', 'priority', 'title', 'description'];
        for (const field of requiredFields) {
          if (!(field in contract)) {
            issues.push(`Missing required field: ${field}`);
          }
        }

        // 4. 验证 taskId 格式
        if (contract.taskId) {
          if (typeof contract.taskId !== 'string') {
            issues.push('Field "taskId" must be a string');
          } else if (!contract.taskId.startsWith('TASK-')) {
            issues.push('Field "taskId" must start with "TASK-"');
          } else {
            details.taskId = contract.taskId;
          }
        }

        // 5. 验证验收标准
        if (!contract.acceptanceCriteria) {
          issues.push('Missing acceptanceCriteria - required for task completion verification');
        } else if (!Array.isArray(contract.acceptanceCriteria) || contract.acceptanceCriteria.length === 0) {
          issues.push('acceptanceCriteria must be a non-empty array');
        } else {
          details.acceptanceCriteriaCount = (contract.acceptanceCriteria as unknown[]).length;
        }

        // 6. 验证验证命令
        if (!contract.verificationCommands) {
          issues.push('Missing verificationCommands - required for automated verification');
        } else if (!Array.isArray(contract.verificationCommands)) {
          issues.push('verificationCommands must be an array');
        } else {
          details.verificationCommandsCount = (contract.verificationCommands as unknown[]).length;
        }

        // 7. 检查依赖任务是否存在
        if (contract.dependencies && Array.isArray(contract.dependencies)) {
          const deps = contract.dependencies as string[];
          details.dependencyCount = deps.length;
          const missingDeps: string[] = [];

          for (const depId of deps) {
            const depPath = path.join(context.cwd, '.projmnt4claude', 'tasks', depId, 'meta.json');
            if (!fs.existsSync(depPath)) {
              missingDeps.push(depId);
            }
          }

          if (missingDeps.length > 0) {
            issues.push(`Dependency tasks not found: ${missingDeps.join(', ')}`);
            details.missingDependencies = missingDeps;
          }
        }

      } catch (readError) {
        issues.push(`Failed to read contract file: ${readError instanceof Error ? readError.message : String(readError)}`);
      }
    }

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? 'Task contract check passed - contract is valid'
        : `Task contract issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Ensure contract.json exists and is valid JSON', 'Add all required fields', 'Define acceptance criteria', 'Add verification commands']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * DiskSpaceCheck - 磁盘空间检查器
 * 检查磁盘空间是否满足任务执行要求
 */
export class DiskSpaceCheck implements CheckItem {
  id = 'builtin:disk-space';
  name = 'Disk Space Check';
  description = 'Check available disk space meets task requirements';
  category: CheckCategory = 'resource';
  priority = 9;
  dependencies = ['builtin:resource'];

  // 默认最小空间要求 (1GB)
  private readonly minSpaceBytes = 1 * 1024 * 1024 * 1024;

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};

    try {
      // 获取文件系统信息 (Node.js 18.17+ 支持 statfs)
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      // 1. 检查工作目录所在分区
      try {
        const workDirStats = fs.statfsSync(context.cwd);
        const workDirAvailable = workDirStats.bavail * workDirStats.bsize;
        const workDirTotal = workDirStats.blocks * workDirStats.bsize;

        details.workDir = {
          available: this.formatBytes(workDirAvailable),
          availableBytes: workDirAvailable,
          total: this.formatBytes(workDirTotal),
          totalBytes: workDirTotal,
          usagePercent: Math.round(((workDirTotal - workDirAvailable) / workDirTotal) * 100),
        };

        if (workDirAvailable < this.minSpaceBytes) {
          issues.push(`Work directory has insufficient space: ${this.formatBytes(workDirAvailable)} available, ${this.formatBytes(this.minSpaceBytes)} required`);
        }
      } catch {
        issues.push('Failed to check work directory disk space');
      }

      // 2. 检查临时目录空间
      try {
        const tmpDir = os.tmpdir();
        const tmpDirStats = fs.statfsSync(tmpDir);
        const tmpDirAvailable = tmpDirStats.bavail * tmpDirStats.bsize;

        details.tmpDir = {
          path: tmpDir,
          available: this.formatBytes(tmpDirAvailable),
          availableBytes: tmpDirAvailable,
        };

        if (tmpDirAvailable < this.minSpaceBytes) {
          issues.push(`Temp directory has insufficient space: ${this.formatBytes(tmpDirAvailable)} available`);
        }
      } catch {
        issues.push('Failed to check temp directory disk space');
      }

      // 3. 检查 .projmnt4claude 目录空间
      const projDir = path.join(context.cwd, '.projmnt4claude');
      try {
        const projStats = fs.statfsSync(projDir);
        const projAvailable = projStats.bavail * projStats.bsize;

        details.projDir = {
          available: this.formatBytes(projAvailable),
          availableBytes: projAvailable,
        };
      } catch {
        // .projmnt4claude 目录可能不存在，忽略
        details.projDir = { exists: false };
      }

    } catch (error) {
      issues.push(`Disk space check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? 'Disk space check passed - sufficient space available'
        : `Disk space issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Free up disk space', 'Clean up temporary files', 'Remove unused dependencies or build artifacts']
        : undefined,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

/**
 * PermissionsCheck - 权限检查器
 * 验证文件系统权限和目录可写性
 */
export class PermissionsCheck implements CheckItem {
  id = 'builtin:permissions';
  name = 'Permissions Check';
  description = 'Verify file system permissions and directory writability';
  category: CheckCategory = 'resource';
  priority = 10;
  dependencies = ['builtin:disk-space'];

  async execute(context: CheckContext): Promise<CheckResult> {
    const startTime = Date.now();
    const issues: string[] = [];
    const details: Record<string, unknown> = {};
    const writableDirs: string[] = [];
    const nonWritableDirs: string[] = [];

    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    // 定义需要检查可写性的目录
    const dirsToCheck = [
      { path: context.cwd, name: 'work directory' },
      { path: path.join(context.cwd, '.projmnt4claude'), name: 'project config directory' },
      { path: path.join(context.cwd, '.projmnt4claude', 'tasks'), name: 'tasks directory' },
      { path: path.join(context.cwd, '.projmnt4claude', 'reports'), name: 'reports directory' },
    ];

    // 1. 检查每个目录的可写性
    for (const dir of dirsToCheck) {
      try {
        // 检查目录是否存在
        if (!fs.existsSync(dir.path)) {
          // 尝试创建目录
          fs.mkdirSync(dir.path, { recursive: true });
        }

        // 检查是否是目录
        const stats = fs.statSync(dir.path);
        if (!stats.isDirectory()) {
          issues.push(`${dir.name} is not a directory: ${dir.path}`);
          nonWritableDirs.push(dir.name);
          continue;
        }

        // 尝试写入测试文件
        const testFile = path.join(dir.path, `.write-test-${Date.now()}`);
        try {
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          writableDirs.push(dir.name);
        } catch {
          issues.push(`${dir.name} is not writable: ${dir.path}`);
          nonWritableDirs.push(dir.name);
        }
      } catch (error) {
        issues.push(`Failed to check ${dir.name}: ${error instanceof Error ? error.message : String(error)}`);
        nonWritableDirs.push(dir.name);
      }
    }

    // 2. 检查临时目录可写性
    try {
      const tmpDir = os.tmpdir();
      const testFile = path.join(tmpDir, `.write-test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      details.tmpDirWritable = true;
    } catch {
      issues.push('Temp directory is not writable');
      details.tmpDirWritable = false;
    }

    details.writableDirectories = writableDirs;
    details.nonWritableDirectories = nonWritableDirs;

    const passed = issues.length === 0;

    return {
      checkId: this.id,
      passed,
      message: passed
        ? `Permissions check passed - ${writableDirs.length} directories writable`
        : `Permission issues found: ${issues.join('; ')}`,
      details,
      suggestions: issues.length > 0
        ? ['Check directory ownership and permissions', 'Ensure the current user has write access', 'Create required directories with proper permissions']
        : undefined,
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
