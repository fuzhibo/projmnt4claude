/**
 * human-verification 命令 - 人工验证管理
 *
 * 管理 headless 模式下收集的待人工验证检查点：
 * - list: 列出待验证项
 * - approve: 批准验证
 * - reject: 拒绝验证
 * - batch: 批量操作
 * - report: 生成验证报告
 */

import {
  listPending,
  approveVerification,
  rejectVerification,
  batchApprove,
  approveAll,
  generateVerificationReport,
  getQueueStats,
} from '../utils/harness-verification-queue.js';
import { SEPARATOR_WIDTH } from '../utils/format';

/**
 * 列出待验证检查点
 */
export function listHumanVerifications(options: {
  json?: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  taskId?: string;
}): void {
  const cwd = process.cwd();
  const items = listPending(cwd, {
    status: options.status,
    taskId: options.taskId,
  });

  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  const stats = getQueueStats(cwd);

  console.log('\n' + '━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 人工验证队列');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`总计: ${stats.total} | 待验证: ${stats.pending} | 已通过: ${stats.approved} | 已拒绝: ${stats.rejected}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));

  if (items.length === 0) {
    console.log('\n  暂无匹配的验证项');
    return;
  }

  for (const item of items) {
    const statusIcon = item.status === 'pending' ? '⏳' : item.status === 'approved' ? '✅' : '❌';
    console.log(`\n${statusIcon} [${item.checkpointId}] ${item.taskTitle}`);
    console.log(`   任务ID: ${item.taskId}`);
    console.log(`   描述: ${item.checkpointDescription}`);
    if (item.verificationSteps?.length) {
      console.log('   验证步骤:');
      item.verificationSteps.forEach((step, i) => {
        console.log(`     ${i + 1}. ${step}`);
      });
    }
    if (item.expectedResult) {
      console.log(`   期望结果: ${item.expectedResult}`);
    }
    console.log(`   状态: ${item.status}`);
    if (item.feedback) {
      console.log(`   反馈: ${item.feedback}`);
    }
    console.log(`   时间: ${item.enqueuedAt}`);
  }

  console.log('\n' + '━'.repeat(SEPARATOR_WIDTH));

  const pendingItems = items.filter(i => i.status === 'pending');
  if (pendingItems.length > 0) {
    console.log(`\n💡 处理待验证项:`);
    console.log(`   projmnt4claude human-verification approve <taskId> --checkpoint <id>`);
    console.log(`   projmnt4claude human-verification approve <taskId>  (批准该任务所有待验证)`);
    console.log(`   projmnt4claude human-verification reject <taskId> --checkpoint <id> --reason "原因"`);
  }
}

/**
 * 批准验证
 */
export function approveHumanVerification(
  taskId: string,
  options: {
    checkpoint?: string;
    feedback?: string;
  }
): void {
  const cwd = process.cwd();

  if (options.checkpoint) {
    // 批准单个检查点
    const result = approveVerification(taskId, options.checkpoint, cwd, 'human', options.feedback);
    if (!result) {
      console.error(`❌ 未找到待验证项: ${taskId}/${options.checkpoint}`);
      process.exit(1);
    }
    console.log(`✅ 已批准: ${taskId}/${options.checkpoint}`);
    if (options.feedback) {
      console.log(`   反馈: ${options.feedback}`);
    }
  } else {
    // 批准该任务所有待验证
    const results = batchApprove(taskId, cwd, 'human', options.feedback);
    if (results.length === 0) {
      console.error(`❌ 任务 ${taskId} 没有待验证的检查点`);
      process.exit(1);
    }
    console.log(`✅ 已批量批准 ${results.length} 个检查点:`);
    for (const r of results) {
      console.log(`   ✓ ${r.checkpointId}`);
    }
  }
}

/**
 * 拒绝验证
 */
export function rejectHumanVerification(
  taskId: string,
  options: {
    checkpoint: string;
    reason?: string;
  }
): void {
  const cwd = process.cwd();

  if (!options.checkpoint) {
    console.error('❌ 拒绝操作需要指定 --checkpoint <checkpointId>');
    console.error('   用法: projmnt4claude human-verification reject <taskId> --checkpoint <id> --reason "原因"');
    process.exit(1);
  }

  const result = rejectVerification(taskId, options.checkpoint, cwd, 'human', options.reason);
  if (!result) {
    console.error(`❌ 未找到待验证项: ${taskId}/${options.checkpoint}`);
    process.exit(1);
  }

  console.log(`❌ 已拒绝: ${taskId}/${options.checkpoint}`);
  if (options.reason) {
    console.log(`   原因: ${options.reason}`);
  }
}

/**
 * 批量操作
 */
export function batchHumanVerification(options: {
  approveAll?: boolean;
  feedback?: string;
}): void {
  const cwd = process.cwd();

  if (options.approveAll) {
    const results = approveAll(cwd, 'human', options.feedback);
    if (results.length === 0) {
      console.log('ℹ️  没有待验证的检查点');
      return;
    }
    console.log(`✅ 已批量批准全部 ${results.length} 个待验证检查点:`);
    for (const r of results) {
      console.log(`   ✓ ${r.taskId}/${r.checkpointId}`);
    }
  } else {
    console.error('❌ 请指定批量操作: --approve-all');
    process.exit(1);
  }
}

/**
 * 生成/显示验证报告
 */
export function showVerificationReport(options: {
  json?: boolean;
}): void {
  const cwd = process.cwd();

  if (options.json) {
    const stats = getQueueStats(cwd);
    const items = listPending(cwd);
    console.log(JSON.stringify({ stats, items }, null, 2));
    return;
  }

  const report = generateVerificationReport(cwd);
  console.log(report);
}
