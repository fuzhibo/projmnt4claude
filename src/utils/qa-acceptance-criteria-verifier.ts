/**
 * QA Acceptance Criteria Verifier
 *
 * Implements the four-level acceptance criteria verification hierarchy.
 * Based on hd-p12-qa-pre-gate-design.md §8 supplementary design.
 *
 * @module utils/qa-acceptance-criteria-verifier
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type {
  AcceptanceLevel,
  AcceptanceVerificationResult,
  QAAcceptanceResult,
  ParsedAcceptanceCriterion,
} from '../types/qa-acceptance-criteria.js';
import {
  createDefaultAcceptanceResult,
  createDefaultQAAcceptanceResult,
  ACCEPTANCE_LEVEL_DESCRIPTIONS,
} from '../types/qa-acceptance-criteria.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { AcceptanceCriteriaParser, VerificationContext } from './qa-acceptance-criteria-parser.js';
import { SafeCommandExecutor, createSafeCommandExecutor } from './safe-command-executor.js';

/**
 * QA Acceptance Criteria Verifier
 *
 * Executes the four-level verification hierarchy:
 * 1. Checkpoint verification (required)
 * 2. Build verification (required)
 * 3. Test verification (required)
 * 4. Criteria verification (optional)
 */
export class QAAcceptanceCriteriaVerifier {
  private cwd: string;
  private parser: AcceptanceCriteriaParser;
  private executor: SafeCommandExecutor;

  constructor(cwd: string, executor?: SafeCommandExecutor) {
    this.cwd = cwd;
    this.parser = new AcceptanceCriteriaParser();
    this.executor = executor ?? createSafeCommandExecutor();
  }

  /**
   * Execute full acceptance criteria verification
   *
   * @param task Task metadata
   * @param context Additional verification context
   * @returns Full verification result
   */
  async verify(
    task: TaskMeta,
    context?: Partial<VerificationContext>
  ): Promise<QAAcceptanceResult> {
    const result = createDefaultQAAcceptanceResult(task.id);

    // Level 1: Checkpoint verification (required)
    const checkpointResult = await this.verifyCheckpoints(task);
    result.levelResults.set('checkpoint', checkpointResult);

    // Level 2: Build verification (required)
    const buildResult = await this.verifyBuild(task);
    result.levelResults.set('build', buildResult);

    // Level 3: Test verification (required)
    const testResult = await this.verifyTests(task, context);
    result.levelResults.set('test', testResult);

    // Level 4: Criteria verification (optional, only if task has acceptance criteria)
    const criteria = this.parser.parse(task.description || '');
    if (criteria.length > 0) {
      const criteriaResult = await this.verifyCriteria(task, criteria, context);
      result.levelResults.set('criteria', criteriaResult);
      result.criteriaEvaluated = true;
    }

    // Calculate overall result
    const requiredLevels: AcceptanceLevel[] = ['checkpoint', 'build', 'test'];
    result.requiredLevelsPassed = requiredLevels.every(
      level => result.levelResults.get(level)?.passed === true
    );

    result.passed = result.requiredLevelsPassed;
    result.reason = this.generateOverallReason(result);

    return result;
  }

