/**
 * checkpoint-sync.ts 单元测试
 *
 * 测试 checkpoint.md ↔ meta.json 同步机制
 */

import { checkpointMdToMeta, metaToCheckpointMdIndex } from '../utils/init-requirement/checkpoint-sync.js';
import type { CheckpointMetadata } from '../types/task.js';

describe('checkpointMdToMeta', () => {
  it('应从 markdown 生成 CheckpointMetadata 数组', () => {
    const markdown = `
## [ai-review] 代码审查
- commands: \`npx eslint src/\`
- expected: 无错误

## [ai-qa] 测试通过
- commands: \`npm test\`
`;

    const checkpoints = checkpointMdToMeta(markdown);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.category).toBe('code_review');
    expect(checkpoints[0]?.description).toBe('代码审查');
    expect(checkpoints[1]?.category).toBe('qa_verification');
  });

  it('应返回空数组对无效输入', () => {
    const checkpoints = checkpointMdToMeta('invalid content');
    expect(checkpoints).toEqual([]);
  });
});

describe('metaToCheckpointMdIndex', () => {
  it('应从 meta.json 生成索引内容', () => {
    const checkpoints: CheckpointMetadata[] = [
      {
        id: 'CP-test-1',
        description: '检查点1',
        status: 'pending',
        category: 'code_review',
        verification: { method: 'automated' },
        requiresHuman: false,
        requiredRole: 'code_reviewer',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    const index = metaToCheckpointMdIndex(checkpoints);

    expect(index).toContain('# 检查点列表');
    expect(index).toContain('[ai review] 检查点1');
  });

  it('应按前缀分组', () => {
    const checkpoints: CheckpointMetadata[] = [
      {
        id: 'CP-1',
        description: 'A',
        status: 'pending',
        category: 'code_review',
        verification: { method: 'automated' },
        requiresHuman: false,
        requiredRole: 'code_reviewer',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'CP-2',
        description: 'B',
        status: 'pending',
        category: 'qa_verification',
        verification: { method: 'automated' },
        requiresHuman: true,
        requiredRole: 'qa_tester',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    const index = metaToCheckpointMdIndex(checkpoints);

    expect(index).toContain('[ai review] A');
    expect(index).toContain('[human qa] B');
  });
});