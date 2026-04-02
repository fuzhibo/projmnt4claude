/**
 * HarnessHumanVerifier - 人工验证阶段处理器
 *
 * 负责处理需要人工验证的检查点：
 * - 生成验证请求
 * - 与用户交互
 * - 记录验证结果
 */

import * as fs from 'fs';
import { SEPARATOR_WIDTH } from './format';
import * as path from 'path';
import * as readline from 'readline';
import type {
  HarnessConfig,
  QAVerdict,
  HumanVerdict,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { getProjectDir } from './path.js';
import { enqueueBatch } from './harness-verification-queue.js';

export class HarnessHumanVerifier {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 请求人工验证
   *
   * 流程：
   * 1. 获取需要人工验证的检查点
   * 2. 在交互模式下：显示验证请求，等待用户响应
   * 3. 在非交互模式（headless）下：将检查点入队待验证队列
   * 4. 记录验证结果
   */
  async requestVerification(task: TaskMeta, qaVerdict: QAVerdict, sessionId?: string): Promise<HumanVerdict[]> {
    console.log(`\n👤 人工验证阶段...`);
    console.log(`   任务: ${task.title}`);

    const verdicts: HumanVerdict[] = [];

    // 获取需要人工验证的检查点
    const humanCheckpoints = this.getHumanCheckpoints(task);

    if (humanCheckpoints.length === 0) {
      console.log('   ℹ️  无需人工验证的检查点');
      return verdicts;
    }

    console.log(`   📋 需要人工验证 ${humanCheckpoints.length} 个检查点\n`);

    // 非交互模式（headless）：入队待验证，返回 deferred 通过
    if (!process.stdin.isTTY || this.config.jsonOutput) {
      return this.handleHeadlessVerification(task, humanCheckpoints, sessionId);
    }

    // 交互模式：逐个验证
    for (const checkpoint of humanCheckpoints) {
      const verdict = await this.verifyCheckpoint(task, checkpoint);
      verdicts.push(verdict);
    }

    return verdicts;
  }

  /**
   * Headless 模式处理：将检查点入队待验证队列
   */
  private handleHeadlessVerification(
    task: TaskMeta,
    checkpoints: CheckpointMetadata[],
    sessionId?: string
  ): HumanVerdict[] {
    console.log('   📝 Headless 模式：将人工验证检查点加入待验证队列');
    console.log(`   共 ${checkpoints.length} 个检查点需要后续人工验证\n`);

    // 批量入队
    const queueItems = checkpoints.map(cp => ({
      taskId: task.id,
      taskTitle: task.title,
      checkpointId: cp.id,
      checkpointDescription: cp.description,
      verificationSteps: cp.verification?.commands,
      expectedResult: cp.verification?.expected,
      sessionId,
    }));

    enqueueBatch(queueItems, this.config.cwd);

    // 返回 PASS（deferred），让流水线继续
    return checkpoints.map(cp => ({
      taskId: task.id,
      result: 'PASS' as const,
      reason: '已加入待验证队列，等待人工确认 (deferred)',
      checkpointId: cp.id,
      verifiedBy: 'system',
      verifiedAt: new Date().toISOString(),
      userFeedback: 'Headless 模式自动延迟，待人工验证',
    }));
  }

  /**
   * 获取需要人工验证的检查点
   */
  private getHumanCheckpoints(task: TaskMeta): CheckpointMetadata[] {
    if (!task.checkpoints) {
      return [];
    }

    return task.checkpoints.filter(cp =>
      cp.requiresHuman === true ||
      cp.verification?.method === 'human_verification'
    );
  }

  /**
   * 验证单个检查点
   */
  private async verifyCheckpoint(task: TaskMeta, checkpoint: CheckpointMetadata): Promise<HumanVerdict> {
    const verdict: HumanVerdict = {
      taskId: task.id,
      result: 'NOPASS',
      reason: '',
      checkpointId: checkpoint.id,
      verifiedBy: 'human',
      verifiedAt: new Date().toISOString(),
    };

    // 显示验证请求
    this.displayVerificationRequest(task, checkpoint);

    // 等待用户响应
    const response = await this.getUserResponse();

    if (response.passed) {
      verdict.result = 'PASS';
      verdict.reason = '用户确认通过';
      verdict.userFeedback = response.feedback;
      console.log(`\n   ✅ [${checkpoint.id}] 验证通过`);
    } else {
      verdict.result = 'NOPASS';
      verdict.reason = response.feedback || '用户确认不通过';
      verdict.userFeedback = response.feedback;
      console.log(`\n   ❌ [${checkpoint.id}] 验证未通过: ${verdict.reason}`);
    }

    // 保存人工验证报告
    await this.saveHumanVerificationReport(task.id, checkpoint.id, verdict);

    return verdict;
  }

  /**
   * 显示验证请求
   */
  private displayVerificationRequest(task: TaskMeta, checkpoint: CheckpointMetadata): void {
    console.log('\n' + '━'.repeat(SEPARATOR_WIDTH));
    console.log('📋 人工验证请求');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`\n任务: ${task.title} (${task.id})`);
    console.log(`检查点: [${checkpoint.id}] ${checkpoint.description}`);
    console.log('');

    if (checkpoint.note) {
      console.log(`备注: ${checkpoint.note}`);
      console.log('');
    }

    if (checkpoint.verification?.commands && checkpoint.verification.commands.length > 0) {
      console.log('验证步骤:');
      checkpoint.verification.commands.forEach((cmd, i) => {
        console.log(`  ${i + 1}. ${cmd}`);
      });
      console.log('');
    }

    if (checkpoint.verification?.expected) {
      console.log(`期望结果: ${checkpoint.verification.expected}`);
      console.log('');
    }

    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('请回复:');
    console.log('  - "通过" / "PASS" / "yes" / "y" - 验证通过');
    console.log('  - "不通过" / "NOPASS" / "no" / "n" - 验证失败（可附加原因）');
    console.log('━'.repeat(SEPARATOR_WIDTH));
  }

  /**
   * 获取用户响应（仅交互模式调用）
   */
  private async getUserResponse(): Promise<{ passed: boolean; feedback?: string }> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('\n请输入验证结果: ', (answer) => {
        rl.close();

        const trimmedAnswer = answer.trim().toLowerCase();

        // 判断用户响应
        const passedKeywords = ['通过', 'pass', 'yes', 'y', '是', 'ok', '好的'];
        const failedKeywords = ['不通过', 'nopass', 'no', 'n', '否', '失败'];

        let passed = false;
        let feedback = '';

        // 检查是否通过
        for (const keyword of passedKeywords) {
          if (trimmedAnswer.startsWith(keyword)) {
            passed = true;
            // 提取附加反馈
            feedback = answer.trim().substring(keyword.length).trim();
            break;
          }
        }

        // 检查是否不通过
        if (!passed) {
          for (const keyword of failedKeywords) {
            if (trimmedAnswer.startsWith(keyword)) {
              passed = false;
              // 提取附加反馈
              feedback = answer.trim().substring(keyword.length).trim();
              break;
            }
          }

          // 如果没有明确的关键词，检查是否包含否定词
          if (!feedback && trimmedAnswer.length > 0) {
            passed = false;
            feedback = answer.trim();
          }
        }

        resolve({ passed, feedback: feedback || undefined });
      });
    });
  }

  /**
   * 获取人工验证报告路径
   */
  private getHumanVerificationReportPath(taskId: string, checkpointId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'reports', 'harness', taskId, `human-verification-${checkpointId}.md`);
  }

  /**
   * 保存人工验证报告
   */
  private async saveHumanVerificationReport(
    taskId: string,
    checkpointId: string,
    verdict: HumanVerdict
  ): Promise<void> {
    const reportPath = this.getHumanVerificationReportPath(taskId, checkpointId);
    const dir = path.dirname(reportPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = this.formatHumanVerificationReport(verdict);
    fs.writeFileSync(reportPath, content, 'utf-8');
  }

  /**
   * 格式化人工验证报告
   */
  private formatHumanVerificationReport(verdict: HumanVerdict): string {
    const lines: string[] = [
      `# 人工验证报告 - ${verdict.taskId} - ${verdict.checkpointId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**验证时间**: ${verdict.verifiedAt}`,
      `**验证人**: ${verdict.verifiedBy}`,
      '',
      '## 原因',
      verdict.reason,
      '',
    ];

    if (verdict.userFeedback) {
      lines.push('## 用户反馈');
      lines.push(verdict.userFeedback);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 批量验证（用于 CLI 模式）
   *
   * @param task 任务元数据
   * @param qaVerdict QA 验证结果
   * @param autoApprove 是否自动通过（用于 --yes 模式）
   */
  async batchVerification(
    task: TaskMeta,
    qaVerdict: QAVerdict,
    autoApprove: boolean = false,
    sessionId?: string
  ): Promise<HumanVerdict[]> {
    if (autoApprove) {
      console.log('\n   ⚠️  自动批准模式，跳过人工验证');
      const humanCheckpoints = this.getHumanCheckpoints(task);
      return humanCheckpoints.map(checkpoint => ({
        taskId: task.id,
        result: 'PASS' as const,
        reason: '自动批准模式',
        checkpointId: checkpoint.id,
        verifiedBy: 'human',
        verifiedAt: new Date().toISOString(),
        userFeedback: '自动批准',
      }));
    }

    return this.requestVerification(task, qaVerdict, sessionId);
  }
}
