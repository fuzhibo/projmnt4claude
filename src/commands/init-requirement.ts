import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getTasksDir } from '../utils/path';
import {
  generateNewTaskId,
  writeTaskMeta,
  readTaskMeta,
  getAllTasks,
  addSubtaskToParent,
} from '../utils/task';
import { extractAffectedFiles, extractFilePaths, checkQualityGate, validateBasicFields, validateFilesExist, type QualityGateConfig, DEFAULT_QUALITY_GATE_CONFIG } from '../utils/quality-gate';
import { hasValidCheckpoints, displayCheckpointCreationWarning, createTask, type CreateTaskOptions } from './task';
import { syncCheckpointsToMeta, filterLowQualityCheckpoints, convertParsedCheckpointsToMetadata, updateCheckpointMdFromArray } from '../utils/checkpoint';
import { inferDependencies as inferDependenciesUnified, type InferredDependency } from '../utils/dependency-engine';
import { DependencyGraph, validateNewTaskDeps } from '../utils/dependency-graph';
import type { TaskMeta, TaskPriority, TaskStatus, TaskType } from '../types/task';
import type { RequirementDecomposition, DecomposedTaskItem, DecomposedItem } from '../types/decomposition';
import { createDefaultTaskMeta, inferTaskType, validateCheckpointVerification } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { createLogger, type InstrumentationRecord, type AICostSummary } from '../utils/logger';
import { withAIEnhancement } from '../utils/ai-helpers';
import { AIMetadataAssistant, type EnhancedRequirement, classifyFileToLayer, groupFilesByLayer, sortFilesByLayer, type ArchitectureLayer, LAYER_DEFINITIONS } from '../utils/ai-metadata';
import { decomposeRequirement, shouldDecompose, formatDecomposition } from '../utils/requirement-decomposer';

/**
 * 复杂度评估结果
 */
export interface ComplexityAssessment {
  /** 复杂度等级 */
  level: 'low' | 'medium' | 'high';
  /** 评估分数 (0-100) */
  score: number;
  /** 检测到的涉及文件数 */
  fileCount: number;
  /** 检测到的独立工作项数 */
  workItemCount: number;
  /** 预估耗时（分钟） */
  estimatedMinutes: number;
  /** 拆分建议 */
  splitSuggestions: SplitSuggestion[];
  /** 评估信号 */
  signals: ComplexitySignal[];
}

/**
 * 复杂度评估信号
 */
interface ComplexitySignal {
  type: 'file_count' | 'work_items' | 'cross_module' | 'checkpoint_count' | 'description_length' | 'action_verb_density';
  weight: number;
  description: string;
}

/**
 * 拆分建议
 */
export interface SplitSuggestion {
  /** 子任务标题 */
  title: string;
  /** 子任务描述 */
  description: string;
  /** 涉及文件 */
  files: string[];
  /** 预估耗时（分钟） */
  estimatedMinutes: number;
  /** 依赖的子任务索引 (0-based, -1 表示无依赖) */
  dependsOn: number;
}
import {
  generateStructuredDescription,
  extractStructuredInfo,
  inferCheckpointsFromDescription,
  inferRelatedFiles,
  type DescriptionTemplateType,
  type StructuredDescription,
} from '../utils/description-template';

/**
 * 需求分析结果接口
 */
interface RequirementAnalysis {
  title: string;
  description: string;
  priority: TaskPriority;
  recommendedRole: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  suggestedCheckpoints: string[];
  potentialDependencies: string[];
}

/**
 * 初始化需求选项
 */
export interface InitRequirementOptions {
  nonInteractive?: boolean;  // 非交互模式：跳过所有确认
  noPlan?: boolean;          // 不询问添加到计划
  skipValidation?: boolean;  // 跳过 checkpoints 质量校验
  template?: DescriptionTemplateType;  // 描述模板类型：simple | detailed
  autoSplit?: boolean;       // 自动拆分复杂任务为子任务
  noAI?: boolean;            // 禁用 AI 增强，仅使用规则引擎
  /** 质量门禁: 低于此阈值时阻止创建 (0-100) */
  requireQuality?: number;
  /** 自动分解多问题需求/报告 */
  decompose?: boolean;
  /** 从文件读取需求 */
  file?: string;
}

/**
 * 混合分析结果（规则引擎 + AI 增强）
 */
interface HybridAnalysisResult extends RequirementAnalysis {
  /** AI 增强的字段列表 */
  aiEnhancedFields: string[];
  /** AI 是否被使用 */
  aiUsed: boolean;
}

/**
 * 合并规则引擎和 AI 增强结果
 *
 * 合并策略:
 * - title: AI 标题 ≤50 字符且 ≥10 字符用 AI，否则用规则
 * - priority: AI 提供合理值时用 AI
 * - recommendedRole: AI 提供合理值时用 AI
 * - checkpoints: AI + 规则并集去重（AI 检查点通常质量更高）
 * - dependencies: AI + 规则并集去重
 * - description: AI 优先，否则原始描述
 * - estimatedComplexity: 始终用规则引擎结果
 */
function mergeAnalysisResults(
  ruleBased: RequirementAnalysis,
  aiEnhanced: EnhancedRequirement,
): HybridAnalysisResult {
  const aiEnhancedFields: string[] = [];

  // title: AI 标题 ≤50 字符且 ≥10 字符用 AI，否则用规则
  let title = ruleBased.title;
  if (aiEnhanced.title && aiEnhanced.title.length <= 50 && aiEnhanced.title.length >= 10) {
    title = aiEnhanced.title;
    aiEnhancedFields.push('title');
  }

  // priority: AI 提供合理值时用 AI
  let priority = ruleBased.priority;
  if (aiEnhanced.priority && ['P0', 'P1', 'P2', 'P3'].includes(aiEnhanced.priority)) {
    priority = aiEnhanced.priority;
    aiEnhancedFields.push('priority');
  }

  // recommendedRole: AI 提供合理值时用 AI
  let recommendedRole = ruleBased.recommendedRole;
  if (aiEnhanced.recommendedRole) {
    recommendedRole = aiEnhanced.recommendedRole;
    aiEnhancedFields.push('recommendedRole');
  }

  // checkpoints: AI + 规则并集去重（AI 检查点通常质量更高，排在前面）
  let suggestedCheckpoints = ruleBased.suggestedCheckpoints;
  if (aiEnhanced.checkpoints && aiEnhanced.checkpoints.length > 0) {
    const combined = [...aiEnhanced.checkpoints, ...ruleBased.suggestedCheckpoints];
    suggestedCheckpoints = [...new Set(combined)];
    aiEnhancedFields.push('checkpoints');
  }

  // dependencies: AI + 规则并集去重
  let potentialDependencies = ruleBased.potentialDependencies;
  if (aiEnhanced.dependencies && aiEnhanced.dependencies.length > 0) {
    const combined = [...aiEnhanced.dependencies, ...ruleBased.potentialDependencies];
    potentialDependencies = [...new Set(combined)];
    aiEnhancedFields.push('dependencies');
  }

  // description: AI 优先
  let description = ruleBased.description;
  if (aiEnhanced.description) {
    description = aiEnhanced.description;
    aiEnhancedFields.push('description');
  }

  return {
    title,
    description,
    priority,
    recommendedRole,
    estimatedComplexity: ruleBased.estimatedComplexity, // 始终用规则引擎
    suggestedCheckpoints,
    potentialDependencies,
    aiEnhancedFields,
    aiUsed: true,
  };
}

/**
 * 从自然语言需求创建任务
 */
