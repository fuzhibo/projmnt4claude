/**
 * HarnessVerificationQueue - 待人工验证队列管理器
 *
 * 负责管理 headless 模式下收集的待人工验证检查点：
 * - 入队/出队操作
 * - 队列持久化
 * - 批量操作
 * - 报告生成
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PendingVerification,
  PendingVerificationQueue,
} from '../types/task.js';
import type { TaskMeta, CheckpointMetadata, TaskStatus } from '../types/task.js';
import { readTaskMeta, writeTaskMeta, updateTaskStatus } from './task.js';
import { getProjectDir } from './path.js';

const QUEUE_FILENAME = 'pending-verifications.json';

/**
 * 获取验证队列文件路径
 */
function getQueueFilePath(cwd: string): string {
  const projectDir = getProjectDir(cwd);
  const queueDir = path.join(projectDir, 'verification-queue');
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }
  return path.join(queueDir, QUEUE_FILENAME);
}

/**
 * 读取验证队列
 */
export function readQueue(cwd: string): PendingVerificationQueue {
  const filePath = getQueueFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return { version: 1, items: [], updatedAt: new Date().toISOString() };
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PendingVerificationQueue;
  } catch {
    return { version: 1, items: [], updatedAt: new Date().toISOString() };
  }
}

/**
 * 写入验证队列
 */
function writeQueue(queue: PendingVerificationQueue, cwd: string): void {
  queue.updatedAt = new Date().toISOString();
  const filePath = getQueueFilePath(cwd);
  fs.writeFileSync(filePath, JSON.stringify(queue, null, 2), 'utf-8');
}

/**
 * 入队：添加待验证检查点
 */
export function enqueueVerification(
  item: Omit<PendingVerification, 'status' | 'enqueuedAt'>,
  cwd: string
): PendingVerification {
  const queue = readQueue(cwd);

  // 检查是否已存在（同一任务+同一检查点且状态为 pending）
  const existing = queue.items.find(
    i => i.taskId === item.taskId && i.checkpointId === item.checkpointId && i.status === 'pending'
  );
  if (existing) {
    return existing;
  }

  const entry: PendingVerification = {
    ...item,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
  };

  queue.items.push(entry);
  writeQueue(queue, cwd);
  return entry;
}

/**
 * 批量入队
 */
export function enqueueBatch(
  items: Array<Omit<PendingVerification, 'status' | 'enqueuedAt'>>,
  cwd: string
): PendingVerification[] {
  const queue = readQueue(cwd);
  const results: PendingVerification[] = [];

  for (const item of items) {
    const existing = queue.items.find(
      i => i.taskId === item.taskId && i.checkpointId === item.checkpointId && i.status === 'pending'
    );
    if (existing) {
      results.push(existing);
      continue;
    }

    const entry: PendingVerification = {
      ...item,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
    };
    queue.items.push(entry);
    results.push(entry);
  }

  writeQueue(queue, cwd);
  return results;
}

/**
 * 获取待验证列表
 */
export function listPending(cwd: string, options?: {
  taskId?: string;
  status?: 'pending' | 'approved' | 'rejected';
  sessionId?: string;
}): PendingVerification[] {
  const queue = readQueue(cwd);
  let items = queue.items;

  if (options?.taskId) {
    items = items.filter(i => i.taskId === options.taskId);
  }
  if (options?.status) {
    items = items.filter(i => i.status === options.status);
  }
  if (options?.sessionId) {
    items = items.filter(i => i.sessionId === options.sessionId);
  }

  return items;
}

/**
 * 批准单个验证
 */
export function approveVerification(
  taskId: string,
  checkpointId: string,
  cwd: string,
  verifiedBy: string = 'human',
  feedback?: string
): PendingVerification | null {
  const queue = readQueue(cwd);
  const item = queue.items.find(
    i => i.taskId === taskId && i.checkpointId === checkpointId && i.status === 'pending'
  );

  if (!item) {
    return null;
  }

  item.status = 'approved';
  item.verifiedBy = verifiedBy;
  item.verifiedAt = new Date().toISOString();
  item.feedback = feedback;

  writeQueue(queue, cwd);

  // 同步更新任务检查点状态
  syncCheckpointAfterVerification(taskId, checkpointId, 'approved', cwd, feedback);

  return item;
}

/**
 * 拒绝单个验证
 */
