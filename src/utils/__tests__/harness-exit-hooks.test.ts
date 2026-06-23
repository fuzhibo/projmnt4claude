/**
 * installExitHooks / uninstallExitHooks 单元测试（CP-03，INV-20260619-002 Track B-2）
 *
 * 覆盖范围：
 * - CP-03a: installExitHooks 在 SIGTERM/SIGINT/SIGHUP/exit 四个事件上注册监听器
 * - CP-03b: 幂等性——重复调用 installExitHooks 不重复注册（同一函数引用）
 * - CP-03c: 信号触发时调用 killAllActiveChildren('SIGTERM') + 孤儿清理
 * - CP-03d: exit 事件触发时调用 killAllActiveChildren('SIGKILL') + known UUID 清理
 * - CP-03e: knownCliUuids 集合在孤儿清理中生效（活跃 UUID 不被误删）
 * - CP-03f: uninstallExitHooks 移除所有监听器并清空内部状态
 * - CP-03g: 卸载后再次 installExitHooks 可重新注册（状态重置）
 * - CP-03h: handler 内部异常被吞掉，不污染原始信号语义
 * - CP-SE-005: exit handler 调用 ensureCleanSessionSlot 清理所有已知 UUID 锁目录
 *
 * 测试隔离策略：
 * - 每个 it 前后调用 uninstallExitHooks() 保证 installedHooks 状态归零
 * - 不发射真实信号到主进程（避免 jest runner 被杀）；通过 process.listeners
 *   直接调用注册的 handler 验证行为
 * - @swc/jest + ESM 不支持 jest.mock() / jest.spyOn(module)，仅 spy 全局对象
 * - session-lock-cleanup 通过 PROJMNT4CLAUDE_SESSION_ENV_ROOT 环境变量隔离到临时目录，
 *   验证真实文件系统副作用（目录创建/删除）
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  activeChildProcesses,
  installExitHooks,
  uninstallExitHooks,
} from '../harness-helpers.js';

// ─── 工具：直接取出 installExitHooks 注册的 handler ───────

function getRegisteredSignalHandler(sig: NodeJS.Signals): ((s: NodeJS.Signals) => void) | undefined {
  const listeners = process.listeners(sig) as Array<(s: NodeJS.Signals) => void>;
  return listeners.length > 0 ? listeners[listeners.length - 1] : undefined;
}

function getRegisteredExitHandler(): ((code: number) => void) | undefined {
  const listeners = process.listeners('exit') as Array<(c: number) => void>;
  return listeners.length > 0 ? listeners[listeners.length - 1] : undefined;
}

// ─── CP-03: installExitHooks / uninstallExitHooks 行为矩阵 ─────────────────

describe('installExitHooks / uninstallExitHooks (CP-03)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp03-session-env-'));
    process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT = tmpRoot;
  });

  afterEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
    jest.restoreAllMocks();
    delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  });

  // ── 监听器注册 (不需 mock) ──────────────────────────────────

  it('CP-03a: installExitHooks 在 SIGTERM/SIGINT/SIGHUP/exit 上各注册一个监听器', () => {
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    const beforeSighup = process.listenerCount('SIGHUP');
    const beforeExit = process.listenerCount('exit');

    installExitHooks(new Set<string>());

    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);
    expect(process.listenerCount('SIGHUP')).toBe(beforeSighup + 1);
    expect(process.listenerCount('exit')).toBe(beforeExit + 1);
  });

  it('CP-03b: 重复调用 installExitHooks 不重复注册（幂等）', () => {
    const before = process.listenerCount('SIGTERM');

    installExitHooks(new Set<string>());
    installExitHooks(new Set<string>());
    installExitHooks(new Set<string>());

    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    expect(process.listenerCount('SIGHUP')).toBe(before + 1);
    expect(process.listenerCount('exit')).toBe(before + 1);
  });

  // ── 信号 handler 行为（文件系统验证） ──────────────────────

  it('CP-03c: 信号 handler 调用 killAllActiveChildren("SIGTERM") 并清理孤儿锁', () => {
    // 创建孤儿锁目录（不在 knownCliUuids 中）
    const orphanUuid = '11111111-1111-4111-8111-111111111111';
    const orphanDir = path.join(tmpRoot, orphanUuid);
    fs.mkdirSync(orphanDir, { recursive: true });

    activeChildProcesses.add(99999);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    installExitHooks(new Set<string>());
    const handler = getRegisteredSignalHandler('SIGTERM');
    expect(handler).toBeDefined();
    handler!('SIGTERM');

    expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
    // 孤儿锁目录应被清理
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  it('CP-03d: exit handler 调用 killAllActiveChildren("SIGKILL") 并清理已知 UUID', () => {
    const uuid = '22222222-2222-4222-8222-222222222222';
    const lockDir = path.join(tmpRoot, uuid);
    fs.mkdirSync(lockDir, { recursive: true });

    activeChildProcesses.add(88888);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    installExitHooks(new Set([uuid]));
    const exitHandler = getRegisteredExitHandler();
    expect(exitHandler).toBeDefined();
    exitHandler!(0);

    expect(killSpy).toHaveBeenCalledWith(88888, 'SIGKILL');
    // 已知 UUID 目录应在 exit handler 中被 ensureCleanSessionSlot 清理
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('CP-03e: knownCliUuids 中的活跃 UUID 不被孤儿清理误删', () => {
    const knownUuid = 'aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc';
    const orphanUuid = '11111111-2222-4222-8222-333333333333';
    fs.mkdirSync(path.join(tmpRoot, knownUuid), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, orphanUuid), { recursive: true });

    jest.spyOn(process, 'kill').mockImplementation(() => true);

    const known = new Set([knownUuid]);
    installExitHooks(known);

    // 触发信号 handler
    const handler = getRegisteredSignalHandler('SIGINT');
    handler!('SIGINT');

    // 已知 UUID 应保留（不在信号 handler 中清理），孤儿应被清理
    expect(fs.existsSync(path.join(tmpRoot, knownUuid))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, orphanUuid))).toBe(false);
  });

  // ── 卸载/重装 ──────────────────────────────────────────────

  it('CP-03f: uninstallExitHooks 移除所有监听器并清空内部状态', () => {
    const before = process.listenerCount('SIGTERM');

    installExitHooks(new Set<string>());
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    uninstallExitHooks();

    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(process.listenerCount('SIGHUP')).toBe(before);
    expect(process.listenerCount('exit')).toBe(before);

    expect(() => uninstallExitHooks()).not.toThrow();
  });

  it('CP-03g: 卸载后可重新 installExitHooks（状态重置可循环）', () => {
    const before = process.listenerCount('SIGTERM');

    installExitHooks(new Set<string>());
    uninstallExitHooks();
    installExitHooks(new Set<string>());

    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    const handler = getRegisteredSignalHandler('SIGTERM');
    expect(handler).toBeDefined();
  });

  // ── 异常吞噬 ───────────────────────────────────────────────

  it('CP-03h: handler 内部异常被吞掉，不向上抛出（不污染信号语义）', () => {
    activeChildProcesses.add(77777);
    // process.kill 抛非 errno 异常
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('unexpected non-errno failure');
    });

    installExitHooks(new Set<string>());
    const handler = getRegisteredSignalHandler('SIGHUP');
    const exitHandler = getRegisteredExitHandler();

    expect(() => handler!('SIGHUP')).not.toThrow();
    expect(() => exitHandler!(1)).not.toThrow();
  });

  // ── CP-SE-005: exit handler 清理所有已知 UUID ──────────────

  it('CP-SE-005: exit handler 调用 ensureCleanSessionSlot 清理所有已知 UUID 锁目录', () => {
    const uuid1 = '11111111-1111-4111-8111-111111111111';
    const uuid2 = '22222222-2222-4222-8222-222222222222';
    const dir1 = path.join(tmpRoot, uuid1);
    const dir2 = path.join(tmpRoot, uuid2);
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    activeChildProcesses.add(88888);
    jest.spyOn(process, 'kill').mockImplementation(() => true);

    const known = new Set([uuid1, uuid2]);
    installExitHooks(known);

    const exitHandler = getRegisteredExitHandler();
    expect(exitHandler).toBeDefined();
    exitHandler!(0);

    // 两个已知 UUID 目录都应在 exit handler 中被清理
    expect(fs.existsSync(dir1)).toBe(false);
    expect(fs.existsSync(dir2)).toBe(false);
  });

  it('CP-03i: sessionEnvRoot 参数透传生效（孤儿在指定 root 下被清理）', () => {
    const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp03i-custom-'));
    try {
      const orphanUuid = '11111111-2222-4222-8222-333333333333';
      const orphanDir = path.join(customRoot, orphanUuid);
      fs.mkdirSync(orphanDir, { recursive: true });

      jest.spyOn(process, 'kill').mockImplementation(() => true);

      // 传入 customRoot 作为 sessionEnvRoot 参数
      installExitHooks(new Set<string>(), customRoot);
      const handler = getRegisteredSignalHandler('SIGTERM');
      handler!('SIGTERM');

      // 孤儿在 customRoot 下被清理
      expect(fs.existsSync(orphanDir)).toBe(false);
      // tmpRoot（默认 root）不受影响
      expect(fs.existsSync(tmpRoot)).toBe(true);
    } finally {
      fs.rmSync(customRoot, { recursive: true, force: true });
    }
  });
});

// ─── CP-03 闭环集成 ────────────────────────────────────────────────────────

describe('installExitHooks closed-loop integration (CP-03 + CP-02)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp03-closed-'));
    process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT = tmpRoot;
  });

  afterEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
    jest.restoreAllMocks();
    delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  });

  it('闭环：spawn PID + 信号触发后孤儿清理，活跃 UUID 保留', () => {
    const knownUuid = 'aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc';
    const orphanUuid = '11111111-2222-4222-8222-333333333333';
    fs.mkdirSync(path.join(tmpRoot, knownUuid), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, orphanUuid), { recursive: true });

    activeChildProcesses.add(66666);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    const known = new Set([knownUuid]);
    installExitHooks(known);

    const handler = getRegisteredSignalHandler('SIGTERM');
    handler!('SIGTERM');

    // killAllActiveChildren 先于孤儿清理
    expect(killSpy).toHaveBeenCalledWith(66666, 'SIGTERM');
    // 活跃 UUID 保留（信号 handler 不清理已知 UUID）
    expect(fs.existsSync(path.join(tmpRoot, knownUuid))).toBe(true);
    // 孤儿被清理
    expect(fs.existsSync(path.join(tmpRoot, orphanUuid))).toBe(false);
  });
});
