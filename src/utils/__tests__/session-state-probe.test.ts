import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SessionIdMapper,
  buildSessionCliArgs,
  assertIsValidUuidV4,
  deriveSessionStateFromLegacyFlags,
} from '../session-id-mapper.js';

/**
 * CP-3 / CP-3a / CP-3b / CP-9: Session 三态探测与 CLI 参数构造
 *
 * V2.1 §6.1.7.3 三态决策矩阵：
 *   - fresh:  无既有映射（或 cliUuid 不一致） → 创建新会话
 *   - active: 既有映射且 runId 相同          → 续接完整历史
 *   - forked: 既有映射但 runId 不同          → 分叉（fork-session）
 *
 * CP-3: 三态分支构造正确的 CLI 参数
 * CP-3a: active 态读取完整历史（MARKER_A 闭环模拟）
 * CP-3b: forked 态压缩历史（MARKER_OLD 不泄漏）
 * CP-9: forkCount 跨 runId 演进
 */
describe('CP-3: session state switch (fresh/active/forked)', () => {
  let mapper: SessionIdMapper;

  beforeEach(() => {
    mapper = new SessionIdMapper();
  });

  it('fresh: 无既有映射返回 fresh', () => {
    const internalId = mapper.buildStableInternalId('TASK-100', 'development');
    const cliUuid = mapper.deriveDeterministicUuid(
      internalId,
      'TASK-100',
      'development',
    );
    const probe = mapper.probeSessionState(
      internalId,
      'TASK-100',
      'development',
      'run-1',
    );
    expect(probe.state).toBe('fresh');
    expect(probe.cliUuid).toBe(cliUuid);
    expect(probe.runId).toBe('run-1');
    expect(probe.mapping).toBeUndefined();
  });

  it('active: 同 runId 续接返回 active', () => {
    const internalId = mapper.buildStableInternalId('TASK-101', 'development');
    mapper.generate(internalId, 'TASK-101', 'development', {
      runId: 'run-stable',
      state: 'active',
    });

    const probe = mapper.probeSessionState(
      internalId,
      'TASK-101',
      'development',
      'run-stable',
    );
    expect(probe.state).toBe('active');
    expect(probe.mapping).toBeDefined();
    expect(probe.mapping!.runId).toBe('run-stable');
  });

  it('forked: 跨 runId 分叉返回 forked', () => {
    const internalId = mapper.buildStableInternalId('TASK-102', 'development');
    mapper.generate(internalId, 'TASK-102', 'development', {
      runId: 'run-old',
      state: 'active',
    });

    const probe = mapper.probeSessionState(
      internalId,
      'TASK-102',
      'development',
      'run-new',
    );
    expect(probe.state).toBe('forked');
    expect(probe.mapping).toBeDefined();
    expect(probe.mapping!.runId).toBe('run-old');
    expect(probe.runId).toBe('run-new');
  });

  it('buildSessionCliArgs: fresh 仅含 --session-id', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    const args = buildSessionCliArgs('fresh', uuid);
    expect(args).toEqual(['--session-id', uuid]);
  });

  it('buildSessionCliArgs: active 含 --resume 但无 --fork-session', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    const args = buildSessionCliArgs('active', uuid);
    expect(args).toEqual(['--session-id', uuid, '--resume']);
    expect(args).not.toContain('--fork-session');
  });

  it('buildSessionCliArgs: forked 同时含 --resume 和 --fork-session', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    const args = buildSessionCliArgs('forked', uuid);
    expect(args).toEqual([
      '--session-id',
      uuid,
      '--resume',
      '--fork-session',
    ]);
  });

  it('buildSessionCliArgs: 非法 UUID 抛出（UUID v4 校验）', () => {
    expect(() => buildSessionCliArgs('fresh', 'not-a-uuid')).toThrow();
    expect(() => buildSessionCliArgs('fresh', '')).toThrow();
  });

  it('deriveSessionStateFromLegacyFlags: 兼容遗留标志', () => {
    expect(deriveSessionStateFromLegacyFlags({})).toBe('fresh');
    expect(deriveSessionStateFromLegacyFlags({ resumeSession: true })).toBe(
      'active',
    );
    expect(
      deriveSessionStateFromLegacyFlags({
        resumeSession: true,
        forkSession: true,
      }),
    ).toBe('forked');
    expect(
      deriveSessionStateFromLegacyFlags({ sessionState: 'forked' }),
    ).toBe('forked');
  });
});