  /**
   * Level 1: Verify task checkpoints
   *
   * Executes verification commands for checkpoints and marks them as completed if successful
   */
  private async verifyCheckpoints(task: TaskMeta): Promise<AcceptanceVerificationResult> {
    const result = createDefaultAcceptanceResult('checkpoint');

    const qaCheckpoints = (task.checkpoints || []).filter(
      cp => cp.category === 'qa_verification' ||
           cp.verification?.method === 'unit_test' ||
           cp.verification?.method === 'functional_test' ||
           cp.verification?.method === 'integration_test' ||
           cp.verification?.method === 'e2e_test' ||
           cp.verification?.method === 'automated'
    );

    if (qaCheckpoints.length === 0) {
      result.passed = true;
      result.reason = '无 QA 类型检查点，跳过检查点验证';
      return result;
    }

    // Execute verification for each checkpoint
    const verificationResults: Array<{
      checkpoint: CheckpointMetadata;
      success: boolean;
      details: string;
    }> = [];

    for (const checkpoint of qaCheckpoints) {
      // Skip if already completed
      if (checkpoint.status === 'completed') {
        verificationResults.push({
          checkpoint,
          success: true,
          details: `检查点 ${checkpoint.id}: 已完成`,
        });
        continue;
      }

      // Check if we have commands to execute
      const commands = checkpoint.verification?.commands;
      if (!commands || commands.length === 0) {
        verificationResults.push({
          checkpoint,
          success: false,
          details: `检查点 ${checkpoint.id}: 无验证命令`,
        });
        continue;
      }

      // Execute commands
      try {
        const results = await this.executor.executeAll(commands, { cwd: this.cwd });
        const allSuccess = results.every(r => r.success);

        verificationResults.push({
          checkpoint,
          success: allSuccess,
          details: allSuccess
            ? `检查点 ${checkpoint.id}: 验证通过 (${commands.length} 个命令)`
            : `检查点 ${checkpoint.id}: 验证失败`,
        });
      } catch (error) {
        verificationResults.push({
          checkpoint,
          success: false,
          details: `检查点 ${checkpoint.id}: 执行错误 - ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    // Calculate result
    const successCount = verificationResults.filter(r => r.success).length;
    const totalCount = verificationResults.length;

    result.passed = successCount === totalCount;
    result.reason = result.passed
      ? `所有 ${totalCount} 个 QA 检查点验证通过`
      : `QA 检查点验证失败: ${successCount}/${totalCount} 通过`;
    result.criteria = verificationResults.map(r => ({
      original: r.checkpoint.description,
      type: 'general' as const,
      satisfied: r.success,
      details: r.details,
    }));

    // Update task checkpoints in meta.json if we're in harness mode
    await this.updateTaskCheckpoints(task.id, verificationResults);

    return result;
  }

  /**
   * Update task checkpoints in meta.json after verification
   */
  private async updateTaskCheckpoints(
    taskId: string,
    results: Array<{ checkpoint: CheckpointMetadata; success: boolean; details: string }>
  ): Promise<void> {
    try {
      const taskMetaPath = path.join(this.cwd, '.projmnt4claude', 'tasks', taskId, 'meta.json');
      if (!fs.existsSync(taskMetaPath)) {
        return;
      }

      const taskMetaContent = fs.readFileSync(taskMetaPath, 'utf-8');
      const taskMeta = JSON.parse(taskMetaContent) as TaskMeta;

      // Update checkpoints
      if (taskMeta.checkpoints) {
        for (const result of results) {
          const checkpointIndex = taskMeta.checkpoints.findIndex(cp => cp.id === result.checkpoint.id);
          if (checkpointIndex >= 0) {
            const checkpoint = taskMeta.checkpoints[checkpointIndex];
            checkpoint.status = result.success ? 'completed' : 'failed';
            if (checkpoint.verification) {
              checkpoint.verification.result = result.success ? 'passed' : 'failed';
              checkpoint.verification.verifiedAt = new Date().toISOString();
              checkpoint.verification.verifiedBy = 'checkpoint_executor';
            }
          }
        }

        // Write back
        fs.writeFileSync(taskMetaPath, JSON.stringify(taskMeta, null, 2), 'utf-8');
      }
    } catch {
      // Ignore errors, we don't want to fail the whole verification
    }
  }

  /**
   * Level 2: Verify build
   *
   * Checks that bun run build succeeds without TypeScript errors
   */
  private async verifyBuild(task: TaskMeta): Promise<AcceptanceVerificationResult> {
    const result = createDefaultAcceptanceResult('build');

    try {
      // Check if package.json exists
      const packageJsonPath = path.join(this.cwd, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        result.passed = true;
        result.reason = '无 package.json，跳过构建验证';
        return result;
      }

      // Run build command
      const buildCommand = this.getBuildCommand();
      execSync(buildCommand, {
        cwd: this.cwd,
        timeout: 60000,
        stdio: 'pipe',
      });

      result.passed = true;
      result.reason = '构建成功，无编译错误';
    } catch (error) {
      result.passed = false;
      result.error = error instanceof Error ? error.message : String(error);

      // Try to extract TypeScript errors
      const output = (error as { stdout?: Buffer; stderr?: Buffer })?.stdout?.toString() ||
                    (error as { stdout?: Buffer; stderr?: Buffer })?.stderr?.toString() || '';

      if (output.includes('error TS')) {
        result.reason = 'TypeScript 编译错误';
        // Extract error count
        const errorMatch = output.match(/Found\s+(\d+)\s+error/i);
        if (errorMatch) {
          result.reason = `TypeScript 编译错误: ${errorMatch[1]} 个`;
        }
      } else {
        result.reason = `构建失败: ${result.error}`;
      }
    }

    return result;
  }

  /**
   * Get build command for the project
   */
  private getBuildCommand(): string {
    // Try to read package.json to find build script
    try {
      const packageJsonPath = path.join(this.cwd, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      if (packageJson.scripts?.build) {
        return `bun run build`;
      }
    } catch {
      // Ignore errors, use default
    }

    // Default build command
    return `bun run build`;
  }

  /**
   * Level 3: Verify tests
   *
   * Checks that task-related tests pass
   */
  private async verifyTests(
    task: TaskMeta,
    context?: Partial<VerificationContext>
  ): Promise<AcceptanceVerificationResult> {
    const result = createDefaultAcceptanceResult('test');

    // If context provides test results, use them
    if (context?.testResults) {
      const { passed, failed, total } = context.testResults;
      result.passed = failed === 0;
      result.reason = result.passed
        ? `所有测试通过: ${passed}/${total}`
        : `测试失败: ${failed}/${total} 个测试未通过`;
      return result;
    }

    // Try to run tests based on task files
    const taskFiles = task.files || [];
    if (taskFiles.length === 0) {
      result.passed = true;
      result.reason = '无关联文件，跳过测试验证';
      return result;
    }

    // Find test files related to task
    const testFiles = this.findRelatedTestFiles(taskFiles);
    if (testFiles.length === 0) {
      result.passed = true;
      result.reason = '未找到相关测试文件，跳过测试验证';
      return result;
    }

    // Run tests
    try {
      const testCommand = this.getTestCommand(testFiles);
      execSync(testCommand, {
        cwd: this.cwd,
        timeout: 120000,
        stdio: 'pipe',
      });

      result.passed = true;
      result.reason = `相关测试通过: ${testFiles.length} 个测试文件`;
    } catch (error) {
      result.passed = false;
      result.error = error instanceof Error ? error.message : String(error);
      result.reason = `测试失败: ${result.error}`;
    }

    return result;
  }

  /**
   * Find test files related to task files
   */
  private findRelatedTestFiles(taskFiles: string[]): string[] {
    const testFiles: string[] = [];

    for (const file of taskFiles) {
      // Common test file patterns
      const patterns: string[] = [
        // Same directory with .test.ts or .spec.ts
        file.replace(/\.ts$/, '.test.ts') || file,
        file.replace(/\.ts$/, '.spec.ts') || file,
        file.replace(/\.js$/, '.test.js') || file,
        file.replace(/\.js$/, '.spec.js') || file,
        // __tests__ directory
        file.replace(/src\/(.+)\.ts$/, '__tests__/$1.test.ts') || file,
        file.replace(/src\/(.+)\.ts$/, 'src/__tests__/$1.test.ts') || file,
      ];

      for (const pattern of patterns) {
        if (pattern && pattern !== file) {
          const fullPath = path.join(this.cwd, pattern);
          if (fs.existsSync(fullPath)) {
            testFiles.push(pattern);
          }
        }
      }
    }

    return testFiles;
  }

  /**
   * Get test command
   */
  private getTestCommand(testFiles: string[]): string {
    // Use bun test with specific files
    if (testFiles.length > 0) {
      return `bun test ${testFiles.join(' ')}`;
    }
    return `bun test`;
  }

  /**
   * Level 4: Verify acceptance criteria
   *
   * Parses and verifies criteria from task description
   */
  private async verifyCriteria(
    task: TaskMeta,
    criteria: ParsedAcceptanceCriterion[],
    context?: Partial<VerificationContext>
  ): Promise<AcceptanceVerificationResult> {
    const result = createDefaultAcceptanceResult('criteria');

    // Build verification context from task
    const fullContext: VerificationContext = {
      affectedFiles: task.files || [],
      migratedFiles: context?.migratedFiles || [],
      functionCalls: context?.functionCalls || [],
      testResults: context?.testResults,
      buildStatus: context?.buildStatus,
    };

    // Verify each criterion
    const verifiedCriteria = this.parser.verify(criteria, fullContext);
    result.criteria = verifiedCriteria;

    // Calculate pass/fail
    const satisfiedCount = verifiedCriteria.filter(c => c.satisfied === true).length;
    const totalCount = verifiedCriteria.length;
    const unsatisfiedCount = verifiedCriteria.filter(c => c.satisfied === false).length;

    // Only fail if we have explicit failures (satisfied === false)
    // Unknown status (satisfied === undefined) doesn't count as failure
    result.passed = unsatisfiedCount === 0;
    result.reason = result.passed
      ? `验收标准满足: ${satisfiedCount}/${totalCount} 已验证`
      : `验收标准未满足: ${unsatisfiedCount} 个标准未通过`;

    return result;
  }

  /**
   * Generate overall reason from level results
   */
  private generateOverallReason(result: QAAcceptanceResult): string {
    const failedLevels: AcceptanceLevel[] = [];

    for (const [level, levelResult] of result.levelResults) {
      if (!levelResult.passed && level !== 'criteria') {
        failedLevels.push(level);
      }
    }

    if (failedLevels.length === 0) {
      const parts: string[] = ['所有必需验证层次通过'];
      if (result.criteriaEvaluated) {
        const criteriaResult = result.levelResults.get('criteria');
        if (criteriaResult?.passed) {
          parts.push('验收标准验证通过');
        } else {
          parts.push('验收标准验证未完全满足（可选）');
        }
      }
      return parts.join('，');
    }

    const levelNames = failedLevels.map(l => ACCEPTANCE_LEVEL_DESCRIPTIONS[l].split(' - ')[0]);
    return `验证失败: ${levelNames.join('、')} 未通过`;
  }

  /**
   * Format result for display
   */
  formatResult(result: QAAcceptanceResult): string {
    const lines: string[] = [];
    const separator = '━'.repeat(60);

    lines.push('');
    lines.push(separator);
    lines.push(`📋 QA 验收标准验证结果: ${result.taskId}`);
    lines.push(separator);
    lines.push('');

    const overallIcon = result.passed ? '✅' : '❌';
    lines.push(`${overallIcon} 总体结果: ${result.passed ? '通过' : '未通过'}`);
    lines.push(`   ${result.reason}`);
    lines.push('');

    // Level results
    lines.push('📊 验证层次结果:');
    const levels: AcceptanceLevel[] = ['checkpoint', 'build', 'test', 'criteria'];
    for (const level of levels) {
      const levelResult = result.levelResults.get(level);
      if (levelResult) {
        const icon = levelResult.passed ? '✅' : '❌';
        const severity = level === 'criteria' ? '(可选)' : '(必需)';
        lines.push(`   ${icon} ${ACCEPTANCE_LEVEL_DESCRIPTIONS[level].split(' - ')[0]} ${severity}`);
        lines.push(`      ${levelResult.reason}`);
      }
    }
    lines.push('');

    // Criteria details (if evaluated)
    const criteriaResult = result.levelResults.get('criteria');
    if (criteriaResult?.criteria && criteriaResult.criteria.length > 0) {
      lines.push('📝 验收标准详情:');
      for (const criterion of criteriaResult.criteria) {
        const icon = criterion.satisfied === true ? '✅' :
                    criterion.satisfied === false ? '❌' : '⏳';
        lines.push(`   ${icon} ${criterion.original}`);
        if (criterion.details) {
          lines.push(`      ${criterion.details}`);
        }
      }
      lines.push('');
    }

    lines.push(separator);
    return lines.join('\n');
  }
}

/**
 * Create verifier instance
 */
export function createQAAcceptanceCriteriaVerifier(cwd: string): QAAcceptanceCriteriaVerifier {
  return new QAAcceptanceCriteriaVerifier(cwd);
}

/**
 * Quick verification function
 */
export async function verifyQAAcceptanceCriteria(
  task: TaskMeta,
  cwd: string = process.cwd(),
  context?: Partial<VerificationContext>
): Promise<QAAcceptanceResult> {
  const verifier = new QAAcceptanceCriteriaVerifier(cwd);
  return verifier.verify(task, context);
}

export default QAAcceptanceCriteriaVerifier;