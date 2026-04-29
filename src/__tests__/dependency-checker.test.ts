/**
 * Dependency Checker 单元测试
 *
 * 测试依赖输出检查器的核心功能:
 * - R-DEPOUT-001: 依赖任务输出可用性检查
 * - R-DEPOUT-002: 依赖接口定义检查
 * - R-DEPOUT-003: 循环依赖检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkDependencyOutputAvailable,
  checkDependencyInterface,
  checkCircularDependency,
  type DependencyCheckResult,
} from '../utils/pre-dev-phase-gate/checkers/dependency-checker.js';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
} from '../types/pre-dev-phase-gate.js';
import type { TaskMeta } from '../types/task.js';

// 创建 mock 规则
function createMockRule(overrides: Partial<PreDevPhaseRule> = {}): PreDevPhaseRule {
  return {
    id: 'R-TEST-001',
    type: 'dependency_output',
    name: '测试规则',
    description: '这是一个测试规则',
    enabled: true,
    severity: 'error',
    ...overrides,
  };
}

// 创建 mock 上下文
function createMockContext(
  cwd: string,
  deps: string[] = [],
  overrides: Partial<PreDevPhaseCheckContext> = {}
): PreDevPhaseCheckContext {
  const mockTask: TaskMeta = {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '测试任务描述\n\n## 相关文件\n- src/test.ts',
    type: 'feature',
    priority: 'P1',
    status: 'open',
    dependencies: deps,
    checkpoints: [],
    affected_files: ['src/test.ts'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'test',
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
      generateReport: true,
    },
    ...overrides,
  };
}

describe('Dependency Checker Rules', () => {
  let testDir: string;
  let outputsDir: string;
  let tasksDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync('/tmp/dependency-checker-test-');
    outputsDir = path.join(testDir, '.projmnt4claude', 'outputs');
    tasksDir = path.join(testDir, '.projmnt4claude', 'tasks');

    fs.mkdirSync(outputsDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // ============================================================================
  // R-DEPOUT-001: 依赖任务输出可用性检查
  // ============================================================================
  describe('R-DEPOUT-001: checkDependencyOutputAvailable', () => {
    it('无依赖时应该通过', async () => {
      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, []);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-DEPOUT-001');
      expect(result.checkName).toBe('依赖任务输出可用性检查');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('没有依赖');
    });

    it('依赖输出存在时应该通过', async () => {
      // 创建依赖任务的输出
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      fs.writeFileSync(path.join(depOutputDir, 'output.json'), '{}');
      fs.writeFileSync(path.join(depOutputDir, 'interface.json'), '{}');

      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('输出已就绪');
      expect(result.details).toBeDefined();
      const details = result.details as { dependencies: DependencyCheckResult[] };
      expect(details.dependencies).toHaveLength(1);
      expect(details.dependencies[0].outputsAvailable).toBe(true);
    });

    it('依赖输出不存在时应该失败', async () => {
      const depId = 'TASK-dep-001';
      // 不创建输出目录

      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('缺失');
      expect(result.details).toBeDefined();
      const details = result.details as { missingOutputs: string[] };
      expect(details.missingOutputs.length).toBeGreaterThan(0);
    });

    it('部分输出存在时应该失败', async () => {
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      // 只创建 output.json，不创建 interface.json
      fs.writeFileSync(path.join(depOutputDir, 'output.json'), '{}');

      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details).toBeDefined();
      const details = result.details as { missingOutputs: string[] };
      expect(details.missingOutputs.some(m => m.includes('interface.json'))).toBe(true);
    });

    it('应该支持自定义输出路径模式', async () => {
      const depId = 'TASK-dep-001';
      const customOutputDir = path.join(testDir, 'custom', 'outputs', depId);
      fs.mkdirSync(customOutputDir, { recursive: true });
      fs.writeFileSync(path.join(customOutputDir, 'output.json'), '{}');
      fs.writeFileSync(path.join(customOutputDir, 'interface.json'), '{}');

      const rule = createMockRule({
        id: 'R-DEPOUT-001',
        config: { outputPathPattern: 'custom/outputs/{taskId}/' },
      });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(true);
    });

    it('应该支持多个依赖', async () => {
      const depIds = ['TASK-dep-001', 'TASK-dep-002'];
      for (const depId of depIds) {
        const depOutputDir = path.join(outputsDir, depId);
        fs.mkdirSync(depOutputDir, { recursive: true });
        fs.writeFileSync(path.join(depOutputDir, 'output.json'), '{}');
        fs.writeFileSync(path.join(depOutputDir, 'interface.json'), '{}');
      }

      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, depIds);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('2 个');
    });

    it('应该包含执行时长和时间戳', async () => {
      const rule = createMockRule({ id: 'R-DEPOUT-001' });
      const context = createMockContext(testDir, []);

      const result = await checkDependencyOutputAvailable(rule, context);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // R-DEPOUT-002: 依赖接口定义检查
  // ============================================================================
  describe('R-DEPOUT-002: checkDependencyInterface', () => {
    it('无依赖时应该通过', async () => {
      const rule = createMockRule({ id: 'R-DEPOUT-002' });
      const context = createMockContext(testDir, []);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-DEPOUT-002');
      expect(result.severity).toBe('info');
    });

    it('接口文件完整时应该通过', async () => {
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(depOutputDir, 'interface.json'),
        JSON.stringify({ exports: ['func1'], version: '1.0.0' })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-002' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('接口定义完整');
    });

    it('接口文件不存在时应该失败', async () => {
      const depId = 'TASK-dep-001';
      // 不创建接口文件

      const rule = createMockRule({ id: 'R-DEPOUT-002' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('不完整');
    });

    it('缺少必需字段时应该失败', async () => {
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      // 缺少 exports 字段
      fs.writeFileSync(
        path.join(depOutputDir, 'interface.json'),
        JSON.stringify({ version: '1.0.0' })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-002' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(false);
      expect(result.details).toBeDefined();
      const details = result.details as { results: Array<{ missingFields: string[] }> };
      expect(details.results[0].missingFields).toContain('exports');
    });

    it('无效的JSON应该失败', async () => {
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      fs.writeFileSync(path.join(depOutputDir, 'interface.json'), 'invalid json');

      const rule = createMockRule({ id: 'R-DEPOUT-002' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(false);
    });

    it('应该支持自定义必需字段', async () => {
      const depId = 'TASK-dep-001';
      const depOutputDir = path.join(outputsDir, depId);
      fs.mkdirSync(depOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(depOutputDir, 'interface.json'),
        JSON.stringify({ exports: ['func1'], version: '1.0.0', customField: 'value' })
      );

      const rule = createMockRule({
        id: 'R-DEPOUT-002',
        config: { requiredFields: ['exports', 'customField'] },
      });
      const context = createMockContext(testDir, [depId]);

      const result = await checkDependencyInterface(rule, context);

      expect(result.passed).toBe(true);
    });
  });

  // ============================================================================
  // R-DEPOUT-003: 循环依赖检查
  // ============================================================================
  describe('R-DEPOUT-003: checkCircularDependency', () => {
    it('无依赖时应该通过', async () => {
      const rule = createMockRule({ id: 'R-DEPOUT-003' });
      const context = createMockContext(testDir, []);

      const result = await checkCircularDependency(rule, context);

      expect(result.passed).toBe(true);
      expect(result.checkId).toBe('R-DEPOUT-003');
      expect(result.severity).toBe('info');
    });

    it('无循环依赖时应该通过', async () => {
      const depId = 'TASK-dep-001';
      // 创建依赖任务的meta.json，它不再依赖当前任务
      const depTaskDir = path.join(tasksDir, depId);
      fs.mkdirSync(depTaskDir, { recursive: true });
      fs.writeFileSync(
        path.join(depTaskDir, 'meta.json'),
        JSON.stringify({ id: depId, dependencies: [] })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-003' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkCircularDependency(rule, context);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('未发现');
    });

    it('检测到直接循环依赖时应该失败', async () => {
      const currentTaskId = 'TASK-test-001';
      const depId = 'TASK-dep-001';

      // 创建依赖任务的meta.json，它依赖当前任务（形成循环）
      const depTaskDir = path.join(tasksDir, depId);
      fs.mkdirSync(depTaskDir, { recursive: true });
      fs.writeFileSync(
        path.join(depTaskDir, 'meta.json'),
        JSON.stringify({ id: depId, dependencies: [currentTaskId] })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-003' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkCircularDependency(rule, context);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('循环');
      expect(result.suggestions).toBeDefined();
    });

    it('检测到间接循环依赖时应该失败', async () => {
      const currentTaskId = 'TASK-test-001';
      const depA = 'TASK-dep-a';
      const depB = 'TASK-dep-b';

      // A -> B -> 当前任务（形成循环）
      const depADir = path.join(tasksDir, depA);
      fs.mkdirSync(depADir, { recursive: true });
      fs.writeFileSync(
        path.join(depADir, 'meta.json'),
        JSON.stringify({ id: depA, dependencies: [depB] })
      );

      const depBDir = path.join(tasksDir, depB);
      fs.mkdirSync(depBDir, { recursive: true });
      fs.writeFileSync(
        path.join(depBDir, 'meta.json'),
        JSON.stringify({ id: depB, dependencies: [currentTaskId] })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-003' });
      const context = createMockContext(testDir, [depA]);

      const result = await checkCircularDependency(rule, context);

      expect(result.passed).toBe(false);
    });

    it('应该返回详细的循环路径', async () => {
      const currentTaskId = 'TASK-test-001';
      const depId = 'TASK-dep-001';

      const depTaskDir = path.join(tasksDir, depId);
      fs.mkdirSync(depTaskDir, { recursive: true });
      fs.writeFileSync(
        path.join(depTaskDir, 'meta.json'),
        JSON.stringify({ id: depId, dependencies: [currentTaskId] })
      );

      const rule = createMockRule({ id: 'R-DEPOUT-003' });
      const context = createMockContext(testDir, [depId]);

      const result = await checkCircularDependency(rule, context);

      expect(result.details).toBeDefined();
      const details = result.details as { cycles: string[] };
      expect(details.cycles.length).toBeGreaterThan(0);
    });
  });
});
