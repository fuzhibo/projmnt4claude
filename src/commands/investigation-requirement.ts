/**
 * investigation-requirement 命令
 *
 * 需求调查指令 - 从自然语言需求生成结构化调查报告
 *
 * 支持五种运行模式：
 * 1. 新建调查（默认非交互模式）
 * 2. 交互模式（--interactive）
 * 3. 反馈修正模式（--feedback）
 * 4. 评审模式（--review）
 * 5. 拆分模式（--split）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { InvestigationReport, ReviewResult, SplitPlan, SplitReviewResult, OutputMode } from '../utils/investigation/types';
import { callAI } from '../utils/investigation/ai-integration';
import { loadAndRenderTemplate, renderTemplate, type RenderTemplateMode } from '../utils/prompt-templates/loader';
import { generateReport } from '../utils/investigation/report-generator';
import { parseReport } from '../utils/investigation/report-parser';
import { validateReport } from '../utils/investigation/report-validator';
import { reviewReportWithRetry, reviewReport } from '../utils/investigation/report-reviewer';
import {
  REPORT_SECTIONS,
  METADATA_FIELDS,
  SOLUTION_FIELDS,
  ASSESSMENT_FIELDS,
  buildCaId,
  buildSolId,
} from '../utils/investigation/report-contract.js';
import {
  shouldSplit,
  generateSplitPlan,
  reviewSplitPlan,
} from '../utils/investigation/report-splitter';
import { loadInvestigationConfig, loadLanguageConfig } from '../utils/investigation/config-reader';
import { isInitialized } from '../utils/path';
import { createLogger } from '../utils/logger.js';
import { killAllActiveChildren } from '../utils/child-process-registry.js';

// ============================================================
// SOL-003: 重试错误分类
// ============================================================

/** 重试错误类型枚举 */
enum RetryErrorType {
  AI_GENERATION_ERROR = 'AI_GENERATION_ERROR',
  TEMPLATE_BUILD_ERROR = 'TEMPLATE_BUILD_ERROR',
  VALIDATION_LOGIC_ERROR = 'VALIDATION_LOGIC_ERROR',
  TRANSIENT_ERROR = 'TRANSIENT_ERROR',
}

/** 不可恢复错误（代码缺陷） */
class UnrecoverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrecoverableError';
  }
}

/** 错误分类函数 */
function classifyRetryError(error: Error): RetryErrorType {
  if (error.message.includes('[renderTemplate]') ||
      error.message.includes('占位符未替换')) {
    return RetryErrorType.TEMPLATE_BUILD_ERROR;
  }
  if (error.message.includes('timeout after')) {
    return RetryErrorType.TRANSIENT_ERROR;
  }
  if (error.message.includes('validateReport') ||
      error.message.includes('validation logic')) {
    return RetryErrorType.VALIDATION_LOGIC_ERROR;
  }
  return RetryErrorType.AI_GENERATION_ERROR;
}

// ============================================================
// 命令参数接口
// ============================================================

export interface InvestigationRequirementOptions {
  /** 非交互模式 */
  nonInteractive?: boolean;
  /** 交互模式：与用户评审循环 */
  interactive?: boolean;
  /** 反馈修正模式：基于用户反馈修正已有报告 */
  feedback?: boolean;
  /** 评审模式：仅评审已有报告 */
  review?: boolean;
  /** 拆分模式：对已有报告进行拆分 */
  split?: boolean;
  /** 报告路径（反馈/评审/拆分模式必需） */
  reportPath?: string;
  /** 需求描述文件路径 */
  file?: string;
  /** 输出目录 */
  outputDir?: string;
  /** 输出文件路径 */
  outputFile?: string;
  /** 最大重试次数 */
  maxRetry?: number;
  /** 拆分阈值（KB） */
  splitThreshold?: number;
  /** 语言 */
  lang?: 'zh' | 'en';
  /** 跳过 AI 评审 */
  skipReview?: boolean;
  /** 跳过拆分 */
  skipSplit?: boolean;
  /** 强制覆盖 */
  force?: boolean;
  /** JSON 输出 */
  json?: boolean;
  /** 静默模式 */
  quiet?: boolean;
  /** AI 调用超时时间（秒） */
  timeout?: number;
  /** 调试模式：输出详细日志 */
  debug?: boolean;
  /** 模板渲染模式：strict（默认，未替换占位符抛错）、lenient（仅警告）、auto-fill（默认值替换） */
  templateMode?: RenderTemplateMode;
}

