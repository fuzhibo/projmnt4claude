/**
 * batched-test-runner.ts — 分段测试运行器
 *
 * 核心原理：每次 bun test 调用是独立进程，进程退出后内存完全释放
 * （包括 ESM 缓存、mock 泄漏），无依赖 Bun GC 行为。
 *
 * 跨平台支持：
 * - Linux: 可选 cgroup 内存保护 (复用 spawn-utils)
 * - macOS/Windows: 进程级隔离（无需 cgroup）
 *
 * 用法：
 *   bun run src/scripts/batched-test-runner.ts              # 执行所有测试
 *   bun run src/scripts/batched-test-runner.ts --dry-run    # 预览分段计划
 *   bun run src/scripts/batched-test-runner.ts --ci         # CI 模式（保守配置）
 *   bun run src/scripts/batched-test-runner.ts --group 1    # 仅执行第 1 组
 *
 * @module batched-test-runner
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  hasCgroupV2Support,
  checkMemoryPressure,
} from '../utils/spawn-utils.js';

// ─── 类型定义 ───

interface BatchedTestConfig {
  groupSize: number;
  gcWaitSec: number;
  useSmol: boolean;
  timeoutSec: number;
  bail: boolean;
  memoryGB: number;
  useCgroup: boolean;
  targetGroup: number | null;
  dryRun: boolean;
  ci: boolean;
  verbose: boolean;
}

interface GroupResult {
  groupNum: number;
  fileCount: number;
  passed: boolean;
  duration: number;
  oomKilled: boolean;
  exitCode: number | null;
}

// ─── 默认配置 ───

const DEFAULT_CONFIG: BatchedTestConfig = {
  groupSize: 15,
  gcWaitSec: 2,
  useSmol: false,
  timeoutSec: 120,
  bail: true,
  memoryGB: 4,
  useCgroup: true,
  targetGroup: null,
  dryRun: false,
  ci: false,
  verbose: false,
};

const CI_CONFIG: Partial<BatchedTestConfig> = {
  groupSize: 10,
  gcWaitSec: 3,
  useSmol: true,
  timeoutSec: 180,
  bail: false,
};

// ─── 测试文件发现 ───

function findTestFiles(projectRoot: string): string[] {
  const testDirs = [
    path.join(projectRoot, 'src', '__tests__'),
    path.join(projectRoot, 'src', 'api', '__tests__'),
    path.join(projectRoot, 'src', 'utils'),
    path.join(projectRoot, 'src', 'components', '__tests__'),
  ];

  const files: string[] = [];
  const srcDir = path.join(projectRoot, 'src');

  for (const dir of testDirs) {
    if (!fs.existsSync(dir)) continue;
    collectTestFiles(dir, dir, files, srcDir);
  }

  return [...new Set(files)].sort();
}

function collectTestFiles(baseDir: string, currentDir: string, results: string[], srcDir: string): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      // 递归进入子目录查找 __tests__ 或直接包含 .test.ts 文件的目录
      collectTestFiles(baseDir, fullPath, results, srcDir);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      // 返回相对于 src 的路径（保持与 runTestGroup 一致）
      const relToSrc = path.relative(srcDir, fullPath);
      results.push(relToSrc);
    }
  }
}

// ─── cgroup v2 支持 (复用 spawn-utils) ───

function hasCgroupV2(): boolean {
  return hasCgroupV2Support();
}

function setCgroupOOMGroup(pid: number): void {
  try {
    const cgroupFile = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf-8');
    const v2Line = cgroupFile.trim().split('\n').find(l => l.startsWith('0::'));
    if (!v2Line) return;

    const cgroupPath = v2Line.split(':').slice(2).join(':');
    if (!cgroupPath) return;

    const oomGroupPath = path.join('/sys/fs/cgroup', cgroupPath, 'memory.oom.group');
    if (fs.existsSync(oomGroupPath)) {
      fs.writeFileSync(oomGroupPath, '1');
    }
  } catch {
    // 进程可能已退出或权限不足，静默失败
  }
}

// ─── 进程执行 ───

function runTestGroup(
  files: string[],
  config: BatchedTestConfig,
  projectRoot: string,
): Promise<GroupResult> {
  const startTime = Date.now();

  // 构建测试文件路径（文件路径已经是相对于 src 的）
  const testPaths = files.map(f => path.join('src', f));

  const bunArgs: string[] = [];
  if (config.useSmol) bunArgs.push('--smol');
  bunArgs.push('test', ...testPaths);

  const isLinux = os.platform() === 'linux';
  const useCgroupHere = isLinux && config.useCgroup && hasCgroupV2();

  // 启动前检查内存压力（仅 cgroup 模式）
  if (useCgroupHere) {
    const pressure = checkMemoryPressure();
    if (!pressure.ok) {
      console.warn(`  [WARN] ${pressure.message}`);
    }
  }

  return new Promise((resolve) => {
    let child: ChildProcess;

    if (useCgroupHere) {
      const systemdArgs = [
        '--user', '--scope',
        '-p', `MemoryMax=${config.memoryGB}G`,
        '-p', 'MemorySwapMax=0',
        '--',
        'bun',
        ...bunArgs,
      ];
      child = spawn('systemd-run', systemdArgs, {
        cwd: projectRoot,
        stdio: config.verbose ? 'inherit' : 'pipe',
      });

      child.on('spawn', () => {
        if (child.pid) setCgroupOOMGroup(child.pid);
      });
    } else {
      child = spawn('bun', bunArgs, {
        cwd: projectRoot,
        stdio: config.verbose ? 'inherit' : 'pipe',
      });

      if (isLinux && config.useCgroup && !hasCgroupV2()) {
        console.warn('  [WARN] cgroup v2 不可用，直接运行 (无内存限制)');
      }
    }

    let stdout = '';
    let stderr = '';

    if (!config.verbose && child.stdout) {
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    }
    if (!config.verbose && child.stderr) {
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    }

    // 超时保护：SIGKILL 后 close 事件会触发 resolve
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, config.timeoutSec * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);

      const duration = Math.round((Date.now() - startTime) / 1000);
      const output = stdout + stderr;

      // OOM 检测：exitCode 137 (SIGKILL + 128) 或输出包含 OOM 关键字
      const isOOM = code === 137 ||
        output.includes('Out of memory') ||
        output.includes('OOM') ||
        output.includes('Killed');

      if (!config.verbose && code !== 0) {
        // 失败时输出最后 50 行
        const lines = output.split('\n').filter(Boolean);
        const tail = lines.slice(-50).join('\n');
        if (tail) console.log(tail);
      }

      resolve({
        groupNum: 0, // 调用者设置
        fileCount: files.length,
        passed: code === 0,
        duration,
        oomKilled: isOOM,
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`  [ERROR] 执行失败: ${err.message}`);
      resolve({
        groupNum: 0,
        fileCount: files.length,
        passed: false,
        duration: 0,
        oomKilled: false,
        exitCode: null,
      });
    });
  });
}

// ─── 辅助函数 ───

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

// ─── 参数解析 ───

function parseCliArgs(): BatchedTestConfig {
  const { values } = parseArgs({
    options: {
      'group-size': { type: 'string', short: 'g' },
      'gc-wait': { type: 'string', short: 'w' },
      'smol': { type: 'boolean', short: 's' },
      'timeout': { type: 'string', short: 't' },
      'no-bail': { type: 'boolean' },
      'memory-gb': { type: 'string', short: 'm' },
      'no-cgroup': { type: 'boolean' },
      'group': { type: 'string' },
      'dry-run': { type: 'boolean' },
      'ci': { type: 'boolean' },
      'verbose': { type: 'boolean', short: 'v' },
      'help': { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositional: false,
  });

  if (values.help) {
    console.log(`
分段测试运行器 — 进程级内存隔离

用法:
  bun run src/scripts/batched-test-runner.ts [选项]

选项:
  -g, --group-size <N>   每组文件数 (默认: 15, CI: 10)
  -w, --gc-wait <N>      组间等待秒数 (默认: 2, CI: 3)
  -s, --smol             启用 bun --smol (降低内存峰值)
  -t, --timeout <N>      单组超时秒数 (默认: 120, CI: 180)
  --no-bail              失败后继续执行 (CI 默认)
  -m, --memory-gb <N>    cgroup 内存限制 GB (默认: 4)
  --no-cgroup            禁用 cgroup 保护
  --group <N>            仅执行第 N 组
  --dry-run              预览分段计划
  --ci                   CI 模式 (保守配置)
  -v, --verbose          显示详细输出
  -h, --help             显示帮助
`);
    process.exit(0);
  }

  const config = { ...DEFAULT_CONFIG };

  // CI 模式覆盖
  if (values.ci) {
    Object.assign(config, CI_CONFIG);
    config.ci = true;
  }

  // 命令行覆盖 + 参数验证
  if (values['group-size']) config.groupSize = Math.max(1, parseInt(values['group-size'] as string, 10));
  if (values['gc-wait']) config.gcWaitSec = Math.max(0, parseInt(values['gc-wait'] as string, 10));
  if (values.smol) config.useSmol = true;
  if (values.timeout) config.timeoutSec = Math.max(10, parseInt(values.timeout as string, 10));
  if (values['no-bail']) config.bail = false;
  if (values['memory-gb']) config.memoryGB = Math.max(1, parseInt(values['memory-gb'] as string, 10));
  if (values['no-cgroup']) config.useCgroup = false;
  if (values.group) {
    const g = parseInt(values.group as string, 10);
    if (Number.isNaN(g) || g < 1) {
      console.error(`无效的 --group 参数: ${values.group}`);
      process.exit(1);
    }
    config.targetGroup = g;
  }
  if (values['dry-run']) config.dryRun = true;
  if (values.verbose) config.verbose = true;

  return config;
}

// ─── 主逻辑 ───

async function main(): Promise<void> {
  const config = parseCliArgs();
  const projectRoot = process.cwd();

  // 收集测试文件
  const allFiles = findTestFiles(projectRoot);
  const totalFiles = allFiles.length;
  const totalGroups = Math.ceil(totalFiles / config.groupSize);

  if (totalFiles === 0) {
    console.log('未发现测试文件');
    process.exit(0);
  }

  const cgroupStatus = config.useCgroup && os.platform() === 'linux'
    ? (hasCgroupV2() ? `${config.memoryGB}GB` : '不可用(降级)')
    : '关闭';

  console.log('=== 分段测试计划 ===');
  console.log(`  总文件数: ${totalFiles}`);
  console.log(`  每组文件: ${config.groupSize}`);
  console.log(`  总组数: ${totalGroups}`);
  console.log(`  cgroup 保护: ${cgroupStatus}`);
  console.log(`  --smol: ${config.useSmol}`);
  console.log(`  超时: ${config.timeoutSec}s/组`);
  console.log(`  失败策略: ${config.bail ? '首败退出' : '收集全部失败'}`);
  console.log('');

  // dry-run 模式：仅输出分段计划
  if (config.dryRun) {
    console.log('--- DRY RUN: 分段预览 ---\n');
    for (let i = 0; i < totalGroups; i++) {
      const start = i * config.groupSize;
      const end = Math.min(start + config.groupSize, totalFiles);
      const groupFiles = allFiles.slice(start, end);
      console.log(`组 ${i + 1} (${groupFiles.length} 文件):`);
      groupFiles.forEach(f => console.log(`  - ${f}`));
      console.log('');
    }
    process.exit(0);
  }

  // 分段执行
  const results: GroupResult[] = [];
  const failedGroups: number[] = [];
  const oomGroups: number[] = [];

  for (let i = 0; i < totalGroups; i++) {
    const groupNum = i + 1;

    // 跳过非目标组
    if (config.targetGroup !== null && config.targetGroup !== groupNum) {
      continue;
    }

    const start = i * config.groupSize;
    const end = Math.min(start + config.groupSize, totalFiles);
    const groupFiles = allFiles.slice(start, end);

    console.log(`--- 组 ${groupNum}/${totalGroups} (${groupFiles.length} 文件) ---`);

    const result = await runTestGroup(groupFiles, config, projectRoot);
    result.groupNum = groupNum;
    results.push(result);

    if (result.passed) {
      console.log(`  ✅ 组 ${groupNum} 通过 (${formatDuration(result.duration)})`);
    } else if (result.oomKilled) {
      console.log(`  💀 组 ${groupNum} OOM Killed (${formatDuration(result.duration)})`);
      oomGroups.push(groupNum);
      failedGroups.push(groupNum);
    } else {
      console.log(`  ❌ 组 ${groupNum} 失败 (exit=${result.exitCode}, ${formatDuration(result.duration)})`);
      failedGroups.push(groupNum);
    }

    // 首败退出
    if (!result.passed && config.bail) {
      console.log(`  ⚠️  --bail 模式，终止后续执行`);
      break;
    }

    // 组间等待（让操作系统完全回收上一进程的内存）
    const isLastGroup = groupNum >= totalGroups ||
      (config.targetGroup !== null && config.targetGroup === groupNum);
    if (!isLastGroup) {
      console.log(`  ⏳ 等待 ${config.gcWaitSec}s (进程资源回收)...`);
      await sleep(config.gcWaitSec * 1000);
    }
  }

  // 汇总报告
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n=== 测试汇总 ===');
  console.log(`  通过: ${passCount}/${results.length} 组`);
  console.log(`  失败: ${failCount} 组`);
  if (oomGroups.length > 0) {
    console.log(`  OOM Killed: ${oomGroups.join(', ')}`);
  }
  if (failedGroups.length > 0 && oomGroups.length < failedGroups.length) {
    const nonOom = failedGroups.filter(g => !oomGroups.includes(g));
    console.log(`  测试失败: ${nonOom.join(', ')}`);
  }
  console.log(`  总耗时: ${formatDuration(totalDuration)}`);

  if (failCount > 0) {
    process.exit(1);
  }

  console.log('\n✅ 全部测试通过');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
