/**
 * Task type
 */
export type TaskType = 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test';

/**
 * Task priority
 */
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

/**
 * Checkpoint policy
 * Used to explicitly declare whether a task needs checkpoints
 *
 * - 'required': Checkpoints required (P0/P1 tasks, bug/feature types)
 * - 'optional': Checkpoints optional (P2/P3 docs/refactor type tasks)
 * - 'none': No checkpoints needed (simple doc fixes, config changes, etc.)
 */
export type CheckpointPolicy = 'required' | 'optional' | 'none';

/**
 * Task creation source
 * Used to track which entry point created the task
 */
export type TaskCreatedBy =
  | 'cli'              // Created via task create command
  | 'init-requirement' // Created via init-requirement command
  | 'harness-dev'      // Created by harness development phase
  | 'harness-review'   // Created by harness code review phase
  | 'harness-qa'       // Created by harness QA phase
  | 'harness-eval'     // Created by harness evaluation phase
  | 'import';          // Created via import/migration

/**
 * Task status
 */
export type TaskStatus =
  | 'open'          // Pending
  | 'in_progress'   // In progress (development phase)
  | 'wait_review'   // Waiting for code review
  | 'wait_qa'           // Waiting for QA verification (AI or Human)
  | 'wait_evaluation'   // Waiting for evaluation (after QA pass, waiting for final evaluation)
  | 'resolved'      // Resolved
  | 'closed'        // Closed
  | 'abandoned'     // Abandoned
  | 'needs_human'   // Needs human intervention
  | 'failed';       // Failed

/**
 * Task failure reason
 * Used to distinguish specific reasons for task entering failed state
 */
export type FailureReason =
  | 'timeout'              // Development/execution timeout
  | 'quality_gate'         // Quality gate not passed
  | 'code_error'           // Code error/build failure
  | 'evaluation_nopass'    // Evaluation phase not passed (max retries reached)
  | 'max_retries_exceeded' // Max retries exceeded
  | 'upstream_failed';     // Upstream dependency task failed (cascade failure)

/**
 * Task history entry
 */
export interface TaskHistoryEntry {
  timestamp: string;       // ISO time
  action: string;          // Action description
  field?: string;          // Changed field name
  oldValue?: string;       // Old value
  newValue?: string;       // New value
  user?: string;           // User who performed action (optional)
  reason?: string;         // Status change reason (e.g., reopen reason)
  relatedIssue?: string;   // Related issue/PR
  verificationDetails?: string; // Verification failure details
  transitionNote?: TransitionNote; // Structured decision record for status transition
}

/**
 * Requirement change history entry
 * Used to track changes in task description/requirements
 */
export interface RequirementHistoryEntry {
  timestamp: string;       // ISO time
  version: number;         // Requirement version number (starting from 1)
  previousDescription?: string;  // Previous description content
  newDescription: string;  // New description content
  changeReason: string;    // Reason for change
  impactAnalysis?: string; // Impact analysis
  changedBy?: string;      // Changed by
  relatedIssue?: string;   // Related issue/PR
  affectedCheckpoints?: string[]; // List of affected checkpoint IDs
}

/**
 * Reopen record entry
 * Used to track detailed information when a task is reopened
 */
export interface ReopenRecord {
  /** Reopen timestamp (ISO) */
  timestamp: string;
  /** Reopen reason */
  reason: string;
  /** Whether this is an enhancement request */
  enhancementRequest?: boolean;
  /** List of failed checkpoint IDs that caused the reopen */
  failedCheckpoints?: string[];
  /** Previous task scope/description */
  previousScope?: string;
  /** New task scope/description after reopen */
  newScope?: string;
  /** QA feedback that led to the reopen */
  qaFeedback?: string;
  /** Reopened by (user or system) */
  reopenedBy?: string;
}

/**
 * Verification method type
 * Note: 'manual' type has been removed, forced to use specific verification methods
 */
export type VerificationMethod =
  | 'code_review'       // Code review
  | 'lint'              // Static check
  | 'unit_test'         // Unit test
  | 'functional_test'   // Functional test
  | 'integration_test'  // Integration test
  | 'e2e_test'          // End-to-end test
  | 'architect_review'  // Architect review
  | 'automated';        // Automated verification (generic)

