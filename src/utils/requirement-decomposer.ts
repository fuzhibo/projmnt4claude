/**
 * 需求/问题分解器
 *
 * 将复杂需求或调查报告分解为多个独立的子任务
 * 支持模式匹配和 AI 增强两种策略
 */

import type {
  RequirementDecomposition,
  DecomposedTaskItem,
  DecomposeOptions,
  ProblemPattern,
  DecomposedItem,
  DecompositionValidation,
} from '../types/decomposition';
import {
  DECOMPOSITION_CONSTRAINTS,
  isValidDecomposedTaskItem,
  isValidRequirementDecomposition,
} from '../types/decomposition';
import type { TaskType, TaskPriority } from '../types/task';
import { inferTaskType, inferTaskPriority } from '../types/task';
import { extractFilePaths } from './quality-gate';
import { getAIPreset, buildAgentOptionsFromPreset } from '../types/config';
import { invokeAgent } from './headless-agent.js';
import { t } from '../i18n/index.js';

// 安全常量配置
const SECURITY_CONFIG = {
  MAX_INPUT_LENGTH: 50000,
  MAX_AI_RESPONSE_LENGTH: 100000,
  DANGEROUS_PATTERNS: [
    /<script\b[^>]*>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /new\s+Function/i,
    /setTimeout\s*\(\s*['"`]/i,
    /setInterval\s*\(\s*['"`]/i,
    /__proto__/,
    /constructor\s*\[/,
    /\[\s*['"]constructor['"]\s*\]/,
  ],
} as const;

/**
 * 验证输入内容的安全性
 * - 检查内容长度是否在安全范围内
 * - 检测潜在的危险字符/模式，防止注入攻击
 *
 * @param content 输入内容
 * @returns 安全验证结果
 */
function validateInputSecurity(content: string): {
  valid: boolean;
  error?: string;
} {
  // 检查最大长度限制
  if (content.length > SECURITY_CONFIG.MAX_INPUT_LENGTH) {
    return {
      valid: false,
      error: `输入内容过长（当前 ${content.length} 字符），超过最大限制 ${SECURITY_CONFIG.MAX_INPUT_LENGTH} 字符`,
    };
  }

  // 检测危险模式（防止注入攻击）
  for (const pattern of SECURITY_CONFIG.DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      return {
        valid: false,
        error: '检测到潜在的危险内容模式，输入被拒绝',
      };
    }
  }

  return { valid: true };
}

/**
 * 判断内容是否为调查报告格式
 * 调查报告特征：
 * - 包含多个"问题"条目
 * - 有编号列表（1. 2. 3. 或 - *）
 * - 包含多个章节标题
 */
function isInvestigationReport(content: string): boolean {
  // 检查是否包含"问题"关键词多次
  const problemKeywords = ['问题', 'Issue', 'Bug', '缺陷', '发现'];
  let problemCount = 0;
  for (const keyword of problemKeywords) {
    const regex = new RegExp(keyword, 'gi');
    const matches = content.match(regex);
    if (matches) {
      problemCount += matches.length;
    }
  }

  // 检查是否有编号列表项
  const numberedItems = content.match(/(?:^|\n)\s*\d+[.:\-]\s+/g);
  const bulletItems = content.match(/(?:^|\n)\s*[-*]\s+/g);

  // 检查是否有章节标题
  const headers = content.match(/(?:^|\n)#{1,3}\s+[^\n]+/g);

  // 调查报告判定：多个问题关键词 + (编号列表或章节标题)
  const hasListStructure = (!!numberedItems && numberedItems.length >= 2) ||
                          (!!bulletItems && bulletItems.length >= 2) ||
                          (!!headers && headers.length >= 2);

  return problemCount >= 2 || (hasListStructure && content.length > 300);
}

/**
 * 基于模式匹配提取问题项
 */
function extractProblemsByPattern(content: string): Array<{
  title: string;
  description: string;
  priority: TaskPriority;
}> {
  const problems: Array<{
    title: string;
    description: string;
    priority: TaskPriority;
  }> = [];

  const seen = new Set<string>();
  const problemPositions: Array<{
    index: number;
    length: number;
    id: string;
    priorityFromParen: string;
    title: string;
  }> = [];

  // 模式1: 标准问题格式 "问题 X:" 或 "Issue X:" 或 "问题 X (P0):"
  // 简化正则，只匹配标题行，避免复杂的回溯问题
  const problemRegex = /(?:^|\n)(?:#{1,3}\s+)?(?:问题|Issue|Bug|缺陷)\s*(?:#\s*)?(\d+[A-Z]?)\s*(?:\((P\d|urgent|high|medium|low|[紧急高种低])\))?\s*[.:\-]?\s*([^\n]{10,200})/gi;

  let match;
  while ((match = problemRegex.exec(content)) !== null) {
    const problemId = match[1]?.trim() || '';
    const priorityFromParen = match[2]?.trim() || '';
    const title = match[3]?.trim() || '';

    if (!title || seen.has(title)) continue;
    seen.add(title);

    problemPositions.push({
      index: match.index,
      length: match[0].length,
      id: problemId,
      priorityFromParen,
      title,
    });
  }

  // 为每个匹配提取正文内容（到下一个匹配或结束）
  for (let i = 0; i < problemPositions.length; i++) {
    const current = problemPositions[i]!;
    const next = problemPositions[i + 1];

    const startIdx = current.index + current.length;
    const endIdx = next ? next.index : content.length;
    const body = content.substring(startIdx, endIdx).trim();

    // 提取优先级（优先使用括号中的优先级，其次在问题前查找）
    let priority: TaskPriority = 'P2';
    if (current.priorityFromParen) {
      // 从括号中提取优先级
      const p = current.priorityFromParen.toUpperCase();
      if (p === 'P0' || p.includes('紧急') || p.includes('URGENT')) priority = 'P0';
      else if (p === 'P1' || p.includes('高') || p.includes('HIGH')) priority = 'P1';
      else if (p === 'P3' || p.includes('低') || p.includes('LOW')) priority = 'P3';
    } else {
      // 在问题前查找优先级
      const priorityMatch = content.substring(Math.max(0, current.index - 100), current.index)
        .match(/(P\d|紧急|urgent|高|high|中|medium|低|low)/i);
      if (priorityMatch && priorityMatch[1]) {
        const p = priorityMatch[1].toUpperCase();
        if (p === 'P0' || p.includes('紧急') || p.includes('URGENT')) priority = 'P0';
        else if (p === 'P1' || p.includes('高') || p.includes('HIGH')) priority = 'P1';
        else if (p === 'P3' || p.includes('低') || p.includes('LOW')) priority = 'P3';
      }
    }

    problems.push({
      title: current.title.length > 100 ? current.title.substring(0, 97) + '...' : current.title,
      description: body || current.title,
      priority,
    });
  }

  // 模式2: 编号列表项（如果模式1未提取到足够的问题）
  if (problems.length < 2) {
    const numberedRegex = /(?:^|\n)\s*(\d+)[.:\-]\s*([^\n]{10,200})/g;
    while ((match = numberedRegex.exec(content)) !== null) {
      const title = match[2]?.trim() || '';
      if (!title || seen.has(title)) continue;

      // 检查是否为有效的问题描述
      const hasActionVerb = /(?:修复|解决|实现|添加|创建|修改|更新|验证|分析|优化|重构|删除|移除|调整|配置|部署)/.test(title);
      if (!hasActionVerb && title.length < 20) continue;

      seen.add(title);

      // 提取该编号项下的内容（直到下一个编号或结束）
      const startIdx = match.index + match[0].length;
      const nextMatch = numberedRegex.exec(content);
      numberedRegex.lastIndex = startIdx; // 重置索引
      const endIdx = nextMatch ? nextMatch.index : content.length;
      const body = content.substring(startIdx, endIdx).trim();

      problems.push({
        title: title.length > 100 ? title.substring(0, 97) + '...' : title,
        description: body || title,
        priority: 'P2',
      });

      if (problems.length >= 10) break; // 限制最大数量
    }
  }

  // 模式3: 章节标题（如果前两种模式都未提取到足够的问题）
  if (problems.length < 2) {
    const headerRegex = /(?:^|\n)(#{1,3}\s+)([^\n]{5,100})/g;
    while ((match = headerRegex.exec(content)) !== null) {
      const title = match[2]?.trim() || '';
      if (!title || seen.has(title)) continue;

      // 过滤掉常见的非问题标题
      const nonProblemTitles = ['概述', '总结', '结论', '背景', '目标', '介绍', '前言', '附录',
        'Summary', 'Conclusion', 'Background', 'Overview', 'Introduction', 'Appendix'];
      if (nonProblemTitles.some(t => title.includes(t))) continue;

      seen.add(title);

      // 提取该章节下的内容
      const startIdx = match.index + match[0].length;
      const nextMatch = headerRegex.exec(content);
      headerRegex.lastIndex = startIdx;
      const endIdx = nextMatch ? nextMatch.index : content.length;
      const body = content.substring(startIdx, endIdx).trim();

      problems.push({
        title: title.length > 100 ? title.substring(0, 97) + '...' : title,
        description: body || title,
        priority: 'P2',
      });

      if (problems.length >= 10) break;
    }
  }

  return problems;
}

/**
 * 验证 AI 响应数据的结构完整性
 *
 * @param parsed 解析后的数据
 * @returns 验证后的数据对象或 null
 */
function validateAIResponse(parsed: Record<string, unknown>): {
  decomposable: boolean;
  reason?: string;
  summary?: string;
  items: Array<Record<string, unknown>>;
} | null {
  // 基本结构验证
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  // 验证 items 字段必须是数组
  if (!('items' in parsed) || !Array.isArray(parsed.items)) {
    return null;
  }

  // 验证 decomposable 字段
  const decomposable = parsed.decomposable === true;

  // 验证 reason 字段（如果存在，必须是字符串）
  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;

  // 验证 summary 字段（如果存在，必须是字符串）
  const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;

  // 验证每个 item 的结构
  const items: Array<Record<string, unknown>> = [];
  for (const rawItem of parsed.items) {
    if (!rawItem || typeof rawItem !== 'object') {
      continue;
    }
    const item = rawItem as Record<string, unknown>;

    // 验证 title 字段（必需）
    if (!('title' in item) || typeof item.title !== 'string' || item.title.trim().length === 0) {
      continue;
    }

    // 验证数组字段类型
    if ('suggestedCheckpoints' in item && !Array.isArray(item.suggestedCheckpoints)) {
      continue;
    }
    if ('relatedFiles' in item && !Array.isArray(item.relatedFiles)) {
      continue;
    }
    if ('dependsOn' in item && !Array.isArray(item.dependsOn)) {
      continue;
    }

    items.push(item);
  }

  return {
    decomposable,
    reason,
    summary,
    items,
  };
}

/**
 * 使用 AI 增强分解
 */
async function decomposeWithAI(
  content: string,
  cwd: string
): Promise<RequirementDecomposition | null> {
  // 输入长度安全检查
  if (content.length > SECURITY_CONFIG.MAX_INPUT_LENGTH) {
    console.warn(`AI 分解警告：输入内容过长(${content.length}字符)，已截断处理`);
  }

  try {
    // 限制输入内容长度，防止过大的请求
    const safeContent = content.substring(0, Math.min(content.length, SECURITY_CONFIG.MAX_INPUT_LENGTH));

    const prompt = `请将以下需求/报告分解为多个独立的开发任务。

输入内容：
${safeContent.substring(0, 4000)}

请分析输入内容，识别出其中包含的独立问题或需求项，并返回 JSON 格式的分解结果：
{
  "decomposable": true,
  "summary": "分解摘要",
  "items": [
    {
      "title": "任务标题（动词开头，简洁明确）",
      "description": "任务详细描述",
      "type": "bug|feature|research|docs|refactor|test",
      "priority": "P0|P1|P2|P3",
      "suggestedCheckpoints": ["检查点1", "检查点2"],
      "relatedFiles": ["文件路径1", "文件路径2"],
      "estimatedMinutes": 15,
      "dependsOn": []
    }
  ]
}

规则：
1. 每个 item 应该是一个独立的、可执行的任务
2. title 必须以动词开头（如：修复、实现、添加、更新等）
3. priority 根据紧急程度判断：P0=紧急/阻塞，P1=高优先级，P2=中等，P3=低优先级
4. type 根据内容推断：bug=修复问题，feature=新功能，refactor=重构，docs=文档，test=测试
5. estimatedMinutes 预估完成时间（分钟），建议每个任务控制在 15-30 分钟
6. dependsOn 是依赖项的索引数组（如：[0] 表示依赖第一个任务）
7. 如果无法分解（如内容过于简单），返回 {"decomposable": false, "reason": "原因", "items": []}`;

    // 使用集中配置获取 decomposition 场景预设并调用 Agent
    const agentOptions = buildAgentOptionsFromPreset('decomposition', cwd);
    const result = await invokeAgent(prompt, agentOptions);

    if (!result.success) {
      return null;
    }

    // 解析 JSON 响应
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.output);
    } catch {
      // 尝试从 markdown code block 中提取
      const jsonMatch = result.output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch?.[1]) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // fall through
        }
      }
    }

    // 使用结构化验证函数验证 AI 响应
    const validated = validateAIResponse(parsed);
    if (!validated) {
      return null;
    }

    // 验证响应长度（防止超大响应导致内存问题）
    const responseLength = JSON.stringify(parsed).length;
    if (responseLength > SECURITY_CONFIG.MAX_AI_RESPONSE_LENGTH) {
      console.warn(`AI 响应过长(${responseLength}字符)，可能存在异常`);
      // 截断处理：只保留前10个items
      validated.items = validated.items.slice(0, 10);
    }

    // 构建候选结果
    const candidateResult: RequirementDecomposition = {
      decomposable: validated.decomposable,
      reason: validated.reason,
      summary: validated.summary || `分解为 ${validated.items.length} 个子任务`,
      items: validated.items.map((item: Record<string, unknown>, index: number) => ({
        title: String(item.title || `任务 ${index + 1}`),
        description: String(item.description || item.title || ''),
        type: (item.type as TaskType) || inferTaskType(String(item.title)),
        priority: (item.priority as TaskPriority) || 'P2',
        // 确保数组字段类型正确
        suggestedCheckpoints: Array.isArray(item.suggestedCheckpoints)
          ? item.suggestedCheckpoints.filter((c): c is string => typeof c === 'string')
          : [],
        relatedFiles: Array.isArray(item.relatedFiles)
          ? item.relatedFiles.filter((f): f is string => typeof f === 'string')
          : extractFilePaths(String(item.description || '')),
        estimatedMinutes: typeof item.estimatedMinutes === 'number' && item.estimatedMinutes > 0
          ? item.estimatedMinutes
          : 15,
        // 确保 dependsOn 是数字数组
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0)
          : [],
      })),
    };

    // 使用运行时验证函数验证 AI 返回的数据（CP-2 安全修复）
    if (!isValidRequirementDecomposition(candidateResult)) {
      // 尝试过滤掉无效的 items 并重新验证
      const validItems = candidateResult.items.filter((item, idx) => {
        const isValid = isValidDecomposedTaskItem(item);
        if (!isValid) {
          console.warn(`[decomposeWithAI] 第 ${idx + 1} 个子任务验证失败，已跳过`);
        }
        return isValid;
      });

      if (validItems.length === 0) {
        console.error('[decomposeWithAI] AI 返回的数据验证失败，无有效子任务');
        return null;
      }

      // 使用有效 items 重建结果
      const filteredResult: RequirementDecomposition = {
        ...candidateResult,
        items: validItems,
      };

      // 再次验证过滤后的结果
      if (!isValidRequirementDecomposition(filteredResult)) {
        console.error('[decomposeWithAI] 过滤后的数据仍验证失败');
        return null;
      }

      return filteredResult;
    }

    return candidateResult;
  } catch (error) {
    // 记录详细错误信息（在调试模式下）
    if (process.env.DEBUG === 'true') {
      console.error('AI 分解过程中发生错误:', error);
    }
    return null;
  }
}

/**
 * 递归分解配置
 */
export interface RecursiveDecomposeConfig {
  /** 是否启用递归分解 */
  enabled: boolean;
  /** 最大递归深度 */
  maxDepth: number;
  /** 复杂度阈值：预估耗时超过此值（分钟）的子任务会被考虑进一步分解 */
  complexityThreshold: number;
  /** 最小子任务数：如果分解后的子任务数少于此值，则不分解 */
  minSubtaskCount: number;
  /** 最大子任务数：限制递归分解产生的子任务总数 */
  maxSubtaskCount: number;
}

/**
 * 默认递归分解配置
 */
export const DEFAULT_RECURSIVE_CONFIG: RecursiveDecomposeConfig = {
  enabled: true,
  maxDepth: 2,
  complexityThreshold: 15,
  minSubtaskCount: 2,
  maxSubtaskCount: 20,
};

/**
 * 判断子任务是否需要进一步分解
 *
 * 使用 AI 分析子任务的复杂度和可分解性
 *
 * @param item 子任务项
 * @param depth 当前递归深度
 * @param config 递归分解配置
 * @param cwd 工作目录
 * @returns 是否需要进一步分解
 */
async function shouldDecomposeFurther(
  item: DecomposedTaskItem,
  depth: number,
  config: RecursiveDecomposeConfig,
  cwd: string
): Promise<{ needsDecomposition: boolean; reason?: string }> {
  // 检查递归深度限制
  if (depth >= config.maxDepth) {
    return { needsDecomposition: false, reason: '达到最大递归深度限制' };
  }

  // 检查预估耗时阈值
  if (item.estimatedMinutes < config.complexityThreshold) {
    return { needsDecomposition: false, reason: '预估耗时低于复杂度阈值' };
  }

  // 检查描述长度：太短的内容可能无法分解
  if (item.description.length < 100) {
    return { needsDecomposition: false, reason: '描述过短，无法进一步分解' };
  }

  try {
    const prompt = `请分析以下子任务是否需要进一步分解为更小的子任务。

子任务信息：
- 标题：${item.title}
- 描述：${item.description}
- 类型：${item.type}
- 优先级：${item.priority}
- 预估耗时：${item.estimatedMinutes} 分钟
- 当前递归深度：${depth}
- 复杂度阈值：${config.complexityThreshold} 分钟

请分析：
1. 这个子任务是否包含多个独立的实现步骤？
2. 预估耗时 ${item.estimatedMinutes} 分钟是否合理？
3. 是否可以拆分为多个预估耗时小于 ${config.complexityThreshold} 分钟的更小任务？
4. 拆分后是否能产生至少 ${config.minSubtaskCount} 个独立的子任务？

返回 JSON 格式：
{
  "needsDecomposition": true | false,
  "reason": "判断原因，说明为什么需要或不需要进一步分解",
  "suggestedSubtaskCount": 预估可分解的子任务数量（数字）
}

注意：
- 如果子任务包含明显的多步骤（如"实现功能A，然后实现功能B"），应返回 true
- 如果预估耗时远大于复杂度阈值（如 2 倍以上），应返回 true
- 如果描述范围明确且单一，即使耗时较长也应返回 false
- 只输出 JSON，不要输出其他内容`;

    const agentOptions = buildAgentOptionsFromPreset('decomposition', cwd);
    const result = await invokeAgent(prompt, agentOptions);

    if (!result.success) {
      return { needsDecomposition: false, reason: 'AI 调用失败' };
    }

    // 解析 JSON 响应
    let parsed: { needsDecomposition?: boolean; reason?: string; suggestedSubtaskCount?: number } | null = null;
    try {
      parsed = JSON.parse(result.output);
    } catch {
      // 尝试从 markdown code block 中提取
      const jsonMatch = result.output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch?.[1]) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // fall through
        }
      }
    }

    if (!parsed || typeof parsed.needsDecomposition !== 'boolean') {
      return { needsDecomposition: false, reason: 'AI 响应格式无效' };
    }

    // 验证建议的子任务数是否满足最小要求
    if (parsed.needsDecomposition &&
        typeof parsed.suggestedSubtaskCount === 'number' &&
        parsed.suggestedSubtaskCount < config.minSubtaskCount) {
      return {
        needsDecomposition: false,
        reason: `建议的子任务数(${parsed.suggestedSubtaskCount})少于最小要求(${config.minSubtaskCount})`,
      };
    }

    return {
      needsDecomposition: parsed.needsDecomposition,
      reason: parsed.reason || (parsed.needsDecomposition ? 'AI 判定需要进一步分解' : 'AI 判定无需进一步分解'),
    };
  } catch (error) {
    // 出错时保守处理：不进行递归分解
    if (process.env.DEBUG === 'true') {
      console.error('[shouldDecomposeFurther] 分析过程中发生错误:', error);
    }
    return { needsDecomposition: false, reason: '分析过程出错' };
  }
}

