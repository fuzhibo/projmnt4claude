/**
 * 子进程全局注册表
 *
 * 所有通过 spawnWithMemoryLimit 创建的子进程自动注册到此注册表。
 * 信号处理器（gracefulShutdown）在主进程退出前遍历清理，避免孤儿进程
 * 累积导致系统资源耗尽（SYS-ORPHAN-2026-006）。
 *
 * 设计原则：
 * - spawnWithMemoryLimit 内部自动注册/反注册，调用方无需手动管理
 * - 集中式管理，消除分散维护点，防止未来新增 spawn 调用时遗漏注册
 *
 * @module child-process-registry
 * @see docs/investigation-oom-and-hung/harness-hung-reboot-investigation-report-20260622.md
 */

/**
 * 全局活跃子进程 PID 集合。
 * 由 spawnWithMemoryLimit 自动维护（spawn 时注册，exit/close/error 时注销）。
 */
export const activeChildProcesses: Set<number> = new Set();

/**
 * 终止所有已注册的活跃子进程。
 *
 * @param signal POSIX 信号，默认 SIGTERM。主进程退出前应先 SIGTERM 再 SIGKILL。
 * @returns 已发送信号的 PID 数量
 */
export function killAllActiveChildren(signal: NodeJS.Signals = 'SIGTERM'): number {
  let killed = 0;
  // 先 snapshot 再迭代，避免在遍历中 delete 当前元素导致未定义行为
  const pids = [...activeChildProcesses];
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      killed++;
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'ESRCH') {
        // 进程已退出：立即从集合移除，避免计数虚高与后续重复无效 kill
        activeChildProcesses.delete(pid);
      } else {
        console.warn(`   ⚠️  Failed to kill child ${pid}: ${(err as Error).message}`);
      }
    }
  }
  if (killed > 0) {
    console.log(`   🛑 Sent ${signal} to ${killed} child process(es)`);
  }
  if (signal === 'SIGKILL') {
    // 强制终止后清空集合；SIGTERM 保留以便后续 SIGKILL 兜底
    activeChildProcesses.clear();
  }
  return killed;
}