/**
 * Task role type
 * Used to identify the current handler role of the task
 */
export type TaskRole =
  | 'executor'        // Executor (development)
  | 'code_reviewer'   // Code reviewer
  | 'qa_tester'       // QA tester (can be AI or Human)
  | 'architect';      // Architect

/**
 * Checkpoint category
 */
export type CheckpointCategory =
  | 'code_review'      // Code review checkpoint
  | 'qa_verification'; // QA verification checkpoint

/**
 * Checkpoint verification info
 */
export interface CheckpointVerification {
  method: VerificationMethod;  // Verification method ('manual' is prohibited)
  commands?: string[];         // Verification command list
  steps?: string[];            // Verification step descriptions (used when commands cannot express)
  expected?: string;           // Expected result
  result?: string;             // Actual verification result
  evidencePath?: string;       // Evidence path (relative path)
  exitCode?: number;           // Command exit code
  verifiedAt?: string;         // Verification time
  verifiedBy?: string;         // Verified by
}

/**
 * Verification method types that require commands
 * Automated verification methods like functional_test must include commands or steps
 */
const METHODS_REQUIRING_COMMANDS: VerificationMethod[] = [
  'functional_test',
  'unit_test',
  'integration_test',
  'e2e_test',
  'automated',
  'lint',
];

/**
 * Validate checkpoint verification info completeness
 * - Automated methods like functional_test must have commands or steps
 * - Returns validation result and warning message
 */
export function validateCheckpointVerification(
  checkpoint: { description: string; verification?: CheckpointVerification }
): { valid: boolean; warning?: string } {
  if (!checkpoint.verification) {
    return { valid: true };
  }

  const { method, commands, steps } = checkpoint.verification;

  if (METHODS_REQUIRING_COMMANDS.includes(method)) {
    const hasCommands = commands && commands.length > 0;
    const hasSteps = steps && steps.length > 0;

    if (!hasCommands && !hasSteps) {
      return {
        valid: false,
        warning: `Checkpoint "${checkpoint.description}" has verification method ${method}, but is missing commands or steps`,
      };
    }
  }

  return { valid: true };
}

/**
 * Task-level verification info
 * Auto-populated when task status becomes resolved
 */
export interface TaskVerification {
  /** Verification time (resolved time) */
  verifiedAt: string;
  /** Verified by (system or username) */
  verifiedBy: string;
  /** Verification methods summary (from checkpoints) */
  methods?: VerificationMethod[];
  /** Checkpoint completion rate */
  checkpointCompletionRate?: number;
  /** Verification result: passed | partial | failed */
  result: 'passed' | 'partial' | 'failed';
  /** Note */
  note?: string;
}

/**
 * Task-level Hook type
 */
export type TaskHookType =
  | 'preTaskCreate'     // Before task creation
  | 'postTaskCreate'    // After task creation
  | 'preTaskUpdate'     // Before task update (critical! before status change)
  | 'postTaskUpdate'    // After task update
  | 'preTaskComplete'   // Before task completion (critical! verify checkpoints)
  | 'postTaskComplete'; // After task completion

/**
 * Task-level Hook configuration
 */
export interface TaskHookConfig {
  enabled: boolean;
  hooks: {
    preTaskUpdate?: boolean;
    preTaskComplete?: boolean;
    postTaskUpdate?: boolean;
    postTaskComplete?: boolean;
  };
  scriptPath?: string;  // Custom validation script path
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook execution context
 */
export interface HookExecutionContext {
  hookType: TaskHookType;
  taskId: string;
  oldStatus?: TaskStatus;
  newStatus?: TaskStatus;
  taskData: TaskMeta;
  cwd: string;
}

/**
 * Hook execution result
 */
export interface HookResult {
  success: boolean;
  message?: string;
  details?: string[];
  shouldBlock?: boolean;  // Whether to block operation
}

/**
 * Validation error
 */
export interface ValidationError {
  code: string;
  message: string;
  details?: string[];
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  code: string;
  message: string;
  details?: string[];
}

/**
 * Task validation result
 */
export interface TaskValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  evidenceCollected: string[];
}

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
  id: string;                      // Checkpoint ID, e.g., CP-001 or CP-check-screenshot
  description: string;             // Description (corresponds to text in checkpoint.md)
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  category?: CheckpointCategory;   // Checkpoint category (code review/QA verification)
  requiredRole?: TaskRole;         // Role required to execute this checkpoint
  requiresHuman?: boolean;         // Whether human verification is required
  note?: string;                   // Note
  verification?: CheckpointVerification;
  createdAt: string;
  updatedAt: string;
}

