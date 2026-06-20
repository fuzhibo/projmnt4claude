/**
 * headless-harness-design 命令
 *
 * 基于 Anthropic Harness Design 模式的任务执行命令
 *
 * 核心流程：
 * 1. Planner: 解析计划文件，生成任务执行列表
 * 2. Generator: 开发阶段 - 执行任务实现
 * 3. Evaluator: 审查阶段 - 独立验证结果
 *
 * 质量门禁（BUG-011-5）：
 * - --require-quality N: 质量分低于N时自动提示完善
 * - 方案验证检查点：任务开始前要求确认理解解决方案
 * - 影响文件清单：任务必须关联受影响文件列表
 * - 变更范围预估：标记 small/medium/large 变更
 *
 * 计划快照机制（CP-snapshot）：
 * - 流水线启动时创建计划快照（PlanSnapshot）
 * - 全流程读取快照而非 current-plan.json
 * - 正常退出时清理快照，异常时保留供诊断
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarnessConfig,
  ExecutionSummary,
  HarnessRuntimeState,
  PlanSnapshot,
} from '../types/harness.js';
import {
  DEFAULT_HARNESS_CONFIG,
  createDefaultRuntimeState,
} from '../types/harness.js';
import { isInitialized, getProjectDir } from '../utils/path.js';
import { t } from '../i18n/index.js';
import { AssemblyLine } from '../utils/hd-assembly-line.js';
import { HarnessReporter, evaluateSummaryConclusion } from '../utils/harness-reporter.js';
import {
  installExitHooks,
  uninstallExitHooks,
} from '../utils/harness-helpers.js';
import {
  listOrphanedSessions,
  cleanupOrphanedSessions,
} from '../utils/session-lock-cleanup.js';
import { sessionIdMapper } from '../utils/session-id-mapper.js';
import { readPlan, type ExecutionPlan } from '../utils/plan.js';
import { readTaskMeta } from '../utils/task.js';
import { normalizeStatus, TERMINAL_STATUSES } from '../types/task.js';
import { SEPARATOR_WIDTH } from '../utils/format';
import { recommendPlan } from './plan.js';
import {
  batchCheckQualityGate,
  formatBatchQualityGateResult,
  showQualityImprovementGuide,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
} from '../utils/quality-gate.js';
import {
  createPlanSnapshot,
  readPlanSnapshot,
  cleanupSnapshot,
  getCurrentProcessSnapshot,
  getLatestSnapshot,
  rebuildExecutionPlanFromSnapshot,
  validateSnapshot,
  detectActiveSnapshot,
  listSnapshots,
  isSnapshotActive,
} from '../utils/harness-snapshot.js';

/**
 * 批次感知的任务队列
 * 将 plan recommend 的批次分组数据转换为流水线可消费的结构
 */
export interface BatchAwareQueue {
  /** 扁平任务队列（向后兼容） */
  taskQueue: string[];
  /** 批次边界索引列表，例如 [0, 3, 7] 表示批次1=[0,3), 批次2=[3,7) */
  batchBoundaries: number[];
  /** 批次标签列表，与 batchBoundaries 一一对应 */
  batchLabels: string[];
  /** 批次内是否可并行，与 batchBoundaries 一一对应 */
  batchParallelizable: boolean[];
}

/** 当前流水线计划快照ID（用于清理） */
let currentSnapshotId: string | null = null;

/**
 * 从 ExecutionPlan 的 batches 数据构建 BatchAwareQueue
 *
 * 将 plan.batches（string[][]，按优先级分桶的任务ID二维数组）
 * 转换为基于索引的 batchBoundaries + batchLabels，供流水线消费
 */
export function buildBatchAwareQueue(
  taskQueue: string[],
  batches?: string[][]
): BatchAwareQueue {
  if (!batches || batches.length === 0) {
    return {
      taskQueue,
      batchBoundaries: [],
      batchLabels: [],
      batchParallelizable: [],
    };
  }

  const batchBoundaries: number[] = [];
  const batchLabels: string[] = [];
  const batchParallelizable: boolean[] = [];
  let offset = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    batchBoundaries.push(offset);
    batchLabels.push(`Batch ${i + 1}`);
    // 多个任务且超过1条链时标记为可并行
    batchParallelizable.push(batch.length > 1);
    offset += batch.length;
  }

  return { taskQueue, batchBoundaries, batchLabels, batchParallelizable };
}

/**
 * 从 batchBoundaries 重建 batches 数组
 *
 * 反向操作：将 batchBoundaries + taskQueue 转换回 batches 二维数组
 * 例如：boundaries=[0,3,7], taskQueue=[a,b,c,d,e,f,g,h] -> [[a,b,c],[d,e,f,g],[h]]
 */
function rebuildBatchesFromBoundaries(batchQueue: BatchAwareQueue): string[][] {
  const { taskQueue, batchBoundaries } = batchQueue;

  if (batchBoundaries.length === 0) {
    return [taskQueue];
  }

  const batches: string[][] = [];
  for (let i = 0; i < batchBoundaries.length; i++) {
    const start = batchBoundaries[i]!;
    const end = i + 1 < batchBoundaries.length ? batchBoundaries[i + 1]! : taskQueue.length;
    batches.push(taskQueue.slice(start, end));
  }

  return batches;
}

