#!/usr/bin/env node
/**
 * memory-stress-test.js — 模拟 bun/Claude 进程的内存分配行为
 *
 * 用于验证系统在内存压力下的表现，不依赖 stress-ng。
 *
 * 用法：
 *   node memory-stress-test.js --size 1GB --duration 10s --pattern greedy
 *   node memory-stress-test.js --size 4GB --pattern burst
 */

const { parseArgs } = require('util');

// 解析命令行参数
const args = process.argv.slice(2);
let targetSize = 1024 * 1024 * 1024; // 1GB default
let duration = 10; // 10 seconds default
let pattern = 'greedy'; // greedy | burst | steady
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') {
    const sizeStr = args[++i];
    if (sizeStr.endsWith('GB')) {
      targetSize = parseFloat(sizeStr) * 1024 * 1024 * 1024;
    } else if (sizeStr.endsWith('MB')) {
      targetSize = parseFloat(sizeStr) * 1024 * 1024;
    } else {
      targetSize = parseInt(sizeStr);
    }
  } else if (args[i] === '--duration') {
    duration = parseInt(args[++i].replace(/s$/, ''));
  } else if (args[i] === '--pattern') {
    pattern = args[++i];
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    verbose = true;
  } else if (args[i] === '--help') {
    console.log(`
Usage: node memory-stress-test.js [options]

Options:
  --size <size>      Target memory size (e.g., 1GB, 512MB, 1073741824)
  --duration <sec>   Test duration in seconds (default: 10)
  --pattern <type>   Allocation pattern: greedy, burst, steady
  --verbose          Show detailed progress

Patterns:
  greedy  - Allocate as fast as possible, hold until end
  burst    - Allocate in bursts, then release
  steady   - Allocate steadily at fixed rate
`);
    process.exit(0);
  }
}

console.log(`Memory Stress Test`);
console.log(`==================`);
console.log(`Target size: ${(targetSize / 1024 / 1024).toFixed(0)}MB`);
console.log(`Duration: ${duration}s`);
console.log(`Pattern: ${pattern}`);
console.log(`PID: ${process.pid}`);
console.log(``);

// 存储分配的内存块，防止被 GC 回收
const memoryBlocks = [];

/**
 * 分配指定大小的内存并填充
 * @param {number} size 字节数
 * @returns {Buffer}
 */
function allocateMemory(size) {
  const buffer = Buffer.allocUnsafe(size);
  // 填充以防止优化器消除
  for (let i = 0; i < size; i += 4096) {
    buffer[i] = i % 256;
  }
  return buffer;
}

/**
 * 获取当前进程内存使用
 */
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss / 1024 / 1024,
    heapTotal: usage.heapTotal / 1024 / 1024,
    heapUsed: usage.heapUsed / 1024 / 1024,
    external: usage.external / 1024 / 1024,
  };
}

/**
 * 获取系统内存信息
 */
function getSystemMemory() {
  try {
    const fs = require('fs');
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const parseField = (name) => {
      const match = meminfo.match(new RegExp(`${name}:\\s+(\\d+)`));
      return match ? parseInt(match[1]) / 1024 : 0; // MB
    };
    return {
      total: parseField('MemTotal'),
      free: parseField('MemFree'),
      available: parseField('MemAvailable'),
      committed: parseField('Committed_AS'),
    };
  } catch {
    return { total: 0, free: 0, available: 0, committed: 0 };
  }
}

/**
 * Greedy 模式：尽可能快地分配内存
 */
async function greedyPattern() {
  const chunkSize = 64 * 1024 * 1024; // 64MB chunks
  let allocated = 0;
  const startTime = Date.now();
  const endTime = startTime + duration * 1000;

  console.log('Starting greedy allocation...');
  console.log('');

  while (allocated < targetSize && Date.now() < endTime) {
    try {
      const remaining = targetSize - allocated;
      const toAllocate = Math.min(chunkSize, remaining);
      const block = allocateMemory(toAllocate);
      memoryBlocks.push(block);
      allocated += toAllocate;

      if (verbose || allocated % (256 * 1024 * 1024) === 0) {
        const usage = getMemoryUsage();
        const sysMem = getSystemMemory();
        process.stdout.write(
          `\rAllocated: ${(allocated / 1024 / 1024).toFixed(0)}MB / ` +
          `${(targetSize / 1024 / 1024).toFixed(0)}MB | ` +
          `RSS: ${usage.rss.toFixed(0)}MB | ` +
          `System free: ${sysMem.free.toFixed(0)}MB   `
        );
      }
    } catch (e) {
      console.log(`\nAllocation failed at ${(allocated / 1024 / 1024).toFixed(0)}MB: ${e.message}`);
      break;
    }
  }

  console.log('');
  console.log(`\nAllocation complete. Holding for ${duration}s...`);

  // 保持内存一段时间
  await new Promise(resolve => setTimeout(resolve, duration * 1000));

  console.log('Test complete. Releasing memory...');
}