/**
 * CP-3a: active 态读取完整历史（参数层校验）
 *
 * 说明：MARKER_A 端到端闭环由 scripts/verify-session-continuity.sh 负责
 * （需真实 claude CLI 进程）。本测试只校验参数层契约：
 *   - 同 runId 下 retry 时 probe 返回 active
 *   - active 分支 argv 含 --resume 且不含 --fork-session
 * 这些是 Claude CLI 读取前次完整历史的必要条件。
 */
describe('CP-3a: active reads full history (MARKER_A closed loop)', () => {
  it('同 runId 下 retry 使用 active 分支（--resume 无 --fork-session）', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId(
      'TASK-MARKER-A',
      'development',
    );

    // 首次调用：fresh
    const probeFirst = mapper.probeSessionState(
      internalId,
      'TASK-MARKER-A',
      'development',
      'run-A',
    );
    expect(probeFirst.state).toBe('fresh');
    const firstArgs = buildSessionCliArgs(probeFirst.state, probeFirst.cliUuid);
    expect(firstArgs).not.toContain('--resume');
    // 模拟首次执行后写入映射（带 runId=run-A）
    mapper.generate(internalId, 'TASK-MARKER-A', 'development', {
      runId: 'run-A',
      state: 'active',
    });

    // Retry（同 runId）：active → 参数层等价于读取完整历史
    const probeRetry = mapper.probeSessionState(
      internalId,
      'TASK-MARKER-A',
      'development',
      'run-A',
    );
    expect(probeRetry.state).toBe('active');
    const retryArgs = buildSessionCliArgs(
      probeRetry.state,
      probeRetry.cliUuid,
    );
    expect(retryArgs).toContain('--resume');
    expect(retryArgs).not.toContain('--fork-session');
  });

  it('assertIsValidUuidV4 接受派生 UUID', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-UUID', 'development');
    const uuid = mapper.deriveDeterministicUuid(
      internalId,
      'TASK-UUID',
      'development',
    );
    expect(() => assertIsValidUuidV4(uuid)).not.toThrow();
  });
});

/**
 * CP-3b: forked 态压缩历史（参数层校验）
 *
 * 说明：MARKER_OLD 端到端不泄漏由 scripts/verify-session-compression.sh 负责。
 * 本测试校验参数层契约：forked 分支 argv 必须同时含 --resume 和 --fork-session。
 * --fork-session 是 Claude CLI 基于既有历史 fork 新会话的触发条件，
 * 也是压缩历史、避免旧 MARKER 原样携带的必要条件。
 */
describe('CP-3b: forked compresses history (MARKER_OLD non-leak)', () => {
  it('跨 runId 使用 forked 分支（含 --fork-session）', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId(
      'TASK-MARKER-OLD',
      'codeReview',
    );

    // 首次：run-old
    mapper.generate(internalId, 'TASK-MARKER-OLD', 'codeReview', {
      runId: 'run-old',
      state: 'active',
    });

    // 新流水线：run-new
    const probe = mapper.probeSessionState(
      internalId,
      'TASK-MARKER-OLD',
      'codeReview',
      'run-new',
    );
    expect(probe.state).toBe('forked');

    const args = buildSessionCliArgs(probe.state, probe.cliUuid);
    expect(args).toContain('--fork-session');
    expect(args).toContain('--resume');
  });

  it('forked 态 mapping 保留原 runId', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-RID', 'qa');
    mapper.generate(internalId, 'TASK-RID', 'qa', {
      runId: 'run-original',
      state: 'active',
    });

    const probe = mapper.probeSessionState(
      internalId,
      'TASK-RID',
      'qa',
      'run-fork',
    );
    expect(probe.state).toBe('forked');
    expect(probe.mapping!.runId).toBe('run-original');
    expect(probe.runId).toBe('run-fork');
  });
});