export async function initRequirement(
  description: string,
  cwd: string = process.cwd(),
  options: InitRequirementOptions = {}
): Promise<void> {
  const { nonInteractive = false, noPlan = false, skipValidation = false, template = 'simple', autoSplit = false, noAI = false, requireQuality, decompose: shouldDecomposeOption = true } = options;

  // CP-2: 模块日志 + 埋点初始化
  const logger = createLogger('init-requirement', cwd);
  const startTime = Date.now();
  const inputDescLength = description.length;
  let userEditCount = 0;

  // Input validation
  const trimmedDesc = description?.trim() ?? '';
  if (trimmedDesc.length === 0) {
    console.error('');
    console.error('❌ Requirement description cannot be empty');
    console.error('');
    console.error('  Please provide a requirement description, for example:');
    console.error('    projmnt4claude init-requirement "Fix login button styling issue"');
    console.error('    projmnt4claude init-requirement "Add user registration feature with form validation"');
    console.error('');
    process.exit(1);
  }
  if (trimmedDesc.length < 2) {
    console.error('');
    console.error('❌ Requirement description too short');
    console.error('');
    console.error(`  Current description: "${trimmedDesc}" (${trimmedDesc.length} characters)`);
    console.error('  Please provide a more detailed requirement description (at least 2 characters).');
    console.error('');
    process.exit(1);
  }

  if (!isInitialized(cwd)) {
    console.error('');
    console.error('❌ Project not initialized');
    console.error('');
    console.error('  Please run the following command to initialize the project environment:');
    console.error('    projmnt4claude setup');
    console.error('');
    console.error('  After initialization, you can use init-requirement to create tasks.');
    console.error('');
    process.exit(1);
  }

  // Stage 1: Requirement/issue decomposition (new)
  if (shouldDecomposeOption && shouldDecompose(description)) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔍 Decomposable content detected, analyzing requirement...');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const decomposition = await decomposeRequirement(description, {
      cwd,
      useAI: !noAI,
      minItems: 2,
      maxItems: 10,
    });

    if (decomposition.decomposable && decomposition.items.length >= 2) {
      console.log(formatDecomposition(decomposition));
      console.log('');

      // Confirm decomposition creation (auto-confirm in non-interactive mode)
      let confirmDecompose = true;
      if (!nonInteractive) {
        const result = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: `Decompose requirement into ${decomposition.items.length} independent tasks?`,
          initial: true,
        });
        if (result === undefined) {
          console.log('');
          console.log('ℹ️  Task creation cancelled.');
          console.log('');
          return;
        }
        confirmDecompose = result.confirm;
      }

      if (confirmDecompose) {
        // 使用批量创建函数
        await initRequirementBatch(decomposition.items, cwd, options);
        return;
      }
    }

    // Decomposition failed or user chose not to decompose, continue with single task flow
    console.log('  Skipping decomposition, continuing with single task creation...');
    console.log('');
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 Analyzing requirement...');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 步骤 1: 规则引擎分析（始终执行）
  const ruleAnalysis = analyzeRequirement(description, cwd);

  // 步骤 2: AI 增强（默认启用，--no-ai 时跳过）
  let analysis: HybridAnalysisResult = {
    ...ruleAnalysis,
    aiEnhancedFields: [],
    aiUsed: false,
  };
  let aiCost: AICostSummary | undefined;

  if (!noAI) {
    const aiStartTime = Date.now();
    const aiResult = await withAIEnhancement<EnhancedRequirement>({
      enabled: true,
      aiCall: () => new AIMetadataAssistant(cwd).enhanceRequirement(description, { cwd }),
      fallback: { title: null, description: null, type: null, priority: null, recommendedRole: null, checkpoints: null, dependencies: null, aiUsed: false },
      operationName: 'enhancement_call',
      logger,
    });

    if (aiResult.aiUsed) {
      // 步骤 3: 合并结果
      analysis = mergeAnalysisResults(ruleAnalysis, aiResult);

      // 记录 AI 成本
      const aiDurationMs = Date.now() - aiStartTime;
      aiCost = {
        field: 'enhanceRequirement',
        durationMs: aiDurationMs,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      logger.logAICost(aiCost);
    }
  }

  // 执行复杂度评估
  let complexity = assessComplexity(description, analysis);

  // Display analysis results
  const aiTag = (field: string) => analysis.aiEnhancedFields.includes(field) ? ' (AI enhanced)' : '';
  console.log('📋 Requirement Analysis Results:');
  console.log('');
  console.log(`  Title: ${analysis.title}${aiTag('title')}`);
  console.log(`  Priority: ${formatPriority(analysis.priority)}${aiTag('priority')}`);
  console.log(`  Complexity: ${formatComplexity(complexity)}`);
  console.log(`  Recommended Role: ${analysis.recommendedRole}${aiTag('recommendedRole')}`);
  console.log(`  Files Involved: ${complexity.fileCount}`);
  console.log(`  Work Items: ${complexity.workItemCount}`);
  console.log(`  Estimated Time: ~${complexity.estimatedMinutes} minutes`);
  if (analysis.aiUsed) {
    console.log(`  AI Enhanced: ${analysis.aiEnhancedFields.join(', ')}`);
  }
  console.log('');

  // 复杂度预警
  if (complexity.level === 'high') {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('⚠️  Complexity Warning');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');
    console.log(`  This task is estimated to take ${complexity.estimatedMinutes} minutes, exceeding the default Harness timeout threshold.`);
    console.log('  Consider splitting this task into smaller subtasks, each under 15 minutes.');
    console.log('');

    if (complexity.splitSuggestions.length > 0) {
      console.log('  Split suggestions:');
      for (let i = 0; i < complexity.splitSuggestions.length; i++) {
        const s = complexity.splitSuggestions[i];
        if (!s) continue;
        const depLabel = s.dependsOn >= 0 ? ` (depends on subtask ${s.dependsOn + 1})` : '';
        console.log(`    ${i + 1}. ${s.title}${depLabel}`);
        console.log(`       Files: ${s.files.length > 0 ? s.files.join(', ') : 'not specified'}`);
        console.log(`       Estimated: ~${s.estimatedMinutes} minutes`);
      }
      console.log('');
    }
  }

  if (analysis.suggestedCheckpoints.length > 0) {
    console.log(`  Suggested checkpoints${aiTag('checkpoints')}:`);
    for (const cp of analysis.suggestedCheckpoints) {
      console.log(`    - ${cp}`);
    }
    console.log('');
  }

  if (analysis.potentialDependencies.length > 0) {
    console.log(`  Potential dependencies${aiTag('dependencies')}:`);
    for (const dep of analysis.potentialDependencies) {
      console.log(`    - ${dep}`);
    }
    console.log('');
  }

  // 确认创建（非交互模式自动确认）
  let confirmCreate: { confirm: boolean } = { confirm: true };
  if (!nonInteractive) {
    const result = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Create task based on this analysis?',
      initial: true,
    });
    // IR-01-09: Ctrl+C safety — prompts returns undefined on SIGINT
    if (result === undefined) {
      console.log('');
      console.log('ℹ️  Task creation cancelled.');
      console.log('');
      logger.logInstrumentation({
        module: 'init-requirement',
        action: 'cancel',
        input_summary: `desc_len=${inputDescLength}`,
        output_summary: 'Ctrl+C cancelled creation',
        ai_used: analysis.aiUsed,
        ai_enhanced_fields: analysis.aiEnhancedFields,
        duration_ms: Date.now() - startTime,
        user_edit_count: 0,
        module_data: { cancel_reason: 'sigint' },
      });
      logger.flush();
      return;
    }
    confirmCreate = result;
  }

  if (!confirmCreate.confirm) {
    console.log('');
    console.log('ℹ️  Task creation cancelled.');
    console.log('   Run init-requirement again to recreate.');
    console.log('');
    // CP-8 instrumentation: user cancelled
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'cancel',
      input_summary: `desc_len=${inputDescLength}`,
      output_summary: 'User cancelled creation',
      ai_used: analysis.aiUsed,
      ai_enhanced_fields: analysis.aiEnhancedFields,
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: { cancel_reason: 'user_rejected_confirm' },
    });
    logger.flush();
    return;
  }

  // Allow user to modify (non-interactive mode uses analysis results)
  let response: { title: string; description: string; priority: string; recommendedRole: string };
  if (nonInteractive) {
    response = {
      title: analysis.title,
      description: analysis.description,
      priority: analysis.priority,
      recommendedRole: analysis.recommendedRole,
    };
  } else {
    const promptResponse = await prompts([
      {
        type: 'text',
        name: 'title',
        message: 'Task title',
        initial: analysis.title,
      },
      {
        type: 'text',
        name: 'description',
        message: 'Task description',
        initial: analysis.description,
      },
      {
        type: 'select',
        name: 'priority',
        message: 'Priority',
        choices: [
          { title: 'P3 Low', value: 'P3' },
          { title: 'P2 Medium', value: 'P2', selected: analysis.priority === 'P2' },
          { title: 'P1 High', value: 'P1', selected: analysis.priority === 'P1' },
          { title: 'P0 Urgent', value: 'P0', selected: analysis.priority === 'P0' },
        ],
        initial: analysis.priority === 'P3' ? 0 : analysis.priority === 'P2' ? 1 : analysis.priority === 'P1' ? 2 : 3,
      },
      {
        type: 'text',
        name: 'recommendedRole',
        message: 'Recommended role',
        initial: analysis.recommendedRole,
      },
    ]);

    // IR-01-09: Ctrl+C safety — prompts returns undefined on SIGINT
    if (promptResponse === undefined) {
      console.log('');
      console.log('ℹ️  Task creation cancelled.');
      console.log('');
      logger.logInstrumentation({
        module: 'init-requirement',
        action: 'cancel',
        input_summary: `desc_len=${inputDescLength}`,
        output_summary: 'Ctrl+C cancelled creation',
        ai_used: analysis.aiUsed,
        ai_enhanced_fields: analysis.aiEnhancedFields,
        duration_ms: Date.now() - startTime,
        user_edit_count: userEditCount,
      });
      logger.flush();
      return;
    }
    response = promptResponse as { title: string; description: string; priority: string; recommendedRole: string };

    // CP-8: 追踪用户编辑回退率（对比用户输入 vs 规则建议）
    if (response.title !== analysis.title) userEditCount++;
    if (response.priority !== analysis.priority) userEditCount++;
    if (response.recommendedRole !== analysis.recommendedRole) userEditCount++;

    // IR-01-15: Re-evaluate complexity if description changed significantly
    if (response.description && response.description !== analysis.description) {
      const newAnalysis: RequirementAnalysis = {
        ...analysis,
        description: response.description,
        title: response.title || analysis.title,
        priority: (response.priority as TaskPriority) || analysis.priority,
        recommendedRole: response.recommendedRole || analysis.recommendedRole,
      };
      const newComplexity = assessComplexity(response.description, newAnalysis);
      if (newComplexity.level !== complexity.level || newComplexity.estimatedMinutes !== complexity.estimatedMinutes) {
        console.log(`   📊 Complexity reassessed: ${formatComplexity(newComplexity)} (was: ${formatComplexity(complexity)})`);
        complexity = newComplexity;
      }
    }
  }

  if (!response.title) {
    console.log('');
    console.log('ℹ️  Task creation cancelled (title cannot be empty).');
    console.log('   Run init-requirement again to recreate.');
    console.log('');
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'cancel',
      input_summary: `desc_len=${inputDescLength}`,
      output_summary: 'Empty title, cancelled creation',
      ai_used: analysis.aiUsed,
      ai_enhanced_fields: analysis.aiEnhancedFields,
      duration_ms: Date.now() - startTime,
      user_edit_count: userEditCount,
    });
    logger.flush();
    return;
  }

  // 推断任务类型并生成任务ID
  const taskType = inferTaskType(response.title);
  const taskPriority = (response.priority as TaskPriority) || analysis.priority;

  // 生成结构化描述
  const structuredInfo = extractStructuredInfo(response.description || analysis.description);
  const inferredCheckpoints = inferCheckpointsFromDescription(response.description || analysis.description, taskType);
  const inferredFiles = inferRelatedFiles(response.description || analysis.description, taskType);

  // 合并提取的检查点和推断的检查点
  const allCheckpoints = [...new Set([...structuredInfo.checkpoints, ...inferredCheckpoints, ...analysis.suggestedCheckpoints])];
  const allRelatedFiles = [...new Set([...structuredInfo.relatedFiles, ...inferredFiles])];

  // Filter low-quality checkpoints (AI parsing artifacts)
  const filterResult = filterLowQualityCheckpoints(allCheckpoints.length > 0 ? allCheckpoints : analysis.suggestedCheckpoints);
  if (filterResult.removed.length > 0) {
    console.log(`   🔍 Filtered ${filterResult.removed.length} low-quality checkpoints:`);
    for (const removed of filterResult.removed) {
      const reason = filterResult.reasons.get(removed) || 'Unknown reason';
      console.log(`     - "${removed}" (${reason})`);
    }
  }
  const checkpoints = filterResult.kept;

  // 使用重构后的 createTask 创建任务
  const finalDescription = generateStructuredDescription({
    problem: structuredInfo.problem || analysis.description,
    rootCause: structuredInfo.rootCause,
    solution: structuredInfo.solution,
    checkpoints: checkpoints,
    relatedFiles: allRelatedFiles,
    notes: structuredInfo.notes,
  }, template as DescriptionTemplateType);

  const task = await createTask({
    title: response.title,
    description: finalDescription,
    type: taskType,
    priority: taskPriority,
    nonInteractive: true,
    skipValidation: true, // Manual quality gate check later
    aiEnhancement: false, // Structured processing completed above
    suggestedCheckpoints: checkpoints,
    potentialDependencies: analysis.potentialDependencies,
    recommendedRole: response.recommendedRole || analysis.recommendedRole,
    relatedFiles: allRelatedFiles,
  }, cwd);

  const taskId = task.id;

  // BUG-014: 文本检查点与结构化检查点双轨制修复
  // 在创建任务后立即生成结构化检查点并写入 meta.json
  if (checkpoints.length > 0) {
    const parsedCheckpoints = checkpoints.map((desc, index) => ({
      id: `CP-${String(index + 1).padStart(3, '0')}`,
      description: desc,
      originalText: `- [ ] ${desc}`,
      lineNumber: index,
    }));

    const checkpointMetadata = convertParsedCheckpointsToMetadata(parsedCheckpoints, task);

    // 更新任务元数据中的检查点
    const taskToUpdate = readTaskMeta(taskId, cwd);
    if (taskToUpdate) {
      taskToUpdate.checkpoints = checkpointMetadata;
      writeTaskMeta(taskToUpdate, cwd);

      // 更新 checkpoint.md 文件以包含正确的 ID
      updateCheckpointMdFromArray(taskId, checkpointMetadata, cwd);
    }
  }

  // 定义 checkpointPath 供后续验证使用
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');

  // BUG-013-2: Validate checkpoint verification command completeness
  const updatedTask = readTaskMeta(taskId, cwd);
  if (updatedTask?.checkpoints) {
    const checkpointsWithoutCommands = updatedTask.checkpoints.filter(cp => {
      const result = validateCheckpointVerification(cp);
      return !result.valid;
    });
    if (checkpointsWithoutCommands.length > 0) {
      console.log(`\n   ⚠️  ${checkpointsWithoutCommands.length} checkpoints missing verification commands:`);
      for (const cp of checkpointsWithoutCommands) {
        const result = validateCheckpointVerification(cp);
        console.log(`   - [${cp.id}] ${result.warning || cp.description}`);
      }
    }
  }

  // Basic field validation
  if (updatedTask) {
    const basicValidation = validateBasicFields(updatedTask);
    if (!basicValidation.valid) {
      console.log(`\n   ⚠️  Basic field validation failed:`);
      for (const err of basicValidation.errors) {
        console.log(`     - ${err}`);
      }
    }
  }

  // File existence validation
  if (updatedTask) {
    const filesValidation = validateFilesExist(updatedTask, cwd);
    if (!filesValidation.valid) {
      console.log(`\n   ⚠️  ${filesValidation.missingFiles.length} referenced files do not exist:`);
      for (const f of filesValidation.missingFiles) {
        console.log(`     - ${f}`);
      }
    }
  }

  console.log(`✅ Task created successfully!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   Title: ${task.title}`);
  console.log(`   Priority: ${formatPriority(task.priority)}`);
  console.log(`   Checkpoints: ${checkpoints.length} items`);
  if (task.dependencies && task.dependencies.length > 0) {
    console.log(`   Inferred dependencies: ${task.dependencies.join(', ')}`);
  }
  console.log('');

  // CP-1/CP-6: Quality gate check - call checkQualityGate after task creation and display score
  const qualityGateConfig: QualityGateConfig = {
    ...DEFAULT_QUALITY_GATE_CONFIG,
    minQualityScore: requireQuality ?? DEFAULT_QUALITY_GATE_CONFIG.minQualityScore,
  };

  if (qualityGateConfig.minQualityScore < 0 || qualityGateConfig.minQualityScore > 100) {
    console.error('Error: --require-quality must be between 0-100');
    process.exit(1);
  }

  const qualityResult = await checkQualityGate(taskId, qualityGateConfig, cwd);

  // 将质量评分写入任务元数据
  const taskWithScore = readTaskMeta(taskId, cwd);
  if (taskWithScore) {
    taskWithScore.initQualityScore = qualityResult.score.totalScore;
    writeTaskMeta(taskWithScore, cwd);
  }

  // CP-6: Display quality score
  const scoreIcon = qualityResult.score.totalScore >= 80 ? '🟢' :
                    qualityResult.score.totalScore >= 60 ? '🟡' : '🔴';
  console.log(`📊 Quality Score: ${scoreIcon} ${qualityResult.score.totalScore}/100`);
  console.log(`   Description Completeness: ${qualityResult.score.descriptionScore}%`);
  console.log(`   Checkpoint Quality: ${qualityResult.score.checkpointScore}%`);
  console.log(`   Related Files: ${qualityResult.score.relatedFilesScore}%`);
  console.log(`   Solution: ${qualityResult.score.solutionScore}%`);
  console.log('');

  // CP-16: Dependency quality gate - validate new task dependency integrity (GATE-DEP-001/002/003)
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
    console.log('📋 Dependency Errors:');
    for (const e of depValidation.errors) {
      console.log(`   ❌ ${e}`);
    }
  }
  console.log('');

  // CP-quality-gate-error-list: Error-level violations block task creation by default
  if (qualityResult.errorViolations.length > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`❌ Quality gate failed: ${qualityResult.errorViolations.length} error-level violations found`);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    console.log('🚫 The following errors must be fixed before creating task:');
    for (const violation of qualityResult.errorViolations) {
      console.log(`   ❌ [${violation.ruleId}] ${violation.message}`);
      if (violation.field) {
        console.log(`      Field: ${violation.field}`);
      }
    }
    console.log('');

    console.log('💡 Fix suggestions:');
    console.log('   1. Checkpoints must start with standard prefixes: [implem], [test], [doc], [verify]');
    console.log('   2. meta.json must be in standard format with all required fields');
    console.log('   3. Use --skip-quality-gate to skip temporarily (not recommended for production)');
    console.log('');

    // Log instrumentation
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'quality_gate_error_blocked',
      input_summary: `desc_len=${inputDescLength}, error_count=${qualityResult.errorViolations.length}`,
      output_summary: `task_id=${taskId}, error_violations=${qualityResult.errorViolations.map(v => v.ruleId).join(',')}`,
      ai_used: analysis.aiUsed,
      ai_enhanced_fields: analysis.aiEnhancedFields,
      duration_ms: Date.now() - startTime,
      user_edit_count: userEditCount,
    });
    logger.flush();
    process.exit(1);
  }

  // CP-3/CP-7: --require-quality blocks low-quality task creation
  if (requireQuality !== undefined && !qualityResult.passed) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`❌ Quality gate failed: ${qualityResult.score.totalScore} < ${requireQuality}`);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    // Display improvement suggestions
    if (qualityResult.suggestions.length > 0) {
      const sorted = [...qualityResult.suggestions].sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      });
      console.log('💡 Improvement suggestions:');
      for (const s of sorted.slice(0, 5)) {
        const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟠' : '🟡';
        console.log(`  ${icon} [${s.category}] ${s.message}`);
        console.log(`     👉 ${s.action}`);
      }
      console.log('');
    }

    console.log(`Task ${taskId} created but did not pass quality gate (score ${qualityResult.score.totalScore} < threshold ${requireQuality}).`);
    console.log('Please improve the task description and recreate, or use a lower --require-quality threshold.');
    console.log('');

    // Log instrumentation
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'quality_gate_blocked',
      input_summary: `desc_len=${inputDescLength}, require_quality=${requireQuality}`,
      output_summary: `task_id=${taskId}, quality_score=${qualityResult.score.totalScore}, blocked=true`,
      ai_used: analysis.aiUsed,
      ai_enhanced_fields: analysis.aiEnhancedFields,
      duration_ms: Date.now() - startTime,
      user_edit_count: userEditCount,
    });
    logger.flush();
    process.exit(1);
  }

  // CP-2: Output warnings and improvement suggestions when quality is below standard (non-blocking)
  if (!qualityResult.passed) {
    console.log('⚠️  Quality Gate Warning: Task quality score below default threshold, improvements recommended');
    if (qualityResult.suggestions.length > 0) {
      const sorted = [...qualityResult.suggestions].sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      });
      for (const s of sorted.slice(0, 3)) {
        const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟠' : '🟡';
        console.log(`  ${icon} ${s.message}`);
        console.log(`     👉 ${s.action}`);
      }
    }
    console.log('');
  }

  // Auto-split complex tasks
  if (autoSplit && complexity.level === 'high' && complexity.splitSuggestions.length > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔀 Auto-splitting complex task...');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const subtaskIds: string[] = [];

    try {
    for (let i = 0; i < complexity.splitSuggestions.length; i++) {
      const sub = complexity.splitSuggestions[i];
      if (!sub) continue;
      const subType = inferTaskType(sub.title);
      const subPriority = taskPriority;
      const subId = generateNewTaskId(cwd, subType, subPriority, sub.title);
      subtaskIds.push(subId);
      const subTask = createDefaultTaskMeta(subId, sub.title, subType, undefined, 'init-requirement');

      // CP-3 (IR-01-06): 使用结构化描述替代原始文本
      const subStructuredInfo = extractStructuredInfo(sub.description);
      const subInferredCheckpoints = inferCheckpointsFromDescription(sub.description, subType);
      const subStructuredData: StructuredDescription = {
        problem: subStructuredInfo.problem || sub.description,
        rootCause: subStructuredInfo.rootCause,
        solution: subStructuredInfo.solution,
        checkpoints: [...new Set([...subStructuredInfo.checkpoints, ...subInferredCheckpoints])],
        relatedFiles: sub.files.length > 0 ? sub.files : subStructuredInfo.relatedFiles,
        notes: subStructuredInfo.notes,
      };
      subTask.description = generateStructuredDescription(subStructuredData, template as DescriptionTemplateType);

      subTask.priority = taskPriority;
      subTask.recommendedRole = analysis.recommendedRole;

      // 设置父子关系
      subTask.parentId = taskId;

      // 设置依赖关系（使用已创建的子任务ID，避免重新生成不匹配的ID）
      if (sub.dependsOn >= 0 && sub.dependsOn < i) {
        const depSubId = subtaskIds[sub.dependsOn];
        if (depSubId) {
          subTask.dependencies = [depSubId];
        }
      }

      writeTaskMeta(subTask, cwd);

      // CP-1 (IR-01-04): 使用 inferCheckpointsFromDescription 替代硬编码检查点
      const subCheckpointTexts = subInferredCheckpoints.length > 0
        ? subInferredCheckpoints
        : [`完成 ${sub.title}`];
      const subFilterResult = filterLowQualityCheckpoints(subCheckpointTexts);
      const subFilteredCheckpoints = subFilterResult.kept;
      const subTaskDir = path.join(getTasksDir(cwd), subId);
      const subCheckpointPath = path.join(subTaskDir, 'checkpoint.md');
      const subCheckpointContent = `# ${subId} 检查点\n\n${subFilteredCheckpoints.map((cp: string) => `- [ ] ${cp}`).join('\n')}\n`;
      fs.writeFileSync(subCheckpointPath, subCheckpointContent, 'utf-8');
      syncCheckpointsToMeta(subId, cwd);

      // Link to parent task (update parent subtaskIds and history)
      addSubtaskToParent(taskId, subId, cwd);

      console.log(`  ${i + 1}. ${subId}: ${sub.title}`);
      console.log(`     Files: ${sub.files.length > 0 ? sub.files.join(', ') : 'TBD'}`);
      console.log(`     Estimated: ~${sub.estimatedMinutes} minutes`);
      if (subTask.dependencies && subTask.dependencies.length > 0) {
        console.log(`     Dependencies: ${subTask.dependencies.join(', ')}`);
      }
      console.log('');
    }

    // CP-4/CP-2 (IR-01-05): Use graph module for dependency inference with cycle validation
    const allTasksForSubDeps = getAllTasks(cwd);
    const subDepGraph = DependencyGraph.fromTasks(allTasksForSubDeps);
    for (const subId of subtaskIds) {
      const subTaskMeta = readTaskMeta(subId, cwd);
      if (!subTaskMeta) continue;

      const subDeps = inferDependenciesUnified(subTaskMeta, allTasksForSubDeps, { strategy: 'file-overlap' });
      if (subDeps.length > 0) {
        const existingDeps = subTaskMeta.dependencies || [];
        // Filter inferred deps: only add if they don't create cycles (GATE-DEP-002)
        const safeNewDepIds = subDeps
          .map(d => d.depTaskId)
          .filter(id => !existingDeps.includes(id) && !subDepGraph.wouldCreateCycle(subId, id));

        if (safeNewDepIds.length > 0) {
          subTaskMeta.dependencies = [...existingDeps, ...safeNewDepIds];
          writeTaskMeta(subTaskMeta, cwd);
          // Update graph to reflect new edges
          for (const newDepId of safeNewDepIds) {
            subDepGraph.addEdge(subId, newDepId);
          }
        }

        // CP-4: Validate subtask dependencies with GATE-DEP-001/002/003
        const subValidation = validateNewTaskDeps(subId, subTaskMeta.dependencies || [], subDepGraph, allTasksForSubDeps);
        if (subValidation.warnings.length > 0) {
          for (const w of subValidation.warnings) {
            console.log(`   ⚠️  ${subId}: ${w}`);
          }
        }
        if (subValidation.errors.length > 0) {
          for (const e of subValidation.errors) {
            console.log(`   ❌ ${subId}: ${e}`);
          }
        }

        // Report skipped deps due to cycle detection
        const skippedDeps = subDeps
          .filter(d => !existingDeps.includes(d.depTaskId) && subDepGraph.wouldCreateCycle(subId, d.depTaskId));
        if (skippedDeps.length > 0) {
          console.log(`   ⚠️  ${subId}: Skipped ${skippedDeps.length} inferred dependencies (would create cycle)`);
        }
      }
    }

    } catch (err) {
      // IR-01-13: Partial failure — clean up already-created subtasks
      console.error(`\n❌ Subtask creation failed: ${err instanceof Error ? err.message : String(err)}`);
      if (subtaskIds.length > 0) {
        console.log(`   Cleaning up ${subtaskIds.length} created subtasks...`);
        for (const cleanupId of subtaskIds) {
          try {
            const cleanupDir = path.join(getTasksDir(cwd), cleanupId);
            if (fs.existsSync(cleanupDir)) {
              fs.rmSync(cleanupDir, { recursive: true, force: true });
            }
          } catch {
            // Best-effort cleanup
          }
        }
        // Remove subtaskIds from parent
        const parentMeta = readTaskMeta(taskId, cwd);
        if (parentMeta) {
          parentMeta.subtaskIds = (parentMeta.subtaskIds || []).filter(id => !subtaskIds.includes(id));
          writeTaskMeta(parentMeta, cwd);
        }
        console.log(`   Cleaned up. Parent task ${taskId} retained.`);
      }
      console.log('');
    }

    if (subtaskIds.length > 0) {
      console.log(`✅ Split into ${subtaskIds.length} subtasks`);
      console.log(`   Parent task: ${taskId}`);
      console.log('');
    }
  }
  if (!skipValidation) {
    const validation = hasValidCheckpoints(checkpointPath, false);
    if (!validation.valid) {
      displayCheckpointCreationWarning(taskId, cwd);
    }
  }

  // Ask whether to add to execution plan (skip in non-interactive mode or when noPlan)
  if (!noPlan && !nonInteractive) {
    const addToPlan = await prompts({
      type: 'confirm',
      name: 'add',
      message: 'Add this task to execution plan?',
      initial: true,
    });

    // IR-01-09: Ctrl+C safety — prompts returns undefined on SIGINT
    if (addToPlan === undefined) {
      // Silently skip plan addition on Ctrl+C
    } else if (addToPlan.add) {
      // Dynamic import plan module
      const planModule = await import('./plan');
      planModule.addTask(taskId);
    }
  }

  // CP-8: Log init-requirement instrumentation
  logger.logInstrumentation({
    module: 'init-requirement',
    action: 'create_task',
    input_summary: `desc_len=${inputDescLength}, non_interactive=${nonInteractive}`,
    output_summary: `task_id=${taskId}, checkpoints=${checkpoints.length}, complexity=${complexity.level}`,
    ai_used: analysis.aiUsed,
    ai_enhanced_fields: analysis.aiEnhancedFields,
    duration_ms: Date.now() - startTime,
    user_edit_count: userEditCount,
  });
  logger.flush();
}

