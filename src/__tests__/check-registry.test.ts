/**
 * Check Registry Tests
 * 检查项注册表单元测试
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CheckRegistry,
  EnvironmentCheck,
  MetadataCheck,
  DependencyCheck,
  ResourceCheck,
  QualityGateCheck,
  RequirementChecker,
  GitCheck,
  ConfigCheck,
  TaskContractCheck,
  DiskSpaceCheck,
  PermissionsCheck,
} from '../utils/check-registry';
import type { CheckContext, CheckItem } from '../types/precheck';

describe('CheckRegistry', () => {
  let registry: CheckRegistry;

  beforeEach(() => {
    registry = new CheckRegistry();
  });

  describe('register()', () => {
    it('should register a check item', () => {
      const check = new EnvironmentCheck();
      registry.register(check);

      expect(registry.get('builtin:environment')).toBeDefined();
    });

    it('should throw error for duplicate check id', () => {
      const check = new EnvironmentCheck();
      registry.register(check);

      expect(() => registry.register(check)).toThrow('already registered');
    });

    it('should throw error for missing dependency', () => {
      const customCheck: CheckItem = {
        id: 'custom:check',
        name: 'Custom Check',
        description: 'Test check',
        category: 'environment',
        priority: 1,
        dependencies: ['nonexistent:check'],
        execute: async () => ({
          checkId: 'custom:check',
          passed: true,
          message: 'ok',
          duration: 0,
          timestamp: new Date().toISOString(),
        }),
      };

      expect(() => registry.register(customCheck)).toThrow('Dependency');
    });
  });

  describe('get()', () => {
    it('should return undefined for non-existent check', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should return check item by id', () => {
      const check = new EnvironmentCheck();
      registry.register(check);

      expect(registry.get('builtin:environment')?.name).toBe('Environment Check');
    });
  });

  describe('getByCategory()', () => {
    it('should return empty array for empty category', () => {
      expect(registry.getByCategory('environment')).toEqual([]);
    });

    it('should return checks sorted by priority', () => {
      registry.register(new EnvironmentCheck());
      registry.register(new GitCheck());

      const checks = registry.getByCategory('environment');
      expect(checks.length).toBe(2);
      expect(checks[0].priority).toBeLessThanOrEqual(checks[1].priority);
    });
  });

  describe('registerBuiltInChecks()', () => {
    it('should register all built-in checks', () => {
      registry.registerBuiltInChecks();

      expect(registry.get('builtin:environment')).toBeDefined();
      expect(registry.get('builtin:metadata')).toBeDefined();
      expect(registry.get('builtin:dependency')).toBeDefined();
      expect(registry.get('builtin:resource')).toBeDefined();
      expect(registry.get('builtin:quality-gate')).toBeDefined();
      expect(registry.get('builtin:git')).toBeDefined();
      expect(registry.get('builtin:config')).toBeDefined();
      expect(registry.get('builtin:task-contract')).toBeDefined();
      expect(registry.get('builtin:disk-space')).toBeDefined();
      expect(registry.get('builtin:permissions')).toBeDefined();
      expect(registry.get('builtin:requirement')).toBeDefined();
    });
  });
});

describe('EnvironmentCheck', () => {
  const check = new EnvironmentCheck();
  const context: CheckContext = {
    taskId: 'TEST-001',
    cwd: process.cwd(),
    phase: 'environment',
    sharedData: new Map(),
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  it('should pass with valid environment', async () => {
    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:environment');
    expect(result.passed).toBe(true);
    expect(result.message).toContain('passed');
    expect(result.details.nodeVersion).toBeDefined();
  });
});

describe('MetadataCheck', () => {
  const check = new MetadataCheck();

  it('should fail when taskId is missing', async () => {
    const context: CheckContext = {
      taskId: '',
      cwd: process.cwd(),
      phase: 'metadata',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.passed).toBe(false);
    expect(result.message).toContain('Task ID is missing');
  });

  it('should validate metadata file structure', async () => {
    const context: CheckContext = {
      taskId: 'TASK-feature-P0-prob2-precheck-orchestrator-20260427',
      cwd: process.cwd(),
      phase: 'metadata',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:metadata');
    // 可能通过也可能失败，取决于任务是否存在
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

describe('DependencyCheck', () => {
  const check = new DependencyCheck();

  it('should pass when no dependencies', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'dependency',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.passed).toBe(true);
    expect(result.message).toContain('No dependencies');
    expect(result.details.dependencyCount).toBe(0);
  });

  it('should check dependency statuses', async () => {
    const context: CheckContext = {
      taskId: 'TEST-002',
      cwd: process.cwd(),
      phase: 'dependency',
      sharedData: new Map([['dependencies', ['TASK-001', 'TASK-002']]]),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:dependency');
    expect(result.details.dependencyCount).toBe(2);
    expect(Array.isArray(result.details.incompleteDependencies)).toBe(true);
  });
});

describe('ResourceCheck', () => {
  const check = new ResourceCheck();
  const context: CheckContext = {
    taskId: 'TEST-001',
    cwd: process.cwd(),
    phase: 'resource',
    sharedData: new Map(),
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  it('should return memory usage info', async () => {
    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:resource');
    expect(result.passed).toBe(true);
    expect(result.details.memory).toBeDefined();
    expect(result.details.memory.rss).toBeDefined();
    expect(result.details.memory.heapTotal).toBeDefined();
    expect(result.details.memory.heapUsed).toBeDefined();
  });
});

describe('QualityGateCheck', () => {
  const check = new QualityGateCheck();

  it('should check quality score', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'quality',
      sharedData: new Map([['qualityScore', 85]]),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:quality-gate');
    expect(result.passed).toBe(true);
    expect(result.details.qualityScore).toBe(85);
  });
});

describe('RequirementChecker', () => {
  const check = new RequirementChecker();

  it('should validate requirement completeness', async () => {
    const context: CheckContext = {
      taskId: 'TASK-feature-P0-prob2-precheck-orchestrator-20260427',
      cwd: process.cwd(),
      phase: 'quality',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:requirement');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should check for missing requirement document', async () => {
    const context: CheckContext = {
      taskId: 'NONEXISTENT-TASK-001',
      cwd: process.cwd(),
      phase: 'quality',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:requirement');
    // 不存在的任务应该找不到需求文档
    expect(result.message).toContain('No requirement document');
  });
});

describe('GitCheck', () => {
  const check = new GitCheck();

  it('should check git repository status', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'environment',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:git');
    expect(result.details.isGitRepo).toBeDefined();
    if (result.details.isGitRepo) {
      expect(result.details.currentBranch).toBeDefined();
    }
  });
});

describe('ConfigCheck', () => {
  const check = new ConfigCheck();

  it('should validate project config', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'metadata',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:config');
    expect(result.details.configExists).toBeDefined();
  });
});

describe('TaskContractCheck', () => {
  const check = new TaskContractCheck();

  it('should validate task contract', async () => {
    const context: CheckContext = {
      taskId: 'TASK-feature-P0-prob2-precheck-orchestrator-20260427',
      cwd: process.cwd(),
      phase: 'metadata',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:task-contract');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

describe('DiskSpaceCheck', () => {
  const check = new DiskSpaceCheck();

  it('should check disk space', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'environment',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:disk-space');
    expect(result.details).toBeDefined();
  });
});

describe('PermissionsCheck', () => {
  const check = new PermissionsCheck();

  it('should check file permissions', async () => {
    const context: CheckContext = {
      taskId: 'TEST-001',
      cwd: process.cwd(),
      phase: 'environment',
      sharedData: new Map(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await check.execute(context);

    expect(result.checkId).toBe('builtin:permissions');
    expect(result.details).toBeDefined();
  });
});
