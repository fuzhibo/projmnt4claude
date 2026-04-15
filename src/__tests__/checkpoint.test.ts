/**
 * checkpoint.ts 单元测试
 *
 * 测试重点:
 * - filterLowQualityCheckpoints: 低质量检查点过滤
 * - generateCheckpointId: 检查点 ID 生成
 * - inferVerificationFromDescription: 验证方法推断
 * - inferCheckpointCategory: 类别推断
 * - generateFallbackVerification: 回退验证生成
 * - parseCheckpointsWithIds: 检查点解析（需 mock）
 * - syncCheckpointsToMeta: 检查点同步（需 mock）
 * - updateCheckpointStatus: 状态更新（需 mock）
 * - getCheckpointDetail / listCheckpoints / findCheckpointIdByDescription
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  filterLowQualityCheckpoints,
  generateCheckpointId,
  inferVerificationFromDescription,
  inferCheckpointCategory,
  generateFallbackVerification,
  parseCheckpointsWithIds,
  syncCheckpointsToMeta,
  updateCheckpointStatus,
  getCheckpointDetail,
  listCheckpoints,
  findCheckpointIdByDescription,
  parseTextCheckpoints,
  convertParsedCheckpointsToMetadata,
} from '../utils/checkpoint.js';
import * as pathModule from '../utils/path.js';
import * as taskModule from '../utils/task.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

// ============== filterLowQualityCheckpoints ==============

describe('filterLowQualityCheckpoints', () => {
  it('keeps normal checkpoints unchanged', () => {
    const input = [
      '验证用户登录功能正常',
      '确认数据库迁移脚本执行成功',
      '检查 API 响应格式符合规范',
    ];
    const result = filterLowQualityCheckpoints(input);
    expect(result.kept).toEqual(input);
    expect(result.removed).toHaveLength(0);
    expect(result.reasons.size).toBe(0);
  });

  it('filters single-letter class patterns (Big-O artifacts)', () => {
    const result = filterLowQualityCheckpoints([
      'O 类算法实现',
      '验证登录功能', // normal, should be kept
      'A 类复杂度分析',
    ]);
    expect(result.kept).toEqual(['验证登录功能']);
    expect(result.removed).toEqual(['O 类算法实现', 'A 类复杂度分析']);
    expect(result.reasons.get('O 类算法实现')).toContain('Big-O');
    expect(result.reasons.get('A 类复杂度分析')).toContain('Big-O');
  });

  it('filters algorithm name class patterns', () => {
    const result = filterLowQualityCheckpoints([
      'DFS类搜索算法',
      'BFS类遍历实现',
      'AST类语法分析',
      '深度优先类搜索',
      '动态规划类问题',
    ]);
    expect(result.removed).toHaveLength(5);
    for (const r of result.removed) {
      expect(result.reasons.get(r)).toContain('算法术语伪影');
    }
  });

  it('filters O(n) complexity notation patterns', () => {
    const result = filterLowQualityCheckpoints([
      'O(n^2) 类复杂度',
      'O(n) 类线性复杂度',
      'O(log n) 类对数复杂度',
    ]);
    expect(result.removed).toHaveLength(3);
  });

  it('filters CP-N: prefixed duplicate checkpoints', () => {
    const result = filterLowQualityCheckpoints([
      '验证用户登录',
      'CP-1: 验证用户登录', // duplicate of above
    ]);
    expect(result.kept).toEqual(['验证用户登录']);
    expect(result.removed).toEqual(['CP-1: 验证用户登录']);
    expect(result.reasons.get('CP-1: 验证用户登录')).toContain('CP-N');
  });

  it('keeps CP-N: prefixed non-duplicate checkpoints', () => {
    const result = filterLowQualityCheckpoints([
      '验证用户登录',
      'CP-1: 验证注册功能', // not a duplicate
    ]);
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('handles empty input array', () => {
    const result = filterLowQualityCheckpoints([]);
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.reasons.size).toBe(0);
  });

  it('handles mixed quality checkpoints', () => {
    const result = filterLowQualityCheckpoints([
      '实现用户注册功能',
      'O 类',
      '确认 API 端点返回正确状态码',
      'DP类动态规划',
      'CP-2: 实现用户注册功能',
    ]);
    expect(result.kept).toEqual(['实现用户注册功能', '确认 API 端点返回正确状态码']);
    expect(result.removed).toHaveLength(3);
  });

  it('handles whitespace-padded checkpoint text', () => {
    const result = filterLowQualityCheckpoints([
      '  O 类算法  ',
      '  正常检查点  ',
    ]);
    expect(result.removed).toHaveLength(1);
    expect(result.kept).toHaveLength(1);
  });
});

// ============== generateCheckpointId ==============

describe('generateCheckpointId', () => {
  it('generates descriptive ID from English description', () => {
    const id = generateCheckpointId('TASK-1', 0, 'verify user login');
    expect(id).toBe('CP-verify-user-login');
  });

  it('generates descriptive ID from Chinese description', () => {
    const id = generateCheckpointId('TASK-1', 0, '验证用户登录功能');
    expect(id).toMatch(/^CP-/);
    expect(id).toContain('验证');
  });

  it('falls back to numeric ID when description is too short', () => {
    const id = generateCheckpointId('TASK-1', 0, 'ab');
    expect(id).toBe('CP-001');
  });

  it('falls back to numeric ID when description is empty', () => {
    const id = generateCheckpointId('TASK-1', 0, '');
    expect(id).toBe('CP-001');
  });

  it('pads numeric IDs correctly', () => {
    const id9 = generateCheckpointId('TASK-1', 8, '');
    const id10 = generateCheckpointId('TASK-1', 9, '');
    const id100 = generateCheckpointId('TASK-1', 99, '');
    expect(id9).toBe('CP-009');
    expect(id10).toBe('CP-010');
    expect(id100).toBe('CP-100');
  });

  it('truncates long descriptions to 30 chars in slug', () => {
    const id = generateCheckpointId('TASK-1', 0, 'a very long description that exceeds the thirty character limit');
    expect(id.startsWith('CP-')).toBe(true);
    const slug = id.slice(3);
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it('strips leading/trailing hyphens from slug', () => {
    const id = generateCheckpointId('TASK-1', 0, '---test---');
    expect(id).not.toMatch(/^-|-$/);
  });

  it('handles mixed alphanumeric descriptions', () => {
    const id = generateCheckpointId('TASK-1', 0, 'Test API v2 endpoint');
    expect(id).toMatch(/^CP-/);
    expect(id.length).toBeGreaterThan(6);
  });
});

// ============== inferVerificationFromDescription ==============

describe('inferVerificationFromDescription', () => {
  it('infers functional_test from functional test keywords', () => {
    const result = inferVerificationFromDescription('功能测试验证登录功能');
    expect(result).toBeDefined();
    expect(result!.method).toBe('functional_test');
    expect(result!.commands).toBeDefined();
    expect(result!.commands!.length).toBeGreaterThan(0);
  });

  it('infers unit_test from unit test keywords', () => {
    const result = inferVerificationFromDescription('单元测试覆盖核心逻辑');
    expect(result).toBeDefined();
    expect(result!.method).toBe('unit_test');
  });

  it('infers integration_test from integration test keywords', () => {
    const result = inferVerificationFromDescription('集成测试接口连通性');
    expect(result).toBeDefined();
    expect(result!.method).toBe('integration_test');
  });

  it('infers e2e_test from e2e keywords', () => {
    const result = inferVerificationFromDescription('端到端测试完整流程');
    expect(result).toBeDefined();
    expect(result!.method).toBe('e2e_test');
  });

  it('infers lint from lint keywords', () => {
    const result = inferVerificationFromDescription('lint 检查代码风格');
    expect(result).toBeDefined();
    expect(result!.method).toBe('lint');
    expect(result!.commands).toEqual(['npm run lint']);
  });

  it('infers code_review from code review keywords', () => {
    const result = inferVerificationFromDescription('代码审查确认实现质量');
    expect(result).toBeDefined();
    expect(result!.method).toBe('code_review');
    // code_review has no commands, so it becomes undefined
    expect(result!.commands).toBeUndefined();
  });

  it('infers automated from automated keywords', () => {
    const result = inferVerificationFromDescription('自动化验证部署流程');
    expect(result).toBeDefined();
    expect(result!.method).toBe('automated');
  });

  it('returns undefined for non-matching description', () => {
    const result = inferVerificationFromDescription('确认文件存在');
    expect(result).toBeUndefined();
  });

  it('matches English keywords case-insensitively', () => {
    const result = inferVerificationFromDescription('Unit Test coverage');
    expect(result).toBeDefined();
    expect(result!.method).toBe('unit_test');
  });

  it('extracts test patterns from src file paths in description', () => {
    const result = inferVerificationFromDescription('功能测试 src/utils/checkpoint.ts');
    expect(result).toBeDefined();
    expect(result!.commands).toBeDefined();
    // Should contain 'checkpoint' in the test pattern
    expect(result!.commands!.some(c => c.includes('checkpoint'))).toBe(true);
  });

  it('uses task title for test pattern extraction', () => {
    const task = { title: 'Implement auth-service feature' } as TaskMeta;
    const result = inferVerificationFromDescription('功能测试验证功能正常', task);
    expect(result).toBeDefined();
    // extractTestPatterns takes the first English keyword from title: "Implement"
    expect(result!.commands!.some(c => c.includes('mplement'))).toBe(true);
  });
});

// ============== inferCheckpointCategory ==============

describe('inferCheckpointCategory', () => {
  it('infers code_review for code review keywords', () => {
    expect(inferCheckpointCategory('代码审查确认质量')).toBe('code_review');
    expect(inferCheckpointCategory('code review 检查')).toBe('code_review');
    expect(inferCheckpointCategory('lint 静态检查')).toBe('code_review');
  });

  it('infers qa_verification for test keywords', () => {
    expect(inferCheckpointCategory('功能测试通过')).toBe('qa_verification');
    expect(inferCheckpointCategory('验证登录功能')).toBe('qa_verification');
    expect(inferCheckpointCategory('unit test 通过')).toBe('qa_verification');
  });

  it('returns undefined for non-matching description', () => {
    expect(inferCheckpointCategory('确认文件存在')).toBeUndefined();
    expect(inferCheckpointCategory('deploy to production')).toBeUndefined();
  });
});

// ============== generateFallbackVerification ==============

describe('generateFallbackVerification', () => {
  it('generates default verification with bun build + test', () => {
    const result = generateFallbackVerification('确认功能实现');
    expect(result.method).toBe('automated');
    expect(result.commands).toContain('bun run build');
    expect(result.commands).toContain('bun test');
    expect(result.expected).toContain('bun run build');
    expect(result.expected).toContain('bun test');
  });

  it('extracts file verification steps from src/ paths', () => {
    const result = generateFallbackVerification('确认 src/utils/checkpoint.ts 存在');
    expect(result.steps).toBeDefined();
    expect(result.steps!.length).toBeGreaterThan(0);
    expect(result.steps!.some(s => s.includes('src/utils/checkpoint.ts'))).toBe(true);
  });

  it('extracts function verification steps', () => {
    const result = generateFallbackVerification('确认函数 generateCheckpointId 已导出');
    expect(result.steps).toBeDefined();
    expect(result.steps!.some(s => s.includes('generateCheckpointId'))).toBe(true);
  });

  it('extracts class verification steps', () => {
    const result = generateFallbackVerification('确认类 TaskManager 已导出');
    expect(result.steps).toBeDefined();
    expect(result.steps!.some(s => s.includes('TaskManager'))).toBe(true);
  });

  it('deduplicates file paths', () => {
    const result = generateFallbackVerification(
      '确认 src/a.ts 和 src/a.ts 和 src/b.ts 存在'
    );
    const fileSteps = result.steps?.filter(s => s.includes('确认文件')) || [];
    const uniquePaths = new Set(fileSteps);
    expect(uniquePaths.size).toBe(fileSteps.length);
  });

  it('limits file extraction to 5 files', () => {
    const paths = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`).join(' ');
    const result = generateFallbackVerification(`确认 ${paths} 存在`);
    const fileSteps = result.steps?.filter(s => s.includes('确认文件')) || [];
    expect(fileSteps.length).toBeLessThanOrEqual(5);
  });
});

// ============== parseCheckpointsWithIds (mocked) ==============

describe('parseCheckpointsWithIds', () => {
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta').mockReturnValue(null);
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    existsSyncSpy?.mockRestore();
    readFileSyncSpy?.mockRestore();
  });

  it('returns empty array when checkpoint.md does not exist', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = parseCheckpointsWithIds('TASK-1');
    expect(result).toEqual([]);
  });

  it('parses unchecked checkpoints from markdown', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '# Task Checkpoints\n\n- [ ] 验证登录功能\n- [ ] 确认数据持久化\n'
    );
    readTaskMetaSpy.mockReturnValue({ id: 'TASK-1', checkpoints: [] } as TaskMeta);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('验证登录功能');
    expect(result[0].checked).toBe(false);
    expect(result[1].text).toBe('确认数据持久化');
    expect(result[1].checked).toBe(false);
  });

  it('parses checked checkpoints', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '- [x] 已完成的功能\n- [X] 另一个完成项\n- [ ] 未完成项\n'
    );
    readTaskMetaSpy.mockReturnValue({ id: 'TASK-1', checkpoints: [] } as TaskMeta);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result).toHaveLength(3);
    expect(result[0].checked).toBe(true);
    expect(result[1].checked).toBe(true);
    expect(result[2].checked).toBe(false);
  });

  it('generates IDs when no existing metadata', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '- [ ] 验证功能\n'
    );
    readTaskMetaSpy.mockReturnValue(null);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toMatch(/^CP-/);
  });

  it('matches existing checkpoint IDs by description', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '- [ ] 验证登录功能\n'
    );
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1',
      checkpoints: [{ id: 'CP-existing-id', description: '验证登录功能' }],
    } as TaskMeta);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result[0].id).toBe('CP-existing-id');
  });

  it('records correct line indices', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '# Header\n\n- [ ] First\n- [ ] Second\n'
    );
    readTaskMetaSpy.mockReturnValue(null);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result[0].lineIndex).toBe(2);
    expect(result[1].lineIndex).toBe(3);
  });

  it('skips non-checkpoint lines', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue(
      '# Header\nSome text\n- [ ] Real checkpoint\nMore text\n'
    );
    readTaskMetaSpy.mockReturnValue(null);

    const result = parseCheckpointsWithIds('TASK-1');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Real checkpoint');
  });
});

// ============== syncCheckpointsToMeta (mocked) ==============

describe('syncCheckpointsToMeta', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskModule, 'writeTaskMeta').mockImplementation(() => {});
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    readFileSyncSpy = spyOn(fs, 'readFileSync');
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
  });

  it('throws if task does not exist', () => {
    readTaskMetaSpy.mockReturnValue(null);
    expect(() => syncCheckpointsToMeta('TASK-NONEXIST', [])).toThrow('不存在');
  });

  it('syncs checkpoint array directly to meta', () => {
    const task = { id: 'TASK-1', checkpoints: [] } as TaskMeta;
    readTaskMetaSpy.mockReturnValue(task);

    const newCheckpoints: CheckpointMetadata[] = [
      {
        id: 'CP-001',
        description: '验证功能',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    syncCheckpointsToMeta('TASK-1', newCheckpoints);

    expect(writeTaskMetaSpy).toHaveBeenCalled();
    // Also writes checkpoint.md
    expect(writeFileSyncSpy).toHaveBeenCalled();
  });

  it('clears checkpoints when checkpoint.md has no entries', () => {
    const cp: CheckpointMetadata = {
      id: 'CP-001',
      description: '验证功能',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const task = { id: 'TASK-1', checkpoints: [cp] } as TaskMeta;

    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('# No checkpoints here\n');
    readTaskMetaSpy.mockReturnValue(task);

    syncCheckpointsToMeta('TASK-1');

    const writtenTask = writeTaskMetaSpy.mock.calls[0]?.[0] as TaskMeta;
    if (writtenTask) {
      expect(writtenTask.checkpoints).toHaveLength(0);
    }
  });

  it('filters low quality checkpoints during sync from file', () => {
    const task = { id: 'TASK-1', checkpoints: [] } as TaskMeta;
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('- [ ] 验证功能\n- [ ] O 类复杂度\n');
    readTaskMetaSpy.mockReturnValue(task);

    syncCheckpointsToMeta('TASK-1');

    // Should have been called with filtered checkpoints (only 1, not the O类)
    const writtenTask = writeTaskMetaSpy.mock.calls[0]?.[0] as TaskMeta;
    if (writtenTask) {
      expect(writtenTask.checkpoints).toHaveLength(1);
      expect(writtenTask.checkpoints[0].description).toBe('验证功能');
    }
  });
});

// ============== updateCheckpointStatus (mocked) ==============

describe('updateCheckpointStatus', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskModule, 'writeTaskMeta').mockImplementation(() => {});
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    readFileSyncSpy = spyOn(fs, 'readFileSync');
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
  });

  it('throws if task does not exist', () => {
    readTaskMetaSpy.mockReturnValue(null);
    expect(() =>
      updateCheckpointStatus('TASK-NONEXIST', 'CP-001', 'completed')
    ).toThrow('不存在');
  });

  it('throws if checkpoint does not exist', () => {
    const task = {
      id: 'TASK-1',
      title: 'Test',
      type: 'feature' as const,
      priority: 'P2' as const,
      checkpoints: [{ id: 'CP-001', description: '验证功能', status: 'pending' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    } as TaskMeta;
    // Provide checkpoint.md so syncCheckpointsToMeta preserves the checkpoint
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('- [ ] 验证功能\n');
    readTaskMetaSpy.mockReturnValue(task);

    expect(() =>
      updateCheckpointStatus('TASK-1', 'CP-NONEXIST', 'completed')
    ).toThrow('不存在');
  });

  it('updates checkpoint status to completed', () => {
    const cp: CheckpointMetadata = {
      id: 'CP-001',
      description: '验证功能',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const task: TaskMeta = {
      id: 'TASK-1',
      title: 'Test',
      type: 'feature',
      priority: 'P2',
      checkpoints: [cp],
    };

    // Provide checkpoint.md so syncCheckpointsToMeta preserves the checkpoint
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('- [ ] 验证功能\n');
    // Return a fresh copy each time to avoid mutation issues across calls
    readTaskMetaSpy.mockImplementation(() => ({
      ...task,
      checkpoints: task.checkpoints?.map(c => ({ ...c })),
    }));

    updateCheckpointStatus('TASK-1', 'CP-001', 'completed');

    // Find the final writeTaskMeta call
    const calls = writeTaskMetaSpy.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as TaskMeta;
    expect(lastCall.checkpoints[0].status).toBe('completed');
  });

  it('updates checkpoint with note and result', () => {
    const cp: CheckpointMetadata = {
      id: 'CP-001',
      description: '验证功能',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const task: TaskMeta = {
      id: 'TASK-1',
      title: 'Test',
      type: 'feature',
      priority: 'P2',
      checkpoints: [cp],
    };

    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('- [ ] 验证功能\n');
    readTaskMetaSpy.mockImplementation(() => ({
      ...task,
      checkpoints: task.checkpoints?.map(c => ({ ...c })),
    }));

    updateCheckpointStatus('TASK-1', 'CP-001', 'failed', {
      note: '测试失败',
      result: 'AssertionError',
      verifiedBy: 'tester',
    });

    const calls = writeTaskMetaSpy.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as TaskMeta;
    expect(lastCall.checkpoints[0].status).toBe('failed');
    expect(lastCall.checkpoints[0].note).toBe('测试失败');
    expect(lastCall.checkpoints[0].verification?.result).toBe('AssertionError');
    expect(lastCall.checkpoints[0].verification?.verifiedBy).toBe('tester');
  });
});

// ============== getCheckpointDetail / listCheckpoints / findCheckpointIdByDescription ==============

describe('getCheckpointDetail', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskModule, 'writeTaskMeta').mockImplementation(() => {});
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    existsSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
  });

  it('throws if task does not exist (syncCheckpointsToMeta throws)', () => {
    readTaskMetaSpy.mockReturnValue(null);
    expect(() => getCheckpointDetail('TASK-NONEXIST', 'CP-001')).toThrow('不存在');
  });

  it('returns checkpoint by id', () => {
    const cp: CheckpointMetadata = {
      id: 'CP-001',
      description: '验证功能',
      status: 'pending',
    };
    // Provide checkpoint.md so syncCheckpointsToMeta preserves checkpoints
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 验证功能\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({ id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2', checkpoints: [cp] } as TaskMeta);

    const result = getCheckpointDetail('TASK-1', 'CP-001');
    readFileSyncSpy.mockRestore();
    expect(result).not.toBeNull();
    expect(result!.id).toBe('CP-001');
    expect(result!.description).toBe('验证功能');
  });

  it('returns null if checkpoint id not found', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 验证功能\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2',
      checkpoints: [{ id: 'CP-001', description: '验证功能', status: 'pending' }],
    } as TaskMeta);

    expect(getCheckpointDetail('TASK-1', 'CP-NONEXIST')).toBeNull();
    readFileSyncSpy.mockRestore();
  });
});

describe('listCheckpoints', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskModule, 'writeTaskMeta').mockImplementation(() => {});
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    existsSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
  });

  it('returns empty array if task has no checkpoints', () => {
    readTaskMetaSpy.mockReturnValue({ id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2', checkpoints: [] } as TaskMeta);
    expect(listCheckpoints('TASK-1')).toEqual([]);
  });

  it('returns all checkpoints for a task', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 功能A\n- [ ] 功能B\n');
    existsSyncSpy.mockReturnValue(true);
    const cps: CheckpointMetadata[] = [
      { id: 'CP-001', description: '功能A', status: 'completed' },
      { id: 'CP-002', description: '功能B', status: 'pending' },
    ];
    readTaskMetaSpy.mockReturnValue({ id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2', checkpoints: cps } as TaskMeta);
    const result = listCheckpoints('TASK-1');
    readFileSyncSpy.mockRestore();
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('CP-001');
    expect(result[1].id).toBe('CP-002');
  });
});

describe('findCheckpointIdByDescription', () => {
  let getTasksDirSpy: ReturnType<typeof spyOn>;
  let readTaskMetaSpy: ReturnType<typeof spyOn>;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let writeFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getTasksDirSpy = spyOn(pathModule, 'getTasksDir').mockReturnValue('/fake/tasks');
    readTaskMetaSpy = spyOn(taskModule, 'readTaskMeta');
    writeTaskMetaSpy = spyOn(taskModule, 'writeTaskMeta').mockImplementation(() => {});
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    getTasksDirSpy.mockRestore();
    readTaskMetaSpy.mockRestore();
    writeTaskMetaSpy.mockRestore();
    existsSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
  });

  it('finds checkpoint by exact description match', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 验证用户登录\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2',
      checkpoints: [
        { id: 'CP-001', description: '验证用户登录', status: 'pending' },
      ],
    } as TaskMeta);

    expect(findCheckpointIdByDescription('TASK-1', '验证用户登录')).toBe('CP-001');
    readFileSyncSpy.mockRestore();
  });

  it('finds checkpoint by partial description match (contains)', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 验证用户登录功能正常\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2',
      checkpoints: [
        { id: 'CP-001', description: '验证用户登录功能正常', status: 'pending' },
      ],
    } as TaskMeta);

    expect(findCheckpointIdByDescription('TASK-1', '用户登录')).toBe('CP-001');
    readFileSyncSpy.mockRestore();
  });

  it('finds checkpoint when description is contained in search', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 登录\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2',
      checkpoints: [
        { id: 'CP-001', description: '登录', status: 'pending' },
      ],
    } as TaskMeta);

    expect(findCheckpointIdByDescription('TASK-1', '验证登录功能')).toBe('CP-001');
    readFileSyncSpy.mockRestore();
  });

  it('returns null if no match found', () => {
    const readFileSyncSpy = spyOn(fs, 'readFileSync').mockReturnValue('- [ ] 验证用户登录\n');
    existsSyncSpy.mockReturnValue(true);
    readTaskMetaSpy.mockReturnValue({
      id: 'TASK-1', title: 'Test', type: 'feature', priority: 'P2',
      checkpoints: [
        { id: 'CP-001', description: '验证用户登录', status: 'pending' },
      ],
    } as TaskMeta);

    expect(findCheckpointIdByDescription('TASK-1', '完全无关的描述')).toBeNull();
    readFileSyncSpy.mockRestore();
  });
});

// ============== parseTextCheckpoints ==============

describe('parseTextCheckpoints', () => {
  it('returns empty array for empty description', () => {
    expect(parseTextCheckpoints('')).toEqual([]);
    expect(parseTextCheckpoints('   ')).toEqual([]);
  });

  it('returns empty array when no checkpoint section', () => {
    const desc = '# Task Description\n\nSome content without checkpoints.';
    expect(parseTextCheckpoints(desc)).toEqual([]);
  });

  it('parses checkpoints from ## 检查点 section', () => {
    const desc = `## 检查点
- CP-1: 修复第 466 行 codeReviewVerdict 空值访问
- CP-2: 修复第 403 行 devReport 空值访问
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('CP-1');
    expect(result[0].description).toBe('修复第 466 行 codeReviewVerdict 空值访问');
    expect(result[1].id).toBe('CP-2');
    expect(result[1].description).toBe('修复第 403 行 devReport 空值访问');
  });

  it('parses checkpoints from ## Checkpoints section (English)', () => {
    const desc = `## Checkpoints
- Fix login bug
- Add unit tests
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('CP-001');
    expect(result[0].description).toBe('Fix login bug');
  });

  it('parses checkpoints without explicit IDs', () => {
    const desc = `## 检查点
- 验证用户登录功能正常
- 确认数据库迁移脚本执行成功
- 检查 API 响应格式符合规范
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('CP-001');
    expect(result[1].id).toBe('CP-002');
    expect(result[2].id).toBe('CP-003');
  });

  it('handles mixed format with and without IDs', () => {
    const desc = `## 检查点
- CP-fix-login: 修复登录功能
- 添加单元测试
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('CP-fix-login');
    expect(result[1].id).toBe('CP-002');
  });

  it('handles checkboxes in list items', () => {
    const desc = `## 检查点
- [ ] 待完成任务
- [x] 已完成任务
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
    expect(result[0].description).toBe('待完成任务');
    expect(result[1].description).toBe('已完成任务');
  });

  it('stops at next ## section', () => {
    const desc = `## 检查点
- 检查点1
- 检查点2

## 相关文件
- src/file.ts
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
  });

  it('handles numeric list format', () => {
    const desc = `## 验收标准
1. 第一个检查点
2. 第二个检查点
`;
    const result = parseTextCheckpoints(desc);
    expect(result).toHaveLength(2);
    expect(result[0].description).toBe('第一个检查点');
  });
});

// ============== convertParsedCheckpointsToMetadata ==============

describe('convertParsedCheckpointsToMetadata', () => {
  it('converts parsed checkpoints to metadata format', () => {
    const parsed = [
      { id: 'CP-001', description: '验证登录功能', originalText: '- 验证登录功能', lineNumber: 0 },
      { id: 'CP-002', description: '检查数据库连接', originalText: '- 检查数据库连接', lineNumber: 1 },
    ];

    const result = convertParsedCheckpointsToMetadata(parsed);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('CP-001');
    expect(result[0].description).toBe('验证登录功能');
    expect(result[0].status).toBe('pending');
    expect(result[0].verification).toBeDefined();
    expect(result[0].createdAt).toBeDefined();
    expect(result[0].updatedAt).toBeDefined();
  });

  it('infers verification method from description', () => {
    const parsed = [
      { id: 'CP-001', description: '单元测试覆盖核心逻辑', originalText: '- 单元测试覆盖核心逻辑', lineNumber: 0 },
    ];

    const result = convertParsedCheckpointsToMetadata(parsed);

    expect(result[0].verification?.method).toBe('unit_test');
  });

  it('infers code_review category from description', () => {
    const parsed = [
      { id: 'CP-001', description: '代码审查确认质量', originalText: '- 代码审查确认质量', lineNumber: 0 },
    ];

    const result = convertParsedCheckpointsToMetadata(parsed);

    expect(result[0].category).toBe('code_review');
  });

  it('infers requiresHuman from keywords', () => {
    const parsed = [
      { id: 'CP-001', description: '人工验证登录流程', originalText: '- 人工验证登录流程', lineNumber: 0 },
      { id: 'CP-002', description: 'Manual review required', originalText: '- Manual review required', lineNumber: 1 },
    ];

    const result = convertParsedCheckpointsToMetadata(parsed);

    expect(result[0].requiresHuman).toBe(true);
    expect(result[1].requiresHuman).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(convertParsedCheckpointsToMetadata([])).toEqual([]);
  });
});
