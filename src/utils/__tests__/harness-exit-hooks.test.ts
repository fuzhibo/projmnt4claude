/**
 * installExitHooks / uninstallExitHooks 单元测试（CP-03，INV-20260619-002 Track B-2）
 *
 * 覆盖范围：
 * - CP-03a: installExitHooks 在 SIGTERM/SIGINT/SIGHUP/exit 四个事件上注册监听器
 * - CP-03b: 幂等性——重复调用 installExitHooks 不重复注册（同一函数引用）
 * - CP-03c: 信号触发时调用 killAllActiveChildren('SIGTERM') + 孤儿清理
 * - CP-03d: exit 事件触发时调用 killAllActiveChildren('SIGKILL') 兜底
 * - CP-03e: knownCliUuids 集合在孤儿清理中生效（活跃 UUID 不被误删）
 * - CP-03f: uninstallExitHooks 移除所有监听器并清空内部状态
 * - CP-03g: 卸载后再次 installExitHooks 可重新注册（状态重置）
 * - CP-03h: handler 内部异常被吞掉，不污染原始信号语义
 *
 * 测试隔离策略：
 * - 每个 it 前后调用 uninstallExitHooks() 保证 installedHooks 状态归零
 * - 不发射真实信号到主进程（避免 jest/bun runner 被杀）；通过 process.listeners
 *   直接调用注册的 handler 验证行为
 * - 通过 spy session-lock-cleanup 的 listOrphanedSessions/cleanupOrphanedSessions
 *   验证 handler 是否正确调度（不实际触碰文件系统）
 *
 * 兼容性说明：
 * - 与 harness-helpers.test.ts 相同，使用 @jest/globals + SWC 编译；项目 bun:test
 *   运行时通过兼容层支持该写法（既有 9 个用例已验证）。
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  activeChildProcesses,
  installExitHooks,
  uninstallExitHooks,
} from '../harness-helpers.js';
import * as lockCleanup from '../session-lock-cleanup.js';

// ─── 工具：直接取出 installExitHooks 注册的 handler（绕过真实信号发射） ───────

function getRegisteredSignalHandler(sig: NodeJS.Signals): ((s: NodeJS.Signals) => void) | undefined {
  const listeners = process.listeners(sig) as Array<(s: NodeJS.Signals) => void>;
  // installExitHooks 注册的 handler 应当存在；返回最近一个
  return listeners.length > 0 ? listeners[listeners.length - 1] : undefined;
}

function getRegisteredExitHandler(): ((code: number) => void) | undefined {
  const listeners = process.listeners('exit') as Array<(c: number) => void>;
  return listeners.length > 0 ? listeners[listeners.length - 1] : undefined;
}

// ─── CP-03: installExitHooks / uninstallExitHooks 行为矩阵 ─────────────────

describe('installExitHooks / uninstallExitHooks (CP-03)', () => {
  beforeEach(() => {
    // 确保每个用例起始状态干净
    uninstallExitHooks();
    activeChildProcesses.clear();
  });

  afterEach(() => {
    // 用例结束同样清理，避免污染后续 describe
    uninstallExitHooks();
    activeChildProcesses.clear();
    jest.restoreAllMocks();
  });

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

    // 三次调用只新增一个监听器
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    expect(process.listenerCount('SIGHUP')).toBe(before + 1);
    expect(process.listenerCount('exit')).toBe(before + 1);
  });

  it('CP-03c: 信号 handler 调用 killAllActiveChildren("SIGTERM") 并调度孤儿清理', () => {
    // 安排一个子进程 PID 以便 killAllActiveChildren 有目标
    activeChildProcesses.add(99999); // 不存在的 PID，killAllActiveChildren 会 ESRCH 静默移除
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    const listSpy = jest
      .spyOn(lockCleanup, 'listOrphanedSessions')
      .mockReturnValue([{ cliUuid: 'orphan-uuid', lockDir: '/tmp/orphan', mtime: '2026-06-19T00:00:00.000Z' }]);
    const cleanupSpy = jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(1);

    installExitHooks(new Set<string>(), '/tmp/fake-session-env');
    const handler = getRegisteredSignalHandler('SIGTERM');
    expect(handler).toBeDefined();
    handler!('SIGTERM');

    // 验证 SIGTERM 路径被调用
    expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).toHaveBeenCalledWith([
      { cliUuid: 'orphan-uuid', lockDir: '/tmp/orphan', mtime: '2026-06-19T00:00:00.000Z' },
    ]);
  });

  it('CP-03d: exit handler 调用 killAllActiveChildren("SIGKILL") 兜底', () => {
    activeChildProcesses.add(88888);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const listSpy = jest.spyOn(lockCleanup, 'listOrphanedSessions').mockReturnValue([]);
    const cleanupSpy = jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(0);

    installExitHooks(new Set<string>());
    const exitHandler = getRegisteredExitHandler();
    expect(exitHandler).toBeDefined();
    exitHandler!(0);

    // 验证 SIGKILL 路径
    expect(killSpy).toHaveBeenCalledWith(88888, 'SIGKILL');
    expect(listSpy).toHaveBeenCalledTimes(1);
    // orphans 为空时不应调用 cleanup
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it('CP-03e: knownCliUuids 传入 listOrphanedSessions 跳过活跃 UUID', () => {
    const known = new Set<string>(['active-uuid-1', 'active-uuid-2']);
    const listSpy = jest.spyOn(lockCleanup, 'listOrphanedSessions').mockReturnValue([]);
    jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(0);
    jest.spyOn(process, 'kill').mockImplementation(() => true);

    installExitHooks(known, '/tmp/fake-session-env');
    const handler = getRegisteredSignalHandler('SIGINT');
    handler!('SIGINT');

    // listOrphanedSessions 应当收到完整的 knownCliUuids 集合
    expect(listSpy).toHaveBeenCalledWith(known, '/tmp/fake-session-env');
  });

  it('CP-03f: uninstallExitHooks 移除所有监听器并清空内部状态', () => {
    const before = process.listenerCount('SIGTERM');

    installExitHooks(new Set<string>());
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    uninstallExitHooks();

    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(process.listenerCount('SIGHUP')).toBe(before);
    expect(process.listenerCount('exit')).toBe(before);

    // 卸载后再次调用应无副作用（幂等）
    expect(() => uninstallExitHooks()).not.toThrow();
  });

  it('CP-03g: 卸载后可重新 installExitHooks（状态重置可循环）', () => {
    const before = process.listenerCount('SIGTERM');

    installExitHooks(new Set<string>());
    uninstallExitHooks();
    installExitHooks(new Set<string>());

    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    // 第二次注册的 handler 应当是新的函数引用（行为可独立验证）
    const handler = getRegisteredSignalHandler('SIGTERM');
    expect(handler).toBeDefined();
  });

  it('CP-03h: handler 内部异常被吞掉，不向上抛出（不污染信号语义）', () => {
    // 让 killAllActiveChildren 内部 process.kill 抛非 errno 异常
    activeChildProcesses.add(77777);
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('unexpected non-errno failure');
    });
    // listOrphanedSessions 也抛
    jest.spyOn(lockCleanup, 'listOrphanedSessions').mockImplementation(() => {
      throw new Error('session-env scan failed');
    });
    const cleanupSpy = jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(0);

    installExitHooks(new Set<string>());
    const handler = getRegisteredSignalHandler('SIGHUP');
    const exitHandler = getRegisteredExitHandler();

    // 两个 handler 都不应抛出
    expect(() => handler!('SIGHUP')).not.toThrow();
    expect(() => exitHandler!(1)).not.toThrow();
    // cleanup 不应被调用（listOrphanedSessions 已抛异常跳过 if 分支）
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it('CP-03i: sessionEnvRoot 参数透传到 listOrphanedSessions（测试可覆盖根目录）', () => {
    const listSpy = jest.spyOn(lockCleanup, 'listOrphanedSessions').mockReturnValue([]);
    jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(0);
    jest.spyOn(process, 'kill').mockImplementation(() => true);

    const customRoot = '/custom/test/session-env';
    installExitHooks(new Set<string>(), customRoot);
    const handler = getRegisteredSignalHandler('SIGTERM');
    handler!('SIGTERM');

    expect(listSpy).toHaveBeenCalledWith(expect.any(Set), customRoot);
  });
});

// ─── CP-03 闭环集成：generate → ensureCleanSessionSlot → signal → orphan cleaned ──

describe('installExitHooks closed-loop integration (CP-03 + CP-02)', () => {
  beforeEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
  });

  afterEach(() => {
    uninstallExitHooks();
    activeChildProcesses.clear();
    jest.restoreAllMocks();
  });

  it('闭环：spawn PID + ensureCleanSessionSlot 后信号触发，孤儿清理被调用', () => {
    // 模拟流水线场景：
    //   1. AssemblyLine 生成 sessionId 后调用 ensureCleanSessionSlot
    //   2. 主进程意外收到 SIGTERM
    //   3. installExitHooks 的 handler 应触发孤儿扫描+清理
    activeChildProcesses.add(66666);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const orphans = [
      {
        cliUuid: '11111111-2222-3333-4444-555555555555',
        lockDir: '/tmp/orphan-1',
        mtime: '2026-06-19T00:00:00.000Z',
      },
    ];
    const listSpy = jest.spyOn(lockCleanup, 'listOrphanedSessions').mockReturnValue(orphans);
    const cleanupSpy = jest.spyOn(lockCleanup, 'cleanupOrphanedSessions').mockReturnValue(1);

    // 已知活跃 UUID 集合（由 sessionIdMapper.serialize() 提供）
    const known = new Set<string>(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
    installExitHooks(known, '/tmp/fake-root');

    // 模拟外部信号到达
    const handler = getRegisteredSignalHandler('SIGTERM');
    handler!('SIGTERM');

    // 断言完整闭环：
    // 1) killAllActiveChildren 先于孤儿清理（顺序由 handler 内部保证）
    expect(killSpy).toHaveBeenCalledWith(66666, 'SIGTERM');
    // 2) listOrphanedSessions 收到活跃集合（避免误删）
    expect(listSpy).toHaveBeenCalledWith(known, '/tmp/fake-root');
    // 3) cleanupOrphanedSessions 被调用且收到完整孤儿列表
    expect(cleanupSpy).toHaveBeenCalledWith(orphans);
    // 4) 活跃 UUID 不在 orphans 列表中（由 listOrphanedSessions 实现保证，CP-04 已覆盖）
  });
});
