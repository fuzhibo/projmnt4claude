/**
 * 检查点验证执行器
 *
 * 实现：
 * - 执行 commands 并收集结果
 * - 记录 steps（人工验证提示）
 * - 汇总 result（多 commands/steps 结果合并）
 * - 判断是否符合 expected
 *
 * CP-002+CP-003+CP-005: 补全 commands/steps/expected 执行逻辑
 *
 * @module checkpoint-executor
 */

import type { CheckpointMetadata } from '../types/task.js';
import { SafeCommandExecutor } from './safe-command-executor.js';

/**
 * 单个命令执行结果
 */
export interface CommandExecutionResult {
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/**
 * 检查点验证执行结果
 */
export interface CheckpointExecutionResult {
  /** 汇总 result 字符串 */
  result: string;
  /** 是否通过 */
  passed: boolean;
  /** 各命令执行详情 */
  commandResults?: CommandExecutionResult[];
  /** steps 待验证列表 */
  pendingSteps?: string[];
  /** 执行时间（ISO） */
  executedAt: string;
}

/**
 * 执行检查点验证并汇总 result
 *
 * 流程：
 * 1. 执行 commands 列表中的每个命令
 * 2. 记录 steps（人工验证项）
 * 3. 汇总所有结果到 result 字符串
 * 4. 判断是否符合 expected
 *
 * @param checkpoint - 检查点元数据
 * @param cwd - 工作目录
 * @param timeout - 命令超时时间（毫秒，默认 30000）
 * @returns 执行结果
 */
export async function executeCheckpointVerification(
  checkpoint: CheckpointMetadata,
  cwd: string = process.cwd(),
  timeout: number = 30000
): Promise<CheckpointExecutionResult> {
  const verification = checkpoint.verification;
  const results: string[] = [];
  const commandResults: CommandExecutionResult[] = [];
  const pendingSteps: string[] = [];
  let allCommandsPassed = true;
  const now = new Date().toISOString();

  // 1. 执行 commands
  if (verification?.commands && verification.commands.length > 0) {
    for (const cmd of verification.commands) {
      const cmdResult = await executeCommand(cmd, cwd, timeout);
      commandResults.push(cmdResult);

      const status = cmdResult.passed ? 'PASS' : 'FAIL';
      results.push(`${cmd}: ${status} (exit=${cmdResult.exitCode})`);

      if (!cmdResult.passed) {
        allCommandsPassed = false;
      }
    }
  }

  // 2. 记录 steps（人工验证项）
  if (verification?.steps && verification.steps.length > 0) {
    for (const step of verification.steps) {
      pendingSteps.push(step);
      results.push(`Step: ${step} (待人工验证)`);
    }
  }

  // 3. 汇总结果
  const result = results.join('\n');

  // 4. 判断是否符合 expected
  const expectedMatch = checkExpected(result, verification?.expected || '');

  // 5. 综合判断是否通过
  // - 所有 commands 必须通过
  // - expected 必须匹配（如果有）
  // - steps 不影响自动判断（需要人工验证）
  const passed = allCommandsPassed && expectedMatch;

  return {
    result,
    passed,
    commandResults: commandResults.length > 0 ? commandResults : undefined,
    pendingSteps: pendingSteps.length > 0 ? pendingSteps : undefined,
    executedAt: now,
  };
}

/**
 * 执行单个命令
 *
 * @param cmd - 命令字符串
 * @param cwd - 工作目录
 * @param timeout - 超时时间
 * @returns 命令执行结果
 */
async function executeCommand(
  cmd: string,
  cwd: string,
  timeout: number
): Promise<CommandExecutionResult> {
  const startTime = Date.now();
  const executor = new SafeCommandExecutor();

  try {
    const result = await executor.execute(cmd, {
      cwd,
      timeout,
    });

    const duration = Date.now() - startTime;

    return {
      command: cmd,
      passed: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      command: cmd,
      passed: false,
      exitCode: -1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

/**
 * 判断结果是否符合 expected
 *
 * 匹配规则：
 * - expected 为空：返回 true
 * - expected 包含关键词：result 必须包含所有关键词（逗号分隔）
 *
 * @param result - 执行结果字符串
 * @param expected - 预期结果
 * @returns 是否匹配
 */
export function checkExpected(result: string, expected: string): boolean {
  if (!expected || expected.trim() === '') {
    return true;
  }

  // 逗号分隔关键词，所有关键词都必须在 result 中出现
  const keywords = expected.split(',').map(k => k.trim().toLowerCase());

  const lowerResult = result.toLowerCase();

  return keywords.every(k => {
    // 支持简单模式匹配
    if (k.startsWith('no ') || k.startsWith('无')) {
      // 否定匹配：result 不应包含某内容
      const negatedContent = k.replace(/^no\s+/, '').replace(/^无/, '');
      return !lowerResult.includes(negatedContent.toLowerCase());
    }
    return lowerResult.includes(k);
  });
}

/**
 * 更新检查点 verification 的 result 字段
 *
 * @param checkpoint - 检查点元数据（会被直接修改）
 * @param execResult - 执行结果
 * @returns 更新后的检查点
 */
export function updateCheckpointResult(
  checkpoint: CheckpointMetadata,
  execResult: CheckpointExecutionResult
): CheckpointMetadata {
  if (!checkpoint.verification) {
    checkpoint.verification = {
      method: 'automated',
    };
  }

  checkpoint.verification.result = execResult.result;
  checkpoint.verification.exitCode = execResult.commandResults
    ?.find(r => !r.passed)?.exitCode ?? 0;
  checkpoint.verification.verifiedAt = execResult.executedAt;
  checkpoint.verification.verifiedBy = 'checkpoint-executor';

  // 更新 details
  if (execResult.pendingSteps && execResult.pendingSteps.length > 0) {
    checkpoint.verification.details = {
      type: 'automated',
      missingOutputs: execResult.pendingSteps,
    };
  }

  // 更新状态
  checkpoint.status = execResult.passed ? 'completed' : 'failed';
  checkpoint.updatedAt = execResult.executedAt;

  return checkpoint;
}

/**
 * 批量执行检查点验证
 *
 * @param checkpoints - 检查点数组
 * @param cwd - 工作目录
 * @returns 执行结果数组
 */
export async function executeCheckpointVerificationBatch(
  checkpoints: CheckpointMetadata[],
  cwd: string = process.cwd()
): Promise<CheckpointExecutionResult[]> {
  const results: CheckpointExecutionResult[] = [];

  for (const checkpoint of checkpoints) {
    // 只执行 pending 状态的检查点
    if (checkpoint.status !== 'pending') {
      continue;
    }

    // 跳过需要人工验证的检查点
    if (checkpoint.requiresHuman) {
      results.push({
        result: '需要人工验证',
        passed: false,
        pendingSteps: checkpoint.verification?.steps,
        executedAt: new Date().toISOString(),
      });
      continue;
    }

    const result = await executeCheckpointVerification(checkpoint, cwd);
    results.push(result);
  }

  return results;
}