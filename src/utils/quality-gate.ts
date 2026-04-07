/**
 * 质量门禁检查器
 *
 * 在 Harness 执行前验证任务质量，确保执行者理解解决方案
 *
 * 功能：
 * 1. 方案验证检查点：任务开始前要求确认理解解决方案
 * 2. 影响文件清单：任务必须关联受影响文件列表
 * 3. 变更范围预估：标记 small/medium/large 变更
 * 4. --require-quality N 参数：质量分低于N时自动提示完善
 */

import type { TaskMeta } from '../types/task.js';
import {
  calculateContentQuality,
  type ContentQualityScore,
  type QualityDeduction,
} from '../commands/analyze.js';
import { readTaskMeta } from './task.js';
import { SEPARATOR_WIDTH } from './format';
import { getQualityMinScore, qualityScoreToVerdict } from './contradiction-detector.js';

/**
 * 变更范围大小
 */
export type ChangeSize = 'small' | 'medium' | 'large';

/**
 * 质量门禁检查结果
 */
export interface QualityGateResult {
  /** 是否通过门禁 */
  passed: boolean;
  /** 质量评分 */
  score: ContentQualityScore;
  /** 任务ID */
  taskId: string;
  /** 是否需要确认理解 */
  requiresConfirmation: boolean;
  /** 缺失的必需字段 */
  missingFields: string[];
  /** 改进建议 */
  suggestions: QualityGateSuggestion[];
  /** 受影响文件列表 */
  affectedFiles: string[];
  /** 变更范围预估 */
  changeSize: ChangeSize;
}

/**
 * 质量门禁改进建议
 */
export interface QualityGateSuggestion {
  category: 'description' | 'checkpoint' | 'related_files' | 'solution' | 'confirmation';
  priority: 'high' | 'medium' | 'low';
  message: string;
  action: string;
}

/**
 * 质量门禁配置
 */
export interface QualityGateConfig {
  /** 最低质量分阈值 (0-100) */
  minQualityScore: number;
  /** 是否要求解决方案确认 */
  requireSolutionConfirmation: boolean;
  /** 是否要求关联文件列表 */
  requireAffectedFiles: boolean;
  /** 是否要求变更范围预估 */
  requireChangeSize: boolean;
  /** 是否启用门禁检查 */
  enabled: boolean;
}

/**
 * 默认质量门禁配置
 */
export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  minQualityScore: 60,
  requireSolutionConfirmation: true,
  requireAffectedFiles: true,
  requireChangeSize: false,
  enabled: true,
};

/**
 * 批量质量门禁检查结果
 */
export interface BatchQualityGateResult {
  /** 总任务数 */
  totalTasks: number;
  /** 通过门禁的任务数 */
  passedCount: number;
  /** 未通过门禁的任务数 */
  failedCount: number;
  /** 各任务检查结果 */
  results: Map<string, QualityGateResult>;
  /** 是否全部通过 */
  allPassed: boolean;
  /** 阻塞执行的任务列表 */
  blockedTasks: string[];
}

/**
 * 从文本中统一提取文件路径
 *
 * 使用3级正则模式（优先前缀路径 > 带分隔符文件名 > 裸文件名）：
 * 1. 优先: src/lib/app/pkg/cmd/internal/api 等前缀路径 + 相对路径
 * 2. 次要: 带目录分隔符的文件名（至少包含一个 /）
 * 3. 兜底: 裸文件名（可通过 includeBareFilenames=false 关闭）
 */
export function extractFilePaths(
  text: string,
  options?: { includeBareFilenames?: boolean }
): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const includeBare = options?.includeBareFilenames !== false;

  const patterns: RegExp[] = [
    // Level 1: 标准源码目录前缀路径
    /(?:src|lib|app|pkg|cmd|internal|api|test|tests|docs|bin|scripts|config)\/[\w/.-]+\.[a-z]+/g,
    // Level 1: 相对路径
    /\.{1,2}\/[\w/.-]+\.[a-z]+/g,
    // Level 2: 带目录分隔符的文件路径（至少包含一个 /）
    /[\w-]+\/[\w/.-]+\.(ts|tsx|js|jsx|py|go|java|rs|md|json|yaml|yml)/g,
  ];

  if (includeBare) {
    // Level 3: 裸文件名
    patterns.push(/\b[\w-]+\.(ts|tsx|js|jsx|py|go|java|rs|json|yaml|yml|md)\b/g);
  }

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
 * 从任务描述中提取受影响文件列表
 * 导出供 init-requirement 等模块复用
 */
