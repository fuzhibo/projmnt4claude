import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getTasksDir, getArchiveDir } from '../utils/path';
import {
  generateNewTaskId,
  readTaskMeta,
  writeTaskMeta,
  getAllTasks,
  taskExists,
  renameTask,
} from '../utils/task';
import {
  parseCheckpointsWithIds,
  syncCheckpointsToMeta,
  updateCheckpointStatus,
  getCheckpointDetail,
  listCheckpoints,
  filterLowQualityCheckpoints,
} from '../utils/checkpoint';
import type {
  TaskMeta,
  TaskPriority,
  TaskStatus,
  TaskType,
  TaskHistoryEntry,
  CheckpointMetadata,
} from '../types/task';
import {
  createDefaultTaskMeta,
  isValidTaskId,
  validateCheckpointVerification,
  normalizeStatus,
  normalizePriority,
  inferTaskType,
} from '../types/task';
import * as crypto from 'crypto';
import { SEPARATOR_WIDTH } from '../utils/format';
import { DependencyGraph, validateNewTaskDeps } from '../utils/dependency-graph';
import { inferDependencies, type InferredDependency } from '../utils/dependency-engine';
import {
  generateStructuredDescription,
  extractStructuredInfo,
  inferCheckpointsFromDescription,
  inferRelatedFiles,
  type DescriptionTemplateType,
  type StructuredDescription,
} from '../utils/description-template';
import { extractFilePaths } from '../utils/quality-gate';
import {
  writeBatchUpdateLog,
  detectOperationSource,
  formatLogList,
  queryBatchUpdateLogs,
  showLogSummary,
  type OperationSource,
} from '../utils/batch-update-logger';
import { t } from '../i18n';

/** History记录最大显示数 */
const MAX_HISTORY_DISPLAY = 20;

/**
 * 过滤None意义的History记录
 * - 过滤掉相同值的StatusChange
 * - 过滤掉None实际内容的系统目（仅有 action 但None field/reason/relatedIssue）
 * - 过滤掉纯信息Tip类目（如"查看Task", "同步Checkpoints"等）
 */
const NOISE_ACTIONS = new Set([
  '查看Task', '同步Checkpoints', 'Task信息', '加载Task',
  '初始化Task', '读取Task', '检查Status', '同步Status',
]);

function filterMeaningfulHistory(history: TaskHistoryEntry[]): TaskHistoryEntry[] {
  return history.filter(entry => {
    // 有FieldChange的: 仅保留值实际改变的
    if (entry.field) {
      return entry.oldValue !== entry.newValue;
    }
    // NoneFieldChange的目: 过滤噪音 action
    if (NOISE_ACTIONS.has(entry.action)) {
      return false;
    }
    // 有 reason or relatedIssue 的保留
    if (entry.reason || entry.relatedIssue || entry.verificationDetails) {
      return true;
    }
    // 其余NoneFieldChange目保留（如"添加完成Description"等有意义的操作）
    return true;
  });
}

/**
 * Checkpoints数据结构
 */
interface CheckpointItem {
  text: string;
  checked: boolean;
}

/**
 * 解析Checkpoints文件
 */
function parseCheckpoints(checkpointPath: string): CheckpointItem[] {
  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');
  const checkpoints: CheckpointItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [')) {
      const isChecked = trimmed.includes('[x]') || trimmed.includes('[X]');
      const text = trimmed.replace(/- \[[xX ]\] /, '').trim();
      checkpoints.push({ text, checked: isChecked });
    }
  }

  return checkpoints;
}

/**
 * 生成Checkpoints确认token
 */
function generateCheckpointToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 检查 checkpoint 内容是否为有效（非模板）内容
 * BUG-002: 校验 checkpoints 是否有意义
 * @param checkpointPathOrContent - File path或直接内容字符串
 * @param isContent - 如果为 true, #一参数是内容字符串而非路径
 */
export function hasValidCheckpoints(
  checkpointPathOrContent: string | null,
  isContent: boolean = false,
  cwd?: string
): { valid: boolean; reason: string } {
  const texts = t(cwd);
  let content: string;

  if (isContent && checkpointPathOrContent !== null) {
    // 直接Use 传入的内容
    content = checkpointPathOrContent;
  } else if (!isContent && checkpointPathOrContent) {
    // 从文件读取
    if (!fs.existsSync(checkpointPathOrContent)) {
      return { valid: false, reason: texts.taskCommand.checkpointFileNotExist };
    }
    content = fs.readFileSync(checkpointPathOrContent, 'utf-8');
  } else {
    // None内容
    return { valid: false, reason: texts.taskCommand.validationError };
  }

  const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

  if (lines.length === 0) {
    return { valid: false, reason: texts.taskCommand.noCheckpointItems };
  }

  // 检测模板内容（None意义的默认Checkpoints）
  // 注意: 这些模式匹配的是去掉 "- [ ] " 前缀后的纯文本
  const templatePatterns = [
    /^Checkpoints\d+$/u,           // "Checkpoints1", "Checkpoints2" 等
    /^Checkpoints\d*[（(].*[)）]$/u, // "Checkpoints1（请替换...）" 等
    /^checkpoint\s*\d+$/i,    // "checkpoint 1", "checkpoint 2" 等
    /^完成Task?$/u,            // "完成Task"
    /^待填写$/u,               // "待填写"
    /^TODO$/i,                 // "TODO"
    /^\.{3,}$/,                // "..."
    /请替换为.*验收标准/u,     // "请替换为具体验收标准"
    /请替换.*具体/u,           // "请替换为具体..."
    /^CP-\d+$/u,              // "CP-001" 等纯ID形式
  ];

  let templateCount = 0;
  for (const line of lines) {
    const checkText = line.replace(/- \[[xX ]\] /, '').trim();
    for (const pattern of templatePatterns) {
      if (pattern.test(checkText)) {
        templateCount++;
        break;
      }
    }
  }

  // 如果超过一半的Checkpoints是模板内容, 则认为Invalid
  if (templateCount > lines.length / 2) {
    return {
      valid: false,
      reason: texts.taskCommand.templateContentDetected
        .replace('{count}', String(templateCount))
        .replace('{total}', String(lines.length))
    };
  }

  return { valid: true, reason: '' };
}

/**
 * 默认的 checkpoint.md 内容模板
 */
const DEFAULT_CHECKPOINT_CONTENT = `# {taskId} Checkpoints

- [ ] Checkpoints1
- [ ] Checkpoints2
`;

/**
 * BUG-002: TaskCreated时显示Checkpoints质量提醒
 * 不阻止TaskCreated, 但提醒用户需要编辑 checkpoint.md
 */
export function displayCheckpointCreationWarning(taskId: string, cwd: string): void {
  const texts = t(cwd);
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(texts.taskCommand.checkpointQualityReminder);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(texts.taskCommand.taskCreatedButTemplate);
  console.log('📋 ' + texts.taskCommand.highQualityCheckpointsEssential);
  console.log('');
  console.log('   1. ' + texts.taskCommand.editCheckpointMd);
  console.log(`      ${texts.taskCommand.filePath.replace('{path}', `.projmnt4claude/tasks/${taskId}/checkpoint.md`)}`);
  console.log('');
  console.log('   2. ' + texts.taskCommand.useAnalyzeCommand);
  console.log(`      projmnt4claude analyze --generate-checkpoints ${taskId}`);
  console.log('');
  console.log('   3. ' + texts.taskCommand.useTemplateFeature);
  console.log(`      projmnt4claude task checkpoint template ${taskId} --apply`);
  console.log('');
  console.log('💡 ' + texts.taskCommand.tipStrictValidation);
  console.log('━'.repeat(SEPARATOR_WIDTH));
}

/**
 * BUG-013-2: VerificationTaskCheckpoints是否具有所需的verification commands
 * 返回missingCommand的Checkpoints警告列表
 */
function validateTaskCheckpointCommands(taskId: string, cwd: string): string[] {
  const task = readTaskMeta(taskId, cwd);
  if (!task?.checkpoints) return [];

  const warnings: string[] = [];
  for (const cp of task.checkpoints) {
    const result = validateCheckpointVerification(cp);
    if (!result.valid && result.warning) {
      warnings.push(result.warning);
    }
  }
  return warnings;
}

/**
 * 显示Checkpointsverification commands缺失的警告
 * (重uses validateCheckpointCommands from init-requirement.ts)
 */
export function displayCheckpointVerificationWarnings(warnings: string[], cwd?: string): void {
  if (warnings.length === 0) return;

  const texts = t(cwd);
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(texts.taskCommand.missingCheckpointVerificationCommands);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(texts.taskCommand.checkpointsMissingVerification.replace('{count}', String(warnings.length)));
  for (const w of warnings) {
    console.log(`   - ${w}`);
  }
  console.log('');
  console.log('💡 ' + texts.taskCommand.qaCannotAutoVerify);
  console.log('   Please add verification commands in checkpoint.md, or use init-requirement to regenerate.');
  console.log('━'.repeat(SEPARATOR_WIDTH));
}

/**
 * BUG-012-0: 从Description/Title中提取File path引用
 * 匹配 src/xxx, path/to/file.ext 等常见模式
 */
function extractFileReferencesFromText(text: string): string[] {
  if (!text) return [];
  const files: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    // 标准源码路径
    /(?:src|lib|test|tests|docs|bin|scripts|config)\/[\w/.-]+\.[a-z]+/g,
    // 相对路径
    /\.{1,2}\/[\w/.-]+\.[a-z]+/g,
    // 常见扩展名的文件名（带目录深度 ≥ 1  /）
    /[\w-]+\/[\w/.-]+\.(ts|tsx|js|jsx|py|go|java|rs|json|yaml|yml|md)/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (!seen.has(match)) {
          seen.add(match);
          files.push(match);
        }
      }
    }
  }

  return files;
}

/**
 * BUG-012-0: 校验referenced files是否存在 in in project
 * 返回does not exist的文件列表
 */
function findMissingFiles(filePaths: string[], cwd: string): string[] {
  const missing: string[] = [];
  for (const fp of filePaths) {
    // 检查相对 in 项目根目录的路径
    const absolutePath = path.resolve(cwd, fp);
    if (!fs.existsSync(absolutePath)) {
      missing.push(fp);
    }
  }
  return missing;
}

/**
 * BUG-012-0: 校验TaskDescription中的文件引用
 * 交互模式: 显示警告并询问是否继续
 * -y 模式: 记录警告到 meta.json 但不阻止Created
 */
async function validateFileReferences(
  description: string | undefined,
  title: string | undefined,
  nonInteractive: boolean,
  cwd: string
): Promise<{ proceed: boolean; missingFiles: string[] }> {
  const source = `${title || ''}\n${description || ''}`;
  const fileRefs = extractFileReferencesFromText(source);

  if (fileRefs.length === 0) {
    return { proceed: true, missingFiles: [] };
  }

  const missingFiles = findMissingFiles(fileRefs, cwd);

  if (missingFiles.length === 0) {
    return { proceed: true, missingFiles: [] };
  }

  // 有does not exist的文件引用
  console.log('');
  console.log(`⚠️  Detected ${missingFiles.length} referenced filesdoes not exist in project:`);
  for (const fp of missingFiles) {
    console.log(`   - ${fp}`);
  }

  if (nonInteractive) {
    console.log('   (Non-interactive mode, warnings logged, continuing task creation)');
    return { proceed: true, missingFiles };
  }

  // 交互模式: 询问是否继续
  const response = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: '以上文件does not exist, 确认继续CreatedTask?',
    initial: false,
  });

  return { proceed: response.proceed !== false, missingFiles };
}

/**
 * CreatedTask选项接口
 * 支持基础选项和 AI 增强选项
 */
export interface CreateTaskOptions {
  // 基础选项
  title?: string;
  description?: string;
  priority?: string;
  type?: string;
  nonInteractive?: boolean;
  skipValidation?: boolean;
  id?: string;  // 用户指定 tasks ID

  // AI 增强选项（原 init-requirement 特有）
  /** 启用 AI 增强分析 */
  aiEnhancement?: boolean;
  /** Description模板Type: simple | detailed */
  template?: DescriptionTemplateType;
  /** 建议的Checkpoint List（AI or外部提供） */
  suggestedCheckpoints?: string[];
  /** 潜在Dependency Tasks ID 列表 */
  potentialDependencies?: string[];
  /** 推荐的角色 */
  recommendedRole?: string;
  /** 相关文件列表 */
  relatedFiles?: string[];

  // Subtasks选项
  /** Parent task ID（CreatedSubtasks时Use ） */
  parentId?: string;

  // 分支选项
  /** Related分支 */
  branch?: string;
}

/**
 * Created新Task
 * 支持交互模式和非交互模式
 */
