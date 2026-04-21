/**
 * Requirement/problem decomposition type definitions
 *
 * Used to support init-requirement in decomposing complex requirements or investigation reports into multiple independent tasks
 */

import type { TaskType, TaskPriority } from './task';

/**
 * Decomposed subtask item
 */
export interface DecomposedTaskItem {
  /** Subtask title */
  title: string;
  /** Subtask detailed description */
  description: string;
  /** Inferred task type */
  type: TaskType;
  /** Inferred priority */
  priority: TaskPriority;
  /** Suggested checkpoints */
  suggestedCheckpoints: string[];
  /** Related files */
  relatedFiles: string[];
  /** Estimated time (minutes) */
  estimatedMinutes: number;
  /** Dependent subtask indexes (indexes in items array) */
  dependsOn: number[];
}

/**
 * Requirement decomposition result
 */
export interface RequirementDecomposition {
  /** Whether decomposable */
  decomposable: boolean;
  /** Decomposition failure reason */
  reason?: string;
  /** List of decomposed subtasks */
  items: DecomposedTaskItem[];
  /** Decomposition summary */
  summary: string;
}

/**
 * Decomposition options
 */
export interface DecomposeOptions {
  /** Minimum decomposition threshold: if subtask count is less than this, don't decompose */
  minItems?: number;
  /** Maximum decomposition count limit */
  maxItems?: number;
  /** Whether to use AI-enhanced decomposition */
  useAI?: boolean;
  /** Working directory */
  cwd?: string;
  /** Whether to enable quality checks (default true) */
  validateQuality?: boolean;
}

/**
 * Problem detection pattern (for identifying problem items in investigation reports)
 */
export interface ProblemPattern {
  /** Pattern name */
  name: string;
  /** Matching regex */
  regex: RegExp;
  /** Priority extractor */
  priorityExtractor?: (match: RegExpMatchArray) => TaskPriority;
}

/**
 * Default problem detection patterns
 */
export const DEFAULT_PROBLEM_PATTERNS: ProblemPattern[] = [
  {
    name: 'numbered_problem',
    // Matches: "问题1: xxx" or "缺陷1: xxx" (Chinese "问题" = Issue, "缺陷" = Defect)
    regex: /(?:^|\n)\s*(?:问题|Issue|Bug|缺陷)\s*(\d+)[.:\-]\s*([^\n]+)/gi,
    priorityExtractor: () => 'P2',
  },
  {
    name: 'bullet_problem',
    // Matches: "- [P0] xxx" or "- [紧急] xxx" (Chinese "紧急" = Urgent, "高" = High, "中" = Medium, "低" = Low)
    regex: /(?:^|\n)\s*[-*]\s*(?:\[?(P\d|紧急|高|中|低)\]?)?\s*([^\n]{10,200})/gi,
    priorityExtractor: (match) => {
      const priority = match[1];
      if (priority?.includes('P0') || priority?.includes('紧急')) return 'P0';  // 紧急 = Urgent
      if (priority?.includes('P1') || priority?.includes('高')) return 'P1';   // 高 = High
      if (priority?.includes('P3') || priority?.includes('低')) return 'P3';   // 低 = Low
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
 * Decomposition strategy type
 */
export type DecompositionStrategy =
  | 'auto'      // Auto-select
  | 'pattern'   // Pattern-based matching
  | 'ai'        // AI-based analysis
  | 'section';  // Section-based splitting

/**
 * Decomposed item (includes problem analysis and solution)
 * Complete requirement item for quality gate validation
 */
export interface DecomposedItem {
  /** Title */
  title: string;
  /** Problem description (symptoms and background) */
  problem: string;
  /** Solution (specific resolution steps) */
  solution: string;
  /** Root cause analysis */
  rootCause?: string;
  /** Task type */
  type: TaskType;
  /** Priority */
  priority: TaskPriority;
  /** Checkpoints */
  checkpoints: string[];
  /** Related files */
  relatedFiles?: string[];
  /** Estimated time (minutes) */
  estimatedMinutes?: number;
}

/**
 * Decomposition validation result
 */
export interface DecompositionValidation {
  /** Whether validation passed */
  valid: boolean;
  /** List of error messages */
  errors: string[];
  /** List of warning messages */
  warnings?: string[];
}

/**
 * Minimum field length constraints
 */
export const DECOMPOSITION_CONSTRAINTS = {
  /** Minimum title length */
  MIN_TITLE_LENGTH: 10,
  /** Minimum problem description length */
  MIN_PROBLEM_LENGTH: 50,
  /** Minimum solution length */
  MIN_SOLUTION_LENGTH: 50,
  /** Minimum root cause length */
  MIN_ROOT_CAUSE_LENGTH: 20,
  /** Minimum checkpoint count */
  MIN_CHECKPOINTS: 1,
  /** Valid priority list */
  VALID_PRIORITIES: ['P0', 'P1', 'P2', 'P3'] as TaskPriority[],
};

/**
 * Valid task types for decomposition
 */
const VALID_TASK_TYPES: TaskType[] = ['bug', 'feature', 'research', 'docs', 'refactor', 'test'];

/**
 * Valid task priorities for decomposition
 */
const VALID_TASK_PRIORITIES: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];

/**
 * Validate that a value is a valid TaskType
 */
function isValidTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && VALID_TASK_TYPES.includes(value as TaskType);
}

/**
 * Validate that a value is a valid TaskPriority
 */
function isValidTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && VALID_TASK_PRIORITIES.includes(value as TaskPriority);
}