/**
 * 递归分解子任务
 *
 * 对需要进一步分解的子任务进行递归分解
 *
 * @param items 初始分解的任务列表
 * @param options 分解选项
 * @param config 递归分解配置
 * @param depth 当前递归深度
 * @returns 递归分解后的任务列表（树形结构，通过 dependsOn 表达依赖）
 */
export async function decomposeRecursively(
  items: DecomposedTaskItem[],
  options: DecomposeOptions,
  config: RecursiveDecomposeConfig,
  depth: number = 0
): Promise<DecomposedTaskItem[]> {
  if (!config.enabled || depth >= config.maxDepth) {
    return items;
  }

  const cwd = options.cwd || process.cwd();
  const result: DecomposedTaskItem[] = [];
  let totalSubtaskCount = 0;

  for (const item of items) {
    // 检查总子任务数限制
    if (totalSubtaskCount >= config.maxSubtaskCount) {
      result.push(item);
      continue;
    }

    // 判断是否需要进一步分解
    const decompositionCheck = await shouldDecomposeFurther(item, depth, config, cwd);

    if (!decompositionCheck.needsDecomposition) {
      // 不需要进一步分解，直接添加
      result.push(item);
      totalSubtaskCount++;
      continue;
    }

    // 需要进一步分解
    if (process.env.DEBUG === 'true') {
      console.log(`[decomposeRecursively] 深度 ${depth}，正在分解：${item.title}`);
      console.log(`  原因：${decompositionCheck.reason}`);
    }

    // 构造更详细的分解请求
    const detailedDescription = `## 任务标题\n${item.title}\n\n## 任务描述\n${item.description}\n\n## 检查点\n${item.suggestedCheckpoints.map(cp => `- ${cp}`).join('\n')}\n\n## 相关文件\n${item.relatedFiles.join(', ')}`;

    const subDecomposition = await decomposeRequirement(detailedDescription, {
      ...options,
      minItems: config.minSubtaskCount,
      maxItems: Math.min(5, config.maxSubtaskCount - totalSubtaskCount), // 限制每个任务的子任务数
    });

    if (subDecomposition.decomposable && subDecomposition.items.length >= config.minSubtaskCount) {
      // 递归分解子任务
      const recursivelyDecomposed = await decomposeRecursively(
        subDecomposition.items,
        options,
        config,
        depth + 1
      );

      // 调整依赖索引：子任务的依赖指向同组内的其他子任务
      // 原始依赖是基于子分解内部的索引，需要保持不变
      // 但子任务应该依赖于父任务之前的任务
      const baseIndex = result.length;
      for (let i = 0; i < recursivelyDecomposed.length; i++) {
        const subItem = recursivelyDecomposed[i]!;
        // 添加对前面任务的依赖（如果不是第一个）
        if (i > 0 && subItem.dependsOn.length === 0) {
          subItem.dependsOn = [baseIndex + i - 1];
        }
      }

      result.push(...recursivelyDecomposed);
      totalSubtaskCount += recursivelyDecomposed.length;

      if (process.env.DEBUG === 'true') {
        console.log(`  分解完成：${recursivelyDecomposed.length} 个子任务`);
      }
    } else {
      // 分解失败或产生的子任务太少，保留原任务
      result.push(item);
      totalSubtaskCount++;
    }
  }

  return result;
}

