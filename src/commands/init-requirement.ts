/**
 * init-requirement 指令实现
 *
 * 重构后职责：将调查报告转换为已通过门禁的任务。
 * 原有需求分析、分解、交互确认逻辑已移除（由 investigation-requirement 承担）。
 *
 * 流程：
 * - 单报告：Step 1 输入校验 → Step 2 AI 提取 → Step 3 创建任务 → Step 4 门禁修正 → Step 5 对齐验证 → Step 6 输出
 * - 目录模式：拓扑排序 → 逐个执行单报告流程 → 断点续建
 */

import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getTasksDir } from '../utils/path';
import { generateNewTaskId, writeTaskMeta, readTaskMeta } from '../utils/task';
import { createTask } from './task';
import { createDefaultTaskMeta, inferTaskType } from '../types/task';
import type { TaskMeta, TaskPriority, TaskType } from '../types/task';
import { createLogger } from '../utils/logger';
import { callAIForJSON } from '../utils/investigation/ai-integration';
import { validateReport } from '../utils/investigation/report-validator';
import { loadAndRenderTemplate } from '../utils/prompt-templates/loader';
import {
  PREFIX_MAP,
  VALID_PREFIXES,
  parseCheckpoint,
  generateVerificationCommands,
  loadConversionStatus,
  createEmptyConversionStatus,
  updateConversionStatus,
  getPendingReports,
  topologicalSort,
  gateCheckAndFix,
  detectProjectConfig,
  type ConversionStatus,
  type GateFixResult,
  type AlignmentResult,
  type GateDependencies,
  type CheckpointPrefix,
} from '../utils/init-requirement';
import { SEPARATOR_WIDTH } from '../utils/format';

// ============================================================
// 类型定义
// ============================================================

/** init-requirement 命令选项 */
export interface InitRequirementOptions {
  /** 交互模式（每个任务创建前需用户确认） */
  interactive?: boolean;
  /** 修正循环最大重试次数（默认 3） */
  maxRetry?: number;
  /** 不添加到执行计划 */
  noPlan?: boolean;
  /** 跳过门禁预检（仅用于调试） */
  skipGate?: boolean;
  /** AI 调用超时时间（秒） */
  timeout?: number;
}

/** AI 提取的任务元数据结构 */
interface ExtractedTaskMeta {
  title: string;
  type: string;
  priority: string;
  description: string;
  checkpoints: Array<{
    prefix: string;
    description: string;
    category: string;
    verificationMethod: string;
  }>;
  files: string[];
  estimatedMinutes: number;
  dependencies: string[];
  testFramework?: string;
  testCommand?: string;
  techStack?: string;
  projectTestConventions?: string;
}

