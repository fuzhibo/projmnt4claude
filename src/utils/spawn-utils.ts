/**
 * spawn-utils — 子进程内存限制工具模块
 *
 * 在支持 cgroup v2 的 Linux 环境中，通过 systemd-run --scope 为子进程
 * 施加 MemoryMax 硬限制，防止 bun/JSC heap 贪心分配导致系统 OOM。
 *
 * 非 Linux 环境自动降级为直接 spawn/execSync，仅输出 warning 日志。
 *
 * 配置优先级: config.json harness.memoryLimit > 代码默认值
 *
 * 关键行为（已通过 memory-stress-test.cjs 验证）：
 * - MemoryMax 单独使用时是**软限制**：进程达到限制后被 throttle，不被 kill
 * - MemoryMax + MemorySwapMax=0 + memory.oom.group=1 = 硬限制：达到限制时 OOM kill
 * - 不设置 SwapMax=0 时，进程可通过 swap 继续分配，导致系统 hung 死
 *
 * @module spawn-utils
 * @see docs/investigation-oom/SYSTEM-HANG-ROOT-CAUSE-ANALYSIS.md
 */

import { spawn, execSync, type SpawnOptions, type ExecSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readConfig } from '../commands/config.js';
import type { HarnessMemoryLimitConfig } from '../types/config.js';

// ─── 默认值 ───

const DEFAULT_MEMORY_LIMIT_CONFIG: Required<HarnessMemoryLimitConfig> = {
  defaultGB: 4,
  overrides: {
    coverage: 8,
    claudeAgent: 8,
    build: 2,
  },
  enabled: true,
};

// ─── 平台检测 (缓存结果) ───

let _cgroupV2Available: boolean | null = null;

/** 检测当前环境是否支持 cgroup v2 + systemd-run */
export function hasCgroupV2Support(): boolean {
  if (_cgroupV2Available !== null) return _cgroupV2Available;
  if (os.platform() !== 'linux') {
    _cgroupV2Available = false;
    return false;
  }
  try {
    const fsType = execSync(
      "stat -f /sys/fs/cgroup -c %T 2>/dev/null",
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    if (fsType !== 'cgroup2fs') {
      _cgroupV2Available = false;
      return false;
    }
    execSync('systemd-run --user --scope true 2>/dev/null', { timeout: 5000 });
    _cgroupV2Available = true;
    return true;
  } catch {
    _cgroupV2Available = false;
    return false;
  }
}

/** 重置平台检测缓存（主要用于测试） */
export function resetCgroupV2Detection(): void {
  _cgroupV2Available = null;
}

// ─── 系统内存压力检测 ───

export interface SystemMemoryInfo {
  totalMB: number;
  freeMB: number;
  availableMB: number;
  committedMB: number;
  overcommitRatio: number;
  isUnderPressure: boolean;
}

/**
 * 读取 /proc/meminfo 获取系统内存状态
 */
export function getSystemMemoryInfo(): SystemMemoryInfo {
  const defaults: SystemMemoryInfo = {
    totalMB: 0, freeMB: 0, availableMB: 0, committedMB: 0,
    overcommitRatio: 0, isUnderPressure: false,
  };

  if (os.platform() !== 'linux') return defaults;

  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const parseField = (name: string): number => {
      const match = meminfo.match(new RegExp(`${name}:\\s+(\\d+)`));
      return match ? parseInt(match[1]!) / 1024 : 0;
    };

    const totalMB = parseField('MemTotal');
    const freeMB = parseField('MemFree');
    const availableMB = parseField('MemAvailable');
    const committedMB = parseField('Committed_AS');
    const overcommitRatio = totalMB > 0 ? committedMB / totalMB : 0;
    const isUnderPressure = availableMB < totalMB * 0.1;

    return { totalMB, freeMB, availableMB, committedMB, overcommitRatio, isUnderPressure };
  } catch {
    return defaults;
  }
}

/**
 * 检查系统内存压力，如果可用内存 < 阈值则拒绝启动新进程
 */
export function checkMemoryPressure(thresholdRatio = 0.1): { ok: boolean; message: string } {
  if (os.platform() !== 'linux') {
    return { ok: true, message: '非 Linux 环境，跳过内存压力检查' };
  }

  const info = getSystemMemoryInfo();
  const thresholdMB = info.totalMB * thresholdRatio;

  if (info.availableMB < thresholdMB) {
    return {
      ok: false,
      message: `[spawn-utils] 系统内存不足 (可用: ${info.availableMB.toFixed(0)}MB < 阈值: ${thresholdMB.toFixed(0)}MB)，拒绝启动子进程`,
    };
  }

  return { ok: true, message: `内存充足 (可用: ${info.availableMB.toFixed(0)}MB)` };
}

