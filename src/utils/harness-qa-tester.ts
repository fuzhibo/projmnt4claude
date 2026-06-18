/**
 * HarnessQATester - QA 验证阶段处理器
 *
 * 负责执行 QA 验证检查点：
 * - 运行单元测试
 * - 运行功能测试
 * - 运行集成测试
 * - 判断是否需要人工验证
 * - 程序化验证：flaky test 检测、测试卫生检查
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import type {
  HarnessConfig,
  CodeReviewVerdict,
  QAVerdict,
  RetryContext,
} from '../types/harness.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import type { TestFailurePattern, StandardFormatDetection, HarnessTestConfig } from '../types/config.js';
import { validateCheckpointVerification } from '../types/task.js';
import {
  saveReport,
  filterCheckpoints,
  parseVerdictResult,
  getReportPath,
  REVIEW_TIMEOUT_RATIO,
} from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { getQARoleTemplate } from './role-prompts.js';
import { generateFallbackVerification } from './checkpoint.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { qaVerdictResultMarker, qaVerdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate, loadCustomRequirements } from './prompt-templates.js';
import { t, getI18n } from '../i18n/index.js';
import type { HarnessPhaseOptions } from '../types/config.js';
import { randomUUID } from 'crypto';
import { verifyQAAcceptanceCriteria, QAAcceptanceResult, ACCEPTANCE_LEVEL_DESCRIPTIONS, type AcceptanceLevel } from '../types/qa-acceptance-criteria.js';
import { QAAcceptanceCriteriaVerifier, createQAAcceptanceCriteriaVerifier } from './qa-acceptance-criteria-verifier.js';
import { spawnWithMemoryLimit } from './spawn-utils.js';
import { DebugLogger } from './debug-logger.js';

/**
 * 验证检查点的验证信息完整性
 * 用于 QA 提示词中显示警告
 */
function checkCheckpointVerification(cp: CheckpointMetadata): { valid: boolean; warning?: string } {
  return validateCheckpointVerification(cp);
}

