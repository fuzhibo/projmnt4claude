/**
 * 统一依赖推断引擎 (IR-08-03)
 *
 * 合并 plan.ts:inferDependenciesFromFiles (O(n²) 文件重叠)
 * 与 init-requirement.ts:inferDependencies (文件重叠 + 关键词匹配)
 * 为单一入口，供 init-requirement / plan / analyze 共用。
 */

import type { TaskMeta } from '../types/task.js';
import { extractAffectedFiles, extractFilePaths } from './quality-gate.js';

// ============== 类型定义 ==============

/**
 * 推断的依赖关系
 */
export interface InferredDependency {
  /** 被依赖的任务 ID */
  depTaskId: string;
  /** 重叠的文件路径列表 */
  overlappingFiles: string[];
  /** 推断来源 */
  source: 'file-overlap' | 'keyword' | 'ai-semantic';
  /** 推断原因 */
  reason?: string;
}

/**
 * 推断策略
 */
export type DependencyStrategy = 'file-overlap' | 'keyword' | 'all';

/**
 * 推断选项
 */
export interface InferDependenciesOptions {
  /** 推断策略 (默认 'all') */
  strategy?: DependencyStrategy;
  /** 是否跳过终态任务 (默认 true) */
  skipTerminal?: boolean;
  /** 额外关键词提示 (用于 keyword 策略) */
  keywordHints?: string[];
}

// ============== 终态集合 ==============

const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'abandoned', 'failed']);

// ============== 单任务推断 ==============

/**
 * 统一依赖推断：推断单个任务对其他任务的隐式依赖
 *
 * 策略：
 * 1. file-overlap: 当前任务文件与已有任务 affectedFiles 比较
 * 2. keyword: 通过关键词提示匹配已有任务标题
 *
 * @param taskOrDescription - 任务元数据或任务描述文本
 * @param allTasks - 所有已有任务
 * @param options - 推断选项
 * @returns 推断的依赖列表
 */
export function inferDependencies(
  taskOrDescription: TaskMeta | string,
  allTasks: TaskMeta[],
  options?: InferDependenciesOptions,
): InferredDependency[] {
  const {
    strategy = 'all',
    skipTerminal = true,
    keywordHints = [],
  } = options || {};

  // 解析当前任务文件列表
  let currentTaskId: string | undefined;
  let currentFiles: string[];

  if (typeof taskOrDescription === 'string') {
    currentFiles = extractFilePaths(taskOrDescription);
  } else {
    currentTaskId = taskOrDescription.id;
    currentFiles = extractAffectedFiles(taskOrDescription);
  }

  // 规范化文件路径
  const normalizedCurrent = new Set(
    currentFiles.map(f => f.replace(/\/+$/, '').toLowerCase()),
  );

  // 过滤候选任务
  const candidates = allTasks.filter(t => {
    if (currentTaskId && t.id === currentTaskId) return false;
    if (skipTerminal && TERMINAL_STATUSES.has(t.status)) return false;
    return true;
  });

  const results: InferredDependency[] = [];
  const seen = new Set<string>();

  // 策略 1: 文件重叠
  if (strategy === 'all' || strategy === 'file-overlap') {
    for (const candidate of candidates) {
      const candidateFiles = extractAffectedFiles(candidate);
      const normalizedCandidate = new Set(
        candidateFiles.map(f => f.replace(/\/+$/, '').toLowerCase()),
      );

      const overlap: string[] = [];
      for (const f of normalizedCurrent) {
        if (normalizedCandidate.has(f)) {
          overlap.push(f);
        }
      }

      if (overlap.length > 0 && !seen.has(candidate.id)) {
        seen.add(candidate.id);
        results.push({
          depTaskId: candidate.id,
          overlappingFiles: overlap,
          source: 'file-overlap',
        });
      }
    }
  }

  // 策略 2: 关键词匹配
  if ((strategy === 'all' || strategy === 'keyword') && keywordHints.length > 0) {
    for (const hint of keywordHints) {
      // 跳过已处理的文件重叠提示
      if (hint.startsWith('文件重叠依赖 ')) continue;

      const keywords = hint.toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

      for (const candidate of candidates) {
        if (seen.has(candidate.id)) continue;

        const titleLower = candidate.title.toLowerCase();
        const matchedKeywords = keywords.filter(kw => titleLower.includes(kw));

        // 至少匹配 2 个关键词或 1 个长度 >= 4 的关键词
        if (
          matchedKeywords.length >= 2 ||
          (matchedKeywords.length === 1 && matchedKeywords[0]!.length >= 4)
        ) {
          seen.add(candidate.id);
          results.push({
            depTaskId: candidate.id,
            overlappingFiles: [],
            source: 'keyword',
            reason: `关键词匹配: "${hint}" → ${candidate.title}`,
          });
        }
      }
    }
  }

  return results;
}

// ============== 批量推断 ==============

/**
 * 批量依赖推断 (O(n²) 文件重叠)
 *
 * 用于 plan.ts 任务链分析，对任务集合作两两比较，
 * 后创建的任务依赖先创建的任务（时间序方向）。
 *
 * @param tasks - 任务列表
 * @returns Map<taskId, InferredDependency[]> 每个任务的推断依赖
 */
export function inferDependenciesBatch(
  tasks: TaskMeta[],
): Map<string, InferredDependency[]> {
  const resultMap = new Map<string, InferredDependency[]>();

  if (tasks.length === 0) return resultMap;

  // 预计算每个任务的规范化文件路径集合
  const taskFilesMap = new Map<string, Set<string>>();
  for (const task of tasks) {
    const files = extractAffectedFiles(task);
    const normalized = new Set(
      files.map(f => f.replace(/\/+$/, '').toLowerCase()),
    );
    taskFilesMap.set(task.id, normalized);
  }

  // 按创建时间升序排列，确定依赖方向
  const sortedByTime = [...tasks].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  // O(n²) 两两比较
  for (let i = 0; i < sortedByTime.length; i++) {
    const laterTask = sortedByTime[i]!;
    const laterFiles = taskFilesMap.get(laterTask.id)!;

    for (let j = 0; j < i; j++) {
      const earlierTask = sortedByTime[j]!;
      const earlierFiles = taskFilesMap.get(earlierTask.id)!;

      const overlap: string[] = [];
      for (const f of laterFiles) {
        if (earlierFiles.has(f)) {
          overlap.push(f);
        }
      }

      if (overlap.length > 0) {
        const dep: InferredDependency = {
          depTaskId: earlierTask.id,
          overlappingFiles: overlap,
          source: 'file-overlap',
        };

        const existing = resultMap.get(laterTask.id);
        if (existing) {
          existing.push(dep);
        } else {
          resultMap.set(laterTask.id, [dep]);
        }
      }
    }
  }

  return resultMap;
}
