import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SessionIdMapper,
  buildSessionCliArgs,
  assertIsValidUuidV4,
  deriveSessionStateFromLegacyFlags,
} from '../session-id-mapper.js';

/**
 * CP-3 / CP-3a: Session 二态探测与 CLI 参数构造
 *
 * V2.1 §6.1.7.3 二态决策矩阵：
 *   - fresh:  无既有映射 → 创建新会话（--session-id）
 *   - active: 既有映射存在 → 续接完整历史（--resume）
 *
 * probeSessionState(internalId) 不依赖 runSalt，直接查询 mappings。
 * generate() 在已有映射时复用 UUID，仅在无映射时生成新 UUID。
 */
describe('CP-3: session state probe (fresh/active)', () => {
  let mapper: SessionIdMapper;

  beforeEach(() => {
    mapper = new SessionIdMapper();
  });

  it('fresh: 无既有映射返回 fresh，cliUuid 为空字符串', () => {
    const internalId = mapper.buildStableInternalId('TASK-100', 'development');
    const probe = mapper.probeSessionState(internalId);
    expect(probe.state).toBe('fresh');
    expect(probe.cliUuid).toBe('');
    expect(probe.reason).toContain('no existing mapping');
  });

  it('active: 有既有映射返回 active，cliUuid 为已有 UUID', () => {
    const internalId = mapper.buildStableInternalId('TASK-101', 'development');
    const runSalt = 'test-run-salt';
    const cliUuid = mapper.generate(internalId, 'TASK-101', 'development', runSalt);

    const probe = mapper.probeSessionState(internalId);
    expect(probe.state).toBe('active');
    expect(probe.cliUuid).toBe(cliUuid);
    expect(probe.reason).toContain('existing mapping found');
  });

  it('generate: 已有映射时复用 UUID（不生成新 UUID）', () => {
    const internalId = mapper.buildStableInternalId('TASK-102', 'development');
    const uuid1 = mapper.generate(internalId, 'TASK-102', 'development', 'salt-1');
    // 同 internalId，不同 runSalt — 应复用已有 UUID
    const uuid2 = mapper.generate(internalId, 'TASK-102', 'development', 'salt-2');
    expect(uuid2).toBe(uuid1);
  });

  it('generate: 无映射时生成新 UUID', () => {
    const internalId = mapper.buildStableInternalId('TASK-103', 'development');
    const uuid = mapper.generate(internalId, 'TASK-103', 'development', 'salt');
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);
  });

  it('buildSessionCliArgs: fresh → --session-id <uuid>', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    const args = buildSessionCliArgs('fresh', uuid);
    expect(args).toEqual(['--session-id', uuid]);
  });

  it('buildSessionCliArgs: active → --resume <uuid>，不含 --session-id', () => {
    const uuid = '12345678-1234-4234-8234-123456789012';
    const args = buildSessionCliArgs('active', uuid);
    expect(args).toEqual(['--resume', uuid]);
    expect(args).not.toContain('--session-id');
  });

  it('buildSessionCliArgs: 非法 UUID 抛出异常', () => {
    expect(() => buildSessionCliArgs('fresh', 'not-a-uuid')).toThrow();
    expect(() => buildSessionCliArgs('fresh', '')).toThrow();
  });

  it('deriveSessionStateFromLegacyFlags: 默认 fresh', () => {
    expect(deriveSessionStateFromLegacyFlags({})).toBe('fresh');
  });

  it('deriveSessionStateFromLegacyFlags: resumeSession=true → active', () => {
    expect(deriveSessionStateFromLegacyFlags({ resumeSession: true })).toBe('active');
  });

  it('deriveSessionStateFromLegacyFlags: sessionState 显式传入优先', () => {
    expect(deriveSessionStateFromLegacyFlags({ sessionState: 'active' })).toBe('active');
    expect(deriveSessionStateFromLegacyFlags({ sessionState: 'fresh' })).toBe('fresh');
  });

  it('deriveSessionStateFromLegacyFlags: forkSession 被忽略（V2.1 废弃）', () => {
    // forkSession 已废弃，不影响推导结果
    expect(
      deriveSessionStateFromLegacyFlags({ resumeSession: true, forkSession: true }),
    ).toBe('active');
    expect(
      deriveSessionStateFromLegacyFlags({ forkSession: true }),
    ).toBe('fresh');
  });
});

