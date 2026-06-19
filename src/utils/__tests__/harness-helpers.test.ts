/**
 * harness-helpers.ts 单元测试
 *
 * 覆盖范围（SYS-ORPHAN-2026-006 修复验证）：
 * - CP-1: activeChildProcesses 全局 Set 的基本契约（导出、初始空、可增删）
 * - CP-2: killAllActiveChildren 的 SIGTERM/SIGKILL/ESRCH/EPERM 路径
 *
 * 测试隔离策略：
 * - activeChildProcesses 是模块级全局 Set，每个用例 afterEach 必须 clear()
 * - process.kill / console.log / console.warn 通过 jest.spyOn 模拟
 * - 所有 spy 在 afterEach 通过 jest.restoreAllMocks() 还原
 *
 * 兼容性说明：
 * - 本项目使用 @swc/jest 编译 ESM，SWC 将导出属性设为 configurable: false，
 *   因此不能用 jest.mock() 或 jest.spyOn(module, 'fn')；只能 spy 全局对象或
 *   类原型方法。本测试仅 spy 全局对象（process / console），符合约束。
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { activeChildProcesses, killAllActiveChildren } from '../harness-helpers.js';

// ─── 辅助：构造 errno 错误对象 ───────────────────────────────

function makeErrnoError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

// ─── CP-1: activeChildProcesses 全局 Set 契约 ──────────────────

describe('activeChildProcesses (CP-1)', () => {
  afterEach(() => {
    activeChildProcesses.clear();
    jest.restoreAllMocks();
  });

  it('初始化后应为空 Set（或仅含历史残留，本测试自行清理）', () => {
    activeChildProcesses.clear();
    expect(activeChildProcesses.size).toBe(0);
  });

  it('支持 add/delete/has 操作，类型为 Set<number>', () => {
    activeChildProcesses.clear();
    activeChildProcesses.add(1001);
    activeChildProcesses.add(1002);
    expect(activeChildProcesses.has(1001)).toBe(true);
    expect(activeChildProcesses.has(1002)).toBe(true);
    expect(activeChildProcesses.size).toBe(2);

    activeChildProcesses.delete(1001);
    expect(activeChildProcesses.has(1001)).toBe(false);
    expect(activeChildProcesses.size).toBe(1);
  });
});

// ─── CP-2: killAllActiveChildren 行为矩阵 ──────────────────────

describe('killAllActiveChildren (CP-2)', () => {
  beforeEach(() => {
    activeChildProcesses.clear();
  });

  afterEach(() => {
    activeChildProcesses.clear();
    jest.restoreAllMocks();
  });

  it('空集合时返回 0，不调用 process.kill，不打印日志', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGTERM');

    expect(killed).toBe(0);
    expect(killSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('SIGTERM：对每个 PID 调用 process.kill 并返回命中数（CP-2 核心）', () => {
    activeChildProcesses.add(2001);
    activeChildProcesses.add(2002);
    activeChildProcesses.add(2003);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    // 抑制输出
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGTERM');

    expect(killed).toBe(3);
    expect(killSpy).toHaveBeenCalledTimes(3);
    expect(killSpy).toHaveBeenCalledWith(2001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(2002, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(2003, 'SIGTERM');
    // SIGTERM 不清空集合（等待 child exit/close 事件触发 delete）
    expect(activeChildProcesses.size).toBe(3);
  });

  it('ESRCH（进程已退出）：静默从集合移除，不计入 killed，不打印 warning', () => {
    activeChildProcesses.add(3001);
    activeChildProcesses.add(3002);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw makeErrnoError('ESRCH', 'No such process');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGTERM');

    expect(killed).toBe(0);
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
    // ESRCH 触发立即 delete，避免后续重复无效 kill
    expect(activeChildProcesses.size).toBe(0);
  });

  it('EPERM（权限不足）：计入 killed 失败，打印 warning，不从集合移除', () => {
    activeChildProcesses.add(4001);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw makeErrnoError('EPERM', 'Operation not permitted');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGTERM');

    expect(killed).toBe(0);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('4001'));
    // 非 ESRCH 错误不删除 PID（保留以便后续 SIGKILL 升级）
    expect(activeChildProcesses.has(4001)).toBe(true);
  });

  it('SIGKILL：调用后清空整个集合（兜底清理）', () => {
    activeChildProcesses.add(5001);
    activeChildProcesses.add(5002);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGKILL');

    expect(killed).toBe(2);
    expect(killSpy).toHaveBeenCalledWith(5001, 'SIGKILL');
    expect(killSpy).toHaveBeenCalledWith(5002, 'SIGKILL');
    // SIGKILL 强制清空，防止僵尸 PID 残留
    expect(activeChildProcesses.size).toBe(0);
  });

  it('混合场景：成功 + ESRCH + EPERM 并存时统计与清理行为正确', () => {
    activeChildProcesses.add(6001); // 成功
    activeChildProcesses.add(6002); // ESRCH
    activeChildProcesses.add(6003); // EPERM

    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 6001) return true;
      if (pid === 6002) throw makeErrnoError('ESRCH', 'No such process');
      throw makeErrnoError('EPERM', 'Operation not permitted');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const killed = killAllActiveChildren('SIGTERM');

    // 仅 6001 计入 killed
    expect(killed).toBe(1);
    expect(killSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // 6001（成功）保留 + 6003（EPERM）保留；6002（ESRCH）已 delete
    expect(activeChildProcesses.has(6001)).toBe(true);
    expect(activeChildProcesses.has(6002)).toBe(false);
    expect(activeChildProcesses.has(6003)).toBe(true);
    expect(activeChildProcesses.size).toBe(2);
  });

  it('默认参数为 SIGTERM（不传 signal 时）', () => {
    activeChildProcesses.add(7001);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    killAllActiveChildren();

    expect(killSpy).toHaveBeenCalledWith(7001, 'SIGTERM');
  });
});
// 文件结束