export function extractAffectedFiles(task: TaskMeta): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const description = task.description || '';

  // 匹配 "## 相关文件" 部分
  const relatedFilesMatch = description.match(/##\s*相关文件\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (relatedFilesMatch && relatedFilesMatch[1]) {
    const lines = relatedFilesMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 "- src/xxx" 或 "src/xxx" 格式
      const fileMatch = trimmed.match(/^-?\s*(?:\[[ x]\])?\s*(.+\.[a-z]+)$/);
      if (fileMatch && fileMatch[1]) {
        const file = fileMatch[1].trim();
        if (!seen.has(file)) {
          seen.add(file);
          files.push(file);
        }
      }
    }
  }

  // 使用统一的 extractFilePaths 提取路径
  const extracted = extractFilePaths(description);
  for (const file of extracted) {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }

  // 从检查点中提取
  if (task.checkpoints) {
    for (const cp of task.checkpoints) {
      if (cp.verification?.evidencePath) {
        const cpFiles = cp.verification.evidencePath.split(',').map(f => f.trim());
        for (const file of cpFiles) {
          if (!seen.has(file)) {
            seen.add(file);
            files.push(file);
          }
        }
      }
    }
  }

  return files;
}

/**
 * 推断变更范围大小
 */
function inferChangeSize(task: TaskMeta, affectedFiles: string[]): ChangeSize {
  // 基于文件数量推断
  if (affectedFiles.length >= 10) return 'large';
  if (affectedFiles.length >= 3) return 'medium';

  // 基于描述关键词推断
  const description = (task.description || '').toLowerCase();
  if (description.includes('重构') || description.includes('refactor') ||
      description.includes('迁移') || description.includes('migrate') ||
      description.includes('架构') || description.includes('architecture')) {
    return 'large';
  }

  if (description.includes('新增功能') || description.includes('new feature') ||
      description.includes('集成') || description.includes('integration')) {
    return 'medium';
  }

  // 基于检查点数量推断
  if (task.checkpoints && task.checkpoints.length >= 5) return 'large';
  if (task.checkpoints && task.checkpoints.length >= 3) return 'medium';

  return 'small';
}

/**
 * 检查是否需要解决方案确认
 */
function requiresSolutionConfirmation(task: TaskMeta): boolean {
  const description = task.description || '';

  // 检查是否有解决方案部分
  const hasSolutionSection = /##\s*解决方案|##\s*方案/i.test(description);

  // 检查是否有明确的实现步骤
  const hasImplementationSteps = /实现步骤|实施步骤|implementation steps/i.test(description);

  // 如果有解决方案或实施步骤，需要确认
  return hasSolutionSection || hasImplementationSteps;
}

/**
 * 生成质量门禁建议
 */