/**
 * Format complexity display
 */
function formatComplexity(assessment: ComplexityAssessment): string {
  const icons: Record<string, string> = {
    low: '🟢 low',
    medium: '🟡 medium',
    high: '🔴 high',
  };
  return `${icons[assessment.level]} (Score: ${assessment.score}/100)`;
}

/**
 * 从描述中提取工作项（动作+目标的数量）
 */
function countWorkItems(description: string): number {
  // 匹配编号列表项、bullet 列表项、以及独立动作行
  const actionPatterns = [
    /(?:^\s*(?:\d+\.|[-*])\s+[^\n]+)/gm,         // 列表项
    /(?:验证|修复|创建|修改|添加|实现|配置|部署|更新|增强|完善|重构|编写|分析|处理|集成|迁移|支持|移除)[^\n,;，；。、]+/g,  // 动作短语
  ];
  const items = new Set<string>();
  for (const pattern of actionPatterns) {
    const matches = description.match(pattern);
    if (matches) {
      for (const m of matches) {
        items.add(m.trim());
      }
    }
  }
  return items.size;
}

/**
 * 检测是否涉及跨模块修改
 */
function countCrossModuleReferences(description: string): number {
  const modulePatterns = [
    /(?:模块|module|系统|system|服务|service|组件|component|插件|plugin)/gi,
  ];
  let count = 0;
  for (const pattern of modulePatterns) {
    const matches = description.match(pattern);
    if (matches) count += matches.length;
  }
  // 用 "/" 分隔的路径段落数量也反映模块跨度
  const files = extractFilePaths(description);
  const dirs = new Set(files.map(f => {
    const parts = f.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }).filter(Boolean));
  count += dirs.size;
  return count;
}