/**
 * 分解需求/问题报告
 *
 * 主入口函数，根据内容自动选择合适的分解策略
 * 支持递归分解：使用 AI 判断子任务是否需要进一步分解
 */
export async function decomposeRequirement(
  content: string,
  options: DecomposeOptions = {}
): Promise<RequirementDecomposition> {
  const {
    minItems = 2,
    maxItems = 10,
    useAI = true,
    cwd = process.cwd(),
    validateQuality = true, // 默认启用质量检查
  } = options;

  // 清理输入内容
  const trimmedContent = content.trim();

  // 最小长度检查
  if (trimmedContent.length < 100) {
    const texts = t(cwd).decomposition;
    return {
      decomposable: false,
      reason: texts.contentTooShort,
      items: [],
      summary: texts.singleTask,
    };
  }

  // 最大长度检查（安全限制）
  if (trimmedContent.length > SECURITY_CONFIG.MAX_INPUT_LENGTH) {
    return {
      decomposable: false,
      reason: `输入内容过长（当前 ${trimmedContent.length} 字符），超过最大限制 ${SECURITY_CONFIG.MAX_INPUT_LENGTH} 字符。请分批次提交或精简内容。`,
      items: [],
      summary: '内容超出限制',
    };
  }

  // 内容安全检查（防止注入攻击）
  const securityCheck = validateInputSecurity(trimmedContent);
  if (!securityCheck.valid) {
    return {
      decomposable: false,
      reason: securityCheck.error || '内容安全检查未通过',
      items: [],
      summary: '安全检查失败',
    };
  }

  // 检查是否为调查报告格式
  const isReport = isInvestigationReport(trimmedContent);

  // 策略1: 尝试使用 AI 分解（如果启用）
  if (useAI) {
    const aiResult = await decomposeWithAI(trimmedContent, cwd);
    if (aiResult && aiResult.decomposable && aiResult.items.length >= minItems) {
      const result: RequirementDecomposition = {
        ...aiResult,
        items: aiResult.items.slice(0, maxItems),
      };

      // 质量检查（如果启用）
      if (validateQuality) {
        const validation = validateDecomposition(result);
        if (!validation.valid) {
          // 报告验证失败
          reportDecompositionFailure(
            'AI 分解结果未通过质量检查',
            validation.errors,
            'AI 分解任务'
          );
          return {
            decomposable: false,
            reason: `质量检查失败: ${validation.errors.join('; ')}`,
            items: [],
            summary: '分解质量检查未通过',
          };
        }
      }

      return result;
    }
  }

  // 策略2: 基于模式匹配分解
  const problems = extractProblemsByPattern(trimmedContent);

  if (problems.length < minItems) {
    const texts = t(cwd).decomposition;
    return {
      decomposable: false,
      reason: `仅识别到 ${problems.length} 个问题项，少于阈值 ${minItems}`,
      items: [],
      summary: texts.singleTask,
    };
  }

  // 将提取的问题转换为子任务项
  const items: DecomposedTaskItem[] = problems.slice(0, maxItems).map((problem, index) => {
    const title = problem.title;
    const description = problem.description;

    // 推断任务类型
    const type = inferTaskType(title);

    // 使用提取的优先级或推断
    const priority = problem.priority || inferTaskPriority(title);

    // 提取相关文件
    const relatedFiles = extractFilePaths(description);

    // 生成检查点
    const suggestedCheckpoints = generateCheckpoints(type, title, description);

    // 估算时间
    const estimatedMinutes = Math.max(10, Math.min(60, 10 + relatedFiles.length * 5));

    return {
      title,
      description,
      type,
      priority,
      suggestedCheckpoints,
      relatedFiles,
      estimatedMinutes,
      dependsOn: index > 0 ? [index - 1] : [], // 默认线性依赖
    };
  });

  const result: RequirementDecomposition = {
    decomposable: true,
    items,
    summary: `基于模式匹配分解为 ${items.length} 个子任务`,
  };

  // 质量检查（如果启用）
  if (validateQuality) {
    const validation = validateDecomposition(result);
    if (!validation.valid) {
      // 报告验证失败
      reportDecompositionFailure(
        '模式匹配分解结果未通过质量检查',
        validation.errors,
        '模式匹配分解任务'
      );
      return {
        decomposable: false,
        reason: `质量检查失败: ${validation.errors.join('; ')}`,
        items: [],
        summary: '分解质量检查未通过',
      };
    }
  }

  return result;
}

