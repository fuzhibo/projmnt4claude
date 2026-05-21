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
import { verifyQAAcceptanceCriteria, QAAcceptanceResult, ACCEPTANCE_LEVEL_DESCRIPTIONS, type AcceptanceLevel } from '../types/qa-acceptance-criteria.js';
import { QAAcceptanceCriteriaVerifier, createQAAcceptanceCriteriaVerifier } from './qa-acceptance-criteria-verifier.js';

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
      verdict.result = 'NOPASS';
      verdict.reason = `${texts.harness.logs.qaError}: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`\n   ❌ ${texts.harness.logs.qaError}: ${verdict.reason}`);
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
   * @param testCommand 测试命令，默认为 'bun test'
   * @returns 测试结果，包含是否通过、flaky 检测结果、失败信息
   */
  async runTestSuite(testCommand: string = 'bun test'): Promise<{
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

      const proc = spawn(command, args, {
        cwd: this.config.cwd,
        shell: true,
        timeout: 300000, // 5 minutes timeout
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        // 解析失败测试
        failures = this.parseTestFailures(output);
        resolve({
          passed: code === 0,
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
   * 1. 标准格式检测（JUnit XML、TAP）- 仅当配置启用时
   * 2. 用户自定义正则规则 - 从 config.json 读取，按顺序匹配，命中即返回
   * 3. 降级处理 - 输出原始日志摘要
   *
   * 注意：不再使用内置硬编码规则，所有规则均从配置读取。
   */
  private parseTestFailures(output: string): string[] {
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
   * 检查测试卫生：检测 .only/.skip/mock.module 泄漏
   * @param testDir 测试目录，默认为 'src/__tests__'
   * @returns 检查结果，包含是否通过、发现的问题
   */
  async checkTestHygiene(testDir: string = 'src/__tests__'): Promise<{
    passed: boolean;
    issues: Array<{ type: string; file: string; line: number; content: string }>;
    details: string;
  }> {
    const issues: Array<{ type: string; file: string; line: number; content: string }> = [];
    const testPath = path.isAbsolute(testDir) ? testDir : path.join(this.config.cwd, testDir);

    console.log(`\n   🔍 检查测试卫生: ${testDir}`);

    if (!fs.existsSync(testPath)) {
      return {
        passed: true,
        issues: [],
        details: `测试目录不存在: ${testDir}`,
      };
    }

    // 遍历测试文件
    const testFiles = this.findTestFiles(testPath);
    console.log(`   📄 扫描 ${testFiles.length} 个测试文件...`);

    for (const file of testFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const relativePath = path.relative(this.config.cwd, file);

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        // 检测 .only
        const onlyMatch = line.match(/\.only\s*[\(\{]/);
        if (onlyMatch) {
          issues.push({
            type: '.only',
            file: relativePath,
            line: lineNum,
            content: line.trim(),
          });
        }

        // 检测 .skip
        const skipMatch = line.match(/\.skip\s*[\(\{]/);
        if (skipMatch) {
          issues.push({
            type: '.skip',
            file: relativePath,
            line: lineNum,
            content: line.trim(),
          });
        }

        // 检测顶层 mock.module (bun:test 的 mock.module)
        const mockMatch = line.match(/^mock\.module\s*\(/);
        if (mockMatch) {
          issues.push({
            type: 'mock.module',
            file: relativePath,
            line: lineNum,
            content: line.trim(),
          });
        }
      });
    }

    const passed = issues.length === 0;

    let details = `测试卫生检查结果:\n`;
    details += `- 扫描文件: ${testFiles.length} 个\n`;
    details += `- 发现问题: ${issues.length} 个\n`;

    if (issues.length > 0) {
      details += `\n问题列表:\n`;
      issues.forEach(issue => {
        details += `  - [${issue.type}] ${issue.file}:${issue.line}\n`;
        details += `    ${issue.content}\n`;
      });
    }

    if (passed) {
      console.log(`   ✅ 测试卫生检查通过`);
    } else {
      console.log(`   ⚠️ 发现 ${issues.length} 个测试卫生问题`);
    }

    return { passed, issues, details };
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
    const testSuiteResult = await this.runTestSuite();
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

    // 2. 检查测试卫生
    const hygieneResult = await this.checkTestHygiene();
    if (!hygieneResult.passed) {
      return {
        passed: false,
        reason: `测试卫生检查失败: 发现 ${hygieneResult.issues.length} 个问题 (.only/.skip/mock.module)`,
        failures: hygieneResult.issues.map(i => `[${i.type}] ${i.file}:${i.line}`),
        failedCheckpoints: [],
        details: hygieneResult.details,
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
        details: `${testSuiteResult.details}\n\n${hygieneResult.details}`,
      };
    }

    // 构建验证提示词
    const prompt = this.buildQAPrompt(task, codeReviewVerdict, automatedCheckpoints, retryContext);
    console.log(`\n   📝 ${texts.harness.logs.qaPromptGenerated}`);

    // 运行独立验证会话
    console.log(`\n   🤖 ${texts.harness.logs.startingQASession}`);
    const agent = getAgent(this.config.cwd);
    const effectiveTools = buildEffectiveTools('qaVerification', this.config.cwd, task);
    const invokeOptions = {
      allowedTools: effectiveTools.tools,
      timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
      cwd: this.config.cwd,
      outputFormat: 'text',
      dangerouslySkipPermissions: effectiveTools.skipPermissions,
    };

    const engine = createSessionAwareEngine(
      'markdown',
      [qaVerdictResultMarker, qaVerdictHasReason],
      1, // maxRetriesOnError (QA: 1 retry)
    );
    const engineResult = await engine.runWithFeedback(
      agent.invoke.bind(agent),
      prompt,
      invokeOptions,
    );

    if (engineResult.retries > 0) {
      console.log(`   🔄 ${texts.harness.logs.qaRetry.replace('{retries}', String(engineResult.retries))}`);
    }

    if (!engineResult.result.success) {
      return {
        passed: false,
        reason: `${texts.harness.logs.qaSessionFailed}: ${engineResult.result.error || 'unknown error'}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 验证规则未通过（如缺少 VERDICT 标记），直接返回 NOPASS 避免解析失败
    if (!engineResult.passed) {
      const violationMessages = engineResult.violations
        .map((v: { ruleId: string; message: string }) => `${v.ruleId}: ${v.message}`)
        .join('; ');
      console.log(`   ⚠️  ${texts.harness.logs.qaOutputValidationFailed}: ${violationMessages}`);

      // 尝试从原始输出中提取可用信息
      const rawOutput = engineResult.result.output || '';
      const parsed = this.parseQAResult(rawOutput);
      // 如果解析到了有效结果（非默认原因），使用解析结果
      if (parsed.reason && parsed.reason !== texts.harness.logs.cannotParseVerdict) {
        return parsed;
      }

      return {
        passed: false,
        reason: `${texts.harness.logs.qaOutputValidationFailed}: ${violationMessages}`,
        failures: [],
        failedCheckpoints: [],
      };
    }

    // 解析验证结果
    const result = this.parseQAResult(engineResult.result.output || '');

    // 合并文件覆盖信息到结果详情中
    if (task.files && task.files.length > 0) {
      const fileCoverageSection = `\n\n## ${texts.harness.logs.fileCoverageSection || 'File Coverage'}\n${fileCoverage.details}`;
      result.details = result.details ? `${result.details}${fileCoverageSection}` : fileCoverageSection;

      // 如果有文件缺失，将结果标记为失败
      if (!fileCoverage.covered) {
        result.passed = false;
        result.failures = [...result.failures, ...fileCoverage.missingFiles.map(f => `Missing file: ${f}`)];
        if (!result.reason.includes(texts.harness.logs.fileCoverageFailed || 'File coverage failed')) {
          result.reason = `${texts.harness.logs.fileCoverageFailed || 'File coverage check failed'}: ${fileCoverage.missingFiles.length} file(s) missing`;
        }
      }
    }

    return result;
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
      `**${texts.harness.reports.resultLabel}**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
      `**${texts.harness.reports.reviewedAtLabel}**: ${verdict.verifiedAt}`,
      `**${texts.harness.reports.reviewedByLabel}**: ${verdict.verifiedBy}`,
      `**${texts.harness.reports.requiresHumanLabel}**: ${verdict.requiresHuman ? texts.harness.reports.yes : texts.harness.reports.no}`,
      '',
      `## ${texts.harness.reports.reasonSection}`,
      verdict.reason,
      '',
    ];

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