export async function createTask(
  options: CreateTaskOptions = {},
  cwd: string = process.cwd()
): Promise<TaskMeta> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // 非交互模式: Use Command行参数
  if (options.nonInteractive && options.title) {
    // 推断TaskType（如果启用 AI 增强或需要自动推断）
    const taskType = options.type
      ? options.type as TaskType
      : (options.aiEnhancement ? inferTaskType(options.title) : 'feature' as TaskType);
    const taskPriority = normalizePriority(options.priority || 'P2');

    // 确定Task ID: 用户指定ID优先, 否则自动生成
    let taskId: string;
    if (options.id) {
      // Verification用户指定的ID格式
      if (!isValidTaskId(options.id)) {
        console.error(`Error: Invalid task ID format '${options.id}'`);
        process.exit(1);
      }
      // 检查ID是否already exists
      if (taskExists(options.id, cwd)) {
        console.error(`Error: Task ID '${options.id}' already exists`);
        process.exit(1);
      }
      taskId = options.id;
    } else {
      taskId = generateNewTaskId(cwd, taskType, taskPriority, options.title);
    }

    // BUG-012-0: 校验Description中referenced files是否存在
    const fileValidation = await validateFileReferences(
      options.description, options.title, true, cwd
    );
    if (!fileValidation.proceed) {
      console.log('Task creation cancelled');
      process.exit(0);
    }

    // CreatedTask元数据
    const task = createDefaultTaskMeta(taskId, options.title, taskType, options.parentId, 'cli');
    task.priority = taskPriority;

    // AI 增强: 结构化Description和Checkpoints推断
    let finalCheckpoints: string[] = [];
    let finalRelatedFiles: string[] = options.relatedFiles || [];

    if (options.aiEnhancement && options.description) {
      // 提取结构化信息
      const structuredInfo = extractStructuredInfo(options.description);
      // 推断Checkpoints
      const inferredCheckpoints = inferCheckpointsFromDescription(options.description, taskType);
      // 推断相关文件
      const inferredFiles = inferRelatedFiles(options.description, taskType);

      // 合并Checkpoints: Recommended checkpoints + 推断的Checkpoints + 结构化提取的Checkpoints
      finalCheckpoints = [...new Set([
        ...(options.suggestedCheckpoints || []),
        ...inferredCheckpoints,
        ...structuredInfo.checkpoints,
      ])];
      finalRelatedFiles = [...new Set([...finalRelatedFiles, ...inferredFiles, ...structuredInfo.relatedFiles])];

      // 构建结构化Description数据
      const template = options.template || 'detailed';
      const structuredData: StructuredDescription = {
        problem: structuredInfo.problem || options.description,
        rootCause: structuredInfo.rootCause,
        solution: structuredInfo.solution,
        checkpoints: finalCheckpoints,
        relatedFiles: finalRelatedFiles,
        notes: structuredInfo.notes,
      };

      // 根据模板Type生成Description
      task.description = generateStructuredDescription(structuredData, template);
    } else if (options.description) {
      // 非 AI 增强模式: 直接Use Description
      task.description = options.description;

      // 推断Checkpoints（如果未提供）
      if (!options.suggestedCheckpoints || options.suggestedCheckpoints.length === 0) {
        finalCheckpoints = inferCheckpointsFromDescription(options.description, taskType);
      } else {
        finalCheckpoints = options.suggestedCheckpoints;
      }
    }

    // 设置推荐角色
    if (options.recommendedRole) {
      task.recommendedRole = options.recommendedRole;
    }

    // 设置Related分支
    if (options.branch) {
      task.branch = options.branch;
    }

    // 添加CreatedHistory记录
    task.history = task.history || [];
    task.history.push({
      timestamp: new Date().toISOString(),
      action: 'TaskCreated',
      field: 'status',
      oldValue: '',
      newValue: 'open',
    });

    // 推断Dependencies关系（如果启用 AI 增强或有潜在Dependencies）
    if ((options.aiEnhancement || options.potentialDependencies) && options.description) {
      const existingTasks = getAllTasks(cwd);
      const inferredDeps = inferDependencies(
        options.description,
        existingTasks,
        { keywordHints: options.potentialDependencies },
      );
      if (inferredDeps.length > 0) {
        task.dependencies = inferredDeps.map(d => d.depTaskId);
      }
    }

    // 检查文件警告（引用但does not exist的文件）
    const referencedFiles = finalRelatedFiles.length > 0
      ? finalRelatedFiles
      : extractFilePaths(task.description || '', { includeBareFilenames: false });
    const fileWarnings: string[] = [];
    for (const file of referencedFiles) {
      if (!fs.existsSync(path.join(cwd, file))) {
        fileWarnings.push(file);
      }
    }
    if (fileWarnings.length > 0) {
      task.fileWarnings = fileWarnings;
    }

    // BUG-012-0: 记录文件Verification的缺失文件到 fileWarnings
    if (fileValidation.missingFiles.length > 0) {
      task.fileWarnings = [...new Set([...(task.fileWarnings || []), ...fileValidation.missingFiles])];
    }

    // 过滤low-qualityCheckpoints
    if (finalCheckpoints.length > 0) {
      const filterResult = filterLowQualityCheckpoints(finalCheckpoints);
      if (filterResult.removed.length > 0) {
        console.log(`   🔍 Filtered ${filterResult.removed.length} low-qualityCheckpoints`);
      }
      finalCheckpoints = filterResult.kept;
    }

    // 写入Task
    writeTaskMeta(task, cwd);

    // Created checkpoint.md
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');

    // 生成Checkpoints内容
    let checkpointContent: string;
    if (finalCheckpoints.length > 0) {
      checkpointContent = `# ${taskId} Checkpoints\n\n${finalCheckpoints.map((cp: string) => `- [ ] ${cp}`).join('\n')}\n`;
    } else {
      // BUG-002: 默认模板内容作为初始占位符
      checkpointContent = `# ${taskId} Checkpoints\n\n- [ ] Checkpoints1（请替换为具体验收标准）\n- [ ] Checkpoints2（请替换为具体验收标准）\n`;
    }
    fs.writeFileSync(checkpointPath, checkpointContent, 'utf-8');

    console.log(`\n✅ Task created successfully!`);
    console.log(`   ID: ${taskId}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Priority: ${formatPriority(task.priority)}`);
    if (task.dependencies && task.dependencies.length > 0) {
      console.log(`   Dependencies: ${task.dependencies.join(', ')}`);
    }

    // BUG-002: 校验Checkpoints质量并显示警告（除非Use  --skip-validation）
    if (!options.skipValidation) {
      const validation = hasValidCheckpoints(checkpointPath, false);
      if (!validation.valid) {
        displayCheckpointCreationWarning(taskId, cwd);
      }
    }

    // BUG-013-2: 同步Checkpoints元数据并Verificationverification commands完整性
    syncCheckpointsToMeta(taskId, cwd);
    const cpWarnings = validateTaskCheckpointCommands(taskId, cwd);
    displayCheckpointVerificationWarnings(cpWarnings);

    // CP-16: Dependencies关系质量门禁 - Verification新Task的Dependencies完整性 (GATE-DEP-001/002/003)
    const allExistingTasks = getAllTasks(cwd);
    const depGraph = DependencyGraph.fromTasks(allExistingTasks);
    const depValidation = validateNewTaskDeps(taskId, task.dependencies || [], depGraph, allExistingTasks);
    if (depValidation.warnings.length > 0) {
      console.log('📋 Dependency Gate:');
      for (const w of depValidation.warnings) {
        console.log(`   ⚠️  ${w}`);
      }
    }
    if (depValidation.errors.length > 0) {
      console.log('📋 Dependency Error:');
      for (const e of depValidation.errors) {
        console.log(`   ❌ ${e}`);
      }
    }

    return task;
  }

  // 交互式收集Task信息
  const response = await prompts([
    {
      type: 'text',
      name: 'title',
      message: 'TaskTitle',
      validate: (value) => (value.trim().length > 0 ? true : 'Title不能为空'),
    },
    {
      type: 'text',
      name: 'description',
      message: 'TaskDescription (可选, 直接回车skipped)',
    },
    {
      type: 'select',
      name: 'priority',
      message: 'priority',
      choices: [
        { title: 'P3 低', value: 'P3' },
        { title: 'P2 中 (默认)', value: 'P2' },
        { title: 'P1 高', value: 'P1' },
        { title: 'P0 紧急', value: 'P0' },
      ],
      initial: 1,
    },
  ]);

  if (!response.title) {
    console.log('Task creation cancelled');
    process.exit(0);
  }

  // 确定Task ID: 用户指定ID优先, 否则自动生成
  let taskId: string;
  if (options.id) {
    // Verification用户指定的ID格式
    if (!isValidTaskId(options.id)) {
      console.error(`Error: Invalid task ID format '${options.id}'`);
      process.exit(1);
    }
    // 检查ID是否already exists
    if (taskExists(options.id, cwd)) {
      console.error(`Error: Task ID '${options.id}' already exists`);
      process.exit(1);
    }
    taskId = options.id;
  } else {
    taskId = generateNewTaskId(cwd, 'feature', response.priority, response.title);
  }

  // BUG-012-0: 交互模式 - 校验Description中referenced files是否存在
  const fileValidation = await validateFileReferences(
    response.description, response.title, false, cwd
  );
  if (!fileValidation.proceed) {
    console.log('Task creation cancelled');
    process.exit(0);
  }

  // BUG-002: 交互模式 - 默认Checkpoints内容作为初始占位符, Created后会进行质量校验
  const defaultCheckpointContent = `# ${taskId} Checkpoints\n\n- [ ] Checkpoints1（请替换为具体验收标准）\n- [ ] Checkpoints2（请替换为具体验收标准）\n`;

  // CreatedTask元数据
  const task = createDefaultTaskMeta(taskId, response.title, undefined, undefined, 'cli');
  if (response.description) {
    task.description = response.description;
  }
  task.priority = response.priority as TaskPriority;

  // BUG-012-0: 记录文件警告到 meta.json
  if (fileValidation.missingFiles.length > 0) {
    task.fileWarnings = fileValidation.missingFiles;
  }

  // 写入Task
  writeTaskMeta(task, cwd);

  // Created checkpoint.md
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  fs.writeFileSync(checkpointPath, defaultCheckpointContent, 'utf-8');

  console.log(`\n✅ Task created successfully!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   Title: ${task.title}`);
  console.log(`   Priority: ${formatPriority(task.priority)}`);

  // BUG-002: 交互模式 - 校验Checkpoints质量并显示警告
  if (!options.skipValidation) {
    const validation = hasValidCheckpoints(checkpointPath, false);
    if (!validation.valid) {
      displayCheckpointCreationWarning(taskId, cwd);
    }
  }

  // BUG-013-2: 同步Checkpoints元数据并Verificationverification commands完整性
  syncCheckpointsToMeta(taskId, cwd);
  const cpWarnings = validateTaskCheckpointCommands(taskId, cwd);
  displayCheckpointVerificationWarnings(cpWarnings);

  return task;
}

/**
 * 列出所有Task
 * 支持多种输出格式和过滤选项
 */
