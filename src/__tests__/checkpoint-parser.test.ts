/**
 * checkpoint-parser.ts 单元测试
 *
 * 测试 checkpoint.md 扩展格式解析
 */

import { parseCheckpointMarkdown, generateCheckpointId } from '../utils/init-requirement/checkpoint-parser.js';

describe('parseCheckpointMarkdown', () => {
  it('应正确解析单个检查点块', () => {
    const markdown = `
## [ai review] 文档结构完整性
- commands: \`npx eslint docs/architecture.md\`
- steps: 检查文档结构完整性
- expected: 无 lint 错误，文档结构完整
`;

    const blocks = parseCheckpointMarkdown(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      prefix: 'ai-review',
      description: '文档结构完整性',
      commands: ['npx eslint docs/architecture.md'],
      steps: ['检查文档结构完整性'],
      expected: '无 lint 错误，文档结构完整',
    });
  });

  it('应正确解析多个检查点块', () => {
    const markdown = `
## [ai qa] 单元测试覆盖率达标
- commands: \`npm test -- --coverage\`
- expected: coverage >= 90%

## [human qa] E2E 测试通过
- steps: 手动执行 E2E 测试流程, 验收 UI 交互
- expected: 无错误
`;

    const blocks = parseCheckpointMarkdown(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.prefix).toBe('ai-qa');
    expect(blocks[0]?.commands).toHaveLength(1);
    expect(blocks[1]?.prefix).toBe('human-qa');
    expect(blocks[1]?.steps).toHaveLength(2);
  });

  it('应处理空 commands/steps', () => {
    const markdown = `
## [script] 构建成功
- commands: 无
- steps: 无
- expected: exitCode === 0
`;

    const blocks = parseCheckpointMarkdown(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.commands).toEqual([]);
    expect(blocks[0]?.steps).toEqual([]);
  });

  it('应忽略无效前缀', () => {
    const markdown = `
## [invalid prefix] 无效检查点
- expected: 应被忽略

## [ai-review] 有效检查点
- expected: 应被保留
`;

    const blocks = parseCheckpointMarkdown(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.description).toBe('有效检查点');
  });

  it('应解析逗号分隔的 commands', () => {
    const markdown = `
## [ai-qa] 多命令检查
- commands: npm run build, npm test, npm run lint
`;

    const blocks = parseCheckpointMarkdown(markdown);

    expect(blocks[0]?.commands).toEqual(['npm run build', 'npm test', 'npm run lint']);
  });

  it('应返回空数组对空输入', () => {
    const blocks = parseCheckpointMarkdown('');
    expect(blocks).toEqual([]);
  });
});

describe('generateCheckpointId', () => {
  it('应生成格式正确的 ID', () => {
    const id = generateCheckpointId();

    expect(id).toMatch(/^CP-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('应生成唯一 ID', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCheckpointId());
    }

    expect(ids.size).toBe(100);
  });
});