/**
 * 根据任务类型生成默认检查点
 */
function generateCheckpoints(type: TaskType, title: string, description: string): string[] {
  const checkpoints: string[] = [];

  switch (type) {
    case 'bug':
      checkpoints.push('[implem] 定位并修复问题根因');
      checkpoints.push('[test] 验证修复后问题不再复现');
      break;
    case 'feature':
      checkpoints.push('[implem] 实现核心功能逻辑');
      checkpoints.push('[test] 功能测试通过');
      break;
    case 'refactor':
      checkpoints.push('[implem] 完成代码重构');
      checkpoints.push('[test] 回归测试通过');
      break;
    case 'docs':
      checkpoints.push('[implem] 完成文档编写');
      checkpoints.push('[verify] 文档内容审核通过');
      break;
    case 'test':
      checkpoints.push('[implem] 编写测试用例');
      checkpoints.push('[verify] 测试覆盖率达标');
      break;
    default:
      checkpoints.push('[implem] 完成功能实现');
      checkpoints.push('[verify] 验证功能正确性');
  }

  // 如果描述中包含文件路径，添加文件检查点
  const files = extractFilePaths(description);
  if (files.length > 0) {
    checkpoints.push(`[verify] 确认修改文件: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ' 等' : ''}`);
  }

  return checkpoints;
}