export function listTasks(
  options: {
    status?: string;
    priority?: string;
    role?: string;
    needsDiscussion?: boolean;
    fields?: string;
    format?: 'json';
    missingVerification?: boolean;
    group?: 'status' | 'priority' | 'type' | 'role';
  } = {},
  cwd: string = process.cwd()
): void {
  const texts = t(cwd);
  if (!isInitialized(cwd)) {
    console.error(texts.task.projectNotInitialized);
    process.exit(1);
  }

  let tasks = getAllTasks(cwd);

  // 应用过滤
  if (options.status) {
    tasks = tasks.filter(t => t.status === options.status);
  }
  if (options.priority) {
    tasks = tasks.filter(t => t.priority === options.priority);
  }
  if (options.role) {
    tasks = tasks.filter(t => t.recommendedRole === options.role);
  }
  if (options.needsDiscussion) {
    tasks = tasks.filter(t => t.needsDiscussion === true);
  }
  // 新增: 筛选missingVerification tasks
  if (options.missingVerification) {
    tasks = tasks.filter(t =>
      (t.status === 'resolved' || t.status === 'closed') && !t.checkpointConfirmationToken
    );
  }

  if (tasks.length === 0) {
    if (options.format === 'json') {
      console.log('[]');
    } else {
      console.log('No tasks');
    }
    return;
  }

  // 分离Parent task和Subtasks（提前计算, 供分组和普通列表Use ）
  const parentTasks = tasks.filter(t => !t.parentId);
  const subtaskMap = new Map<string, TaskMeta[]>();
  for (const task of tasks) {
    if (task.parentId) {
      if (!subtaskMap.has(task.parentId)) {
        subtaskMap.set(task.parentId, []);
      }
      subtaskMap.get(task.parentId)!.push(task);
    }
  }

  // 分组显示功能
  if (options.group && options.format !== 'json') {
    displayTasksGrouped(tasks, options.group, subtaskMap);
    return;
  }

  // JSON 格式输出
  if (options.format === 'json') {
    const output = tasks.map(t => {
      if (options.fields) {
        const fields = options.fields.split(',').map(f => f.trim());
        const picked: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in t) {
            picked[f] = t[f as keyof TaskMeta];
          }
        }
        return picked;
      }
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        description: t.description,
        dependencies: t.dependencies,
        recommendedRole: t.recommendedRole,
        needsDiscussion: t.needsDiscussion,
        discussionTopics: t.discussionTopics,
        requirementHistoryCount: t.requirementHistory?.length || 0,
        reopenCount: t.reopenCount || 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 表头
  console.log('');
  console.log('ID          | Title                         | Priority   | Status');
  console.log('------------|------------------------------|----------|------------');

  // Task列表（层级显示）
  for (const task of parentTasks) {
    const id = task.id.padEnd(11);
    const title = task.title.substring(0, 28).padEnd(28);
    const priority = formatPriority(task.priority, cwd).padEnd(8);
    const status = formatStatus(task.status, cwd);
    const discussionIcon = task.needsDiscussion ? ' 💬' : '';
    const reqChangeIcon = (task.requirementHistory && task.requirementHistory.length > 0) ? ` 📝${task.requirementHistory.length}` : '';
    const subtaskCount = (task.subtaskIds?.length || subtaskMap.get(task.id)?.length || 0);
    const subtaskIcon = subtaskCount > 0 ? ` [${subtaskCount}${texts.task.subtasksLabel}]` : '';
    console.log(`${id} | ${title} | ${priority} | ${status}${discussionIcon}${reqChangeIcon}${subtaskIcon}`);

    // 显示Subtasks
    const subtasks = subtaskMap.get(task.id) || [];
    for (const subtask of subtasks) {
      const subId = `  └─ ${subtask.id}`.substring(0, 11).padEnd(11);
      const subTitle = subtask.title.substring(0, 26).padEnd(26);
      const subPriority = formatPriority(subtask.priority, cwd).padEnd(8);
      const subStatus = formatStatus(subtask.status, cwd);
      console.log(`${subId} | ${subTitle} | ${subPriority} | ${subStatus}`);
    }
  }

  console.log('');
  const totalSubtasks = tasks.filter(t => t.parentId).length;
  const totalTasksText = texts.task.totalTasks.replace('{count}', String(parentTasks.length));
  const totalSubtasksText = totalSubtasks > 0 ? `, ${texts.task.totalSubtasks.replace('{count}', String(totalSubtasks))}` : '';
  console.log(`${totalTasksText}${totalSubtasksText}`);
}

/**
 * 分组显示Task
 * 支持 status, priority, type, role 分组
 */
function displayTasksGrouped(
  tasks: TaskMeta[],
  groupBy: 'status' | 'priority' | 'type' | 'role',
  subtaskMap: Map<string, TaskMeta[]>
): void {
  // 过滤出Parent task用 in 分组
  const parentTasks = tasks.filter(t => !t.parentId);

  // By  groupBy Field分组
  const groups = new Map<string, TaskMeta[]>();

  for (const task of parentTasks) {
    let groupKey: string;
    switch (groupBy) {
      case 'status':
        groupKey = task.status || 'open';
        break;
      case 'priority':
        groupKey = task.priority || 'P2';
        break;
      case 'type':
        groupKey = task.type || 'feature';
        break;
      case 'role':
        groupKey = task.recommendedRole || '未分配';
        break;
      default:
        groupKey = '其他';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(task);
  }

  // 定义分组排序顺序
  const statusOrder = ['open', 'in_progress', 'wait_evaluation', 'resolved', 'closed', 'abandoned', 'failed'];
  const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

  // 获取排序后的分组键
  let sortedKeys: string[];
  if (groupBy === 'status') {
    sortedKeys = [...groups.keys()].sort((a, b) => {
      const idxA = statusOrder.indexOf(a);
      const idxB = statusOrder.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
  } else if (groupBy === 'priority') {
    sortedKeys = [...groups.keys()].sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
  } else {
    sortedKeys = [...groups.keys()].sort();
  }

  // 获取分组Title
  const getGroupHeader = (key: string): string => {
    switch (groupBy) {
      case 'status':
        return formatStatus(key);
      case 'priority':
        return formatPriority(key);
      case 'type':
        return `📁 Type: ${key}`;
      case 'role':
        return `👤 角色: ${key}`;
      default:
        return key;
    }
  };

  // 显示分组Task
  console.log('');

  for (const groupKey of sortedKeys) {
    const groupTasks = groups.get(groupKey)!;

    // 分组Title
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`${getGroupHeader(groupKey)} (${groupTasks.length})`);
    console.log('━'.repeat(SEPARATOR_WIDTH));

    // 表头
    console.log('ID          | Title                         | Priority   | Status');
    console.log('------------|------------------------------|----------|------------');

    // 分组内Task
    for (const task of groupTasks) {
      const id = task.id.padEnd(11);
      const title = task.title.substring(0, 28).padEnd(28);
      const priority = formatPriority(task.priority).padEnd(8);
      const status = formatStatus(task.status);
      const discussionIcon = task.needsDiscussion ? ' 💬' : '';
      const subtaskCount = (task.subtaskIds?.length || subtaskMap.get(task.id)?.length || 0);
      const subtaskIcon = subtaskCount > 0 ? ` [${subtaskCount}Subtasks]` : '';
      console.log(`${id} | ${title} | ${priority} | ${status}${discussionIcon}${subtaskIcon}`);

      // 显示Subtasks
      const subtasks = subtaskMap.get(task.id) || [];
      for (const subtask of subtasks) {
        const subId = `  └─ ${subtask.id}`.substring(0, 11).padEnd(11);
        const subTitle = subtask.title.substring(0, 26).padEnd(26);
        const subPriority = formatPriority(subtask.priority).padEnd(8);
        const subStatus = formatStatus(subtask.status);
        console.log(`${subId} | ${subTitle} | ${subPriority} | ${subStatus}`);
      }
    }

    console.log('');
  }

  // 统计信息
  const totalSubtasks = tasks.filter(t => t.parentId).length;
  console.log(`Total ${parentTasks.length} tasks${totalSubtasks > 0 ? `, ${totalSubtasks} subtasks` : ''}`);
  console.log(`Group: ${groupBy === 'status' ? 'status' : groupBy === 'priority' ? 'priority' : groupBy === 'type' ? 'type' : 'role'}`);
}

/**
 * 格式化时间为本地可读格式
 */
function formatLocalTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化相对时间
 */
function formatRelativeTime(isoString: string, cwd?: string): string {
  const texts = t(cwd);
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return texts.task.timeJustNow;
  if (diffMins < 60) return texts.task.timeMinutesAgo.replace('{minutes}', String(diffMins));
  if (diffHours < 24) return texts.task.timeHoursAgo.replace('{hours}', String(diffHours));
  if (diffDays < 7) return texts.task.timeDaysAgo.replace('{days}', String(diffDays));

  return formatLocalTime(isoString);
}

/**
 * 显示TaskDetails
 * 支持多种输出格式: verbose, history, json, compact, panel
 */
export function showTask(
  taskId: string,
  options: {
    verbose?: boolean;
    history?: boolean;
    json?: boolean;
    compact?: boolean;
    checkpoints?: boolean;
    format?: 'panel' | 'classic';
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  if (!isValidTaskId(taskId)) {
    console.error(`Error: Invalid task ID format '${taskId}'`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // JSON 格式输出
  if (options.json) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  // 仅显示History
  if (options.history) {
    showTaskHistory(taskId, cwd);
    return;
  }

  // 精简输出
  if (options.compact) {
    showTaskCompact(task, cwd);
    return;
  }

  // 默认Use 新面板格式（除非指定 --format classic or --verbose）
  if (options.format !== 'classic' && !options.verbose) {
    showTaskPanel(task, options, cwd);
    return;
  }

  // 经典格式（verbose 模式或指定 classic）
  showTaskClassic(task, options, cwd);
}

/**
 * 精简输出格式
 */
function showTaskCompact(task: TaskMeta, cwd?: string): void {
  const texts = t(cwd);
  const statusIcon = getStatusIcon(task.status);
  const typeMap: Record<string, string> = {
    bug: texts.task.typeBug,
    feature: texts.task.typeFeature,
    research: texts.task.typeResearch,
    docs: texts.task.typeDocs,
    refactor: texts.task.typeRefactor,
    test: texts.task.typeTest,
  };
  const typeText = typeMap[task.type] || task.type;
  console.log(`${statusIcon} ${task.id}: ${task.title}`);
  console.log(`   Status: ${formatStatus(task.status, cwd)} | Priority: ${formatPriority(task.priority, cwd)} | Type: ${typeText}`);
  if (task.description) {
    console.log(`   Description: ${task.description.substring(0, 120)}${task.description.length > 120 ? '...' : ''}`);
  }
  if (task.dependencies.length > 0) {
    console.log(`   Dependencies: ${task.dependencies.join(', ')}`);
  }

  // CheckpointsProgress（精简模式）
  if (cwd) {
    const taskDir = path.join(getTasksDir(cwd), task.id);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');
    if (fs.existsSync(checkpointPath)) {
      const content = fs.readFileSync(checkpointPath, 'utf-8');
      const cpLines = content.split('\n').filter(l => l.trim().startsWith('- ['));
      if (cpLines.length > 0) {
        const done = cpLines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
        const total = cpLines.length;
        const pct = Math.round((done / total) * 100);
        const barFilled = Math.round((done / total) * 10);
        const bar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);
        console.log(`   Checkpoints: [${bar}] ${done}/${total} (${pct}%)`);
      }
    }
  }

  // 待讨论Tip
  if (task.needsDiscussion) {
    const discussionCount = task.discussionTopics?.length || 0;
    console.log(`   💬 ${texts.task.discussionLabel}${discussionCount > 0 ? ` (${discussionCount})` : ''}`);
  }

  // Requirement Change History计数
  if (task.requirementHistory && task.requirementHistory.length > 0) {
    console.log(`   📝 ${texts.task.requirementChanges}: ${task.requirementHistory.length}`);
  }

  console.log(`   ${texts.task.createdAt}: ${formatRelativeTime(task.createdAt, cwd)} · ${texts.task.updatedAt}: ${formatRelativeTime(task.updatedAt, cwd)}`);
}

/**
 * 获取Status图标
 */
function getStatusIcon(status: TaskStatus): string {
  const icons: Record<string, string> = {
    open: '⬜',
    in_progress: '🔄',
    wait_review: '👀',
    wait_qa: '🧪',
    wait_evaluation: '⏳',
    resolved: '✅',
    closed: '⚫',
    abandoned: '❌',
    failed: '⛔',
  };
  return icons[status] || '❓';
}

/**
 * 计算字符串的显示宽度（中文字符, emoji 占2宽度）
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    // 中文字符范围（包括中文标点）
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      width += 2;
    } else if (code > 0xFFFF) {
      // 补充平面字符（emoji 等）在终端中通常占 2 宽度
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * By 显示宽度截断字符串
 */
function truncateByDisplayWidth(str: string, maxDisplayWidth: number): string {
  let result = '';
  let currentWidth = 0;
  for (const char of str) {
    const charWidth = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1;
    if (currentWidth + charWidth > maxDisplayWidth) {
      break;
    }
    result += char;
    currentWidth += charWidth;
  }
  return result;
}

/**
 * By 显示宽度填充空格（用 in 对齐）
 */
function padByDisplayWidth(str: string, targetWidth: number): string {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth >= targetWidth) {
    return str;
  }
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * 新面板格式 - 紧凑美观
 */
function showTaskPanel(
  task: TaskMeta,
  options: { checkpoints?: boolean; verbose?: boolean },
  cwd: string
): void {
  const texts = t(cwd);
  // 动态宽度: 基 in 终端列数, 范围 60-100
  const termWidth = process.stdout.columns || 80;
  const width = Math.min(Math.max(termWidth, 60), 100);
  const hLine = '─'.repeat(width - 2);
  const statusIcon = getStatusIcon(task.status);

  console.log('');
  console.log(`╭${hLine}╮`);

  // Title行
  const titleLine = ` ${statusIcon} ${task.id}`;
  console.log(`│${padByDisplayWidth(titleLine, width - 2)}│`);

  // Title（考虑中文字符宽度截断）
  const maxTitleDisplayWidth = width - 6;
  const displayTitle = truncateByDisplayWidth(task.title, maxTitleDisplayWidth - 3);
  const truncatedTitle = getDisplayWidth(task.title) > maxTitleDisplayWidth ? displayTitle + '...' : task.title;
  console.log(`│   ${padByDisplayWidth(truncatedTitle, width - 5)}│`);

  console.log(`├${hLine}┤`);

  // Status行: Use 简洁格式, 一行显示Status, Priority, Type
  const statusMap: Record<string, string> = {
    open: texts.task.statusOpen,
    in_progress: texts.task.statusInProgress,
    resolved: texts.task.statusResolved,
    closed: texts.task.statusClosed,
    abandoned: texts.task.statusAbandoned,
    wait_review: texts.task.statusWaitReview,
    wait_qa: texts.task.statusWaitQa,
    wait_evaluation: texts.task.statusWaitEvaluation,
  };
  const priorityMap: Record<string, string> = {
    P0: texts.task.priorityP0,
    P1: texts.task.priorityP1,
    P2: texts.task.priorityP2,
    P3: texts.task.priorityP3,
    Q1: 'Q1',
    Q2: 'Q2',
    Q3: 'Q3',
    Q4: 'Q4',
  };
  const statusText = statusMap[task.status] || task.status;
  const priorityText = priorityMap[task.priority] || task.priority;
  const typeText = task.type || texts.task.typeNotSpecified;
  const statusLine = `${texts.task.statusHeader}: ${statusText}  ·  ${texts.task.priorityHeader}: ${priorityText}  ·  ${texts.task.typeHeader}: ${typeText}`;
  console.log(`│ ${padByDisplayWidth(statusLine, width - 3)}│`);

  // Description（如果有）
  if (task.description) {
    console.log(`├${hLine}┤`);
    const descLines = wrapText(task.description, width - 6);
    for (const line of descLines.slice(0, 3)) {
      console.log(`│ ${padByDisplayWidth(line, width - 3)}│`);
    }
    if (descLines.length > 3) {
      const moreDesc = `... ${descLines.length - 3} more lines`;
      console.log(`│ ${padByDisplayWidth(moreDesc, width - 3)}│`);
    }
  }

  // CheckpointsProgress
  const taskDir = path.join(getTasksDir(cwd), task.id);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (fs.existsSync(checkpointPath)) {
    // --checkpoints 模式Use 结构化元数据（支持四态图标）
    if (options.checkpoints) {
      const checkpointsMeta = listCheckpoints(task.id, cwd);

      if (checkpointsMeta.length > 0) {
        console.log(`├${hLine}┤`);
        const sectionTitle = '📋 Checkpoints';
        console.log(`│ ${padByDisplayWidth(sectionTitle, width - 3)}│`);

        const completedCount = checkpointsMeta.filter(cp => cp.status === 'completed').length;
        const totalCount = checkpointsMeta.length;
        const percentage = Math.round((completedCount / totalCount) * 100);
        const barWidth = 20;
        const bar = '█'.repeat(Math.round((completedCount / totalCount) * barWidth)) + '░'.repeat(barWidth - Math.round((completedCount / totalCount) * barWidth));
        const progressLine = `   [${bar}] ${completedCount}/${totalCount} (${percentage}%)`;
        console.log(`│ ${padByDisplayWidth(progressLine, width - 3)}│`);

        for (let i = 0; i < checkpointsMeta.length; i++) {
          const cp = checkpointsMeta[i]!;
          const cpIcon = cp.status === 'completed' ? '✅' :
                         cp.status === 'failed' ? '❌' :
                         cp.status === 'skipped' ? '⏭️' : '⬜';
          const maxTextLen = width - 12;
          const displayText = getDisplayWidth(cp.description) > maxTextLen ? truncateByDisplayWidth(cp.description, maxTextLen) + '..' : cp.description;
          console.log(`│  ${padByDisplayWidth(`  ${i + 1}. ${cpIcon} ${displayText}`, width - 4)}│`);
        }
      }
    } else {
      // 默认模式: 读取 checkpoint.md 原始内容（两态图标）
      const content = fs.readFileSync(checkpointPath, 'utf-8');
      const checkpointLines = content.split('\n').filter(l => l.trim().startsWith('- ['));

      if (checkpointLines.length > 0) {
        console.log(`├${hLine}┤`);
        const sectionTitle = '📋 Checkpoints';
        console.log(`│ ${padByDisplayWidth(sectionTitle, width - 3)}│`);

        const completedCount = checkpointLines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
        const totalCount = checkpointLines.length;
        const percentage = Math.round((completedCount / totalCount) * 100);
        const barWidth = 20;
        const bar = '█'.repeat(Math.round((completedCount / totalCount) * barWidth)) + '░'.repeat(barWidth - Math.round((completedCount / totalCount) * barWidth));
        const progressLine = `   [${bar}] ${completedCount}/${totalCount} (${percentage}%)`;
        console.log(`│ ${padByDisplayWidth(progressLine, width - 3)}│`);
      }
    }
  }

  // 附加信息（Dependencies, 角色, 分支, 讨论等）
  const hasExtras = task.dependencies.length > 0 ||
                    task.recommendedRole ||
                    task.branch ||
                    (task.subtaskIds && task.subtaskIds.length > 0) ||
                    task.parentId ||
                    task.needsDiscussion ||
                    (task.requirementHistory && task.requirementHistory.length > 0);

  if (hasExtras) {
    console.log(`├${hLine}┤`);

    if (task.dependencies.length > 0) {
      const deps = task.dependencies.join(', ');
      const maxLen = width - 10;
      const depsText = getDisplayWidth(deps) > maxLen ? truncateByDisplayWidth(deps, maxLen - 2) + '..' : deps;
      const depsLine = `🔗 Dependencies: ${depsText}`;
      console.log(`│ ${padByDisplayWidth(depsLine, width - 3)}│`);
    }

    if (task.recommendedRole) {
      const roleLine = `👤 ${texts.task.roleLabel}: ${task.recommendedRole}`;
      console.log(`│ ${padByDisplayWidth(roleLine, width - 3)}│`);
    }

    if (task.branch) {
      const branchLine = `🌿 ${texts.task.branchLabel}: ${task.branch}`;
      console.log(`│ ${padByDisplayWidth(branchLine, width - 3)}│`);
    }

    if (task.subtaskIds && task.subtaskIds.length > 0) {
      // 统计SubtasksStatus分布
      let doneCount = 0;
      let activeCount = 0;
      for (const subId of task.subtaskIds) {
        const sub = readTaskMeta(subId, cwd);
        if (sub && (sub.status === 'resolved' || sub.status === 'closed')) doneCount++;
        else if (sub && (sub.status === 'in_progress' || sub.status === 'wait_review' || sub.status === 'wait_qa' || sub.status === 'wait_evaluation')) activeCount++;
      }
      const pendingCount = task.subtaskIds.length - doneCount - activeCount;
      const parts: string[] = [];
      if (doneCount > 0) parts.push(`✅ ${doneCount}`);
      if (activeCount > 0) parts.push(`🔄 ${activeCount}`);
      if (pendingCount > 0) parts.push(`⬜ ${pendingCount}`);
      const subtaskLine = parts.length > 0
        ? `📎 ${texts.task.subtasksLabel}: ${task.subtaskIds.length}  (${parts.join(' ')})`
        : `📎 ${texts.task.subtasksLabel}: ${task.subtaskIds.length} `;
      console.log(`│ ${padByDisplayWidth(subtaskLine, width - 3)}│`);
    }

    if (task.parentId) {
      const parentLine = `⬆️ ${texts.task.parentTaskLabel}: ${task.parentId}`;
      console.log(`│ ${padByDisplayWidth(parentLine, width - 3)}│`);
    }

    // 需要讨论的Tip
    if (task.needsDiscussion) {
      const discussionCount = task.discussionTopics?.length || 0;
      const discussionLine = discussionCount > 0
        ? `💬 ${texts.task.discussionLabel} (${discussionCount})`
        : `💬 ${texts.task.discussionLabel}`;
      console.log(`│ ${padByDisplayWidth(discussionLine, width - 3)}│`);
    }

    // Requirement Change History计数
    if (task.requirementHistory && task.requirementHistory.length > 0) {
      const reqLine = `📝 ${texts.task.requirementChanges}: ${task.requirementHistory.length}`;
      console.log(`│ ${padByDisplayWidth(reqLine, width - 3)}│`);
    }
  }

  // 时间行 - Created/Updated分离, Reopen Count独立行
  console.log(`├${hLine}┤`);
  const createdTime = formatLocalTime(task.createdAt);
  const updatedTime = formatRelativeTime(task.updatedAt, cwd);
  const timeLine = `📅 ${texts.task.createdAt}: ${createdTime}  ·  ${texts.task.updatedAt}: ${updatedTime}`;
  console.log(`│ ${padByDisplayWidth(timeLine, width - 3)}│`);
  if (task.reopenCount && task.reopenCount > 0) {
    const reopenLine = `🔁 ${texts.task.reopened}: ${texts.task.reopenCount.replace('{count}', String(task.reopenCount))}`;
    console.log(`│ ${padByDisplayWidth(reopenLine, width - 3)}│`);
  }

  console.log(`╰${hLine}╯`);
  console.log('');
}

/**
 * 将连续的StatusChange分组为流式显示
 * 例如: [in_progress→wait_review, wait_review→wait_qa, wait_qa→wait_evaluation]
 * 合并为: in_progress → wait_review → wait_qa → wait_evaluation
 */
interface HistoryGroup {
  type: 'status-flow' | 'single';
  entries: TaskHistoryEntry[];
}

function groupConsecutiveStatusChanges(history: TaskHistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  const GROUP_TIME_GAP_MS = 5 * 60 * 1000; // 5分钟内的连续StatusChange合并

  for (const entry of history) {
    const lastGroup = groups[groups.length - 1];

    if (
      lastGroup?.type === 'status-flow' &&
      entry.field === 'status' &&
      entry.oldValue !== entry.newValue
    ) {
      const lastEntry = lastGroup.entries[lastGroup.entries.length - 1]!;
      const timeGap = new Date(entry.timestamp).getTime() - new Date(lastEntry.timestamp).getTime();

      if (timeGap <= GROUP_TIME_GAP_MS) {
        // 追加到现有的Status流组
        lastGroup.entries.push(entry);
      } else {
        // 时间间隔过大, 开始新组
        groups.push({ type: 'status-flow', entries: [entry] });
      }
    } else if (entry.field === 'status' && entry.oldValue !== entry.newValue) {
      // 开始新的Status流组
      groups.push({ type: 'status-flow', entries: [entry] });
    } else {
      // 非StatusChange或None意义Change, 单独显示
      groups.push({ type: 'single', entries: [entry] });
    }
  }

  return groups;
}

/**
 * 生成统一宽度的段Title
 * 格式: "  ── Title ────────" 总显示宽度 60
 */
function makeSectionHeader(title: string): string {
  const prefix = '  ── ';
  const suffix = ' ';
  const usedWidth = getDisplayWidth(prefix) + getDisplayWidth(title) + getDisplayWidth(suffix);
  const dashes = '─'.repeat(Math.max(0, SEPARATOR_WIDTH - usedWidth));
  return `${prefix}${title}${suffix}${dashes}`;
}

/**
 * 经典格式 - 详细输出
 */
function showTaskClassic(
  task: TaskMeta,
  options: { verbose?: boolean; checkpoints?: boolean },
  cwd: string
): void {
  const line = '━'.repeat(SEPARATOR_WIDTH);
  const statusIcon = getStatusIcon(task.status);

  console.log('');
  console.log(`${statusIcon} ${task.id}`);
  console.log(line);
  console.log(`  ${task.title}`);
  console.log('');
  console.log(`  Status: ${formatStatus(task.status)}  ·  Priority: ${formatPriority(task.priority)}  ·  Type: ${task.type || 'Not specified'}`);

  // Description
  if (task.description) {
    console.log('');
    console.log('📝 Description:');
    const descLines = task.description.split('\n');
    descLines.forEach(descLine => {
      console.log(`   ${descLine}`);
    });
  }

  // verbose 模式显示更多Field
  if (options.verbose) {
    console.log('');
    console.log(makeSectionHeader('Details'));

    if (task.recommendedRole) {
      console.log(`   👤 Recommended Role: ${task.recommendedRole}`);
    }

    if (task.branch) {
      console.log(`   🌿 Associated Branch: ${task.branch}`);
    }

    if (task.dependencies.length > 0) {
      console.log(`   🔗 Dependencies: ${task.dependencies.join(', ')}`);
    } else {
      console.log(`   🔗 Dependencies: None`);
    }

    if (task.subtaskIds && task.subtaskIds.length > 0) {
      const subtaskDisplays = task.subtaskIds.map(subId => {
        const sub = readTaskMeta(subId, cwd);
        if (sub) {
          return `${getStatusIcon(sub.status)} ${subId}`;
        }
        return `❓ ${subId}`;
      });
      console.log(`   📎 Subtasks: ${subtaskDisplays.join('  ')}`);
    }

    if (task.parentId) {
      console.log(`   ⬆️  Parent Task: ${task.parentId}`);
    }

    if (task.checkpointConfirmationToken) {
      console.log(`   🔐 Verification Token: ${task.checkpointConfirmationToken}`);
    }
  } else {
    // 标准模式只显示关键Field
    if (task.recommendedRole) {
      console.log(`   👤 Recommended Role: ${task.recommendedRole}`);
    }

    if (task.branch) {
      console.log(`   🌿 Associated Branch: ${task.branch}`);
    }

    if (task.dependencies.length > 0) {
      console.log(`   🔗 Dependencies: ${task.dependencies.join(', ')}`);
    }
  }

  // 时间信息（合并到主区域, 减少分隔线）
  console.log('');
  console.log(`  📅 Created: ${formatLocalTime(task.createdAt)} (${formatRelativeTime(task.createdAt)})`);
  console.log(`     Updated: ${formatLocalTime(task.updatedAt)} (${formatRelativeTime(task.updatedAt)})`);

  if (task.reopenCount && task.reopenCount > 0) {
    console.log(`   Reopen Count: ${task.reopenCount}`);
  }

  // 待讨论Tip
  if (task.needsDiscussion) {
    const discussionCount = task.discussionTopics?.length || 0;
    console.log(`   💬 Pending Discussion${discussionCount > 0 ? ` (${discussionCount}topics)` : ''}`);
  }

  // 显示Requirement Change History（verbose 模式或有Change时）
  if (task.requirementHistory && task.requirementHistory.length > 0) {
    console.log(`   Requirement Changes: ${task.requirementHistory.length} times`);
    if (options.verbose) {
      console.log('');
      console.log(line);
      console.log('📝 Requirement Change History:');
      console.log(line);
      task.requirementHistory.forEach((entry) => {
        const timeStr = formatLocalTime(entry.timestamp);
        console.log(`\n   [v${entry.version}] ${timeStr}`);
        console.log(`      Change reason: ${entry.changeReason}`);
        if (entry.impactAnalysis) {
          console.log(`      Impact Analysis: ${entry.impactAnalysis}`);
        }
        if (entry.relatedIssue) {
          console.log(`      Related Issue: ${entry.relatedIssue}`);
        }
      });
    }
  }

  // 显示Checkpoints
  const taskDir = path.join(getTasksDir(cwd), task.id);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  console.log('');

  // 如果Use  --checkpoints or --verbose, 显示详细的Checkpoints元数据
  if (options.checkpoints || options.verbose) {
    const checkpointsMeta = listCheckpoints(task.id, cwd);

    if (checkpointsMeta.length > 0) {
      console.log(makeSectionHeader('Checkpoints'));
      console.log('');

      const completedCount = checkpointsMeta.filter(cp => cp.status === 'completed').length;
      const percentage = Math.round((completedCount / checkpointsMeta.length) * 100);
      const barFilled = Math.round((completedCount / checkpointsMeta.length) * 20);
      const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);
      console.log(`   Progress: [${bar}] ${completedCount}/${checkpointsMeta.length} (${percentage}%)`);
      console.log('');

      checkpointsMeta.forEach((cp, index) => {
        const cpIcon = cp.status === 'completed' ? '✅' :
                       cp.status === 'failed' ? '❌' :
                       cp.status === 'skipped' ? '⏭️' : '⬜';

        console.log(`   ${index + 1}. ${cpIcon} ${cp.description}`);
        if (cp.note) {
          console.log(`      Note: ${cp.note}`);
        }
        if (cp.verification?.result) {
          console.log(`      Verification: ${cp.verification.result}`);
        }
      });
    }
  } else if (fs.existsSync(checkpointPath)) {
    // 默认显示 checkpoint.md 内容, 格式化输出
    console.log(makeSectionHeader('Checkpoints'));
    console.log('');

    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const checkpointLines = content.split('\n').filter(l => l.trim().startsWith('- ['));

    if (checkpointLines.length > 0) {
      const completedCount = checkpointLines.filter(l => l.includes('[x]') || l.includes('[X]')).length;
      const percentage = Math.round((completedCount / checkpointLines.length) * 100);
      const barFilled = Math.round((completedCount / checkpointLines.length) * 20);
      const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);
      console.log(`   Progress: [${bar}] ${completedCount}/${checkpointLines.length} (${percentage}%)`);
      console.log('');

      checkpointLines.forEach((l, index) => {
        const isChecked = l.includes('[x]') || l.includes('[X]');
        const cpIcon = isChecked ? '✅' : '⬜';
        const text = l.replace(/- \[[xX ]\] /, '').trim();
        console.log(`   ${index + 1}. ${cpIcon} ${text}`);
      });
    } else {
      console.log('   No checkpoints');
    }
  }

  // verbose 模式显示HistorySummary（智能分组）
  if (options.verbose && task.history && task.history.length > 0) {
    console.log('');
    console.log(makeSectionHeader('Change History'));
    console.log('');

    const meaningfulHistory = filterMeaningfulHistory(task.history);

    // 统计Summary
    const statusChanges = meaningfulHistory.filter(e => e.field === 'status').length;
    const priorityChanges = meaningfulHistory.filter(e => e.field === 'priority').length;
    const otherChanges = meaningfulHistory.length - statusChanges - priorityChanges;

    console.log(`   📊 Summary: Total ${meaningfulHistory.length} changes`);
    console.log(`      - StatusChange: ${statusChanges} times`);
    console.log(`      - PriorityChange: ${priorityChanges} times`);
    console.log(`      - Other changes: ${otherChanges} times`);
    console.log('');

    // 智能分组连续的StatusChange
    const sortedHistory = [...meaningfulHistory].reverse();
    const groups = groupConsecutiveStatusChanges(sortedHistory);
    const maxGroups = 8;
    const displayGroups = groups.slice(0, maxGroups);

    console.log('   Recent Changes:');
    for (const group of displayGroups) {
      if (group.type === 'status-flow') {
        const timeStr = formatLocalTime(group.entries[0]!.timestamp);
        const flow = group.entries.map(e => e.oldValue || '').filter((v, i, a) => a.indexOf(v) === i).concat(group.entries[group.entries.length - 1]!.newValue || '').join(' → ');
        console.log(`   [${timeStr}] Status flow: ${flow}`);
      } else {
        const entry = group.entries[0]!;
        const timeStr = formatLocalTime(entry.timestamp);
        console.log(`   [${timeStr}] ${entry.action}`);
        if (entry.field && entry.oldValue !== undefined && entry.newValue !== undefined) {
          console.log(`      ${entry.field}: ${entry.oldValue} → ${entry.newValue}`);
        }
      }
    }

    if (groups.length > maxGroups) {
      console.log('');
      console.log(`   ... plus ${groups.length - maxGroups} change records`);
      console.log(`   Use --history option to view full history`);
    }
  }

  console.log('');
}

/**
 * 文本换行辅助函数
 */
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let currentLine = '';
    const words = paragraph.split(' ');

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

/**
 * UpdatedTask
 * 支持SubtasksStatus同步
 */
export async function updateTask(
  taskId: string,
  options: {
    title?: string;
    priority?: string;
    status?: string;
    description?: string;
    role?: string;
    branch?: string;
    needsDiscussion?: boolean;
    token?: string;
    syncChildren?: boolean;
    noSync?: boolean;
    enhancement?: boolean;
    failedCheckpoints?: string;
    qaFeedback?: string;
  },
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // P1-003: Checkpoints双触发机制
  if (options.status === 'resolved') {
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');

    // #一times调用: 没有token
    if (!options.token) {
      // 检查是否有Checkpoints文件
      if (!fs.existsSync(checkpointPath)) {
        // 没有Checkpoints文件, 直接UpdatedStatus
        task.status = options.status as TaskStatus;
        writeTaskMeta(task, cwd);
        console.log(`✅ Task ${taskId} updated to resolved status`);
        return;
      }

      // 有Checkpoints文件, 检查是否所有Checkpoints都Completed
      const checkpoints = parseCheckpoints(checkpointPath);
      const uncheckedCheckpoints = checkpoints.filter(cp => !cp.checked);

      if (uncheckedCheckpoints.length > 0) {
        // 有未完成的Checkpoints, 显示提醒
        console.log('');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log('⚠️ Checkpoint Confirmation Reminder');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log('');
        console.log('Before marking task as resolved, please complete the following checkpoints:');
        console.log('');
        uncheckedCheckpoints.forEach((cp, idx) => {
          console.log(`  ${idx + 1}. ${cp.text}`);
        });
        console.log('');
        console.log('━'.repeat(SEPARATOR_WIDTH));
        console.log('After completing checkpoints, run the following command to verify:');
        console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
        console.log('');
        console.log('Verification will generate confirmation token, use it to complete task update:');
        console.log(`   projmnt4claude task update ${taskId} --status resolved --token <token>`);
        console.log('');
        return;
      }

      // All checkpoints completed but missing token,       console.log('');
      console.log('━'.repeat(SEPARATOR_WIDTH));
      console.log('⚠️ Checkpoint Confirmation Reminder');
      console.log('━'.repeat(SEPARATOR_WIDTH));
      console.log('');
      console.log('All checkpoints completed but missing confirmation token.');
      console.log('');
      console.log('Please run the following command to verify checkpoints and get token:');
      console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
      console.log('');
      return;
    }

    // #二times调用: 有token
    if (options.token) {
      // Verificationtoken是否匹配
      if (task.checkpointConfirmationToken !== options.token) {
        console.error('Error: Invalid confirmation token');
        console.log('');
        console.log('Please run the following command to get a new token:');
        console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
        process.exit(1);
      }

      // token匹配, UpdatedStatus并清除token
      task.status = options.status as TaskStatus;
      task.checkpointConfirmationToken = undefined;
      writeTaskMeta(task, cwd);
      console.log(`✅ Task ${taskId} updated to resolved status`);
      return;
    }
  }

  // 其他StatusUpdated, 正常处理
  let updated = false;

  // 保存原始值用 in 日志记录
  const originalStatus = task.status;
  const originalPriority = task.priority;

  if (options.title) {
    task.title = options.title;
    updated = true;
  }
  if (options.priority) {
    task.priority = options.priority as TaskPriority;
    updated = true;
  }
  if (options.status) {
    const oldStatus = task.status;

    // reopened Status映射为 open + reopenCount 递增 + transitionNote
    if (options.status === 'reopened') {
      task.status = 'open';
      task.reopenCount = (task.reopenCount || 0) + 1;

      // 清除失败Reason（从 failed StatusReopen时）
      if (oldStatus === 'failed') {
        delete task.failureReason;
      }

      // 解析 failedCheckpoints
      const failedCheckpointIds = options.failedCheckpoints
        ? options.failedCheckpoints.split(',').map(id => id.trim()).filter(Boolean)
        : undefined;

      // 创建详细 reopen 记录
      const reopenRecord: import('../types/task').ReopenRecord = {
        timestamp: new Date().toISOString(),
        reason: options.qaFeedback || '用户发起Reopen',
        reopenedBy: process.env.USER || 'system',
        enhancementRequest: options.enhancement || false,
        failedCheckpoints: failedCheckpointIds,
        qaFeedback: options.qaFeedback,
      };

      // 添加到 reopenRecords
      if (!task.reopenRecords) {
        task.reopenRecords = [];
      }
      task.reopenRecords.push(reopenRecord);

      // 添加 transitionNote
      if (!task.transitionNotes) {
        task.transitionNotes = [];
      }
      let transitionNoteText = `Task从 ${oldStatus} Reopen为 open (reopenCount: ${task.reopenCount})`;
      if (options.enhancement) {
        transitionNoteText += ' [Enhancement]';
      }
      if (failedCheckpointIds && failedCheckpointIds.length > 0) {
        transitionNoteText += ` [Failed CPs: ${failedCheckpointIds.join(', ')}]`;
      }
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus as TaskStatus,
        toStatus: 'open',
        note: transitionNoteText,
        author: process.env.USER || undefined,
      });

      // 添加History记录
      if (!task.history) {
        task.history = [];
      }
      task.history.push({
        timestamp: new Date().toISOString(),
        action: `TaskReopen: ${oldStatus} → open (reopenCount: ${task.reopenCount})`,
        field: 'status',
        oldValue: oldStatus,
        newValue: 'open',
        reason: options.qaFeedback || '用户发起Reopen, Status映射为 open + reopenCount 递增',
      });

      console.log(`🔁 Task reopened (#${task.reopenCount} times)`);
      console.log(`   ${oldStatus} → open (reopenCount: ${task.reopenCount})`);
      if (options.enhancement) {
        console.log('   📌 Marked as enhancement request');
      }
      if (failedCheckpointIds && failedCheckpointIds.length > 0) {
        console.log(`   📋 Failed checkpoints: ${failedCheckpointIds.join(', ')}`);
      }
      if (options.qaFeedback) {
        console.log(`   💬 QA feedback: ${options.qaFeedback.substring(0, 100)}${options.qaFeedback.length > 100 ? '...' : ''}`);
      }
    } else {
      task.status = options.status as TaskStatus;
    }

    updated = true;
  }
  if (options.description !== undefined) {
    task.description = options.description || undefined;
    updated = true;
  }
  if (options.role) {
    task.recommendedRole = options.role;
    updated = true;
  }
  if (options.branch) {
    task.branch = options.branch;
    updated = true;
  }
  if (options.needsDiscussion !== undefined) {
    task.needsDiscussion = options.needsDiscussion;
    updated = true;
  }

  if (!updated) {
    console.log('No fields specified for update');
    return;
  }

  writeTaskMeta(task, cwd);
  console.log(`✅ Task ${taskId} updated`);

  // 记录单行Updated操作日志（Status或PriorityChange时）
  if (options.status || options.priority) {
    const commandArgs = process.argv.slice(2);
    writeBatchUpdateLog({
      commandArgs,
      options: {
        status: options.status,
        priority: options.priority,
        all: false,
        yes: true,
      },
      tasks: [{
        id: task.id,
        title: task.title || '(NoneTitle)',
        oldStatus: originalStatus,
        newStatus: task.status,
        oldPriority: originalPriority,
        newPriority: task.priority,
      }],
      summary: {
        totalCount: 1,
        updatedCount: 1,
        filteredCount: 0,
      },
    }, cwd);
  }

  // P1修复: SubtasksStatus同步
  if ((options.status === 'resolved' || options.status === 'closed') && !options.noSync) {
    const childTasks = task.subtaskIds || [];

    if (childTasks.length > 0) {
      console.log('');
      console.log(`⚠️  Detected ${childTasks.length} subtasks:`);

      // 显示Subtasks当前Status
      for (const childId of childTasks) {
        const childTask = readTaskMeta(childId, cwd);
        if (childTask) {
          console.log(`   - ${childId} (status: ${childTask.status})`);
        }
      }

      // 如果明确指定了 syncChildren, or者用户交互确认
      if (options.syncChildren) {
        // 自动Sync Subtask Status
        for (const childId of childTasks) {
          const childTask = readTaskMeta(childId, cwd);
          if (childTask && childTask.status !== 'resolved' && childTask.status !== 'closed') {
            childTask.status = options.status as TaskStatus;

            // 添加History记录
            if (!childTask.history) {
              childTask.history = [];
            }
            childTask.history.push({
              timestamp: new Date().toISOString(),
              action: `Status同步自Parent task ${taskId}`,
              field: 'status',
              oldValue: childTask.status,
              newValue: options.status,
              reason: 'Parent taskCompleted, Subtasks功能已在Parent task中实现',
            });

            writeTaskMeta(childTask, cwd);
            console.log(`   ✅ ${childId} synced to ${options.status}`);
          }
        }
        console.log('');
        console.log(`✅ Synced ${childTasks.length} subtask statuses`);
      } else {
        console.log('');
        console.log('Tip: Use --sync-children to auto-sync subtask statuses');
        console.log(`      projmnt4claude task update ${taskId} --status ${options.status} --sync-children`);
      }
    }
  }
}

/**
 * 提交Task等待Verification
 *
 * Set task status to wait_evaluation, 等待质量门禁Verification
 * 等价 in : projmnt4claude task update TASK-xxx --status wait_evaluation
 *
 * @deprecated 该函数已废弃, 请Use  `projmnt4claude task update TASK-xxx --status wait_evaluation` 代替
 *   功能与 harness 流水线阶段推进重复, 将在未来版本中移除
 */
export async function submitTask(
  taskId: string,
  options: {
    note?: string;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  // 输出废弃警告
  console.warn('');
  console.warn('⚠️ Warning: task submit command is deprecated and will be removed in a future version');
  console.warn('   Please use alternative command: projmnt4claude task update <taskId> --status wait_evaluation');
  console.warn('');

  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // 检查当前Status是否允许提交
  const allowedStatuses: TaskStatus[] = ['in_progress', 'open'];
  if (!allowedStatuses.includes(task.status)) {
    console.error(`Error: Task current status is '${task.status}', only ${allowedStatuses.join(', ')} status tasks can be submitted`);
    process.exit(1);
  }

  const oldStatus = task.status;

  // UpdatedStatus is wait_evaluation
  task.status = 'wait_evaluation';

  // 记录History
  const historyEntry: TaskHistoryEntry = {
    timestamp: new Date().toISOString(),
    action: `提交等待Verification: ${oldStatus} -> wait_evaluation`,
    field: 'status',
    oldValue: oldStatus,
    newValue: 'wait_evaluation',
    user: process.env.USER || undefined,
  };

  if (options.note) {
    historyEntry.reason = options.note;
  }

  if (!task.history) {
    task.history = [];
  }
  task.history.push(historyEntry);

  writeTaskMeta(task, cwd);

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📤 Task submitted for verification');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(`Task ID: ${taskId}`);
  console.log(`Title: ${task.title}`);
  console.log(`Status: ${oldStatus} → wait_evaluation`);
  console.log('');
  console.log('Verification will auto-execute via:');
  console.log('  1. Claude Code hooks triggered on subsequent operations');
  console.log('  2. Run projmnt4claude task validate command');
  console.log('');
  console.log('After verification passes, task status will auto-update to resolved');
  console.log('');
}

/**
 * Verification wait_evaluation Status tasks
 *
 * @deprecated 此Command已废弃, 请Use  harness 流水线进行自动Verification
 *   替代方案: projmnt4claude task update <taskId> --status wait_evaluation
 *   Verification将通过 harness evaluation 阶段自动执行
 *
 * 执行Verification并UpdatedTaskStatus
 */
export async function validateTask(
  taskId: string,
  options: {
    executeCommands?: boolean;
    autoResolve?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  // 动态导入避免循环Dependencies
  const { validateTaskCompletion, generateValidationReport } = await import('../utils/validation.js');

  // 废弃警告
  console.warn('[Notice]: task validate command is deprecated');
  console.warn('   Use: projmnt4claude task update <taskId> --status wait_evaluation');
  console.warn('   Validation will be automatically executed by harness evaluation phase');
  console.warn('');

  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  if (task.status !== 'wait_evaluation') {
    console.error(`Error: Task status is '${task.status}', only wait_evaluation status tasks can be verified`);
    console.log('');
    console.log('Tip: Set task status to wait_evaluation');
    console.log(`      projmnt4claude task update ${taskId} --status wait_evaluation`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 Starting task verification');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 执行Verification
  const result = await validateTaskCompletion(taskId, cwd, {
    executeCommands: options.executeCommands !== false,
    collectEvidence: true,
  });

  // 输出Verification报告
  const report = generateValidationReport(taskId, result);
  console.log(report);

  if (result.valid) {
    if (options.autoResolve !== false) {
      // 自动Updated为 resolved
      task.status = 'resolved' as TaskStatus;

      const historyEntry: TaskHistoryEntry = {
        timestamp: new Date().toISOString(),
        action: 'Verification通过, StatusUpdated为 resolved',
        field: 'status',
        oldValue: 'wait_evaluation',
        newValue: 'resolved',
        user: process.env.USER || undefined,
      };

      if (!task.history) {
        task.history = [];
      }
      task.history.push(historyEntry);

      writeTaskMeta(task, cwd);
      console.log('✅ Task status updated to resolved');
    } else {
      console.log('✅ Verification passed, can manually update status:');
      console.log(`   projmnt4claude task update ${taskId} --status resolved`);
    }
  } else {
    // Verification失败, 返回 in_progress
    task.status = 'in_progress';

    const historyEntry: TaskHistoryEntry = {
      timestamp: new Date().toISOString(),
      action: 'Verification失败, 返回开发Status',
      field: 'status',
      oldValue: 'wait_evaluation',
      newValue: 'in_progress',
      reason: result.errors.map(e => e.message).join('; '),
      user: process.env.USER || undefined,
    };

    if (!task.history) {
      task.history = [];
    }
    task.history.push(historyEntry);

    writeTaskMeta(task, cwd);
    console.log('❌ Task returned to in_progress status, please fix issues and resubmit');
  }
}

/**
 * 删除Task（归档）
 * CP-9: 新增下游影响检查, 删除前警告Dependencies此Task的其他Task
 */
export async function deleteTask(taskId: string, force: boolean = false, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // CP-9: Check downstream impact using graph
  const allTasks = getAllTasks(cwd);
  const graph = DependencyGraph.fromTasks(allTasks);
  const downstream = graph.getDirectDownstream(taskId);
  const allDownstream = graph.getAllDownstream(taskId);

  if (downstream.length > 0 || allDownstream.length > 0) {
    console.log('');
    console.log(`⚠️  This task has ${downstream.length} direct dependents and ${allDownstream.length} transitive dependents:`);
    for (const depId of downstream.slice(0, 10)) {
      const depTask = readTaskMeta(depId, cwd);
      const status = depTask ? formatStatus(depTask.status) : '❓';
      console.log(`   - ${depId} (${depTask?.title?.substring(0, 30) || 'Unknown'} ${status})`);
    }
    if (downstream.length > 10) {
      console.log(`   ... plus ${downstream.length - 10} `);
    }
    console.log('');
    console.log('  After deletion, these task dependency references will become invalid. Recommend removing related dependencies first.');
    console.log('');
  }

  // to confirm deletion
  if (!force) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `确定要删除Task ${taskId} 吗？`,
      initial: false,
    });

    if (!response.confirm) {
      console.log('Deletion cancelled');
      return;
    }
  }

  // 移动到归档目录
  const tasksDir = getTasksDir(cwd);
  const archiveDir = getArchiveDir(cwd);
  const taskPath = path.join(tasksDir, taskId);
  const archivePath = path.join(archiveDir, taskId);

  // 确保归档目录存在
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  // UpdatedStatus is abandoned
  task.status = 'abandoned';
  writeTaskMeta(task, cwd);

  // 移动目录
  fs.renameSync(taskPath, archivePath);

  console.log(`✅ Task ${taskId} Archived`);
}

/**
 * 清除 abandoned Task（物理删除归档目录）
 */
export function purgeTasks(options: { force?: boolean; json?: boolean } = {}, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const archiveDir = getArchiveDir(cwd);

  if (!fs.existsSync(archiveDir)) {
    const msg = '没有需要清除的 abandoned Task';
    if (options.json) {
      console.log(JSON.stringify({ purged: 0, message: msg }));
    } else {
      console.log(msg);
    }
    return;
  }

  // 读取归档目录中的 abandoned Task
  const abandonedDirs = fs.readdirSync(archiveDir)
    .filter(name => {
      const dirPath = path.join(archiveDir, name);
      if (!fs.statSync(dirPath).isDirectory()) return false;
      const metaPath = path.join(dirPath, 'meta.json');
      if (!fs.existsSync(metaPath)) return false;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return meta.status === 'abandoned';
      } catch {
        return false;
      }
    });

  if (abandonedDirs.length === 0) {
    const msg = '没有需要清除的 abandoned Task';
    if (options.json) {
      console.log(JSON.stringify({ purged: 0, message: msg }));
    } else {
      console.log(msg);
    }
    return;
  }

  // to confirm deletion
  if (!options.force) {
    console.log(`Found ${abandonedDirs.length}  abandoned Task:`);
    for (const dir of abandonedDirs) {
      console.log(`  - ${dir}`);
    }
    if (!process.stdout.isTTY) {
      console.log('\nUse  --force or -y to confirm deletion');
      return;
    }
    return;
  }

  let purged = 0;
  for (const dir of abandonedDirs) {
    const dirPath = path.join(archiveDir, dir);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      purged++;
    } catch (e) {
      console.error(`Delete ${dir} failed: ${e}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ purged, total: abandonedDirs.length }));
  } else {
    console.log(`✅ Purged ${purged}/${abandonedDirs.length}  abandoned Task`);
  }
}

/**
 * 添加TaskDependencies
 * CP-5: Use  graph.addEdge() 替代直接数组操作 + wouldCreateCycle
 */
export function addDependency(taskId: string, depId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  const depTask = readTaskMeta(depId, cwd);
  if (!depTask) {
    console.error(`Error: Dependency Tasks '${depId}' does not exist`);
    process.exit(1);
  }

  if (task.dependencies.includes(depId)) {
    console.log(`Task ${taskId} already depends on ${depId}`);
    return;
  }

  // CP-5: Use graph.addEdge() for cycle detection
  const allTasks = getAllTasks(cwd);
  const graph = DependencyGraph.fromTasks(allTasks);
  if (!graph.addEdge(taskId, depId)) {
    console.error(`Error: Adding dependency ${depId} would create circular dependency (GATE-DEP-002)`);
    process.exit(1);
  }

  task.dependencies.push(depId);
  writeTaskMeta(task, cwd);

  console.log(`✅ Dependency added: ${taskId} -> ${depId}`);
}

/**
 * 移除TaskDependencies
 * CP-7: Use  graph.removeEdge() 并检查是否有推断Dependencies可替代
 */
export function removeDependency(taskId: string, depId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  const index = task.dependencies.indexOf(depId);
  if (index === -1) {
    console.log(`Task ${taskId} does not depend on ${depId}`);
    return;
  }

  // CP-7: Use graph.removeEdge() to update the graph model
  const allTasks = getAllTasks(cwd);
  const graph = DependencyGraph.fromTasks(allTasks);
  graph.removeEdge(taskId, depId);

  task.dependencies.splice(index, 1);
  writeTaskMeta(task, cwd);

  console.log(`✅ Dependency removed: ${taskId} -/-> ${depId}`);

  // Check if there are inferred dependencies that could replace the removed one
  const remainingDeps = task.dependencies;
  if (remainingDeps.length === 0) {
    // No dependencies left - check if graph detects any inferred alternatives
    const inferredDownstream = graph.getDirectUpstream(taskId);
    if (inferredDownstream.length > 0) {
      console.log(`💡 Tip: Possible implicit dependencies detected in graph: ${inferredDownstream.join(', ')}`);
    }
  }
}

/**
 * 检查是否would create circular dependency
 * Use  dependency-graph 模块的 DependencyGraph.wouldCreateCycle 替代内联 BFS
 */
function wouldCreateCycle(taskId: string, depId: string, cwd: string): boolean {
  const allTasks = getAllTasks(cwd);
  const graph = DependencyGraph.fromTasks(allTasks);
  return graph.wouldCreateCycle(taskId, depId);
}

/**
 * 格式化Priority
 * 支持两种格式: P0/P1/P2/P3/Q1-Q4 和 low/medium/high/urgent
 */
function formatPriority(priority: TaskPriority | string, cwd?: string): string {
  const texts = t(cwd);
  const map: Record<string, string> = {
    // P0-P3 格式
    P0: `🔴 ${texts.task.priorityP0}`,
    P1: `🟠 ${texts.task.priorityP1}`,
    P2: `🟡 ${texts.task.priorityP2}`,
    P3: `🟢 ${texts.task.priorityP3}`,
    // Q1-Q4 象限格式
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
    // low-urgent 格式（兼容旧数据）
    low: `🟢 ${texts.task.priorityP3}`,
    medium: `🟡 ${texts.task.priorityP2}`,
    high: `🟠 ${texts.task.priorityP1}`,
    urgent: `🔴 ${texts.task.priorityP0}`,
  };
  return map[priority] || `❓ ${priority}`;
}

/**
 * 格式化Status
 * 支持所有Status格式
 */
function formatStatus(status: TaskStatus | string, cwd?: string): string {
  const texts = t(cwd);
  const map: Record<string, string> = {
    open: `⬜ ${texts.task.statusOpen}`,
    in_progress: `🔵 ${texts.task.statusInProgress}`,
    wait_review: `👀 ${texts.task.statusWaitReview}`,
    wait_qa: `🧪 ${texts.task.statusWaitQa}`,
    wait_evaluation: `⏳ ${texts.task.statusWaitEvaluation}`,
    resolved: `✅ ${texts.task.statusResolved}`,
    closed: `⚫ ${texts.task.statusClosed}`,
    abandoned: `❌ ${texts.task.statusAbandoned}`,
    failed: `⛔ ${texts.task.statusFailed}`,
    // 兼容旧Status（reopened/reopen 已废弃, 自动映射为 open + reopenCount 递增）
    pending: `⬜ ${texts.task.statusOpen}`,
    completed: `✅ ${texts.task.statusResolved}`,
    cancelled: `❌ ${texts.task.statusAbandoned}`,
  };
  return map[status] || `❓ ${status}`;
}

/**
 * 显示Status转换指导 (P2-004)
 * 帮助用户理解TaskStatus flow
 */
export function showStatusGuide(): void {
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 Task Status Transition Guide');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  console.log('📊 Status Description:');
  console.log('');
  console.log('  ⬜ open        - Pending, task created waiting to start');
  console.log('  🔵 in_progress - In Progress, task being executed');
  console.log('  ✅ resolved    - Resolved, task completed and verified');
  console.log('  ⚫ closed      - Closed, task finally confirmed complete');
  console.log('  ❌ abandoned   - Abandoned, task no longer needed');
  console.log('  ⛔ failed      - Failed, task execution failed (timeout/quality gate/retry exhausted)');
  console.log('');
  console.log('  💡 Description: resolved/closed can be reopened to open via --status reopened');
  console.log('           System will auto-increment reopenCount and log transitionNote');
  console.log('');

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔄 Status Transition Matrix:');
  console.log('');

  console.log('  open → in_progress');
  console.log('       └─ Command: task update <id> --status in_progress');
  console.log('       └─ Description: Start executing task');
  console.log('');

  console.log('  in_progress → resolved');
  console.log('       └─ Command: task checkpoint <id> -y  or');
  console.log('              task update <id> --status resolved --token <token>');
  console.log('       └─ Description: Complete all checkpoints and verify');
  console.log('');

  console.log('  resolved → closed');
  console.log('       └─ Command: task update <id> --status closed');
  console.log('       └─ Description: Finally confirm task completion');
  console.log('');

  console.log('  resolved/closed → open (Reopen)');
  console.log('       └─ Command: task update <id> --status reopened');
  console.log('       └─ Description: Found issues need reprocessing(auto-mapped to open + reopenCount increment)');
  console.log('');

  console.log('  Any status → abandoned');
  console.log('       └─ Command: task delete <id>');
  console.log('       └─ Description: Task no longer needed');
  console.log('');

  console.log('  failed → open (Reopen failed task)');
  console.log('       └─ Command: task update <id> --status reopened');
  console.log('       └─ Description: Reprocess failed task(auto-mapped to open + reopenCount increment)');
  console.log('');

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('💡 Quick Commands:');
  console.log('');
  console.log('  task execute <id>     - Start executing task (auto sets in_progress)');
  console.log('  task checkpoint <id>  - Verify checkpoints and get completion token');
  console.log('  task complete <id>    - One-click complete task (P2-005)');
  console.log('');

  console.log('━'.repeat(SEPARATOR_WIDTH));
}

/**
 * One-click complete task (P2-005)
 * 自动执行: VerificationCheckpoints → UpdatedStatus is resolved
 */
export async function completeTask(
  taskId: string,
  options: { yes?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`🚀 One-click complete task: ${taskId}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 检查Checkpoints
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (fs.existsSync(checkpointPath)) {
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

    if (lines.length > 0) {
      const unchecked = lines.filter(line => !line.includes('[x]') && !line.includes('[X]'));

      if (unchecked.length > 0) {
        console.log('⚠️  Found incomplete checkpoints:');
        unchecked.forEach((line, idx) => {
          const text = line.replace(/- \[[xX ]\] /, '').trim();
          console.log(`   ${idx + 1}. ${text}`);
        });
        console.log('');

        if (!options.yes) {
          const response = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: '是否标记所有Checkpoints为Completed并继续?',
            initial: false,
          });

          if (!response.proceed) {
            console.log('Cancelled. Please complete checkpoints before trying again.');
            return;
          }
        }

        // 自动标记所有Checkpoints为Completed
        let newContent = content;
        for (const line of unchecked) {
          newContent = newContent.replace(line, line.replace('[ ]', '[x]'));
        }
        fs.writeFileSync(checkpointPath, newContent, 'utf-8');
        console.log('✅ All checkpoints auto-marked as completed');
      }
    }
  }

  // UpdatedTaskStatus
  task.status = 'resolved' as TaskStatus;
  writeTaskMeta(task, cwd);

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`🎉 Task ${taskId} Completed！`);
  console.log('');
  console.log(`   Title: ${task.title}`);
  console.log(`   Status: ✅ Resolved`);
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));

  // CP-FEAT-008-01: 完成DescriptionTip
  if (!options.yes) {
    console.log('');
    console.log('💡 Tip: Recommend adding completion notes to record solution and experience');
    console.log('');

    const addNote = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '是否添加完成Description?',
      initial: true,
    });

    if (addNote.confirm) {
      const noteResponse = await prompts({
        type: 'text',
        name: 'note',
        message: '请输入完成Description（解决方案, 关键决策等）:',
        validate: (value) => value.trim().length > 0 ? true : 'Description不能为空',
      });

      if (noteResponse.note) {
        // 添加到History记录
        if (!task.history) {
          task.history = [];
        }
        task.history.push({
          timestamp: new Date().toISOString(),
          action: '添加完成Description',
          field: 'completionNote',
          newValue: noteResponse.note,
        });

        // UpdatedTaskDescription或添加 notes
        const taskDir = path.join(getTasksDir(cwd), taskId);
        const notesDir = path.join(taskDir, 'notes');
        if (!fs.existsSync(notesDir)) {
          fs.mkdirSync(notesDir, { recursive: true });
        }
        const notePath = path.join(notesDir, `completion-${new Date().toISOString().slice(0, 10)}.md`);
        fs.writeFileSync(notePath, `# 完成Description\n\n${noteResponse.note}\n`, 'utf-8');

        writeTaskMeta(task, cwd);
        console.log('');
        console.log('✅ Completion note saved');
      }
    }
  }
}

