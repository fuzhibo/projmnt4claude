/**
 * checkpoint-infer.ts 单元测试
 *
 * 测试检查点推断链
 */

import { inferCheckpointMetadata, inferCheckpointMetadataBatch } from '../utils/init-requirement/checkpoint-infer.js';
import type { CheckpointBlock } from '../utils/init-requirement/checkpoint-parser.js';

describe('inferCheckpointMetadata', () => {
  it('应从 ai-review 块推断 code_review 类别', () => {
    const block: CheckpointBlock = {
      prefix: 'ai-review',
      description: '代码审查通过',
      commands: ['npx eslint src/'],
      steps: [],
      expected: '无错误',
    };

    const metadata = inferCheckpointMetadata(block);

    expect(metadata.category).toBe('code_review');
    expect(metadata.requiresHuman).toBe(false);
    expect(metadata.verification?.method).toBe('code_review');
    expect(metadata.verification?.commands).toEqual(['npx eslint src/']);
    expect(metadata.verification?.expected).toBe('无错误');
    expect(metadata.status).toBe('pending');
    expect(metadata.requiredRole).toBe('code_reviewer');
  });

  it('应从 ai-qa 块推断 qa_verification 类别', () => {
    const block: CheckpointBlock = {
      prefix: 'ai-qa',
      description: '单元测试通过',
      commands: ['npm test'],
      steps: [],
      expected: '全部通过',
    };

    const metadata = inferCheckpointMetadata(block);

    expect(metadata.category).toBe('qa_verification');
    expect(metadata.requiresHuman).toBe(false);
    expect(metadata.requiredRole).toBe('qa_tester');
  });

  it('应从 human-qa 块推断 requiresHuman=true', () => {
    const block: CheckpointBlock = {
      prefix: 'human-qa',
      description: '人工验收',
      commands: [],
      steps: ['手动验证 UI'],
      expected: '',
    };

    const metadata = inferCheckpointMetadata(block);

    expect(metadata.category).toBe('qa_verification');
    expect(metadata.requiresHuman).toBe(true);
    expect(metadata.verification?.steps).toEqual(['手动验证 UI']);
  });

  it('应从 script 块推断 evaluation 类别', () => {
    const block: CheckpointBlock = {
      prefix: 'script',
      description: '构建成功',
      commands: ['npm run build'],
      steps: [],
      expected: 'exitCode === 0',
    };

    const metadata = inferCheckpointMetadata(block);

    expect(metadata.category).toBe('evaluation');
    expect(metadata.requiredRole).toBe('architect');
  });

  it('应生成包含时间戳的元数据', () => {
    const block: CheckpointBlock = {
      prefix: 'ai-qa',
      description: '测试',
      commands: [],
      steps: [],
      expected: '',
    };

    const metadata = inferCheckpointMetadata(block);

    expect(metadata.id).toMatch(/^CP-/);
    expect(metadata.createdAt).toBeDefined();
    expect(metadata.updatedAt).toBeDefined();
    expect(new Date(metadata.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('inferCheckpointMetadataBatch', () => {
  it('应批量推断多个块', () => {
    const blocks: CheckpointBlock[] = [
      { prefix: 'ai-review', description: 'A', commands: [], steps: [], expected: '' },
      { prefix: 'ai-qa', description: 'B', commands: [], steps: [], expected: '' },
    ];

    const results = inferCheckpointMetadataBatch(blocks);

    expect(results).toHaveLength(2);
    expect(results[0]?.category).toBe('code_review');
    expect(results[1]?.category).toBe('qa_verification');
  });
});