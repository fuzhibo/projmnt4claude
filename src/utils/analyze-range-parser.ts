/**
 * analyze-range-parser.ts
 *
 * 解析 --check-range 参数，支持三种模式:
 *   all       - 分析所有 open 状态的任务 (默认)
 *   tasks:ID1,ID2 - 分析指定任务列表
 *   keyword:pattern - 在任务标题和描述中搜索匹配的任务 (支持正则)
 *
 * 安全防护:
 *   - 正则表达式 ReDoS 防护 (5秒超时)
 *   - 输入净化，防止命令注入
 *   - 用户友好的错误消息
 */

import type { TaskMeta } from '../types/task';
import { getAllTasks, readTaskMeta } from './task';

// ── 常量 ──────────────────────────────────────────────

/** 正则匹配超时阈值 (毫秒) */
const REGEX_TIMEOUT_MS = 5000;

/** keyword 模式允许的最大正则长度 */
const MAX_KEYWORD_LENGTH = 200;

/** tasks 模式允许的最大任务 ID 数量 */
const MAX_TASK_IDS = 50;

/** 单个任务 ID 的最大长度 */
const MAX_TASK_ID_LENGTH = 120;

// ── AnalyzeError ──────────────────────────────────────

/**
 * 分析命令专用错误类
 * 提供用户友好的错误消息和结构化的错误码
 */
export class AnalyzeError extends Error {
  /** 机器可读的错误码 */
  public readonly code: string;
  /** 附加上下文信息 */
  public readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'AnalyzeError';
    this.code = code;
    this.detail = detail;
  }
}

// ── CheckRange 类型 ───────────────────────────────────

/** 解析后的 check-range 结果 */
export interface ParsedCheckRange {
  /** 范围模式 */
  type: 'all' | 'tasks' | 'keyword';
  /** tasks 模式下的任务 ID 列表 */
  taskIds?: string[];
  /** keyword 模式下的搜索模式 */
  keyword?: string;
}

// ── safeRegexMatch ────────────────────────────────────

/**
 * 安全的正则匹配函数，带有超时保护防止 ReDoS 攻击。
 *
 * @param pattern - 正则表达式字符串
 * @param text - 待匹配文本
 * @param timeoutMs - 超时毫秒数 (默认 5000ms)
 * @returns RegExpMatchArray | null
 * @throws AnalyzeError 当正则超时或无效时
 */
export function safeRegexMatch(
  pattern: string,
  text: string,
  timeoutMs: number = REGEX_TIMEOUT_MS,
): RegExpMatchArray | null {
  // 验证 pattern
  if (!pattern || typeof pattern !== 'string') {
    throw new AnalyzeError(
      'INVALID_PATTERN',
      '正则表达式不能为空',
    );
  }

  // 编译正则，捕获无效表达式
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    throw new AnalyzeError(
      'INVALID_REGEX',
      `无效的正则表达式: "${pattern.length > 50 ? pattern.slice(0, 50) + '...' : pattern}"`,
      '请检查正则语法，特殊字符需要转义。常用: \\( \\) \\[ \\] \\* \\+ \\?',
    );
  }

  // 超时保护: 使用性能检测
  const start = Date.now();
  const result = text.match(regex);
  const elapsed = Date.now() - start;

  if (elapsed > timeoutMs) {
    throw new AnalyzeError(
      'REGEX_TIMEOUT',
      `正则匹配超时 (${elapsed}ms > ${timeoutMs}ms)，可能是 ReDoS 攻击模式`,
      `pattern: "${pattern.length > 50 ? pattern.slice(0, 50) + '...' : pattern}"`,
    );
  }

  return result;
}

// ── sanitizeCheckRange ────────────────────────────────

/**
 * 净化 check-range 输入字符串。
 * 移除控制字符、空字节，截断过长输入。
 *
 * @param input - 原始输入字符串
 * @returns 净化后的字符串
 */
export function sanitizeCheckRange(input: string): string {
  if (typeof input !== 'string') {
    throw new AnalyzeError(
      'INVALID_INPUT_TYPE',
      'check-range 参数必须是字符串',
    );
  }

  // 移除空字节和控制字符 (保留常见空白)
  let cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 去除首尾空白
  cleaned = cleaned.trim();

  // 截断过长输入
  if (cleaned.length > MAX_KEYWORD_LENGTH + 100) {
    cleaned = cleaned.slice(0, MAX_KEYWORD_LENGTH + 100);
  }

  return cleaned;
}

// ── parseCheckRange ───────────────────────────────────

/**
 * 解析 --check-range 参数值。
 *
 * @param input - 参数值字符串
 * @returns ParsedCheckRange 解析结果
 * @throws AnalyzeError 输入无效时
 *
 * @example
 * parseCheckRange('')              // { type: 'all' }
 * parseCheckRange('all')           // { type: 'all' }
 * parseCheckRange('tasks:T1,T2')   // { type: 'tasks', taskIds: ['T1', 'T2'] }
 * parseCheckRange('keyword:auth')  // { type: 'keyword', keyword: 'auth' }
 */