/**
 * 评估任务复杂度
 *
 * 算法基于多维信号：
 * - File count: more files = more complex
 * - Work item count: more independent actions = more complex
 * - Cross-module references: crossing modules increases complexity
 * - Checkpoint count: more verification points = more complex
 * - Description length: overly long descriptions often indicate unclear scope
 */
export function assessComplexity(
  description: string,
  analysis: RequirementAnalysis
): ComplexityAssessment {
  const signals: ComplexitySignal[] = [];

  // 1. File count signal
  const files = extractFilePaths(description);
  const fileCount = files.length;
  const fileWeight = Math.min(fileCount * 8, 30); // 8 points per file, max 30
  signals.push({
    type: 'file_count',
    weight: fileWeight,
    description: `Involves ${fileCount} files`,
  });

  // 2. Work item signal
  const workItemCount = countWorkItems(description);
  const workItemWeight = Math.min(workItemCount * 5, 25); // 5 points per item, max 25
  signals.push({
    type: 'work_items',
    weight: workItemWeight,
    description: `Contains ${workItemCount} work items`,
  });

  // 3. Cross-module signal
  const crossModuleCount = countCrossModuleReferences(description);
  const crossModuleWeight = Math.min(crossModuleCount * 6, 20); // 6 points per reference, max 20
  signals.push({
    type: 'cross_module',
    weight: crossModuleWeight,
    description: `Crosses ${crossModuleCount} modules/systems`,
  });

  // 4. Checkpoint count signal
  const checkpointCount = analysis.suggestedCheckpoints.length;
  const checkpointWeight = Math.min(checkpointCount * 4, 15); // 4 points per checkpoint, max 15
  signals.push({
    type: 'checkpoint_count',
    weight: checkpointWeight,
    description: `Contains ${checkpointCount} checkpoints`,
  });

  // 5. Description length signal
  const descLength = description.length;
  const descWeight = descLength > 500 ? 10 : descLength > 200 ? 5 : 0;
  signals.push({
    type: 'description_length',
    weight: descWeight,
    description: `Description length ${descLength} characters`,
  });

  // 6. Action density signal (action verb count / description length)
  const actionVerbPattern = /(?:验证|修复|创建|修改|添加|实现|配置|部署|更新|增强|完善|重构|编写|分析|处理|集成|迁移|支持|移除|检查|测试)/g;
  const actionVerbMatches = description.match(actionVerbPattern);
  const actionVerbCount = actionVerbMatches ? actionVerbMatches.length : 0;
  const actionDensityWeight = actionVerbCount > 10 ? 10 : actionVerbCount > 5 ? 5 : 0;
  signals.push({
    type: 'action_verb_density',
    weight: actionDensityWeight,
    description: `Contains ${actionVerbCount} action verbs`,
  });

  // Calculate total score
  const totalScore = Math.min(
    signals.reduce((sum, s) => sum + s.weight, 0),
    100
  );

  // Determine level
  let level: 'low' | 'medium' | 'high';
  if (totalScore >= 40) {
    level = 'high';
  } else if (totalScore >= 20) {
    level = 'medium';
  } else {
    level = 'low';
  }

  // Estimate time: based on file count and work item count
  // Empirical values: ~3 min per file + ~2 min per work item + base 5 min
  const estimatedMinutes = Math.max(
    5 + fileCount * 3 + workItemCount * 2,
    Math.ceil(descLength / 100) // Fallback: 1 min per 100 characters
  );

  // Force high if over 15 minutes
  if (estimatedMinutes > 15 && level !== 'high') {
    level = 'high';
  }

  // 生成拆分建议
  const splitSuggestions = generateSplitSuggestions(
    description,
    files,
    workItemCount,
    estimatedMinutes,
    analysis
  );

  return {
    level,
    score: totalScore,
    fileCount,
    workItemCount,
    estimatedMinutes,
    splitSuggestions,
    signals,
  };
}