/**
 * 检查内容是否需要分解
 * 快速预检查，用于决定是否显示分解选项
 */
export function shouldDecompose(content: string): boolean {
  if (content.length < 200) return false;

  // 检查是否包含多个问题
  const problemCount = (
    content.match(/(?:^|\n)(?:问题|Issue|Bug|缺陷)\s*\d+/gi) || []
  ).length;

  // 检查是否有编号列表
  const numberedCount = (content.match(/(?:^|\n)\s*\d+[.:\-]\s+/g) || []).length;

  // 检查是否有章节标题
  const headerCount = (content.match(/(?:^|\n)#{1,3}\s+/g) || []).length;

  return problemCount >= 2 || numberedCount >= 3 || headerCount >= 3;
}

/**
 * 格式化分解结果供显示
 */
export function formatDecomposition(decomposition: RequirementDecomposition, cwd?: string): string {
  const texts = t(cwd).decomposition;

  if (!decomposition.decomposable) {
    return `${texts.notDecomposable}: ${decomposition.reason || texts.unknownReason}`;
  }

  const lines: string[] = [
    `📋 ${decomposition.summary}`,
    '',
  ];

  for (let i = 0; i < decomposition.items.length; i++) {
    const item = decomposition.items[i]!;
    const priorityIcon = item.priority === 'P0' ? texts.priorityP0 :
                         item.priority === 'P1' ? texts.priorityP1 :
                         item.priority === 'P2' ? texts.priorityP2 : texts.priorityP3;
    const typeIcon = item.type === 'bug' ? texts.typeBug :
                     item.type === 'feature' ? texts.typeFeature :
                     item.type === 'refactor' ? texts.typeRefactor :
                     item.type === 'docs' ? texts.typeDocs :
                     item.type === 'test' ? texts.typeTest : '📝';

    lines.push(`  ${i + 1}. ${typeIcon} ${priorityIcon} ${item.title}`);
    lines.push(`     类型: ${item.type} | 优先级: ${item.priority} | 预估: ${item.estimatedMinutes}分钟`);
    if (item.dependsOn.length > 0) {
      lines.push(`     ${texts.dependsOn}: ${item.dependsOn.map(d => `#${d + 1}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * 验证分解项的质量
 *
 * 检查以下内容：
 * - 标题长度（至少10个字符）
 * - 问题描述长度（至少50个字符）
 * - 解决方案长度（至少50个字符）
 * - 优先级有效性（必须是 P0/P1/P2/P3 之一）
 * - 检查点数量（至少1个）
 *
 * @param item 要验证的分解项
 * @returns 验证结果
 */
export function validateDecompositionItem(item: DecomposedItem): DecompositionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    MIN_TITLE_LENGTH,
    MIN_PROBLEM_LENGTH,
    MIN_SOLUTION_LENGTH,
    MIN_CHECKPOINTS,
    VALID_PRIORITIES,
  } = DECOMPOSITION_CONSTRAINTS;

  // 检查标题
  if (!item.title || item.title.trim().length === 0) {
    errors.push('标题不能为空');
  } else if (item.title.trim().length < MIN_TITLE_LENGTH) {
    errors.push(`标题过短，需要至少 ${MIN_TITLE_LENGTH} 个字符（当前 ${item.title.trim().length} 个）`);
  }

  // 检查问题描述和解决方案
  // 注意：如果是从旧格式转换（problem === solution），则验证合并后的长度
  const isLegacyFormat = item.problem === item.solution;

  if (isLegacyFormat) {
    // 旧格式：验证总长度（problem + solution 实际上是同一个 description）
    const totalLength = (item.problem || '').trim().length;
    if (totalLength === 0) {
      errors.push('描述不能为空');
    } else if (totalLength < MIN_PROBLEM_LENGTH) {
      errors.push(
        `描述过短，需要至少 ${MIN_PROBLEM_LENGTH} 个字符（当前 ${totalLength} 个）。建议提供详细的问题描述和解决方案`
      );
    }
  } else {
    // 新格式：分别验证 problem 和 solution
    if (!item.problem || item.problem.trim().length === 0) {
      errors.push('问题描述不能为空');
    } else if (item.problem.trim().length < MIN_PROBLEM_LENGTH) {
      errors.push(
        `问题描述过短或不完整，需要至少 ${MIN_PROBLEM_LENGTH} 个字符描述现象和背景（当前 ${item.problem.trim().length} 个）`
      );
    }

    if (!item.solution || item.solution.trim().length === 0) {
      errors.push('解决方案不能为空');
    } else if (item.solution.trim().length < MIN_SOLUTION_LENGTH) {
      errors.push(
        `解决方案过短或不完整，需要至少 ${MIN_SOLUTION_LENGTH} 个字符描述具体解决步骤（当前 ${item.solution.trim().length} 个）`
      );
    }
  }

  // 检查优先级
  if (!item.priority) {
    errors.push('优先级不能为空');
  } else if (!VALID_PRIORITIES.includes(item.priority)) {
    errors.push(`优先级无效，必须是 ${VALID_PRIORITIES.join('/')} 之一`);
  }

  // 检查检查点
  if (!item.checkpoints || item.checkpoints.length === 0) {
    errors.push(`缺少检查点，需要至少 ${MIN_CHECKPOINTS} 个验证步骤`);
  } else if (item.checkpoints.length < MIN_CHECKPOINTS) {
    errors.push(`检查点数量不足，需要至少 ${MIN_CHECKPOINTS} 个`);
  }

  // 检查根因分析（可选，但建议有）
  if (!item.rootCause || item.rootCause.trim().length < 20) {
    warnings.push('建议提供根因分析（至少20个字符），以便更好地理解问题本质');
  }

  // 检查预估时间（可选）
  if (!item.estimatedMinutes || item.estimatedMinutes <= 0) {
    warnings.push('建议提供预估耗时（分钟），以便合理安排开发计划');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 批量验证多个分解项
 *
 * @param items 分解项列表
 * @returns 验证结果，包含通过项和失败项
 */
export function validateDecompositionItems(
  items: DecomposedItem[]
): {
  valid: boolean;
  validItems: DecomposedItem[];
  invalidItems: Array<{ item: DecomposedItem; errors: string[] }>;
  allErrors: string[];
} {
  const validItems: DecomposedItem[] = [];
  const invalidItems: Array<{ item: DecomposedItem; errors: string[] }> = [];
  const allErrors: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const validation = validateDecompositionItem(item);

    if (validation.valid) {
      validItems.push(item);
    } else {
      invalidItems.push({ item, errors: validation.errors });
      allErrors.push(`\n[项 ${i + 1}: "${item.title}"]`);
      for (const error of validation.errors) {
        allErrors.push(`  - ${error}`);
      }
    }
  }

  return {
    valid: invalidItems.length === 0,
    validItems,
    invalidItems,
    allErrors,
  };
}

/**
 * 报告分解失败信息
 *
 * 输出格式化的错误信息和改进建议
 *
 * @param reason 失败原因
 * @param errors 具体错误列表
 * @param itemTitle 失败项的标题（可选）
 */
export function reportDecompositionFailure(
  reason: string,
  errors?: string[],
  itemTitle?: string
): void {
  console.error('❌ 分解失败');

  if (itemTitle) {
    console.error(`任务: ${itemTitle}`);
  }

  console.error(`原因: ${reason}`);

  if (errors && errors.length > 0) {
    console.error('\n具体问题:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
  }

  console.error('\n💡 建议:');
  console.error('  1. 提供详细的问题描述（现象、背景、影响）');
  console.error('  2. 提供根因分析，解释为什么会出现这个问题');
  console.error('  3. 提供具体的解决方案步骤，包括实现思路');
  console.error('  4. 参考格式：问题描述 → 根因分析 → 解决方案');
  console.error('  5. 确保问题描述和解决方案各至少50个字符');
  console.error('  6. 提供至少1个检查点用于验证完成情况');
}

/**
 * 将 DecomposedTaskItem 转换为 DecomposedItem 进行验证
 *
 * 用于兼容现有的分解结果格式
 *
 * @param item 原始分解任务项
 * @returns 转换后的分解项
 */
export function convertToDecomposedItem(item: DecomposedTaskItem): DecomposedItem {
  return {
    title: item.title,
    // 从 description 中尝试提取 problem 和 solution
    problem: item.description,
    solution: item.description, // 如果没有明确的 solution，使用 description 作为回退
    type: item.type,
    priority: item.priority,
    checkpoints: item.suggestedCheckpoints,
    relatedFiles: item.relatedFiles,
    estimatedMinutes: item.estimatedMinutes,
  };
}

/**
 * 验证分解结果的质量
 *
 * 包装函数，直接对 RequirementDecomposition 进行验证
 *
 * @param decomposition 分解结果
 * @returns 验证结果
 */
export function validateDecomposition(
  decomposition: RequirementDecomposition
): DecompositionValidation & { itemsWithIssues?: Array<{ index: number; title: string; errors: string[] }> } {
  // 如果不可分解，直接返回通过（因为没有要验证的项）
  if (!decomposition.decomposable || decomposition.items.length === 0) {
    return { valid: true, errors: [] };
  }

  const allErrors: string[] = [];
  const warnings: string[] = [];
  const itemsWithIssues: Array<{ index: number; title: string; errors: string[] }> = [];

  for (let i = 0; i < decomposition.items.length; i++) {
    const item = decomposition.items[i]!;
    const decomposedItem = convertToDecomposedItem(item);
    const validation = validateDecompositionItem(decomposedItem);

    if (!validation.valid) {
      const itemErrors = validation.errors;
      itemsWithIssues.push({ index: i, title: item.title, errors: itemErrors });
      allErrors.push(`\n[子任务 ${i + 1}: "${item.title}"]`);
      for (const error of itemErrors) {
        allErrors.push(`  - ${error}`);
      }
    }

    if (validation.warnings && validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        warnings.push(`[${item.title}] ${warning}`);
      }
    }
  }

  // 如果所有项都失败，报告整体失败
  if (itemsWithIssues.length === decomposition.items.length) {
    const summary = `所有 ${decomposition.items.length} 个子任务均未通过质量检查`;
    return {
      valid: false,
      errors: [summary, ...allErrors],
      warnings,
      itemsWithIssues,
    };
  }

  // 如果部分项失败，报告警告
  if (itemsWithIssues.length > 0) {
    const summary = `${itemsWithIssues.length}/${decomposition.items.length} 个子任务未通过质量检查`;
    return {
      valid: false,
      errors: [summary, ...allErrors],
      warnings,
      itemsWithIssues,
    };
  }

  return { valid: true, errors: [], warnings };
}
