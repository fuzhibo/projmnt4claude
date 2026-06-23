/**
 * Session 映射一致性单元测试（CP-SE-006, CP-SE-007）
 *
 * 覆盖范围：
 * - CP-SE-006: 内存映射与锁目录一致性
 * - CP-SE-007: 重试时 session 历史保留（--resume 参数）
 * - CP-SE-007b: 首次启动 fresh 状态参数
 *
 * 测试隔离策略：
 * - 每个 it 前后清空 sessionIdMapper（clear()），保证状态归零
 * - 锁目录通过 PROJMNT4CLAUDE_SESSION_ENV_ROOT 隔离到临时目录
 * - @swc/jest + ESM 不支持 jest.mock() / jest.spyOn(module)，仅 spy 全局对象
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sessionIdMapper,
  SessionIdMapper,
  buildSessionCliArgs,
} from '../session-id-mapper.js';
import { ensureCleanSessionSlot } from '../session-lock-cleanup.js';

// ─── CP-SE-006: 内存映射与锁目录一致性 ─────────────────────────

describe('CP-SE-006: 内存映射与锁目录一致性', () => {
  let tmpRoot: string;

  beforeEach(() => {
    sessionIdMapper.clear();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-se-006-'));
    process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT = tmpRoot;
  });

  afterEach(() => {
    sessionIdMapper.clear();
    jest.restoreAllMocks();
    delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  });

  it('generate 后 mapping 存在且锁目录存在（一致性成立）', () => {
    const cliUuid = sessionIdMapper.generate(
      'internal-test-1',
      'TASK-test-001',
      'development',
      'salt-001',
    );

    // 锁目录创建
    const lockDir = path.join(tmpRoot, cliUuid);
    fs.mkdirSync(lockDir, { recursive: true });

    // 映射存在
    expect(sessionIdMapper.toCliUuid('internal-test-1')).toBe(cliUuid);
    // 锁目录存在
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it('锁目录清理后 mapping 仍存在（内存映射独立于文件系统）', () => {
    const cliUuid = sessionIdMapper.generate(
      'internal-test-2',
      'TASK-test-002',
      'codeReview',
      'salt-002',
    );

    const lockDir = path.join(tmpRoot, cliUuid);
    fs.mkdirSync(lockDir, { recursive: true });

    // 清理锁目录
    ensureCleanSessionSlot(cliUuid);
    expect(fs.existsSync(lockDir)).toBe(false);

    // 内存映射仍存在（进程未退出）
    expect(sessionIdMapper.toCliUuid('internal-test-2')).toBe(cliUuid);
    expect(sessionIdMapper.size()).toBeGreaterThanOrEqual(1);
  });

  it('serialize/deserialize 闭环保持一致性', () => {
    sessionIdMapper.generate('int-1', 'TASK-001', 'development', 's');
    sessionIdMapper.generate('int-2', 'TASK-002', 'codeReview', 's');

    const serialized = sessionIdMapper.serialize();
    expect(serialized.length).toBe(2);

    // 新建 mapper 并反序列化
    const mapper2 = new SessionIdMapper();
    mapper2.deserialize(serialized);

    expect(mapper2.toCliUuid('int-1')).toBe(sessionIdMapper.toCliUuid('int-1'));
    expect(mapper2.toCliUuid('int-2')).toBe(sessionIdMapper.toCliUuid('int-2'));
    expect(mapper2.size()).toBe(2);
  });

  it('clear 后 size 归零', () => {
    sessionIdMapper.generate('int-3', 'TASK-003', 'evaluation', 's');
    expect(sessionIdMapper.size()).toBe(1);

    sessionIdMapper.clear();
    expect(sessionIdMapper.size()).toBe(0);
    expect(sessionIdMapper.toCliUuid('int-3')).toBeUndefined();
  });
});

// ─── CP-SE-007: 重试时 session 历史保留（--resume 参数） ──────

describe('CP-SE-007: CLI 参数构造（fresh vs active）', () => {
  beforeEach(() => {
    sessionIdMapper.clear();
  });

  afterEach(() => {
    sessionIdMapper.clear();
  });

  it('fresh 状态只包含 --session-id，不含 --resume（CP-SE-007b）', () => {
    const args = buildSessionCliArgs(
      'fresh',
      '12345678-1234-4123-8123-123456789abc',
    );

    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--fork-session');
  });

  it('active 状态包含 --session-id + --resume（CP-SE-007 核心）', () => {
    const args = buildSessionCliArgs(
      'active',
      '12345678-1234-4123-8123-123456789abc',
    );

    expect(args).toContain('--session-id');
    expect(args).toContain('--resume');
    expect(args).not.toContain('--fork-session');
  });

  it('probeSessionState: 首次生成后重新探测返回 active（重试续接）', () => {
    const cliUuid = sessionIdMapper.generate(
      'retry-internal',
      'TASK-retry',
      'development',
      'run-salt',
    );

    // 重试时重新探测同一 internalId → state: 'active'
    const result = sessionIdMapper.probeSessionState(
      'retry-internal',
      'TASK-retry',
      'development',
      'run-salt',
    );

    expect(result.state).toBe('active');
    expect(result.cliUuid).toBe(cliUuid);
  });

  it('probeSessionState: 无既有映射返回 fresh', () => {
    const result = sessionIdMapper.probeSessionState(
      'never-seen',
      'TASK-new',
      'development',
      'run-salt',
    );

    expect(result.state).toBe('fresh');
  });

  it('不同 runSalt 产生不同 cliUuid（跨运行隔离）', () => {
    const uuid1 = sessionIdMapper.generate('int-x', 'TASK-x', 'dev', 'salt-a');
    const uuid2 = sessionIdMapper.generate('int-x', 'TASK-x', 'dev', 'salt-b');

    expect(uuid1).not.toBe(uuid2);
  });
});