// ─── 配置读取 ───

/** 操作类型，决定使用哪个 override 限制值 */
export type MemoryLimitType = 'default' | 'coverage' | 'claudeAgent' | 'build';

/**
 * 从 config.json 读取内存限制配置，未配置则返回默认值
 */
export function getMemoryLimitConfig(cwd: string): Required<HarnessMemoryLimitConfig> {
  try {
    const config = readConfig(cwd);
    if (config?.harness?.memoryLimit) {
      const user = config.harness.memoryLimit;
      return {
        defaultGB: user.defaultGB ?? DEFAULT_MEMORY_LIMIT_CONFIG.defaultGB,
        overrides: {
          coverage: user.overrides?.coverage ?? DEFAULT_MEMORY_LIMIT_CONFIG.overrides.coverage,
          claudeAgent: user.overrides?.claudeAgent ?? DEFAULT_MEMORY_LIMIT_CONFIG.overrides.claudeAgent,
          build: user.overrides?.build ?? DEFAULT_MEMORY_LIMIT_CONFIG.overrides.build,
        },
        enabled: user.enabled ?? DEFAULT_MEMORY_LIMIT_CONFIG.enabled,
      };
    }
  } catch {
    // config.json 不存在或无法解析，使用默认值
  }
  return { ...DEFAULT_MEMORY_LIMIT_CONFIG, overrides: { ...DEFAULT_MEMORY_LIMIT_CONFIG.overrides } };
}

/**
 * 根据操作类型返回对应的内存限制 (GB)
 */
export function getMemoryLimitGB(
  cwd: string,
  type: MemoryLimitType = 'default'
): number {
  const cfg = getMemoryLimitConfig(cwd);
  switch (type) {
    case 'coverage': return cfg.overrides.coverage;
    case 'claudeAgent': return cfg.overrides.claudeAgent;
    case 'build': return cfg.overrides.build;
    default: return cfg.defaultGB;
  }
}

// ─── cgroup v2 OOM kill 配置 ───

/**
 * 在子进程的 cgroup scope 中设置 memory.oom.group=1
 *
 * 默认情况下，MemoryMax 是软限制：达到限制后进程被 throttle（阻塞），
 * 而非被 kill。这会导致系统 hung 死（swap thrashing）。
 *
 * 设置 memory.oom.group=1 后，当 cgroup 内存达到 MemoryMax 时，
 * OOM killer 会直接 kill 整个 cgroup 的进程，而不是 throttle。
 *
 * @param pid 子进程 PID
 */