/**
 * 生成任务拆分建议
 *
 * 策略（按优先级）：
 * 1. 按架构层级拆分（Layer0类型 → Layer1工具 → Layer2核心 → Layer3命令）
 * 2. 按文件目录边界拆分
 * 3. 按工作项数量拆分
 * - 每个子任务控制在 15 分钟以内
 * - 依赖关系遵循底层先于上层
 */
function generateSplitSuggestions(
  description: string,
  files: string[],
  workItemCount: number,
  totalMinutes: number,
  analysis: RequirementAnalysis
): SplitSuggestion[] {
  // 只有复杂任务才需要拆分建议
  if (totalMinutes <= 15) return [];

  const suggestions: SplitSuggestion[] = [];

  // 策略1: 按架构层级拆分（优先策略）
  const layerGroups = groupFilesByLayer(files);
  if (layerGroups.size >= 2 && files.length >= 2) {
    const layerOrder: ArchitectureLayer[] = ['Layer0', 'Layer1', 'Layer2', 'Layer3'];
    let prevIdx = -1;

    for (const layer of layerOrder) {
      const layerFiles = layerGroups.get(layer);
      if (!layerFiles || layerFiles.length === 0) continue;

      const layerDef = LAYER_DEFINITIONS[layer];
      const estMinutes = Math.max(5, Math.ceil(layerFiles.length * 3 + 2));

      suggestions.push({
        title: `${analysis.title} - ${layerDef.label}`,
        description: `修改${layerDef.description}层文件: ${layerFiles.join(', ')}`,
        files: layerFiles,
        estimatedMinutes: estMinutes,
        dependsOn: prevIdx,
      });
      prevIdx = suggestions.length - 1;
    }

    // 如果没有按层级成功拆分（所有文件都在同一层），回退到目录拆分
    if (suggestions.length <= 1) {
      suggestions.length = 0; // 清空，走下面的策略
    }
  }

  // 策略2: 按文件目录边界拆分（当策略1不适用时）
  if (suggestions.length === 0 && files.length >= 3) {
    const fileGroups = new Map<string, string[]>();
    for (const file of files) {
      const parts = file.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
      if (!fileGroups.has(dir)) fileGroups.set(dir, []);
      fileGroups.get(dir)!.push(file);
    }

    if (fileGroups.size <= 1 && files.length >= 3) {
      const sortedFiles = sortFilesByLayer(files);
      const mid = Math.ceil(sortedFiles.length / 2);
      const firstHalf = sortedFiles.slice(0, mid);
      const secondHalf = sortedFiles.slice(mid);

      suggestions.push({
        title: `${analysis.title} - 基础实现`,
        description: `完成核心功能实现（底层依赖），涉及文件: ${firstHalf.join(', ')}`,
        files: firstHalf,
        estimatedMinutes: Math.ceil(totalMinutes * 0.6),
        dependsOn: -1,
      });
      suggestions.push({
        title: `${analysis.title} - 完善与测试`,
        description: `完成剩余修改和验证（上层逻辑），涉及文件: ${secondHalf.join(', ')}`,
        files: secondHalf,
        estimatedMinutes: Math.ceil(totalMinutes * 0.4),
        dependsOn: 0,
      });
    } else {
      const groups = Array.from(fileGroups.entries());
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (!group) continue;
        const [dir, groupFiles] = group;
        const isFirst = i === 0;
        suggestions.push({
          title: `${analysis.title} - ${dir} 模块`,
          description: `修改 ${dir} 目录下文件: ${groupFiles.join(', ')}`,
          files: groupFiles,
          estimatedMinutes: Math.max(5, Math.ceil(groupFiles.length * 3 + 2)),
          dependsOn: isFirst ? -1 : i - 1,
        });
      }
    }
  }

  // 策略3: 按工作项数量拆分
  if (suggestions.length === 0 && workItemCount >= 4) {
    suggestions.push({
      title: `${analysis.title} - 核心修改`,
      description: `完成核心代码修改和功能实现`,
      files: files.slice(0, Math.ceil(files.length / 2)),
      estimatedMinutes: Math.ceil(totalMinutes * 0.5),
      dependsOn: -1,
    });
    suggestions.push({
      title: `${analysis.title} - 配置与集成`,
      description: `完成配置修改和模块集成`,
      files: files.slice(Math.ceil(files.length / 2)),
      estimatedMinutes: Math.ceil(totalMinutes * 0.3),
      dependsOn: 0,
    });
    suggestions.push({
      title: `${analysis.title} - 验证与测试`,
      description: `验证修改正确性，运行测试并确保无回归`,
      files: [],
      estimatedMinutes: Math.ceil(totalMinutes * 0.2),
      dependsOn: 1,
    });
  }

  // 兜底: 无法智能拆分
  if (suggestions.length === 0) {
    suggestions.push({
      title: `${analysis.title} (建议拆分)`,
      description: `此任务预估 ${totalMinutes} 分钟，建议按架构层级（类型→工具→核心→命令）手动拆分为更小的子任务`,
      files,
      estimatedMinutes: totalMinutes,
      dependsOn: -1,
    });
  }

  // 确保每个子任务不超过 15 分钟
  // IR-01-11: Remap dependsOn indices from `suggestions` to `finalSuggestions`
  const finalSuggestions: SplitSuggestion[] = [];
  const indexMap = new Map<number, number>(); // old suggestions index → new finalSuggestions index

  for (let si = 0; si < suggestions.length; si++) {
    const s = suggestions[si];
    if (!s) continue;

    // Remap dependsOn from original suggestions index to finalSuggestions index
    const remappedDependsOn = s.dependsOn >= 0 && indexMap.has(s.dependsOn)
      ? indexMap.get(s.dependsOn)!
      : s.dependsOn;

    if (s.estimatedMinutes <= 15) {
      indexMap.set(si, finalSuggestions.length);
      finalSuggestions.push({ ...s, dependsOn: remappedDependsOn });
    } else {
      // 子任务仍然太大，按层级排序后拆分
      const sortedFiles = sortFilesByLayer(s.files);
      const half = Math.ceil(sortedFiles.length / 2);
      if (half > 0 && sortedFiles.length > 1) {
        indexMap.set(si, finalSuggestions.length);
        finalSuggestions.push({
          ...s,
          title: `${s.title} (前半)`,
          files: sortedFiles.slice(0, half),
          estimatedMinutes: Math.ceil(s.estimatedMinutes / 2),
          dependsOn: remappedDependsOn,
        });
        finalSuggestions.push({
          ...s,
          title: `${s.title} (后半)`,
          files: sortedFiles.slice(half),
          estimatedMinutes: Math.ceil(s.estimatedMinutes / 2),
          dependsOn: finalSuggestions.length - 1,
        });
      } else {
        indexMap.set(si, finalSuggestions.length);
        finalSuggestions.push({ ...s, dependsOn: remappedDependsOn });
      }
    }
  }

  return finalSuggestions;
}