/**
 * CP-9: forkCount 跨 runId 演进
 *
 * 原理：每次 generate() 同一 internalId 但不同 runId 时，forkCount 递增。
 * forkCount > 5 视为异常（preflight-session-check.sh --check-fork-count）。
 */
describe('CP-9: forkCount evolution across runs', () => {
  it('首次 generate() forkCount=0', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-FC-1', 'development');
    const uuid = mapper.generate(internalId, 'TASK-FC-1', 'development', {
      runId: 'run-0',
      state: 'active',
    });
    const mapping = mapper.getMapping(uuid);
    expect(mapping).toBeDefined();
    expect(mapping!.forkCount).toBe(0);
  });

  it('同 runId 重用不递增 forkCount（幂等）', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-FC-2', 'development');
    const uuid1 = mapper.generate(internalId, 'TASK-FC-2', 'development', {
      runId: 'run-same',
      state: 'active',
    });
    const uuid2 = mapper.generate(internalId, 'TASK-FC-2', 'development', {
      runId: 'run-same',
      state: 'active',
    });
    expect(uuid2).toBe(uuid1);
    expect(mapper.getMapping(uuid1)!.forkCount).toBe(0);
  });

  it('跨 runId 多次 generate() 递增 forkCount', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-FC-3', 'development');
    const uuid = mapper.generate(internalId, 'TASK-FC-3', 'development', {
      runId: 'run-A',
      state: 'active',
    });

    // 同 internalId 切换 runId 触发分叉，forkCount 递增
    mapper.generate(internalId, 'TASK-FC-3', 'development', {
      runId: 'run-B',
      state: 'forked',
    });
    mapper.generate(internalId, 'TASK-FC-3', 'development', {
      runId: 'run-C',
      state: 'forked',
    });

    const mapping = mapper.getMapping(uuid);
    expect(mapping).toBeDefined();
    expect(mapping!.forkCount).toBeGreaterThanOrEqual(2);
  });

  it('forkCount > 5 触发 preflight 警告阈值', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-FC-4', 'development');
    const uuid = mapper.generate(internalId, 'TASK-FC-4', 'development', {
      runId: 'run-0',
      state: 'active',
    });

    // 7 次跨 runId 分叉
    for (let i = 1; i <= 7; i++) {
      mapper.generate(internalId, 'TASK-FC-4', 'development', {
        runId: `run-${i}`,
        state: 'forked',
      });
    }

    const mapping = mapper.getMapping(uuid);
    expect(mapping!.forkCount).toBeGreaterThan(5);
  });

  it('resolveRunId: 显式参数优先', () => {
    const mapper = new SessionIdMapper();
    expect(mapper.resolveRunId('explicit-run')).toBe('explicit-run');
  });

  it('resolveRunId: 环境变量次优先', () => {
    const mapper = new SessionIdMapper();
    const prev = process.env.HARNESS_RUN_ID;
    process.env.HARNESS_RUN_ID = 'env-run';
    try {
      expect(mapper.resolveRunId()).toBe('env-run');
    } finally {
      if (prev === undefined) {
        delete process.env.HARNESS_RUN_ID;
      } else {
        process.env.HARNESS_RUN_ID = prev;
      }
    }
  });

  it('buildStableInternalId: 同 taskId+phase 派生相同 internalId', () => {
    const mapper = new SessionIdMapper();
    const a = mapper.buildStableInternalId('TASK-X', 'development');
    const b = mapper.buildStableInternalId('TASK-X', 'development');
    expect(a).toBe(b);
    expect(a).toContain('TASK-X');
    expect(a).toContain('stable-development');
  });
});
