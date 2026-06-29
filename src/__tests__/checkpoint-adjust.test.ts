/**
 * checkpoint-adjust.ts 单元测试
 *
 * 测试检查点调整接口
 */

import { adjustCheckpointDetails, adjustCheckpointDetailsBatch, resetCheckpointDetails } from '../utils/init-requirement/checkpoint-adjust.js';
import type { TaskMeta } from '../types/task.js';

function createMockTask(): TaskMeta {
  return {
    id: 'TASK-001',
    title: '测试任务',
    type: 'feature',
    priority: 'P1',
    status: 'open',
    schemaVersion: 1,
    dependencies: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    history: [],
    checkpoints: [
      {
        id: 'CP-001',
        description: '检查点1',
        status: 'pending',
        category: 'qa_verification',
        verification: { method: 'automated' },
        requiresHuman: false,
        requiredRole: 'qa_tester',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

describe('adjustCheckpointDetails', () => {
  it('应更新 commands', () => {
    const task = createMockTask();
    const updated = adjustCheckpointDetails(task, 'CP-001', {
      commands: ['npm test'],
    });

    expect(updated.checkpoints?.[0]?.verification?.commands).toEqual(['npm test']);
    expect(updated.updatedAt).not.toBe(task.updatedAt);
  });

  it('应更新 steps', () => {
    const task = createMockTask();
    const updated = adjustCheckpointDetails(task, 'CP-001', {
      steps: ['手动验证'],
    });

    expect(updated.checkpoints?.[0]?.verification?.steps).toEqual(['手动验证']);
  });

  it('应更新 expected', () => {
    const task = createMockTask();
    const updated = adjustCheckpointDetails(task, 'CP-001', {
      expected: '全部通过',
    });

    expect(updated.checkpoints?.[0]?.verification?.expected).toBe('全部通过');
  });

  it('应清空空数组', () => {
    const task = createMockTask();
    const updated = adjustCheckpointDetails(task, 'CP-001', {
      commands: [],
      steps: [],
      expected: '',
    });

    expect(updated.checkpoints?.[0]?.verification?.commands).toBeUndefined();
    expect(updated.checkpoints?.[0]?.verification?.steps).toBeUndefined();
    expect(updated.checkpoints?.[0]?.verification?.expected).toBeUndefined();
  });

  it('应抛出错误当检查点不存在', () => {
    const task = createMockTask();

    expect(() => adjustCheckpointDetails(task, 'CP-NOT-EXIST', {})).toThrow('检查点不存在');
  });
});

describe('adjustCheckpointDetailsBatch', () => {
  it('应批量调整多个检查点', () => {
    const task: TaskMeta = {
      ...createMockTask(),
      checkpoints: [
        {
          id: 'CP-001',
          description: 'A',
          status: 'pending',
          category: 'qa_verification',
          verification: { method: 'automated' },
          requiresHuman: false,
          requiredRole: 'qa_tester',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'CP-002',
          description: 'B',
          status: 'pending',
          category: 'code_review',
          verification: { method: 'automated' },
          requiresHuman: false,
          requiredRole: 'code_reviewer',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };

    const updated = adjustCheckpointDetailsBatch(task, [
      { checkpointId: 'CP-001', updates: { commands: ['cmd1'] } },
      { checkpointId: 'CP-002', updates: { expected: 'pass' } },
    ]);

    expect(updated.checkpoints?.[0]?.verification?.commands).toEqual(['cmd1']);
    expect(updated.checkpoints?.[1]?.verification?.expected).toBe('pass');
  });
});

describe('resetCheckpointDetails', () => {
  it('应重置检查点 details 为默认值', () => {
    const task = createMockTask();
    const updated = resetCheckpointDetails(task, 'CP-001');

    expect(updated.checkpoints?.[0]?.verification?.commands).toBeUndefined();
    expect(updated.checkpoints?.[0]?.verification?.steps).toBeUndefined();
    expect(updated.checkpoints?.[0]?.verification?.expected).toBeUndefined();
  });
});