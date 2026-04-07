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
import { extractAffectedFiles, extractFilePaths, checkQualityGate, type QualityGateConfig, DEFAULT_QUALITY_GATE_CONFIG } from '../utils/quality-gate';
import { hasValidCheckpoints, displayCheckpointCreationWarning } from './task';
import { syncCheckpointsToMeta, filterLowQualityCheckpoints } from '../utils/checkpoint';
import { inferDependencies as inferDependenciesUnified, type InferredDependency } from '../utils/dependency-engine';
import type { TaskMeta, TaskPriority, TaskStatus, TaskType } from '../types/task';
import { createDefaultTaskMeta, inferTaskType, validateCheckpointVerification } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { createLogger, type InstrumentationRecord, type AICostSummary } from '../utils/logger';
import { withAIEnhancement } from '../utils/ai-helpers';
import { AIMetadataAssistant, type EnhancedRequirement, classifyFileToLayer, groupFilesByLayer, sortFilesByLayer, type ArchitectureLayer, LAYER_DEFINITIONS } from '../utils/ai-metadata';

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
  const { nonInteractive = false, noPlan = false, skipValidation = false, template = 'simple', autoSplit = false, noAI = false, requireQuality } = options;

  // CP-2: 模块日志 + 埋点初始化
  const logger = createLogger('init-requirement', cwd);
  const startTime = Date.now();
  const inputDescLength = description.length;
  let userEditCount = 0;

  if (!isInitialized(cwd)) {
    console.error('');
    console.error('❌ 项目未初始化');
    console.error('');
    console.error('  请先运行以下命令初始化项目管理环境:');
    console.error('    projmnt4claude setup');
    console.error('');
    console.error('  初始化后即可使用 init-requirement 创建任务。');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 正在分析需求...');
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
      operationName: '增强调用',
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
  const complexity = assessComplexity(description, analysis);

  // 显示分析结果
  const aiTag = (field: string) => analysis.aiEnhancedFields.includes(field) ? ' (AI enhanced)' : '';
  console.log('📋 需求分析结果:');
  console.log('');
  console.log(`  标题: ${analysis.title}${aiTag('title')}`);
  console.log(`  优先级: ${formatPriority(analysis.priority)}${aiTag('priority')}`);
  console.log(`  复杂度: ${formatComplexity(complexity)}`);
  console.log(`  推荐角色: ${analysis.recommendedRole}${aiTag('recommendedRole')}`);
  console.log(`  涉及文件: ${complexity.fileCount} 个`);
  console.log(`  工作项: ${complexity.workItemCount} 项`);
  console.log(`  预估耗时: ~${complexity.estimatedMinutes} 分钟`);
  if (analysis.aiUsed) {
    console.log(`  AI 增强: ${analysis.aiEnhancedFields.join(', ')}`);
  }
  console.log('');

  // 复杂度预警
  if (complexity.level === 'high') {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('⚠️  复杂度预警');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');
    console.log(`  此任务预估耗时 ${complexity.estimatedMinutes} 分钟，超过 Harness 默认超时阈值。`);
    console.log('  建议将此任务拆分为多个子任务，每个子任务控制在 15 分钟以内。');
    console.log('');

    if (complexity.splitSuggestions.length > 0) {
      console.log('  拆分建议:');
      for (let i = 0; i < complexity.splitSuggestions.length; i++) {
        const s = complexity.splitSuggestions[i];
        if (!s) continue;
        const depLabel = s.dependsOn >= 0 ? ` (依赖子任务 ${s.dependsOn + 1})` : '';
        console.log(`    ${i + 1}. ${s.title}${depLabel}`);
        console.log(`       文件: ${s.files.length > 0 ? s.files.join(', ') : '未指定'}`);
        console.log(`       预估: ~${s.estimatedMinutes} 分钟`);
      }
      console.log('');
    }
  }

  if (analysis.suggestedCheckpoints.length > 0) {
    console.log(`  建议检查点${aiTag('checkpoints')}:`);
    for (const cp of analysis.suggestedCheckpoints) {
      console.log(`    - ${cp}`);
    }
    console.log('');
  }

  if (analysis.potentialDependencies.length > 0) {
    console.log(`  潜在依赖${aiTag('dependencies')}:`);
    for (const dep of analysis.potentialDependencies) {
      console.log(`    - ${dep}`);
    }
    console.log('');
  }

  // 确认创建（非交互模式自动确认）
  let confirmCreate = { confirm: true };
  if (!nonInteractive) {
    confirmCreate = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '是否基于此分析创建任务?',
      initial: true,
    });
  }

  if (!confirmCreate.confirm) {
    console.log('');
    console.log('ℹ️  已取消任务创建。');
    console.log('   如需重新创建，请再次运行 init-requirement 命令。');
    console.log('');
    // CP-8 埋点: 用户取消
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'cancel',
      input_summary: `desc_len=${inputDescLength}`,
      output_summary: '用户取消创建',
      ai_used: analysis.aiUsed,
      ai_enhanced_fields: analysis.aiEnhancedFields,
      duration_ms: Date.now() - startTime,
      user_edit_count: 0,
      module_data: { cancel_reason: 'user_rejected_confirm' },
    });
    logger.flush();
    return;
  }

  // 允许用户修改（非交互模式使用分析结果）
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
        message: '任务标题',
        initial: analysis.title,
      },
      {
        type: 'text',
        name: 'description',
        message: '任务描述',
        initial: analysis.description,
      },
      {
        type: 'select',
        name: 'priority',
        message: '优先级',
        choices: [
          { title: 'P3 低', value: 'P3' },
          { title: 'P2 中', value: 'P2', selected: analysis.priority === 'P2' },
          { title: 'P1 高', value: 'P1', selected: analysis.priority === 'P1' },
          { title: 'P0 紧急', value: 'P0', selected: analysis.priority === 'P0' },
        ],
        initial: analysis.priority === 'P3' ? 0 : analysis.priority === 'P2' ? 1 : analysis.priority === 'P1' ? 2 : 3,
      },
      {
        type: 'text',
        name: 'recommendedRole',
        message: '推荐角色',
        initial: analysis.recommendedRole,
      },
    ]);
    response = promptResponse as { title: string; description: string; priority: string; recommendedRole: string };

    // CP-8: 追踪用户编辑回退率（对比用户输入 vs 规则建议）
    if (response.title !== analysis.title) userEditCount++;
    if (response.priority !== analysis.priority) userEditCount++;
    if (response.recommendedRole !== analysis.recommendedRole) userEditCount++;
  }

  if (!response.title) {
    console.log('');
    console.log('ℹ️  已取消任务创建（标题不能为空）。');
    console.log('   如需重新创建，请再次运行 init-requirement 命令。');
    console.log('');
    logger.logInstrumentation({
      module: 'init-requirement',
      action: 'cancel',
      input_summary: `desc_len=${inputDescLength}`,
      output_summary: '标题为空，取消创建',
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
  const taskId = generateNewTaskId(cwd, taskType, taskPriority, response.title);

  // 创建任务元数据
  const task = createDefaultTaskMeta(taskId, response.title, taskType, undefined, 'init-requirement');

  // 生成结构化描述
  const structuredInfo = extractStructuredInfo(response.description || analysis.description);
  const inferredCheckpoints = inferCheckpointsFromDescription(response.description || analysis.description, taskType);
  const inferredFiles = inferRelatedFiles(response.description || analysis.description, taskType);

  // 合并提取的检查点和推断的检查点
  const allCheckpoints = [...new Set([...structuredInfo.checkpoints, ...inferredCheckpoints, ...analysis.suggestedCheckpoints])];
  const allRelatedFiles = [...new Set([...structuredInfo.relatedFiles, ...inferredFiles])];

  // 构建结构化描述数据
  const structuredData: StructuredDescription = {
    problem: structuredInfo.problem || analysis.description,
    rootCause: structuredInfo.rootCause,
    solution: structuredInfo.solution,
    checkpoints: allCheckpoints.length > 0 ? allCheckpoints : analysis.suggestedCheckpoints,
    relatedFiles: allRelatedFiles,
    notes: structuredInfo.notes,
  };

  // 根据模板类型生成描述
  task.description = generateStructuredDescription(structuredData, template as DescriptionTemplateType);
  task.priority = response.priority as TaskPriority;
  task.recommendedRole = response.recommendedRole || analysis.recommendedRole;

  // 推断依赖关系（文件重叠 + AI potentialDependencies 标题匹配）
  // IR-08-03: 使用统一依赖推断引擎
  const existingTasksForDeps = getAllTasks(cwd);
  const inferredDeps = inferDependenciesUnified(
    task.description || '',
    existingTasksForDeps,
    { keywordHints: analysis.potentialDependencies },
  );

  // 将推断的依赖写入 task.dependencies
  if (inferredDeps.length > 0) {
    task.dependencies = inferredDeps.map(d => d.depTaskId);
  }

  // 写入任务
  writeTaskMeta(task, cwd);

  // 创建 checkpoint.md（使用合并后的检查点集合，包含结构化提取+智能推断+分析建议）
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  const checkpointsRaw = allCheckpoints.length > 0 ? allCheckpoints : analysis.suggestedCheckpoints;

  // 过滤低质量检查点（AI 解析伪影）
  const filterResult = filterLowQualityCheckpoints(checkpointsRaw);
  if (filterResult.removed.length > 0) {
    console.log(`   🔍 已过滤 ${filterResult.removed.length} 个低质量检查点:`);
    for (const removed of filterResult.removed) {
      const reason = filterResult.reasons.get(removed) || '未知原因';
      console.log(`     - "${removed}" (${reason})`);
    }
  }
  const checkpoints = filterResult.kept;

  const checkpointContent = `# ${taskId} 检查点

${checkpoints.map((cp: string) => `- [ ] ${cp}`).join('\n')}
`;
  fs.writeFileSync(checkpointPath, checkpointContent, 'utf-8');

  // 同步检查点到 meta.json（包含验证信息推断)
  syncCheckpointsToMeta(taskId, cwd);

  // BUG-013-2: 验证检查点验证命令完整性
  const updatedTask = readTaskMeta(taskId, cwd);
  if (updatedTask?.checkpoints) {
    const checkpointsWithoutCommands = updatedTask.checkpoints.filter(cp => {
      const result = validateCheckpointVerification(cp);
      return !result.valid;
    });
    if (checkpointsWithoutCommands.length > 0) {
      console.log(`\n   ⚠️  ${checkpointsWithoutCommands.length} 个检查点验证命令缺失:`);
      for (const cp of checkpointsWithoutCommands) {
        const result = validateCheckpointVerification(cp);
        console.log(`   - [${cp.id}] ${result.warning || cp.description}`);
      }
    }
  }

  console.log(`✅ 任务创建成功!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   标题: ${task.title}`);
  console.log(`   优先级: ${formatPriority(task.priority)}`);
  console.log(`   检查点: ${checkpoints.length} 项`);
  if (inferredDeps.length > 0) {
    console.log(`   推断依赖:`);
    for (const dep of inferredDeps) {
      const sharedInfo = dep.overlappingFiles.length > 0 ? `(共享文件: ${dep.overlappingFiles.join(', ')})` : '';
      const sourceLabel = dep.source === 'keyword' ? '[关键词] ' : '';
      console.log(`     - ${dep.depTaskId} ${sourceLabel}${sharedInfo}`);
    }
  }
  console.log('');

  // CP-1/CP-6: 质量门禁检查 - 任务创建后调用 checkQualityGate 并显示评分
  const qualityGateConfig: QualityGateConfig = {
    ...DEFAULT_QUALITY_GATE_CONFIG,
    minQualityScore: requireQuality ?? DEFAULT_QUALITY_GATE_CONFIG.minQualityScore,
  };

  if (qualityGateConfig.minQualityScore < 0 || qualityGateConfig.minQualityScore > 100) {
    console.error('错误: --require-quality 必须在 0-100 之间');
    process.exit(1);
  }

  const qualityResult = await checkQualityGate(taskId, qualityGateConfig, cwd);

  // CP-6: 显示质量评分
  const scoreIcon = qualityResult.score.totalScore >= 80 ? '🟢' :
                    qualityResult.score.totalScore >= 60 ? '🟡' : '🔴';
  console.log(`📊 质量评分: ${scoreIcon} ${qualityResult.score.totalScore}/100`);
  console.log(`   描述完整度: ${qualityResult.score.descriptionScore}%`);
  console.log(`   检查点质量: ${qualityResult.score.checkpointScore}%`);
  console.log(`   关联文件: ${qualityResult.score.relatedFilesScore}%`);
  console.log(`   解决方案: ${qualityResult.score.solutionScore}%`);
  console.log('');

  // CP-3/CP-7: --require-quality 阻止低质量任务创建
  if (requireQuality !== undefined && !qualityResult.passed) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`❌ 质量门禁未通过: ${qualityResult.score.totalScore} < ${requireQuality}`);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    // 显示改进建议
    if (qualityResult.suggestions.length > 0) {
      const sorted = [...qualityResult.suggestions].sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      });
      console.log('💡 改进建议:');
      for (const s of sorted.slice(0, 5)) {
        const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟠' : '🟡';
        console.log(`  ${icon} [${s.category}] ${s.message}`);
        console.log(`     👉 ${s.action}`);
      }
      console.log('');
    }

    console.log(`任务 ${taskId} 已创建但未通过质量门禁 (分数 ${qualityResult.score.totalScore} < 阈值 ${requireQuality})。`);
    console.log('请完善任务描述后重新创建，或使用较低的 --require-quality 阈值。');
    console.log('');

    // 记录埋点
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

  // CP-2: 质量不达标时输出警告和改进建议（不阻断创建）
  if (!qualityResult.passed) {
    console.log('⚠️  质量门禁警告: 任务质量评分低于默认阈值，建议改进');
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

  // 自动拆分复杂任务
  if (autoSplit && complexity.level === 'high' && complexity.splitSuggestions.length > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔀 自动拆分复杂任务...');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const subtaskIds: string[] = [];

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

      // 关联到父任务（更新父任务 subtaskIds 和 history）
      addSubtaskToParent(taskId, subId, cwd);

      console.log(`  ${i + 1}. ${subId}: ${sub.title}`);
      console.log(`     文件: ${sub.files.length > 0 ? sub.files.join(', ') : '待确认'}`);
      console.log(`     预估: ~${sub.estimatedMinutes} 分钟`);
      if (subTask.dependencies && subTask.dependencies.length > 0) {
        console.log(`     依赖: ${subTask.dependencies.join(', ')}`);
      }
      console.log('');
    }

    // CP-2 (IR-01-05): 对每个子任务调用 inferDependencies 推断文件重叠依赖
    const allTasksForSubDeps = getAllTasks(cwd);
    for (const subId of subtaskIds) {
      const subTaskMeta = readTaskMeta(subId, cwd);
      if (!subTaskMeta) continue;

      const subDeps = inferDependenciesUnified(subTaskMeta, allTasksForSubDeps, { strategy: 'file-overlap' });
      if (subDeps.length > 0) {
        const existingDeps = subTaskMeta.dependencies || [];
        const newDepIds = subDeps
          .map(d => d.depTaskId)
          .filter(id => !existingDeps.includes(id));
        if (newDepIds.length > 0) {
          subTaskMeta.dependencies = [...existingDeps, ...newDepIds];
          writeTaskMeta(subTaskMeta, cwd);
        }
      }
    }

    console.log(`✅ 已拆分为 ${complexity.splitSuggestions.length} 个子任务`);
    console.log(`   父任务: ${taskId}`);
    console.log('');
  }
  if (!skipValidation) {
    const validation = hasValidCheckpoints(checkpointPath, false);
    if (!validation.valid) {
      displayCheckpointCreationWarning(taskId, cwd);
    }
  }

  // 询问是否添加到执行计划（非交互模式或 noPlan 时跳过）
  if (!noPlan && !nonInteractive) {
    const addToPlan = await prompts({
      type: 'confirm',
      name: 'add',
      message: '是否将此任务添加到执行计划?',
      initial: true,
    });

    if (addToPlan.add) {
      // 动态导入 plan 模块
      const planModule = await import('./plan');
      planModule.addTask(taskId);
    }
  }

  // CP-8: 记录 init-requirement 埋点
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
 * 格式化复杂度显示
 */