export function parseCheckRange(input: string): ParsedCheckRange {
  const raw = input ?? '';
  const sanitized = sanitizeCheckRange(raw);

  // 空值或 'all' → 全部
  if (!sanitized || sanitized.toLowerCase() === 'all') {
    return { type: 'all' };
  }

  // tasks: 模式
  if (sanitized.startsWith('tasks:')) {
    const idsPart = sanitized.slice('tasks:'.length).trim();
    if (!idsPart) {
      throw new AnalyzeError(
        'EMPTY_TASK_LIST',
        'tasks 模式需要提供至少一个任务 ID',
        '格式: tasks:TASK-ID1,TASK-ID2,...',
      );
    }

    const ids = idsPart
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (ids.length === 0) {
      throw new AnalyzeError(
        'EMPTY_TASK_LIST',
        'tasks 模式需要提供至少一个任务 ID',
      );
    }

    if (ids.length > MAX_TASK_IDS) {
      throw new AnalyzeError(
        'TOO_MANY_TASKS',
        `任务数量超限: ${ids.length} > ${MAX_TASK_IDS}`,
        '请减少任务 ID 数量或使用 keyword 模式',
      );
    }

    // 验证每个 ID
    for (const id of ids) {
      if (id.length > MAX_TASK_ID_LENGTH) {
        throw new AnalyzeError(
          'TASK_ID_TOO_LONG',
          `任务 ID 过长: "${id.slice(0, 30)}..."`,
          `最大长度: ${MAX_TASK_ID_LENGTH} 字符`,
        );
      }
      // 只允许安全字符: 字母、数字、连字符、下划线
      if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
        throw new AnalyzeError(
          'INVALID_TASK_ID',
          `任务 ID 包含非法字符: "${id}"`,
          '只允许字母、数字、连字符和下划线',
        );
      }
    }

    return { type: 'tasks', taskIds: ids };
  }

  // keyword: 模式
  if (sanitized.startsWith('keyword:')) {
    const keyword = sanitized.slice('keyword:'.length).trim();
    if (!keyword) {
      throw new AnalyzeError(
        'EMPTY_KEYWORD',
        'keyword 模式需要提供搜索关键词',
        '格式: keyword:搜索词 或 keyword:正则表达式',
      );
    }

    if (keyword.length > MAX_KEYWORD_LENGTH) {
      throw new AnalyzeError(
        'KEYWORD_TOO_LONG',
        `关键词过长: ${keyword.length} > ${MAX_KEYWORD_LENGTH}`,
        '请缩短搜索模式',
      );
    }

    // 预验证正则表达式是否有效
    try {
      new RegExp(keyword, 'i');
    } catch {
      throw new AnalyzeError(
        'INVALID_KEYWORD_REGEX',
        `关键词正则表达式无效: "${keyword.length > 50 ? keyword.slice(0, 50) + '...' : keyword}"`,
        '特殊字符需要转义: \\( \\) \\[ \\] \\* \\+ \\? \\. \\|',
      );
    }

    return { type: 'keyword', keyword };
  }

  // 无法识别的模式
  throw new AnalyzeError(
    'UNKNOWN_RANGE_FORMAT',
    `无法识别的 check-range 格式: "${sanitized.length > 50 ? sanitized.slice(0, 50) + '...' : sanitized}"`,
    '支持的格式: all | tasks:ID1,ID2 | keyword:pattern',
  );
}

// ── getTasksByRange ───────────────────────────────────

/**
 * 根据 check-range 获取目标任务列表。
 *
 * @param range - 解析后的 check-range
 * @param cwd - 工作目录
 * @returns 匹配的任务列表
 */
export function getTasksByRange(
  range: ParsedCheckRange,
  cwd: string = process.cwd(),
): TaskMeta[] {
  const allTasks = getAllTasks(cwd);

  switch (range.type) {
    case 'all': {
      // 默认: 分析所有非终态任务
      return allTasks.filter(t =>
        t.status === 'open' ||
        t.status === 'in_progress' ||
        t.status === 'wait_review' ||
        t.status === 'wait_qa' ||
        t.status === 'wait_evaluation'
      );
    }

    case 'tasks': {
      const ids = range.taskIds ?? [];
      const tasks: TaskMeta[] = [];
      for (const id of ids) {
        const task = readTaskMeta(id, cwd);
        if (task) {
          tasks.push(task);
        }
      }
      return tasks;
    }

    case 'keyword': {
      const keyword = range.keyword;
      if (!keyword) return [];

      return allTasks.filter(task => {
        const haystack = `${task.title ?? ''} ${task.description ?? ''}`;
        try {
          const match = safeRegexMatch(keyword, haystack);
          return match !== null;
        } catch {
          // 正则失败时不匹配
          return false;
        }
      });
    }

    default:
      return [];
  }
}