/**
 * Batch commit history entry
 * Used to track association between harness pipeline batch git commits and tasks
 */
export interface CommitHistoryEntry {
  /** Git commit SHA */
  sha: string;
  /** Batch label (e.g., "Batch 1") */
  batchLabel: string;
  /** Commit time (ISO) */
  timestamp: string;
}

/**
 * Execution statistics
 */
export interface ExecutionStats {
  /** Execution duration (milliseconds) */
  duration: number;
  /** Retry count */
  retryCount: number;
  /** Execution completion time */
  completedAt: string;
  /** Branch info */
  branch?: string;
  /** Tags */
  tags?: string[];
  /** Batch commit history (harness pipeline batch git commit SHA tracking) */
  commitHistory?: CommitHistoryEntry[];
}

/**
 * Transition note record
 * Auto-appended on each task status change, used to track transition context
 */
export interface TransitionNote {
  /** Transition occurrence time (ISO) */
  timestamp: string;
  /** Source status (allows deprecated status strings like 'reopened', 'needs_human') */
  fromStatus: string;
  /** Target status */
  toStatus: TaskStatus;
  /** Transition note (filled by operator or system automatically) */
  note: string;
  /** Author */
  author?: string;
}

/**
 * Pipeline resume action type
 * Records the action to be performed when an interrupted task is resumed
 */
export type ResumeAction =
  | 'resume_pipeline'    // Resume pipeline execution
  | 'restart_stage'      // Restart current stage
  | 'manual_review'      // Requires manual review before decision
  | 'reset_to_open'      // Reset to open status
  | 'retry'              // Retry current stage (restart from failed stage)
  | 'next';              // Skip to next stage

/**
 * Pipeline phase to role mapping
 * Used for role-aware recovery logic to determine the handler role for each phase
 */
export const PHASE_ROLE_MAP: Record<string, TaskRole> = {
  development: 'executor',
  code_review: 'code_reviewer',
  qa_verification: 'qa_tester',
  qa: 'qa_tester',
  evaluation: 'architect',
};

/**
 * Phase history entry
 * Records task execution in each pipeline phase, used for role-aware recovery
 */
export interface PhaseHistoryEntry {
  /** Phase name */
  phase: string;
  /** Execution role */
  role: TaskRole;
  /** Phase verdict */
  verdict: 'PASS' | 'NOPASS';
  /** Execution time (ISO) */
  timestamp: string;
  /** Analysis description */
  analysis?: string;
  /** Resume action recommendation */
  resumeAction?: 'retry' | 'next';
}

/**
 * Pipeline class
 * Provides core logic for phase transition and role-aware recovery
 */
export class Pipeline {
  /** Phase to role mapping */
  static readonly PHASE_ROLE_MAP = PHASE_ROLE_MAP;

  /** Pipeline phase order */
  static readonly PHASE_ORDER = ['development', 'code_review', 'qa_verification', 'evaluation'];

  /**
   * Get role for phase
   */
  static getRoleForPhase(phase: string): TaskRole {
    return Pipeline.PHASE_ROLE_MAP[phase] || 'executor';
  }