function generateSuggestions(
  task: TaskMeta,
  score: ContentQualityScore,
  affectedFiles: string[],
  changeSize: ChangeSize,
  requiresConfirmation: boolean
): QualityGateSuggestion[] {
  const suggestions: QualityGateSuggestion[] = [];

  // 基于扣分项生成建议
  for (const deduction of score.deductions) {
    const suggestion: QualityGateSuggestion = {
      category: deduction.category,
      priority: deduction.points <= -20 ? 'high' : deduction.points <= -10 ? 'medium' : 'low',
      message: deduction.reason,
      action: deduction.suggestion || '请补充相关内容',
    };
    suggestions.push(suggestion);
  }

  // 检查关联文件
  if (affectedFiles.length === 0) {
    suggestions.push({
      category: 'related_files',
      priority: 'high',
      message: '任务缺少受影响文件清单',
      action: '在描述中添加 "## 相关文件" 部分，列出需要修改的源文件',
    });
  }

  // 检查解决方案确认
  if (requiresConfirmation && score.solutionScore < 70) {
    suggestions.push({
      category: 'confirmation',
      priority: 'medium',
      message: '解决方案需要更清晰的描述',
      action: '确保解决方案部分包含具体的实现步骤和预期结果',
    });
  }

  // 检查检查点质量
  if (score.checkpointScore < 60) {
    suggestions.push({
      category: 'checkpoint',
      priority: 'high',
      message: '检查点质量较低，可能过于泛化',
      action: '使用更具体的检查点描述，如"实现用户登录 API"而非"核心功能实现"',
    });
  }

  // 检查变更范围预估
  if (changeSize === 'large' && affectedFiles.length < 3) {
    suggestions.push({
      category: 'related_files',
      priority: 'medium',
      message: '大范围变更但关联文件较少，可能遗漏',
      action: '检查是否遗漏了需要修改的文件，补充完整的影响文件清单',
    });
  }

  return suggestions;
}

/**
 * 检查单个任务的质量门禁
 */
export async function checkQualityGate(
  taskId: string,
  config: QualityGateConfig = DEFAULT_QUALITY_GATE_CONFIG,
  cwd: string = process.cwd()
): Promise<QualityGateResult> {
  // IR-08-06: 读取配置的 quality.minScore 覆盖默认阈值
  const configuredMinScore = getQualityMinScore(cwd);
  const effectiveConfig: QualityGateConfig = {
    ...config,
    minQualityScore: config.minQualityScore === DEFAULT_QUALITY_GATE_CONFIG.minQualityScore
      ? configuredMinScore
      : config.minQualityScore,
  };
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    return {
      passed: false,
      score: {
        totalScore: 0,
        descriptionScore: 0,
        checkpointScore: 0,
        relatedFilesScore: 0,
        solutionScore: 0,
        deductions: [{
          category: 'description',
          reason: '任务不存在',
          points: -100,
        }],
        checkedAt: new Date().toISOString(),
      },
      taskId,
      requiresConfirmation: false,
      missingFields: ['task_meta'],
      suggestions: [{
        category: 'description',
        priority: 'high',
        message: '任务不存在',
        action: '请检查任务ID是否正确',
      }],
      affectedFiles: [],
      changeSize: 'small',
    };
  }

  // 计算内容质量评分
  const score = await calculateContentQuality(task, undefined, cwd);

  // 提取受影响文件
  const affectedFiles = extractAffectedFiles(task);

  // 推断变更范围
  const changeSize = inferChangeSize(task, affectedFiles);

  // 检查是否需要确认
  const needsConfirmation = requiresSolutionConfirmation(task);

  // 检查缺失字段
  const missingFields: string[] = [];
  if (!task.description || task.description.trim().length < 30) {
    missingFields.push('description');
  }
  if (!task.checkpoints || task.checkpoints.length === 0) {
    missingFields.push('checkpoints');
  }
  if (affectedFiles.length === 0) {
    missingFields.push('affected_files');
  }

  // 生成建议
  const suggestions = generateSuggestions(
    task,
    score,
    affectedFiles,
    changeSize,
    needsConfirmation
  );

  // 判断是否通过门禁
  let passed = true;

  // 检查质量分 (IR-08-04: 使用统一的质量评分→PASS/NOPASS映射)
  if (qualityScoreToVerdict(score.totalScore, effectiveConfig.minQualityScore) === 'NOPASS') {
    passed = false;
  }

  // 检查必需字段
  if (effectiveConfig.requireAffectedFiles && affectedFiles.length === 0) {
    passed = false;
  }

  // 检查解决方案确认
  if (effectiveConfig.requireSolutionConfirmation && needsConfirmation && score.solutionScore < 50) {
    passed = false;
  }

  return {
    passed,
    score,
    taskId,
    requiresConfirmation: needsConfirmation,
    missingFields,
    suggestions,
    affectedFiles,
    changeSize,
  };
}

/**
 * 批量检查任务队列的质量门禁
 */
