/**
 * gateCheckAndFix 核心算法
 *
 * 门禁失败 → AI 修正 → 对齐验证 → 重试闭环
 * 超过最大重试次数后归档清理
 */

import type {
  GateDependencies,
  GateFixResult,
  AlignmentResult,
  GateFailure,
  ConversionState,
} from './types.js';
import { DEFAULT_QUALITY_GATE_CONFIG } from './types.js';
import { loadAndRenderTemplate } from '../prompt-templates/loader.js';

const MAX_RETRIES = 3;

/**
 * 核心门禁检查与修正循环
 *
 * 1. 运行门禁检查（preDevGate + qualityGate + 依赖检查）
 * 2. 若门禁通过 → completed
 * 3. 若门禁失败 → 收集失败原因
 * 4. AI 修正 → 写入任务元数据
 * 5. 对齐验证（三层：原因/方案/检查点）
 * 6. 若未对齐 → 注入 issues → 重新修正
 * 7. 若对齐 → 重门禁检查
 * 8. 超过最大重试 → 归档清理
 */
export async function gateCheckAndFix(
  params: {
    taskId: string;
    reportPath: string;
    investigationDir: string;
    cwd: string;
    maxRetries?: number;
    isResumed?: boolean;
  },
  deps: GateDependencies,
): Promise<GateFixResult> {
  const {
    taskId,
    reportPath,
    investigationDir,
    cwd,
    maxRetries = MAX_RETRIES,
    isResumed = false,
  } = params;

  let attempt = 0;
  let lastFailures: string[] = [];

  while (attempt < maxRetries) {
    attempt++;

    // Step 1: 运行门禁检查
    const gateResult = await runGateCheck(taskId, cwd, attempt, maxRetries, isResumed, deps);

    // 收集门禁失败原因
    if (!gateResult.passed) {
      lastFailures = gateResult.failures.map(f => `${f.source}: ${f.detail}`);
      deps.updateConversionStatus(investigationDir, reportPath, 'failed', {
        taskId,
        lastError: lastFailures.join('; '),
        lastAttemptAt: new Date().toISOString(),
      });

      // Step 2: AI 修正（仅门禁失败时）
      const fixResult = await runAIFix(taskId, cwd, gateResult.failures, deps);
      if (!fixResult.success) {
        continue; // AI 修正失败，重试
      }
    }

    // Step 3: 对齐验证（门禁通过或 AI 修正后）
    const alignmentResult = await runAlignmentVerification(reportPath, taskId, cwd, deps);
    if (!alignmentResult.aligned) {
      // 注入 issues 到任务元数据
      await injectAlignmentIssues(taskId, cwd, alignmentResult, deps);
      lastFailures = alignmentResult.issues;
      deps.updateConversionStatus(investigationDir, reportPath, 'failed', {
        taskId,
        lastError: `Alignment failed: ${alignmentResult.issues.join('; ')}`,
        lastAttemptAt: new Date().toISOString(),
      });

      // AI 修正（带对齐问题）
      const alignmentIssuesStr = alignmentResult.issues.join('\n');
      const fixResult = await runAIFix(taskId, cwd, [], deps, alignmentIssuesStr);
      if (!fixResult.success) {
        continue; // AI 修正失败，重试
      }
      continue;
    }

    // Step 4: 门禁通过 + 对齐通过 → 完成
    deps.updateConversionStatus(investigationDir, reportPath, 'completed', {
      taskId,
    });
    return { passed: true, taskId, attempt };
  }

  // 超过最大重试次数 → 归档清理
  await archiveAndCleanup(taskId, investigationDir, reportPath, lastFailures, deps);

  return {
    passed: false,
    taskId,
    attempt,
    failures: lastFailures,
    cleanedUp: true,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 运行门禁检查：preDevGate + qualityGate + 依赖检查 */
async function runGateCheck(
  taskId: string,
  cwd: string,
  attempt: number,
  maxRetries: number,
  isResumed: boolean,
  deps: GateDependencies,
): Promise<{ passed: boolean; failures: GateFailure[] }> {
  const failures: GateFailure[] = [];

  // preDevGate 检查
  const preDevResult = await deps.runPreDevGate({
    taskId,
    task: deps.readTaskMeta(taskId, cwd),
    cwd,
    attempt,
    maxRetries,
    isResumed,
  });
  if (!preDevResult.passed) {
    failures.push({
      source: 'preDevGate',
      detail: 'Pre-dev gate failed',
      ruleResults: preDevResult.ruleResults,
      suggestions: preDevResult.ruleResults?.flatMap(r => r.checkResults?.map(c => c.message) ?? []).filter(Boolean),
    });
  }

  // qualityGate 检查
  const qualityResult = await deps.checkQualityGate(
    taskId,
    DEFAULT_QUALITY_GATE_CONFIG,
    cwd,
  );
  if (!qualityResult.passed) {
    failures.push({
      source: 'qualityGate',
      detail: `Quality score ${qualityResult.score.totalScore} below threshold ${DEFAULT_QUALITY_GATE_CONFIG.minQualityScore}`,
      suggestions: qualityResult.suggestions,
    });
  }

  // 依赖检查
  const depsValid = deps.validateNewTaskDeps(taskId);
  if (!depsValid) {
    failures.push({
      source: 'dependencyCheck',
      detail: 'Task has unmet dependencies',
    });
  }

  return { passed: failures.length === 0, failures };
}

/** AI 修正：基于失败原因生成修正方案（使用 taskFix 模板） */
async function runAIFix(
  taskId: string,
  cwd: string,
  failures: GateFailure[],
  deps: GateDependencies,
  alignmentIssues?: string,
): Promise<{ success: boolean }> {
  const gateErrors = failures
    .filter(f => f.source === 'preDevGate' || f.source === 'dependencyCheck')
    .map(f => `- [${f.source}] ${f.detail}`)
    .join('\n');

  const qualityIssues = failures
    .filter(f => f.source === 'qualityGate')
    .map(f => `${f.detail}${f.suggestions ? '\n  Suggestions: ' + f.suggestions.join('; ') : ''}`)
    .join('\n');

  const currentMeta = JSON.stringify(deps.readTaskMeta(taskId, cwd), null, 2);

  const prompt = loadAndRenderTemplate('taskFix', {
    currentMeta,
    gateErrors: gateErrors || 'None',
    qualityIssues: qualityIssues || 'None',
    alignmentIssues: alignmentIssues || 'None',
  });

  const result = await deps.invokeAIAgent(prompt, {
    outputFormat: 'json',
    timeout: 60000,
    allowedTools: ['Read', 'Write', 'Edit'],
    cwd,
  });

  return { success: result.success };
}

/** 对齐验证：三层（原因/方案/检查点） */
async function runAlignmentVerification(
  reportPath: string,
  taskId: string,
  cwd: string,
  deps: GateDependencies,
): Promise<AlignmentResult> {
  return deps.runAlignmentCheck(reportPath, taskId, cwd);
}

/** 注入对齐问题到任务元数据 */
async function injectAlignmentIssues(
  taskId: string,
  cwd: string,
  alignmentResult: AlignmentResult,
  deps: GateDependencies,
): Promise<void> {
  const task = deps.readTaskMeta(taskId, cwd);

  const existingIssues = (task.issues as string[]) || [];
  const newIssues = alignmentResult.issues.filter(i => !existingIssues.includes(i));

  task.issues = [...existingIssues, ...newIssues];
  deps.writeTaskMeta(task, cwd);
}

/** 归档清理：失败任务移至 archive/ 并记录历史 */
async function archiveAndCleanup(
  taskId: string,
  investigationDir: string,
  reportPath: string,
  failures: string[],
  deps: GateDependencies,
): Promise<void> {
  // 移动任务到 archive/
  deps.moveTaskToArchive(taskId, investigationDir);

  // 更新 conversion-status
  deps.updateConversionStatus(investigationDir, reportPath, 'failed', {
    taskId,
    lastError: `Max retries exceeded: ${failures.join('; ')}`,
    lastAttemptAt: new Date().toISOString(),
  });
}