/**
 * 显示TaskHistory记录 (P2-006)
 * 查看Task的完整Change History
 */
export function showTaskHistory(taskId: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📜 Task History: ${taskId}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(`📌 Title: ${task.title}`);
  console.log(`📊 Current Status: ${formatStatus(task.status)}`);
  console.log('');

  if (!task.history || task.history.length === 0) {
    console.log('No history records');
    console.log('');
    return;
  }

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📝 Change History:');
  console.log('');

  // 过滤并By 时间倒序显示（与 showTaskClassic 保持一致）
  const meaningfulHistory = filterMeaningfulHistory(task.history);
  const sortedHistory = [...meaningfulHistory].reverse();

  // 限制显示数量
  const totalCount = sortedHistory.length;
  const displayHistory = sortedHistory.slice(0, MAX_HISTORY_DISPLAY);

  for (const entry of displayHistory) {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    console.log(`[${timeStr}] ${entry.action}`);

    if (entry.field && entry.oldValue !== undefined && entry.newValue !== undefined) {
      console.log(`         Field: ${entry.field}`);
      console.log(`         Old Value: ${entry.oldValue}`);
      console.log(`         New Value: ${entry.newValue}`);
    }

    if (entry.reason) {
      console.log(`         Reason: ${entry.reason}`);
    }

    if (entry.relatedIssue) {
      console.log(`         Related: ${entry.relatedIssue}`);
    }

    if (entry.verificationDetails) {
      console.log(`         Details: ${entry.verificationDetails}`);
    }

    console.log('');
  }

  if (totalCount > MAX_HISTORY_DISPLAY) {
    console.log(`   ... omitted ${totalCount - MAX_HISTORY_DISPLAY}  history records`);
    console.log('');
  }

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📊 Statistics: Total ${task.history.length}  history records, filtered ${meaningfulHistory.length} ${totalCount > MAX_HISTORY_DISPLAY ? `, showing last ${MAX_HISTORY_DISPLAY} ` : ''}`);
  console.log('');
}

/**
 * 添加History记录目
 */
export function addHistoryEntry(
  taskId: string,
  entry: {
    action: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
    reason?: string;
    relatedIssue?: string;
    verificationDetails?: string;
  },
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) return;

  if (!task.history) {
    task.history = [];
  }

  task.history.push({
    timestamp: new Date().toISOString(),
    action: entry.action,
    field: entry.field,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    reason: entry.reason,
    relatedIssue: entry.relatedIssue,
    verificationDetails: entry.verificationDetails,
  });

  writeTaskMeta(task, cwd);
}

/**
 * 执行Task引导 (P-018, P-019, P-020)
 * 显示TaskDetails, Checkpoint List, 引导用户完成Task
 */
export async function executeTask(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  if (!isValidTaskId(taskId)) {
    console.error(`Error: Invalid task ID format '${taskId}'`);
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📋 Task Execution Guide: ${task.id}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // P-019: 如果Task被Reopen过（reopenCount > 0）, 特别Tip用户
  if ((task.reopenCount || 0) > 0 && task.status === 'open') {
    console.log('⚠️ Note: This task has been reopened!');
    console.log(`   Reopen Count: ${task.reopenCount}, Please investigate task history carefully。`);
    console.log('   Recommend checking task details and checkpoint records first。');
    console.log('');
  }

  // 显示Task基本信息
  console.log(`📌 Title: ${task.title}`);
  console.log(`📊 Status: ${formatStatus(task.status)}`);
  console.log(`🎯 Priority: ${formatPriority(task.priority)}`);

  if (task.description) {
    console.log(`📝 Description: ${task.description}`);
  }

  if (task.recommendedRole) {
    console.log(`👤 Recommended Role: ${task.recommendedRole}`);
  }

  if (task.branch) {
    console.log(`🌿 Associated Branch: ${task.branch}`);
  }

  // 检查DependenciesStatus
  // CP-10: Use  graph.getDirectUpstream() 进行上游Status校验
  if (task.dependencies.length > 0) {
    console.log('');
    console.log('🔗 Dependency Tasks:');

    // Use graph for upstream validation
    const allExTasks = getAllTasks(cwd);
    const exGraph = DependencyGraph.fromTasks(allExTasks);
    const upstreamIds = exGraph.getDirectUpstream(taskId);
    const terminalStatuses = new Set(['resolved', 'closed']);

    const depsStatus = task.dependencies.map(depId => {
      const depTask = readTaskMeta(depId, cwd);
      const status = depTask
        ? (terminalStatuses.has(depTask.status) ? '✅' : '❌')
        : '❓';
      const upstreamValid = upstreamIds.includes(depId);
      const graphTag = upstreamValid ? '' : ' (⚠️ in graphdoes not exist)';
      return `   ${status} ${depId}${graphTag}`;
    });
    console.log(depsStatus.join('\n'));

    // 检查是否有未完成的Dependencies
    const uncompletedDeps = task.dependencies.filter(depId => {
      const depTask = readTaskMeta(depId, cwd);
      return !depTask || !terminalStatuses.has(depTask.status);
    });

    if (uncompletedDeps.length > 0) {
      console.log('');
      console.log('⚠️ Note: Incomplete dependencies exist, recommend completing them first.');
    }
  }

  // 读取Checkpoints
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('✅ Checkpoint List');
  console.log('━'.repeat(SEPARATOR_WIDTH));

  if (fs.existsSync(checkpointPath)) {
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    console.log(content);
  } else {
    console.log('No checkpoints');
  }

  // 工作引导
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('💡 Work Recommendations');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log('1. Read task description and checkpoint requirements carefully');
  console.log('2. Complete work checkpoint by checkpoint');
  console.log('3. After completion, run the following command to verify checkpoints:');
  console.log(`   projmnt4claude task checkpoint verify ${taskId}`);
  console.log('4. Verification will generate confirmation token, copy the token');
  console.log('5. Use token to complete task status update:');
  console.log(`   projmnt4claude task update ${taskId} --status resolved --token <token>`);
  console.log('');

  // 如果TaskStatus是 open, 询问是否开始工作
  if (task.status === 'open') {
    const response = await prompts({
      type: 'confirm',
      name: 'start',
      message: '是否将TaskStatusUpdated为"In Progress"?',
      initial: true,
    });

    if (response.start) {
      task.status = 'in_progress' as TaskStatus;
      writeTaskMeta(task, cwd);
      console.log(`✅ Task ${taskId} status updated to"In Progress"`);
    }
  }
}

/**
 * 完成Checkpoints确认 (P-020)
 * 交互式确认Checkpoints, 并TipUpdatedStatus
 * 支持非交互模式 (--yes)
 */
export async function completeCheckpoint(
  taskId: string,
  options: { yes?: boolean } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) {
    console.log('No checkpoint file');
    return;
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().startsWith('- ['));

  if (lines.length === 0) {
    console.log('No checkpoint items found in file');
    return;
  }

  console.log('');
  console.log('📋 Checkpoint Confirmation');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  let allPassed = true;
  const updatedLines: string[] = [];

  for (const line of lines) {
    const isChecked = line.includes('[x]') || line.includes('[X]');
    const checkText = line.replace(/- \[[xX ]\] /, '').trim();

    if (!isChecked) {
      // 非交互模式: 假设所有未完成的Checkpoints都passed
      if (options.yes) {
        updatedLines.push(line.replace('[ ]', '[x]'));
        console.log(`   ✅ ${checkText} (auto-confirmed)`);
      } else {
        // 交互模式: 询问用户
        const response = await prompts({
          type: 'confirm',
          name: 'passed',
          message: `Checkpoints: ${checkText}`,
          initial: false,
        });

        if (response.passed) {
          updatedLines.push(line.replace('[ ]', '[x]'));
          console.log(`   ✅ passed`);
        } else {
          updatedLines.push(line);
          allPassed = false;
          console.log(`   ❌ failed`);
        }
      }
    } else {
      updatedLines.push(line);
    }
  }

  // UpdatedCheckpoints文件
  let newContent = content;
  for (let i = 0; i < lines.length; i++) {
    newContent = newContent.replace(lines[i]!, updatedLines[i]!);
  }
  fs.writeFileSync(checkpointPath, newContent, 'utf-8');

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));

  if (allPassed) {
    console.log('🎉 All checkpoints passed!');
    console.log('');
    console.log('Recommend running the following command to complete task:');
    console.log(`   projmnt4claude task update ${taskId} --status resolved`);

    // 非交互模式: 自动标记为Resolved
    if (options.yes) {
      task.status = 'resolved' as TaskStatus;
      writeTaskMeta(task, cwd);
      console.log(`✅ Task ${taskId} auto-marked as resolved`);
    } else {
      // 交互模式: 询问用户
      const response = await prompts({
        type: 'confirm',
        name: 'complete',
        message: '是否立即将Task标记为Resolved?',
        initial: true,
      });

      if (response.complete) {
        task.status = 'resolved' as TaskStatus;
        writeTaskMeta(task, cwd);
        console.log(`✅ Task ${taskId} marked as resolved`);
      }
    }
  } else {
    console.log('⚠️ Some checkpoints failed, please continue working');
  }
}

/**
 * VerificationCheckpoints并生成token (P1-003)
 */
export async function verifyCheckpoint(taskId: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  const checkpoints = parseCheckpoints(checkpointPath);

  if (checkpoints.length === 0) {
    console.log('No checkpoints');
    return;
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`🔍 CheckpointsVerification: ${taskId}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 显示CheckpointsStatus
  const uncheckedCheckpoints = checkpoints.filter(cp => !cp.checked);
  const checkedCheckpoints = checkpoints.filter(cp => cp.checked);

  console.log(`Total: ${checkpoints.length} checkpoints`);
  console.log(`✅ passed: ${checkedCheckpoints.length}`);
  console.log(`⏳ pending: ${uncheckedCheckpoints.length}`);
  console.log('');

  if (uncheckedCheckpoints.length > 0) {
    console.log('Pending checkpoints:');
    uncheckedCheckpoints.forEach((cp, idx) => {
      console.log(`  ${idx + 1}. ${cp.text}`);
    });
    console.log('');
    console.log('⚠️  Please complete all checkpoints before verification');
    return;
  }

  // All checkpoints passed, 生成token
  const token = generateCheckpointToken();
  task.checkpointConfirmationToken = token;
  writeTaskMeta(task, cwd);

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('✅ All checkpoints verified!');
  console.log('');
  console.log('🔐 Checkpoint confirmation token generated:');
  console.log(`   ${token}`);
  console.log('');
  console.log('Please use the following command to complete task status update:');
  console.log(`   projmnt4claude task update ${taskId} --status resolved --token ${token}`);
  console.log('');
}