export class HarnessQATester {
  private config: HarnessConfig;
  private debugLogger: DebugLogger;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.debugLogger = new DebugLogger({
      cwd: config.cwd,
      enabled: config.debug,
    });
  }

  /**
   * 执行 QA 验证
   */
  async verify(task: TaskMeta, codeReviewVerdict: CodeReviewVerdict, retryContext?: RetryContext): Promise<QAVerdict> {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }
    console.log(`\n🧪 ${texts.harness.logs.qaPhase}`);
    console.log(`   ${texts.harness.logs.taskLabel}: ${task.title}`);

    // Run acceptance criteria verification first
    let acceptanceCriteriaResult: QAAcceptanceResult | undefined;
    try {
      console.log(`\n   📋 执行验收标准验证...`);
      const verifier = createQAAcceptanceCriteriaVerifier(this.config.cwd);
      acceptanceCriteriaResult = await verifier.verify(task);

      // Show result
      const resultText = verifier.formatResult(acceptanceCriteriaResult);
      console.log(resultText);
    } catch (error) {
      console.log(`   ⚠️ 验收标准验证出错: ${error instanceof Error ? error.message : String(error)}`);
    }

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
      acceptanceCriteriaResult,
    };

    // Check acceptance criteria result - if required levels failed, mark as NOPASS
    if (acceptanceCriteriaResult && !acceptanceCriteriaResult.requiredLevelsPassed) {
      verdict.result = 'NOPASS';
      verdict.reason = `验收标准验证未通过: ${acceptanceCriteriaResult.reason}`;
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    // 如果代码审核未通过，直接返回 NOPASS
    if (codeReviewVerdict.result !== 'PASS') {
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.qaSkippedDueToCodeReview}: ${codeReviewVerdict.reason}`;
      await this.saveReport(task.id, verdict);
      return verdict;
    }

    try {
      // 1. 获取 QA 验证类检查点
      const qaCheckpoints = this.getQACheckpoints(task);
      console.log(`   📋 ${texts.harness.logs.qaCheckpoints}: ${qaCheckpoints.length}`);

      if (qaCheckpoints.length === 0) {
        // 没有 QA 检查点，直接通过
        verdict.result = 'PASS';
        verdict.reason = texts.harness.logs.noQACheckpoints;
        console.log(`   ✅ ${texts.harness.logs.noQACheckpoints}`);
      } else {
        // 2. 检查是否有人工验证检查点
        const humanCheckpoints = qaCheckpoints.filter(cp => cp.requiresHuman === true);
        verdict.humanVerificationCheckpoints = humanCheckpoints.map(cp => cp.id);

        // 3. 运行自动化 QA 验证
        const qaResult = await this.runQAVerification(task, codeReviewVerdict, qaCheckpoints, retryContext);

        verdict.result = qaResult.passed ? 'PASS' : 'NOPASS';
        verdict.reason = qaResult.reason;
        verdict.testFailures = qaResult.failures;
        verdict.failedCheckpoints = qaResult.failedCheckpoints;
        verdict.details = qaResult.details;

        // [DEBUG-QA] 插入点 B: 验证 verdict 数组字段类型
        console.log(`   [DEBUG-QA] verdict after runQAVerification: testFailures_isArray=${Array.isArray(verdict.testFailures)}, failedCheckpoints_isArray=${Array.isArray(verdict.failedCheckpoints)}, humanVerificationCheckpoints_isArray=${Array.isArray(verdict.humanVerificationCheckpoints)}`);

        // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
        const contradiction = detectContradiction(verdict.result, verdict.reason || '');
        if (contradiction.hasContradiction && contradiction.correctedResult) {
          console.log(`   ⚠️  ${texts.harness.logs.contradictionDetected}: ${contradiction.reason}`);
          verdict.result = contradiction.correctedResult;
          verdict.reason += ` [${texts.harness.logs.contradictionDetected}: ${contradiction.reason}]`;
        }

        // 4. 标记需要人工验证的检查点（仅信息标记，不影响 PASS/NOPASS 判定）
        if (humanCheckpoints.length > 0) {
          verdict.requiresHuman = true;
          // 注意: requiresHuman 仅作为信息标记，reason 不附加人工检查点信息
          // 人工检查点信息通过 requiresHuman + humanVerificationCheckpoints 字段传递
          const deferredInfo = `${texts.harness.logs.deferredCheckpointsInfo.replace('{count}', String(humanCheckpoints.length))}: ${humanCheckpoints.map(cp => cp.id).join(', ')}`;
          verdict.details = verdict.details ? `${verdict.details}\n${deferredInfo}` : deferredInfo;
          console.log(`\n   ⏳ ${deferredInfo}`);
        }

        if (verdict.result === 'PASS' && !verdict.requiresHuman) {
          console.log(`\n   ✅ ${texts.harness.logs.qaPassed}`);
        } else if (verdict.result === 'PASS' && verdict.requiresHuman) {
          console.log(`\n   ⏳ ${texts.harness.logs.qaPassedWithHuman}`);
        } else {
          console.log(`\n   ❌ ${texts.harness.logs.qaFailed}: ${verdict.reason}`);
        }
      }

    } catch (error) {
      // [DEBUG-QA] 插入点 E: 捕获异常堆栈，精确定位 .map() / .forEach() 错误触发点
      verdict.result = 'NOPASS';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
      verdict.reason = `${texts.harness.logs.qaError}: ${errorMessage}`;
      console.log(`\n   ❌ ${texts.harness.logs.qaError}: ${verdict.reason}`);
      console.error(`   [DEBUG-QA] Stack trace for QA error:\n${errorStack}`);
      this.debugLogger.logError(task.id, 'qa', error instanceof Error ? error : new Error(errorMessage), { verdict, errorStack });
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
      cp.requiresHuman === true
    );
  }

  /**
   * 验证文件覆盖完整性
   * 基于 task.files 遍历所有相关文件，检查文件是否存在
   * @returns 文件覆盖验证结果
   */
  private verifyFileCoverage(task: TaskMeta): {
    covered: boolean;
    existingFiles: string[];
    missingFiles: string[];
    totalCount: number;
    coverage: number;
    details: string;
  } {
    // 防御性编程：确保 texts 始终有值
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      texts = getI18n('zh');
    }

    // 如果没有 files 字段，视为通过（向后兼容）
    if (!task.files || task.files.length === 0) {
      return {
        covered: true,
        existingFiles: [],
        missingFiles: [],
        totalCount: 0,
        coverage: 100,
        details: texts.harness.logs.noFilesToVerify || 'No files specified for verification',
      };
    }

    const existingFiles: string[] = [];
    const missingFiles: string[] = [];

    // 遍历 task.files 检查文件存在性
    for (const filePath of task.files) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.config.cwd, filePath);

      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      } else {
        missingFiles.push(filePath);
      }
    }

    const totalCount = task.files.length;
    const coverage = totalCount > 0 ? (existingFiles.length / totalCount) * 100 : 100;
    const covered = missingFiles.length === 0;

    // 构建详细信息
    const lines: string[] = [];
    lines.push(`${texts.harness.logs.fileCoverageSummary || 'File Coverage'}: ${existingFiles.length}/${totalCount} (${coverage.toFixed(1)}%)`);

    if (missingFiles.length > 0) {
      lines.push(`\n${texts.harness.logs.missingFiles || 'Missing Files'}:`);
      missingFiles.forEach(f => lines.push(`  - ${f}`));
    }

    if (existingFiles.length > 0) {
      lines.push(`\n${texts.harness.logs.existingFiles || 'Existing Files'}:`);
      existingFiles.forEach(f => lines.push(`  - ${f}`));
    }

    return {
      covered,
      existingFiles,
      missingFiles,
      totalCount,
      coverage,
      details: lines.join('\n'),
    };
  }

  /**
   * 执行测试套件两次以检测 flaky test
   * @param testCommand 测试命令，默认为 'npm test'
   * @returns 测试结果，包含是否通过、flaky 检测结果、失败信息
   */
  async runTestSuite(testCommand: string = 'npm test'): Promise<{
    passed: boolean;
    hasFlaky: boolean;
    flakyTests: string[];
    failures: string[];
    details: string;
  }> {
    const results: { passed: boolean; output: string; failures: string[] }[] = [];

    // 执行测试两次
    for (let run = 1; run <= 2; run++) {
      console.log(`\n   🔄 执行测试套件 (第 ${run}/2 次)...`);
      const result = await this.executeTestCommand(testCommand);
      results.push(result);
      if (result.passed) {
        console.log(`   ✅ 第 ${run} 次测试通过`);
      } else {
        console.log(`   ❌ 第 ${run} 次测试失败: ${result.failures.length} 个失败`);
      }
    }

    // 比较两次结果检测 flaky test
    const flakyTests = this.detectFlakyTests(results[0], results[1]);
    const hasFlaky = flakyTests.length > 0;

    // 两次都通过才算通过
    const passed = results[0].passed && results[1].passed;

    // 合并失败信息
    const allFailures = [...new Set([...results[0].failures, ...results[1].failures])];

    let details = `测试套件执行结果:\n`;
    details += `- 第 1 次: ${results[0].passed ? '✅ 通过' : '❌ 失败'}\n`;
    details += `- 第 2 次: ${results[1].passed ? '✅ 通过' : '❌ 失败'}\n`;
    if (hasFlaky) {
      details += `\n⚠️ 检测到 ${flakyTests.length} 个 flaky test:\n`;
      flakyTests.forEach(t => details += `  - ${t}\n`);
    }

    return {
      passed,
      hasFlaky,
      flakyTests,
      failures: allFailures,
      details,
    };
  }

  /**
   * 执行单个测试命令
   */
  private async executeTestCommand(testCommand: string): Promise<{
    passed: boolean;
    output: string;
    failures: string[];
  }> {
    return new Promise((resolve) => {
      const parts = testCommand.split(' ');
      const command = parts[0];
      const args = parts.slice(1);

      let output = '';
      let failures: string[] = [];

      const proc = spawnWithMemoryLimit(command, args, {
        cwd: this.config.cwd,
        shell: true,
        timeout: 300000, // 5 minutes timeout
      }, 'default');

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        const passed = code === 0;
        // 解析失败测试（仅当测试失败时才解析）
        failures = this.parseTestFailures(output, passed);
        resolve({
          passed,
          output,
          failures,
        });
      });

      proc.on('error', (error) => {
        resolve({
          passed: false,
          output: error.message,
          failures: [error.message],
        });
      });
    });
  }

  /**
   * 从测试输出中解析失败的测试
   *
   * 解析流程（完全可配置化设计）：
   * 1. 测试通过时直接返回空数组，无需解析
   * 2. 标准格式检测（JUnit XML、TAP）- 仅当配置启用时
   * 3. 用户自定义正则规则 - 从 config.json 读取，按顺序匹配，命中即返回
   * 4. 降级处理 - 输出原始日志摘要（仅当测试失败时）
   *
   * 注意：不再使用内置硬编码规则，所有规则均从配置读取。
   *
   * @param output 测试输出内容
   * @param testPassed 测试是否通过（exit code = 0）
   * @returns 失败测试列表，测试通过时返回空数组
   */
  private parseTestFailures(output: string, testPassed: boolean): string[] {
    // 如果测试通过，直接返回空数组，无需解析
    if (testPassed) {
      return [];
    }

    // 获取测试配置
    const testConfig = this.getTestConfig();

    // Step 1: 标准格式检测（仅当配置启用时）
    if (testConfig.standardFormatDetection) {
      const standardResult = this.tryStandardFormatDetection(output, testConfig.standardFormatDetection);
      if (standardResult.length > 0) {
        return standardResult;
      }
    }

    // Step 2: 用户自定义正则规则（从 config.json 读取）
    // 如果配置了 testFailurePatterns（非空数组），使用配置的规则
    // 如果未配置或为空数组，直接跳到降级处理
    if (testConfig.testFailurePatterns && testConfig.testFailurePatterns.length > 0) {
      const userResult = this.parseWithPatterns(output, testConfig.testFailurePatterns);
      if (userResult.length > 0) {
        return userResult;
      }
      // 用户规则未命中，继续降级处理
    }

    // Step 3: 降级处理
    if (testConfig.fallbackToRawOutput !== false) {
      return this.createFallbackOutput(output, testConfig.rawOutputMaxLength || 500);
    }

    return [];
  }

  /**
   * 获取测试配置
   *
   * 加载配置时会验证正则表达式合法性，非法正则会在启动时报错。
   */
  private getTestConfig(): HarnessTestConfig {
    // 尝试从项目配置加载
    try {
      const configPath = path.join(this.config.cwd, '.projmnt4claude', 'config.json');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const projectConfig = JSON.parse(content);
        const testConfig = projectConfig.harness?.test || {};

        // 验证正则表达式合法性
        if (testConfig.testFailurePatterns) {
          this.validatePatterns(testConfig.testFailurePatterns);
        }

        return testConfig;
      }
    } catch (error) {
      // 配置读取失败或正则验证失败，抛出错误
      if (error instanceof Error && error.message.startsWith('正则表达式验证失败')) {
        throw error;
      }
      // 其他错误使用默认配置
    }
    return {};
  }

  /**
   * 验证正则表达式合法性
   *
   * 在配置加载时验证，非法正则会在启动时报错。
   */
  private validatePatterns(patterns: TestFailurePattern[]): void {
    for (const pattern of patterns) {
      if (pattern.enabled === false) {
        continue; // 跳过禁用的规则
      }

      try {
        new RegExp(pattern.pattern, 'g');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `正则表达式验证失败: 规则 "${pattern.name}" 的正则 "${pattern.pattern}" 无效 - ${errorMessage}`
        );
      }
    }
  }

  /**
   * 尝试标准格式检测
   */
  private tryStandardFormatDetection(output: string, detection: StandardFormatDetection): string[] {
    // JUnit XML 检测
    if (detection.junitXml) {
      const junitResult = this.parseJUnitXML(output);
      if (junitResult.length > 0) {
        return junitResult;
      }
    }

    // TAP 检测
    if (detection.tap) {
      const tapResult = this.parseTAP(output);
      if (tapResult.length > 0) {
        return tapResult;
      }
    }

    return [];
  }

  /**
   * 解析 JUnit XML 格式
   *
   * 检测条件：输出以 <?xml 开头，或包含 <testsuites> 或 <testsuite> 标签
   */
  private parseJUnitXML(output: string): string[] {
    const failures: string[] = [];

    // 检测是否为 JUnit XML 格式
    const isJUnitXML = output.trim().startsWith('<?xml') ||
                       output.includes('<testsuites>') ||
                       output.includes('<testsuite>');
    if (!isJUnitXML) {
      return [];
    }

    // 匹配包含 failure/error 的 testcase（直接匹配，避免贪婪匹配问题）
    const failureTestcaseRegex = /<testcase[^>]*name="([^"]+)"[^>]*>\s*<(?:failure|error)[^>]*>[\s\S]*?<\/testcase>/g;
    let match;

    while ((match = failureTestcaseRegex.exec(output)) !== null) {
      failures.push(match[1]);
    }

    return [...new Set(failures)];
  }

  /**
   * 解析 TAP 格式
   *
   * 检测条件：首行为 TAP version，或输出包含 "not ok" 行
   */
  private parseTAP(output: string): string[] {
    const failures: string[] = [];
    const lines = output.split('\n');

    // 检测是否为 TAP 格式
    const isTAP = lines[0]?.trim().startsWith('TAP version') ||
                  output.includes('not ok');
    if (!isTAP) {
      return [];
    }

    // 解析 "not ok" 行
    const notOkRegex = /^not ok\s+(\d+)\s+-?\s*(.+)$/;
    for (const line of lines) {
      const match = line.match(notOkRegex);
      if (match) {
        failures.push(match[2].trim());
      }
    }

    return [...new Set(failures)];
  }

  /**
   * 使用正则规则解析
   *
   * 按顺序匹配，命中即返回
   */
  private parseWithPatterns(output: string, patterns: TestFailurePattern[]): string[] {
    for (const pattern of patterns) {
      // 跳过禁用的规则
      if (pattern.enabled === false) {
        continue;
      }

      try {
        const regex = new RegExp(pattern.pattern, 'g');
        const failures: string[] = [];
        let match;

        while ((match = regex.exec(output)) !== null) {
          if (match[1]) {
            failures.push(match[1].trim());
          }
        }

        // 命中即返回
        if (failures.length > 0) {
          return [...new Set(failures)];
        }
      } catch {
        // 正则表达式无效，跳过该规则
        console.warn(`   ⚠️ 无效的正则表达式规则: ${pattern.name}`);
      }
    }

    return [];
  }

  /**
   * 创建降级输出
   */
  private createFallbackOutput(output: string, maxLength: number): string[] {
    const truncated = output.length > maxLength
      ? output.slice(0, maxLength) + '...'
      : output;

    return [`[解析失败，输出原始日志摘要]\n${truncated}`];
  }

  /**
   * 检测 flaky test：比较两次测试结果
   */
  private detectFlakyTests(
    result1: { passed: boolean; output: string; failures: string[] },
    result2: { passed: boolean; output: string; failures: string[] }
  ): string[] {
    const flakyTests: string[] = [];

    // 如果两次结果不同，说明有 flaky
    if (result1.passed !== result2.passed) {
      // 找出只在某一次失败的测试
      const onlyInFirst = result1.failures.filter(f => !result2.failures.includes(f));
      const onlyInSecond = result2.failures.filter(f => !result1.failures.includes(f));
      flakyTests.push(...onlyInFirst, ...onlyInSecond);
    }

    // 如果两次都失败但失败项不同
    if (!result1.passed && !result2.passed) {
      const onlyInFirst = result1.failures.filter(f => !result2.failures.includes(f));
      const onlyInSecond = result2.failures.filter(f => !result1.failures.includes(f));
      flakyTests.push(...onlyInFirst, ...onlyInSecond);
    }

    return [...new Set(flakyTests)];
  }

  /**
   * 递归查找测试文件
   */
  private findTestFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findTestFiles(fullPath));
      } else if (entry.isFile() && /\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 运行 QA 验证
   */
  private async runQAVerification(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): Promise<{
    passed: boolean;
    reason: string;
    failures: string[];
    failedCheckpoints: string[];
    details?: string;
  }> {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }

    // 验证文件覆盖完整性 - 基于 task.files 遍历所有相关文件
    const fileCoverage = this.verifyFileCoverage(task);
    if (task.files && task.files.length > 0) {
      console.log(`\n   📁 ${texts.harness.logs.fileCoverageCheck || 'File Coverage Check'}:`);
      console.log(`      ${fileCoverage.details.split('\n')[0]}`);
      if (!fileCoverage.covered) {
        console.log(`   ❌ ${texts.harness.logs.fileCoverageFailed || 'File coverage check failed'}`);
      }
    }

    // 分离自动化检查点和人工验证检查点
    const automatedCheckpoints = checkpoints.filter(cp => !cp.requiresHuman);
    const humanCheckpoints = checkpoints.filter(cp => cp.requiresHuman === true);

    // 程序化验证：先执行测试套件和测试卫生检查
    console.log(`\n   🔬 执行程序化验证...`);

    // 1. 运行测试套件（两次检测 flaky）
    // 当任务没有关联测试文件时，跳过全局测试套件（避免全量 Jest 编译 OOM）
    const hasRelatedTestFiles = task.files && task.files.length > 0;
    let testSuiteResult: Awaited<ReturnType<typeof this.runTestSuite>>;
    if (hasRelatedTestFiles) {
      testSuiteResult = await this.runTestSuite();
      if (!testSuiteResult.passed) {
        return {
          passed: false,
          reason: `测试套件执行失败: ${testSuiteResult.failures.length} 个测试失败`,
          failures: testSuiteResult.failures,
          failedCheckpoints: [],
          details: testSuiteResult.details,
        };
      }
      if (testSuiteResult.hasFlaky) {
        console.log(`   ⚠️ 检测到 ${testSuiteResult.flakyTests.length} 个 flaky test`);
      }
    } else {
      console.log(`   ⏭️  无关联测试文件，跳过全局测试套件`);
      testSuiteResult = {
        passed: true,
        hasFlaky: false,
        flakyTests: [],
        failures: [],
        details: '无关联测试文件，跳过全局测试套件执行',
      };
    }

    // 程序化验证通过，继续 AI 验证（如果有检查点）
    console.log(`   ✅ 程序化验证通过`);

    // BUG-013-2: 检查自动化检查点中是否有缺少验证命令的情况
    const checkpointsWithoutCommands = automatedCheckpoints.filter(cp => {
      const result = validateCheckpointVerification(cp);
      return !result.valid;
    });
    if (checkpointsWithoutCommands.length > 0) {
      console.log(`\n   ⚠️  ${texts.harness.logs.checkpointWarning.replace('{count}', String(checkpointsWithoutCommands.length))}:`);
      for (const cp of checkpointsWithoutCommands) {
        const result = validateCheckpointVerification(cp);
        console.log(`      - [${cp.id}] ${result.warning || texts.harness.logs.checkpointWarningDetail}`);
      }
      console.log(`      ${texts.harness.logs.checkpointWarningFallback}`);
    }

    if (automatedCheckpoints.length === 0) {
      // 没有自动化检查点，但程序化验证已通过
      // BUG-014-2B: reason 不包含"需要人工验证"字样，避免误导下游评估者
      return {
        passed: true,
        reason: '程序化验证通过（无自动化检查点）',
        failures: [],
        failedCheckpoints: [],
        details: testSuiteResult.details,
      };
    }

    // 构建验证提示词
    const prompt = this.buildQAPrompt(task, codeReviewVerdict, automatedCheckpoints, retryContext);
    console.log(`\n   📝 ${texts.harness.logs.qaPromptGenerated}`);
    this.debugLogger.logPrompt(task.id, 'qa', prompt);

    // 运行独立验证会话
    console.log(`\n   🤖 ${texts.harness.logs.startingQASession}`);
    const agent = getAgent(this.config.cwd);
    const effectiveTools = buildEffectiveTools('qaVerification', this.config.cwd, task);
    const phaseOptions = this.config.perPhaseOptions?.['qaVerification'];

    // 生成阶段级 session ID，用于阶段内重试时的上下文连续性
    const sessionId = `qa-${task.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const invokeOptions = {
      allowedTools: effectiveTools.tools,
      timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
      cwd: this.config.cwd,
      outputFormat: 'text',
      dangerouslySkipPermissions: effectiveTools.skipPermissions,
      sessionId,
      bare: phaseOptions?.bare,
      noSessionPersistence: phaseOptions?.noSessionPersistence,
      mcpConfig: phaseOptions?.mcpConfig,
      strictMcpConfig: phaseOptions?.strictMcpConfig,
      pluginDir: phaseOptions?.pluginDir,
      pluginUrl: phaseOptions?.pluginUrl,
      disableSlashCommands: phaseOptions?.disableSlashCommands,
      effort: phaseOptions?.effort,
      maxBudgetUsd: phaseOptions?.maxBudgetUsd,
      debug: phaseOptions?.debug,
    };

    // 1. 调用 AI 获取原始输出
    const rawResult = await agent.invoke(prompt, invokeOptions);

    if (!rawResult.success) {
      this.debugLogger.logError(task.id, 'qa', new Error(rawResult.error || 'QA session failed'), { rawResult });
      return {
        passed: false,
        reason: `${texts.harness.logs.qaSessionFailed}: ${rawResult.error || 'unknown error'}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 2. 解析 AI 输出（不验证格式）
    const parsedResult = this.parseQAResult(rawResult.output || '');
    this.debugLogger.logAIResponse(task.id, 'qa', rawResult.output || '', {
      success: rawResult.success,
      parsedResult,
    });

    // 3. 构造 verdict
    const qaVerdict: QAVerdict = {
      taskId: task.id,
      result: parsedResult.passed ? 'PASS' : 'NOPASS',
      reason: parsedResult.reason,
      testFailures: parsedResult.failures,
      failedCheckpoints: parsedResult.failedCheckpoints,
      requiresHuman: false,
      humanVerificationCheckpoints: [],
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'qa_tester',
      details: parsedResult.details,
    };

    // 4. 生成标准化报告
    const report = this.formatReport(qaVerdict);

    // 5. 验证标准化报告格式
    const engine = createSessionAwareEngine(
      'markdown',
      [qaVerdictResultMarker, qaVerdictHasReason],
      1, // maxRetriesOnError (QA: 1 retry)
    );
    const violations = engine.validate(report);

    if (violations.length > 0) {
      const violationMessages = violations
        .map((v: { ruleId: string; message: string }) => `${v.ruleId}: ${v.message}`)
        .join('; ');
      console.log(`   ⚠️  ${texts.harness.logs.qaOutputValidationFailed}: ${violationMessages}`);
      // 报告格式有问题（不应该发生，因为 formatReport() 已标准化）
      // 记录警告但不影响结果，因为内容已正确解析
      console.warn(`   [QA Format Warning] Report format validation failed: ${violationMessages}`);
    }

    // 合并文件覆盖信息到结果详情中
    if (task.files && task.files.length > 0) {
      const fileCoverageSection = `\n\n## ${texts.harness.logs.fileCoverageSection || 'File Coverage'}\n${fileCoverage.details}`;
      parsedResult.details = parsedResult.details ? `${parsedResult.details}${fileCoverageSection}` : fileCoverageSection;

      // 如果有文件缺失，将结果标记为失败
      if (!fileCoverage.covered) {
        parsedResult.passed = false;
        parsedResult.failures = [...parsedResult.failures, ...fileCoverage.missingFiles.map(f => `Missing file: ${f}`)];
        if (!parsedResult.reason.includes(texts.harness.logs.fileCoverageFailed || 'File coverage failed')) {
          parsedResult.reason = `${texts.harness.logs.fileCoverageFailed || 'File coverage check failed'}: ${fileCoverage.missingFiles.length} file(s) missing`;
        }
      }
    }

    // [DEBUG-QA] 插入点 A: 验证 parsedResult 字段类型
    console.log(`   [DEBUG-QA] runQAVerification returning: passed=${parsedResult.passed}, reason_type=${typeof parsedResult.reason}, failures_isArray=${Array.isArray(parsedResult.failures)}, failedCheckpoints_isArray=${Array.isArray(parsedResult.failedCheckpoints)}`);
    if (!Array.isArray(parsedResult.failures)) {
      console.error(`   [DEBUG-QA] CRITICAL: parsedResult.failures is not array:`, JSON.stringify(parsedResult.failures));
    }
    if (!Array.isArray(parsedResult.failedCheckpoints)) {
      console.error(`   [DEBUG-QA] CRITICAL: parsedResult.failedCheckpoints is not array:`, JSON.stringify(parsedResult.failedCheckpoints));
    }

    return parsedResult;
  }

  /**
   * 构建 QA 验证提示词
   */
  private buildQAPrompt(
    task: TaskMeta,
    codeReviewVerdict: CodeReviewVerdict,
    checkpoints: CheckpointMetadata[],
    retryContext?: RetryContext
  ): string {
    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }
    const roleTemplate = getQARoleTemplate(task.recommendedRole);

    // Build retry context section
    let retryContextSection = '';
    if (retryContext?.previousFailureReason) {
      retryContextSection = [
        `## ${texts.harness.logs.previousQAFailureReason}`,
        '',
        `${texts.harness.logs.previousQAVerificationFailed}:`,
        '',
        `> ${retryContext.previousFailureReason}`,
        '',
        `${texts.harness.logs.pleaseNote}:`,
        `- ${texts.harness.logs.reviewPreviousFailure}`,
        `- ${texts.harness.logs.formalRequirementFix}`,
        `- ${texts.harness.logs.realIssuePersist}`,
        '',
      ].join('\n');
    }

    // CP-P6-008: Build gate failure details section for enhanced retry feedback
    // CP-007: Enhanced feedback constraint mechanism - rule-specific精准反馈
    let gateFailureDetailsSection = '';
    if (retryContext?.gateFailureDetails) {
      const gate = retryContext.gateFailureDetails;

      // Build enhanced feedback based on ruleId and failureType
      const ruleId = gate.ruleId || '';
      const failureType = gate.failureType || '';

      // Rule-specific精准反馈内容
      let ruleSpecificFeedback = '';
      let correctExample = '';

      // 根据 ruleId 提供规则级精准反馈
      switch (ruleId) {
        case 'R-QA-POST-003':
        case 'R-POST-PHASE-003':
          ruleSpecificFeedback = '输出格式不正确：缺少必要的 VERDICT 标记。';
          correctExample = [
            '正确输出示例:',
            'VERDICT: PASS',
            '## 验证结果: PASS',
            '## 原因: 所有检查点通过，测试覆盖率达到要求',
            '',
            '或:',
            'VERDICT: NOPASS',
            '## 验证结果: NOPASS',
            '## 原因: 测试用例 X 失败，需要修复...',
          ].join('\n');
          break;

        case 'R-QA-POST-001':
        case 'R-POST-PHASE-001':
          ruleSpecificFeedback = 'QA报告不存在：阶段执行后未生成有效的 qa-report.json 报告文件。';
          correctExample = [
            '正确行为: QA 验证完成后应自动生成 qa-report.json 文件。',
            '检查点:',
            '1. 确保 saveReport() 被正确调用',
            '2. 确认报告文件路径: .projmnt4claude/outputs/{taskId}/qa-report.json',
            '3. 验证报告文件内容包含有效的 JSON 格式',
          ].join('\n');
          break;

        case 'R-QA-POST-002':
        case 'R-POST-PHASE-002':
          ruleSpecificFeedback = 'QA报告格式无效：生成的报告文件格式不符合要求。';
          correctExample = [
            '正确格式示例:',
            '{',
            '  "taskId": "TASK-xxx",',
            '  "result": "PASS" | "NOPASS",',
            '  "reason": "详细的验证结果说明",',
            '  "testFailures": [],',
            '  "failedCheckpoints": [],',
            '  "requiresHuman": false,',
            '  "verifiedAt": "2026-01-01T00:00:00.000Z",',
            '  "verifiedBy": "qa_tester"',
            '}',
          ].join('\n');
          break;

        case 'R-QA-POST-004':
        case 'R-POST-PHASE-004':
          ruleSpecificFeedback = '测试失败详情缺失：NOPASS时未提供足够的失败信息。';
          correctExample = [
            '正确行为: 当验证结果为 NOPASS 时，必须提供:',
            '1. testFailures: 列出所有失败的测试用例名称',
            '2. failedCheckpoints: 列出未通过的检查点 ID',
            '3. reason: 详细说明失败原因和修复建议',
          ].join('\n');
          break;

        case 'R-QA-PRE-001':
        case 'R-PRE-PHASE-001':
          ruleSpecificFeedback = '阶段前置条件检查失败：任务数据或前置阶段结果不符合要求。';
          correctExample = [
            '正确行为: 进入 QA 阶段前必须满足:',
            '1. 任务存在且已正确初始化',
            '2. 代码审核阶段已通过（codeReviewVerdict.result === "PASS"）',
            '3. 开发报告文件存在且完整',
          ].join('\n');
          break;

        case 'R-QA-PRE-002':
        case 'R-PRE-PHASE-002':
          ruleSpecificFeedback = '任务不存在：指定的任务 ID 未找到或已被删除。';
          correctExample = [
            '正确行为: 确保任务在 .projmnt4claude/tasks/ 目录下存在对应的 meta.json 文件。',
            '检查点:',
            '1. 确认任务 ID 拼写正确',
            '2. 验证任务目录结构完整',
            '3. 检查任务状态是否为可执行状态（非 resolved/closed）',
          ].join('\n');
          break;

        default:
          // 对于未知规则，使用 failureType 生成通用反馈
          if (failureType === 'format') {
            ruleSpecificFeedback = '输出格式不正确。';
            correctExample = [
              '通用正确格式要求:',
              '1. 输出第一行必须包含明确的结论标记',
              '2. 使用 Markdown 格式组织内容',
              '3. 包含必要的章节标题（如 ## 验证结果）',
            ].join('\n');
          } else if (failureType === 'ai_output') {
            ruleSpecificFeedback = 'AI 服务输出异常。';
            correctExample = [
              '排查建议:',
              '1. 检查 AI 服务 API 状态',
              '2. 确认提示词格式正确且未超出 token 限制',
              '3. 尝试简化请求内容',
            ].join('\n');
          } else {
            ruleSpecificFeedback = gate.failureDetails || '门禁检查未通过。';
          }
      }

      // Build the enhanced section
      gateFailureDetailsSection = [
        '## 前次门禁失败详情（精准反馈）',
        '',
        `规则ID: ${gate.ruleId || '未知'}`,
        `规则名称: ${gate.ruleName || '未知'}`,
        `失败类型: ${gate.failureType || '未知'}`,
        `严重等级: ${gate.severity || '未知'}`,
        '',
        `具体问题: ${ruleSpecificFeedback}`,
        '',
      ].join('\n');

      if (correctExample) {
        gateFailureDetailsSection += `${correctExample}\n\n`;
      }

      if (gate.failureDetails && !ruleSpecificFeedback.includes(gate.failureDetails)) {
        gateFailureDetailsSection += `详细错误: ${gate.failureDetails}\n\n`;
      }

      if (gate.suggestions && gate.suggestions.length > 0) {
        gateFailureDetailsSection += '修复建议:\n';
        gate.suggestions.forEach((suggestion, index) => {
          gateFailureDetailsSection += `${index + 1}. ${suggestion}\n`;
        });
        gateFailureDetailsSection += '\n';
      }

      // CP-007: Add failureType-specific targeted feedback
      if (failureType === 'format') {
        gateFailureDetailsSection += [
          '---',
          '**格式错误专项提醒**:',
          '- 必须使用英文 VERDICT 标记，不要使用中文"通过"/"不通过"',
          '- VERDICT 必须出现在输出第一行',
          '- 确保输出可被正则表达式 `^VERDICT:\s*(PASS|NOPASS)` 匹配',
          '',
        ].join('\n');
      } else if (failureType === 'ai_output') {
        gateFailureDetailsSection += [
          '---',
          '**AI输出错误专项提醒**:',
          '- 检查 API 密钥和权限配置',
          '- 确认请求未超出模型的最大 token 限制',
          '- 如果问题持续，考虑简化任务或分批处理',
          '',
        ].join('\n');
      }
    }

    // CP-5: Build coverage gap section for QA internal retry
    let coverageGapSection = '';
    if (retryContext?.qaCoverageGapContext) {
      const gap = retryContext.qaCoverageGapContext;
      coverageGapSection = [
        '## 覆盖率不足 - 需要扩展测试用例',
        '',
        `当前覆盖率: ${(gap.currentCoverage * 100).toFixed(1)}%`,
        `阈值要求: ${(gap.minCoverage * 100).toFixed(0)}%`,
        `覆盖率缺口: ${gap.gapPercent}`,
        '',
      ].join('\n');

      if (gap.coverageDetails) {
        const d = gap.coverageDetails;
        coverageGapSection += [
          '覆盖率详情:',
          `  行覆盖率: ${(d.lines * 100).toFixed(1)}%`,
          `  分支覆盖率: ${(d.branches * 100).toFixed(1)}%`,
          `  函数覆盖率: ${(d.functions * 100).toFixed(1)}%`,
          `  语句覆盖率: ${(d.statements * 100).toFixed(1)}%`,
          '',
        ].join('\n');

        const dimensions = [
          { name: '行覆盖率', value: d.lines },
          { name: '分支覆盖率', value: d.branches },
          { name: '函数覆盖率', value: d.functions },
          { name: '语句覆盖率', value: d.statements },
        ].sort((a, b) => a.value - b.value);

        coverageGapSection += `最低覆盖率维度: ${dimensions[0].name} (${(dimensions[0].value * 100).toFixed(1)}%)\n`;
        coverageGapSection += '建议优先补充该维度的测试用例。\n\n';
      }

      coverageGapSection += '请扩展测试用例，覆盖上述未覆盖的代码路径，使覆盖率达到阈值要求。';
    }

    const descriptionSection = task.description
      ? `## ${texts.harness.taskDescription}\n${task.description}`
      : '';

    // Build checkpoints list with verification details
    const checkpointsList = checkpoints.map((cp, i) => {
      const lines: string[] = [`${i + 1}. [${cp.id}] ${cp.description}`];
      if (cp.verification?.commands && cp.verification.commands.length > 0) {
        lines.push(`   ${texts.harness.logs.verificationCommands}: ${cp.verification.commands.join(', ')}`);
      } else if (cp.verification?.steps && cp.verification.steps.length > 0) {
        lines.push(`   ${texts.harness.logs.verificationSteps}: ${cp.verification.steps.join('；')}`);
      } else {
        const fallback = generateFallbackVerification(cp.description, task);
        if (fallback.steps && fallback.steps.length > 0) {
          lines.push(`   ${texts.harness.logs.suggestedVerificationSteps}: ${fallback.steps.join('；')}`);
        }
        if (fallback.commands && fallback.commands.length > 0) {
          lines.push(`   ${texts.harness.logs.fallbackVerificationCommands}: ${fallback.commands.join(', ')}`);
        }
      }
      if (cp.verification?.expected) {
        lines.push(`   ${texts.harness.logs.expectedResult}: ${cp.verification.expected}`);
      }
      const cpValidation = validateCheckpointVerification(cp);
      if (!cpValidation.valid && cpValidation.warning) {
        lines.push(`   ⚠️ ${cpValidation.warning}`);
      }
      return lines.join('\n');
    }).join('\n');

    const testStrategy = roleTemplate.testStrategy.map((strategy, i) => `${i + 1}. ${strategy}`).join('\n');

    const customRequirements = loadCustomRequirements('qa', this.config.cwd);

    // Get dev report path for QA to analyze
    const devReportPath = getReportPath(task.id, 'dev', this.config.cwd);

    const template = loadPromptTemplate('qa', this.config.cwd);
    return resolveTemplate(template, {
      roleDeclaration: roleTemplate.roleDeclaration,
      taskId: task.id,
      title: task.title,
      descriptionSection,
      checkpointsList,
      codeReviewResult: codeReviewVerdict.result,
      codeReviewReason: codeReviewVerdict.reason,
      customRequirements,
      testStrategy,
      retryContextSection,
      gateFailureDetailsSection,
      coverageGapSection,
      devReportPath,
    }).replace(/\n{3,}/g, '\n\n');
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
   * 保存 QA 报告（Markdown + JSON 双格式）
   */
  private async saveReport(taskId: string, verdict: QAVerdict): Promise<void> {
    // 1. Markdown 报告（harness 内部使用）
    const mdReportPath = getReportPath(taskId, 'qa', this.config.cwd);
    const mdContent = this.formatReport(verdict);
    await saveReport(mdReportPath, mdContent);

    // 2. JSON 报告（Post-QA Gate 门禁使用）
    const jsonReportPath = path.join(
      this.config.cwd,
      '.projmnt4claude',
      'outputs',
      taskId,
      'qa-report.json'
    );
    const jsonDir = path.dirname(jsonReportPath);
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }
    const jsonContent = JSON.stringify({
      version: '1.0.0',
      taskId: verdict.taskId,
      verdict: verdict.result,
      verifiedAt: verdict.verifiedAt,
      verifier: verdict.verifiedBy,
      summary: verdict.reason || '',
      testFailures: verdict.testFailures,
      failedCheckpoints: verdict.failedCheckpoints,
      requiresHuman: verdict.requiresHuman,
      humanVerificationCheckpoints: verdict.humanVerificationCheckpoints,
      details: verdict.details,
      acceptanceCriteriaResult: verdict.acceptanceCriteriaResult,
    }, null, 2);
    fs.writeFileSync(jsonReportPath, jsonContent, 'utf-8');
  }

  /**
   * 格式化 QA 报告
   */
  private formatReport(verdict: QAVerdict): string {
    // [DEBUG-QA] 插入点 C: 验证传入的 verdict 参数
    console.log(`   [DEBUG-QA] formatReport called: taskId=${verdict.taskId}, testFailures_isArray=${Array.isArray(verdict.testFailures)}, failedCheckpoints_isArray=${Array.isArray(verdict.failedCheckpoints)}, humanVerificationCheckpoints_isArray=${Array.isArray(verdict.humanVerificationCheckpoints)}`);

    // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
    let texts: ReturnType<typeof t>;
    try {
      texts = t(this.config.cwd);
    } catch {
      // 如果 t() 抛出错误，使用默认的中文文本
      texts = getI18n('zh');
    }

    const lines: string[] = [
      `# ${texts.harness.reports.qaReportTitle} - ${verdict.taskId}`,
      '',
      `VERDICT: ${verdict.result}`,
      `**${texts.harness.reports.reviewedAtLabel}**: ${verdict.verifiedAt}`,
      `**${texts.harness.reports.reviewedByLabel}**: ${verdict.verifiedBy}`,
      `**${texts.harness.reports.requiresHumanLabel}**: ${verdict.requiresHuman ? texts.harness.reports.yes : texts.harness.reports.no}`,
      '',
      `## ${texts.harness.reports.reasonSection}`,
      verdict.reason,
      '',
    ];

    // [DEBUG-QA] 插入点 D: 防御性检查，确保数组字段在 .forEach() 前是数组
    if (!Array.isArray(verdict.testFailures)) {
      console.error(`   [DEBUG-QA] CRITICAL in formatReport: verdict.testFailures is not array, value=`, JSON.stringify(verdict.testFailures));
      verdict.testFailures = [];
    }
    if (!Array.isArray(verdict.failedCheckpoints)) {
      console.error(`   [DEBUG-QA] CRITICAL in formatReport: verdict.failedCheckpoints is not array, value=`, JSON.stringify(verdict.failedCheckpoints));
      verdict.failedCheckpoints = [];
    }
    if (!Array.isArray(verdict.humanVerificationCheckpoints)) {
      console.error(`   [DEBUG-QA] CRITICAL in formatReport: verdict.humanVerificationCheckpoints is not array, value=`, JSON.stringify(verdict.humanVerificationCheckpoints));
      verdict.humanVerificationCheckpoints = [];
    }

    if (verdict.testFailures.length > 0) {
      lines.push(`## ${texts.harness.reports.testFailuresSection}`);
      verdict.testFailures.forEach(failure => {
        lines.push(`- ${failure}`);
      });
      lines.push('');
    }

    if (verdict.failedCheckpoints.length > 0) {
      lines.push(`## ${texts.harness.reports.failedCheckpointsSection}`);
      verdict.failedCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint}`);
      });
      lines.push('');
    }

    if (verdict.humanVerificationCheckpoints.length > 0) {
      lines.push(`## ${texts.harness.reports.humanVerificationSection}`);
      lines.push(`*${texts.harness.reports.humanVerificationNote}*`);
      verdict.humanVerificationCheckpoints.forEach(checkpoint => {
        lines.push(`- ${checkpoint} [deferred]`);
      });
      lines.push('');
    }

    if (verdict.details) {
      lines.push(`## ${texts.harness.reports.detailsSection}`);
      lines.push(verdict.details);
      lines.push('');
    }

    // Add acceptance criteria verification results
    if (verdict.acceptanceCriteriaResult) {
      const acResult = verdict.acceptanceCriteriaResult;
      lines.push('## 验收标准验证结果');
      lines.push('');
      lines.push(`**总体结果**: ${acResult.passed ? '✅ 通过' : '❌ 未通过'}`);
      lines.push(`**原因**: ${acResult.reason}`);
      lines.push('');

      // Show level results
      lines.push('### 验证层次结果');
      const levels: AcceptanceLevel[] = ['checkpoint', 'build', 'test', 'criteria'];
      for (const level of levels) {
        const levelResult = acResult.levelResults.get(level);
        if (levelResult) {
          const icon = levelResult.passed ? '✅' : '❌';
          const severity = level === 'criteria' ? '(可选)' : '(必需)';
          const levelName = ACCEPTANCE_LEVEL_DESCRIPTIONS[level].split(' - ')[0];
          lines.push(`- ${icon} ${levelName} ${severity}: ${levelResult.reason}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
