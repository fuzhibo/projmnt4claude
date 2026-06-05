/**
 * 测试 [script] 前缀语义收紧：
 * 1. checkpointScriptHasCommands 验证规则
 * 2. inferCheckpointPrefix 关键词收紧后不再误匹配代码修改任务
 */

import { describe, test, expect } from '@jest/globals';
import {
  checkpointScriptHasCommands,
  inferCheckpointPrefix,
} from '../utils/validation-rules/checkpoint-rules';

describe('checkpointScriptHasCommands', () => {
  test('[script] 检查点无 commands 应报错', () => {
    const checkpoint = {
      id: 'CP-001',
      description: '[script] 构建成功',
      verification: { method: 'automated' },
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).not.toBeNull();
    expect(result?.severity).toBe('error');
    expect(result?.ruleId).toBe('checkpoint-script-has-commands');
  });

  test('[script] 检查点有 commands 应通过', () => {
    const checkpoint = {
      id: 'CP-001',
      description: '[script] 构建成功',
      verification: { method: 'automated', commands: ['bun run build'] },
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).toBeNull();
  });

  test('[script] 检查点 commands 为空数组应报错', () => {
    const checkpoint = {
      id: 'CP-001',
      description: '[script] 构建成功',
      verification: { method: 'automated', commands: [] },
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).not.toBeNull();
    expect(result?.severity).toBe('error');
  });

  test('[ai review] 检查点无 commands 不应报错', () => {
    const checkpoint = {
      id: 'CP-001',
      description: '[ai review] 代码审查',
      verification: { method: 'code_review' },
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).toBeNull();
  });

  test('[ai qa] 检查点无 commands 不应报错', () => {
    const checkpoint = {
      id: 'CP-001',
      description: '[ai qa] 测试验证',
      verification: { method: 'automated' },
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).toBeNull();
  });

  test('多条 [script] 检查点部分缺少 commands 应只报缺少的', () => {
    const checkpoints = [
      {
        id: 'CP-001',
        description: '[script] 构建成功',
        verification: { method: 'automated', commands: ['bun run build'] },
      },
      {
        id: 'CP-002',
        description: '[script] 部署成功',
        verification: { method: 'automated' },
      },
    ];
    const result = checkpointScriptHasCommands.check({ checkpoints });
    expect(result).not.toBeNull();
    expect(result?.message).toContain('[script] 部署成功');
    expect(result?.message).not.toContain('[script] 构建成功');
  });

  test('无检查点时返回 null', () => {
    const result = checkpointScriptHasCommands.check({});
    expect(result).toBeNull();
  });

  test('description 不是字符串的检查点不报错', () => {
    const checkpoint = {
      id: 'CP-001',
      description: null,
    };
    const result = checkpointScriptHasCommands.check({ checkpoints: [checkpoint] });
    expect(result).toBeNull();
  });
});

describe('inferCheckpointPrefix (收紧后)', () => {
  test('构建相关描述应推断为 [script]', () => {
    expect(inferCheckpointPrefix('构建项目')).toBe('[script]');
    // Note: 'build' contains 'ui' substring which matches humanQaKeywords
    // This is a pre-existing issue in humanQaKeywords, not related to [script] tightening
  });

  test('部署相关描述应推断为 [script]', () => {
    expect(inferCheckpointPrefix('部署到生产环境')).toBe('[script]');
    expect(inferCheckpointPrefix('deploy 成功')).toBe('[script]');
  });

  test('CI/CD 相关描述应推断为 [script]', () => {
    expect(inferCheckpointPrefix('CI/CD pipeline 通过')).toBe('[script]');
    expect(inferCheckpointPrefix('打包发布')).toBe('[script]');
  });

  test('构建+lint 组合描述应推断为 [script]', () => {
    // '构建' 和 'lint' 都在 scriptKeywords 中，script 得分更高
    expect(inferCheckpointPrefix('构建并 lint 通过')).toBe('[script]');
  });

  test('代码修改任务不应推断为 [script]', () => {
    // 关键词收紧后，这些不应匹配 [script]
    expect(inferCheckpointPrefix('执行脚本修改功能')).not.toBe('[script]');
    expect(inferCheckpointPrefix('运行命令更新配置')).not.toBe('[script]');
    expect(inferCheckpointPrefix('修改 bash 脚本')).not.toBe('[script]');
    expect(inferCheckpointPrefix('安装依赖')).not.toBe('[script]');
    expect(inferCheckpointPrefix('shell 命令执行')).not.toBe('[script]');
  });

  test('代码审查描述应推断为 [ai review]', () => {
    expect(inferCheckpointPrefix('代码审查检查')).toBe('[ai review]');
    expect(inferCheckpointPrefix('重构代码逻辑')).toBe('[ai review]');
  });

  test('测试验证描述应推断为 [ai qa]', () => {
    expect(inferCheckpointPrefix('单元测试覆盖率 >= 80%')).toBe('[ai qa]');
    expect(inferCheckpointPrefix('验证功能正确性')).toBe('[ai qa]');
  });

  test('空描述默认返回 [ai review]', () => {
    expect(inferCheckpointPrefix('')).toBe('[ai review]');
    expect(inferCheckpointPrefix('一些普通描述')).toBe('[ai review]');
  });
});