/**
 * 添加Subtasks
 */
export async function addSubtask(
  parentId: string,
  title: string,
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // VerificationParent task存在
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    console.error(`Error: Parent task ${parentId} does not exist`);
    process.exit(1);
  }

  // 导入工具函数
  const { generateSubtaskId, addSubtaskToParent } = await import('../utils/task');

  // 生成Subtasks ID
  const subtaskId = generateSubtaskId(parentId, cwd);

  // CreatedSubtasks元数据
  const subtask = createDefaultTaskMeta(subtaskId, title, parentTask.type, undefined, 'cli');
  subtask.parentId = parentId;
  subtask.priority = parentTask.priority;

  // 写入Subtasks
  writeTaskMeta(subtask, cwd);

  // Created checkpoint.md
  const taskDir = path.join(getTasksDir(cwd), subtaskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  fs.writeFileSync(checkpointPath, `# ${subtaskId} Checkpoints\n\n- [ ] Checkpoints1\n- [ ] Checkpoints2\n`, 'utf-8');

  // Related到Parent task
  addSubtaskToParent(parentId, subtaskId, cwd);

  console.log(`\n✅ Subtask created successfully!`);
  console.log(`   Subtasks ID: ${subtaskId}`);
  console.log(`   Parent task ID: ${parentId}`);
  console.log(`   Title: ${title}`);
  console.log(`   Priority: ${formatPriority(subtask.priority)}`);
}

