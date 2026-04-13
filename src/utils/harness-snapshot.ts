/**
 * Harness 计划快照管理模块
 *
 * 封装快照的创建、读取、清理、活跃检测能力
 * 快照路径: .projmnt4claude/runs/harness-plan-snapshot-{pid}-{timestamp}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PlanSnapshot } from '../types/harness.js';
import type { ExecutionPlan } from './plan.js';
import { getProjectDir } from './path.js';
import { readTaskMeta, getAllTasks } from './task.js';

/**
 * 获取 runs 目录路径
 */
function getRunsDir(cwd: string): string {
  const runsDir = path.join(getProjectDir(cwd), 'runs');
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  return runsDir;
}

/**
 * 生成快照文件名
 */
function generateSnapshotFilename(pid: number, timestamp: number): string {
  return `harness-plan-snapshot-${pid}-${timestamp}.json`;
}

/**
 * 解析快照文件名提取信息
 */
function parseSnapshotFilename(filename: string): { pid: number; timestamp: number } | null {
  const match = filename.match(/^harness-plan-snapshot-(\d+)-(\d+)\.json$/);
  if (!match) return null;
  return {
    pid: parseInt(match[1]!, 10),
    timestamp: parseInt(match[2]!, 10),
  };
}

/**
 * 创建计划快照
 *
 * @param executionPlan - 执行计划
 * @param cwd - 工作目录
 * @param batchAwareQueue - 批次感知队列（可选）
 * @returns 创建的快照对象
 */
export function createPlanSnapshot(
  executionPlan: ExecutionPlan,
  cwd: string = process.cwd(),
  batchAwareQueue?: {
    batchBoundaries?: number[];
    batchLabels?: string[];
    batchParallelizable?: boolean[];
  }
): PlanSnapshot {
  const pid = process.pid;
  const timestamp = Date.now();
  const snapshotId = generateSnapshotFilename(pid, timestamp);
  const runsDir = getRunsDir(cwd);
  const snapshotPath = path.join(runsDir, snapshotId);

  // 收集当前任务状态快照
  const taskStatusSnapshot: Record<string, string> = {};
  for (const taskId of executionPlan.tasks) {
    const task = readTaskMeta(taskId, cwd);
    if (task) {
      taskStatusSnapshot[taskId] = task.status;
    }
  }

  const snapshot: PlanSnapshot = {
    snapshotId,
    pid,
    timestamp: new Date(timestamp).toISOString(),
    path: snapshotPath,
    tasks: executionPlan.tasks,
    batches: executionPlan.batches,
    batchBoundaries: batchAwareQueue?.batchBoundaries,
    batchLabels: batchAwareQueue?.batchLabels,
    batchParallelizable: batchAwareQueue?.batchParallelizable,
    sourcePlanPath: path.join(getProjectDir(cwd), 'current-plan.json'),
    taskStatusSnapshot,
  };

  // 写入快照文件
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  return snapshot;
}

/**
 * 读取计划快照
 *
 * @param snapshotIdOrPath - 快照ID或完整路径
 * @param cwd - 工作目录
 * @returns 快照对象，不存在则返回 null
 */