export function rejectVerification(
  taskId: string,
  checkpointId: string,
  cwd: string,
  verifiedBy: string = 'human',
  feedback?: string
): PendingVerification | null {
  const queue = readQueue(cwd);
  const item = queue.items.find(
    i => i.taskId === taskId && i.checkpointId === checkpointId && i.status === 'pending'
  );

  if (!item) {
    return null;
  }

  item.status = 'rejected';
  item.verifiedBy = verifiedBy;
  item.verifiedAt = new Date().toISOString();
  item.feedback = feedback;

  writeQueue(queue, cwd);

  // 同步更新任务检查点状态
  syncCheckpointAfterVerification(taskId, checkpointId, 'rejected', cwd, feedback);

  return item;
}

/**
 * 批量批准任务的所有待验证检查点
 */
export function batchApprove(
  taskId: string,
  cwd: string,
  verifiedBy: string = 'human',
  feedback?: string
): PendingVerification[] {
  const queue = readQueue(cwd);
  const items = queue.items.filter(
    i => i.taskId === taskId && i.status === 'pending'
  );

  const now = new Date().toISOString();
  for (const item of items) {
    item.status = 'approved';
    item.verifiedBy = verifiedBy;
    item.verifiedAt = now;
    item.feedback = feedback;
    syncCheckpointAfterVerification(taskId, item.checkpointId, 'approved', cwd, feedback);
  }

  writeQueue(queue, cwd);
  return items;
}

/**
 * 全部批准（所有待验证）
 */
export function approveAll(
  cwd: string,
  verifiedBy: string = 'human',
  feedback?: string
): PendingVerification[] {
  const queue = readQueue(cwd);
  const items = queue.items.filter(i => i.status === 'pending');

  const now = new Date().toISOString();
  for (const item of items) {
    item.status = 'approved';
    item.verifiedBy = verifiedBy;
    item.verifiedAt = now;
    item.feedback = feedback;
    syncCheckpointAfterVerification(item.taskId, item.checkpointId, 'approved', cwd, feedback);
  }

  writeQueue(queue, cwd);
  return items;
}

/**
 * 验证后同步检查点状态并触发任务状态流转
 */
function syncCheckpointAfterVerification(
  taskId: string,
  checkpointId: string,
  verdict: 'approved' | 'rejected',
  cwd: string,
  feedback?: string
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task?.checkpoints?.length) return;

  const now = new Date().toISOString();
  const checkpoint = task.checkpoints.find(cp => cp.id === checkpointId);
  if (!checkpoint) return;

  if (verdict === 'approved') {
    checkpoint.status = 'completed';
    checkpoint.updatedAt = now;
    checkpoint.note = feedback || '人工验证通过';
    if (!checkpoint.verification) {
      checkpoint.verification = { method: 'human_verification' };
    }
    checkpoint.verification.result = 'passed';
    checkpoint.verification.verifiedAt = now;
    checkpoint.verification.verifiedBy = 'human';
  } else {
    checkpoint.status = 'failed';
    checkpoint.updatedAt = now;
    checkpoint.note = feedback || '人工验证未通过';
    if (!checkpoint.verification) {
      checkpoint.verification = { method: 'human_verification' };
    }
    checkpoint.verification.result = 'failed';
    checkpoint.verification.verifiedAt = now;
    checkpoint.verification.verifiedBy = 'human';
  }

  writeTaskMeta(task, cwd);

  // 检查该任务是否所有待验证检查点都已完成，触发状态流转
  tryTransitionTaskStatus(taskId, cwd);
}

/**
 * 尝试流转任务状态
 * 如果所有需要人工验证的检查点都已通过，且任务处于 wait_qa，则流转到 wait_complete
 */
function tryTransitionTaskStatus(taskId: string, cwd: string): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task?.checkpoints?.length) return;

  // 只处理处于 wait_qa 状态的任务
  if (task.status !== 'wait_qa') return;

  // 检查是否还有 pending 的人工验证检查点
  const queue = readQueue(cwd);
  const pendingForTask = queue.items.filter(
    i => i.taskId === taskId && i.status === 'pending'
  );

  if (pendingForTask.length > 0) {
    return; // 还有待验证项，不流转
  }

  // 检查是否有被拒绝的检查点
  const rejectedForTask = queue.items.filter(
    i => i.taskId === taskId && i.status === 'rejected'
  );

  if (rejectedForTask.length > 0) {
    // 有拒绝的检查点，将任务标记为 reopened（需要重做）
    updateTaskStatus(taskId, 'reopened', '人工验证未通过', cwd);
    return;
  }

  // 所有验证通过，流转到 wait_complete
  updateTaskStatus(taskId, 'wait_complete', '人工验证全部通过', cwd);
}

/**
 * 根据检查点的验证方法和期望结果生成建议操作
 * BUG-014-2C: 为每个待验证检查点提供上下文化的操作建议
 */