/**
 * 同步Parent taskStatus到Subtasks
 * 用 in 将CompletedParent task的Status同步到所有Subtasks
 */
export async function syncChildren(
  parentTaskId: string,
  options: { targetStatus?: string; children?: string[] } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('❌ Error: Project not initialized');
    process.exit(1);
  }

  // 读取Parent task
  const parentTask = readTaskMeta(parentTaskId, cwd);
  if (!parentTask) {
    console.error(`❌ Error: Task ${parentTaskId} does not exist`);
    process.exit(1);
  }

  // 获取Subtask List
  const childrenToSync = options.children || parentTask.subtaskIds || [];

  if (childrenToSync.length === 0) {
    console.log(`\n⚠️  Task ${parentTaskId} has no subtasks, none need sync`);
    return;
  }

  // 确定目标Status
  const targetStatus = options.targetStatus || parentTask.status;

  console.log(`\n📋 Sync Subtask Status`);
  console.log(`   Parent Task: ${parentTaskId} (${parentTask.status})`);
  console.log(`   Target Status: ${targetStatus}`);
  console.log(`   Subtask Count: ${childrenToSync.length}`);
  console.log('');

  let syncedCount = 0;
  let skippedCount = 0;

  for (const childId of childrenToSync) {
    const childTask = readTaskMeta(childId, cwd);
    if (!childTask) {
      console.log(`   ⚠️  ${childId}: does not exist, skipped`);
      skippedCount++;
      continue;
    }

    const normalizedChildStatus = normalizeStatus(childTask.status);
    const normalizedTargetStatus = normalizeStatus(targetStatus);

    // 如果Subtasksalready is目标Status, skipped
    if (normalizedChildStatus === normalizedTargetStatus) {
      console.log(`   ⏭️  ${childId}: already is ${childTask.status}, skipped`);
      skippedCount++;
      continue;
    }

    // 如果SubtasksClosed/Abandoned, skipped（除非强制同步）
    if (normalizedChildStatus === 'closed' || normalizedChildStatus === 'abandoned') {
      console.log(`   ⏭️  ${childId}: Status is ${childTask.status}, skipped`);
      skippedCount++;
      continue;
    }

    // UpdatedSubtasksStatus
    const oldStatus = childTask.status;
    childTask.status = targetStatus as TaskStatus;

    // 添加History记录
    addHistoryEntry(
      childId,
      {
        action: `Status从 ${oldStatus} synced to ${targetStatus}`,
        field: 'status',
        oldValue: oldStatus,
        newValue: targetStatus,
        reason: `Parent task ${parentTaskId} Status同步`,
      },
      cwd
    );

    writeTaskMeta(childTask, cwd);
    console.log(`   ✅ ${childId}: ${oldStatus} → ${targetStatus}`);
    syncedCount++;
  }

  console.log('');
  console.log(`✅ Sync completed: ${syncedCount} subtasks updated, ${skippedCount} skipped`);
}

/**
 * UpdatedCheckpointsStatus
 * Command: task checkpoint <taskId> <checkpointId> <action> [options]
 */