/**
 * Detect recommended role by scanning project structure and matching keywords.
 * IR-01-12: Replaces hardcoded keyword-only mapping with dynamic project structure discovery.
 */
function detectRoleFromProject(cwd: string, description: string): string {
  const lowerDesc = description.toLowerCase();

  // Scan project src/ directory to detect architecture signals
  const srcDir = path.join(cwd, 'src');
  let projectDirs: string[] = [];
  try {
    if (fs.existsSync(srcDir)) {
      projectDirs = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    }
  } catch {
    // Directory scan failed, fall through to keyword-only detection
  }

  // Combine project structure signals with description keywords
  const signals: Record<string, boolean> = {
    frontend: projectDirs.some(d => ['components', 'pages', 'views', 'styles', 'assets', 'public'].includes(d))
      || lowerDesc.includes('ui') || lowerDesc.includes('界面') || lowerDesc.includes('前端') || lowerDesc.includes('frontend'),
    backend: projectDirs.some(d => ['routes', 'controllers', 'middleware', 'services', 'api', 'models'].includes(d))
      || lowerDesc.includes('api') || lowerDesc.includes('后端') || lowerDesc.includes('backend') || lowerDesc.includes('服务端'),
    qa: projectDirs.some(d => ['__tests__', 'test', 'tests', 'spec'].includes(d))
      || lowerDesc.includes('测试') || lowerDesc.includes('test') || lowerDesc.includes('qa'),
    writer: projectDirs.some(d => ['docs', 'documents'].includes(d))
      || lowerDesc.includes('文档') || lowerDesc.includes('document') || lowerDesc.includes('readme'),
    security: lowerDesc.includes('安全') || lowerDesc.includes('security') || lowerDesc.includes('漏洞'),
    performance: lowerDesc.includes('性能') || lowerDesc.includes('performance') || lowerDesc.includes('优化'),
    architect: lowerDesc.includes('架构') || lowerDesc.includes('architecture') || lowerDesc.includes('设计'),
  };

  if (signals.frontend) return 'frontend';
  if (signals.backend) return 'backend';
  if (signals.qa) return 'qa';
  if (signals.writer) return 'writer';
  if (signals.security) return 'security';
  if (signals.performance) return 'performance';
  if (signals.architect) return 'architect';
  return 'developer';
}

