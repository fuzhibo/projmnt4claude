/**
 * PreEvalGateRunner 单元测试
 *
 * 测试评估阶段前门禁协调器的核心功能:
 * - QA验证通过检查 (R-EVAL-PRE-001)
 * - 阶段报告存在性检查 (R-EVAL-PRE-002~004)
 * - 检查点完成检查 (R-EVAL-PRE-005)
 * - 阶段历史完整性检查 (R-EVAL-PRE-006)
 * - 结果聚合与决策
 * - 报告生成
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  PreEvalGateRunner,
  createPreEvalGateRunner,
  quickPreEvalGateCheck,
  batchPreEvalGateCheck,
  DEFAULT_PRE_EVAL_GATE_RUNNER_CONFIG,
} from '../utils/pre-eval-gate/runner.js';
import type {
  PreEvalGateRunnerConfig,
  PreEvalCheckResult,
  QAReport,
} from '../utils/pre-eval-gate/types.js';
import type { TaskMeta } from '../types/task.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// 测试辅助函数
function createMockTask(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    id: 'TASK-test-001',
    title: '测试任务',
    description: '这是一个测试任务的描述',
    type: 'feature',
    priority: 'P2',
    status: 'wait_evaluation',
    dependencies: [],
    checkpoints: [
      { id: 'CP-001', description: '功能测试', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'CP-002', description: '回归测试', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    files: ['src/test.ts'],
    phaseHistory: [
      { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: new Date().toISOString() },
      { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: new Date().toISOString() },
      { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: new Date().toISOString() },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy: 'cli',
    schemaVersion: 6,
    ...overrides,
  };
}

function createMockQAReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    version: '1.0.0',
    taskId: 'TASK-test-001',
    verdict: 'PASS',
    verifiedAt: new Date().toISOString(),
    verifier: 'test-system',
    summary: '所有测试通过',
    ...overrides,
  };
}

function setupTaskDir(tasksDir: string, taskId: string, task: TaskMeta): void {
  const taskDir = path.join(tasksDir, taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(task, null, 2));
}

function setupOutputsDir(projectDir: string, taskId: string, files: Record<string, unknown>): void {
  const outputsDir = path.join(projectDir, '.projmnt4claude', 'outputs', taskId);
  fs.mkdirSync(outputsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputsDir, name), JSON.stringify(content, null, 2));
  }
}

describe('PreEvalGateRunner', () => {
  let env: IsolatedTestEnv;
  let testDir: string;
  let tasksDir: string;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    testDir = env.projectDir;
    tasksDir = env.tasksDir;
    const configDir = path.join(testDir, '.projmnt4claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ version: '1.0.0', projectName: 'test-project' })
    );
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('基础功能', () => {
    it('应该创建实例', () => {
      const runner = new PreEvalGateRunner(testDir);
      expect(runner).toBeDefined();
      expect(runner.getConfig()).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const runner = new PreEvalGateRunner(testDir);
      const config = runner.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.stopOnFailure).toBe(false);
      expect(config.generateReport).toBe(true);
      expect(config.qaReportPath).toContain('{taskId}');
    });

    it('应该支持自定义配置', () => {
      const customConfig: Partial<PreEvalGateRunnerConfig> = {
        enabled: false,
        stopOnFailure: true,
      };
      const runner = new PreEvalGateRunner(testDir, customConfig);
      const config = runner.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.stopOnFailure).toBe(true);
    });

    it('应该通过 createPreEvalGateRunner 创建实例', () => {
      const runner = createPreEvalGateRunner(testDir);
      expect(runner).toBeInstanceOf(PreEvalGateRunner);
    });
  });

  describe('R-EVAL-PRE-001: QA验证通过检查', () => {
    it('QA报告为 PASS 时应通过', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'qa-report.json': createMockQAReport({ verdict: 'PASS' }),
        'dev-report.json': { version: '1.0.0' },
        'code-review-report.json': { version: '1.0.0' },
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const qaRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-001');
      expect(qaRule).toBeDefined();
      expect(qaRule!.passed).toBe(true);
      expect(qaRule!.severity).toBe('ERROR');
    });

    it('QA报告为 NOPASS 时应失败', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'qa-report.json': createMockQAReport({ verdict: 'NOPASS' }),
        'dev-report.json': { version: '1.0.0' },
        'code-review-report.json': { version: '1.0.0' },
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const qaRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-001');
      expect(qaRule).toBeDefined();
      expect(qaRule!.passed).toBe(false);
      expect(qaRule!.severity).toBe('ERROR');
    });

    it('QA报告不存在时应失败', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': { version: '1.0.0' },
        'code-review-report.json': { version: '1.0.0' },
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const qaRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-001');
      expect(qaRule).toBeDefined();
      expect(qaRule!.passed).toBe(false);
    });
  });

  describe('R-EVAL-PRE-002~004: 阶段报告存在性检查', () => {
    it('所有报告存在时应全部通过', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': { version: '1.0.0' },
        'code-review-report.json': { version: '1.0.0' },
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const devReport = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-002');
      const crReport = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-003');
      const qaReport = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-004');

      expect(devReport!.passed).toBe(true);
      expect(crReport!.passed).toBe(true);
      expect(qaReport!.passed).toBe(true);
    });

    it('缺少 dev-report.json 时 R-EVAL-PRE-002 应失败', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'code-review-report.json': { version: '1.0.0' },
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const devReport = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-002');
      expect(devReport!.passed).toBe(false);
      expect(devReport!.severity).toBe('ERROR');
    });

    it('缺少 code-review-report.json 时 R-EVAL-PRE-003 应失败', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': { version: '1.0.0' },
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const crReport = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-003');
      expect(crReport!.passed).toBe(false);
      expect(crReport!.severity).toBe('ERROR');
    });
  });

  describe('R-EVAL-PRE-005: 所有检查点完成检查', () => {
    it('所有检查点完成时应通过', async () => {
      const task = createMockTask({
        checkpoints: [
          { id: 'CP-001', description: '测试1', status: 'completed', createdAt: '', updatedAt: '' },
          { id: 'CP-002', description: '测试2', status: 'completed', createdAt: '', updatedAt: '' },
        ],
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const cpRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-005');
      expect(cpRule!.passed).toBe(true);
    });

    it('有 pending 检查点时应失败', async () => {
      const task = createMockTask({
        checkpoints: [
          { id: 'CP-001', description: '测试1', status: 'completed', createdAt: '', updatedAt: '' },
          { id: 'CP-002', description: '测试2', status: 'pending', createdAt: '', updatedAt: '' },
        ],
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const cpRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-005');
      expect(cpRule!.passed).toBe(false);
      expect(cpRule!.severity).toBe('ERROR');
      expect(cpRule!.message).toContain('CP-002');
    });

    it('skipped 状态的检查点不影响通过', async () => {
      const task = createMockTask({
        checkpoints: [
          { id: 'CP-001', description: '测试1', status: 'completed', createdAt: '', updatedAt: '' },
          { id: 'CP-002', description: '测试2', status: 'skipped', createdAt: '', updatedAt: '' },
        ],
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const cpRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-005');
      expect(cpRule!.passed).toBe(true);
    });
  });

  describe('R-EVAL-PRE-006: 阶段历史完整性检查', () => {
    it('包含所有必要阶段时应通过', async () => {
      const task = createMockTask({
        phaseHistory: [
          { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
          { phase: 'code_review', role: 'code_reviewer', verdict: 'PASS', timestamp: '' },
          { phase: 'qa', role: 'qa_tester', verdict: 'PASS', timestamp: '' },
        ],
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const phaseRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-006');
      expect(phaseRule!.passed).toBe(true);
      expect(phaseRule!.severity).toBe('WARNING');
    });

    it('缺少阶段时应返回警告', async () => {
      const task = createMockTask({
        phaseHistory: [
          { phase: 'development', role: 'executor', verdict: 'PASS', timestamp: '' },
        ],
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      const phaseRule = result.ruleResults.find(r => r.ruleId === 'R-EVAL-PRE-006');
      expect(phaseRule!.passed).toBe(false);
      expect(phaseRule!.severity).toBe('WARNING');
      expect(phaseRule!.message).toContain('code_review');
      expect(phaseRule!.message).toContain('qa');
    });
  });

  describe('门禁决策', () => {
    it('所有规则通过时应返回 PRE_EVAL_PASS', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      expect(result.decision).toBe('PRE_EVAL_PASS');
      expect(result.allowed).toBe(true);
      expect(result.blockingFailures).toBe(0);
    });

    it('ERROR 级别失败时应返回 PRE_EVAL_FAIL', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      // 不创建任何报告

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      expect(result.decision).toBe('PRE_EVAL_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });

    it('仅有 WARNING 级别失败时应返回 PRE_EVAL_WARN 并允许', async () => {
      const task = createMockTask({
        phaseHistory: [], // 缺少阶段历史 -> WARNING
      });
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run(task.id);

      expect(result.decision).toBe('PRE_EVAL_WARN');
      expect(result.allowed).toBe(true);
      expect(result.warningCount).toBeGreaterThan(0);
    });
  });

  describe('门禁禁用', () => {
    it('禁用时应直接通过', async () => {
      const runner = new PreEvalGateRunner(testDir, { enabled: false });
      const result = await runner.run('TASK-any');

      expect(result.decision).toBe('PRE_EVAL_PASS');
      expect(result.allowed).toBe(true);
      expect(result.ruleResults).toHaveLength(0);
    });
  });

  describe('任务不存在', () => {
    it('任务不存在时应返回 PRE_EVAL_FAIL', async () => {
      const runner = new PreEvalGateRunner(testDir);
      const result = await runner.run('TASK-nonexistent');

      expect(result.decision).toBe('PRE_EVAL_FAIL');
      expect(result.allowed).toBe(false);
      expect(result.blockingFailures).toBe(1);
    });
  });

  describe('报告生成', () => {
    it('应生成门禁报告文件', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const reportPath = path.join(testDir, '.projmnt4claude', 'reports', 'pre-eval-gate-report.json');
      const runner = new PreEvalGateRunner(testDir, { reportPath: '.projmnt4claude/reports/pre-eval-gate-report.json' });
      await runner.run(task.id);

      expect(fs.existsSync(reportPath)).toBe(true);

      const reportContent = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      expect(reportContent.taskId).toBe(task.id);
      expect(reportContent.result).toBeDefined();
      expect(reportContent.recommendations).toBeDefined();
      expect(reportContent.metadata.version).toBe('1.0.0');
    });
  });

  describe('格式化输出', () => {
    it('应格式化结果为终端输出', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const runner = new PreEvalGateRunner(testDir, { generateReport: false });
      const result = await runner.run(task.id);
      const formatted = runner.formatResult(result);

      expect(formatted).toContain('评估阶段前门禁检查');
      expect(formatted).toContain('PRE_EVAL_PASS');
      expect(formatted).toContain('R-EVAL-PRE-001');
    });
  });

  describe('便捷函数', () => {
    it('quickPreEvalGateCheck 应直接返回结果', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      setupOutputsDir(testDir, task.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport(),
      });

      const result = await quickPreEvalGateCheck(task.id, testDir, { generateReport: false });
      expect(result.taskId).toBe(task.id);
      expect(result.decision).toBeDefined();
    });

    it('batchPreEvalGateCheck 应批量检查', async () => {
      const task1 = createMockTask({ id: 'TASK-batch-001' });
      const task2 = createMockTask({ id: 'TASK-batch-002' });
      setupTaskDir(testDir, task1.id, task1);
      setupTaskDir(testDir, task2.id, task2);
      setupOutputsDir(testDir, task1.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport({ taskId: 'TASK-batch-001' }),
      });
      setupOutputsDir(testDir, task2.id, {
        'dev-report.json': {},
        'code-review-report.json': {},
        'qa-report.json': createMockQAReport({ taskId: 'TASK-batch-002' }),
      });

      const results = await batchPreEvalGateCheck(
        ['TASK-batch-001', 'TASK-batch-002'],
        testDir,
        { generateReport: false }
      );

      expect(results).toHaveLength(2);
      expect(results[0]!.taskId).toBe('TASK-batch-001');
      expect(results[1]!.taskId).toBe('TASK-batch-002');
    });
  });

  describe('stopOnFailure', () => {
    it('启用 stopOnFailure 时应在首个阻塞失败后停止', async () => {
      const task = createMockTask();
      setupTaskDir(env.tasksDir, task.id, task);
      // 不创建任何报告，所有 ERROR 规则都会失败

      const runner = new PreEvalGateRunner(testDir, { stopOnFailure: true });
      const result = await runner.run(task.id);

      // 应该在首个 ERROR 失败后停止，规则结果少于全部6条
      expect(result.ruleResults.length).toBeLessThan(6);
      expect(result.blockingFailures).toBeGreaterThan(0);
    });
  });
});