/**
 * 命令选项
 */
export interface HarnessCommandOptions {
  plan?: string;
  maxRetries?: string;
  timeout?: string;
  parallel?: string;
  dryRun?: boolean;
  continue?: boolean;
  json?: boolean;
  /** 最低质量分阈值 (0-100) */
  requireQuality?: string;
  /** 跳过质量门禁检查 */
  skipQualityGate?: boolean;  // 已弃用，保持向后兼容
  /** 跳过 Harness 执行前质量门禁检查 (--skip-harness-gate) */
  skipHarnessGate?: boolean;
  /** 每个批次完成后自动 git tag + commit */
  batchGitTagCommit?: boolean;
  /** 每个任务完成后自动 git commit */
  taskGitCommit?: boolean;
  /** 跳过基础字段验证失败时的流水线阻塞 */
  forceContinue?: boolean;
  /** 启用调试模式，输出详细日志 (--debug) */
  debug?: boolean;
}

/**
 * Harness 清理命令选项
 */
export interface HarnessCleanupOptions {
  /** 仅清理孤儿快照（进程已不存在的） */
  orphansOnly?: boolean;
  /** 强制清理所有快照 */
  force?: boolean;
}

/**
 * 清理 Harness 快照
 *
 * @param options - 清理选项
 * @param cwd - 工作目录
 * @returns 清理的快照数量
 */
export async function cleanupHarnessSnapshots(
  options: HarnessCleanupOptions = {},
  cwd: string = process.cwd()
): Promise<number> {
  const texts = t(cwd);
  if (!isInitialized(cwd)) {
    console.error(texts.harnessCmd.projectNotInitialized);
    process.exit(1);
  }

  const snapshots = listSnapshots(cwd);

  if (snapshots.length === 0) {
    console.log(texts.harnessCmd.noSnapshotsFound);
    return 0;
  }

  let cleaned = 0;
  const activeSnapshots: PlanSnapshot[] = [];
  const orphanSnapshots: PlanSnapshot[] = [];

  // 分类快照
  for (const snapshot of snapshots) {
    if (isSnapshotActive(snapshot, cwd)) {
      activeSnapshots.push(snapshot);
    } else {
      orphanSnapshots.push(snapshot);
    }
  }

  // Clean up orphan snapshots
  for (const snapshot of orphanSnapshots) {
    if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
      cleaned++;
      console.log(texts.harnessCmd.cleaningOrphanSnapshots.replace('{id}', snapshot.snapshotId).replace('{pid}', String(snapshot.pid)));
    }
  }

  // Force clean active snapshots if requested
  if (options.force && !options.orphansOnly) {
    for (const snapshot of activeSnapshots) {
      if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
        cleaned++;
        console.log(texts.harnessCmd.forceCleanedSnapshots.replace('{id}', snapshot.snapshotId).replace('{pid}', String(snapshot.pid)));
      }
    }
  }

  // Output active pipeline info
  if (activeSnapshots.length > 0 && !options.force) {
    console.log(`\n⚠️  Found ${activeSnapshots.length} active pipeline snapshots (process still running):`);
    for (const snapshot of activeSnapshots) {
      console.log(`   - ${snapshot.snapshotId} (PID: ${snapshot.pid}, created at ${snapshot.timestamp})`);
    }
    console.log('\n💡 Use --force to clean all snapshots, or wait for active pipelines to complete');
  }

  console.log(texts.harnessCmd.cleanedSnapshots.replace('{count}', String(cleaned)));
  return cleaned;
}

/**
 * 检查并发并报告
 *
 * @param cwd - 工作目录
 * @returns 是否存在活跃流水线
 */
function checkConcurrency(cwd: string): boolean {
  const detection = detectActiveSnapshot(cwd);
  const texts = t(cwd);

  if (detection.hasActive && detection.activeSnapshot) {
    console.error('');
    console.error(texts.harnessCmd.concurrentPipelineRunning);
    console.error('');
    console.error(texts.harnessCmd.activePipelineInfo);
    console.error(texts.harnessCmd.snapshotId.replace('{id}', detection.activeSnapshot.snapshotId));
    console.error(texts.harnessCmd.processId.replace('{pid}', String(detection.activeSnapshot.pid)));
    console.error(texts.harnessCmd.createdAt.replace('{timestamp}', detection.activeSnapshot.timestamp));
    console.error(texts.harnessCmd.taskCount.replace('{count}', String(detection.activeSnapshot.tasks.length)));
    console.error('');
    console.error(texts.harnessCmd.possibleCauses);
    console.error('   1. Another Harness pipeline is running');
    console.error('   2. Previous pipeline exited abnormally, leaving snapshot behind');
    console.error('');
    console.error(texts.harnessCmd.solutions);
    console.error('   - If no other pipeline is running, clean up with:');
    console.error('     projmnt4claude headless-harness-design cleanup');
    console.error('   - Or force clean all residual snapshots:');
    console.error('     projmnt4claude headless-harness-design cleanup --force');
    console.error('');
    return true;
  }

  return false;
}

