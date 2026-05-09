/**
 * Pre-Dev Phase Gate Coordinator 集成测试
 *
 * 测试开发前门禁协调器的核心功能:
 * - CP-1: 协调器执行门禁检查流程
 * - CP-2: 规则注册表管理
 * - CP-3: 多检查器调度执行
 * - CP-PDGC-1: 门禁执行入口
 * - CP-PDGC-2: 规则执行
 * - CP-PDGC-AF-1: 自动修复入口
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  PreDevPhaseGateCoordinator,
  PreDevPhaseRuleRegistry,
  createPreDevPhaseGateCoordinator,
  runPreDevPhaseGate,
  runPreDevPhaseGateWithAutoFix,
} from '../utils/pre-dev-phase-gate/coordinator.js';
import type {
  PreDevPhaseCheckContext,
  PreDevPhaseGateConfig,
  PreDevPhaseRule,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';
import {
  createGitTestEnv,
  createTaskDir,
  type GitTestEnv,
} from '../utils/test-env.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'git_workspace',
    name: '测试规则',
    description: '这是一个测试规则',
    enabled: true,
    severity: 'warning',
    ...overrides,
  };
}

// 创建 mock 上下文
function createMockContext(cwd: string, overrides: Partial<PreDevPhaseCheckContext> = {}): PreDevPhaseCheckContext {
  const mockTask: TaskMeta = {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '测试任务描述\n\n## 相关文件\n- src/test.ts',
    type: 'feature',
    priority: 'P1',
    status: 'open',
    dependencies: [],
    checkpoints: [],
    files: ['src/test.ts'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'cli',
    schemaVersion: 6,
  };

  return {
    taskId: 'TASK-test-001',
    task: mockTask,
    cwd,
    attempt: 1,
    maxRetries: 3,
    isResumed: false,
    config: {
      enabled: true,
      rules: new Map(),
      enableRetryRules: true,
      stopOnFailure: true,
      generateReport: false, // 测试中禁用报告生成
    },
    ...overrides,
  };
}

describe('PreDevPhaseGateCoordinator', () => {
  let gitEnv: GitTestEnv;
  let testDir: string;

  beforeEach(async () => {
    // 创建 Git 测试环境
    gitEnv = await createGitTestEnv();
    testDir = gitEnv.gitDir;

    // 创建 .projmnt4claude 目录结构和任务
    const tasksDir = path.join(testDir, '.projmnt4claude', 'tasks', 'TASK-test-001');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'meta.json'), JSON.stringify({
      id: 'TASK-test-001',
      title: '测试任务',
      type: 'feature',
      priority: 'P1',
    }));
    fs.writeFileSync(path.join(tasksDir, 'contract.json'), JSON.stringify({
      taskId: 'TASK-test-001',
      inputs: [],
      outputs: [],
    }));
  });

  afterEach(() => {
    // 清理测试环境
    gitEnv.cleanup();
  });

  describe('CP-PDGC-1: 门禁执行入口 (runGate)', () => {
    it('应执行门禁检查并返回结果', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        generateReport: false,
      });
      const context = createMockContext(testDir);

      const result = await coordinator.runGate(context);

      expect(result.taskId).toBe('TASK-test-001');
      expect(typeof result.passed).toBe('boolean');
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.ruleResults)).toBe(true);
      expect(Array.isArray(result.checks)).toBe(true);
      expect(typeof result.passedCount).toBe('number');
      expect(typeof result.failedCount).toBe('number');
      expect(typeof result.warningCount).toBe('number');
      expect(typeof result.duration).toBe('number');
      expect(result.timestamp).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('禁用时返回跳过结果', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: false,
      });
      const context = createMockContext(testDir);

      const result = await coordinator.runGate(context);

      expect(result.passed).toBe(true);
      expect(result.summary).toContain('已禁用');
      expect(result.ruleResults).toHaveLength(0);
    });

    it('应包含所有规则检查结果', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        generateReport: false,
      });
      const context = createMockContext(testDir);

      const result = await coordinator.runGate(context);

      // 验证结果结构完整
      expect(result.ruleResults.length).toBeGreaterThan(0);
      expect(result.checks.length).toBeGreaterThanOrEqual(result.ruleResults.length);

      // 验证每个规则结果的结构
      for (const ruleResult of result.ruleResults) {
        expect(ruleResult.ruleId).toBeDefined();
        expect(ruleResult.ruleName).toBeDefined();
        expect(ruleResult.ruleType).toBeDefined();
        expect(typeof ruleResult.passed).toBe('boolean');
        expect(['error', 'warning', 'info']).toContain(ruleResult.severity);
        expect(Array.isArray(ruleResult.checkResults)).toBe(true);
        expect(typeof ruleResult.duration).toBe('number');
        expect(ruleResult.timestamp).toBeDefined();
      }
    });

    it('stopOnFailure=true 时遇到错误停止', async () => {
      // 创建一个不干净的工作区
      gitEnv.createUntracked('uncommitted.txt', 'dirty');

      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        stopOnFailure: true,
        generateReport: false,
      });

      // 设置规则禁用大部分检查，只保留Git工作区检查
      const context = createMockContext(testDir, {
        config: {
          enabled: true,
          rules: new Map([
            ['R-GIT-001', { ruleId: 'R-GIT-001', enabled: true }],
          ]),
          enableRetryRules: false,
          stopOnFailure: true,
          generateReport: false,
        },
      });

      const result = await coordinator.runGate(context);

      // 验证遇到失败后停止
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });

  describe('CP-PDGC-AF-1: 自动修复入口 (tryAutoFix)', () => {
    it('应返回修复结果映射', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        generateReport: false,
      });

      // 创建一个模拟的失败结果
      const mockResult = {
        taskId: 'TASK-test-001',
        passed: false,
        summary: '测试失败',
        ruleResults: [],
        checks: [
          {
            checkId: 'test-check-001',
            checkName: '测试检查',
            ruleId: 'R-TEST-001',
            passed: false,
            severity: 'warning' as const,
            message: '测试检查失败',
            duration: 100,
            timestamp: new Date().toISOString(),
            autoFixable: true,
            autoFix: {
              description: '自动修复测试检查',
              fix: async () => ({ success: true, message: '修复成功' }),
            },
          },
        ],
        passedCount: 0,
        failedCount: 1,
        warningCount: 0,
        blockingFailures: 0,
        duration: 1000,
        timestamp: new Date().toISOString(),
        recommendations: [],
      };

      const context = createMockContext(testDir);
      const fixResults = await coordinator.tryAutoFix(mockResult, context);

      expect(fixResults instanceof Map).toBe(true);
      expect(fixResults.has('test-check-001')).toBe(true);
      expect(fixResults.get('test-check-001')).toEqual({
        success: true,
        message: '修复成功',
      });
    });

    it('应跳过不可自动修复的检查项', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        generateReport: false,
      });

      const mockResult = {
        taskId: 'TASK-test-001',
        passed: false,
        summary: '测试失败',
        ruleResults: [],
        checks: [
          {
            checkId: 'test-check-001',
            checkName: '测试检查',
            ruleId: 'R-TEST-001',
            passed: false,
            severity: 'warning' as const,
            message: '测试检查失败',
            duration: 100,
            timestamp: new Date().toISOString(),
            autoFixable: false, // 不可自动修复
          },
        ],
        passedCount: 0,
        failedCount: 1,
        warningCount: 0,
        blockingFailures: 0,
        duration: 1000,
        timestamp: new Date().toISOString(),
        recommendations: [],
      };

      const context = createMockContext(testDir);
      const fixResults = await coordinator.tryAutoFix(mockResult, context);

      expect(fixResults.has('test-check-001')).toBe(false);
    });
  });

  describe('CP-PDGC-2: 规则执行', () => {
    it('应按类型执行不同规则', async () => {
      const coordinator = new PreDevPhaseGateCoordinator({
        enabled: true,
        generateReport: false,
      });
      const context = createMockContext(testDir);

      const result = await coordinator.runGate(context);

      // 验证至少有一些规则被检查
      expect(result.ruleResults.length).toBeGreaterThan(0);

      // 验证规则类型多样
      const ruleTypes = new Set(result.ruleResults.map(r => r.ruleType));
      expect(ruleTypes.size).toBeGreaterThan(0);
    });
  });
});

describe('PreDevPhaseRuleRegistry', () => {
  it('应初始化默认规则', () => {
    const registry = new PreDevPhaseRuleRegistry();
    const rules = registry.getAllRules();

    expect(rules.length).toBeGreaterThan(0);

    // 验证包含关键规则
    const ruleIds = rules.map(r => r.id);
    expect(ruleIds).toContain('R-GIT-001');
    expect(ruleIds).toContain('R-BR-001');
  });

  it('应注册新规则', () => {
    const registry = new PreDevPhaseRuleRegistry();
    const newRule = createMockRule({ id: 'R-NEW-001', name: '新规则' });

    registry.registerRule(newRule);

    expect(registry.getRule('R-NEW-001')).toBeDefined();
    expect(registry.getRule('R-NEW-001')?.name).toBe('新规则');
  });

  it('不应注册重复ID的规则', () => {
    const registry = new PreDevPhaseRuleRegistry();
    const rule = createMockRule({ id: 'R-DUPLICATE-001' });

    registry.registerRule(rule);

    expect(() => {
      registry.registerRule({ ...rule, name: '不同名称' });
    }).toThrow("Rule 'R-DUPLICATE-001' already registered");
  });

  it('应按类型获取规则', () => {
    const registry = new PreDevPhaseRuleRegistry();
    const gitRules = registry.getRulesByType('git_workspace');

    expect(gitRules.length).toBeGreaterThan(0);
    expect(gitRules.every(r => r.type === 'git_workspace')).toBe(true);
  });

  it('应获取适用于上下文的规则', async () => {
    const registry = new PreDevPhaseRuleRegistry();
    const gitEnv = await createGitTestEnv();

    try {
      const context = createMockContext(gitEnv.gitDir, {
        config: {
          enabled: true,
          rules: new Map([
            ['R-GIT-001', { ruleId: 'R-GIT-001', enabled: true }],
            ['R-BR-001', { ruleId: 'R-BR-001', enabled: false }], // 禁用
          ]),
          enableRetryRules: true,
          stopOnFailure: true,
          generateReport: false,
        },
      });

      const applicableRules = registry.getApplicableRules(context);

      // R-GIT-001 应该启用
      expect(applicableRules.some(r => r.id === 'R-GIT-001')).toBe(true);
    } finally {
      gitEnv.cleanup();
    }
  });

  it('应清除所有规则', () => {
    const registry = new PreDevPhaseRuleRegistry();

    expect(registry.getAllRules().length).toBeGreaterThan(0);

    registry.clear();

    expect(registry.getAllRules()).toHaveLength(0);
  });
});

describe('CP-PDGC-10: 工厂函数 (createPreDevPhaseGateCoordinator)', () => {
  it('应创建默认配置的协调器', () => {
    const coordinator = createPreDevPhaseGateCoordinator();

    expect(coordinator).toBeInstanceOf(PreDevPhaseGateCoordinator);
  });

  it('应使用提供的配置创建协调器', () => {
    const config: Partial<PreDevPhaseGateConfig> = {
      enabled: false,
      stopOnFailure: false,
      generateReport: true,
      reportPath: 'custom-report.json',
    };

    const coordinator = createPreDevPhaseGateCoordinator(config);

    expect(coordinator).toBeInstanceOf(PreDevPhaseGateCoordinator);
  });
});

describe('CP-PDGC-11: 便利函数 (runPreDevPhaseGate)', () => {
  let gitEnv: GitTestEnv;
  let testDir: string;

  beforeEach(async () => {
    gitEnv = await createGitTestEnv();
    testDir = gitEnv.gitDir;

    // 创建任务目录 - 需要完整的 TaskMeta 结构
    const tasksDir = path.join(testDir, '.projmnt4claude', 'tasks', 'TASK-convenience-001');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'meta.json'), JSON.stringify({
      id: 'TASK-convenience-001',
      title: '便利函数测试任务',
      description: '测试描述',
      type: 'feature',
      priority: 'P1',
      status: 'open',
      dependencies: [],
      checkpoints: [],
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      reopenCount: 0,
      requirementHistory: [],
      createdBy: 'cli',
      schemaVersion: 6,
    }));
    fs.writeFileSync(path.join(tasksDir, 'contract.json'), JSON.stringify({
      taskId: 'TASK-convenience-001',
      inputs: [],
      outputs: [],
    }));
  });

  afterEach(() => {
    gitEnv.cleanup();
  });

  it('应使用便捷参数运行门禁检查', async () => {
    const result = await runPreDevPhaseGate(
      'TASK-convenience-001',
      testDir,
      1,
      { generateReport: false }
    );

    expect(result.taskId).toBe('TASK-convenience-001');
    expect(typeof result.passed).toBe('boolean');
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.ruleResults)).toBe(true);
  });

  it('应支持重试次数参数', async () => {
    const result = await runPreDevPhaseGate(
      'TASK-convenience-001',
      testDir,
      2, // 第二次尝试
      { generateReport: false }
    );

    expect(result.taskId).toBe('TASK-convenience-001');
    expect(typeof result.passed).toBe('boolean');
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.ruleResults)).toBe(true);
  });

  it('应接受自定义配置', async () => {
    const result = await runPreDevPhaseGate(
      'TASK-convenience-001',
      testDir,
      1,
      {
        enabled: true,
        stopOnFailure: false,
        generateReport: false,
      }
    );

    expect(result.passed).toBeDefined();
  });

  it('任务不存在时应抛出错误', async () => {
    await expect(
      runPreDevPhaseGate(
        'TASK-nonexistent-001',
        testDir,
        1,
        { generateReport: false }
      )
    ).rejects.toThrow('任务不存在');
  });
});

describe('CP-PDGC-12: 带自动修复的便利函数 (runPreDevPhaseGateWithAutoFix)', () => {
  let gitEnv: GitTestEnv;
  let testDir: string;

  beforeEach(async () => {
    gitEnv = await createGitTestEnv();
    testDir = gitEnv.gitDir;

    // 创建任务目录 - 需要完整的 TaskMeta 结构
    const tasksDir = path.join(testDir, '.projmnt4claude', 'tasks', 'TASK-autofix-001');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'meta.json'), JSON.stringify({
      id: 'TASK-autofix-001',
      title: '自动修复测试任务',
      description: '测试描述',
      type: 'feature',
      priority: 'P1',
      status: 'open',
      dependencies: [],
      checkpoints: [],
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      reopenCount: 0,
      requirementHistory: [],
      createdBy: 'cli',
      schemaVersion: 6,
    }));
    fs.writeFileSync(path.join(tasksDir, 'contract.json'), JSON.stringify({
      taskId: 'TASK-autofix-001',
      inputs: [],
      outputs: [],
    }));
  });

  afterEach(() => {
    gitEnv.cleanup();
  });

  it('应运行门禁检查并返回修复结果', async () => {
    const { result, fixResults } = await runPreDevPhaseGateWithAutoFix(
      'TASK-autofix-001',
      testDir,
      1,
      { generateReport: false }
    );

    expect(result.taskId).toBe('TASK-autofix-001');
    expect(typeof result.passed).toBe('boolean');
    expect(fixResults instanceof Map).toBe(true);
  });
});
