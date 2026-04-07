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
import type {
  HarnessConfig,
  SprintContract,
  DevReport,
  ReviewVerdict,
  EvaluationInferenceType,
} from '../types/harness.js';
import type { TaskMeta } from '../types/task.js';
import { getProjectDir } from './path.js';
import { readTaskMeta, getAllTaskIds } from './task.js';
import { archiveReportIfExists, parseStructuredResult } from './harness-helpers.js';
import { getAgent } from './headless-agent.js';
import { detectContradiction } from './contradiction-detector.js';

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
      verdict.inferenceType = 'explicit_match'; // 开发阶段直接判定，非解析推断
      if (devReport.error) {
        verdict.reason += ` - ${devReport.error}`;
      }
      await this.saveReviewReport(task.id, verdict, devReport);
      return verdict;
    }

    try {
      // 1. 加载 Sprint Contract（从文件系统，确保隔离）
      // BUG-013-1: 安全合并，仅覆盖已验证的字段
      const loadedContract = this.loadContract(task.id);
      if (loadedContract) {
        // 仅在加载值非空时覆盖，防止用 undefined 覆盖默认值
        contract.taskId = loadedContract.taskId;
        contract.acceptanceCriteria = loadedContract.acceptanceCriteria.length > 0
          ? loadedContract.acceptanceCriteria : contract.acceptanceCriteria;
        contract.verificationCommands = loadedContract.verificationCommands.length > 0
          ? loadedContract.verificationCommands : contract.verificationCommands;
        contract.checkpoints = loadedContract.checkpoints.length > 0
          ? loadedContract.checkpoints : contract.checkpoints;
        contract.createdAt = loadedContract.createdAt;
        contract.updatedAt = loadedContract.updatedAt;
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
        verdict.inferenceType = 'explicit_match'; // 幽灵任务是确定性检测，非解析推断
        console.log(`\n   ❌ 检测到幽灵任务，自动 NOPASS`);

        await this.saveReviewReport(task.id, verdict, devReport);
        return verdict;
      }

      // 3. 构建评估提示词
      const prompt = this.buildEvaluationPrompt(task, devReport, contract, phantomTasks);
      console.log('\n   📝 评估提示词已生成');

      // 4. 运行评估会话（带格式重试，最多 2 次）
      const MAX_PARSE_RETRIES = 2;
      let evaluation: ReturnType<typeof this.parseEvaluationResult> | null = null;
      let lastRawOutput = '';

      for (let parseAttempt = 0; parseAttempt <= MAX_PARSE_RETRIES; parseAttempt++) {
        const currentPrompt = parseAttempt === 0
          ? prompt
          : this.buildRetryPrompt(lastRawOutput);

        if (parseAttempt > 0) {
          console.log(`   🔄 评估结果格式不匹配，重新评估 (${parseAttempt}/${MAX_PARSE_RETRIES})...`);
        } else {
          console.log('\n   🔍 启动独立评估会话...');
        }

        const agent = getAgent(this.config.cwd);
        const result = await agent.invoke(currentPrompt, {
          allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
          timeout: Math.floor(this.config.timeout / 2), // 审查时间较短
          outputFormat: 'text',
          maxRetries: this.config.apiRetryAttempts,
          cwd: this.config.cwd,
          dangerouslySkipPermissions: true,
        });

        // 4.5 保存原始评估输出（用于事后诊断）
        this.saveRawEvaluationOutput(task.id, result.output, result.stderr || '', result.success);

        // 4.6 检测空输出（Claude 进程异常退出）
        if (!result.output || result.output.trim().length === 0) {
          verdict.result = 'NOPASS';
          verdict.reason = `评估会话输出为空：Claude 进程可能异常退出${result.stderr ? ` (stderr: ${result.stderr.substring(0, 200)})` : ''}`;
          verdict.inferenceType = 'empty_output';
          console.log('\n   ❌ 评估输出为空，Claude 进程可能异常退出');
          if (result.stderr) {
            console.log(`   📝 stderr: ${result.stderr.substring(0, 300)}`);
          }
          await this.saveReviewReport(task.id, verdict, devReport);
          return verdict;
        }

        // 5. 解析评估结果
        evaluation = this.parseEvaluationResult(result.output);

        // 成功匹配则跳出循环
        if (evaluation.inferenceType !== 'parse_failure_default') {
          break;
        }

        lastRawOutput = result.output;
      }

      // CP-16: 重试后仍无法解析时，默认 PASS（保守策略）
      if (evaluation!.inferenceType === 'parse_failure_default') {
        console.log('   ⚠️ 重试后仍无法解析评估结果，默认 PASS（保守策略）');
        evaluation = {
          ...evaluation!,
          passed: true,
          reason: `重试 ${MAX_PARSE_RETRIES} 次后仍无法解析评估结果，采用保守策略默认通过`,
        };
      }

      verdict.result = evaluation!.passed ? 'PASS' : 'NOPASS';
      verdict.reason = evaluation!.reason;
      verdict.failedCriteria = evaluation!.failedCriteria;
      verdict.failedCheckpoints = evaluation!.failedCheckpoints;
      verdict.details = evaluation!.details;
      verdict.action = evaluation!.action as any;
      verdict.failureCategory = evaluation!.failureCategory as any;
      verdict.inferenceType = evaluation!.inferenceType;

      // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
      const contradiction = detectContradiction(verdict.result, lastRawOutput || verdict.reason || '');
      if (contradiction.hasContradiction && contradiction.correctedResult) {
        console.log(`   ⚠️  矛盾检测: ${contradiction.reason}`);
        verdict.result = contradiction.correctedResult;
        verdict.reason += ` [矛盾修正: ${contradiction.reason}]`;
      }

      if (verdict.result === 'PASS') {
        console.log(`\n   ✅ 审查通过 [推断类型: ${verdict.inferenceType || 'unknown'}]`);
      } else {
        console.log(`\n   ❌ 审查未通过 [推断类型: ${verdict.inferenceType || 'unknown'}]: ${verdict.reason}`);
      }

    } catch (error) {
      verdict.result = 'NOPASS';
      verdict.reason = `评估过程出错: ${error instanceof Error ? error.message : String(error)}`;
      verdict.inferenceType = 'parse_failure_default';
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
    // BUG-013-1: 防御性处理，确保数组字段始终为有效数组
    const contractCheckpoints = Array.isArray(contract.checkpoints) ? contract.checkpoints : [];
    const contractCriteria = Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria : [];
    const contractCommands = Array.isArray(contract.verificationCommands) ? contract.verificationCommands : [];
    const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];
    const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];

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
    const filteredContractCheckpoints = contractCheckpoints.filter(cp => !isHumanCheckpoint(cp));
    const filteredDevCheckpoints = devCheckpointsCompleted.filter(cp => !isHumanCheckpoint(cp));

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
    if (contractCriteria.length > 0) {
      contractCriteria.forEach((criteria, i) => {
        parts.push(`${i + 1}. ${criteria}`);
      });
    } else {
      parts.push('（未定义具体验收标准，请根据任务描述判断）');
    }
    parts.push('');

    if (contractCommands.length > 0) {
      parts.push('## 验证命令');
      parts.push('请运行以下命令验证实现:');
      parts.push('```bash');
      contractCommands.forEach(cmd => {
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

    if (devEvidence.length > 0) {
      parts.push('## 提交的证据');
      parts.push('开发者提交了以下证据:');
      devEvidence.forEach(evidence => {
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

    parts.push('## 输出格式（严格遵守）');
    parts.push('');
    parts.push('**强制要求**: 你的输出必须以以下两行标记开头:');
    parts.push('```');
    parts.push('EVALUATION_RESULT: PASS');
    parts.push('EVALUATION_REASON: [简要说明为什么通过或不通过]');
    parts.push('```');
    parts.push('或:');
    parts.push('```');
    parts.push('EVALUATION_RESULT: NOPASS');
    parts.push('EVALUATION_REASON: [简要说明为什么通过或不通过]');
    parts.push('```');
    parts.push('');
    parts.push('然后按以下 Markdown 格式输出详细评估:');
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
    parts.push('- 必须输出 EVALUATION_RESULT: PASS 或 EVALUATION_RESULT: NOPASS 标记行');
    parts.push('- 如果你认为任务通过，必须输出 PASS（不是"通过"、"满足"等词语）');
    parts.push('- 如果你认为任务未通过，必须输出 NOPASS（不是"不通过"、"未满足"等词语）');
    parts.push('');
    parts.push('**正确示例（通过）**:');
    parts.push('```');
    parts.push('EVALUATION_RESULT: PASS');
    parts.push('EVALUATION_REASON: 所有验收标准已满足，代码质量良好');
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
    parts.push('EVALUATION_RESULT: NOPASS');
    parts.push('EVALUATION_REASON: 缺少单元测试，构建失败');
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
    parts.push('所有验收标准均已满足，实现清晰。  ← 错误：缺少 EVALUATION_RESULT 标记');
    parts.push('EVALUATION_RESULT: 通过  ← 错误：使用了"通过"而非 PASS');
    parts.push('EVALUATION_RESULT: 不通过  ← 错误：使用了"不通过"而非 NOPASS');
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
   * 构建格式重试提示词
   *
   * 当评估输出未包含 EVALUATION_RESULT 标记时，
   * 使用此提示词要求重新按格式输出
   */
  private buildRetryPrompt(previousOutput: string): string {
    const parts: string[] = [];
    parts.push('# 评估结果格式纠正');
    parts.push('');
    parts.push('上一次评估输出未包含要求的格式标记。请基于上次评估内容重新输出。');
    parts.push('');
    parts.push('**强制格式要求**: 输出必须包含以下两行:');
    parts.push('```');
    parts.push('EVALUATION_RESULT: PASS');
    parts.push('EVALUATION_REASON: [简要说明]');
    parts.push('```');
    parts.push('或:');
    parts.push('```');
    parts.push('EVALUATION_RESULT: NOPASS');
    parts.push('EVALUATION_REASON: [简要说明]');
    parts.push('```');
    parts.push('');
    parts.push('同时提供 Markdown 格式的详细评估:');
    parts.push('```');
    parts.push('## 评估结果: PASS 或 NOPASS');
    parts.push('## 原因: [简要说明]');
    parts.push('## 后续动作: [resolve|redevelop|retest|reevaluate|escalate_human]');
    parts.push('## 失败分类: [acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other]');
    parts.push('## 未满足的标准: [列出未满足的验收标准]');
    parts.push('## 未完成的检查点: [列出未完成的检查点]');
    parts.push('## 详细反馈: [可选的详细反馈]');
    parts.push('```');
    parts.push('');
    parts.push('上一次评估输出:');
    parts.push('```');
    parts.push(previousOutput.substring(0, 2000));
    parts.push('```');
    parts.push('');
    parts.push('请基于上次评估内容，按上述格式重新输出结果。');
    return parts.join('\n');
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
    inferenceType: EvaluationInferenceType;
  } {
    const result = {
      passed: false,
      reason: '',
      failedCriteria: [] as string[],
      failedCheckpoints: [] as string[],
      details: '',
      action: undefined as string | undefined,
      failureCategory: undefined as string | undefined,
      inferenceType: 'parse_failure_default' as EvaluationInferenceType,
    };

    // 空输出早期返回：Claude 进程异常退出导致 stdout 为空
    if (!output || output.trim().length === 0) {
      result.reason = '评估输出为空，无法解析评估结果';
      result.inferenceType = 'empty_output';
      return result;
    }

    // 使用结构化关键词匹配（替代多模式匹配和中文情感判断）
    const structured = parseStructuredResult(output);
    if (structured.passed !== null) {
      result.passed = structured.passed;
      result.inferenceType = structured.matchLevel === 1 ? 'structured_match' : 'explicit_match';
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

    // 如果没有提取到原因，设置默认值
    if (!result.reason) {
      if (result.passed) {
        result.reason = '基于结构化关键词匹配：评估通过';
      } else if (structured.passed !== null) {
        result.reason = '基于结构化关键词匹配：评估未通过';
      } else {
        result.reason = '无法解析评估结果';
        result.inferenceType = 'parse_failure_default';
        console.log('   ⚠️  解析失败，原始输出前500字符:');
        console.log(output.substring(0, 500));
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
   * 验证并规范化 SprintContract 数据
   * BUG-013-1: 防止 contract.json 字段缺失导致下游 TypeError
   */
  private validateSprintContract(raw: unknown, taskId: string): SprintContract | null {
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return null;
    }

    const obj = raw as Record<string, unknown>;

    // taskId 必须匹配或至少存在
    if (obj.taskId !== undefined && typeof obj.taskId !== 'string') {
      return null;
    }

    // 确保数组字段为数组类型，否则使用默认空数组
    const normalizeStringArray = (field: string): string[] => {
      const val = obj[field];
      return Array.isArray(val) ? val.filter(v => typeof v === 'string') : [];
    };

    // 时间字段必须是字符串
    const normalizeTimestamp = (field: string, fallback: string): string => {
      const val = obj[field];
      return typeof val === 'string' ? val : fallback;
    };

    const now = new Date().toISOString();
    return {
      taskId: typeof obj.taskId === 'string' ? obj.taskId : taskId,
      acceptanceCriteria: normalizeStringArray('acceptanceCriteria'),
      verificationCommands: normalizeStringArray('verificationCommands'),
      checkpoints: normalizeStringArray('checkpoints'),
      createdAt: normalizeTimestamp('createdAt', now),
      updatedAt: normalizeTimestamp('updatedAt', now),
    };
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
      const parsed = JSON.parse(content);
      const validated = this.validateSprintContract(parsed, taskId);
      if (!validated) {
        console.warn(`   ⚠️ contract.json 存在但数据无效，使用默认 Contract`);
      }
      return validated;
    } catch (error) {
      console.warn(`   ⚠️ contract.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
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

    archiveReportIfExists(reportPath);
    const content = this.formatReviewReport(verdict, devReport);
    fs.writeFileSync(reportPath, content, 'utf-8');
  }

  /**
   * 保存原始评估输出（用于事后诊断）
   *
   * 当评估会话输出为空或解析失败时，原始输出和 stderr 可用于排查：
   * - Claude 进程是否异常退出（SIGKILL/OOM）
   * - API 限流/认证错误信息
   * - 网络超时细节
   */
  private saveRawEvaluationOutput(
    taskId: string,
    output: string,
    stderr: string,
    success: boolean
  ): void {
    try {
      const projectDir = getProjectDir(this.config.cwd);
      const dir = path.join(projectDir, 'reports', 'harness', taskId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rawPath = path.join(dir, `evaluation-raw-${timestamp}.log`);

      const lines = [
        `# 评估会话原始输出`,
        `Task: ${taskId}`,
        `Time: ${new Date().toISOString()}`,
        `Success: ${success}`,
        `Output length: ${output.length}`,
        `Stderr length: ${stderr.length}`,
        '',
        '--- STDOUT ---',
        output || '(empty)',
        '',
        '--- STDERR ---',
        stderr || '(empty)',
      ];

      fs.writeFileSync(rawPath, lines.join('\n'), 'utf-8');
      console.log(`   📄 原始评估输出已保存: evaluation-raw-${timestamp}.log`);
    } catch (error) {
      // 日志保存失败不中断主流程
      console.warn(`   ⚠️ 保存原始评估输出失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 格式化审查报告
   */
  private formatReviewReport(verdict: ReviewVerdict, devReport: DevReport): string {
    const INFERENCE_TYPE_LABELS: Record<string, string> = {
      structured_match: '结构化匹配',
      explicit_match: '明确匹配',
      content_inference: '内容推断',
      prior_stage_inference: '前置阶段推断',
      parse_failure_default: '解析失败默认',
      empty_output: '空输出',
    };

    const lines: string[] = [
      `# 审查报告 - ${verdict.taskId}`,
      '',
      `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**审查时间**: ${verdict.reviewedAt}`,
      `**审查者**: ${verdict.reviewedBy}`,
    ];

    if (verdict.inferenceType) {
      lines.push(`**推断类型**: ${INFERENCE_TYPE_LABELS[verdict.inferenceType] || verdict.inferenceType} (${verdict.inferenceType})`);
    }

    lines.push('');
    lines.push('## 原因');
    lines.push(verdict.reason);
    lines.push('');

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

    // BUG-013-1: 防御性处理，确保数组字段存在
    const devEvidence = Array.isArray(devReport.evidence) ? devReport.evidence : [];
    const devCheckpointsCompleted = Array.isArray(devReport.checkpointsCompleted) ? devReport.checkpointsCompleted : [];

    lines.push('## 开发阶段信息');
    lines.push(`- 状态: ${devReport.status}`);
    lines.push(`- 耗时: ${(devReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- 证据数量: ${devEvidence.length}`);
    lines.push(`- 完成检查点: ${devCheckpointsCompleted.length}`);

    return lines.join('\n');
  }
}