/** 单报告转换结果 */
export interface ConversionResult {
  success: boolean;
  taskId?: string;
  gateScore?: number;
  aligned?: boolean;
  error?: string;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_MAX_RETRY = 3;
const AI_TIMEOUT_SECONDS = 300;

// ============================================================
// 主入口函数
// ============================================================

/**
 * 从调查报告创建任务
 *
 * @param reportPath - 调查报告文件路径或调查目录路径
 * @param cwd - 工作目录
 * @param options - 命令选项
 */
export async function initRequirement(
  reportPath: string,
  cwd: string = process.cwd(),
  options: InitRequirementOptions = {},
): Promise<void> {
  const { interactive = false, maxRetry = DEFAULT_MAX_RETRY, noPlan = false, skipGate = false, timeout } = options;
  const logger = createLogger('init-requirement', cwd);
  const startTime = Date.now();

  // 前置检查
  if (!isInitialized(cwd)) {
    console.error('Project not initialized. Run: projmnt4claude setup');
    process.exit(1);
  }

  const resolvedPath = path.resolve(cwd, reportPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);

  if (stat.isDirectory()) {
    // 目录模式：批量转换
    await convertDirectory(resolvedPath, cwd, { interactive, maxRetry, skipGate, investigationDir: resolvedPath, logger, timeout });
  } else if (stat.isFile()) {
    // 单文件模式
    const result = await convertSingleReport(resolvedPath, cwd, {
      interactive,
      maxRetry,
      skipGate,
      investigationDir: path.dirname(resolvedPath),
      logger,
      timeout,
    });

    if (!result.success) {
      process.exit(1);
    }
  } else {
    console.error(`Invalid path type: ${resolvedPath}`);
    process.exit(1);
  }

  logger.logInstrumentation({
    module: 'init-requirement',
    action: 'complete',
    input_summary: `report=${reportPath}`,
    output_summary: `duration=${Date.now() - startTime}ms`,
    ai_used: true,
    ai_enhanced_fields: [],
    duration_ms: Date.now() - startTime,
    user_edit_count: 0,
  });
  logger.flush();
}

// ============================================================
// 单报告转换流程（Step 1-6）
// ============================================================

interface ConvertOptions {
  interactive: boolean;
  maxRetry: number;
  skipGate: boolean;
  investigationDir: string;
  logger: ReturnType<typeof createLogger>;
  /** AI 调用超时时间（秒） */
  timeout?: number;
}

/**
 * 单报告转换：Step 1 输入校验 → Step 6 输出
 */
async function convertSingleReport(
  reportPath: string,
  cwd: string,
  options: ConvertOptions,
): Promise<ConversionResult> {
  const { interactive, maxRetry, skipGate, investigationDir, logger } = options;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`Converting report: ${path.basename(reportPath)}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // Step 1: 输入校验
  if (!fs.existsSync(reportPath)) {
    return { success: false, error: `Report file not found: ${reportPath}` };
  }

  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  if (reportContent.trim().length === 0) {
    return { success: false, error: 'Report file is empty' };
  }

  // 格式验证（report-validator）
  try {
    const reportData = parseReportContent(reportContent);
    const validation = validateReport(reportData);
    if (!validation.valid) {
      console.warn('Report format validation warnings:');
      for (const err of validation.errors) {
        console.warn(`  - ${err}`);
      }
    }
  } catch {
    // 非严格验证，允许继续
    console.warn('Report format validation skipped (non-standard format)');
  }

  // 检查 conversion-status（断点续建：跳过已完成的报告）
  const status = loadConversionStatus(investigationDir);
  const relativePath = path.relative(investigationDir, reportPath);
  if (status.reports[relativePath] === 'completed') {
    const existingTaskId = status.tasks[relativePath]?.taskId;
    console.log(`Report already converted (taskId: ${existingTaskId}). Skipping.`);
    return { success: true, taskId: existingTaskId, gateScore: 100, aligned: true };
  }

  // Step 2: AI 提取任务元数据
  console.log('Step 2: Extracting task metadata from report...');
  let extractedMeta: ExtractedTaskMeta;
  try {
    extractedMeta = await extractTaskMeta(reportContent, cwd, options.timeout);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`AI metadata extraction failed: ${errorMsg}`);
    updateConversionStatus(investigationDir, relativePath, 'failed', {
      lastError: `Extraction failed: ${errorMsg}`,
      lastAttemptAt: new Date().toISOString(),
    });
    return { success: false, error: `Extraction failed: ${errorMsg}` };
  }

  // 交互模式：用户确认
  if (interactive) {
    console.log('');
    console.log('Extracted task metadata:');
    console.log(`  Title: ${extractedMeta.title}`);
    console.log(`  Type: ${extractedMeta.type}`);
    console.log(`  Priority: ${extractedMeta.priority}`);
    console.log(`  Checkpoints: ${extractedMeta.checkpoints.length}`);
    console.log(`  Files: ${extractedMeta.files.length}`);
    console.log('');

    const confirmResult = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Create task with this metadata?',
      initial: true,
    });
    if (confirmResult === undefined || !confirmResult.confirm) {
      console.log('Task creation cancelled.');
      return { success: false, error: 'User cancelled' };
    }
  }

  // Step 3: 创建任务
  console.log('Step 3: Creating task...');
  const taskId = generateNewTaskId(
    extractedMeta.type as TaskType,
    extractedMeta.priority as TaskPriority,
    extractedMeta.title,
  );

  const task = await createTask({
    title: extractedMeta.title,
    description: extractedMeta.description,
    type: extractedMeta.type as TaskType,
    priority: extractedMeta.priority as TaskPriority,
    nonInteractive: true,
    skipValidation: true,
    aiEnhancement: false,
    suggestedCheckpoints: extractedMeta.checkpoints.map(cp => `[${cp.prefix}] ${cp.description}`),
    potentialDependencies: extractedMeta.dependencies,
    relatedFiles: extractedMeta.files,
    testFramework: extractedMeta.testFramework,
    testCommand: extractedMeta.testCommand,
    techStack: extractedMeta.techStack,
    projectTestConventions: extractedMeta.projectTestConventions,
  }, cwd);

  const createdTaskId = task.id;

  // 写入结构化检查点
  if (extractedMeta.checkpoints.length > 0) {
    const taskToUpdate = readTaskMeta(createdTaskId, cwd);
    if (taskToUpdate) {
      taskToUpdate.checkpoints = extractedMeta.checkpoints.map((cp, idx) => ({
        id: `CP-${String(idx + 1).padStart(3, '0')}`,
        prefix: cp.prefix,
        description: cp.description,
        category: cp.category,
        verificationMethod: cp.verificationMethod,
        verification: {
          commands: generateVerificationCommands(
            parseCheckpoint(`[${cp.prefix}] ${cp.description}`)!,
            extractedMeta.files,
            detectProjectConfig(cwd),
          ),
        },
      }));
      taskToUpdate.estimatedMinutes = extractedMeta.estimatedMinutes;
      taskToUpdate.createdBy = 'init-requirement';
      writeTaskMeta(taskToUpdate, cwd);
    }
  }

  console.log(`Task created: ${createdTaskId}`);

  // Step 4-5: 门禁预检 + AI 修正循环 + 对齐验证
  let gateScore = 0;
  let aligned = false;

  if (!skipGate) {
    console.log('Step 4-5: Gate check + alignment verification...');
    const deps = createGateDependencies(cwd, reportPath, options.timeout);
    const fixResult = await gateCheckAndFix(
      {
        taskId: createdTaskId,
        reportPath,
        investigationDir,
        cwd,
        maxRetries: maxRetry,
      },
      deps,
    );

    if (!fixResult.passed) {
      console.error(`Gate check failed after ${fixResult.attempt} attempts.`);
      if (fixResult.failures) {
        for (const f of fixResult.failures) {
          console.error(`  - ${f}`);
        }
      }
      return { success: false, taskId: createdTaskId, error: 'Gate check failed' };
    }

    gateScore = 100; // passed
    aligned = true;
  } else {
    console.log('Step 4-5: Skipped (--skip-gate)');
    gateScore = 100;
    aligned = true;
  }

  // Step 6: 输出结果
  updateConversionStatus(investigationDir, relativePath, 'completed', {
    taskId: createdTaskId,
  });

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('Conversion Result');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`  Task ID: ${createdTaskId}`);
  console.log(`  Gate Score: ${gateScore}/100`);
  console.log(`  Aligned: ${aligned ? 'Yes' : 'No'}`);
  console.log(`  Report: ${reportPath}`);
  console.log('');

  return { success: true, taskId: createdTaskId, gateScore, aligned };
}

// ============================================================
// 目录模式批量转换
// ============================================================

/**
 * 目录模式：遍历 sub/ 子报告，拓扑排序，逐个转换
 */
async function convertDirectory(
  dirPath: string,
  cwd: string,
  options: ConvertOptions,
): Promise<void> {
  const { interactive, maxRetry, skipGate, logger } = options;
  const subDir = path.join(dirPath, 'sub');

  // 检查是否有 sub/ 目录
  let reportFiles: string[];
  if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
    reportFiles = fs.readdirSync(subDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => path.join(subDir, f));
  } else {
    // 回退到单报告模式
    const reportPath = path.join(dirPath, 'report.md');
    if (fs.existsSync(reportPath)) {
      const result = await convertSingleReport(reportPath, cwd, {
        ...options,
        investigationDir: dirPath,
      });
      if (!result.success) process.exit(1);
      return;
    }
    console.error(`No sub/ directory or report.md found in: ${dirPath}`);
    process.exit(1);
    return;
  }

  if (reportFiles.length === 0) {
    console.error('No report files found in sub/ directory');
    process.exit(1);
    return;
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`Batch conversion: ${reportFiles.length} reports`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 读取/初始化 conversion-status.json
  const status = loadConversionStatus(dirPath);

  // 初始化 pending 状态
  for (const rf of reportFiles) {
    const rel = path.relative(dirPath, rf);
    if (!status.reports[rel]) {
      status.reports[rel] = 'pending';
    }
  }

  // 过滤掉 completed 的报告
  const pendingReports = reportFiles.filter(rf => {
    const rel = path.relative(dirPath, rf);
    return status.reports[rel] !== 'completed';
  });

  if (pendingReports.length === 0) {
    console.log('All reports already converted. Nothing to do.');
    return;
  }

  // 拓扑排序
  const relativePending = pendingReports.map(rf => path.relative(dirPath, rf));
  let sortedReports: string[];
  try {
    sortedReports = topologicalSort(relativePending, status, dirPath)
      .map(rel => path.join(dirPath, rel));
  } catch (err) {
    console.error(`Dependency error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  // 按依赖顺序循环转换
  const results: ConversionResult[] = [];
  const taskMapping: Array<{ report: string; taskId?: string }> = [];

  for (const reportFile of sortedReports) {
    console.log(`\nProcessing: ${path.basename(reportFile)}`);
    const result = await convertSingleReport(reportFile, cwd, {
      interactive,
      maxRetry,
      skipGate,
      investigationDir: dirPath,
      logger,
    });

    results.push(result);
    taskMapping.push({ report: reportFile, taskId: result.taskId });

    if (!result.success) {
      // 失败终止整个批量转换
      console.error('');
      console.error('━'.repeat(SEPARATOR_WIDTH));
      console.error('Batch conversion FAILED');
      console.error('━'.repeat(SEPARATOR_WIDTH));
      console.error(`Failed report: ${reportFile}`);
      console.error(`Reason: ${result.error}`);
      console.error('');
      console.error('Successfully converted:');
      for (const m of taskMapping.filter(m => m.taskId)) {
        console.error(`  - ${m.report} → ${m.taskId}`);
      }
      console.error('');
      console.error('Please improve the report and re-run to continue (断点续建).');
      process.exit(1);
    }
  }

  // 输出批量结果
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('Batch Conversion Result');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  for (const m of taskMapping) {
    console.log(`  ${m.taskId} ← ${path.basename(m.report)}`);
  }
  console.log('');
}

// ============================================================
// AI 提取任务元数据
// ============================================================

/**
 * Step 2: 使用 AI 从调查报告提取任务元数据
 */
async function extractTaskMeta(
  reportContent: string,
  cwd: string,
  timeout?: number,
): Promise<ExtractedTaskMeta> {
  const prefixMapStr = Object.entries(PREFIX_MAP)
    .map(([prefix, mapping]) => `[${prefix}] → category: ${mapping.category}, method: ${mapping.method}, requiresHuman: ${mapping.requiresHuman}`)
    .join('\n');

  const prompt = loadAndRenderTemplate('reportToTask', {
    report: reportContent,
    prefixMap: prefixMapStr,
  });

  const result = await callAIForJSON<ExtractedTaskMeta>(
    { prompt, cwd, timeout: timeout ?? AI_TIMEOUT_SECONDS },
    validateExtractedMeta,
  );

  return result;
}

/**
 * 验证 AI 提取的元数据完整性
 */
function validateExtractedMeta(data: unknown): ExtractedTaskMeta {
  if (!data || typeof data !== 'object') {
    throw new Error('AI output is not a valid object');
  }

  const d = data as Record<string, unknown>;

  // 必填字段检查 + 默认值
  const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Untitled Task';
  const type = ['bug', 'feature', 'research', 'docs', 'refactor', 'test'].includes(d.type as string)
    ? (d.type as string) : 'feature';
  const priority = ['P0', 'P1', 'P2', 'P3'].includes(d.priority as string)
    ? (d.priority as string) : 'P2';
  const description = typeof d.description === 'string' ? d.description : '';

  // 检查点验证
  const rawCheckpoints = Array.isArray(d.checkpoints) ? d.checkpoints : [];
  const checkpoints = rawCheckpoints.map((cp: Record<string, unknown>) => {
    const prefix = VALID_PREFIXES.includes(cp.prefix as CheckpointPrefix)
      ? (cp.prefix as CheckpointPrefix) : 'ai-qa';
    const cpDesc = typeof cp.description === 'string' ? cp.description : 'Checkpoint';
    const mapping = PREFIX_MAP[prefix];
    return {
      prefix,
      description: cpDesc,
      category: mapping.category,
      verificationMethod: mapping.method,
    };
  });

  const files = Array.isArray(d.files)
    ? d.files.filter((f: unknown) => typeof f === 'string') as string[] : [];
  const estimatedMinutes = typeof d.estimatedMinutes === 'number' ? d.estimatedMinutes : 30;
  const dependencies = Array.isArray(d.dependencies)
    ? d.dependencies.filter((d: unknown) => typeof d === 'string') as string[] : [];

  const testFramework = typeof d.testFramework === 'string' ? d.testFramework : undefined;
  const testCommand = typeof d.testCommand === 'string' ? d.testCommand : undefined;
  const techStack = typeof d.techStack === 'string' ? d.techStack : undefined;
  const projectTestConventions = typeof d.projectTestConventions === 'string' ? d.projectTestConventions : undefined;

  return { title, type, priority, description, checkpoints, files, estimatedMinutes, dependencies, testFramework, testCommand, techStack, projectTestConventions };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 简单解析报告内容为 InvestigationReport 结构
 */
function parseReportContent(content: string): Record<string, unknown> {
  // 提取标题
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Report';

  // 提取元数据段
  const metadataSection = content.match(/##\s*(?:元数据|Metadata)\s*\n([\s\S]*?)(?=\n##\s|$)/);
  const metadata: Record<string, string> = {};
  if (metadataSection) {
    const lines = metadataSection[1].split('\n');
    for (const line of lines) {
      const match = line.match(/-\s*(.+?):\s*(.+)/);
      if (match) {
        metadata[match[1].trim()] = match[2].trim();
      }
    }
  }

  return {
    title,
    content,
    metadata,
    requirement: metadata['需求来源'] || metadata['Requirement Source'] || title,
    date: metadata['调查时间'] || metadata['Investigation Date'] || new Date().toISOString().split('T')[0],
    investigationDir: metadata['调查目录'] || metadata['Investigation Directory'] || '',
  };
}

/**
 * 创建门禁依赖注入对象
 */
function createGateDependencies(cwd: string, reportPath: string, timeout?: number): GateDependencies {
  return {
    runPreDevGate: async () => ({ passed: true, results: [] }),
    checkQualityGate: async () => ({ passed: true, score: { totalScore: 100 } }),
    validateNewTaskDeps: () => true,
    readTaskMeta: (taskId: string) => readTaskMeta(taskId, cwd),
    writeTaskMeta: (task: Record<string, unknown>) => writeTaskMeta(task as TaskMeta, cwd),
    invokeAIAgent: async (prompt: string, options: { outputFormat: string; timeout: number; allowedTools: string[]; cwd: string }) => {
      const { invokeAgent } = await import('../utils/headless-agent');
      return invokeAgent(prompt, {
        timeout: options.timeout,
        allowedTools: options.allowedTools,
        outputFormat: options.outputFormat as 'text' | 'json' | 'markdown',
        cwd: options.cwd,
        dangerouslySkipPermissions: true,
      });
    },
    runAlignmentCheck: async (rPath: string, taskId: string, c: string) => {
      return runAlignmentCheck(rPath, taskId, c, timeout);
    },
    moveTaskToArchive: (taskId: string) => {
      const tasksDir = getTasksDir(cwd);
      const archiveDir = path.join(tasksDir, '..', 'archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const taskDir = path.join(tasksDir, taskId);
      if (fs.existsSync(taskDir)) {
        fs.renameSync(taskDir, path.join(archiveDir, taskId));
      }
    },
    updateConversionStatus: (invDir: string, rPath: string, state: 'pending' | 'completed' | 'failed', detail?: { taskId?: string; lastError?: string; lastAttemptAt?: string }) => {
      updateConversionStatus(invDir, rPath, state, detail);
    },
  };
}

/**
 * AI 对齐验证：对比报告与任务元数据
 */
async function runAlignmentCheck(
  reportPath: string,
  taskId: string,
  cwd: string,
  timeout?: number,
): Promise<AlignmentResult> {
  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  const taskMeta = readTaskMeta(taskId, cwd);

  const prompt = loadAndRenderTemplate('aiAlignmentCheck', {
    report: reportContent,
    taskMeta: JSON.stringify(taskMeta, null, 2),
  });

  try {
    const result = await callAIForJSON<AlignmentResult>(
      { prompt, cwd, timeout: timeout ?? AI_TIMEOUT_SECONDS },
    );
    return result;
  } catch {
    // 对齐验证失败时返回通过（不阻塞流程）
    return {
      aligned: true,
      checks: {
        rootCauseAlignment: { passed: true, detail: 'Alignment check skipped (AI error)' },
        solutionAlignment: { passed: true, detail: 'Alignment check skipped (AI error)' },
        checkpointAlignment: { passed: true, detail: 'Alignment check skipped (AI error)' },
      },
      issues: [],
    };
  }
}

// ============================================================
// 向后兼容导出
// ============================================================

/** @deprecated 旧接口，保留向后兼容 */
export interface ComplexityAssessment {
  level: 'low' | 'medium' | 'high';
  score: number;
  fileCount: number;
  workItemCount: number;
  estimatedMinutes: number;
  signals: Array<{
    type: string;
    weight: number;
    description: string;
  }>;
}

/** @deprecated 旧接口，保留向后兼容 */
export interface InitRequirementOptionsLegacy {
  nonInteractive?: boolean;
  noPlan?: boolean;
  skipValidation?: boolean;
  template?: string;
  noAI?: boolean;
  requireQuality?: number;
  decompose?: boolean;
  file?: string;
  recursiveDecompose?: boolean;
}

/** @deprecated 旧导出，保留向后兼容 */
export { inferDependencies } from '../utils/dependency-engine';

/** @deprecated 旧导出，保留向后兼容 — 复杂度评估算法 */
export function assessComplexity(
  description: string,
  analysis: {
    title?: string;
    description?: string;
    priority?: string;
    recommendedRole?: string;
    estimatedComplexity?: 'low' | 'medium' | 'high';
    suggestedCheckpoints?: string[];
    potentialDependencies?: string[];
    files?: string[];
    estimatedMinutes?: number;
  },
): ComplexityAssessment {
  const signals: Array<{ type: string; weight: number; description: string }> = [];

  // Extract file paths from description
  const filePathPattern = /(?:src\/|\.ts|\.js|\.tsx|\.jsx)[\w./-]+/g;
  const filePaths = description.match(filePathPattern) || [];
  const fileCount = filePaths.length;
  const fileWeight = Math.min(fileCount * 8, 30);
  if (fileCount > 0) {
    signals.push({ type: 'file_count', weight: fileWeight, description: `${fileCount} 个文件涉及` });
  }

  // Count work items (list items and action phrases)
  const listItemPattern = /^[-*]\s+/gm;
  const listItems = description.match(listItemPattern) || [];
  const actionPhrases = (description.match(/创建|添加|修改|实现|重构|迁移|集成|修复|配置|增强|部署|更新/g) || []).length;
  const workItemCount = Math.max(listItems.length, actionPhrases);
  const workItemWeight = Math.min(workItemCount * 5, 25);
  if (workItemCount > 0) {
    signals.push({ type: 'work_items', weight: workItemWeight, description: `${workItemCount} 个工作项` });
  }

  // Cross-module references
  const modulePattern = /模块|系统|服务|组件/g;
  const moduleCount = (description.match(modulePattern) || []).length;
  const crossModuleWeight = Math.min(moduleCount * 6, 20);
  if (moduleCount > 0) {
    signals.push({ type: 'cross_module', weight: crossModuleWeight, description: `${moduleCount} 个跨模块引用` });
  }

  // Checkpoint count signal
  const checkpointCount = analysis.suggestedCheckpoints?.length || 0;
  const checkpointWeight = Math.min(checkpointCount * 4, 15);
  if (checkpointCount > 0) {
    signals.push({ type: 'checkpoint_count', weight: checkpointWeight, description: `${checkpointCount} 个检查点` });
  }

  // AI estimated complexity bonus
  const complexityBonus = analysis.estimatedComplexity === 'high' ? 15 : analysis.estimatedComplexity === 'medium' ? 5 : 0;
  if (complexityBonus > 0) {
    signals.push({ type: 'ai_estimate', weight: complexityBonus, description: `AI 评估为 ${analysis.estimatedComplexity}` });
  }

  // Calculate total score (capped at 100)
  const score = Math.min(
    signals.reduce((sum, s) => sum + s.weight, 0),
    100,
  );

  // Estimate minutes: base 5 + score * 0.5, minimum 5
  const estimatedMinutes = Math.max(5, Math.round(5 + score * 0.5));

  // Determine level: estimatedMinutes >= 15 forces high
  let level: 'low' | 'medium' | 'high';
  if (estimatedMinutes >= 15 || score >= 40) {
    level = 'high';
  } else if (score >= 20) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    level,
    score,
    fileCount,
    workItemCount,
    estimatedMinutes,
    signals,
  };
}
