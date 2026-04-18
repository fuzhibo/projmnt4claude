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