function formatComplexity(assessment: ComplexityAssessment): string {
  const icons: Record<string, string> = {
    low: '🟢 low',
    medium: '🟡 medium',
    high: '🔴 high',
  };
  return `${icons[assessment.level]} (评分: ${assessment.score}/100)`;
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
 * - 文件数量: 涉及文件越多越复杂
 * - 工作项数量: 独立动作越多越复杂
 * - 跨模块引用: 跨越多模块增加复杂度
 * - 检查点数量: 需要验证的点越多越复杂
 * - 描述长度: 过长的描述往往暗示范围不清晰
 */
export function assessComplexity(
  description: string,
  analysis: RequirementAnalysis
): ComplexityAssessment {
  const signals: ComplexitySignal[] = [];

  // 1. 文件数量信号
  const files = extractFilePaths(description);
  const fileCount = files.length;
  const fileWeight = Math.min(fileCount * 8, 30); // 每文件 8 分，上限 30
  signals.push({
    type: 'file_count',
    weight: fileWeight,
    description: `涉及 ${fileCount} 个文件`,
  });

  // 2. 工作项信号
  const workItemCount = countWorkItems(description);
  const workItemWeight = Math.min(workItemCount * 5, 25); // 每项 5 分，上限 25
  signals.push({
    type: 'work_items',
    weight: workItemWeight,
    description: `包含 ${workItemCount} 个工作项`,
  });

  // 3. 跨模块信号
  const crossModuleCount = countCrossModuleReferences(description);
  const crossModuleWeight = Math.min(crossModuleCount * 6, 20); // 每引用 6 分，上限 20
  signals.push({
    type: 'cross_module',
    weight: crossModuleWeight,
    description: `跨 ${crossModuleCount} 个模块/系统`,
  });

  // 4. 检查点数量信号
  const checkpointCount = analysis.suggestedCheckpoints.length;
  const checkpointWeight = Math.min(checkpointCount * 4, 15); // 每检查点 4 分，上限 15
  signals.push({
    type: 'checkpoint_count',
    weight: checkpointWeight,
    description: `包含 ${checkpointCount} 个检查点`,
  });

  // 5. 描述长度信号
  const descLength = description.length;
  const descWeight = descLength > 500 ? 10 : descLength > 200 ? 5 : 0;
  signals.push({
    type: 'description_length',
    weight: descWeight,
    description: `描述长度 ${descLength} 字符`,
  });

  // 6. 动作密度信号 (动作动词数量 / 描述长度)
  const actionVerbPattern = /(?:验证|修复|创建|修改|添加|实现|配置|部署|更新|增强|完善|重构|编写|分析|处理|集成|迁移|支持|移除|检查|测试)/g;
  const actionVerbMatches = description.match(actionVerbPattern);
  const actionVerbCount = actionVerbMatches ? actionVerbMatches.length : 0;
  const actionDensityWeight = actionVerbCount > 10 ? 10 : actionVerbCount > 5 ? 5 : 0;
  signals.push({
    type: 'action_verb_density',
    weight: actionDensityWeight,
    description: `包含 ${actionVerbCount} 个动作动词`,
  });

  // 计算总分
  const totalScore = Math.min(
    signals.reduce((sum, s) => sum + s.weight, 0),
    100
  );

  // 确定等级
  let level: 'low' | 'medium' | 'high';
  if (totalScore >= 40) {
    level = 'high';
  } else if (totalScore >= 20) {
    level = 'medium';
  } else {
    level = 'low';
  }

  // 预估耗时: 基于文件数和工作项数
  // 经验值: 每文件 ~3分钟 + 每工作项 ~2分钟 + 基础 5 分钟
  const estimatedMinutes = Math.max(
    5 + fileCount * 3 + workItemCount * 2,
    Math.ceil(descLength / 100) // 备选: 每百字 1 分钟
  );

  // 超过 15 分钟强制标记为 high
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
  const finalSuggestions: SplitSuggestion[] = [];
  for (const s of suggestions) {
    if (s.estimatedMinutes <= 15) {
      finalSuggestions.push(s);
    } else {
      // 子任务仍然太大，按层级排序后拆分
      const sortedFiles = sortFilesByLayer(s.files);
      const half = Math.ceil(sortedFiles.length / 2);
      if (half > 0 && sortedFiles.length > 1) {
        finalSuggestions.push({
          ...s,
          title: `${s.title} (前半)`,
          files: sortedFiles.slice(0, half),
          estimatedMinutes: Math.ceil(s.estimatedMinutes / 2),
        });
        finalSuggestions.push({
          ...s,
          title: `${s.title} (后半)`,
          files: sortedFiles.slice(half),
          estimatedMinutes: Math.ceil(s.estimatedMinutes / 2),
          dependsOn: finalSuggestions.length - 1,
        });
      } else {
        finalSuggestions.push(s);
      }
    }
  }

  return finalSuggestions;
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

  // 检测推荐角色
  let recommendedRole = 'developer';
  if (lowerDesc.includes('ui') || lowerDesc.includes('界面') || lowerDesc.includes('前端') || lowerDesc.includes('frontend')) {
    recommendedRole = 'frontend';
  } else if (lowerDesc.includes('api') || lowerDesc.includes('后端') || lowerDesc.includes('backend') || lowerDesc.includes('服务端')) {
    recommendedRole = 'backend';
  } else if (lowerDesc.includes('测试') || lowerDesc.includes('test') || lowerDesc.includes('qa')) {
    recommendedRole = 'qa';
  } else if (lowerDesc.includes('文档') || lowerDesc.includes('document') || lowerDesc.includes('readme')) {
    recommendedRole = 'writer';
  } else if (lowerDesc.includes('安全') || lowerDesc.includes('security') || lowerDesc.includes('漏洞')) {
    recommendedRole = 'security';
  } else if (lowerDesc.includes('性能') || lowerDesc.includes('performance') || lowerDesc.includes('优化')) {
    recommendedRole = 'performance';
  } else if (lowerDesc.includes('架构') || lowerDesc.includes('architecture') || lowerDesc.includes('设计')) {
    recommendedRole = 'architect';
  }

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
  const currentFiles = extractFilePaths(description);
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
 * 格式化优先级
 * 支持两种格式: P0/P1/P2/P3/Q1-Q4 和 low/medium/high/urgent
 */
function formatPriority(priority: TaskPriority | string): string {
  const map: Record<string, string> = {
    // P0-P3 格式
    P0: '🔴 P0 紧急',
    P1: '🟠 P1 高',
    P2: '🟡 P2 中',
    P3: '🟢 P3 低',
    // Q1-Q4 象限格式
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
    // low-urgent 格式（兼容旧数据）
    low: '🟢 低',
    medium: '🟡 中',
    high: '🟠 高',
    urgent: '🔴 紧急',
  };
  return map[priority] || `❓ ${priority}`;
}
