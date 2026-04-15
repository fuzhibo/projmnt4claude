/**
 * 测试 analyze --fix 检查点前缀修复功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { TaskMeta, Checkpoint } from '../types/task';
import { fixSingleIssue } from '../commands/analyze-fix-pipeline';
import type { Issue } from '../commands/analyze';

describe('analyze --fix checkpoint prefix', () => {
  let testDir: string;
  let taskDir: string;
  let taskId: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = path.join(tmpdir(), `test-checkpoint-prefix-${randomUUID()}`);
    taskId = 'TASK-feature-P1-test-prefix-20260101';
    const tasksDir = path.join(testDir, '.projmnt4claude', 'tasks');
    taskDir = path.join(tasksDir, taskId);

    fs.mkdirSync(taskDir, { recursive: true });

    // 创建测试任务 meta.json（包含缺少前缀的检查点）
    const taskMeta: TaskMeta = {
      id: taskId,
      title: '测试检查点前缀修复',
      description: '测试 analyze --fix 自动添加检查点前缀',
      type: 'feature',
      priority: 'P1',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'test',
      checkpoints: [
        {
          id: 'CP-1',
          description: '实现核心功能', // 缺少前缀
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'CP-2',
          description: '编写单元测试', // 缺少前缀
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'CP-3',
          description: '[ai review] 代码审查', // 已有前缀
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      dependencies: [],
      history: [],
      subtaskIds: [],
      discussionTopics: [],
      fileWarnings: [],
      allowedTools: [],
    };

    fs.writeFileSync(
      path.join(taskDir, 'meta.json'),
      JSON.stringify(taskMeta, null, 2)
    );
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should fix missing checkpoint prefixes via analyze --fix', async () => {
    // 构造 missing_checkpoint_prefix issue
    const issue: Issue = {
      taskId,
      type: 'missing_checkpoint_prefix',
      severity: 'error',
      message: '2 条检查点描述缺少验证类别前缀',
      suggestion: '运行 analyze --fix 自动为检查点添加前缀',
    };

    // 执行修复
    const result = await fixSingleIssue(issue, testDir, true);

    // 验证修复成功
    expect(result).toBe('fixed');

    // 读取修复后的 meta.json
    const metaPath = path.join(taskDir, 'meta.json');
    const fixedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;

    // 验证检查点前缀已添加
    expect(fixedMeta.checkpoints).toHaveLength(3);

    // CP-1 应该添加了 [ai review] 前缀（根据内容推断）
    expect(fixedMeta.checkpoints[0].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] /);

    // CP-2 应该添加了前缀
    expect(fixedMeta.checkpoints[1].description).toMatch(/^\[(ai review|ai qa|human qa|script)\] /);

    // CP-3 应该保持不变（已有前缀）
    expect(fixedMeta.checkpoints[2].description).toBe('[ai review] 代码审查');

    // 验证 updatedAt 已更新
    expect(fixedMeta.updatedAt).not.toBe(fixedMeta.createdAt);
  });

  it('should skip if all checkpoints already have prefixes', async () => {
    // 先修复一次
    const issue: Issue = {
      taskId,
      type: 'missing_checkpoint_prefix',
      severity: 'error',
      message: '检查点描述缺少验证类别前缀',
      suggestion: '运行 analyze --fix 自动为检查点添加前缀',
    };

    await fixSingleIssue(issue, testDir, true);

    // 再次修复应该跳过
    const secondResult = await fixSingleIssue(issue, testDir, true);
    expect(secondResult).toBe('skipped');
  });
});