  /**
   * Role-aware recovery logic
   * Determines recovery point (phase+role) based on resumeAction and completed phases
   *
   * @param phaseHistory - Completed phase history
   * @param resumeAction - Resume action: retry=retry failed phase, next=skip to next phase
   * @returns Recovery point info (phase+role), or null if cannot determine
   */
  static determineResumePoint(
    phaseHistory: PhaseHistoryEntry[],
    resumeAction: 'retry' | 'next',
  ): { phase: string; role: TaskRole } | null {
    if (phaseHistory.length === 0) {
      // No history, start from development phase
      return { phase: 'development', role: 'executor' };
    }

    const lastEntry = phaseHistory[phaseHistory.length - 1]!;
    const lastPhaseIndex = Pipeline.PHASE_ORDER.indexOf(lastEntry.phase);

    if (resumeAction === 'retry') {
      // retry: retry last failed/executed phase
      return {
        phase: lastEntry.phase,
        role: Pipeline.getRoleForPhase(lastEntry.phase),
      };
    }

    // next: skip to next phase
    if (lastPhaseIndex === -1 || lastPhaseIndex >= Pipeline.PHASE_ORDER.length - 1) {
      // Already at last phase or unknown phase, restart from development
      return { phase: 'development', role: 'executor' };
    }

    const nextPhase = Pipeline.PHASE_ORDER[lastPhaseIndex + 1]!;
    return {
      phase: nextPhase,
      role: Pipeline.getRoleForPhase(nextPhase),
    };
  }
}

/**
 * Current task metadata schema version
 * Incremented on each spec change, analyze command uses this for incremental migration
 *
 * Version history:
 * - 0: No schemaVersion field (legacy tasks)
 * - 1: Added reopenCount + requirementHistory (legacy_schema)
 * - 2: pipeline_status normalization + verdict_action_schema validation
 * - 3: commitHistory field (harness batch git commit SHA tracking)
 * - 4: reopened→open migration + TransitionNote + resumeAction
 * - 5: Auto-complete checkpoint prefix (add standard prefix to checkpoints without prefix)
 * - 6: Added checkpointPolicy field (auto-inferred checkpoint policy)
 */
export const CURRENT_TASK_SCHEMA_VERSION = 6;

/**
 * Terminal statuses - tasks in these statuses are considered complete
 * and will not be processed further by the task management system
 */
export const TERMINAL_STATUSES: TaskStatus[] = ['resolved', 'closed', 'abandoned', 'failed'];

/**
 * Pipeline intermediate status list
 * These statuses are only used during harness pipeline execution, old tasks staying in these statuses
 * indicate pipeline interruption or use of old spec
 */
export const PIPELINE_INTERMEDIATE_STATUSES: TaskStatus[] = [
  'wait_review',
  'wait_qa',
  'wait_evaluation',
  'needs_human',
];

/**
 * Pipeline status migration mapping
 * Legacy pipeline intermediate status → Latest spec status
 */
export const PIPELINE_STATUS_MIGRATION_MAP: Record<string, TaskStatus> = {
  'reopened': 'open',             // Reopened → Re-open
  'needs_human': 'open',          // Needs human → Back to pending
  'wait_review': 'in_progress',   // Waiting for review → Back to in progress
  'wait_qa': 'in_progress',       // Waiting for QA → Back to in progress
  'wait_evaluation': 'wait_qa',   // Waiting for evaluation → Revert to waiting for QA (when no evaluation report)
};

/**
 * Unified status normalization function
 * Merges all known variants: pending→open, completed→resolved, cancelled→abandoned,
 * reopened→open, needs_human→open, blocked→open, reopen→open, etc.
 */
export function normalizeStatus(status: string): TaskStatus {
  const statusMap: Record<string, TaskStatus> = {
    // Legacy format mappings
    'reopen': 'open',
    'reopened': 'open',
    'completed': 'resolved',
    'cancelled': 'abandoned',
    'blocked': 'open',
    'needs_human': 'open',
    // Standard format, return directly
    'open': 'open',
    'in_progress': 'in_progress',
    'wait_review': 'wait_review',
    'wait_qa': 'wait_qa',
    'wait_evaluation': 'wait_evaluation',
    'resolved': 'resolved',
    'closed': 'closed',
    'abandoned': 'abandoned',
    'failed': 'failed',
  };
  return statusMap[status] || 'open';
}

/**
 * Unified priority normalization function
 * Maps: urgent→P0, high→P1, medium→P2, low→P3, etc.
 */