/**
 * Validate DecomposedTaskItem
 * Checks all required fields and their types
 */
export function isValidDecomposedTaskItem(item: unknown): item is DecomposedTaskItem {
  // Check if item is an object
  if (typeof item !== 'object' || item === null) {
    return false;
  }

  const obj = item as Record<string, unknown>;

  // Check title: must be a non-empty string
  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    return false;
  }

  // Check description: must be a string
  if (typeof obj.description !== 'string') {
    return false;
  }

  // Check type: must be a valid TaskType
  if (!isValidTaskType(obj.type)) {
    return false;
  }

  // Check priority: must be a valid TaskPriority
  if (!isValidTaskPriority(obj.priority)) {
    return false;
  }

  // Check suggestedCheckpoints: must be an array of strings
  if (!Array.isArray(obj.suggestedCheckpoints)) {
    return false;
  }
  for (const checkpoint of obj.suggestedCheckpoints) {
    if (typeof checkpoint !== 'string') {
      return false;
    }
  }

  // Check relatedFiles: must be an array of strings
  if (!Array.isArray(obj.relatedFiles)) {
    return false;
  }
  for (const file of obj.relatedFiles) {
    if (typeof file !== 'string') {
      return false;
    }
  }

  // Check estimatedMinutes: must be a number
  if (typeof obj.estimatedMinutes !== 'number' || obj.estimatedMinutes < 0) {
    return false;
  }

  // Check dependsOn: must be an array of numbers
  if (!Array.isArray(obj.dependsOn)) {
    return false;
  }
  for (const dep of obj.dependsOn) {
    if (typeof dep !== 'number') {
      return false;
    }
  }

  return true;
}

/**
 * Validate RequirementDecomposition
 * Checks all required fields and validates each item
 */
export function isValidRequirementDecomposition(result: unknown): result is RequirementDecomposition {
  // Check if result is an object
  if (typeof result !== 'object' || result === null) {
    return false;
  }

  const obj = result as Record<string, unknown>;

  // Check decomposable: must be a boolean
  if (typeof obj.decomposable !== 'boolean') {
    return false;
  }

  // Check items: must be an array
  if (!Array.isArray(obj.items)) {
    return false;
  }

  // Validate each item in the array
  for (const item of obj.items) {
    if (!isValidDecomposedTaskItem(item)) {
      return false;
    }
  }

  // Check summary: must be a string
  if (typeof obj.summary !== 'string') {
    return false;
  }

  // Check reason: if present, must be a string
  if (obj.reason !== undefined && typeof obj.reason !== 'string') {
    return false;
  }

  return true;
}