export interface InvestigationResult {
  success: boolean;
  reportPath?: string;
  subReports?: string[];
  reviewResult?: ReviewResult;
  splitPlan?: SplitPlan;
  splitReviewResult?: SplitReviewResult;
  error?: string;
  /** 深度超限标记：子报告仍可能需要拆分 */
  needsFurtherSplit?: boolean;
  /** 深度超限的子报告路径列表 */
  furtherSplitCandidates?: string[];
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_MAX_RETRY = 3;
const DEFAULT_SPLIT_THRESHOLD = 30; // KB (设计文档默认 30KB)
const DEFAULT_LANGUAGE: 'zh' | 'en' = 'zh';
const MIN_REQUIREMENT_LENGTH = 5;
const MAX_SPLIT_DEPTH = 3;
const MAX_RETRY_FEEDBACK_LEN = 500;

// ============================================================
// SOL-003: 重试提示词结构化模板
// ============================================================

/** 重试提示词配置选项 */
interface RetryPromptOptions {
  requirement: string;
  errors: Array<{ rule: string; message: string }>;
  reviewResult?: ReviewResult;
  reviewPath?: string;
  attemptNum: number;
  lang: 'zh' | 'en';
  debug?: boolean;
}

/** 中文重试提示词模板 */
const RETRY_PROMPT_TEMPLATE_ZH = `你是 projmnt4claude 项目的需求调查分析师。

## 任务
这是第 {attemptNum} 次重试。上一次输出存在格式问题，请根据以下指导重新生成调查报告。

## 原始需求
{requirement}

## 上一次输出的格式问题
{errorSummary}

## 审核建议（来自 AI 评审员）
{suggestionsSummary}

## 审核报告路径
审核报告已保存到: {reviewPath}
（请查看审核报告获取更详细的问题分析和修正建议）

## ⚠️ 重要：必须严格按照以下格式输出

{formatExample}

**注意**:
1. 本次是第 {attemptNum} 次重试，请务必修正所有格式问题
2. 必须填充所有占位符
3. 原因分析必须使用 CA-NNN 编号格式
4. 解决方案必须使用 SOL-NNN 编号格式
5. 检查点必须标注归属的解决方案编号
6. 每个章节必须有实质内容，不能为空
`;

/** 英文重试提示词模板 */
const RETRY_PROMPT_TEMPLATE_EN = `You are an investigation analyst for the projmnt4claude project.

## Task
This is attempt {attemptNum}. Your previous output had format issues. Please regenerate the investigation report following the guidance below.

## Original Requirement
{requirement}

## Format Issues in Previous Output
{errorSummary}

## Review Suggestions (from AI Reviewer)
{suggestionsSummary}

## Review Report Path
Review report saved to: {reviewPath}
(Please check the review report for detailed issue analysis and correction suggestions)

## ⚠️ Important: You MUST strictly follow this output format

{formatExample}

**Notes**:
1. This is attempt {attemptNum}. You MUST fix all format issues
2. Must fill all placeholders
3. Root Cause Analysis must use CA-NNN numbering format
4. Solutions must use SOL-NNN numbering format
5. Checkpoints must mark their corresponding solution ID
6. Every section must have substantive content, cannot be empty
`;

// ============================================================
// 主命令入口
// ============================================================

export async function investigationRequirement(
  description: string | undefined,
  cwd: string,
  options: InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  // 创建 Logger
  const logger = createLogger('investigation-requirement', cwd, options.debug);

  // 记录命令启动参数
  logger.debug('investigation-requirement invoked', {
    mode: options.interactive ? 'interactive' : options.feedback ? 'feedback' : options.review ? 'review' : options.split ? 'split' : 'new',
    timeout: options.timeout,
    debug: options.debug,
    cwd,
    requirement: description?.substring(0, 50),
  });

  const startTime = Date.now();

  // 验证项目已初始化
  if (!isInitialized()) {
    const error = 'Project not initialized. Run `projmnt4claude setup` first.';
    logger.debug('investigation-requirement failed: not initialized', { error });
    return {
      success: false,
      error,
    };
  }

  // 加载配置
  const config = loadInvestigationConfig(cwd);
  const lang: 'zh' | 'en' = options.lang ?? loadLanguageConfig(cwd) ?? DEFAULT_LANGUAGE;
  const maxRetry = options.maxRetry ?? config.maxRetry ?? DEFAULT_MAX_RETRY;
  const splitThreshold = options.splitThreshold ?? config.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD;

  // 解析需求描述
  let requirement = description;
  if (options.file) {
    requirement = readFileContent(options.file);
  }

  // 根据模式路由
  if (options.feedback) {
    const result = await runFeedbackMode(requirement ?? '', cwd, { ...options, lang, maxRetry, splitThreshold });
    logger.debug('investigation-requirement completed', {
      success: result.success,
      totalDurationMs: Date.now() - startTime,
      reportPath: result.reportPath,
      error: result.error,
    });
    return result;
  }

  if (options.review) {
    const result = await runReviewMode(requirement ?? '', cwd, { ...options, lang, maxRetry });
    logger.debug('investigation-requirement completed', {
      success: result.success,
      totalDurationMs: Date.now() - startTime,
      reportPath: result.reportPath,
      error: result.error,
    });
    return result;
  }

  if (options.split) {
    const result = await runSplitMode(cwd, { ...options, lang, maxRetry, splitThreshold });
    logger.debug('investigation-requirement completed', {
      success: result.success,
      totalDurationMs: Date.now() - startTime,
      reportPath: result.reportPath,
      error: result.error,
    });
    return result;
  }

  if (options.interactive) {
    const result = await runInteractiveMode(requirement ?? '', cwd, { ...options, lang, maxRetry, splitThreshold });
    logger.debug('investigation-requirement completed', {
      success: result.success,
      totalDurationMs: Date.now() - startTime,
      reportPath: result.reportPath,
      error: result.error,
    });
    return result;
  }

  // 默认：新建调查（非交互模式）
  if (!requirement) {
    const error = 'Requirement description required. Provide description or use --file option.';
    logger.debug('investigation-requirement failed', { error, totalDurationMs: Date.now() - startTime });
    return {
      success: false,
      error,
    };
  }

  // 验证需求长度
  if (requirement.length < MIN_REQUIREMENT_LENGTH) {
    const error = `Requirement description must be at least ${MIN_REQUIREMENT_LENGTH} characters. Got: ${requirement.length}`;
    logger.debug('investigation-requirement failed', { error, requirementLength: requirement.length, totalDurationMs: Date.now() - startTime });
    return {
      success: false,
      error,
    };
  }

  const result = await runNewInvestigation(requirement, cwd, { ...options, lang, maxRetry, splitThreshold });
  logger.debug('investigation-requirement completed', {
    success: result.success,
    totalDurationMs: Date.now() - startTime,
    reportPath: result.reportPath,
    subReports: result.subReports?.length ?? 0,
    error: result.error,
  });
  return result;
}

// ============================================================
// 模式 1：新建调查（默认非交互模式）
// ============================================================

async function runNewInvestigation(
  requirement: string,
  cwd: string,
  options: Required<Pick<InvestigationRequirementOptions, 'lang' | 'maxRetry' | 'splitThreshold'>> & InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  const { lang, maxRetry, splitThreshold } = options;
  const logger = createLogger('investigation-requirement', cwd, options.debug);

  if (!options.quiet) {
    console.log('');
    console.log('🔍 Starting investigation...');
    console.log(`   Language: ${lang}`);
    console.log(`   Max retry: ${maxRetry}`);
    console.log(`   Split threshold: ${splitThreshold} KB`);
    console.log('');
  }

  // Step 1: 生成调查报告
  let report = await withTimeoutRace(
    generateInvestigationReport(requirement, cwd, {
      lang,
      timeout: options.timeout,
      debug: options.debug,
      templateMode: options.templateMode,
    }),
    (options.timeout ?? DEFAULT_RETRY_TIMEOUT_S) * 1000,
    'generateInvestigationReport(initial)',
  );

  // Step 1.5: 格式验证 + 循环重试（附回退机制）
  // SOL-002: 确定尝试报告输出目录
  const attemptOutputDir = options.outputDir ?? determineOutputMode(options, cwd).path;
  if (!fs.existsSync(attemptOutputDir)) {
    fs.mkdirSync(attemptOutputDir, { recursive: true });
  }

  let retryCount = 0;
  let lastValidReport: InvestigationReport | null = null;

  while (retryCount < maxRetry) {
    const formatValidation = validateReport(report);

    // ✅ SOL-003: 只看阻断性错误决定是否重试
    if (formatValidation.blockingErrors.length === 0) {
      // 只有警告性错误，记录但不重试
      if (formatValidation.warningErrors.length > 0 && !options.quiet) {
        console.log(`   ⚠️ Non-blocking validation issues detected: ${formatValidation.warningErrors.map(e => e.message).join('; ')}`);
        console.log('   Continuing with warnings...');
      }
      break;
    }

    const attemptNum = retryCount + 1;
    // 保存当前报告（可能包含部分有效内容）
    lastValidReport = report;

    if (!options.quiet) {
      console.log(`   ⚠️ Format validation failed (attempt ${attemptNum}/${maxRetry}): ${formatValidation.blockingErrors.map(e => e.message).join('; ')}`);
      console.log('   Retrying report generation with format corrections...');
    }

    // SOL-002: 保存当前失败的尝试报告
    // LOG-07: 增强保存尝试报告日志
    try {
      const attemptPath = await saveAttemptReport(report, attemptOutputDir, attemptNum);
      logger.info('saveAttemptReport success', {
        attemptPath,
        attemptNum,
        reportStructure: {
          metadataKeys: Object.keys(report.metadata),
          rootCauseCount: report.rootCauseAnalysis.length,
          solutionCount: report.solutions.length,
        },
      });
      if (!options.quiet) {
        console.log(`   📄 尝试报告已保存: ${attemptPath}`);
      }
    } catch (saveErr) {
      // LOG-07: 使用 error 级别，输出完整信息
      logger.error('saveAttemptReport failed', {
        error: saveErr instanceof Error ? saveErr.message : String(saveErr),
        stack: saveErr instanceof Error ? saveErr.stack : undefined,
        attemptOutputDir,
        attemptNum,
        reportStructure: {
          metadataKeys: Object.keys(report.metadata),
          rootCauseCount: report.rootCauseAnalysis.length,
          solutionCount: report.solutions.length,
        },
      });
    }

    // SOL-001: 调用 AI 评审生成审核报告并保存
    // SOL-003: reviewResult 提升至外层作用域，供 buildRetryPrompt 使用
    // LOG-08/09: 增强评审日志
    let reviewPath: string | undefined;
    let reviewResult: ReviewResult | undefined;
    try {
      reviewResult = await reviewReport(requirement, report, cwd, lang, options.timeout, options.debug);
      reviewPath = await saveReviewReport(reviewResult, attemptOutputDir, attemptNum, lang);
      logger.info('reviewReport success', {
        reviewPath,
        attemptNum,
        pass: reviewResult.pass,
        scores: reviewResult.scores,
        issuesCount: reviewResult.issues.length,
      });
      if (!options.quiet) {
        console.log(`   📋 审核报告已保存: ${reviewPath}`);
      }
    } catch (reviewErr) {
      // LOG-09: 使用 error 级别，输出完整信息
      logger.error('reviewReport failed', {
        error: reviewErr instanceof Error ? reviewErr.message : String(reviewErr),
        stack: reviewErr instanceof Error ? reviewErr.stack : undefined,
        attemptNum,
        reportStructure: {
          rootCauseCount: report.rootCauseAnalysis.length,
          solutionCount: report.solutions.length,
        },
      });
    }

    // 重试前清理子进程残留（SOL-003-4）
    try {
      killAllActiveChildren('SIGTERM');
    } catch (cleanupErr) {
      logger.warn('cleanup before retry failed', {
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_CLEANUP_DELAY_MS));

    try {
      // ✅ SOL-003: 使用结构化 RetryPromptOptions，传入 blockingErrors
      const retryPrompt = buildRetryPrompt({
        requirement,
        errors: formatValidation.blockingErrors,
        reviewResult,
        reviewPath,
        attemptNum,
        lang,
        debug: options.debug,
      });

      const timeoutS = options.timeout ?? DEFAULT_RETRY_TIMEOUT_S;

      report = await withTimeoutRace(
        generateInvestigationReport(retryPrompt, cwd, {
          rawPrompt: retryPrompt,
          lang,
          timeout: options.timeout,
          debug: options.debug,
          templateMode: options.templateMode,
        }),
        timeoutS * 1000,
        'generateInvestigationReport(retry)',
      );
    } catch (err) {
      const errorType = classifyRetryError(err instanceof Error ? err : new Error(String(err)));

      if (errorType === RetryErrorType.TEMPLATE_BUILD_ERROR) {
        // ✅ SOL-003: 检测到提示词模板构建错误（代码缺陷），直接中断
        console.error(`[investigation-requirement] 检测到提示词模板构建错误（代码缺陷），无法通过重试解决。`);
        console.error(`错误详情: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`建议: 请检查插件代码中的模板构建逻辑。`);
        throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
      }

      const isTimeout = errorType === RetryErrorType.TRANSIENT_ERROR;
      if (isTimeout) {
        logger.error('retry timeout', {
          error: err instanceof Error ? err.message : String(err),
          retryCount,
          timeout: options.timeout ?? DEFAULT_RETRY_TIMEOUT_S,
        });
      } else {
        logger.warn('retry attempt failed', {
          error: err instanceof Error ? err.message : String(err),
          retryCount,
          errorType,
        });
      }

      if (lastValidReport) {
        if (!options.quiet) {
          console.log('   ⚠️ Retry failed, using last valid report with partial results');
        }
        report = lastValidReport;
        break;
      }
      throw err;
    }

    retryCount++;
  }

  // 最终验证（记录警告但不阻断）
  const finalValidation = validateReport(report);
  if (finalValidation.warningErrors.length > 0) {
    if (!options.quiet) {
      console.log('   ⚠️ Final report has non-blocking validation issues:');
      finalValidation.warningErrors.forEach(e => console.log(`     - ${e.message}`));
    }
  }

  // SOL-002: 保存最终报告快照到尝试目录，与 report-attempt-N.md 并列，便于追溯
  try {
    const finalPath = await saveFinalReport(report, attemptOutputDir);
    if (!options.quiet) {
      console.log(`   📄 最终报告快照已保存: ${finalPath}`);
    }
  } catch (saveErr) {
    logger.warn('save final report snapshot failed', {
      error: saveErr instanceof Error ? saveErr.message : String(saveErr),
    });
  }

  // Step 2: AI 评审闭环
  let reviewResult: ReviewResult | undefined;
  if (!options.skipReview) {
    const retryResult = await reviewReportWithRetry(requirement, report, {
      cwd,
      lang,
      maxRetry,
      timeout: options.timeout,
      debug: options.debug,
    });

    reviewResult = retryResult.review;

    if (!reviewResult.pass) {
      return {
        success: false,
        reviewResult,
        error: `Investigation report review failed after ${maxRetry} retries. Issues: ${reviewResult.issues.map(i => i.description).join('; ')}`,
      };
    }

    if (!options.quiet) {
      console.log(`   ✅ Review passed (scores: ${formatScores(reviewResult.scores)})`);
    }
  }

  // Step 3: 输出报告
  const outputMode = determineOutputMode(options, cwd);
  const reportPath = await writeReport(report, outputMode, { force: options.force });

  if (!options.quiet) {
    console.log(`   📄 Report saved: ${reportPath}`);
  }

  // Step 4: 拆分流程（如果需要）
  let subReports: string[] = [];
  if (!options.skipSplit && shouldSplit(reportPath, splitThreshold)) {
    if (!options.quiet) {
      console.log(`   📊 Report exceeds ${splitThreshold} KB, triggering split...`);
    }

    const splitResult = await runSplitFlow(report, requirement, cwd, {
      lang,
      maxRetry,
      splitThreshold,
      outputDir: path.dirname(reportPath),
      quiet: options.quiet,
      timeout: options.timeout,
      debug: options.debug,
      templateMode: options.templateMode,
    });

    if (splitResult.success && splitResult.subReports) {
      subReports = splitResult.subReports;
    }
  }

  return {
    success: true,
    reportPath,
    subReports,
    reviewResult,
  };
}

// ============================================================
// 模式 2：交互模式（--interactive）
// ============================================================

async function runInteractiveMode(
  requirement: string,
  cwd: string,
  options: Required<Pick<InvestigationRequirementOptions, 'lang' | 'maxRetry' | 'splitThreshold'>> & InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  const { lang, maxRetry, splitThreshold } = options;

  if (!requirement) {
    return {
      success: false,
      error: 'Interactive mode requires requirement description.',
    };
  }

  console.log('');
  console.log('🔍 Starting interactive investigation...');
  console.log('   Type "quit" or Ctrl+C to exit at any time');
  console.log('');

  // Step 1: 生成初始报告
  let report = await generateInvestigationReport(requirement, cwd, { lang, templateMode: options.templateMode });
  let reportPath = '';

  // Step 2: 用户评审循环
  let iteration = 0;
  const maxIterations = maxRetry * 2;

  while (iteration < maxIterations) {
    iteration++;

    console.log(`\n📝 Iteration ${iteration}`);
    console.log('─'.repeat(50));

    // 显示报告摘要
    const reportMarkdown = generateReport(report);
    console.log('\n' + reportMarkdown.slice(0, 500) + (reportMarkdown.length > 500 ? '...' : ''));
    console.log('');

    // 询问用户反馈
    const feedback = await promptUser('\n💬 Your feedback (or "accept" to approve): ');

    if (feedback.toLowerCase() === 'quit' || feedback.toLowerCase() === 'exit') {
      console.log('\n⏹️ Investigation cancelled by user');
      return { success: false, error: 'User cancelled' };
    }

    if (feedback.toLowerCase() === 'accept' || feedback.toLowerCase() === 'ok') {
      // 用户接受报告
      const outputMode = determineOutputMode(options, cwd);
      reportPath = await writeReport(report, outputMode, { force: options.force });
      console.log(`\n✅ Report accepted and saved: ${reportPath}`);
      break;
    }

    // 基于反馈修正报告（使用 investigateWithFeedback 模板）
    console.log('\n🔄 Refining report based on feedback...');

    const prompt = await loadAndRenderTemplate(
      'investigateWithFeedback',
      { requirement, currentReport: reportMarkdown, feedback, date: new Date().toISOString() },
      lang,
      { mode: options.templateMode ?? 'strict' },
    );

    const aiResult = await callAI({ prompt, cwd, outputFormat: 'text', timeout: options.timeout, debug: options.debug, allowedTools: ['Read', 'Edit', 'Write'] });
    if (aiResult.success) {
      report = parseReport(aiResult.output, options.debug);
    }
  }

  // Step 3: 拆分（如果需要）
  let subReports: string[] = [];
  if (!options.skipSplit && reportPath && shouldSplit(reportPath, splitThreshold)) {
    const splitResult = await runSplitFlow(report, requirement, cwd, {
      lang,
      maxRetry,
      splitThreshold,
      outputDir: path.dirname(reportPath),
      quiet: options.quiet,
      timeout: options.timeout,
      debug: options.debug,
      templateMode: options.templateMode,
    });
    if (splitResult.success && splitResult.subReports) {
      subReports = splitResult.subReports;
    }
  }

  return {
    success: true,
    reportPath,
    subReports,
  };
}

// ============================================================
// 模式 3：反馈修正模式（--feedback）
// ============================================================

async function runFeedbackMode(
  requirement: string,
  cwd: string,
  options: Required<Pick<InvestigationRequirementOptions, 'lang' | 'maxRetry' | 'splitThreshold'>> & InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  const { lang } = options;

  if (!options.reportPath) {
    return {
      success: false,
      error: 'Feedback mode requires --report-path to specify the report to modify.',
    };
  }

  if (!fs.existsSync(options.reportPath)) {
    return {
      success: false,
      error: `Report not found: ${options.reportPath}`,
    };
  }

  if (!options.quiet) {
    console.log('');
    console.log('🔄 Starting feedback revision...');
    console.log(`   Report: ${options.reportPath}`);
    console.log('');
  }

  // 解析已有报告
  const existingReportContent = fs.readFileSync(options.reportPath, 'utf-8');
  const report = parseReport(existingReportContent, options.debug);

  // 构建反馈内容
  const feedbackContent = requirement || 'Please review and improve this report.';

  // 使用 investigateWithFeedback 模板（参数: requirement, currentReport, feedback, date）
  const prompt = await loadAndRenderTemplate(
    'investigateWithFeedback',
    {
      requirement: report.metadata.requirementSource,
      currentReport: existingReportContent,
      feedback: feedbackContent,
      date: new Date().toISOString(),
    },
    lang,
    { mode: options.templateMode ?? 'strict' },
  );

  const aiResult = await callAI({ prompt, cwd, outputFormat: 'text', timeout: options.timeout, debug: options.debug, allowedTools: ['Read', 'Write'] });

  if (!aiResult.success) {
    return {
      success: false,
      error: `AI revision failed: ${aiResult.error}`,
    };
  }

  // 解析修正后的报告
  const revisedReport = parseReport(aiResult.output, options.debug);

  // 输出修正后的报告
  const outputPath = options.reportPath.replace('.md', '-revised.md');
  fs.writeFileSync(outputPath, generateReport(revisedReport));

  if (!options.quiet) {
    console.log(`   ✅ Revised report saved: ${outputPath}`);
  }

  return {
    success: true,
    reportPath: outputPath,
  };
}

// ============================================================
// 模式 4：评审模式（--review）
// ============================================================

async function runReviewMode(
  requirement: string,
  cwd: string,
  options: Required<Pick<InvestigationRequirementOptions, 'lang' | 'maxRetry'>> & InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  const { lang } = options;

  if (!options.reportPath) {
    return {
      success: false,
      error: 'Review mode requires --report-path to specify the report to review.',
    };
  }

  if (!fs.existsSync(options.reportPath)) {
    return {
      success: false,
      error: `Report not found: ${options.reportPath}`,
    };
  }

  if (!options.quiet) {
    console.log('');
    console.log('🔎 Starting review...');
    console.log(`   Report: ${options.reportPath}`);
    console.log('');
  }

  // 解析报告
  const reportContent = fs.readFileSync(options.reportPath, 'utf-8');
  const report = parseReport(reportContent, options.debug);

  // AI 评审
  const reviewResult = await reviewReport(report.metadata.requirementSource, report, cwd, lang);

  if (options.json) {
    console.log(JSON.stringify(reviewResult, null, 2));
  } else {
    console.log('\n📊 Review Result:');
    console.log(`   Pass: ${reviewResult.pass ? '✅' : '❌'}`);
    console.log(`   Scores:`);
    console.log(`     - Root Cause Alignment: ${reviewResult.scores.rootCauseAlignment}`);
    console.log(`     - Solution Effectiveness: ${reviewResult.scores.solutionEffectiveness}`);
    console.log(`     - Checkpoint Completeness: ${reviewResult.scores.checkpointCompleteness}`);

    if (reviewResult.issues.length > 0) {
      console.log('\n   Issues:');
      for (const issue of reviewResult.issues) {
        console.log(`     [${issue.severity}] ${issue.dimension}: ${issue.description}`);
        console.log(`       Suggestion: ${issue.suggestion}`);
      }
    }
  }

  return {
    success: reviewResult.pass,
    reportPath: options.reportPath,
    reviewResult,
  };
}

// ============================================================
// 模式 5：拆分模式（--split）
// ============================================================

async function runSplitMode(
  cwd: string,
  options: Required<Pick<InvestigationRequirementOptions, 'lang' | 'maxRetry' | 'splitThreshold'>> & InvestigationRequirementOptions,
): Promise<InvestigationResult> {
  const { lang, maxRetry, splitThreshold } = options;

  if (!options.reportPath) {
    return {
      success: false,
      error: 'Split mode requires --report-path to specify the report to split.',
    };
  }

  if (!fs.existsSync(options.reportPath)) {
    return {
      success: false,
      error: `Report not found: ${options.reportPath}`,
    };
  }

  if (!options.quiet) {
    console.log('');
    console.log('✂️ Starting split...');
    console.log(`   Report: ${options.reportPath}`);
    console.log(`   Threshold: ${splitThreshold} KB`);
    console.log('');
  }

  // 解析报告
  const reportContent = fs.readFileSync(options.reportPath, 'utf-8');
  const report = parseReport(reportContent, options.debug);

  // 执行拆分流程
  const result = await runSplitFlow(report, report.metadata.requirementSource, cwd, {
    lang,
    maxRetry,
    splitThreshold,
    outputDir: path.dirname(options.reportPath),
    quiet: options.quiet,
    timeout: options.timeout,
    debug: options.debug,
    templateMode: options.templateMode,
  });

  return result;
}

// ============================================================
// 拆分流程（6 维度审核 + 递归）
// ============================================================

interface SplitFlowOptions {
  lang: 'zh' | 'en';
  maxRetry: number;
  splitThreshold: number;
  outputDir: string;
  quiet?: boolean;
  depth?: number;
  /** AI 调用超时时间（秒） */
  timeout?: number;
  /** 调试模式 */
  debug?: boolean;
  templateMode?: RenderTemplateMode;
}

async function runSplitFlow(
  report: InvestigationReport,
  requirement: string,
  cwd: string,
  options: SplitFlowOptions,
): Promise<InvestigationResult> {
  const { lang, maxRetry, splitThreshold, outputDir, quiet } = options;
  const depth = options.depth ?? 0;

  // 递归深度检查 - 触及深度底线直接返回，不强制继续拆分
  if (depth >= MAX_SPLIT_DEPTH) {
    if (!quiet) {
      console.log(`   ⚠️ Max split depth (${MAX_SPLIT_DEPTH}) reached`);
      console.log(`   💡 Sub-report may still need splitting. Use --split mode to continue.`);
    }
    return {
      success: true,
      subReports: [],
      needsFurtherSplit: true,
      furtherSplitCandidates: [outputDir], // 当前报告路径
    };
  }

  // Step 1: 生成拆分方案
  if (!quiet) {
    console.log('   📋 Generating split plan...');
  }

  let splitPlan: SplitPlan | undefined;
  let splitReviewResult: SplitReviewResult | undefined;

  // Step 2: 拆分方案审核闭环（含重试）
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    splitPlan = await generateSplitPlan(report, cwd, lang);
    splitReviewResult = await reviewSplitPlan(report, splitPlan, cwd, lang);

    if (splitReviewResult.pass) {
      break;
    }

    if (!quiet) {
      console.log(`   ⚠️ Split plan review failed (attempt ${attempt + 1}/${maxRetry + 1})`);
      console.log(`     Issues: ${splitReviewResult.issues.length}`);
    }

    if (attempt >= maxRetry) {
      return {
        success: false,
        splitPlan,
        splitReviewResult,
        error: `Split plan review failed after ${maxRetry} retries. Issues: ${splitReviewResult.issues.map(i => i.description).join('; ')}`,
      };
    }
  }

  if (!splitPlan) {
    return { success: false, error: 'Failed to generate split plan' };
  }

  if (!quiet) {
    console.log(`   ✅ Split plan approved (${splitPlan.items.length} sub-items)`);
  }

  // Step 3: 为每个子项生成子报告（写入 sub/ 目录）
  const subReports: string[] = [];
  const subDir = path.join(outputDir, 'sub');
  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }
  const outputMode: OutputMode = { type: 'dir', path: subDir };

  for (let i = 0; i < splitPlan.items.length; i++) {
    const item = splitPlan.items[i];
    if (!item) continue; // 类型安全检查
    if (!quiet) {
      console.log(`   📄 Generating sub-report ${i + 1}/${splitPlan.items.length}: ${item.title}`);
    }

    // 为子项生成独立调查报告
    const subReport = await generateSubReport(report, item, requirement, cwd, lang, options.timeout, options.debug, options.templateMode);
    const subSlug = slugify(item.title);
    const subReportPath = path.join(subDir, `${subSlug}.md`);
    fs.writeFileSync(subReportPath, generateReport(subReport));
    subReports.push(subReportPath);

    // Step 4: 递归检查子报告是否需要拆分（含深度限制）
    if (shouldSplit(subReportPath, splitThreshold)) {
      // 深度预检查：下一层是否会超限？
      if (depth + 1 >= MAX_SPLIT_DEPTH) {
        // 触及底线 → 记录为待拆分候选，不强制递归
        if (!quiet) {
          console.log(`   📊 Sub-report ${i + 1} exceeds threshold, but depth limit reached`);
          console.log(`   💡 Run: projmnt4claude investigation-requirement --split --report-path "${subReportPath}"`);
        }
        // 继续处理其他子项，不阻塞
        continue;
      }

      if (!quiet) {
        console.log(`   📊 Sub-report ${i + 1} exceeds threshold, recursing (depth ${depth + 1}/${MAX_SPLIT_DEPTH})...`);
      }

      const recursiveResult = await runSplitFlow(subReport, item.description, cwd, {
        ...options,
        outputDir: path.dirname(subReportPath),
        depth: depth + 1,
      });

      if (recursiveResult.success && recursiveResult.subReports) {
        // 递归生成的子报告也加入列表
        subReports.push(...recursiveResult.subReports);
      }
    }
  }

  if (!quiet) {
    console.log(`   ✅ Split complete: ${subReports.length} reports generated`);
  }

  return {
    success: true,
    subReports,
    splitPlan,
    splitReviewResult,
  };
}

// ============================================================
// 重试超时与清理辅助函数
// ============================================================

const DEFAULT_RETRY_TIMEOUT_S = 300;
const RETRY_CLEANUP_DELAY_MS = 1000;

/**
 * 获取完整格式示例（与 investigate 模板示例一致，SOL-003）
 *
 * 直接复用 report-contract 契约常量构建，确保重试提示词中的格式示例
 * 与初始 prompt 模板、解析器三方契约一致，杜绝漂移。
 */
function getFormatExample(lang: 'zh' | 'en'): string {
  if (lang === 'zh') {
    return [
      '---',
      '# 调查报告：{title}',
      '',
      `## ${REPORT_SECTIONS.metadata.zh}`,
      `- **${METADATA_FIELDS.requirementSource.zh}**: {requirement}`,
      `- **${METADATA_FIELDS.investigationDate.zh}**: {date}`,
      `- **${METADATA_FIELDS.investigationDir.zh}**: investigation-{slug}`,
      `- **${METADATA_FIELDS.language.zh}**: zh`,
      '',
      `## ${REPORT_SECTIONS.rootCauseAnalysis.zh}`,
      `### ${buildCaId(1)}: {原因标题}`,
      '{原因详细描述}',
      '',
      `## ${REPORT_SECTIONS.solutions.zh}`,
      `### ${buildSolId(1)}: {方案标题} → 对应 ${buildCaId(1)}`,
      '{方案详细描述}',
      `- ${SOLUTION_FIELDS.files.zh}: \`src/path/to/file.ts\``,
      `- ${SOLUTION_FIELDS.expectedChanges.zh}: {变更描述}`,
      '',
      `## ${REPORT_SECTIONS.checkpoints.zh}`,
      `### ${buildSolId(1)} 相关检查点`,
      `- [ai review] 验证解决方案设计是否符合需求 → ${buildSolId(1)}`,
      `- [ai qa] 测试核心功能是否正常工作 → ${buildSolId(1)}`,
      `- [script] 运行单元测试确保无回归 → ${buildSolId(1)}`,
      '',
      `## ${REPORT_SECTIONS.assessment.zh}`,
      `- ${ASSESSMENT_FIELDS.complexity.zh}: {low|medium|high}`,
      `- ${ASSESSMENT_FIELDS.impactScope.zh}: {有限|中等|广泛}`,
      `- ${ASSESSMENT_FIELDS.estimatedMinutes.zh}: {N} 分钟`,
      '---',
    ].join('\n');
  }

  return [
    '---',
    '# Investigation Report: {title}',
    '',
    `## ${REPORT_SECTIONS.metadata.en}`,
    `- **${METADATA_FIELDS.requirementSource.en}**: {requirement}`,
    `- **${METADATA_FIELDS.investigationDate.en}**: {date}`,
    `- **${METADATA_FIELDS.investigationDir.en}**: investigation-{slug}`,
    `- **${METADATA_FIELDS.language.en}**: en`,
    '',
    `## ${REPORT_SECTIONS.rootCauseAnalysis.en}`,
    `### ${buildCaId(1)}: {Root cause title}`,
    '{Root cause detailed description}',
    '',
    `## ${REPORT_SECTIONS.solutions.en}`,
    `### ${buildSolId(1)}: {Solution title} → Corresponds to ${buildCaId(1)}`,
    '{Solution detailed description}',
    `- ${SOLUTION_FIELDS.files.en}: \`src/path/to/file.ts\``,
    `- ${SOLUTION_FIELDS.expectedChanges.en}: {Change description}`,
    '',
    `## ${REPORT_SECTIONS.checkpoints.en}`,
    `### ${buildSolId(1)} Related Checkpoints`,
    `- [ai review] Verify solution design meets requirements → ${buildSolId(1)}`,
    `- [ai qa] Test core functionality works correctly → ${buildSolId(1)}`,
    `- [script] Run unit tests to ensure no regression → ${buildSolId(1)}`,
    '',
    `## ${REPORT_SECTIONS.assessment.en}`,
    `- ${ASSESSMENT_FIELDS.complexity.en}: {low|medium|high}`,
    `- ${ASSESSMENT_FIELDS.impactScope.en}: {limited|moderate|extensive}`,
    `- ${ASSESSMENT_FIELDS.estimatedMinutes.en}: {N} minutes`,
    '---',
  ].join('\n');
}

/**
 * 构建结构化重试 prompt（SOL-003: 结构化模板 + 审核建议摘要 + 完整格式示例）
 *
 * 相较 SOL-001 仅引用审核报告路径的方案，SOL-003 进一步：
 * 1. 直接在重试提示中嵌入审核建议摘要（severity + dimension + suggestion）
 * 2. 嵌入完整格式示例，避免 AI 仅凭错误消息推断修正方向
 * 3. 使用模板常量 + 占位符替换，i18n 双语支持
 *
 * 降级策略：无 reviewResult/reviewPath 时仍保留原始错误反馈，确保异常路径可用。
 */
function buildRetryPrompt(options: RetryPromptOptions): string {
  const logger = createLogger('investigation-requirement', undefined, options.debug);
  const { requirement, errors, reviewResult, reviewPath, attemptNum, lang } = options;

  // LOG-10: 重试提示词构建日志
  logger.debug('buildRetryPrompt input', {
    requirementLength: requirement.length,
    errorCount: errors.length,
    errorRules: errors.map(e => e.rule),
    hasReviewResult: !!reviewResult,
    reviewIssueCount: reviewResult?.issues?.length ?? 0,
    reviewScores: reviewResult?.scores,
    attemptNum,
    lang,
  });

  // 构建错误摘要（含 rule 标识，便于 AI 定位校验规则）
  const errorSummary = errors
    .map(e => `- [${e.rule}] ${e.message}`)
    .join('\n')
    .substring(0, MAX_RETRY_FEEDBACK_LEN);

  // SOL-004: 构建审核建议摘要（来自 AI 评审员的结构化 issues）
  // 包含审核评分块 + 完整 issue 信息（severity/dimension/description + suggestion）
  // 显式三段守卫确保 TS 缩窄 reviewResult 和 issues 非空
  let suggestionsSummary: string;
  if (reviewResult && reviewResult.issues && reviewResult.issues.length > 0) {
    const scores = reviewResult.scores;
    const scoresBlock = lang === 'zh'
      ? `**审核评分**:\n` +
        `- 原因分析对齐度: ${scores.rootCauseAlignment}\n` +
        `- 解决方案有效性: ${scores.solutionEffectiveness}\n` +
        `- 检查点完善度: ${scores.checkpointCompleteness}`
      : `**Review Scores**:\n` +
        `- Root Cause Alignment: ${scores.rootCauseAlignment}\n` +
        `- Solution Effectiveness: ${scores.solutionEffectiveness}\n` +
        `- Checkpoint Completeness: ${scores.checkpointCompleteness}`;
    const issuesBlock = reviewResult.issues
      .map(i =>
        `- [${i.severity}] ${i.dimension}: ${i.description}\n` +
        `  ${lang === 'zh' ? '建议' : 'Suggestion'}: ${i.suggestion}`,
      )
      .join('\n');
    suggestionsSummary = `${scoresBlock}\n\n**${lang === 'zh' ? '审核发现的问题' : 'Review Issues'}**:\n${issuesBlock}`
      .substring(0, MAX_RETRY_FEEDBACK_LEN);
  } else {
    suggestionsSummary = lang === 'zh' ? '无具体建议' : 'No specific suggestions';
  }

  const formatExample = getFormatExample(lang);

  // SOL-001: 替换格式示例中的占位符，避免向 AI 传递含占位符的格式参考
  const slug = slugify(requirement);
  const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const title = requirement.slice(0, 50);
  const N = '60';

  const filledFormatExample = formatExample
    // 通用占位符
    .replace('{title}', title)
    .replace('{requirement}', requirement)
    .replace('{date}', date)
    .replace('{slug}', slug)
    .replaceAll('{N}', N)
    .replace('{low|medium|high}', 'medium')
    // 中文示例占位符
    .replace('{原因标题}', '示例原因标题')
    .replace('{原因详细描述}', '示例原因详细描述')
    .replace('{方案标题}', '示例方案标题')
    .replace('{方案详细描述}', '示例方案详细描述')
    .replace('{变更描述}', '示例变更描述')
    .replace('{有限|中等|广泛}', '中等')
    // 英文示例占位符
    .replace('{Root cause title}', 'Sample root cause title')
    .replace('{Root cause detailed description}', 'Sample root cause detailed description')
    .replace('{Solution title}', 'Sample solution title')
    .replace('{Solution detailed description}', 'Sample solution detailed description')
    .replace('{Change description}', 'Sample change description')
    .replace('{limited|moderate|extensive}', 'moderate');

  const template = lang === 'zh' ? RETRY_PROMPT_TEMPLATE_ZH : RETRY_PROMPT_TEMPLATE_EN;
  const reviewPathDisplay = reviewPath ?? (lang === 'zh' ? '未生成审核报告' : 'No review report generated');

  // SOL-003: 使用 renderTemplate + strict 模式，在模板渲染阶段检测未替换占位符
  // 如果有占位符未替换，renderTemplate 会抛出错误，被外层 catch 捕获并触发 TEMPLATE_BUILD_ERROR
  return renderTemplate(template, {
    requirement,
    attemptNum: String(attemptNum),
    errorSummary: errorSummary || (lang === 'zh' ? '无格式错误详情' : 'No format error details'),
    suggestionsSummary,
    reviewPath: reviewPathDisplay,
    formatExample: filledFormatExample,
  }, { mode: 'strict' });
}

/**
 * SOL-002: 保存尝试报告
 */
async function saveAttemptReport(
  report: InvestigationReport,
  outputDir: string,
  attemptNum: number,
): Promise<string> {
  const content = generateReport(report);
  const filePath = path.join(outputDir, `report-attempt-${attemptNum}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * SOL-001/002: 格式化审核报告为 Markdown（支持 i18n）
 */
function formatReviewReport(
  reviewResult: ReviewResult,
  attemptNum: number,
  lang: 'zh' | 'en',
): string {
  const { pass, scores, issues } = reviewResult;

  if (lang === 'zh') {
    const lines = [
      `# 审核报告（第 ${attemptNum} 次尝试）`,
      '',
      '## 审核结果',
      `- **通过状态**: ${pass ? '通过' : '未通过'}`,
      `- **根因对齐度**: ${scores.rootCauseAlignment}/100`,
      `- **解决方案有效性**: ${scores.solutionEffectiveness}/100`,
      `- **检查点完善度**: ${scores.checkpointCompleteness}/100`,
      '',
      '## 问题列表',
    ];
    issues.forEach((issue, i) => {
      lines.push(
        '',
        `### 问题 ${i + 1}: ${issue.dimension}`,
        `- **严重度**: ${issue.severity}`,
        `- **描述**: ${issue.description}`,
        `- **建议**: ${issue.suggestion}`,
      );
    });
    lines.push('', '## 修正建议汇总');
    issues.filter(i => i.severity === 'critical').forEach(i => lines.push(`- [关键] ${i.suggestion}`));
    issues.filter(i => i.severity === 'major').forEach(i => lines.push(`- [重要] ${i.suggestion}`));
    return lines.join('\n');
  }

  // English
  const lines = [
    `# Review Report (Attempt ${attemptNum})`,
    '',
    '## Review Results',
    `- **Pass Status**: ${pass ? 'Passed' : 'Failed'}`,
    `- **Root Cause Alignment**: ${scores.rootCauseAlignment}/100`,
    `- **Solution Effectiveness**: ${scores.solutionEffectiveness}/100`,
    `- **Checkpoint Completeness**: ${scores.checkpointCompleteness}/100`,
    '',
    '## Issue List',
  ];
  issues.forEach((issue, i) => {
    lines.push(
      '',
      `### Issue ${i + 1}: ${issue.dimension}`,
      `- **Severity**: ${issue.severity}`,
      `- **Description**: ${issue.description}`,
      `- **Suggestion**: ${issue.suggestion}`,
    );
  });
  lines.push('', '## Correction Suggestions Summary');
  issues.filter(i => i.severity === 'critical').forEach(i => lines.push(`- [Critical] ${i.suggestion}`));
  issues.filter(i => i.severity === 'major').forEach(i => lines.push(`- [Major] ${i.suggestion}`));
  return lines.join('\n');
}

/**
 * SOL-002: 保存最终报告快照（循环结束后的最终状态）
 */
async function saveFinalReport(
  report: InvestigationReport,
  outputDir: string,
): Promise<string> {
  const content = generateReport(report);
  const filePath = path.join(outputDir, 'report-final.md');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * SOL-001/002: 保存审核报告
 */
async function saveReviewReport(
  reviewResult: ReviewResult,
  outputDir: string,
  attemptNum: number,
  lang: 'zh' | 'en',
): Promise<string> {
  const reviewPath = path.join(outputDir, `report-attempt-${attemptNum}-review.md`);
  const content = formatReviewReport(reviewResult, attemptNum, lang);
  fs.writeFileSync(reviewPath, content, 'utf-8');
  return reviewPath;
}

/**
 * Promise.race 超时包装
 */
function withTimeoutRace<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 生成调查报告
 */
interface GenerateInvestigationReportOptions {
  lang: 'zh' | 'en';
  timeout?: number;
  debug?: boolean;
  /** SOL-001: 跳过模板渲染，直接使用原始 prompt（避免双层格式示例嵌套） */
  rawPrompt?: string;
  /** 模板渲染模式：strict（默认）、lenient、auto-fill */
  templateMode?: RenderTemplateMode;
}

async function generateInvestigationReport(
  requirement: string,
  cwd: string,
  optionsOrLang: GenerateInvestigationReportOptions | 'zh' | 'en',
  timeout?: number,
  debug?: boolean,
): Promise<InvestigationReport> {
  // 兼容旧签名：直接传 lang 字符串
  const opts: GenerateInvestigationReportOptions =
    typeof optionsOrLang === 'string'
      ? { lang: optionsOrLang, timeout, debug }
      : optionsOrLang;

  let prompt: string;

  if (opts.rawPrompt) {
    // SOL-001: retry 场景直接使用已构建的 prompt，避免 investigate 模板再嵌入未替换格式示例
    prompt = opts.rawPrompt;
  } else {
    const slug = slugify(requirement);
    const date = new Date().toISOString();
    const projectContext = await getProjectContext(cwd);
    const title = requirement.slice(0, 50);
    const N = '60';

    prompt = await loadAndRenderTemplate(
      'investigate',
      { requirement, projectContext, date, slug, title, N },
      opts.lang,
      { mode: opts.templateMode ?? 'strict' },
    );
  }

  const result = await callAI({ prompt, cwd, outputFormat: 'text', timeout: opts.timeout, debug: opts.debug, allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'] });

  if (!result.success) {
    throw new Error(`Failed to generate investigation report: ${result.error}`);
  }

  return parseReport(result.output, opts.debug);
}

/**
 * 获取项目上下文
 */
async function getProjectContext(cwd: string): Promise<string> {
  const parts: string[] = [];

  // 读取 config.json
  const configPath = path.join(cwd, '.projmnt4claude', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      parts.push(`Language: ${config.prompts?.language || 'zh'}`);
    } catch { /* ignore */ }
  }

  // 列出主要目录
  const mainDirs = ['src', 'lib', 'docs', 'tests', 'test'];
  const existingDirs = mainDirs.filter(d => fs.existsSync(path.join(cwd, d)));
  if (existingDirs.length > 0) {
    parts.push(`Main directories: ${existingDirs.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * 生成子报告（基于拆分项）
 */
async function generateSubReport(
  parentReport: InvestigationReport,
  splitItem: SplitPlan['items'][0],
  requirement: string,
  cwd: string,
  lang: 'zh' | 'en',
  timeout?: number,
  debug?: boolean,
  templateMode?: RenderTemplateMode,
): Promise<InvestigationReport> {
  const subPrompt = await loadAndRenderTemplate(
    'investigate',
    {
      requirement: `[Sub-investigation] ${splitItem.title}\n\nScope: ${splitItem.scope}\nDescription: ${splitItem.description}\n\nOriginal requirement: ${requirement}`,
      projectContext: await getProjectContext(cwd),
      date: new Date().toISOString(),
      slug: slugify(splitItem.title),
      title: splitItem.title.slice(0, 50),
      N: '60',
    },
    lang,
    { mode: templateMode ?? 'strict' },
  );

  const result = await callAI({ prompt: subPrompt, cwd, outputFormat: 'text', timeout, debug, allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'] });

  if (!result.success) {
    throw new Error(`Failed to generate sub-report: ${result.error}`);
  }

  const subReport = parseReport(result.output, debug);

  // 继承父报告的元数据
  subReport.metadata.parentReport = '../report.md';
  subReport.metadata.dependsOn = splitItem.dependsOn.length > 0
    ? splitItem.dependsOn.map(d => `sub-${String(d + 1).padStart(2, '0')}.md`)
    : undefined;

  return subReport;
}

/**
 * 写入报告文件
 */
async function writeReport(
  report: InvestigationReport,
  outputMode: OutputMode,
  options: { prefix?: string; force?: boolean } = {},
): Promise<string> {
  const content = generateReport(report);

  let filePath: string;

  if (outputMode.type === 'file') {
    filePath = outputMode.path;
  } else {
    const slug = slugify(report.metadata.requirementSource);
    const prefix = options.prefix ? `${options.prefix}-` : '';
    const fileName = `${prefix}investigation-${slug}.md`;
    filePath = path.join(outputMode.path, fileName);
  }

  // 检查文件是否存在
  if (fs.existsSync(filePath) && !options.force) {
    // 添加时间戳后缀
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    filePath = `${base}-${Date.now()}${ext}`;
  }

  // 确保目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * 确定输出模式
 */
function determineOutputMode(
  options: InvestigationRequirementOptions,
  cwd: string,
): OutputMode {
  if (options.outputFile) {
    return { type: 'file', path: options.outputFile };
  }

  const outputDir = options.outputDir ?? path.join(cwd, 'investigations');
  return { type: 'dir', path: outputDir };
}

/**
 * 读取文件内容
 */
function readFileContent(filePath: string): string {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * 生成 slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * 格式化分数
 */
function formatScores(scores: ReviewResult['scores']): string {
  return `RCA=${scores.rootCauseAlignment}, SOL=${scores.solutionEffectiveness}, CP=${scores.checkpointCompleteness}`;
}

/**
 * 用户提示输入
 */
function promptUser(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================
// 导出
// ============================================================

export {
  buildRetryPrompt,
  generateInvestigationReport,
  runSplitFlow,
  writeReport,
};
export type { RetryPromptOptions };