export function normalizePriority(priority: string): TaskPriority {
  const priorityMap: Record<string, TaskPriority> = {
    'urgent': 'P0',
    'high': 'P1',
    'medium': 'P2',
    'low': 'P3',
    // Already in new format, return directly
    'P0': 'P0',
    'P1': 'P1',
    'P2': 'P2',
    'P3': 'P3',
    'Q1': 'Q1',
    'Q2': 'Q2',
    'Q3': 'Q3',
    'Q4': 'Q4',
  };
  return priorityMap[priority] || 'P2';
}

/**
 * Task metadata interface
 */
export interface TaskMeta {
  id: string;              // Task ID
  title: string;           // Title
  description?: string;    // Description (optional)
  type: TaskType;          // Task type
  priority: TaskPriority;  // Priority
  status: TaskStatus;      // Status
  dependencies: string[];  // List of dependent task IDs
  recommendedRole?: string; // Recommended role
  branch?: string;         // Associated branch
  needsDiscussion?: boolean; // Whether discussion is needed
  discussionTopics?: string[]; // List of discussion topics
  checkpointConfirmationToken?: string; // Checkpoint confirmation token
  checkpoints?: CheckpointMetadata[];  // Checkpoint metadata
  parentId?: string;       // Parent task ID (when used as subtask)
  subtaskIds?: string[];   // List of subtask IDs (when used as parent task)
  createdAt: string;       // ISO time
  updatedAt: string;       // ISO time
  history: TaskHistoryEntry[]; // History records
  reopenCount?: number;    // Reopen count (times task was reopened)
  reopenRecords?: ReopenRecord[]; // Detailed reopen records
  requirementHistory?: RequirementHistoryEntry[]; // Requirement change history
  verification?: TaskVerification; // Task-level verification info (auto-populated on resolved)
  executionStats?: ExecutionStats; // Execution stats (recorded after pipeline completion)
  transitionNotes?: TransitionNote[]; // Transition notes (appended on status change)
  phaseHistory?: PhaseHistoryEntry[]; // Phase history (for role-aware recovery)
  resumeAction?: ResumeAction;     // Resume action for interrupted task
  fileWarnings?: string[];        // File paths referenced but not existing at creation
  createdBy?: TaskCreatedBy;      // Task creation source
  schemaVersion?: number;         // Schema version, for incremental migration
  estimatedMinutes?: number;      // AI-estimated time (minutes), for adaptive timeout
  failureReason?: FailureReason;  // Task failure reason (recorded when status is failed)
  allowedTools?: string[];        // List of allowed tools (empty uses default --dangerously-skip-permissions)
  initQualityScore?: number;      // Quality score at task creation (written in init-requirement flow)
  /**
   * Checkpoint policy
   * - 'required': Checkpoints required (default inferred value)
   * - 'optional': Checkpoints optional
   * - 'none': No checkpoints needed
   *
   * If not specified, will be auto-inferred based on task type and priority
   */
  checkpointPolicy?: CheckpointPolicy;
}

/**
 * Task ID parse result
 */
export interface TaskIdInfo {
  valid: boolean;
  format: 'new' | 'old' | 'unknown';
  type?: TaskType;
  priority?: string;
  slug?: string;
  date?: string;
  raw: string;
}

/**
 * Pending human verification entry
 * Used to collect checkpoints requiring human verification in headless mode
 */
export interface PendingVerification {
  /** Task ID */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Checkpoint ID */
  checkpointId: string;
  /** Checkpoint description */
  checkpointDescription: string;
  /** Verification steps */
  verificationSteps?: string[];
  /** Expected result */
  expectedResult?: string;
  /** Enqueue time */
  enqueuedAt: string;
  /** Verification status: pending | approved | rejected */
  status: 'pending' | 'approved' | 'rejected';
  /** Verified by */
  verifiedBy?: string;
  /** Verification time */
  verifiedAt?: string;
  /** Verification feedback */
  feedback?: string;
  /** Associated pipeline session ID */
  sessionId?: string;
}

/**
 * Pending verification queue file structure
 */

/**
 * Create default task metadata
 *
 * Auto-infer checkpointPolicy based on task type and priority:
 * - P0/P1 priority: 'required' (checkpoints required)
 * - bug/feature type: 'required' (checkpoints required)
 * - docs/refactor type: 'optional' (checkpoints optional)
 */
