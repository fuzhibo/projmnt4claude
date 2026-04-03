/**
 * HarnessEvaluator - 审查阶段评估器
 *
 * 关键特性：上下文隔离
 * - 在独立的 Claude 会话中执行
 * - 无法访问开发阶段的上下文
 * - 只通过文件系统获取信息
 * - 独立判断开发结果是否满足验收标准
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type {
  HarnessConfig,
  SprintContract,
  DevReport,
  ReviewVerdict,
  HeadlessClaudeOptions,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { getProjectDir } from './path.js';
import { readTaskMeta, getAllTaskIds } from './task.js';
import { classifyExitResult } from './harness-helpers.js';

/**
 * 检测是否为可重试的 API 错误
 */
function isRetryableError(output: string, stderr: string): { retryable: boolean; waitSeconds?: number; reason?: string } {
  const combinedOutput = `${output} ${stderr}`;

  // 429 Rate Limit
  const rateLimitMatch = combinedOutput.match(/API Error:\s*429.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (rateLimitMatch) {
    const resetTime = new Date(rateLimitMatch[1]!);
    const now = new Date();
    const waitSeconds = Math.max(60, Math.ceil((resetTime.getTime() - now.getTime()) / 1000));
    return { retryable: true, waitSeconds, reason: 'API 速率限制 (429)' };
  }

  // 500 Server Error
  if (combinedOutput.includes('API Error: 500') || combinedOutput.includes('"code":"500"')) {
    return { retryable: true, waitSeconds: 30, reason: 'API 服务器错误 (500)' };
  }

  // Network/Connection errors
  if (combinedOutput.includes('ECONNRESET') ||
      combinedOutput.includes('ETIMEDOUT') ||
      combinedOutput.includes('ENOTFOUND') ||
      combinedOutput.includes('network error')) {
    return { retryable: true, waitSeconds: 10, reason: '网络连接错误' };
  }

  return { retryable: false };
}

/**
 * 延迟函数
 */
function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export class HarnessEvaluator {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * 评估开发结果
   *
   * 关键：此方法在独立上下文中运行，不共享开发阶段的任何状态
   */
  async evaluate(
    task: TaskMeta,
    devReport: DevReport,
    contract: SprintContract
  ): Promise<ReviewVerdict> {
    console.log(`   评估任务: ${task.title}`);
    console.log(`   开发状态: ${devReport.status}`);

    const verdict: ReviewVerdict = {
      taskId: task.id,
      result: 'NOPASS',
      reason: '',
      failedCriteria: [],
      failedCheckpoints: [],
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'harness-evaluator',
    };

    // 如果开发阶段失败，直接返回 NOPASS
    if (devReport.status !== 'success') {
      verdict.result = 'NOPASS';
      verdict.reason = `开发阶段未成功完成: ${devReport.status}`;
      if (devReport.error) {
        verdict.reason += ` - ${devReport.error}`;
      }
      await this.saveReviewReport(task.id, verdict, devReport);
      return verdict;
    }

    try {
      // 1. 加载 Sprint Contract（从文件系统，确保隔离）
      const loadedContract = this.loadContract(task.id);
      if (loadedContract) {
        Object.assign(contract, loadedContract);
      }

      // 2. 检测幽灵任务（开发者在执行期间创建的额外任务）
      const phantomTasks = this.detectPhantomTasks(task.id, devReport);

      // 幽灵任务为严重违规，自动 NOPASS（无需运行评估会话）
      if (phantomTasks.length > 0) {
        verdict.result = 'NOPASS';
        verdict.reason = `严重违规：开发者在执行期间创建了 ${phantomTasks.length} 个额外任务 (${phantomTasks.join(', ')}). 开发者被严格禁止创建新任务。`;
        verdict.failedCriteria = ['禁止创建新任务'];
        verdict.failedCheckpoints = phantomTasks.map(tid => `幽灵任务: ${tid}`);
        verdict.details = `检测到开发者创建了不属于原始计划的额外任务。这违反了开发者职责范围——开发者只应实现被分配任务的代码变更，而非创建新任务。`;
        console.log(`\n   ❌ 检测到幽灵任务，自动 NOPASS`);

        await this.saveReviewReport(task.id, verdict, devReport);
        return verdict;
      }

      // 3. 构建评估提示词
      const prompt = this.buildEvaluationPrompt(task, devReport, contract, phantomTasks);
      console.log('\n   📝 评估提示词已生成');

      // 4. 运行独立评估会话
      console.log('\n   🔍 启动独立评估会话...');
      const result = await this.runEvaluationSession({
        prompt,
        allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
        timeout: Math.floor(this.config.timeout / 2), // 审查时间较短
        cwd: this.config.cwd,
        outputFormat: 'text',
      });

      // 5. 解析评估结果
      const evaluation = this.parseEvaluationResult(result.output);

      verdict.result = evaluation.passed ? 'PASS' : 'NOPASS';
      verdict.reason = evaluation.reason;
      verdict.failedCriteria = evaluation.failedCriteria;
      verdict.failedCheckpoints = evaluation.failedCheckpoints;
      verdict.details = evaluation.details;
      verdict.action = evaluation.action as any;
      verdict.failureCategory = evaluation.failureCategory as any;

      if (verdict.result === 'PASS') {
        console.log('\n   ✅ 审查通过');
      } else {
        console.log(`\n   ❌ 审查未通过: ${verdict.reason}`);
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `评估过程出错: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ 评估出错: ${verdict.reason}`);
    }

    // 保存审查报告
    await this.saveReviewReport(task.id, verdict, devReport);

    return verdict;
  }

  /**
   * 构建评估提示词
   */
  private buildEvaluationPrompt(
    task: TaskMeta,
    devReport: DevReport,
    contract: SprintContract,
    phantomTasks: string[] = []
  ): string {
    const parts: string[] = [];

    // BUG-014-2A: 过滤掉 requiresHuman 检查点，仅评估自动化检查点
    const humanCheckpointIds = new Set<string>();
    const humanCheckpointDescs = new Set<string>();
    if (task.checkpoints) {
      for (const cp of task.checkpoints) {
        if (cp.requiresHuman === true) {
          humanCheckpointIds.add(cp.id);
          humanCheckpointDescs.add(cp.description);
        }
      }
    }
    const isHumanCheckpoint = (cp: string) =>
      humanCheckpointIds.has(cp) || humanCheckpointDescs.has(cp);
    const filteredContractCheckpoints = contract.checkpoints.filter(cp => !isHumanCheckpoint(cp));
    const filteredDevCheckpoints = devReport.checkpointsCompleted.filter(cp => !isHumanCheckpoint(cp));

    parts.push('# 架构评估任务');
    parts.push('');
    parts.push('你是一位资深架构师。你需要从架构角度评估任务的完成质量，判断是否满足验收标准，并给出明确的后续动作建议。');
    parts.push('');
    parts.push('**重要**: 你必须独立判断，不要因为这是 AI 完成的工作就给予优待。');
    parts.push('');

    parts.push('## 任务信息');
    parts.push(`- ID: ${task.id}`);
    parts.push(`- 标题: ${task.title}`);
    parts.push(`- 类型: ${task.type}`);
    parts.push('');

    if (task.description) {
      parts.push('## 任务描述');
      parts.push(task.description);
      parts.push('');
    }

    parts.push('## 验收标准');
    if (contract.acceptanceCriteria.length > 0) {
      contract.acceptanceCriteria.forEach((criteria, i) => {
        parts.push(`${i + 1}. ${criteria}`);
      });
    } else {
      parts.push('（未定义具体验收标准，请根据任务描述判断）');
    }
    parts.push('');

    if (contract.verificationCommands.length > 0) {
      parts.push('## 验证命令');
      parts.push('请运行以下命令验证实现:');
      parts.push('```bash');
      contract.verificationCommands.forEach(cmd => {
        parts.push(cmd);
      });
      parts.push('```');
      parts.push('');
    }

    if (filteredContractCheckpoints.length > 0) {
      parts.push('## 检查点');
      parts.push('请确认以下检查点是否完成:');
      filteredContractCheckpoints.forEach((cp, i) => {
        parts.push(`${i + 1}. ${cp}`);
      });
      parts.push('');
    }

    // 注释：需要人工验证的检查点由后处理单独管理，不影响评估结果
    if (humanCheckpointIds.size > 0) {
      parts.push('## 关于人工验证检查点');
      parts.push(`本任务有 ${humanCheckpointIds.size} 个需要人工验证的检查点（如 ${Array.from(humanCheckpointIds).slice(0, 3).join(', ')}）。`);
      parts.push('这些检查点由后处理流程单独管理，不在本评估范围内。请仅基于上方的自动化检查点进行判断。');
      parts.push('');
    }

    if (devReport.evidence.length > 0) {
      parts.push('## 提交的证据');
      parts.push('开发者提交了以下证据:');
      devReport.evidence.forEach(evidence => {
        parts.push(`- ${evidence}`);
      });
      parts.push('');
    }

    if (filteredDevCheckpoints.length > 0) {
      parts.push('## 开发者声明的完成检查点');
      filteredDevCheckpoints.forEach(cp => {
        parts.push(`- ${cp}`);
      });
      parts.push('');
    }

    // 幽灵任务检测报告
    if (phantomTasks.length > 0) {
      parts.push('## ⚠️ 幽灵任务检测');
      parts.push(`**严重违规**: 开发者在执行任务期间创建了 ${phantomTasks.length} 个额外任务:`);
      phantomTasks.forEach(tid => {
        parts.push(`- ${tid}`);
      });
      parts.push('');
      parts.push('开发者被严格禁止创建新任务。这是一个自动 NOPASS 的严重违规。');
      parts.push('请在评估结果中明确标注此违规，并将结果设为 NOPASS。');
      parts.push('');
    }

    parts.push('## 评估要求');
    parts.push('1. 阅读任务描述和验收标准');
    parts.push('2. 检查相关代码文件');
    parts.push('3. 运行验证命令（如有）');
    parts.push('4. 验证每个验收标准是否满足');
    parts.push('5. 检查代码质量（可读性、可维护性）');
    parts.push('6. 检查开发者是否违反禁止操作（特别是是否创建了额外任务）');
    parts.push('');

    parts.push('## 输出格式');
    parts.push('请按以下格式输出评估结果:');
    parts.push('```');
    parts.push('## 评估结果: PASS 或 NOPASS');
    parts.push('## 原因: [简要说明为什么通过或不通过]');
    parts.push('## 后续动作: [resolve|redevelop|retest|reevaluate|escalate_human]');
    parts.push('## 失败分类: [acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other]');
    parts.push('## 未满足的标准: [列出未满足的验收标准，如果没有则为空]');
    parts.push('## 未完成的检查点: [列出未完成的检查点，如果没有则为空]');
    parts.push('## 详细反馈: [可选的详细反馈]');
    parts.push('```');
    parts.push('');
    parts.push('**重要格式要求**:');
    parts.push('- 你必须严格按照上述格式输出，不得省略或修改格式');
    parts.push('- 如果你认为任务通过，必须输出 "## 评估结果: PASS"（不是"通过"、"满足"等词语）');
    parts.push('- 如果你认为任务未通过，必须输出 "## 评估结果: NOPASS"（不是"不通过"、"未满足"等词语）');
    parts.push('- 第一行必须是 "## 评估结果: PASS" 或 "## 评估结果: NOPASS"');
    parts.push('');
    parts.push('**正确示例（通过）**:');
    parts.push('```');
    parts.push('## 评估结果: PASS');
    parts.push('## 原因: 所有验收标准已满足，代码质量良好');
    parts.push('## 后续动作: resolve');
    parts.push('## 失败分类: ');
    parts.push('## 未满足的标准: ');
    parts.push('## 未完成的检查点: ');
    parts.push('## 详细反馈: 实现完整，代码清晰。');
    parts.push('```');
    parts.push('');
    parts.push('**正确示例（未通过）**:');
    parts.push('```');
    parts.push('## 评估结果: NOPASS');
    parts.push('## 原因: 缺少单元测试，构建失败');
    parts.push('## 后续动作: redevelop');
    parts.push('## 失败分类: test_failure');
    parts.push('## 未满足的标准: - 所有测试通过');
    parts.push('## 未完成的检查点: - CP-bun-run-build-零错误');
    parts.push('## 详细反馈: 开发者未编写任何测试。');
    parts.push('```');
    parts.push('');
    parts.push('**错误示例（严禁这样输出）**:');
    parts.push('```');
    parts.push('所有验收标准均已满足，实现清晰。  ← 错误：缺少格式标记');
    parts.push('## 评估结果: 通过  ← 错误：使用了"通过"而非 PASS');
    parts.push('## 评估结果: 不通过  ← 错误：使用了"不通过"而非 NOPASS');
    parts.push('```');
    parts.push('');
    parts.push('**动作说明（评估结果为 NOPASS 时必须填写）**:');
    parts.push('- resolve: 评估通过，任务可以完成（仅 PASS 时使用）');
    parts.push('- redevelop: 实现有严重问题，需要从开发阶段重新开始');
    parts.push('- retest: 实现基本OK但测试未通过，从QA阶段重试即可');
    parts.push('- reevaluate: 评估不明确需要更多信息，重新评估');
    parts.push('- escalate_human: 问题超出自动处理范围，需要人工介入');
    parts.push('');
    parts.push('现在开始评估。');

    return parts.join('\n');
  }

  /**
   * 运行评估会话（带重试机制）
   */
  private async runEvaluationSession(options: HeadlessClaudeOptions): Promise<{ output: string; success: boolean }> {
    const maxAttempts = this.config.apiRetryAttempts + 1;
    const baseDelay = this.config.apiRetryDelay;
    let lastOutput = '';
    let lastStderr = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`   🔄 评估会话重试 (${attempt - 1}/${this.config.apiRetryAttempts})...`);
      }

      const result = await this.executeEvaluationSession(options);
      lastOutput = result.output;
      lastStderr = result.stderr;

      if (result.success) {
        return { output: result.output, success: true };
      }

      // 检查是否为可重试错误
      const errorInfo = isRetryableError(result.output, result.stderr);

      if (!errorInfo.retryable || attempt >= maxAttempts) {
        return { output: result.output, success: false };
      }

      // 计算退避延迟
      const delay = Math.min(errorInfo.waitSeconds || baseDelay, baseDelay * Math.pow(2, attempt - 1));
      console.log(`   ⏳ ${errorInfo.reason}，${delay} 秒后重试...`);

      await sleep(delay);
    }

    return { output: lastOutput, success: false };
  }

  /**
   * 执行单次评估会话
   */
  private executeEvaluationSession(options: HeadlessClaudeOptions): Promise<{ output: string; stderr: string; success: boolean }> {
    return new Promise((resolve) => {
      // 注意：--allowedTools 必须在 --print 之前，否则 Claude CLI 会报错
      // "Input must be provided either through stdin or as a prompt argument when using --print"
      // 注意：prompt 通过 stdin 传递，而不是命令行参数
      // 这样可以避免多行文本作为命令行参数时的解析问题
      const args = [
        '--allowedTools', options.allowedTools.join(','),
        '--print',
        '--dangerously-skip-permissions',
      ];

      try {
        const child = spawn('claude', args, {
          cwd: options.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],  // stdin 改为 pipe 以支持写入
        });

        // 通过 stdin 传递 prompt
        if (child.stdin) {
          child.stdin.write(options.prompt);
          child.stdin.end();
        }

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // 自定义超时逻辑
        const timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeout * 1000);

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);

          // 超时场景直接失败
          if (timedOut) {
            resolve({
              output: stdout,
              stderr,
              success: false,
            });
            return;
          }

          // 使用共享函数智能判断区分 hook 失败和任务失败
          const classified = classifyExitResult(code, stderr, stdout);
          resolve({
            output: stdout,
            stderr,
            success: classified.success,
          });
        });

        child.on('error', (error) => {
          clearTimeout(timeoutId);
          resolve({
            output: '',
            stderr: error.message,
            success: false,
          });
        });

      } catch (error) {
        resolve({
          output: '',
          stderr: error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
    });
  }

  /**
   * 解析评估结果
   */
  private parseEvaluationResult(output: string): {
    passed: boolean;
    reason: string;
    failedCriteria: string[];
    failedCheckpoints: string[];
    details?: string;
    action?: string;
    failureCategory?: string;
  } {
    const result = {
      passed: false,
      reason: '',
      failedCriteria: [] as string[],
      failedCheckpoints: [] as string[],
      details: '',
      action: undefined as string | undefined,
      failureCategory: undefined as string | undefined,
    };

    // 多模式匹配评估结果
    const resultPatterns = [
      // 标准格式: ## 评估结果: PASS/NOPASS
      /##\s*评估结果\s*[:：]?\s*(PASS|NOPASS)/i,
      // 宽松格式: 评估结果 PASS/NOPASS
      /(?:评估结果|Evaluation Result|Result)[:：]?\s*(PASS|NOPASS)/i,
      // 简单匹配: PASS 或 NOPASS 单独出现
      /\b(PASS|NOPASS)\b/i,
      // JSON 格式: "result": "PASS"
      /"result"\s*[:：]\s*"(PASS|NOPASS)"/i,
    ];

    let resultMatch: RegExpMatchArray | null = null;
    for (const pattern of resultPatterns) {
      resultMatch = output.match(pattern);
      if (resultMatch) {
        result.passed = resultMatch[1]!.toUpperCase() === 'PASS';
        break;
      }
    }

    // 如果没有匹配到，尝试中文判断
    if (!resultMatch) {
      const hasPositive = /(?:通过|✅|成功|符合(?:要求)?|满足(?:标准|要求)?|良好|合格|达标|优秀|验收通过|质量良好)/.test(output);
      const hasNegative = /(?:不通过|未通过|❌|失败|不符合|不满足|未满足|不合格|未达标)/.test(output);
      if (hasPositive && !hasNegative) {
        result.passed = true;
        resultMatch = ['通过', '通过'] as RegExpMatchArray;
      } else if (hasNegative) {
        result.passed = false;
        resultMatch = ['不通过', 'NOPASS'] as RegExpMatchArray;
      }
    }

    // 提取原因 - 多种格式
    const reasonPatterns = [
      /##\s*原因\s*[:：]\s*(.+?)(?=##|$)/si,
      /(?:原因|Reason)[:：]?\s*(.+?)(?=##|##|$)/si,
      /\*\*原因\*\*[:：]?\s*(.+?)(?=\*\*|##|$)/si,
    ];
    for (const pattern of reasonPatterns) {
      const match = output.match(pattern);
      if (match) {
        result.reason = match[1]!.trim();
        break;
      }
    }

    // 提取未满足的标准
    const criteriaPatterns = [
      /##\s*未满足的标准\s*[:：]\s*(.+?)(?=##|$)/si,
      /(?:未满足的标准|Failed Criteria)[:：]?\s*(.+?)(?=##|$)/si,
    ];
    for (const pattern of criteriaPatterns) {
      const match = output.match(pattern);
      if (match) {
        const criteriaText = match[1]!.trim();
        if (criteriaText && criteriaText !== '无' && criteriaText !== 'N/A' && criteriaText !== 'None') {
          result.failedCriteria = criteriaText.split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);
        }
        break;
      }
    }

    // 提取未完成的检查点
    const checkpointsPatterns = [
      /##\s*未完成的检查点\s*[:：]\s*(.+?)(?=##|$)/si,
      /(?:未完成的检查点|Failed Checkpoints)[:：]?\s*(.+?)(?=##|$)/si,
    ];
    for (const pattern of checkpointsPatterns) {
      const match = output.match(pattern);
      if (match) {
        const checkpointsText = match[1]!.trim();
        if (checkpointsText && checkpointsText !== '无' && checkpointsText !== 'N/A' && checkpointsText !== 'None') {
          result.failedCheckpoints = checkpointsText.split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);
        }
        break;
      }
    }

    // 提取详细反馈
    const detailsPatterns = [
      /##\s*详细反馈\s*[:：]\s*(.+?)(?=##|$)/si,
      /(?:详细反馈|Details|Feedback)[:：]?\s*(.+?)(?=##|$)/si,
    ];
    for (const pattern of detailsPatterns) {
      const match = output.match(pattern);
      if (match) {
        result.details = match[1]!.trim();
        break;
      }
    }

    // 提取后续动作（action）
    const actionPatterns = [
      /##\s*后续动作\s*[:：]\s*(resolve|redevelop|retest|reevaluate|escalate_human)/i,
      /(?:后续动作|Action|Verdict Action|Next Action)[:：]?\s*(resolve|redevelop|retest|reevaluate|escalate_human)/i,
    ];
    for (const pattern of actionPatterns) {
      const match = output.match(pattern);
      if (match) {
        result.action = match[1]!.toLowerCase();
        break;
      }
    }

    // 提取失败分类（failureCategory）
    const categoryPatterns = [
      /##\s*失败分类\s*[:：]\s*(acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other)/i,
      /(?:失败分类|Failure Category|Category)[:：]?\s*(acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other)/i,
    ];
    for (const pattern of categoryPatterns) {
      const match = output.match(pattern);
      if (match) {
        result.failureCategory = match[1]!.toLowerCase();
        break;
      }
    }

    // 矛盾检测: 如果结构化格式匹配到 NOPASS，但整体内容全为正向
    if (resultMatch && !result.passed) {
      const posSignals = /(?:满足|通过|符合|良好|合格|达标|优秀|成功|✅)/.test(output);
      const negSignals = /(?:不满足|未满足|不通过|未通过|失败|不符合|不合格|❌)/.test(output);
      if (posSignals && !negSignals) {
        console.warn('   ⚠️ 矛盾检测: NOPASS 结果与正向内容冲突，自动修正为 PASS');
        result.passed = true;
        result.reason = result.reason
          ? `[矛盾修正] ${result.reason}`
          : '原始结果为 NOPASS 但内容仅包含正向评价，已自动修正';
      }
    }

    // 如果没有提取到原因，设置默认值
    if (!result.reason) {
      if (result.passed) {
        result.reason = '基于输出内容的判断：评估通过';
      } else if (resultMatch) {
        result.reason = '基于输出内容的判断：评估未通过';
      } else {
        // 最后尝试：检查是否包含明确的通过/不通过词汇
        const lowerOutput = output.toLowerCase();
        if (lowerOutput.includes('pass') && !lowerOutput.includes('nopass') && !lowerOutput.includes('not pass')) {
          result.passed = true;
          result.reason = '基于输出内容的简单判断：包含 PASS';
        } else if (/(?:审查通过|审核通过|评估通过|验收通过|所有.*满足|全部.*通过|均已满足|完全符合|质量良好)/.test(output)) {
          result.passed = true;
          result.reason = '基于输出内容的简单判断：包含正向通过关键词';
        } else {
          result.reason = '无法解析评估结果';
          // 添加调试信息
          console.log('   ⚠️  解析失败，原始输出前500字符:');
          console.log(output.substring(0, 500));
        }
      }
    }

    return result;
  }

  /**
   * 检测幽灵任务：开发者在执行期间创建的、不属于原始任务计划的额外任务
   *
   * 检测逻辑：对比开发报告的 Claude 输出中是否包含 task create / init-requirement 命令调用，
   * 并检查文件系统中是否存在在开发阶段时间窗口内创建的新任务。
   *
   * @regression BUG-012-2 (2026-04-01)
   * 回归测试案例：2026-04-01 Harness 运行中，BUG-011-1 开发者为演示 auto-split 功能
   * 创建了 ModeRegistry 和 Channel 两个子任务；BUG-011-3 开发者创建了 6 个认证系统测试任务。
   * 这些"幽灵任务"引用不存在的文件，导致后续重试浪费 3600s 执行时间和 API 配额。
   * 本检测方法通过文件系统时间窗口比对来捕获此类违规行为。
   */
  private detectPhantomTasks(currentTaskId: string, devReport: DevReport): string[] {
    const phantomTasks: string[] = [];

    // 1. 从 Claude 输出中检测 task create / init-requirement 命令
    const output = devReport.claudeOutput || '';
    const taskCreatePatterns = [
      /task\s+create/i,
      /init-requirement/i,
      /创建.*任务/,
      /projmnt4claude\s+(task\s+create|init-requirement)/i,
    ];

    const hasCreateCommand = taskCreatePatterns.some(p => p.test(output));

    // 2. 检查文件系统中是否存在由开发者创建的额外任务
    //    通过对比开发时间窗口内的任务创建时间来判断
    try {
      const allTaskIds = getAllTaskIds(this.config.cwd);

      for (const tid of allTaskIds) {
        // 跳过当前任务
        if (tid === currentTaskId) continue;

        const task = readTaskMeta(tid, this.config.cwd);
        if (!task) continue;

        // 检查任务是否在开发时间窗口内创建
        const taskCreatedAt = task.createdAt;
        const devStartTime = devReport.startTime;
        const devEndTime = devReport.endTime;

        if (taskCreatedAt && devStartTime && devEndTime) {
          const created = new Date(taskCreatedAt).getTime();
          const start = new Date(devStartTime).getTime();
          const end = new Date(devEndTime).getTime();

          // 任务在开发窗口内创建（允许 60 秒误差）
          if (created >= start - 60000 && created <= end + 60000) {
            phantomTasks.push(tid);
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️ 幽灵任务检测出错: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. 如果 Claude 输出中包含创建命令但文件系统中未检测到，也记录警告
    if (hasCreateCommand && phantomTasks.length === 0) {
      console.log('   ⚠️ 开发者输出中包含 task create / init-requirement 命令，但未在文件系统中检测到新任务');
      console.log('   ⚠️ 这可能意味着创建操作失败，但意图已存在');
    }

    if (phantomTasks.length > 0) {
      console.log(`   ⚠️ 检测到 ${phantomTasks.length} 个幽灵任务: ${phantomTasks.join(', ')}`);
    }

    return phantomTasks;
  }

  /**
   * 加载 Contract
   */
  private loadContract(taskId: string): SprintContract | null {
    const contractPath = this.getContractPath(taskId);

    if (!fs.existsSync(contractPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(contractPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 获取 Contract 文件路径
   */
  private getContractPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'tasks', taskId, 'contract.json');
  }

  /**
   * 获取审查报告路径
   */
  private getReviewReportPath(taskId: string): string {
    const projectDir = getProjectDir(this.config.cwd);
    return path.join(projectDir, 'reports', 'harness', taskId, 'review-report.md');
  }

  /**
   * 保存审查报告
   */
  private async saveReviewReport(
    taskId: string,
    verdict: ReviewVerdict,
    devReport: DevReport
  ): Promise<void> {
    const reportPath = this.getReviewReportPath(taskId);
    const dir = path.dirname(reportPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = this.formatReviewReport(verdict, devReport);
    fs.writeFileSync(reportPath, content, 'utf-8');
  }

  /**
   * 格式化审查报告
   */
  private formatReviewReport(verdict: ReviewVerdict, devReport: DevReport): string {
    const lines: string[] = [
      `# 审查报告 - ${verdict.taskId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**审查时间**: ${verdict.reviewedAt}`,
      `**审查者**: ${verdict.reviewedBy}`,
      '',
      '## 原因',
      verdict.reason,
      '',
    ];

    if (verdict.failedCriteria.length > 0) {
      lines.push('## 未满足的验收标准');
      verdict.failedCriteria.forEach(criteria => {
        lines.push(`- ${criteria}`);
      });
      lines.push('');
    }

    if (verdict.failedCheckpoints.length > 0) {
      lines.push('## 未完成的检查点');
      verdict.failedCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint}`);
      });
      lines.push('');
    }

    if (verdict.details) {
      lines.push('## 详细反馈');
      lines.push(verdict.details);
      lines.push('');
    }

    lines.push('## 开发阶段信息');
    lines.push(`- 状态: ${devReport.status}`);
    lines.push(`- 耗时: ${(devReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- 证据数量: ${devReport.evidence.length}`);
    lines.push(`- 完成检查点: ${devReport.checkpointsCompleted.length}`);

    return lines.join('\n');
  }
}
