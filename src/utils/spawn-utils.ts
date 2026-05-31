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
 * @module spawn-utils
 * @see docs/investigation-oom/OOM-INVESTIGATION-REPORT.md
 */

import { spawn, execSync, type SpawnOptions, type ExecSyncOptions } from 'child_process';
import * as os from 'os';
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

// ─── spawn 封装 ───

/**
 * spawn 子进程。在支持 cgroup v2 的环境中自动添加内存限制。
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
  const cfg = getMemoryLimitConfig(options.cwd);

  if (cfg.enabled && hasCgroupV2Support()) {
    const maxGB = type === 'coverage' ? cfg.overrides.coverage
      : type === 'claudeAgent' ? cfg.overrides.claudeAgent
      : type === 'build' ? cfg.overrides.build
      : cfg.defaultGB;

    const wrappedArgs = [
      '--user', '--scope',
      '-p', `MemoryMax=${maxGB}G`,
      '--',
      command,
      ...args,
    ];
    return spawn('systemd-run', wrappedArgs, options);
  }

  // 降级：直接 spawn
  if (cfg.enabled && !hasCgroupV2Support()) {
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

  if (cfg.enabled && hasCgroupV2Support()) {
    const maxGB = type === 'coverage' ? cfg.overrides.coverage
      : type === 'claudeAgent' ? cfg.overrides.claudeAgent
      : type === 'build' ? cfg.overrides.build
      : cfg.defaultGB;

    // systemd-run --user --scope -p MemoryMax=N -- <command>
    // 注意：原始 command 可能包含 shell 重定向 (如 2>&1)，需要保留
    const wrappedCmd = [
      'systemd-run', '--user', '--scope',
      `-p`, `MemoryMax=${maxGB}G`,
      '--', command,
    ].join(' ');

    // execSync 使用 shell 模式执行包装后的命令
    return execSync(wrappedCmd, options);
  }

  // 降级：直接 execSync
  if (cfg.enabled && !hasCgroupV2Support()) {
    console.warn(
      `[spawn-utils] cgroup v2 不可用 (平台: ${os.platform()})，` +
      `直接运行命令 (无内存限制)`
    );
  }
  return execSync(command, options);
}