export function createDefaultTaskMeta(
  id: string,
  title: string,
  type: TaskType = 'feature',
  description?: string,
  createdBy?: TaskCreatedBy
): TaskMeta {
  const now = new Date().toISOString();
  const priority: TaskPriority = 'P2';
  const checkpointPolicy = inferCheckpointPolicy(type, priority);

  return {
    id,
    title,
    description,
    type,
    priority,
    status: 'open',
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    reopenCount: 0,
    requirementHistory: [],
    createdBy,
    schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
    checkpointPolicy,
  };
}

/**
 * Validate task ID format
 * Supports multiple formats:
 * - New format: TASK-{type}-{priority}-{slug}-{date}
 * - Old format: TASK-001
 * - Any format: non-empty string containing letters, numbers, hyphens
 */
export function isValidTaskId(id: string): boolean {
  if (!id || id.trim().length === 0) {
    return false;
  }
  // Relaxed validation: allow any non-empty string as task ID
  return /^[a-zA-Z0-9\-_]+$/.test(id);
}

/**
 * Parse task ID
 */
export function parseTaskId(id: string): TaskIdInfo {
  // Old format: TASK-001
  if (/^TASK-\d{3,}$/.test(id)) {
    return {
      valid: true,
      format: 'old',
      raw: id,
    };
  }

  // New format: TASK-{type}-{priority}-{slug}-{date}
  const newFormat = /^TASK-(bug|feature|research|docs|refactor|test)-([PQ]\d)-([a-z0-9\-]+)-(\d{8})(?:-\d+)?$/;
  const match = id.match(newFormat);

  if (match) {
    return {
      valid: true,
      format: 'new',
      type: match[1] as TaskType,
      priority: match[2],
      slug: match[3],
      date: match[4],
      raw: id,
    };
  }

  // Legacy new format (no type): TASK-P1-user-auth-open-auth-20260306
  const legacyFormat = /^TASK-([PQ]\d)-([a-z0-9\-]+)-([a-z]+)-([a-z0-9]+)-(\d{8})(?:-\d+)?$/;
  const legacyMatch = id.match(legacyFormat);

  if (legacyMatch) {
    return {
      valid: true,
      format: 'new', // Marked as new format but missing type
      priority: legacyMatch[1],
      slug: legacyMatch[2],
      date: legacyMatch[5],
      raw: id,
    };
  }

  // Loose format: TASK-{any content}
  if (id.startsWith('TASK-') && id.length > 5) {
    return {
      valid: true,
      format: 'unknown',
      raw: id,
    };
  }

  return {
    valid: false,
    format: 'unknown',
    raw: id,
  };
}

/**
 * Check if task ID is in old format
 */
export function isOldFormatTaskId(id: string): boolean {
  return /^TASK-\d{3,}$/.test(id);
}

/**
 * Check if conversion is needed (old format or new format missing type)
 */
export function needsConversion(id: string): boolean {
  const info = parseTaskId(id);
  return info.valid && (info.format === 'old' || !info.type);
}

/**
 * Generate task ID (new format)
 * Format: TASK-{type}-{priority}-{slug}-{date}
 * Example: TASK-feature-P1-user-auth-20260306
 */
export function generateTaskId(
  type: TaskType,
  priority: TaskPriority,
  title: string,
  existingIds: string[] = []
): string {
  // Generate slug from title
  // Step 1: Try to extract ASCII words and numbers
  const asciiParts = title.match(/[a-zA-Z][a-zA-Z0-9]*|\d+/g);
  let slug: string;

  if (asciiParts && asciiParts.length > 0) {
    // Title contains English/number parts, use directly
    slug = asciiParts
      .join('-')
      .toLowerCase()
      .substring(0, 40);
  } else {
    // Pure non-ASCII title (e.g., Chinese), use type abbreviation + hash to generate meaningful identifier
    const typePrefix: Record<string, string> = {
      feature: 'feat',
      bugfix: 'fix',
      refactor: 'ref',
      docs: 'doc',
      test: 'test',
      chore: 'chore',
    };
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
    }
    const prefix = typePrefix[type] || 'task';
    slug = `${prefix}-${Math.abs(hash).toString(36)}`;
  }

  // Generate date string
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Generate new format ID
  let newId = `TASK-${type}-${priority}-${slug}-${date}`;

  // Check if already exists
  if (existingIds.includes(newId)) {
    let counter = 1;
    while (existingIds.includes(`${newId}-${counter}`)) {
      counter++;
    }
    newId = `${newId}-${counter}`;
  }

  return newId;
}

