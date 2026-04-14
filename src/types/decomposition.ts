/**
 * 需求/问题分解类型定义
 *
 * 用于支持 init-requirement 将复杂需求或调查报告分解为多个独立任务
 */

import type { TaskType, TaskPriority } from './task';

/**
 * 分解后的子任务项
 */
export interface DecomposedTaskItem {
  /** 子任务标题 */
  title: string;
  /** 子任务详细描述 */
  description: string;
  /** 推断的任务类型 */
  type: TaskType;
  /** 推断的优先级 */
  priority: TaskPriority;
  /** 建议的检查点 */
  suggestedCheckpoints: string[];
  /** 涉及文件 */
  relatedFiles: string[];
  /** 预估耗时（分钟） */
  estimatedMinutes: number;
  /** 依赖的子任务索引 (在 items 数组中的索引) */
  dependsOn: number[];
}

/**
 * 需求分解结果
 */
export interface RequirementDecomposition {
  /** 是否可分解 */
  decomposable: boolean;
  /** 分解失败原因 */
  reason?: string;
  /** 分解后的子任务列表 */
  items: DecomposedTaskItem[];
  /** 分解摘要 */
  summary: string;
}

/**
 * 分解选项
 */
export interface DecomposeOptions {
  /** 最小分解阈值：如果子任务数量少于此值，则不分解 */
  minItems?: number;
  /** 最大分解数量限制 */
  maxItems?: number;
  /** 是否使用 AI 增强分解 */
  useAI?: boolean;
  /** 工作目录 */
  cwd?: string;
}

/**
 * 问题检测模式（用于识别调查报告中的问题项）
 */
export interface ProblemPattern {
  /** 模式名称 */
  name: string;
  /** 匹配正则 */
  regex: RegExp;
  /** 提取优先级 */
  priorityExtractor?: (match: RegExpMatchArray) => TaskPriority;
}

/**
 * 默认问题检测模式
 */
export const DEFAULT_PROBLEM_PATTERNS: ProblemPattern[] = [
  {
    name: 'numbered_problem',
    regex: /(?:^|\n)\s*(?:问题|Issue|Bug|缺陷)\s*(\d+)[.:\-]\s*([^\n]+)/gi,
    priorityExtractor: () => 'P2',
  },
  {
    name: 'bullet_problem',
    regex: /(?:^|\n)\s*[-*]\s*(?:\[?(P\d|紧急|高|中|低)\]?)?\s*([^\n]{10,200})/gi,
    priorityExtractor: (match) => {
      const priority = match[1];
      if (priority?.includes('P0') || priority?.includes('紧急')) return 'P0';
      if (priority?.includes('P1') || priority?.includes('高')) return 'P1';
      if (priority?.includes('P3') || priority?.includes('低')) return 'P3';
      return 'P2';
    },
  },
  {
    name: 'section_problem',
    regex: /(?:^|\n)(?:#{1,3}\s+)([^\n]{5,100})/gi,
    priorityExtractor: () => 'P2',
  },
];

/**
 * 分解策略类型
 */
export type DecompositionStrategy =
  | 'auto'      // 自动选择
  | 'pattern'   // 基于模式匹配
  | 'ai'        // 基于 AI 分析
  | 'section';  // 基于章节分割