function setCgroupOOMGroup(pid: number): void {
  try {
    const cgroupPath = getCgroupPathForPid(pid);
    if (cgroupPath) {
      const oomGroupPath = path.join('/sys/fs/cgroup', cgroupPath, 'memory.oom.group');
      if (fs.existsSync(oomGroupPath)) {
        fs.writeFileSync(oomGroupPath, '1');
      }
    }
  } catch (err) {
    console.warn(
      '[spawn-utils] 无法设置 memory.oom.group=1，进程可能被 throttle 而非 OOM kill:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * 获取进程的 cgroup 路径
 */
function getCgroupPathForPid(pid: number): string | null {
  try {
    const cgroupFile = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf-8');
    // 查找 cgroup v2 统一层级条目（0:: 前缀）
    const v2Line = cgroupFile.trim().split('\n').find(l => l.startsWith('0::'));
    if (v2Line) {
      return v2Line.split(':').slice(2).join(':') || null;
    }
  } catch {
    // 进程可能已退出
  }
  return null;
}

// ─── systemd scope 嵌套检测 ───

/**
 * 检测当前进程是否已在 systemd scope 内。
 *
 * 当 Harness 流水线通过 systemd-run --scope 启动 Headless Claude 时，
 * Headless Claude 内部再次调用 spawnWithMemoryLimit 会尝试嵌套创建 scope，
 * 导致 systemd 冲突错误（Running as unit: run-xxx.scope）。
 *
 * 通过读取 /proc/self/cgroup 检测 .scope 后缀，判断当前是否已在 scope 内。
 *
 * @returns true 表示当前进程已在 systemd scope 内
 */
function isInSystemdScope(): boolean {
  if (os.platform() !== 'linux') return false;
  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf-8');
    return cgroup.includes('.scope');
  } catch {
    return false;
  }
}

// ─── spawn 封装 ───

/**
 * spawn 子进程。在支持 cgroup v2 的环境中自动添加内存限制。
 *
 * 关键行为变更（v1.34.0）：
 * - 同时设置 MemoryMax + MemorySwapMax=0，禁止进程使用 swap
 * - 通过 memory.oom.group=1 使 OOM kill 替代 throttle
 * - 启动前检查系统内存压力，不足时拒绝启动
 *
 * @param command  要执行的命令
 * @param args     命令参数
 * @param options  spawn 选项（需包含 cwd 用于定位 config.json）
 * @param type     操作类型（决定使用哪个 override 限制值）
 */
export function spawnWithMemoryLimit(
  command: string,
  args: string[],
  options: SpawnOptions & { cwd: string },
  type: MemoryLimitType = 'default',
) {
  // 测试注入点：允许测试通过全局变量替换实现
  // 必须在函数内读取，不能缓存到模块级变量（jest beforeAll 在模块加载后执行）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMocks = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__;
  if (testMocks?.spawnWithMemoryLimit) {
    return testMocks.spawnWithMemoryLimit(command, args, options, type);
  }

  const cfg = getMemoryLimitConfig(options.cwd);

  // 启动前检查内存压力，不足时拒绝启动
  if (cfg.enabled) {
    const pressure = checkMemoryPressure();
    if (!pressure.ok) {
      throw new Error(pressure.message);
    }
  }

  if (cfg.enabled && hasCgroupV2Support() && !isInSystemdScope()) {
    const maxGB = type === 'coverage' ? cfg.overrides.coverage
      : type === 'claudeAgent' ? cfg.overrides.claudeAgent
      : type === 'build' ? cfg.overrides.build
      : cfg.defaultGB;

    const wrappedArgs = [
      '--user', '--scope',
      '-p', `MemoryMax=${maxGB}G`,
      '-p', 'MemorySwapMax=0',
      '--',
      command,
      ...args,
    ];
    const child = spawn('systemd-run', wrappedArgs, options);

    // 设置 OOM group kill：使用 spawn 事件确保 cgroup 已创建
    child.on('spawn', () => {
      if (child.pid) setCgroupOOMGroup(child.pid);
    });

    return child;
  }

  // 降级：已在 systemd scope 内或 cgroup v2 不可用，直接 spawn
  if (cfg.enabled && isInSystemdScope()) {
    console.warn(
      `[spawn-utils] 当前进程已在 systemd scope 内，跳过 systemd-run 嵌套，` +
      `直接运行 "${command}" (无额外内存限制)`
    );
  } else if (cfg.enabled && !hasCgroupV2Support()) {
    console.warn(
      `[spawn-utils] cgroup v2 不可用 (平台: ${os.platform()})，` +
      `直接运行 "${command}" (无内存限制)`
    );
  }
  return spawn(command, args, options);
}

// ─── execSync 封装 ───

/**
 * 等效于 execSync，但在支持 cgroup v2 的环境中添加内存限制。
 *
 * 关键行为变更（v1.34.0）：
 * - 同时设置 MemoryMax + MemorySwapMax=0
 * - 启动前检查系统内存压力
 *
 * @param command  要执行的命令（shell 字符串）
 * @param options  execSync 选项（需包含 cwd 用于定位 config.json）
 * @param type     操作类型（决定使用哪个 override 限制值）
 */
export function execSyncWithMemoryLimit(
  command: string,
  options: ExecSyncOptions & { cwd: string },
  type: MemoryLimitType = 'default',
): Buffer | string {
  const cfg = getMemoryLimitConfig(options.cwd);

  // 启动前检查内存压力，不足时拒绝启动
  if (cfg.enabled) {
    const pressure = checkMemoryPressure();
    if (!pressure.ok) {
      throw new Error(pressure.message);
    }
  }

  if (cfg.enabled && hasCgroupV2Support() && !isInSystemdScope()) {
    const maxGB = type === 'coverage' ? cfg.overrides.coverage
      : type === 'claudeAgent' ? cfg.overrides.claudeAgent
      : type === 'build' ? cfg.overrides.build
      : cfg.defaultGB;

    // systemd-run --user --scope -p MemoryMax=N -p MemorySwapMax=0 -- <command>
    const wrappedCmd = [
      'systemd-run', '--user', '--scope',
      `-p`, `MemoryMax=${maxGB}G`,
      '-p', 'MemorySwapMax=0',
      '--', command,
    ].join(' ');

    return execSync(wrappedCmd, options);
  }

  // 降级：已在 systemd scope 内或 cgroup v2 不可用，直接 execSync
  if (cfg.enabled && isInSystemdScope()) {
    console.warn(
      `[spawn-utils] 当前进程已在 systemd scope 内，跳过 systemd-run 嵌套，` +
      `直接运行命令 (无额外内存限制)`
    );
  } else if (cfg.enabled && !hasCgroupV2Support()) {
    console.warn(
      `[spawn-utils] cgroup v2 不可用 (平台: ${os.platform()})，` +
      `直接运行命令 (无内存限制)`
    );
  }
  return execSync(command, options);
}