/**
 * 分析自然语言需求
 */
function analyzeRequirement(description: string, cwd: string): RequirementAnalysis {
  const lowerDesc = description.toLowerCase();

  // 检测优先级关键词 (使用 P0-P3 格式)
  let priority: TaskPriority = 'P2'; // 默认中等优先级
  if (lowerDesc.includes('紧急') || lowerDesc.includes('urgent') || lowerDesc.includes('asap') || lowerDesc.includes('立即')) {
    priority = 'P0';
  } else if (lowerDesc.includes('重要') || lowerDesc.includes('important') || lowerDesc.includes('优先') || lowerDesc.includes('high')) {
    priority = 'P1';
  } else if (lowerDesc.includes('低优先级') || lowerDesc.includes('low priority') || lowerDesc.includes('可选') || lowerDesc.includes('optional')) {
    priority = 'P3';
  }

  // IR-01-12: 检测推荐角色 — 使用 glob 扫描替代硬编码关键词映射
  const recommendedRole = detectRoleFromProject(cwd, description);

  // 检测复杂度
  let estimatedComplexity: 'low' | 'medium' | 'high' = 'medium';
  const complexityKeywords = {
    high: ['重构', 'refactor', '架构', 'architecture', '迁移', 'migrate', '集成', 'integration', '系统'],
    low: ['修复', 'fix', '更新', 'update', '添加', 'add', '修改', 'modify', '调整', 'adjust'],
  };

  const highCount = complexityKeywords.high.filter((kw: string) => lowerDesc.includes(kw)).length;
  const lowCount = complexityKeywords.low.filter((kw: string) => lowerDesc.includes(kw)).length;

  if (highCount > lowCount) {
    estimatedComplexity = 'high';
  } else if (lowCount > highCount) {
    estimatedComplexity = 'low';
  }

  // 生成标题 (提取关键词)
  let title = description;
  if (description.length > 50) {
    // 尝试提取核心动词和名词（贪婪匹配，取完整短语）
    // 匹配动词后跟的内容，直到遇到句号、换行或字符串结束
    // 动词列表：按常见程度排序，确保匹配最相关的动词
    const keywords = description.match(/(?:修复|实现|添加|创建|更新|设计|优化|重构|集成|迁移|验证|初始化|编写|配置|部署|测试|分析|处理|支持|增强|完善)[^\n。！？]*/);
    if (keywords && keywords[0] && keywords[0].length >= 5) {
      // 确保标题至少有5个字符，避免截断成无意义的片段
      title = keywords[0].trim();
      // 如果提取的标题超过50字符，截断并添加省略号
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
    } else {
      // 无法提取有效关键词时，使用原描述的前50字符
      title = description.substring(0, 47) + '...';
    }
  }

  // 使用智能检查点生成器生成具体可验证的检查点
  // 推断任务类型用于智能检查点生成
  const taskType = inferTaskType(title);
  const suggestedCheckpoints = inferCheckpointsFromDescription(description, taskType);

  // 生成潜在依赖
  const potentialDependencies: string[] = [];

  // 文件重叠依赖推断：从描述中提取文件路径，与已有任务 affectedFiles 比较
  // IR-01-14: 禁用裸文件名匹配，要求目录前缀或代码块上下文
  const currentFiles = extractFilePaths(description, { includeBareFilenames: false });
  if (currentFiles.length > 0) {
    const existingTasks = getAllTasks(cwd);
    for (const existing of existingTasks) {
      if (existing.status === 'resolved' || existing.status === 'closed' || existing.status === 'abandoned' || existing.status === 'failed') continue;
      const existingFiles = extractAffectedFiles(existing);
      const overlap = currentFiles.filter(f => existingFiles.includes(f));
      if (overlap.length > 0) {
        const depHint = `文件重叠依赖 ${existing.id}: 共享 ${overlap.join(', ')}`;
        if (!potentialDependencies.some(d => d.includes(existing.id))) {
          potentialDependencies.push(depHint);
        }
      }
    }
  }

  // IR-01-07: 已移除硬编码关键词映射（登录→认证基础、支付→订单系统、通知→消息队列）
  // 仅依赖文件重叠推断，通过 inferDependenciesUnified 统一处理

  return {
    title,
    description,
    priority,
    recommendedRole,
    estimatedComplexity,
    suggestedCheckpoints,
    potentialDependencies,
  };
}