export async function updateCheckpoint(
  taskId: string,
  checkpointId: string,
  action: 'complete' | 'fail' | 'note' | 'show',
  options: {
    result?: string;
    note?: string;
    yes?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // 确保CheckpointsSynced
  syncCheckpointsToMeta(taskId, cwd);

  switch (action) {
    case 'complete':
      updateCheckpointStatus(taskId, checkpointId, 'completed', {
        result: options.result,
        note: options.note,
      }, cwd);
      console.log(`✅ Checkpoints ${checkpointId} marked as completed`);
      if (options.result) {
        console.log(`   Verification result: ${options.result}`);
      }
      break;

    case 'fail':
      updateCheckpointStatus(taskId, checkpointId, 'failed', {
        note: options.note,
      }, cwd);
      console.log(`❌ Checkpoints ${checkpointId} marked as failed`);
      if (options.note) {
        console.log(`   Note: ${options.note}`);
      }
      break;

    case 'note':
      if (!options.note) {
        console.error('Error: Using note action requires --note parameter');
        process.exit(1);
      }
      // 保持当前Status, 只UpdatedNote
      const checkpoint = getCheckpointDetail(taskId, checkpointId, cwd);
      if (!checkpoint) {
        console.error(`Error: Checkpoints '${checkpointId}' does not exist`);
        process.exit(1);
      }
      updateCheckpointStatus(taskId, checkpointId, checkpoint.status, {
        note: options.note,
      }, cwd);
      console.log(`📝 Checkpoints ${checkpointId} note updated`);
      console.log(`   Note: ${options.note}`);
      break;

    case 'show':
      const cpDetail = getCheckpointDetail(taskId, checkpointId, cwd);
      if (!cpDetail) {
        console.error(`Error: Checkpoints '${checkpointId}' does not exist`);
        process.exit(1);
      }
      displayCheckpointDetail(cpDetail);
      break;

    default:
      console.error(`Error: Unknown operation '${action}'`);
      process.exit(1);
  }
}

/**
 * 列出Task的所有Checkpoints
 */
export async function listTaskCheckpoints(
  taskId: string,
  options: {
    json?: boolean;
    compact?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  const checkpoints = listCheckpoints(taskId, cwd);

  if (options.json) {
    console.log(JSON.stringify(checkpoints, null, 2));
    return;
  }

  if (checkpoints.length === 0) {
    console.log('No checkpoints');
    return;
  }

  const separator = options.compact ? '' : '━'.repeat(SEPARATOR_WIDTH);

  if (!options.compact) {
    console.log('');
    console.log(`📋 Checkpoint List (${checkpoints.length} )`);
    console.log(separator);
  }

  checkpoints.forEach((cp, index) => {
    const statusIcon = cp.status === 'completed' ? '✅' :
                       cp.status === 'failed' ? '❌' :
                       cp.status === 'skipped' ? '⏭️' : '⏳';

    if (options.compact) {
      console.log(`${statusIcon} ${cp.id}: ${cp.description}`);
    } else {
      console.log(`${index + 1}. ${statusIcon} ${cp.id}`);
      console.log(`   Description: ${cp.description}`);
      console.log(`   Status: ${cp.status}`);
      if (cp.note) {
        console.log(`   Note: ${cp.note}`);
      }
      if (cp.verification?.result) {
        console.log(`   Verification result: ${cp.verification.result}`);
      }
      console.log('');
    }
  });

  if (!options.compact) {
    console.log(separator);
  }
}

/**
 * 拆分Task为多subtasks
 * Command: task split <taskId> --into <count> or --titles "title1,title2,..."
 */
export async function splitTask(
  parentId: string,
  options: {
    into?: number;
    titles?: string;
    nonInteractive?: boolean;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // VerificationParent task存在
  const parentTask = readTaskMeta(parentId, cwd);
  if (!parentTask) {
    console.error(`Error: Parent task ${parentId} does not exist`);
    process.exit(1);
  }

  // 解析SubtasksTitle
  let subtaskTitles: string[] = [];

  if (options.titles) {
    // 从 --titles parameter解析
    subtaskTitles = options.titles.split(',').map(t => t.trim()).filter(t => t.length > 0);
  } else if (options.into && options.into > 0) {
    // 从 --into parameter生成默认Title
    const count = options.into;
    for (let i = 1; i <= count; i++) {
      subtaskTitles.push(`${parentTask.title} - 部分 ${i}`);
    }
  } else {
    // 交互模式: 询问用户
    if (options.nonInteractive) {
      console.error('Error: Non-interactive mode requires --into or --titles');
      process.exit(1);
    }

    const response = await prompts({
      type: 'select',
      name: 'mode',
      message: '选择拆分方式:',
      choices: [
        { title: 'By 数量拆分 (自动生成Title)', value: 'count' },
        { title: '手动输入SubtasksTitle', value: 'titles' },
      ],
    });

    if (!response.mode) {
      console.log('Cancelled');
      return;
    }

    if (response.mode === 'count') {
      const countResponse = await prompts({
        type: 'number',
        name: 'count',
        message: '拆分为几subtasks?',
        initial: 2,
        min: 2,
        max: 10,
      });

      if (!countResponse.count) {
        console.log('Cancelled');
        return;
      }

      for (let i = 1; i <= countResponse.count; i++) {
        subtaskTitles.push(`${parentTask.title} - 部分 ${i}`);
      }
    } else {
      const titlesResponse = await prompts({
        type: 'text',
        name: 'titles',
        message: '输入SubtasksTitle (用逗号分隔):',
        validate: (value) => {
          const titles = value.split(',').map((t: string) => t.trim()).filter((t: string) => t);
          return titles.length >= 2 ? true : '至少需要 2 subtasks';
        },
      });

      if (!titlesResponse.titles) {
        console.log('Cancelled');
        return;
      }

      subtaskTitles = titlesResponse.titles.split(',').map((t: string) => t.trim()).filter((t: string) => t);
    }
  }

  if (subtaskTitles.length < 2) {
    console.error('Error: At leastneed to split into 2 subtasks');
    process.exit(1);
  }

  console.log('');
  console.log(`📦 Preparing to split task: ${parentId}`);
  console.log(`   Title: ${parentTask.title}`);
  console.log(`   Subtask Count: ${subtaskTitles.length}`);
  console.log('');

  // 导入工具函数
  const { generateSubtaskId, addSubtaskToParent } = await import('../utils/task');

  const createdSubtaskIds: string[] = [];

  // CreatedSubtasks
  for (let i = 0; i < subtaskTitles.length; i++) {
    const title = subtaskTitles[i]!;

    // 生成Subtasks ID
    const subtaskId = generateSubtaskId(parentId, cwd);

    // CreatedSubtasks元数据
    const subtask = createDefaultTaskMeta(subtaskId, title, parentTask.type || 'feature', undefined, 'cli');
    subtask.parentId = parentId;
    subtask.priority = parentTask.priority;
    subtask.description = `从 ${parentId} 拆分的Subtasks`;

    // 写入Subtasks
    writeTaskMeta(subtask, cwd);

    // Created checkpoint.md
    const taskDir = path.join(getTasksDir(cwd), subtaskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');
    fs.writeFileSync(checkpointPath, `# ${subtaskId} Checkpoints\n\n- [ ] 完成Task\n`, 'utf-8');

    // Related到Parent task
    addSubtaskToParent(parentId, subtaskId, cwd);

    createdSubtaskIds.push(subtaskId);
    console.log(`   ✅ CreatedSubtasks: ${subtaskId} - ${title}`);
  }

  // 设置Subtasks之间的Dependencies关系（链式Dependencies）
  for (let i = 1; i < createdSubtaskIds.length; i++) {
    const currentId = createdSubtaskIds[i]!;
    const prevId = createdSubtaskIds[i - 1]!;

    const currentTask = readTaskMeta(currentId, cwd);
    if (currentTask) {
      currentTask.dependencies.push(prevId);
      writeTaskMeta(currentTask, cwd);
      console.log(`   🔗 Set dependency: ${currentId} Dependencies ${prevId}`);
    }
  }

  console.log('');
  console.log('✅ Task split completed!');
  console.log('');
  console.log('📋 Subtask List:');
  createdSubtaskIds.forEach((id, index) => {
    const depInfo = index > 0 ? ` (Dependencies: ${createdSubtaskIds[index - 1]})` : '';
    console.log(`   ${index + 1}. ${id}${depInfo}`);
  });
  console.log('');
  console.log('💡 Tip: Use the following command to view subtasks:');
  console.log(`   projmnt4claude task show ${parentId} --checkpoints`);
}

/**
 * 显示CheckpointsDetails
 */
function displayCheckpointDetail(checkpoint: CheckpointMetadata): void {
  console.log('');
  console.log(`📋 CheckpointsDetails: ${checkpoint.id}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`Description: ${checkpoint.description}`);
  console.log(`Status: ${checkpoint.status}`);
  console.log(`Created: ${checkpoint.createdAt}`);
  console.log(`Updated: ${checkpoint.updatedAt}`);

  if (checkpoint.note) {
    console.log('');
    console.log('📝 Note:');
    console.log(`   ${checkpoint.note}`);
  }

  if (checkpoint.verification) {
    console.log('');
    console.log('🔍 Verification Info:');
    console.log(`   Method: ${checkpoint.verification.method}`);
    if (checkpoint.verification.commands && checkpoint.verification.commands.length > 0) {
      console.log(`   Command: ${checkpoint.verification.commands.join(', ')}`);
    }
    if (checkpoint.verification.expected) {
      console.log(`   Expected Result: ${checkpoint.verification.expected}`);
    }
    if (checkpoint.verification.result) {
      console.log(`   Actual Result: ${checkpoint.verification.result}`);
    }
    if (checkpoint.verification.verifiedBy) {
      console.log(`   Verified By: ${checkpoint.verification.verifiedBy}`);
    }
    if (checkpoint.verification.verifiedAt) {
      console.log(`   Verified At: ${checkpoint.verification.verifiedAt}`);
    }
  }
  console.log('');
}

/**
 * 搜索Task
 * Command: task search <keyword>
 */
export function searchTasks(
  keyword: string,
  options: {
    status?: string;
    priority?: string;
    json?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const allTasks = getAllTasks(cwd);
  const lowerKeyword = keyword.toLowerCase();

  // 过滤匹配 tasks
  const matchedTasks = allTasks.filter(task => {
    // Status过滤
    if (options.status && task.status !== options.status) {
      return false;
    }
    // Priority过滤
    if (options.priority && task.priority !== options.priority) {
      return false;
    }
    // 关键词匹配
    const titleMatch = task.title.toLowerCase().includes(lowerKeyword);
    const descMatch = task.description?.toLowerCase().includes(lowerKeyword) || false;
    const idMatch = task.id.toLowerCase().includes(lowerKeyword);
    return titleMatch || descMatch || idMatch;
  });

  if (options.json) {
    console.log(JSON.stringify(matchedTasks, null, 2));
    return;
  }

  if (matchedTasks.length === 0) {
    console.log(`No matches found for "${keyword}"  tasks`);
    return;
  }

  console.log('');
  console.log(`🔍 Search Results: "${keyword}" (${matchedTasks.length} matches)`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  matchedTasks.forEach((task, index) => {
    const statusIcon = task.status === 'resolved' || task.status === 'closed' ? '✅' :
                       task.status === 'in_progress' ? '🔄' : '⏳';
    console.log(`${index + 1}. ${statusIcon} ${task.id}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Status: ${task.status} | Priority: ${task.priority}`);
    console.log('');
  });
}

/**
 * 统计Task数量
 * Command: task count [options]
 * 支持By Status, Priority, Type分组统计
 */
export function countTasks(
  options: {
    status?: string;
    priority?: string;
    type?: string;
    groupBy?: 'status' | 'priority' | 'type' | 'role';
    json?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  let tasks = getAllTasks(cwd);

  // 应用过滤
  if (options.status) {
    tasks = tasks.filter(t => t.status === options.status);
  }
  if (options.priority) {
    tasks = tasks.filter(t => t.priority === options.priority);
  }
  if (options.type) {
    tasks = tasks.filter(t => t.type === options.type);
  }

  // Debug: log options
  if (process.env.DEBUG_COUNT) {
    console.error('DEBUG options:', JSON.stringify(options));
  }

  // 分组统计
  if (options.groupBy) {
    const groups = new Map<string, number>();

    for (const task of tasks) {
      let key: string;
      switch (options.groupBy) {
        case 'status':
          key = task.status || 'open';
          break;
        case 'priority':
          key = task.priority || 'P2';
          break;
        case 'type':
          key = task.type || 'feature';
          break;
        case 'role':
          key = task.recommendedRole || '未分配';
          break;
        default:
          key = '其他';
      }

      groups.set(key, (groups.get(key) || 0) + 1);
    }

    if (options.json) {
      const result = Object.fromEntries(groups);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // 格式化输出
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`📊 Task Statistics (By ${options.groupBy === 'status' ? 'status' : options.groupBy === 'priority' ? 'priority' : options.groupBy === 'type' ? 'type' : 'role'}group)`);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    // 定义排序顺序
    const statusOrder = ['open', 'in_progress', 'wait_evaluation', 'resolved', 'closed', 'abandoned', 'failed'];
    const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];

    let sortedKeys: string[];
    if (options.groupBy === 'status') {
      sortedKeys = [...groups.keys()].sort((a, b) => {
        const idxA = statusOrder.indexOf(a);
        const idxB = statusOrder.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
    } else if (options.groupBy === 'priority') {
      sortedKeys = [...groups.keys()].sort((a, b) => {
        const idxA = priorityOrder.indexOf(a);
        const idxB = priorityOrder.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
    } else {
      sortedKeys = [...groups.keys()].sort();
    }

    for (const key of sortedKeys) {
      const count = groups.get(key)!;
      let label: string;

      switch (options.groupBy) {
        case 'status':
          label = formatStatus(key);
          break;
        case 'priority':
          label = formatPriority(key);
          break;
        case 'type':
          label = `📁 ${key}`;
          break;
        case 'role':
          label = `👤 ${key}`;
          break;
        default:
          label = key;
      }

      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${label.padEnd(20)} ${bar} ${count}`);
    }

    console.log('');
    console.log(`Total: ${tasks.length} tasks`);
    console.log('');
    return;
  }

  // 总体统计
  const statusCounts = new Map<TaskStatus, number>();
  const priorityCounts = new Map<TaskPriority, number>();
  const typeCounts = new Map<string, number>();

  for (const task of tasks) {
    statusCounts.set(task.status, (statusCounts.get(task.status) || 0) + 1);
    priorityCounts.set(task.priority, (priorityCounts.get(task.priority) || 0) + 1);
    if (task.type) {
      typeCounts.set(task.type, (typeCounts.get(task.type) || 0) + 1);
    }
  }

  if (options.json) {
    const result = {
      total: tasks.length,
      byStatus: Object.fromEntries(statusCounts),
      byPriority: Object.fromEntries(priorityCounts),
      byType: Object.fromEntries(typeCounts),
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 格式化输出
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 Task Statistics');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // By Status统计
  console.log('📋 By Status:');
  const statusOrder = ['open', 'in_progress', 'wait_evaluation', 'resolved', 'closed', 'abandoned', 'failed'];
  for (const status of statusOrder) {
    const count = statusCounts.get(status as TaskStatus) || 0;
    if (count > 0 || status === 'open' || status === 'in_progress' || status === 'resolved') {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${formatStatus(status).padEnd(16)} ${bar} ${count}`);
    }
  }

  console.log('');

  // By Priority统计
  console.log('🎯 By Priority:');
  const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];
  for (const priority of priorityOrder) {
    const count = priorityCounts.get(priority as TaskPriority) || 0;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${formatPriority(priority).padEnd(16)} ${bar} ${count}`);
    }
  }

  console.log('');

  // By Type统计
  if (typeCounts.size > 0) {
    console.log('📁 By Type:');
    for (const [type, count] of typeCounts) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${`📁 ${type}`.padEnd(16)} ${bar} ${count}`);
    }
    console.log('');
  }

  // 总计
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📌 Total: ${tasks.length} tasks`);
  console.log('');

  // Completion rate
  const completed = (statusCounts.get('resolved') || 0) + (statusCounts.get('closed') || 0);
  const inProgress = statusCounts.get('in_progress') || 0;
  const pending = statusCounts.get('open') || 0;

  if (tasks.length > 0) {
    const completionRate = ((completed / tasks.length) * 100).toFixed(1);
    console.log(`📈 Completion rate: ${completionRate}% (${completed}/${tasks.length})`);
    console.log(`🔄 In Progress: ${inProgress} | ⏳ Pending: ${pending}`);
    console.log('');
  }
}

/**
 * 显示项目StatusSummary + 主动operation tips
 * Command: task status
 *
 * 在统计输出末尾追加Tip模块, 检测:
 * - wait_evaluation Task（待Verification确认）
 * - pending 人工VerificationCheckpoints
 * - in_progress 中断Task（pipeline 中间Status残留）
 */
export function showStatus(
  options: {
    json?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // 先输出标准统计
  countTasks({}, cwd);

  // 主动Tip模块
  const allTasks = getAllTasks(cwd);
  const hints: string[] = [];

  // 1. 检测 wait_evaluation Task
  const waitEvaluationTasks = allTasks.filter(t => t.status === 'wait_evaluation');
  if (waitEvaluationTasks.length > 0) {
    hints.push(`⏳ ${waitEvaluationTasks.length} tasks处 in  wait_evaluation Status, 等待Verification:`);
    for (const t of waitEvaluationTasks.slice(0, 5)) {
      hints.push(`   - ${t.id}: ${t.title.substring(0, 40)}`);
    }
    if (waitEvaluationTasks.length > 5) {
      hints.push(`   ... plus ${waitEvaluationTasks.length - 5} `);
    }
    hints.push('   💡 运行 task validate <id> VerificationTask');
  }

  // 2. 检测 in_progress 中断Task（pipeline 中间Status残留）
  const intermediateStatuses = ['wait_review', 'wait_qa'];
  const interruptedTasks = allTasks.filter(t => intermediateStatuses.includes(t.status));
  if (interruptedTasks.length > 0) {
    hints.push('');
    hints.push(`⚠️  ${interruptedTasks.length} tasks处 in  pipeline 中间Status（可能已中断）:`);
    for (const t of interruptedTasks.slice(0, 5)) {
      hints.push(`   - ${t.id}: ${t.status} - ${t.title.substring(0, 40)}`);
    }
    if (interruptedTasks.length > 5) {
      hints.push(`   ... plus ${interruptedTasks.length - 5} `);
    }
    hints.push('   💡 运行 task update <id> --status open 重置, or继续 pipeline');
  }

  // 输出Tip
  if (hints.length > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('💡 operation tips:');
    console.log('');
    for (const hint of hints) {
      console.log(hint);
    }
    console.log('');
  }
}

/**
 * Batch Update TasksStatus
 * Command: task update --status <status> --all
 *
 * 日志记录: 所有批量Updated操作都会被记录到 .projmnt4claude/logs/batch-update-YYYY-MM-DD.log
 */
export async function batchUpdateTasks(
  options: {
    status?: string;
    priority?: string;
    all?: boolean;
    yes?: boolean;
    /** 调用来源标识 (CLI/IDE/Hook等) */
    source?: string;
    /** Task ID列表（逗号分隔或多times指定） */
    tasks?: string[];
    /** 从文件读取Task列表 */
    taskFile?: string;
    /** 修改Description, 记录到 transitionNotes */
    changeNote?: string;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  // 记录操作开始时间
  const operationStartTime = new Date().toISOString();
  const commandArgs = process.argv.slice(2); // 获取Command行参数

  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  if (!options.status && !options.priority) {
    console.error('Error: Batch update requires --status or --priority');
    process.exit(1);
  }

  // 强制要求 --change-note parameter
  if (!options.changeNote || options.changeNote.trim().length < 10) {
    console.error('Error: Must provide --change-note parameter with change description/reason, at least 10 characters');
    console.error('Example: --change-note "Fixed XX issue, passed testing"');
    process.exit(1);
  }

  const allTasks = getAllTasks(cwd);

  // 解析Task ID列表（从 --tasks or --task-file）
  let specifiedTaskIds: string[] = [];

  // 从 --task-file 读取Task列表
  if (options.taskFile) {
    const taskFilePath = path.resolve(cwd, options.taskFile);
    if (!fs.existsSync(taskFilePath)) {
      console.error(`Error: Task filedoes not exist: ${taskFilePath}`);
      process.exit(1);
    }
    try {
      const fileContent = fs.readFileSync(taskFilePath, 'utf-8');
      // 支持每行一Task ID, or逗号分隔
      specifiedTaskIds = fileContent
        .split(/[\n,]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
    } catch (error: any) {
      console.error(`Error: Cannot readTask file: ${error.message}`);
      process.exit(1);
    }
  }

  // 从 --tasks parameter解析Task列表（支持多times指定或逗号分隔）
  if (options.tasks && options.tasks.length > 0) {
    // 展平并解析逗号分隔 tasks ID
    specifiedTaskIds = options.tasks
      .flatMap(t => t.split(','))
      .map(id => id.trim())
      .filter(id => id.length > 0);
  }

  // 过滤出需要Updated tasks
  let tasksToUpdate: typeof allTasks;
  let filteredTasks: typeof allTasks;

  if (specifiedTaskIds.length > 0) {
    // 指定了Task ID列表, 只Updated这些Task
    const taskIdSet = new Set(specifiedTaskIds);
    tasksToUpdate = allTasks.filter(t => taskIdSet.has(t.id));

    // 检查是否有does not exist tasks ID
    const foundIds = new Set(tasksToUpdate.map(t => t.id));
    const notFoundIds = specifiedTaskIds.filter(id => !foundIds.has(id));
    if (notFoundIds.length > 0) {
      console.error(`Error: The following tasksdoes not exist: ${notFoundIds.join(', ')}`);
      process.exit(1);
    }

    // 记录被skipped的ResolvedTask（用 in 审计Tip）
    filteredTasks = tasksToUpdate.filter(t =>
      t.status === 'resolved' || t.status === 'closed' || t.status === 'abandoned' || t.status === 'failed'
    );

    // 当指定Task列表时, 默认只Updated非终态Task, 除非Use  --all
    if (!options.all) {
      tasksToUpdate = tasksToUpdate.filter(t =>
        t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'abandoned' && t.status !== 'failed'
      );
    }
  } else {
    // Not specifiedTask列表, Use 原有逻辑
    tasksToUpdate = options.all
      ? allTasks
      : allTasks.filter(t => t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'abandoned' && t.status !== 'failed');

    filteredTasks = options.all
      ? []
      : allTasks.filter(t => t.status === 'resolved' || t.status === 'closed' || t.status === 'abandoned' || t.status === 'failed');
  }

  if (tasksToUpdate.length === 0) {
    console.log('No tasks to update');
    return;
  }

  console.log('');
  console.log(`📦 Batch Update Tasks`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`   Target task count: ${tasksToUpdate.length}`);
  if (options.status) {
    console.log(`   New status: ${options.status}`);
  }
  if (options.priority) {
    console.log(`   New priority: ${options.priority}`);
  }
  console.log('');

  // 检测高风险操作: 从 resolved/closed 变为 open
  const terminalStatuses = ['resolved', 'closed', 'abandoned'];
  const reopeningTasks = tasksToUpdate.filter(t =>
    options.status === 'open' && terminalStatuses.includes(t.status)
  );

  // 检测是否Use 了 --all 选项（这会导致包含Resolved tasks）
  const isUsingAllFlag = options.all === true;
  const highRiskCount = reopeningTasks.length;

  if (highRiskCount > 0) {
    console.log('');
    console.log('⚠️ High-Risk Operation Warning');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`   You are reopening ${highRiskCount} completed tasks being reopened:`);
    console.log('');
    for (const task of reopeningTasks.slice(0, 5)) {
      console.log(`     • ${task.id}: ${task.status} → open (${task.title.slice(0, 40)}${task.title.length > 40 ? '...' : ''})`);
    }
    if (reopeningTasks.length > 5) {
      console.log(`     ... plus ${reopeningTasks.length - 5} tasks`);
    }
    console.log('');

    // 特别警告 --all 选项的Use 
    if (isUsingAllFlag) {
      console.log('🚨 Using --all option');
      console.log('   This will include all resolved/closed tasks');
      console.log('');
    }

    console.log('   This typically happens when:');
    console.log('   • Accidental operation: skipped confirmation with --yes');
    console.log('   • Automation scripts: IDE plugin or hooks triggered unexpectedly');
    console.log('   • Keyboard shortcut conflicts: Terminal shortcut mis-triggered');
    console.log('   • Used --all option without realizing it includes resolved tasks');
    console.log('');
    console.log('   Operation will be logged to batch-update log for audit');
    console.log('');

    // 如果有大量Task被Reopen, 额外警告
    if (highRiskCount >= 5) {
      console.log('🚨 Critical Warning: Large number of tasks will be reopened!');
      console.log('   Please confirm this is your intended operation.');
      console.log('');
    }

    // 对 --all 选项或大量Reopen操作, 强制要求额外确认（即使Use 了 --yes）
    if ((isUsingAllFlag || highRiskCount >= 5) && options.yes) {
      console.log('⚠️  Despite using --yes, this high-risk operation requires additional confirmation:');
      console.log('');

      const extraConfirm = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: `确认要将 ${highRiskCount} completed tasks being reopened吗？`,
        initial: false,
      });

      if (!extraConfirm.confirmed) {
        // 记录取消操作
        writeBatchUpdateLog({
          commandArgs,
          options: {
            status: options.status,
            priority: options.priority,
            all: options.all,
            yes: options.yes,
          },
          tasks: [],
          summary: {
            totalCount: tasksToUpdate.length,
            updatedCount: 0,
            filteredCount: filteredTasks.length,
          },
        }, cwd);
        console.log('Cancelled');
        return;
      }
    }
  }

  // 显示即将Updated tasks列表
  console.log('   Tasks to be updated:');
  for (const task of tasksToUpdate) {
    const changeInfo: string[] = [];
    if (options.status && task.status !== options.status) {
      changeInfo.push(`${task.status} → ${options.status}`);
    }
    if (options.priority && task.priority !== options.priority) {
      changeInfo.push(`priority: ${task.priority} → ${options.priority}`);
    }
    console.log(`     • ${task.id}: ${changeInfo.join(', ') || '(no changes)'}`);
  }
  console.log('');

  // 非交互模式或用户确认
  if (!options.yes) {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `确认Updated ${tasksToUpdate.length} tasks?`,
      initial: false,
    });

    if (!response.confirm) {
      // 记录取消操作
      writeBatchUpdateLog({
        commandArgs,
        options: {
          status: options.status,
          priority: options.priority,
          all: options.all,
          yes: options.yes,
        },
        tasks: [],
        summary: {
          totalCount: tasksToUpdate.length,
          updatedCount: 0,
          filteredCount: filteredTasks.length,
        },
      }, cwd);
      console.log('Cancelled');
      return;
    }
  }

  // 准备日志记录 tasksChange列表
  const taskChanges: Array<{
    id: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    oldPriority?: string;
    newPriority?: string;
  }> = [];

  // 执行批量Updated
  let updatedCount = 0;
  for (const task of tasksToUpdate) {
    const oldStatus = task.status;
    const oldPriority = task.priority;
    let updated = false;

    if (options.status) {
      const newStatus = options.status as TaskStatus;

      // 从 resolved/closed 变为 open 时, 增加 reopenCount
      if (newStatus === 'open' && (oldStatus === 'resolved' || oldStatus === 'closed')) {
        task.reopenCount = (task.reopenCount || 0) + 1;
      }

      // 添加 transitionNote（Use 用户提供的 changeNote）
      if (!task.transitionNotes) {
        task.transitionNotes = [];
      }
      task.transitionNotes.push({
        timestamp: new Date().toISOString(),
        fromStatus: oldStatus,
        toStatus: newStatus,
        note: options.changeNote!,
        author: process.env.USER || 'batch-update',
      });

      // 添加History记录
      if (!task.history) {
        task.history = [];
      }
      task.history.push({
        timestamp: new Date().toISOString(),
        action: `批量Updated: ${oldStatus} → ${newStatus}`,
        field: 'status',
        oldValue: oldStatus,
        newValue: newStatus,
        reason: options.changeNote!,
      });

      task.status = newStatus;
      updated = true;
    }
    if (options.priority) {
      const newPriority = options.priority as TaskPriority;

      // 记录PriorityChange History和 transitionNote
      if (oldPriority !== newPriority) {
        if (!task.history) {
          task.history = [];
        }
        task.history.push({
          timestamp: new Date().toISOString(),
          action: `批量Updated: Priority ${oldPriority} → ${newPriority}`,
          field: 'priority',
          oldValue: oldPriority,
          newValue: newPriority,
          reason: options.changeNote!,
        });

        // 添加 transitionNote（Use 用户提供的 changeNote）
        if (!task.transitionNotes) {
          task.transitionNotes = [];
        }
        task.transitionNotes.push({
          timestamp: new Date().toISOString(),
          fromStatus: task.status,
          toStatus: task.status,
          note: `PriorityChange: ${oldPriority} → ${newPriority} | ${options.changeNote!}`,
          author: process.env.USER || 'batch-update',
        });
      }

      task.priority = newPriority;
      updated = true;
    }

    if (updated) {
      // Updated updatedAt 时间戳
      task.updatedAt = new Date().toISOString();

      writeTaskMeta(task, cwd);
      updatedCount++;
      console.log(`   ✅ ${task.id}`);

      // 记录Change
      taskChanges.push({
        id: task.id,
        title: task.title || '(NoneTitle)',
        oldStatus,
        newStatus: task.status,
        oldPriority,
        newPriority: task.priority,
      });
    }
  }

  // 写入操作日志
  writeBatchUpdateLog({
    commandArgs,
    options: {
      status: options.status,
      priority: options.priority,
      all: options.all,
      yes: options.yes,
      changeNote: options.changeNote,
    },
    tasks: taskChanges,
    summary: {
      totalCount: tasksToUpdate.length,
      updatedCount,
      filteredCount: filteredTasks.length,
    },
  }, cwd);

  console.log('');
  console.log(`✅ Batch update completed: ${updatedCount} tasksupdated`);

  // 显示日志记录信息
  console.log('');
  console.log(`📝 Operation logged to: .projmnt4claude/logs/batch-update-${operationStartTime.split('T')[0]}.log`);
}

/**
 * 显示 batch-update 操作日志
 */
export function showBatchUpdateLogs(
  options: {
    date?: string;
    taskId?: string;
    source?: string;
    verbose?: boolean;
    summary?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (options.summary) {
    console.log(showLogSummary(cwd));
    return;
  }

  const entries = queryBatchUpdateLogs({
    taskId: options.taskId,
    source: options.source as any,
  }, cwd);

  console.log(formatLogList(entries, options.verbose));
}

/**
 * Checkpoint Template映射
 * CP-FEAT-008-02: 基 in TaskType生成Checkpoint Template
 */
const CHECKPOINT_TEMPLATES: Record<string, string[]> = {
  bug: [
    '复现问题',
    '定位根本Reason',
    '实现修复',
    '编写测试用例Verification修复',
    'Verification不影响其他功能',
    'Updated相关文档',
  ],
  feature: [
    '理解需求和设计',
    '实现核心功能',
    '编写单元测试',
    '编写集成测试',
    'Updated文档',
    '代码审查',
  ],
  research: [
    '明确研究目标',
    '收集相关信息',
    '分析可行性',
    '记录发现和建议',
    '总结结论',
  ],
  docs: [
    '确定文档范围和受众',
    '收集必要信息',
    '编写文档内容',
    '审阅和校对',
    '发布文档',
  ],
  refactor: [
    '分析现有代码结构',
    '设计重构方案',
    '实现重构',
    '确保测试通过',
    'Verification功能不变',
    'Updated相关文档',
  ],
  test: [
    '确定测试范围',
    '设计测试用例',
    '实现测试代码',
    '运行测试Verification',
    '修复失败的测试',
    'Updated测试文档',
  ],
};

/**
 * 生成Checkpoint Template
 * Command: task checkpoint template <taskId> [--type <type>]
 */
export function generateCheckpointTemplate(
  taskId: string,
  options: {
    type?: string;
    apply?: boolean;
  } = {},
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    console.error(`Error: Task '${taskId}' does not exist`);
    process.exit(1);
  }

  // 确定TaskType
  const taskType = options.type || task.type || 'feature';

  // 获取模板
  const template = CHECKPOINT_TEMPLATES[taskType] || CHECKPOINT_TEMPLATES.feature;

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📋 Checkpoint Template: ${taskId}`);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(`TaskType: ${taskType}`);
  console.log('');
  console.log('Recommended checkpoints:');
  console.log('');

  template!.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item}`);
  });

  console.log('');

  if (options.apply) {
    // 应用模板到Task
    const taskDir = path.join(getTasksDir(cwd), taskId);
    const checkpointPath = path.join(taskDir, 'checkpoint.md');

    let content = `# ${taskId} Checkpoints\n\n`;
    template!.forEach(item => {
      content += `- [ ] ${item}\n`;
    });
    content += '\n';

    fs.writeFileSync(checkpointPath, content, 'utf-8');
    console.log('✅ Checkpoint Templateapplied to task');
  } else {
    console.log('💡 Use  --apply parameterapply template to task');
  }

  console.log('');
}