export async function batchCheckQualityGate(
  taskIds: string[],
  config: QualityGateConfig = DEFAULT_QUALITY_GATE_CONFIG,
  cwd: string = process.cwd()
): Promise<BatchQualityGateResult> {
  const results = new Map<string, QualityGateResult>();
  let passedCount = 0;
  let failedCount = 0;
  const blockedTasks: string[] = [];

  for (const taskId of taskIds) {
    const result = await checkQualityGate(taskId, config, cwd);
    results.set(taskId, result);

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
      blockedTasks.push(taskId);
    }
  }

  return {
    totalTasks: taskIds.length,
    passedCount,
    failedCount,
    results,
    allPassed: failedCount === 0,
    blockedTasks,
  };
}

/**
 * 格式化质量门禁检查结果
 */
export function formatQualityGateResult(
  result: QualityGateResult,
  options: { compact?: boolean } = {}
): string {
  const { compact = false } = options;
  const lines: string[] = [];
  const separator = compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  // 状态图标
  const statusIcon = result.passed ? '✅' : '❌';
  const scoreIcon = result.score.totalScore >= 80 ? '🟢' :
                    result.score.totalScore >= 60 ? '🟡' : '🔴';

  lines.push('');
  lines.push(separator);
  lines.push(`${statusIcon} 质量门禁检查: ${result.taskId}`);
  lines.push(separator);
  lines.push('');

  // 质量评分
  lines.push(`📊 质量评分: ${scoreIcon} ${result.score.totalScore}/100`);
  lines.push(`   描述完整度: ${result.score.descriptionScore}%`);
  lines.push(`   检查点质量: ${result.score.checkpointScore}%`);
  lines.push(`   关联文件: ${result.score.relatedFilesScore}%`);
  lines.push(`   解决方案: ${result.score.solutionScore}%`);
  lines.push('');

  // 变更范围
  const sizeIcon = result.changeSize === 'small' ? '🔹' :
                   result.changeSize === 'medium' ? '🔶' : '🔴';
  lines.push(`📏 变更范围: ${sizeIcon} ${result.changeSize.toUpperCase()}`);
  lines.push('');

  // 受影响文件
  if (result.affectedFiles.length > 0) {
    lines.push(`📁 受影响文件 (${result.affectedFiles.length}):`);
    for (const file of result.affectedFiles.slice(0, 5)) {
      lines.push(`   - ${file}`);
    }
    if (result.affectedFiles.length > 5) {
      lines.push(`   ... 还有 ${result.affectedFiles.length - 5} 个文件`);
    }
  } else {
    lines.push('📁 受影响文件: ⚠️ 未指定');
  }
  lines.push('');

  // 需要确认
  if (result.requiresConfirmation) {
    lines.push('🔐 需要确认: 是（任务包含解决方案，执行前需确认理解）');
    lines.push('');
  }

  // 缺失字段
  if (result.missingFields.length > 0) {
    lines.push(`⚠️  缺失字段: ${result.missingFields.join(', ')}`);
    lines.push('');
  }

  // 改进建议
  if (result.suggestions.length > 0) {
    lines.push(separator);
    lines.push('💡 改进建议');
    lines.push(separator);
    lines.push('');

    // 按优先级排序
    const sortedSuggestions = [...result.suggestions].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const suggestion of sortedSuggestions) {
      const priorityIcon = suggestion.priority === 'high' ? '🔴' :
                           suggestion.priority === 'medium' ? '🟠' : '🟡';
      lines.push(`${priorityIcon} [${suggestion.category}] ${suggestion.message}`);
      lines.push(`   👉 ${suggestion.action}`);
      lines.push('');
    }
  }

  lines.push(separator);

  return lines.join('\n');
}

/**
 * 格式化批量检查结果
 */