/**
 * @deprecated Use inferDependencies from '../utils/dependency-engine' instead (IR-08-03)
 * Re-exported for backward compatibility.
 */
export { inferDependencies } from '../utils/dependency-engine';

/**
 * Format priority
 * Supports two formats: P0/P1/P2/P3/Q1-Q4 and low/medium/high/urgent
 */
function formatPriority(priority: TaskPriority | string): string {
  const map: Record<string, string> = {
    // P0-P3 format
    P0: '🔴 P0 Urgent',
    P1: '🟠 P1 High',
    P2: '🟡 P2 Medium',
    P3: '🟢 P3 Low',
    // Q1-Q4 quadrant format
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
    // low-urgent format (backward compatibility)
    low: '🟢 Low',
    medium: '🟡 Medium',
    high: '🟠 High',
    urgent: '🔴 Urgent',
  };
  return map[priority] || `❓ ${priority}`;
}

/**
 * 从分解后的任务项创建单个任务
 * 用于分解流程中创建子任务
 */
async function initRequirementSingle(
  item: DecomposedTaskItem,
  cwd: string,
  options: InitRequirementOptions
): Promise<string | null> {
  const { template = 'simple', nonInteractive = true, skipValidation = true, requireQuality } = options;

  try {
    // 生成结构化描述
    const structuredData = {
      problem: item.description,
      rootCause: '',
      solution: '',
      checkpoints: item.suggestedCheckpoints,
      relatedFiles: item.relatedFiles,
      notes: '',
    };

    const finalDescription = generateStructuredDescription(structuredData, template);

    // 创建任务
    const task = await createTask({
      title: item.title,
      description: finalDescription,
      type: item.type,
      priority: item.priority,
      nonInteractive,
      skipValidation,
      aiEnhancement: false,
      suggestedCheckpoints: item.suggestedCheckpoints,
      potentialDependencies: [],
    }, cwd);

    const taskId = task.id;

    // 质量门禁检查
    if (requireQuality !== undefined) {
      const qualityGateConfig = {
        ...DEFAULT_QUALITY_GATE_CONFIG,
        minQualityScore: requireQuality,
      };

      const qualityResult = await checkQualityGate(taskId, qualityGateConfig, cwd);

      // 将质量评分写入任务元数据
      const taskWithScore = readTaskMeta(taskId, cwd);
      if (taskWithScore) {
        taskWithScore.initQualityScore = qualityResult.score.totalScore;
        writeTaskMeta(taskWithScore, cwd);
      }
    }

    console.log(`  ✅ ${taskId}: ${item.title}`);

    return taskId;
  } catch (error) {
    console.error(`  ❌ Failed to create task: ${item.title}`);
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 格式化分解项为任务描述
 * 支持 DecomposedTaskItem 和 DecomposedItem 两种类型
 */
function formatItemDescription(item: DecomposedTaskItem | DecomposedItem): string {
  const sections: string[] = [];

  // 判断是否为 DecomposedItem 类型（包含 problem 字段）
  if ('problem' in item) {
    // DecomposedItem 格式：包含 problem、rootCause、solution
    sections.push(`## 问题描述\n${item.problem}`);
    if (item.rootCause && item.rootCause.trim().length > 0) {
      sections.push(`## 根因分析\n${item.rootCause}`);
    }
    sections.push(`## 解决方案\n${item.solution}`);
    if (item.checkpoints.length > 0) {
      sections.push(`## 检查点\n${item.checkpoints.map(cp => `- ${cp}`).join('\n')}`);
    }
  } else {
    // DecomposedTaskItem 格式：包含 description
    sections.push(`## 问题描述\n${item.description}`);
    sections.push(`## 解决方案\n实现 ${item.title}`);
    if (item.suggestedCheckpoints.length > 0) {
      sections.push(`## 检查点\n${item.suggestedCheckpoints.map(cp => `- ${cp}`).join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * 报告批量创建结果
 */
function reportBatchResult(
  created: string[],
  failed: { item: DecomposedTaskItem; reason: string }[],
  totalCount: number
): void {
  console.log('\n' + '━'.repeat(50));
  console.log('📊 Batch creation completed');
  console.log('━'.repeat(50));
  console.log(`   Success: ${created.length}/${totalCount}`);

  if (created.length > 0) {
    console.log(`   Task list:`);
    created.forEach(id => console.log(`     - ${id}`));
  }

  if (failed.length > 0) {
    console.log(`   Failed: ${failed.length}`);
    failed.forEach(f => console.log(`     - ${f.item.title}: ${f.reason}`));
  }
}

/**
 * 批量创建任务
 * 用于分解流程中批量创建多个子任务
 */
async function initRequirementBatch(
  items: DecomposedTaskItem[],
  cwd: string,
  options: InitRequirementOptions
): Promise<void> {
  const createdTaskIds: string[] = [];
  const failedTasks: { item: DecomposedTaskItem; reason: string }[] = [];
  const taskIdMap = new Map<number, string>(); // 索引 -> 任务ID 映射

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📝 Decomposition result: ${items.length} tasks`);
  items.forEach((item, i) => {
    console.log(`   ${i + 1}. [${item.priority}] ${item.title}`);
  });
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // Stage 1: Batch create tasks
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📝 Creating tasks...');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    console.log(`Creating task ${i + 1}/${items.length}...`);

    const itemOptions: InitRequirementOptions = {
      ...options,
      nonInteractive: true, // 子任务使用非交互模式
      decompose: false, // 防止递归分解
    };

    try {
      const taskId = await initRequirementSingle(item, cwd, itemOptions);
      if (taskId) {
        createdTaskIds.push(taskId);
        taskIdMap.set(i, taskId);
        console.log(`✅ ${taskId}`);
      } else {
        failedTasks.push({ item, reason: 'Creation failed (returned null)' });
        console.log(`❌ Failed: returned null`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failedTasks.push({ item, reason });
      console.log(`❌ Failed: ${reason}`);
    }
  }

  // Stage 2: Update dependencies
  if (createdTaskIds.length > 0) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔗 Setting up task dependencies...');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const taskId = taskIdMap.get(i);
      if (!taskId || item.dependsOn.length === 0) continue;

      const task = readTaskMeta(taskId, cwd);
      if (!task) continue;

      const deps: string[] = [];
      for (const depIndex of item.dependsOn) {
        const depId = taskIdMap.get(depIndex);
        if (depId && !deps.includes(depId)) {
          deps.push(depId);
        }
      }

      if (deps.length > 0) {
        task.dependencies = [...(task.dependencies || []), ...deps];
        writeTaskMeta(task, cwd);
        console.log(`  ${taskId} dependencies: ${deps.join(', ')}`);
      }
    }
  }

  // Stage 3: Report batch creation results
  reportBatchResult(createdTaskIds, failedTasks, items.length);
}