/**
 * 重命名Task CLI Command
 * Usage: task rename <oldTaskId> <newTaskId>
 */
export function renameTaskCommand(
  oldTaskId: string,
  newTaskId: string,
  cwd: string = process.cwd()
): void {
  if (!isInitialized(cwd)) {
    console.error('Error: Project not initialized. Please run `projmnt4claude setup` first');
    process.exit(1);
  }

  // Verification参数
  if (!oldTaskId || !newTaskId) {
    console.error('Error: rename requires old task ID and new task ID');
    console.error('');
    console.error('Usage: task rename <oldTaskId> <newTaskId>');
    console.error('Example: task rename TASK-001 TASK-feature-new-name');
    process.exit(1);
  }

  // VerificationNew ID 格式
  if (!isValidTaskId(newTaskId)) {
    console.error(`Error: Invalid task ID format '${newTaskId}'`);
    console.error('Task ID must start with TASK-, followed by letters, numbers, hyphens or underscores');
    process.exit(1);
  }

  const result = renameTask(oldTaskId, newTaskId, cwd);

  if (result.success) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('✅ Task renamed successfully');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');
    console.log(`  Old ID: ${result.oldId}`);
    console.log(`  New ID: ${result.newId}`);
    console.log('');
    console.log('💡 Tip: References in other tasks auto-updated');
    console.log('');
  } else {
    console.error(`❌ Rename failed: ${result.error}`);
    process.exit(1);
  }
}