export function formatBatchQualityGateResult(
  batchResult: BatchQualityGateResult,
  options: { compact?: boolean; showDetails?: boolean } = {}
): string {
  const { compact = false, showDetails = true } = options;
  const lines: string[] = [];
  const separator = compact ? '---' : '━'.repeat(SEPARATOR_WIDTH);

  lines.push('');
  lines.push(separator);
  lines.push('🚦 批量质量门禁检查结果');
  lines.push(separator);
  lines.push('');

  // 总体统计
  lines.push(`📊 统计:`);
  lines.push(`   总任务数: ${batchResult.totalTasks}`);
  lines.push(`   ✅ 通过: ${batchResult.passedCount}`);
  lines.push(`   ❌ 未通过: ${batchResult.failedCount}`);
  lines.push('');

  // 阻塞的任务
  if (batchResult.blockedTasks.length > 0) {
    lines.push(`🚫 以下任务因质量不达标被阻塞:`);
    for (const taskId of batchResult.blockedTasks) {
      const result = batchResult.results.get(taskId);
      if (result) {
        lines.push(`   - ${taskId} (分数: ${result.score.totalScore})`);
      }
    }
    lines.push('');
  }

  // 详细结果
  if (showDetails && batchResult.failedCount > 0) {
    for (const taskId of batchResult.blockedTasks) {
      const result = batchResult.results.get(taskId);
      if (result) {
        lines.push(formatQualityGateResult(result, { compact }));
      }
    }
  }

  lines.push(separator);

  if (batchResult.allPassed) {
    lines.push('✅ 所有任务通过质量门禁检查！');
  } else {
    lines.push(`⚠️  ${batchResult.failedCount} 个任务未通过质量门禁，请完善后再执行`);
  }

  lines.push('');
  lines.push('💡 提示: 使用 --require-quality <N> 设置最低质量分阈值 (默认 60)');
  lines.push('');

  return lines.join('\n');
}

/**
 * 输出质量门禁完善指南
 */
export function showQualityImprovementGuide(result: QualityGateResult): void {
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📖 任务质量完善指南');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  console.log(`任务 ${result.taskId} 质量分: ${result.score.totalScore}/100`);
  console.log('');

  if (result.suggestions.length === 0) {
    console.log('✅ 任务质量良好，无需改进。');
    return;
  }

  console.log('请按以下步骤完善任务:');
  console.log('');

  const steps = result.suggestions
    .filter(s => s.priority === 'high')
    .concat(result.suggestions.filter(s => s.priority === 'medium'))
    .concat(result.suggestions.filter(s => s.priority === 'low'));

  steps.forEach((suggestion, index) => {
    const icon = suggestion.priority === 'high' ? '🔴' :
                 suggestion.priority === 'medium' ? '🟠' : '🟡';
    console.log(`${index + 1}. ${icon} [${suggestion.category}] ${suggestion.message}`);
    console.log(`   ${suggestion.action}`);
    console.log('');
  });

  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('完善后重新运行 harness 命令执行任务。');
  console.log('');
}

/**
 * 确认理解解决方案（交互式）
 */
export function confirmSolutionUnderstanding(
  task: TaskMeta,
  result: QualityGateResult
): { confirmed: boolean; notes?: string } {
  // 如果不需要确认，直接通过
  if (!result.requiresConfirmation) {
    return { confirmed: true };
  }

  // 输出确认提示
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔐 解决方案确认');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');
  console.log(`任务 ${task.id} 包含解决方案，请确认您已理解:`);
  console.log('');

  // 显示解决方案摘要
  const description = task.description || '';
  const solutionMatch = description.match(/##\s*解决方案\s*\n([\s\S]*?)(?=\n##|$)/i);

  if (solutionMatch && solutionMatch[1]) {
    const solution = solutionMatch[1].trim();
    const lines = solution.split('\n').slice(0, 10);
    console.log('解决方案摘要:');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    if (solution.split('\n').length > 10) {
      console.log('  ...');
    }
  }

  console.log('');
  console.log('受影响文件:');
  for (const file of result.affectedFiles.slice(0, 5)) {
    console.log(`  - ${file}`);
  }
  if (result.affectedFiles.length > 5) {
    console.log(`  ... 还有 ${result.affectedFiles.length - 5} 个`);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 返回需要确认的标记（实际确认由调用方处理）
  return {
    confirmed: false,
    notes: '请在执行前确认您已理解上述解决方案和受影响文件',
  };
}
