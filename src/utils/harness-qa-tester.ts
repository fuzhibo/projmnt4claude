/**
 * HarnessQATester - QA 验证阶段处理器
 *
 * 负责执行 QA 验证检查点：
 * - 运行单元测试
 * - 运行功能测试
 * - 运行集成测试
 * - 判断是否需要人工验证
 */

import * as path from 'path';
import type {
  HarnessConfig,
  CodeReviewVerdict,
  QAVerdict,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { validateCheckpointVerification } from '../types/task.js';
import {
  runHeadlessClaude,
  saveReport,
  filterCheckpoints,
  parseVerdictResult,
  getReportPath,
  REVIEW_TIMEOUT_RATIO,
} from './harness-helpers.js';

/**
 * 验证检查点的验证信息完整性
 * 用于 QA 提示词中显示警告
 */
function checkCheckpointVerification(cp: CheckpointMetadata): { valid: boolean; warning?: string } {
  return validateCheckpointVerification(cp);
}

export class HarnessQATester {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 执行 QA 验证
   */
  async verify(task: TaskMeta, codeReviewVerdict: CodeReviewVerdict): Promise<QAVerdict> {
    console.log(`\n🧪 QA 验证阶段...`);
    console.log(`   任务: ${task.title}`);

    const verdict: QAVerdict = {
      taskId: task.id,
      result: 'PASS',
      reason: '',
      testFailures: [],
      failedCheckpoints: [],
      requiresHuman: false,
      humanVerificationCheckpoints: [],
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'qa_tester',
    };

    // 如果代码审核未通过，直接返回 NOPASS
    if (codeReviewVerdict.result !== 'PASS') {
      verdict.result = 'NOPASS';
      verdict.reason = `代码审核未通过，跳过 QA 验证: ${codeReviewVerdict.reason}`;
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    try {
      // 1. 获取 QA 验证类检查点
      const qaCheckpoints = this.getQACheckpoints(task);
      console.log(`   📋 QA 验证检查点: ${qaCheckpoints.length} 个`);

      if (qaCheckpoints.length === 0) {
        // 没有 QA 检查点，直接通过
        verdict.result = 'PASS';
        verdict.reason = '无 QA 验证检查点，自动通过';
        console.log('   ✅ 无 QA 验证检查点，自动通过');
      } else {
        // 2. 检查是否有人工验证检查点
        const humanCheckpoints = qaCheckpoints.filter(cp => cp.requiresHuman === true);
        verdict.humanVerificationCheckpoints = humanCheckpoints.map(cp => cp.id);

        // 3. 运行自动化 QA 验证
        const qaResult = await this.runQAVerification(task, codeReviewVerdict, qaCheckpoints);

        verdict.result = qaResult.passed ? 'PASS' : 'NOPASS';
        verdict.reason = qaResult.reason;
        verdict.testFailures = qaResult.failures;
        verdict.failedCheckpoints = qaResult.failedCheckpoints;
        verdict.details = qaResult.details;

        // 4. 判断是否需要人工验证
        if (humanCheckpoints.length > 0) {
          verdict.requiresHuman = true;
          verdict.reason += `\n需要人工验证 ${humanCheckpoints.length} 个检查点`;
          console.log(`\n   ⚠️  需要人工验证 ${humanCheckpoints.length} 个检查点`);
        }

        if (verdict.result === 'PASS' && !verdict.requiresHuman) {
          console.log('\n   ✅ QA 验证通过');
        } else if (verdict.result === 'PASS' && verdict.requiresHuman) {
          console.log('\n   ⏳ 自动化验证通过，等待人工验证');
        } else {
          console.log(`\n   ❌ QA 验证未通过: ${verdict.reason}`);
        }
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `QA 验证过程出错: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ QA 验证出错: ${verdict.reason}`);
    }

    // 保存 QA 报告
    await this.saveReport(task.id, verdict);

    return verdict;
  }

  /**
   * 获取 QA 验证类检查点
   */
  private getQACheckpoints(task: TaskMeta): CheckpointMetadata[] {
    return filterCheckpoints(task, cp =>
      cp.category === 'qa_verification' ||
      cp.verification?.method === 'unit_test' ||
      cp.verification?.method === 'functional_test' ||
      cp.verification?.method === 'integration_test' ||
      cp.verification?.method === 'e2e_test' ||
      cp.verification?.method === 'automated' ||
      cp.verification?.method === 'human_verification' ||
      cp.requiresHuman === true
    );
  }

  /**
   * 运行 QA 验证
   */
  private async runQAVerification(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[]
  ): Promise<{
    passed: boolean;
    reason: string;
    failures: string[];
    failedCheckpoints: string[];
    details?: string;
  }> {
    // 分离自动化检查点和人工验证检查点
    const automatedCheckpoints = checkpoints.filter(cp => !cp.requiresHuman);
    const humanCheckpoints = checkpoints.filter(cp => cp.requiresHuman === true);

    // BUG-013-2: 检查自动化检查点中是否有缺少验证命令的情况
    const checkpointsWithoutCommands = automatedCheckpoints.filter(cp => {
      const result = validateCheckpointVerification(cp);
      return !result.valid;
    });
    if (checkpointsWithoutCommands.length > 0) {
      console.log(`\n   ⚠️  ${checkpointsWithoutCommands.length} 个自动化检查点缺少验证命令:`);
      for (const cp of checkpointsWithoutCommands) {
        const result = validateCheckpointVerification(cp);
        console.log(`      - [${cp.id}] ${result.warning || '缺少 commands/steps'}`);
      }
      console.log('      这些检查点将依赖 AI 自由验证，可能影响验证质量。');
    }

    if (automatedCheckpoints.length === 0) {
      // 只有需要人工验证的检查点
      return {
        passed: true,
        reason: '所有检查点都需要人工验证',
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 构建验证提示词
    const prompt = this.buildQAPrompt(task, codeReviewVerdict, automatedCheckpoints);
    console.log('\n   📝 QA 验证提示词已生成');

    // 运行独立验证会话
    console.log('\n   🤖 启动 QA 验证会话...');
    const claudeResult = await runHeadlessClaude({
      prompt,
      allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
      timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
      cwd: this.config.cwd,
    });

    if (!claudeResult.success) {
      return {
        passed: false,
        reason: `QA 验证会话失败: ${claudeResult.error || '未知错误'}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 解析验证结果
    return this.parseQAResult(claudeResult.output);
  }

  /**
   * 构建 QA 验证提示词
   */
  private buildQAPrompt(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[]
  ): string {
    const parts: string[] = [];

    parts.push('# QA 验证任务');
    parts.push('');
    parts.push('你是一个专业的 QA 测试员。你需要验证一个任务的实现是否满足功能要求。');
    parts.push('');
    parts.push('**重要**: 你必须严格验证，确保所有功能正常工作。');
    parts.push('');

    parts.push('## 任务信息');
    parts.push(`- ID: ${task.id}`);
    parts.push(`- 标题: ${task.title}`);
    parts.push('');

    if (task.description) {
      parts.push('## 任务描述');
      parts.push(task.description);
      parts.push('');
    }

    parts.push('## QA 飀证检查点');
    checkpoints.forEach((cp, i) => {
      parts.push(`${i + 1}. [${cp.id}] ${cp.description}`);
      if (cp.verification?.commands && cp.verification.commands.length > 0) {
        parts.push(`   验证命令: ${cp.verification.commands.join(', ')}`);
      }
      if (cp.verification?.expected) {
        parts.push(`   期望结果: ${cp.verification.expected}`);
      }
      // BUG-013-2: 裁判断点验证方法是否缺少 commands/steps
      const cpValidation = validateCheckpointVerification(cp);
      if (!cpValidation.valid && cpValidation.warning) {
        parts.push(`   ⚠️ ${cpValidation.warning}`);
      }
    });
    parts.push('');

    parts.push('## 代码审核结果');
    parts.push(`- 结果: ${codeReviewVerdict.result}`);
    parts.push(`- 原因: ${codeReviewVerdict.reason}`);
    parts.push('');

    parts.push('## 验证要求');
    parts.push('1. 运行单元测试（如有配置）');
    parts.push('2. 运行功能测试（如有配置）');
    parts.push('3. 验证功能是否符合预期');
    parts.push('4. 检查边界情况处理');
    parts.push('5. 收集测试证据');
    parts.push('');

    parts.push('## 输出格式');
    parts.push('请按以下格式输出验证结果:');
    parts.push('```');
    parts.push('## 验证结果: PASS 或 NOPASS');
    parts.push('## 原因: [简要说明为什么通过或不通过]');
    parts.push('## 测试失败: [列出失败的测试，如果没有则为空]');
    parts.push('## 未通过的检查点: [列出未通过的检查点ID，如果没有则为空]');
    parts.push('## 详细反馈: [可选的详细反馈]');
    parts.push('```');
    parts.push('');
    parts.push('现在开始验证。');

    return parts.join('\n');
  }

  /**
   * 解析 QA 验证结果
   */
  private parseQAResult(output: string): {
    passed: boolean;
    reason: string;
    failures: string[];
    failedCheckpoints: string[];
    details?: string;
  } {
    const parsed = parseVerdictResult(output, {
      resultField: '验证结果',
      reasonField: '原因',
      listField: '测试失败',
      checkpointField: '未通过的检查点',
      detailsField: '详细反馈',
    });

    return {
      passed: parsed.passed,
      reason: parsed.reason,
      failures: parsed.items,
      failedCheckpoints: parsed.failedCheckpoints,
      details: parsed.details,
    };
  }

  /**
   * 保存 QA 报告
   */
  private async saveReport(taskId: string, verdict: QAVerdict): Promise<void> {
    const reportPath = getReportPath(taskId, 'qa', this.config.cwd);
    const content = this.formatReport(verdict);
    await saveReport(reportPath, content);
  }

  /**
   * 格式化 QA 报告
   */
  private formatReport(verdict: QAVerdict): string {
    const lines: string[] = [
      `# QA 验证报告 - ${verdict.taskId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**验证时间**: ${verdict.verifiedAt}`,
      `**验证者**: ${verdict.verifiedBy}`,
      `**需要人工验证**: ${verdict.requiresHuman ? '是' : '否'}`,
      '',
      '## 原因',
      verdict.reason,
      '',
    ];

    if (verdict.testFailures.length > 0) {
      lines.push('## 测试失败');
      verdict.testFailures.forEach(failure => {
        lines.push(`- ${failure}`);
      });
      lines.push('');
    }

    if (verdict.failedCheckpoints.length > 0) {
      lines.push('## 未通过的检查点');
      verdict.failedCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint}`);
      });
      lines.push('');
    }

    if (verdict.humanVerificationCheckpoints.length > 0) {
      lines.push('## 需要人工验证的检查点');
      verdict.humanVerificationCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint}`);
      });
      lines.push('');
    }

    if (verdict.details) {
      lines.push('## 详细反馈');
      lines.push(verdict.details);
      lines.push('');
    }

    return lines.join('\n');
  }
}