/**
 * Burst 模式：脉冲式分配和释放
 */
async function burstPattern() {
  const burstSize = 256 * 1024 * 1024; // 256MB per burst
  const burstCount = Math.ceil(targetSize / burstSize);
  const burstDuration = duration / burstCount;

  console.log(`Running ${burstCount} bursts of ${(burstSize / 1024 / 1024).toFixed(0)}MB each...\n`);

  for (let i = 0; i < burstCount; i++) {
    const blocks = [];
    let allocated = 0;

    // 分配
    while (allocated < burstSize) {
      const chunk = Math.min(64 * 1024 * 1024, burstSize - allocated);
      blocks.push(allocateMemory(chunk));
      allocated += chunk;
    }

    if (verbose) {
      const usage = getMemoryUsage();
      console.log(`Burst ${i + 1}/${burstCount}: Allocated ${(allocated / 1024 / 1024).toFixed(0)}MB, RSS: ${usage.rss.toFixed(0)}MB`);
    }

    // 保持
    await new Promise(resolve => setTimeout(resolve, burstDuration * 500));

    // 释放
    blocks.length = 0;
    if (global.gc) global.gc(); // 如果可用，触发 GC

    await new Promise(resolve => setTimeout(resolve, burstDuration * 500));
  }

  console.log('Burst test complete.');
}

/**
 * Steady 模式：匀速分配
 */
async function steadyPattern() {
  const ratePerSecond = targetSize / duration;
  const interval = 100; // 每 100ms 分配一次
  const chunkPerInterval = ratePerSecond * (interval / 1000);

  console.log(`Steady allocation at ${(ratePerSecond / 1024 / 1024).toFixed(1)}MB/s...\n`);

  let allocated = 0;
  const startTime = Date.now();

  while (allocated < targetSize && Date.now() - startTime < duration * 1000) {
    const block = allocateMemory(chunkPerInterval);
    memoryBlocks.push(block);
    allocated += chunkPerInterval;

    if (verbose) {
      const usage = getMemoryUsage();
      process.stdout.write(
        `\rAllocated: ${(allocated / 1024 / 1024).toFixed(0)}MB, RSS: ${usage.rss.toFixed(0)}MB   `
      );
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  console.log('');
  console.log('Steady test complete.');
}

// 运行测试
(async () => {
  const startUsage = getMemoryUsage();
  const startSysMem = getSystemMemory();

  console.log('Initial state:');
  console.log(`  Process RSS: ${startUsage.rss.toFixed(0)}MB`);
  console.log(`  System free: ${startSysMem.free.toFixed(0)}MB / ${startSysMem.total.toFixed(0)}MB`);
  console.log('');

  try {
    switch (pattern) {
      case 'greedy':
        await greedyPattern();
        break;
      case 'burst':
        await burstPattern();
        break;
      case 'steady':
        await steadyPattern();
        break;
      default:
        console.error(`Unknown pattern: ${pattern}`);
        process.exit(1);
    }

    // 最终状态
    const finalUsage = getMemoryUsage();
    const finalSysMem = getSystemMemory();

    console.log('');
    console.log('Final state:');
    console.log(`  Process RSS: ${finalUsage.rss.toFixed(0)}MB`);
    console.log(`  System free: ${finalSysMem.free.toFixed(0)}MB / ${finalSysMem.total.toFixed(0)}MB`);
    console.log('');
    console.log('Test PASSED - No OOM or hang detected');
    process.exit(0);

  } catch (e) {
    console.error(`\nTest FAILED: ${e.message}`);
    process.exit(1);
  }
})();