/**
 * CP-3a: active 态读取完整历史（参数层校验）
 *
 * 同 internalId 下 retry 时 probe 返回 active，
 * active 分支 argv 仅含 --resume，Claude CLI 可读取前次完整历史。
 */
describe('CP-3a: active reads full history', () => {
  it('同 internalId 下 retry 使用 active 分支（--resume）', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-MARKER-A', 'development');

    // 首次调用：fresh
    const probeFirst = mapper.probeSessionState(internalId);
    expect(probeFirst.state).toBe('fresh');
    const firstArgs = buildSessionCliArgs('fresh', 'd0e4a5b6-1234-4234-8234-123456789abc');
    expect(firstArgs).toEqual(['--session-id', 'd0e4a5b6-1234-4234-8234-123456789abc']);

    // 模拟首次执行后写入映射
    mapper.generate(internalId, 'TASK-MARKER-A', 'development', 'run-A');

    // Retry：同 internalId → active
    const probeRetry = mapper.probeSessionState(internalId);
    expect(probeRetry.state).toBe('active');
    const retryArgs = buildSessionCliArgs(probeRetry.state, probeRetry.cliUuid);
    expect(retryArgs).toContain('--resume');
    expect(retryArgs).not.toContain('--session-id');
  });

  it('assertIsValidUuidV4 接受派生 UUID', () => {
    const mapper = new SessionIdMapper();
    const internalId = mapper.buildStableInternalId('TASK-UUID', 'development');
    const uuid = mapper.deriveDeterministicUuid(internalId, 'TASK-UUID', 'development', 'test-salt');
    expect(() => assertIsValidUuidV4(uuid)).not.toThrow();
  });

  it('assertIsValidUuidV4 拒绝非法 UUID', () => {
    expect(() => assertIsValidUuidV4('not-a-uuid')).toThrow();
    expect(() => assertIsValidUuidV4('')).toThrow();
  });

  it('assertIsValidUuidV4 拒绝 non-v4 UUID 格式', () => {
    // version nibble 不是 4（UUID v1 格式）
    expect(() =>
      assertIsValidUuidV4('12345678-1234-1234-8234-123456789012'),
    ).toThrow();
    // variant nibble 不在 8/9/a/b 范围
    expect(() =>
      assertIsValidUuidV4('12345678-1234-4234-0234-123456789012'),
    ).toThrow();
    // 长度不足
    expect(() =>
      assertIsValidUuidV4('12345678-1234-4234-8234-12345678901'),
    ).toThrow();
    // 含非法字符（G）
    expect(() =>
      assertIsValidUuidV4('12345678-1234-4234-8234-12345678901g'),
    ).toThrow();
  });
});

/**
 * buildStableInternalId: 确定性 internalId 派生
 */
describe('buildStableInternalId', () => {
  it('同 taskId+phase 派生相同 internalId', () => {
    const mapper = new SessionIdMapper();
    const a = mapper.buildStableInternalId('TASK-X', 'development');
    const b = mapper.buildStableInternalId('TASK-X', 'development');
    expect(a).toBe(b);
    expect(a).toContain('TASK-X');
    expect(a).toContain('stable-development');
  });

  it('不同 taskId 派生不同 internalId', () => {
    const mapper = new SessionIdMapper();
    const a = mapper.buildStableInternalId('TASK-A', 'development');
    const b = mapper.buildStableInternalId('TASK-B', 'development');
    expect(a).not.toBe(b);
  });

  it('同 taskId 不同 phase 派生不同 internalId', () => {
    const mapper = new SessionIdMapper();
    const a = mapper.buildStableInternalId('TASK-1', 'development');
    const b = mapper.buildStableInternalId('TASK-1', 'codeReview');
    expect(a).not.toBe(b);
  });
});