function suggestAction(item: {
  checkpointDescription?: string;
  verificationSteps?: string[];
  expectedResult?: string;
}): string {
  if (item.verificationSteps?.length) {
    return `按验证步骤执行: ${item.verificationSteps[0]}${item.verificationSteps.length > 1 ? ' 等' : ''}`;
  }
  if (item.expectedResult) {
    return `确认是否满足: ${item.expectedResult}`;
  }
  return '人工检查并确认是否通过';
}

/**
 * 生成验证报告
 */
export function generateVerificationReport(cwd: string, sessionId?: string): string {
  const queue = readQueue(cwd);
  let items = queue.items;

  if (sessionId) {
    items = items.filter(i => i.sessionId === sessionId);
  }

  const pending = items.filter(i => i.status === 'pending');
  const approved = items.filter(i => i.status === 'approved');
  const rejected = items.filter(i => i.status === 'rejected');

  const lines: string[] = [
    '# 人工验证报告',
    '',
    `生成时间: ${new Date().toISOString()}`,
    '',
    '## 概要',
    '',
    `| 状态 | 数量 |`,
    `|------|------|`,
    `| 待验证 | ${pending.length} |`,
    `| 已通过 | ${approved.length} |`,
    `| 已拒绝 | ${rejected.length} |`,
    `| **总计** | ${items.length} |`,
    '',
  ];

  // BUG-014-2C: 增强汇总表 - 任务 ID、检查点描述、建议操作
  if (pending.length > 0) {
    lines.push('## 待验证检查点汇总');
    lines.push('');
    lines.push('| # | 任务 ID | 任务标题 | 检查点 | 建议操作 |');
    lines.push('|---|---------|----------|--------|----------|');
    pending.forEach((item, i) => {
      const action = suggestAction(item);
      lines.push(`| ${i + 1} | ${item.taskId} | ${item.taskTitle} | ${item.checkpointDescription} | ${action} |`);
    });
    lines.push('');

    lines.push('## 待验证检查点详情');
    lines.push('');
    for (const item of pending) {
      lines.push(`### ${item.taskId} - ${item.checkpointId}`);
      lines.push(`- 任务: ${item.taskTitle}`);
      lines.push(`- 检查点: ${item.checkpointDescription}`);
      lines.push(`- 建议操作: ${suggestAction(item)}`);
      if (item.verificationSteps?.length) {
        lines.push(`- 验证步骤:`);
        item.verificationSteps.forEach((step, i) => {
          lines.push(`  ${i + 1}. ${step}`);
        });
      }
      if (item.expectedResult) {
        lines.push(`- 期望结果: ${item.expectedResult}`);
      }
      lines.push(`- 入队时间: ${item.enqueuedAt}`);
      lines.push('');
    }
  }

  if (approved.length > 0) {
    lines.push('## 已通过验证');
    lines.push('');
    for (const item of approved) {
      lines.push(`- ${item.taskId}/${item.checkpointId}: ${item.feedback || '通过'} (${item.verifiedAt})`);
    }
    lines.push('');
  }

  if (rejected.length > 0) {
    lines.push('## 已拒绝验证');
    lines.push('');
    for (const item of rejected) {
      lines.push(`- ${item.taskId}/${item.checkpointId}: ${item.feedback || '未通过'} (${item.verifiedAt})`);
    }
    lines.push('');
  }

  if (pending.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('**使用以下命令处理待验证检查点:**');
    lines.push('```');
    lines.push('# 查看待验证列表');
    lines.push('projmnt4claude human-verification list');
    lines.push('');
    lines.push('# 批准单个检查点');
    lines.push('projmnt4claude human-verification approve <taskId> --checkpoint <checkpointId>');
    lines.push('');
    lines.push('# 批准任务的所有待验证');
    lines.push('projmnt4claude human-verification approve <taskId>');
    lines.push('');
    lines.push('# 全部批准');
    lines.push('projmnt4claude human-verification batch --approve-all');
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * 获取队列统计
 */
export function getQueueStats(cwd: string): {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byTask: Record<string, { pending: number; approved: number; rejected: number }>;
} {
  const queue = readQueue(cwd);
  const byTask: Record<string, { pending: number; approved: number; rejected: number }> = {};

  for (const item of queue.items) {
    if (!byTask[item.taskId]) {
      byTask[item.taskId] = { pending: 0, approved: 0, rejected: 0 };
    }
    byTask[item.taskId]![item.status]++;
  }

  return {
    total: queue.items.length,
    pending: queue.items.filter(i => i.status === 'pending').length,
    approved: queue.items.filter(i => i.status === 'approved').length,
    rejected: queue.items.filter(i => i.status === 'rejected').length,
    byTask,
  };
}