/**
 * 主命令入口
 */
export async function harnessCommand(
  options: HarnessCommandOptions,
  cwd: string = process.cwd()
): Promise<void> {
  const texts = t(cwd);
  // Check project initialization
  if (!isInitialized(cwd)) {
    console.error(texts.harnessCmd.projectNotInitialized);
    process.exit(1);
  }

  // CP-concurrency: 启动前检查并发
  // 注意: --continue 模式下允许并发（恢复执行）
  if (!options.continue && checkConcurrency(cwd)) {
    process.exit(1);
  }

  // 构建质量门禁配置
  const qualityGateConfig: QualityGateConfig = {
    ...DEFAULT_QUALITY_GATE_CONFIG,
    minQualityScore: options.requireQuality
      ? parseInt(options.requireQuality, 10)
      : DEFAULT_QUALITY_GATE_CONFIG.minQualityScore,
    enabled: !(options.skipHarnessGate || options.skipQualityGate),
  };

  // Validate quality score threshold
  if (qualityGateConfig.minQualityScore < 0 || qualityGateConfig.minQualityScore > 100) {
    console.error('Error: --require-quality must be between 0-100');
    process.exit(1);
  }

  // 构建配置
  const config: HarnessConfig = {
    ...DEFAULT_HARNESS_CONFIG,
    maxRetries: options.maxRetries ? parseInt(options.maxRetries, 10) : DEFAULT_HARNESS_CONFIG.maxRetries,
    timeout: options.timeout ? parseInt(options.timeout, 10) : DEFAULT_HARNESS_CONFIG.timeout,
    parallel: options.parallel ? parseInt(options.parallel, 10) : DEFAULT_HARNESS_CONFIG.parallel,
    dryRun: options.dryRun ?? DEFAULT_HARNESS_CONFIG.dryRun,
    continue: options.continue ?? DEFAULT_HARNESS_CONFIG.continue,
    jsonOutput: options.json ?? DEFAULT_HARNESS_CONFIG.jsonOutput,
    batchGitTagCommit: options.batchGitTagCommit ?? DEFAULT_HARNESS_CONFIG.batchGitTagCommit,
    taskGitCommit: options.taskGitCommit ?? DEFAULT_HARNESS_CONFIG.taskGitCommit,
    forceContinue: options.forceContinue ?? DEFAULT_HARNESS_CONFIG.forceContinue,
    debug: options.debug ?? DEFAULT_HARNESS_CONFIG.debug,
    cwd,
  };

  // Validate config
  if (config.maxRetries < 0) {
    console.error(texts.harnessCmd.invalidMaxRetries);
    process.exit(1);
  }
  if (config.timeout < 10) {
    console.error(texts.harnessCmd.invalidTimeout);
    process.exit(1);
  }
  if (config.parallel < 1) {
    console.error(texts.harnessCmd.invalidParallel);
    process.exit(1);
  }

  // Load task queue - 3-level priority
  const batchQueue = await loadTaskQueue(options, cwd);

  if (batchQueue.taskQueue.length === 0) {
    console.error('Error: No executable tasks');
    process.exit(1);
  }

  const hasBatches = batchQueue.batchBoundaries.length > 0;

  // Output configuration info
  if (!config.jsonOutput) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🚀 Harness Design Execution Mode');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`📋 Plan file: ${options.plan}`);
    console.log(`📊 Task count: ${batchQueue.taskQueue.length}`);
    if (hasBatches) {
      console.log(`📦 Batch count: ${batchQueue.batchBoundaries.length}`);
    }
    console.log(`🔄 Max retries: ${config.maxRetries}`);
    console.log(`⏱️  Timeout: ${config.timeout}s`);
    console.log(`🔀 Parallel: ${config.parallel}`);
    console.log(`🧪 Dry run: ${config.dryRun ? 'Yes' : 'No'}`);
    console.log(`▶️  Continue: ${config.continue ? 'Yes' : 'No'}`);
    if (config.batchGitTagCommit) {
      console.log(`🏷️  Batch git tag+commit: Yes`);
    }
    console.log('');
  }

  // Dry run mode
  if (config.dryRun) {
    console.log('📝 Dry run mode - Tasks to be executed:');
    if (hasBatches) {
      // Show grouped by batch
      for (let b = 0; b < batchQueue.batchBoundaries.length; b++) {
        const start = batchQueue.batchBoundaries[b]!;
        const end = b + 1 < batchQueue.batchBoundaries.length
          ? batchQueue.batchBoundaries[b + 1]!
          : batchQueue.taskQueue.length;
        const label = texts.harnessCmd.batchLabel.replace('{index}', String(b + 1));
        const parallelTag = batchQueue.batchParallelizable[b!] ? ' [Parallel]' : '';
        console.log(`\n   📦 ${label}${parallelTag} (${end - start} tasks):`);
        for (let i = start; i < end; i++) {
          console.log(`      ${i + 1}. ${batchQueue.taskQueue[i]!}`);
        }
      }
    } else {
      batchQueue.taskQueue.forEach((taskId, index) => {
        console.log(`   ${index + 1}. ${taskId}`);
      });
    }
    console.log('');
    console.log(texts.harnessCmd.dryRunComplete);
    return;
  }

  // Quality gate check (BUG-011-5)
  if (qualityGateConfig.enabled) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(texts.harnessCmd.qualityGateCheck);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(texts.harnessCmd.minQualityScoreThreshold.replace('{score}', String(qualityGateConfig.minQualityScore)));
    console.log('');

    const batchResult = await batchCheckQualityGate(batchQueue.taskQueue, qualityGateConfig, cwd);

    // 输出检查结果
    console.log(formatBatchQualityGateResult(batchResult, { compact: false, showDetails: true }));

    if (!batchResult.allPassed) {
      console.log('');
      console.log(texts.harnessCmd.qualityGateFailed);
      console.log('');

      for (const taskId of batchResult.blockedTasks) {
        const result = batchResult.results.get(taskId);
        if (result) {
          showQualityImprovementGuide(result);
        }
      }

      console.log('');
      console.log('💡 Tips:');
      console.log('   1. Improve task description, add "## Problem", "## Root Cause", "## Solution" sections');
      console.log('   2. List affected source files in "## Related Files" section');
      console.log('   3. Use specific checkpoint descriptions, avoid generic ones like "core feature implementation"');
      console.log('   4. Use --skip-harness-gate to skip quality check (not recommended)');
      console.log('   5. Use --require-quality N to adjust quality threshold (default 60)');
      console.log('');
      process.exit(1);
    }

    console.log(texts.harnessCmd.allTasksPassed);
    console.log('');
  }

  // CP-3: 流水线启动时创建计划快照
  const executionPlan: ExecutionPlan = {
    tasks: batchQueue.taskQueue,
    batches: batchQueue.batchBoundaries.length > 0 ? rebuildBatchesFromBoundaries(batchQueue) : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const snapshot = createPlanSnapshot(executionPlan, cwd, {
    batchBoundaries: batchQueue.batchBoundaries,
    batchLabels: batchQueue.batchLabels,
    batchParallelizable: batchQueue.batchParallelizable,
  });
  currentSnapshotId = snapshot.snapshotId;
  console.log(`   💾 Plan snapshot created: ${snapshot.snapshotId} (${snapshot.tasks.length} tasks)`);

  // 创建 AssemblyLine 并执行
  const assemblyLine = new AssemblyLine(config);
  const reporter = new HarnessReporter(config);

  // CP-03: 安装进程退出钩子（SIGTERM/SIGINT/SIGHUP/exit）
  // 在主进程退出前清理子进程 + session-env 孤儿锁，避免 "Session ID already in use"
  const knownCliUuids = new Set<string>();
  if (assemblyLine.currentSessionId) {
    knownCliUuids.add(assemblyLine.currentSessionId);
  }
  installExitHooks(knownCliUuids);

  // CP-04: 启动前扫描并清理孤儿 session-env 锁目录（崩溃残留兜底）
  // 当前 mapper 已知 UUID 跳过；其他历史残留全部清理
  const knownFromMapper = new Set<string>();
  for (const mapping of sessionIdMapper.serialize()) {
    knownFromMapper.add(mapping.cliUuid);
  }
  if (assemblyLine.currentSessionId) {
    knownFromMapper.add(assemblyLine.currentSessionId);
  }
  const preOrphans = listOrphanedSessions(knownFromMapper);
  if (preOrphans.length > 0) {
    const cleaned = cleanupOrphanedSessions(preOrphans);
    console.log(`   🧹 Pre-pipeline cleanup: removed ${cleaned} orphan session-env lock(s)`);
  }

  // BUG-014-2: 流水线完成标志 & 信号防重入
  let pipelineCompleted = false;
  let shutdownInProgress = false;

  const gracefulShutdown = (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);

    // SYS-ORPHAN-2026-006: 先 SIGTERM 所有子进程，避免孤儿进程累积
    assemblyLine.killAllChildren('SIGTERM');

    // 给子进程 3 秒清理时间，然后 SIGKILL 兜底
    setTimeout(() => {
      assemblyLine.killAllChildren('SIGKILL');
      assemblyLine.forceFailStatus(new Error(`Received ${signal}, pipeline interrupted`));
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }, 3000);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  try {
    // Load or create runtime state
    let state: HarnessRuntimeState | null;
    if (config.continue) {
      state = loadRuntimeState(cwd);
      if (state) {
        // CP-4: Try to restore plan from snapshot (ensure using plan version at creation time)
        const latestSnapshot = getLatestSnapshot(cwd);
        if (latestSnapshot) {
          console.log(texts.harnessCmd.resumingFromInterruption
            .replace('{current}', String(state.currentIndex + 1))
            .replace('{total}', String(state.taskQueue.length)));
          console.log(`   💾 Using plan snapshot: ${latestSnapshot.snapshotId}`);
          // Restore plan data from snapshot (if plan data in state is incomplete)
          if (latestSnapshot.tasks.length > 0 && state.taskQueue.length === 0) {
            state.taskQueue = latestSnapshot.tasks;
            state.batchBoundaries = latestSnapshot.batchBoundaries || [];
            state.batchLabels = latestSnapshot.batchLabels || [];
            state.batchParallelizable = latestSnapshot.batchParallelizable || [];
          }
        } else {
          console.log(texts.harnessCmd.resumingFromInterruption
            .replace('{current}', String(state.currentIndex + 1))
            .replace('{total}', String(state.taskQueue.length)));
        }
      } else {
        console.log(texts.harnessCmd.noPreviousState);
        state = createDefaultRuntimeState(config);
        state.taskQueue = batchQueue.taskQueue;
        state.batchBoundaries = batchQueue.batchBoundaries;
        state.batchLabels = batchQueue.batchLabels;
        state.batchParallelizable = batchQueue.batchParallelizable;
      }
    } else {
      state = createDefaultRuntimeState(config);
      state.taskQueue = batchQueue.taskQueue;
      state.batchBoundaries = batchQueue.batchBoundaries;
      state.batchLabels = batchQueue.batchLabels;
      state.batchParallelizable = batchQueue.batchParallelizable;
    }

    // 执行流水线
    const summary = await assemblyLine.run(state);
    pipelineCompleted = true;

    // 生成报告
    await reporter.generateSummaryReport(summary);

    // 输出结果
    if (config.jsonOutput) {
      console.log(JSON.stringify(summaryToJSON(summary), null, 2));
    } else {
      printSummary(summary);
    }

  } catch (error) {
    assemblyLine.forceFailStatus(error);
    console.error('❌ Execution failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // Only clean up runtime state when pipeline completes normally (preserve --continue recovery)
    if (pipelineCompleted) {
      clearRuntimeState(cwd);
    }
    // CP-5: Clean up snapshot on pipeline exit (clean on normal, keep on error for diagnosis)
    if (currentSnapshotId && pipelineCompleted) {
      if (cleanupSnapshot(currentSnapshotId, cwd)) {
        console.log(`   🧹 Plan snapshot cleaned: ${currentSnapshotId}`);
      }
      currentSnapshotId = null;
    } else if (currentSnapshotId) {
      // Keep snapshot on abnormal exit, but output path for diagnosis
      console.log(`   💾 Plan snapshot kept for diagnosis: .projmnt4claude/runs/${currentSnapshotId}`);
    }
    // Remove signal handlers
    process.removeListener('SIGINT', gracefulShutdown);
    process.removeListener('SIGTERM', gracefulShutdown);
    // CP-03: 卸载退出钩子，避免泄漏到后续命令
    uninstallExitHooks();
  }
}

/**
 * 运行时状态文件路径
 */
function getRuntimeStatePath(cwd: string): string {
  return path.join(getProjectDir(cwd), 'harness-state.json');
}

/**
 * 状态验证错误类型
 */
export interface StateValidationError {
  field: string;
  expected: string;
  actual: string;
  severity: 'error' | 'warning';
}

/**
 * 状态验证结果
 */
export interface StateValidationResult {
  valid: boolean;
  errors: StateValidationError[];
  repaired: boolean;
  repairedFields: string[];
}

/**
 * 验证并修复运行时状态
 * CP-P16: 状态验证与修复机制 - 确保状态完整性
 */
function validateAndRepairState(
  data: Record<string, unknown>,
  cwd: string
): { data: HarnessRuntimeState | null; validation: StateValidationResult } {
  const errors: StateValidationError[] = [];
  const repairedFields: string[] = [];
  let repaired = false;

  const texts = t(cwd);

  // 必需字段检查
  const requiredFields: Array<{ field: string; type: string }> = [
    { field: 'state', type: 'string' },
    { field: 'config', type: 'object' },
    { field: 'taskQueue', type: 'array' },
    { field: 'currentIndex', type: 'number' },
    { field: 'startTime', type: 'string' },
    { field: 'updatedAt', type: 'string' },
  ];

  for (const { field, type } of requiredFields) {
    if (!(field in data)) {
      errors.push({
        field,
        expected: type,
        actual: 'missing',
        severity: 'error',
      });
    } else if (type === 'array' && !Array.isArray(data[field])) {
      errors.push({
        field,
        expected: type,
        actual: typeof data[field],
        severity: 'error',
      });
    } else if (type !== 'array' && typeof data[field] !== type) {
      errors.push({
        field,
        expected: type,
        actual: typeof data[field],
        severity: 'error',
      });
    }
  }

  // 如果有严重错误，返回 null（需要重新开始）
  if (errors.some(e => e.severity === 'error')) {
    console.warn(texts.harnessCmd.stateValidationFailed.replace('{errors}', errors.map(e => `${e.field}(${e.actual})`).join(', ')));
    return {
      data: null,
      validation: { valid: false, errors, repaired: false, repairedFields },
    };
  }

  // 修复/初始化可选字段

  // 1. 修复 Map 字段（从 plain object 恢复）
  const mapFields = [
    'retryCounter',
    'taskResults',
    'resumeFrom',
    'phaseRetryCounters',
    'taskPhaseCheckpoints',
    'failureHistory',
    'phaseCheckpoints',
  ];

  for (const field of mapFields) {
    if (!(field in data) || data[field] === null || data[field] === undefined) {
      data[field] = {};
      repairedFields.push(field);
      repaired = true;
    }

    // 转换 plain object 到 Map
    if (data[field] && typeof data[field] === 'object' && !(data[field] instanceof Map)) {
      try {
        data[field] = new Map(Object.entries(data[field] as Record<string, unknown>));
      } catch (e) {
        console.warn(`Failed to convert ${field} to Map, using empty Map`);
        data[field] = new Map();
        repairedFields.push(field);
        repaired = true;
      }
    }
  }

  // 2. 修复数组字段
  const arrayFields = ['passedTasks', 'failedTasks', 'retryingTasks', 'readyTasks', 'preCheckFailedTasks'];
  for (const field of arrayFields) {
    if (!(field in data) || !Array.isArray(data[field])) {
      data[field] = [];
      repairedFields.push(field);
      repaired = true;
    }
  }

  // 3. 修复批次相关字段
  if (!('batchBoundaries' in data) || !Array.isArray(data.batchBoundaries)) {
    data.batchBoundaries = [];
    repairedFields.push('batchBoundaries');
    repaired = true;
  }

  if (!('batchLabels' in data) || !Array.isArray(data.batchLabels)) {
    data.batchLabels = [];
    repairedFields.push('batchLabels');
    repaired = true;
  }

  if (!('batchParallelizable' in data) || !Array.isArray(data.batchParallelizable)) {
    data.batchParallelizable = [];
    repairedFields.push('batchParallelizable');
    repaired = true;
  }

  // 4. 修复布尔字段
  if (typeof data.preCheckCompleted !== 'boolean') {
    data.preCheckCompleted = false;
    repairedFields.push('preCheckCompleted');
    repaired = true;
  }

  // 5. 修复 pendingPreCheckTasks
  if (!('pendingPreCheckTasks' in data) || !Array.isArray(data.pendingPreCheckTasks)) {
    data.pendingPreCheckTasks = [];
    repairedFields.push('pendingPreCheckTasks');
    repaired = true;
  }

  // 6. 修复 pendingExecutionTasks
  if (!('pendingExecutionTasks' in data) || !Array.isArray(data.pendingExecutionTasks)) {
    data.pendingExecutionTasks = [];
    repairedFields.push('pendingExecutionTasks');
    repaired = true;
  }

  // 7. 修复 config 字段
  if (typeof data.config === 'object' && data.config !== null) {
    const config = data.config as Record<string, unknown>;
    const configDefaults: Record<string, unknown> = {
      maxRetries: 3,
      timeout: 300,
      parallel: 1,
      dryRun: false,
      continue: false,
      jsonOutput: false,
      batchGitTagCommit: false,
      forceContinue: false,
    };

    for (const [key, defaultValue] of Object.entries(configDefaults)) {
      if (!(key in config) || config[key] === undefined || config[key] === null) {
        config[key] = defaultValue;
        repairedFields.push(`config.${key}`);
        repaired = true;
      }
    }

    // 确保 cwd 被正确设置
    if (!config.cwd || typeof config.cwd !== 'string') {
      config.cwd = cwd;
      repairedFields.push('config.cwd');
      repaired = true;
    }
  }

  // 8. 验证 currentIndex 范围（仅修复负值）
  // 注意：currentIndex 可能大于 taskQueue.length（例如所有任务已完成后的状态）
  if (typeof data.currentIndex === 'number' && data.currentIndex < 0) {
    data.currentIndex = 0;
    repairedFields.push('currentIndex');
    repaired = true;
  }

  // 9. 验证 state 字段值
  const validStates = ['idle', 'running', 'pre_checking', 'executing', 'paused', 'completed', 'failed', 'cancelled'];
  if (!validStates.includes(data.state as string)) {
    console.warn(`Invalid state value "${data.state}", resetting to 'idle'`);
    data.state = 'idle';
    repairedFields.push('state');
    repaired = true;
  }

  // 10. P5 向后兼容：移除旧状态文件中的 reevaluateCounter 字段
  if ('reevaluateCounter' in data) {
    delete data.reevaluateCounter;
  }

  // 输出修复信息
  if (repaired && repairedFields.length > 0) {
    console.log(`📦 State file repaired: ${repairedFields.length} fields fixed (${repairedFields.slice(0, 5).join(', ')}${repairedFields.length > 5 ? '...' : ''})`);
  }

  return {
    data: data as HarnessRuntimeState,
    validation: { valid: true, errors, repaired, repairedFields },
  };
}

/**
 * 加载运行时状态
 * CP-P16: 支持 Continue 功能的状态加载
 *
 * 功能：
 * 1. 从文件系统读取保存的状态
 * 2. 状态验证与修复机制
 * 3. 版本迁移支持 (v1 → v2)
 * 4. Map 字段恢复
 */
export function loadRuntimeState(cwd: string): HarnessRuntimeState | null {
  const statePath = getRuntimeStatePath(cwd);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  const texts = t(cwd);

  try {
    const content = fs.readFileSync(statePath, 'utf-8');

    // 检查空文件
    if (!content.trim()) {
      console.warn(texts.harnessCmd.emptyStateFile);
      return null;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      console.warn(texts.harnessCmd.invalidStateFileFormat.replace('{error}', String(parseError)));
      return null;
    }

    // 验证基础结构
    if (!data || typeof data !== 'object') {
      console.warn(texts.harnessCmd.invalidStateStructure);
      return null;
    }

    // 版本检查和自动迁移
    const version = data.stateFormatVersion ?? 0;
    if (version < 1 || version > 2) {
      console.warn(`State file version mismatch (v${version}), resetting runtime state`);
      return null;
    }

    // v1 → v2 自动迁移
    if (version === 1) {
      data.stateFormatVersion = 2;
      console.log(texts.harnessCmd.stateFileMigrated.replace('{from}', '1').replace('{to}', '2'));
    }

    // 状态验证与修复
    const { data: validatedData, validation } = validateAndRepairState(data, cwd);

    if (!validatedData) {
      console.warn(texts.harnessCmd.stateRepairFailed);
      return null;
    }

    // 输出验证结果（调试用）
    if (process.env.DEBUG_HARNESS) {
      console.log('State validation:', {
        valid: validation.valid,
        repaired: validation.repaired,
        repairedFields: validation.repairedFields,
        errors: validation.errors,
      });
    }

    return validatedData;
  } catch (error) {
    // 降级处理：记录错误但返回 null 而不是抛出异常
    console.warn(texts.harnessCmd.loadingStateFailed.replace('{error}', String(error)));
    return null;
  }
}

/**
 * 保存运行时状态
 */
export function saveRuntimeState(state: HarnessRuntimeState, cwd: string): void {
  const statePath = getRuntimeStatePath(cwd);
  const data = {
    ...state,
    // 版本标记：便于未来版本演进时识别状态文件格式
    // v2: wait_evaluation 状态支持
    stateFormatVersion: 2,
    retryCounter: Object.fromEntries(state.retryCounter),
    resumeFrom: Object.fromEntries(state.resumeFrom || []),
    // 修复：添加 phaseRetryCounters 保存
    phaseRetryCounters: Object.fromEntries(state.phaseRetryCounters || []),
    taskPhaseCheckpoints: Object.fromEntries(state.taskPhaseCheckpoints || []),
  };
  fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 清理运行时状态
 */
function clearRuntimeState(cwd: string): void {
  const statePath = getRuntimeStatePath(cwd);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

/**
 * 将摘要转换为 JSON 可序列化格式
 */
function summaryToJSON(summary: ExecutionSummary): Record<string, unknown> {
  return {
    totalTasks: summary.totalTasks,
    passed: summary.passed,
    failed: summary.failed,
    totalRetries: summary.totalRetries,
    duration: summary.duration,
    startTime: summary.startTime,
    endTime: summary.endTime,
    config: summary.config,
    taskResults: Object.fromEntries(
      Array.from(summary.taskResults.entries()).map(([taskId, record]) => [
        taskId,
        {
          taskId: record.taskId,
          retryCount: record.retryCount,
          finalStatus: record.finalStatus,
          devStatus: record.devReport.status,
          reviewResult: record.reviewVerdict?.result,
        },
      ])
    ),
  };
}

/**
 * 加载任务队列 - 3级优先级（批次感知版）
 *
 * 优先级1: 显式指定的文件（--plan）
 * 优先级2: 读取项目计划（.projmnt4claude/current-plan.json）
 * 优先级3: 自动生成计划
 */
async function loadTaskQueue(options: HarnessCommandOptions, cwd: string): Promise<BatchAwareQueue> {
  // 优先级1: 显式指定的文件
  if (options.plan) {
    const planFile = path.resolve(cwd, options.plan);
    if (!fs.existsSync(planFile)) {
      console.error(`Error: Plan file does not exist: ${planFile}`);
      process.exit(1);
    }

    try {
      const planContent = fs.readFileSync(planFile, 'utf-8');
      const planData = JSON.parse(planContent);
      let taskQueue: string[] = planData.recommendation?.suggestedOrder || [];
      const batches: string[][] | undefined = planData.batchOrder || planData.batches;

      if (taskQueue.length === 0) {
        console.error('Error: No tasks in plan file');
        process.exit(1);
      }

      // CP-19: Only filter terminal state tasks, trust plan sorting for dependencies
      const TERMINAL_STATUSES_SET = new Set(TERMINAL_STATUSES);
      const originalCount = taskQueue.length;
      taskQueue = taskQueue.filter((id: string) => {
        const task = readTaskMeta(id, cwd);
        if (!task) return false;
        return !TERMINAL_STATUSES_SET.has(normalizeStatus(task.status));
      });
      if (originalCount - taskQueue.length > 0) {
        console.log(`Using plan file: ${options.plan} (filtered ${originalCount - taskQueue.length} terminal tasks)`);
      } else {
        console.log(`Using plan file: ${options.plan}`);
      }

      return buildBatchAwareQueue(taskQueue, batches);
    } catch (error) {
      console.error(`Error: Cannot parse plan file: ${planFile}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // Priority 2: Read project plan
  const executionPlan = readPlan(cwd);
  if (executionPlan && executionPlan.tasks.length > 0) {
    const queue = filterExecutableFromPlan(executionPlan, cwd, '📋 Using project execution plan');
    if (queue.taskQueue.length > 0) {
      return queue;
    }
    console.log('⚠️  All tasks in execution plan are in terminal state');
  }

  // Priority 3: Auto-generate
  console.log('🔍 No execution plan found, auto-generating...');

  try {
    await recommendPlan({ nonInteractive: true, json: false }, cwd);

    const newPlan = readPlan(cwd);
    if (newPlan && newPlan.tasks.length > 0) {
      const queue = filterExecutableFromPlan(newPlan, cwd, '✅ Execution plan auto-generated');
      if (queue.taskQueue.length > 0) {
        return queue;
      }
    }
  } catch (error) {
    console.error('Warning: Auto-generate plan failed:', error instanceof Error ? error.message : String(error));
  }

  console.error('Error: Cannot get task list');
  console.error('Hint: Please run `projmnt4claude plan recommend` to generate execution plan');
  process.exit(1);
}

/**
 * 从执行计划中过滤可执行任务并构建批次感知队列
 *
 * 批次感知过滤策略（CP-19 修复）：
 * - 信任计划批次排序，不过滤依赖未满足的后续批次任务
 * - 仅排除终态任务（resolved/closed/abandoned/failed），避免重复执行
 * - 依赖完成检查由 AssemblyLine.checkDependencies() 在运行时逐任务执行
 * - 这确保后续批次任务在前序批次完成后仍可执行
 */
function filterExecutableFromPlan(
  plan: ExecutionPlan,
  cwd: string,
  logPrefix: string
): BatchAwareQueue {
  // 终态集合：已完成/失败/放弃的任务不再执行
  const TERMINAL_STATUSES_SET = new Set(TERMINAL_STATUSES);

  // 仅过滤终态任务，信任计划排序处理依赖关系
  // CP-9: 使用 normalizeStatus 确保状态比较标准化
  const filteredTasks = plan.tasks.filter(taskId => {
    const task = readTaskMeta(taskId, cwd);
    if (!task) return false;
    return !TERMINAL_STATUSES_SET.has(normalizeStatus(task.status));
  });

  const filteredCount = plan.tasks.length - filteredTasks.length;
  if (filteredCount > 0) {
    console.log(`${logPrefix} (filtered ${filteredCount} terminal tasks)`);
  } else {
    console.log(logPrefix);
  }

  // 重建 batches：过滤已移除的任务，移除空批次，确保与 filteredTasks 一致
  const filteredSet = new Set(filteredTasks);
  const rebuiltBatches = (plan.batches || [])
    .map(batch => batch.filter(taskId => filteredSet.has(taskId)))
    .filter(batch => batch.length > 0);

  return buildBatchAwareQueue(filteredTasks, rebuiltBatches);
}

/**
 * 打印执行摘要
 */
function printSummary(summary: ExecutionSummary): void {
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 Execution Summary');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`   Total tasks: ${summary.totalTasks}`);
  console.log(`   ✅ Passed: ${summary.passed}`);
  console.log(`   ❌ Failed: ${summary.failed}`);
  console.log(`   🔄 Retries: ${summary.totalRetries}`);
  console.log(`   ⏱️  Duration: ${(summary.duration / 1000).toFixed(1)}s`);
  console.log('');

  if (summary.failed > 0) {
    console.log('❌ Failed tasks:');
    for (const [taskId, record] of summary.taskResults) {
      if (record.reviewVerdict?.result === 'NOPASS' || record.devReport.status === 'failed') {
        console.log(`   - ${taskId}: ${record.reviewVerdict?.reason || record.devReport.error || 'Unknown error'}`);
      }
    }
    console.log('');
  }

  console.log('━'.repeat(SEPARATOR_WIDTH));
  const conclusion = evaluateSummaryConclusion(summary);
  console.log(conclusion.message);
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 Pipeline status saved to: .projmnt4claude/harness-status.json');
  console.log('💡 Check progress: cat .projmnt4claude/harness-status.json');
  console.log('━'.repeat(SEPARATOR_WIDTH));
}