/**
 * Convert old format task ID to new format
 */
export function convertTaskId(
  oldId: string,
  type: TaskType,
  priority: TaskPriority,
  title: string,
  existingIds: string[] = []
): string {
  // If already in new format with type, return directly
  const info = parseTaskId(oldId);
  if (info.format === 'new' && info.type) {
    return oldId;
  }

  // Generate new format ID
  return generateTaskId(type, priority, title, existingIds);
}

/**
 * Infer task type from title
 */
export function inferTaskType(title: string): TaskType {
  const lowerTitle = title.toLowerCase();

  // Bug keywords (including Chinese equivalents)
  if (/\b(fix|bug|error|issue|crash|broken|fail|problem|修复|错误|问题|故障)\b/.test(lowerTitle)) {
    return 'bug';
  }

  // Research keywords (including Chinese equivalents)
  if (/\b(research|investigate|analyze|study|explore|调研|研究|分析|探索)\b/.test(lowerTitle)) {
    return 'research';
  }

  // Docs keywords (including Chinese equivalents)
  if (/\b(doc|document|readme|guide|manual|文档|说明|指南)\b/.test(lowerTitle)) {
    return 'docs';
  }

  // Refactor keywords (including Chinese equivalents)
  if (/\b(refactor|clean|improve|optimize|restructure|重构|优化|改进)\b/.test(lowerTitle)) {
    return 'refactor';
  }

  // Test keywords (including Chinese equivalents)
  if (/\b(test|spec|coverage|测试|单元测试|集成测试)\b/.test(lowerTitle)) {
    return 'test';
  }

  // Default to feature
  return 'feature';
}

/**
 * Infer priority from title
 */
export function inferTaskPriority(title: string): TaskPriority {
  const lowerTitle = title.toLowerCase();

  // Urgent priority (including Chinese equivalents)
  if (/\b(urgent|critical|asap|紧急|严重|立即)\b/.test(lowerTitle)) {
    return 'P0';
  }

  // High priority (including Chinese equivalents)
  if (/\b(important|high|优先|重要)\b/.test(lowerTitle)) {
    return 'P1';
  }

  // Low priority (including Chinese equivalents)
  if (/\b(low|optional|可选|低)\b/.test(lowerTitle)) {
    return 'P3';
  }

  return 'P2';
}

/**
 * Infer checkpoint policy based on task type and priority
 *
 * Inference rules:
 * - P0/P1 priority: checkpoints required ('required')
 * - P2/P3 priority: checkpoints optional ('optional')
 * - Q1-Q4 priority: checkpoints optional ('optional')
 *
 * @param type - Task type
 * @param priority - Task priority
 * @returns CheckpointPolicy Inferred checkpoint policy
 *
 * @example
 * ```typescript
 * inferCheckpointPolicy('bug', 'P0');     // 'required'
 * inferCheckpointPolicy('docs', 'P3');    // 'optional'
 * inferCheckpointPolicy('feature', 'P2'); // 'optional'
 * ```
 */
export function inferCheckpointPolicy(
  type: TaskType,
  priority: TaskPriority
): CheckpointPolicy {
  // P0/P1 high priority tasks must have checkpoints
  if (priority === 'P0' || priority === 'P1') {
    return 'required';
  }

  // P2/P3 and Q1-Q4 priority tasks have optional checkpoints
  return 'optional';
}

/**
 * Generate next task ID (old format, kept for compatibility)
 */
export function generateNextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) {
    return 'TASK-001';
  }

  const numbers = existingIds
    .map(id => {
      const match = id.match(/^TASK-(\d+)$/);
      return match ? parseInt(match[1]!, 10) : 0;
    })
    .filter(n => n > 0);

  const maxNumber = Math.max(...numbers, 0);
  return `TASK-${String(maxNumber + 1).padStart(3, '0')}`;
}