export function readPlanSnapshot(
  snapshotIdOrPath: string,
  cwd: string = process.cwd()
): PlanSnapshot | null {
  let snapshotPath: string;

  if (path.isAbsolute(snapshotIdOrPath)) {
    snapshotPath = snapshotIdOrPath;
  } else {
    const runsDir = getRunsDir(cwd);
    snapshotPath = path.join(runsDir, snapshotIdOrPath);
  }

  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as PlanSnapshot;
    // 验证必要字段
    if (!snapshot.snapshotId || !snapshot.tasks || !Array.isArray(snapshot.tasks)) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * 列出所有快照
 *
 * @param cwd - 工作目录
 * @returns 快照列表（按时间倒序）
 */
export function listSnapshots(cwd: string = process.cwd()): PlanSnapshot[] {
  const runsDir = getRunsDir(cwd);

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const files = fs.readdirSync(runsDir);
  const snapshots: PlanSnapshot[] = [];

  for (const file of files) {
    if (!file.startsWith('harness-plan-snapshot-') || !file.endsWith('.json')) {
      continue;
    }

    const snapshot = readPlanSnapshot(file, cwd);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  // 按时间倒序排列
  return snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * 清理指定快照
 *
 * @param snapshotIdOrPath - 快照ID或完整路径
 * @param cwd - 工作目录
 * @returns 是否成功清理
 */
export function cleanupSnapshot(
  snapshotIdOrPath: string,
  cwd: string = process.cwd()
): boolean {
  let snapshotPath: string;

  if (path.isAbsolute(snapshotIdOrPath)) {
    snapshotPath = snapshotIdOrPath;
  } else {
    const runsDir = getRunsDir(cwd);
    snapshotPath = path.join(runsDir, snapshotIdOrPath);
  }

  if (!fs.existsSync(snapshotPath)) {
    return false;
  }

  try {
    fs.unlinkSync(snapshotPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理当前进程的所有快照
 *
 * @param cwd - 工作目录
 * @returns 清理的快照数量
 */
export function cleanupCurrentProcessSnapshots(cwd: string = process.cwd()): number {
  const pid = process.pid;
  const snapshots = listSnapshots(cwd);
  let cleaned = 0;

  for (const snapshot of snapshots) {
    if (snapshot.pid === pid) {
      if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
        cleaned++;
      }
    }
  }

  return cleaned;
}

/**
 * 清理所有已结束进程的快照（孤儿快照清理）
 *
 * @param cwd - 工作目录
 * @returns 清理的快照数量
 */
export function cleanupOrphanedSnapshots(cwd: string = process.cwd()): number {
  const snapshots = listSnapshots(cwd);
  let cleaned = 0;

  for (const snapshot of snapshots) {
    if (!isProcessAlive(snapshot.pid)) {
      if (cleanupSnapshot(snapshot.snapshotId, cwd)) {
        cleaned++;
      }
    }
  }

  return cleaned;
}

/**
 * 检测快照是否活跃（所属进程是否仍在运行）
 *
 * @param snapshot - 快照对象或快照ID
 * @param cwd - 工作目录
 * @returns 是否活跃
 */
export function isSnapshotActive(
  snapshot: PlanSnapshot | string,
  cwd: string = process.cwd()
): boolean {
  let pid: number;

  if (typeof snapshot === 'string') {
    const snapshotData = readPlanSnapshot(snapshot, cwd);
    if (!snapshotData) return false;
    pid = snapshotData.pid;
  } else {
    pid = snapshot.pid;
  }

  return isProcessAlive(pid);
}

/**
 * 检查进程是否存活（跨平台）
 *
 * @param pid - 进程ID
 * @returns 是否存活
 */
function isProcessAlive(pid: number): boolean {
  try {
    // 发送信号0检查进程是否存在（不实际发送信号）
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前进程的活跃快照
 *
 * @param cwd - 工作目录
 * @returns 当前进程的活跃快照，不存在则返回 null
 */
export function getCurrentProcessSnapshot(cwd: string = process.cwd()): PlanSnapshot | null {
  const pid = process.pid;
  const snapshots = listSnapshots(cwd);

  // 找最新的属于当前进程的快照
  for (const snapshot of snapshots) {
    if (snapshot.pid === pid && isProcessAlive(pid)) {
      return snapshot;
    }
  }

  return null;
}

/**
 * 从快照重建 ExecutionPlan
 *
 * @param snapshot - 快照对象
 * @returns ExecutionPlan 对象
 */
export function rebuildExecutionPlanFromSnapshot(snapshot: PlanSnapshot): ExecutionPlan {
  return {
    tasks: snapshot.tasks,
    batches: snapshot.batches,
    createdAt: snapshot.timestamp,
    updatedAt: snapshot.timestamp,
  };
}

/**
 * 验证快照完整性
 *
 * @param snapshot - 快照对象
 * @param cwd - 工作目录
 * @returns 验证结果
 */
export function validateSnapshot(
  snapshot: PlanSnapshot,
  cwd: string = process.cwd()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 检查必要字段
  if (!snapshot.snapshotId) {
    errors.push('缺少 snapshotId');
  }
  if (!snapshot.pid || typeof snapshot.pid !== 'number') {
    errors.push('缺少或无效的 pid');
  }
  if (!snapshot.timestamp) {
    errors.push('缺少 timestamp');
  }
  if (!snapshot.tasks || !Array.isArray(snapshot.tasks)) {
    errors.push('缺少或无效的 tasks 数组');
  }

  // 检查任务是否都存在
  if (snapshot.tasks && Array.isArray(snapshot.tasks)) {
    for (const taskId of snapshot.tasks) {
      const task = readTaskMeta(taskId, cwd);
      if (!task) {
        errors.push(`任务 ${taskId} 不存在`);
      }
    }
  }

  // 检查批次边界有效性
  if (snapshot.batchBoundaries && Array.isArray(snapshot.batchBoundaries)) {
    const taskCount = snapshot.tasks?.length ?? 0;
    for (let i = 0; i < snapshot.batchBoundaries.length; i++) {
      const boundary = snapshot.batchBoundaries[i]!;
      if (boundary < 0 || boundary > taskCount) {
        errors.push(`批次边界 ${i} (${boundary}) 超出任务范围 (0-${taskCount})`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
