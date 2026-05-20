/**
 * Type definitions for Harness Design pattern
 *
 * Based on Anthropic's Harness Design pattern:
 * - Three-agent architecture: Planner → Generator → Evaluator
 * - Context reset: Isolate context between developer and evaluator
 * - Sprint Contract: Define "done" criteria before development
 */

import type { TaskMeta, TaskStatus, TaskRole, CheckpointCategory, TaskFailureReason } from './task.js';
import type { QAAcceptanceResult } from './qa-acceptance-criteria.js';

/**
 * Harness execution configuration
 */
export interface HarnessConfig {
  /** Maximum retry attempts, default 3 */
  maxRetries: number;
  /** Single task timeout (seconds), default 300 */
  timeout: number;
  /** Parallel execution count, default 1 (serial) */
  parallel: number;
  /** Dry run mode, do not actually execute */
  dryRun: boolean;
  /** Plan file path */
  planFile?: string;
  /** Resume from interruption */
  continue: boolean;
  /** JSON format output */
  jsonOutput: boolean;
  /** Working directory */
  cwd: string;
  /** Independent retry limit configuration for each phase */
  phaseRetryLimits?: PhaseRetryLimits;
  /**
   * Auto git tag + commit after each batch completes
   * Tag format: batch-{N}-{timestamp}
   * Commit message: harness: batch N completed (X passed, Y failed, Z file changes)
   */
  batchGitTagCommit: boolean;
  /**
   * Auto git commit after each task completes (resolved status)
   * Commit message format: feat: TASK-{id} - {title}
   * Only commits when batchGitTagCommit is true
   */
  taskGitCommit: boolean;
  /** Skip pipeline blocking on basic field validation failure (--force-continue) */
  forceContinue: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_HARNESS_CONFIG: Omit<HarnessConfig, 'cwd'> = {
  maxRetries: 3,
  timeout: 300,
  parallel: 1,
  dryRun: false,
  continue: false,
  jsonOutput: false,
  batchGitTagCommit: false,
  taskGitCommit: false,
  forceContinue: false,
};

/**
 * Sprint Contract - Agreement between developer and evaluator
 * Defines the "done" criteria
 *
 * Note: checkpoints field removed (P0 fix). Checkpoints are now accessed
 * directly from TaskMeta.checkpoints via filterCheckpoints() in each phase.
 * This eliminates ID-only references and preserves full checkpoint metadata.
 */
export interface SprintContract {
  /** Task ID */
  taskId: string;
  /** List of acceptance criteria */
  acceptanceCriteria: string[];
  /** List of verification commands */
  verificationCommands: string[];
  /** Creation time */
  createdAt: string;
  /** Last update time */
  updatedAt: string;
}

/**
 * Development phase status
 */
export type DevPhaseStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout';

/**
 * Development phase report
 */
export interface DevReport {
  /** Task ID */
  taskId: string;
  /** Execution status */
  status: DevPhaseStatus;
  /** List of code changes */
  changes: string[];
  /** List of evidence file paths */
  evidence: string[];
  /** List of completed checkpoint IDs */
  checkpointsCompleted: string[];
  /** Execution start time */
  startTime: string;
  /** Execution end time */
  endTime: string;
  /** Execution duration (milliseconds) */
  duration: number;
  /** Error message (if any) */
  error?: string;
  /** Claude session output */
  claudeOutput?: string;
}

/**
 * Review result
 */
export type ReviewResult = 'PASS' | 'NOPASS';

/**
 * Action types recommended by evaluator (P5: 简化后的 verdict action)
 * Output by architect role evaluator, drives state transition
 *
 * P5 变更：移除 minor_fix, retest, reevaluate 复杂分支
 * 只保留 3 个核心动作：
 * - resolve: 评估通过，标记为 resolved
 * - redevelop: 评估未通过，从开发阶段重试（消耗重试次数）
 * - escalate_human: 需要人工介入
 */
export type VerdictAction =
  | 'resolve'         // Pass, mark as resolved
  | 'redevelop'       // Retry from development phase (consumes retry count)
  | 'escalate_human'; // Requires human intervention

/**
 * All valid VerdictAction values
 * Used by validate_task_data to detect invalid verdict actions in old tasks
 */
export const VALID_VERDICT_ACTIONS: VerdictAction[] = [
  'resolve',
  'redevelop',
  'escalate_human',
];

/**
 * Failure category
 */
export type FailureCategory =
  | 'acceptance_criteria'  // Acceptance criteria not met
  | 'code_quality'         // Code quality issues
  | 'test_failure'         // Test failure
  | 'architecture'         // Architecture issues
  | 'specification'        // Specification mismatch
  | 'phantom_task'         // Phantom task violation
  | 'incomplete'           // Incomplete implementation
  | 'other';               // Other

/**
 * Error classification for rollback strategy (§9)
 *
 * Categorizes errors to determine appropriate handling:
 * - recoverable: Can be fixed and retried (needs rollback)
 * - unrecoverable: Max retries exhausted or user interrupt (preserve state)
 * - system: Environmental errors requiring cleanup
 */
export type ErrorClassification = 'recoverable' | 'unrecoverable' | 'system';

/**
 * Error category for rollback decision (§9)
 *
 * Maps error types to their classification and handling strategy
 */
export interface ErrorCategory {
  /** Error type identifier */
  type: string;
  /** Classification for rollback decision */
  classification: ErrorClassification;
  /** Whether rollback is needed */
  needsRollback: boolean;
  /** Human-readable description */
  description: string;
}

/**
 * Predefined error categories (§9)
 */
export const ERROR_CATEGORIES: Record<string, ErrorCategory> = {
  // Type 1: Recoverable errors (need rollback)
  phase_failure: {
    type: 'phase_failure',
    classification: 'recoverable',
    needsRollback: true,
    description: '阶段执行失败（开发/代码审核/QA/评估）',
  },
  quality_gate_failure: {
    type: 'quality_gate_failure',
    classification: 'recoverable',
    needsRollback: true,
    description: '质量门禁失败（可修复后重试）',
  },

  // Type 2: Unrecoverable errors (preserve state)
  max_retries_exhausted: {
    type: 'max_retries_exhausted',
    classification: 'unrecoverable',
    needsRollback: false,
    description: '最大重试次数耗尽',
  },
  user_interrupt: {
    type: 'user_interrupt',
    classification: 'unrecoverable',
    needsRollback: false,
    description: '用户手动中断',
  },

  // Type 3: System errors (need cleanup)
  disk_space: {
    type: 'disk_space',
    classification: 'system',
    needsRollback: false,
    description: '磁盘空间不足',
  },
  permission_error: {
    type: 'permission_error',
    classification: 'system',
    needsRollback: false,
    description: '权限错误',
  },
  api_error: {
    type: 'api_error',
    classification: 'system',
    needsRollback: false,
    description: 'API 服务错误（502/503/429）',
  },
};

/**
 * Rollback result
 */
export interface RollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Task ID */
  taskId: string;
  /** Reason for rollback */
  reason: string;
  /** Git commit SHA that was rolled back (if any) */
  rolledBackCommit?: string;
  /** Files that were cleaned up */
  cleanedFiles: string[];
  /** Error message (if rollback failed) */
  error?: string;
}

/**
 * Evaluation inference type
 * Annotates how evaluation results are parsed, for audit purposes
 */
export type EvaluationInferenceType =
  | 'structured_match'       // Structured match - exact EVALUATION_RESULT line match
  | 'explicit_match'         // Explicit match - Markdown heading/keyword matched PASS/NOPASS
  | 'content_inference'      // Content inference - inferred from legacy Chinese keyword matching (deprecated, kept for compatibility)
  | 'prior_stage_inference'  // Prior stage inference - contradiction detection correction (deprecated, kept for compatibility)
  | 'parse_failure_default'  // Parse failure default - unable to parse, using default value
  | 'empty_output';          // Empty output - Claude process exited abnormally resulting in empty output

/**
 * Failure record for retry history tracking
 */
export interface FailureRecord {
  /** Attempt number */
  attempt: number;
  /** Timestamp of failure */
  timestamp: string;
  /** Phase where failure occurred */
  phase: 'development' | 'code_review' | 'qa' | 'evaluation';
  /** Error message */
  error: string;
  /** Extracted insights from this failure */
  insights?: string[];
  /** Failure category */
  errorType?: string;
}

/**
 * Full-phase retry context (P6 enhanced version)
 * Passes previous failure information when retrying after phase failures, helps Claude understand historical context
 *
 * CP-P6-1: previousErrors - complete error history
 * CP-P6-2: accumulatedInsights - extracted learning from failures
 * CP-P6-3: suggestedFixes - generated repair suggestions
 */
export interface RetryContext {
  /** CP-P6-1: Previous failure reason (legacy, kept for backward compatibility) */
  previousFailureReason?: string;
  /** Phase of previous failure */
  previousPhase?: 'development' | 'code_review' | 'qa' | 'evaluation';
  /** Current attempt number (including this one) */
  attemptNumber: number;
  /** Maximum retry attempts allowed */
  maxRetries: number;
  /** Partial completion progress */
  partialProgress?: {
    completedCheckpoints?: string[];
    passedPhases?: string[];
  };
  /** Upstream failure info (carried during cascade failure recovery) */
  upstreamFailureInfo?: {
    taskId: string;
    reason: string;
    failedAt: string;
  };

  // ============================================================
  // P6 Enhanced Retry Context Fields
  // ============================================================

  /** CP-P6-1: List of all previous errors in this phase */
  previousErrors: string[];

  /** CP-P6-2: Accumulated insights from failure analysis */
  accumulatedInsights: string[];

  /** CP-P6-3: Suggested fixes based on error patterns */
  suggestedFixes: string[];

  /** Complete failure history for this task:phase */
  failureHistory?: FailureRecord[];
}

/**
 * Independent retry limit configuration for each phase
 */
export interface PhaseRetryLimits {
  /** Development phase retry limit, default 3 */
  development: number;
  /** Code review phase retry limit, default 1 */
  code_review: number;
  /** QA verification phase retry limit, default 2 */
  qa: number;
  /** Evaluation phase retry limit, default 2 */
  evaluation: number;
}

/** Default phase retry limits */
export const DEFAULT_PHASE_RETRY_LIMITS: PhaseRetryLimits = {
  development: 3,
  code_review: 1,
  qa: 2,
  evaluation: 2,
};

/**
 * Review phase report
 */
export interface ReviewVerdict {
  /** Task ID */
  taskId: string;
  /** Review result */
  result: ReviewResult;
  /** Reason for result */
  reason: string;
  /** Failed acceptance criteria */
  failedCriteria: string[];
  /** Failed checkpoints */
  failedCheckpoints: string[];
  /** Review time */
  reviewedAt: string;
  /** Reviewer (usually an independent Claude session) */
  reviewedBy: string;
  /** Detailed feedback */
  details?: string;
  /** Action recommended by evaluator (output by architect on NOPASS) */
  action?: VerdictAction;
  /** Failure category (output by architect on NOPASS) */
  failureCategory?: FailureCategory;
  /** Inference type (for audit, annotates how evaluation result was parsed) */
  inferenceType?: EvaluationInferenceType;
}

/**
 * Code review phase result
 * Generated by HarnessCodeReviewer
 */
export interface CodeReviewVerdict {
  /** Task ID */
  taskId: string;
  /** Review result */
  result: ReviewResult;
  /** Reason for result */
  reason: string;
  /** List of code quality issues */
  codeQualityIssues: string[];
  /** Failed code review checkpoints */
  failedCheckpoints: string[];
  /** Review time */
  reviewedAt: string;
  /** Reviewer role */
  reviewedBy: 'code_reviewer';
  /** Detailed feedback */
  details?: string;
}

/**
 * QA verification phase result
 * Generated by HarnessQATester
 */
export interface QAVerdict {
  /** Task ID */
  taskId: string;
  /** Verification result */
  result: ReviewResult;
  /** Reason for result */
  reason: string;
  /** List of test failures */
  testFailures: string[];
  /** Failed QA checkpoints */
  failedCheckpoints: string[];
  /** Whether human verification is required */
  requiresHuman: boolean;
  /** Checkpoints requiring human verification */
  humanVerificationCheckpoints: string[];
  /** Verification time */
  verifiedAt: string;
  /** Verifier role */
  verifiedBy: 'qa_tester';
  /** Detailed feedback */
  details?: string;
  /** Acceptance criteria verification result (optional, if performed) */
  acceptanceCriteriaResult?: QAAcceptanceResult;
}

/**
 * Human verification phase result
 */
export interface HumanVerdict {
  /** Task ID */
  taskId: string;
  /** Verification result */
  result: ReviewResult;
  /** Reason for result */
  reason: string;
  /** Checkpoint ID being verified */
  checkpointId: string;
  /** Verifier (user) */
  verifiedBy: string;
  /** Verification time */
  verifiedAt: string;
  /** User feedback */
  userFeedback?: string;
}

/**
 * Phase checkpoint - for --continue recovery
 * CP-P16: Tracks phase execution state for crash recovery
 */
export interface PhaseCheckpoint {
  /** Phase name */
  phase: 'development' | 'code_review' | 'qa' | 'evaluation';
  /** Phase status */
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
  /** Execution attempt count */
  attempts: number;
  /** Last attempt timestamp */
  lastAttemptAt?: string;
  /** Phase output report path */
  reportPath?: string;
  /** Phase result summary */
  result?: {
    status: string;
    summary: string;
  };
  /** Previous failure reason (if any) */
  lastFailure?: {
    reason: string;
    timestamp: string;
  };
}

/**
 * Task execution record
 */
export interface TaskExecutionRecord {
  /** Task ID */
  taskId: string;
  /** Task metadata */
  task: TaskMeta;
  /** Sprint Contract */
  contract: SprintContract;
  /** Development report */
  devReport: DevReport;
  /** Code review result */
  codeReviewVerdict?: CodeReviewVerdict;
  /** QA verification result */
  qaVerdict?: QAVerdict;
  /** List of human verification results */
  humanVerdicts?: HumanVerdict[];
  /** Review result */
  reviewVerdict?: ReviewVerdict;
  /** Retry count */
  retryCount: number;
  /** Final status */
  finalStatus: TaskStatus;
  /** Execution timeline */
  timeline: ExecutionTimelineEntry[];
}

/**
 * Execution timeline entry
 */
export interface ExecutionTimelineEntry {
  /** Timestamp */
  timestamp: string;
  /** Event type */
  event: 'started' | 'skipped' | 'dev_started' | 'dev_completed' | 'code_review_started' | 'code_review_completed' | 'qa_started' | 'qa_completed' | 'review_started' | 'review_completed' | 'retry' | 'completed' | 'committed' | 'failed';
  /** Description */
  description: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Execution summary
 */
export interface ExecutionSummary {
  /** Total number of tasks */
  totalTasks: number;
  /** Number passed */
  passed: number;
  /** Number failed */
  failed: number;
  /** Total retry count */
  totalRetries: number;
  /** Total execution duration (milliseconds) */
  duration: number;
  /** Start time */
  startTime: string;
  /** End time */
  endTime: string;
  /** Task results */
  taskResults: Map<string, TaskExecutionRecord>;
  /** Configuration */
  config: HarnessConfig;
}

/**
 * Harness execution state
 */
export type HarnessState = 'idle' | 'running' | 'pre_checking' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Harness runtime state (for persistence and recovery)
 */
export interface HarnessRuntimeState {
  /** State */
  state: HarnessState;
  /** Configuration */
  config: HarnessConfig;
  /** Task queue */
  taskQueue: string[];
  /** Current execution index */
  currentIndex: number;
  /** Start time */
  startTime: string;
  /** Retry counter */
  retryCounter: Map<string, number>;
  /** Last update time */
  updatedAt: string;
  /**
   * Which phase to resume from on retry
   * @deprecated Use state-driven determineResumePhase instead. Kept for backward compatibility serialization.
   */
  resumeFrom: Map<string, 'development' | 'code_review' | 'qa' | 'evaluation'>;
  /** Independent retry counter for each phase - key format: `${taskId}:${phase}` */
  phaseRetryCounters: Map<string, number>;
  /**
   * Batch boundary index list (from plan recommend's batch grouping data)
   * E.g., [0, 3, 7] means: batch1=[0,3), batch2=[3,7), batch3=[7,...)
   * Used with batchLabels to provide batch awareness for pipeline
   */
  batchBoundaries?: number[];
  /**
   * Batch label list (corresponds to batchBoundaries)
   * E.g., ['P0 Urgent', 'P1 High', 'P2 Medium']
   */
  batchLabels?: string[];
  /**
   * Whether batch is parallelizable (corresponds to batchBoundaries)
   */
  batchParallelizable?: boolean[];
  /**
   * List of passed task IDs (task-level status tracking)
   */
  passedTasks?: string[];
  /**
   * List of failed task IDs (task-level status tracking)
   */
  failedTasks?: string[];
  /**
   * List of retrying task IDs (task-level status tracking)
   */
  retryingTasks?: string[];
  /**
   * Task phase checkpoint - records the last completed phase and timestamp for each task
   * Used to skip completed phases during crash recovery
   * key: taskId, value: { completedPhase, completedAt }
   */
  taskPhaseCheckpoints: Map<string, { completedPhase: 'development' | 'code_review' | 'qa' | 'evaluation'; completedAt: string }>;

  // ============================================================
  // Two-Loop Architecture: Pre-check Loop (P1-PROB1)
  // ============================================================

  /**
   * 【第一轮】预检测通过的任务列表
   * 第二轮执行循环使用此列表
   */
  readyTasks?: string[];

  /**
   * 【P7】预检测质量门禁失败的任务
   * 任一失败则退出流水线，修复后重新检测
   */
  preCheckFailedTasks?: Array<{
    taskId: string;
    failedAt: string;
    errors: string[];
    detectedAt: string;
  }>;

  /**
   * 【P8】开发阶段前质量门禁失败的任务
   * 任一失败则退出流水线，修复后重新执行P8检测
   */
  devFailedTasks?: Array<{
    taskId: string;
    failedAt: 'pre_development';
    reason: string;
    detectedAt: string;
  }>;

  /**
   * 预检测阶段延后的任务（依赖未就绪）
   */
  pendingPreCheckTasks?: string[];

  /**
   * 执行阶段延后的任务
   */
  pendingExecutionTasks?: string[];

  /**
   * 预检测完成标记
   */
  preCheckCompleted?: boolean;

  // ============================================================
  // P6 Enhanced: Failure History for Retry Context
  // ============================================================

  /**
   * Failure history for retry context building
   * key: `${taskId}:${phase}`
   * value: List of failure records for this task:phase combination
   *
   * CP-P6: Stores complete failure history to enable intelligent retry context
   */
  failureHistory?: Map<string, FailureRecord[]>;

  // ============================================================
  // P16: Phase Checkpoints for --continue Recovery
  // ============================================================

  /**
   * Phase checkpoints for recovery
   * key: taskId
   * value: Map of phase -> PhaseCheckpoint
   *
   * CP-P16: Tracks detailed phase execution state for crash recovery
   */
  phaseCheckpoints?: Map<string, Map<string, PhaseCheckpoint>>;

  // ============================================================
  // P1-PROB1: Cascade Failure Handling
  // ============================================================

  /**
   * Task failure reasons map
   * key: taskId
   * value: TaskFailureReason
   *
   * CP-P1-8: Records detailed failure reasons for each failed task
   * Used for cascade failure handling and retrospective analysis
   */
  taskFailureReasons?: Map<string, TaskFailureReason>;
}

/**
 * Headless Claude execution options
 */
export interface HeadlessClaudeOptions {
  /** Task description/prompt */
  prompt: string;
  /** List of allowed tools */
  allowedTools: string[];
  /** Timeout (seconds) */
  timeout: number;
  /** Working directory */
  cwd: string;
  /** Output format */
  outputFormat: 'text' | 'json';
}

/**
 * Headless Claude execution result
 */
export interface HeadlessClaudeResult {
  /** Whether successful */
  success: boolean;
  /** Output content */
  output: string;
  /** Exit code */
  exitCode: number;
  /** Execution duration (milliseconds) */
  duration: number;
  /** Error message */
  error?: string;
  /** Hook error isolation warning */
  hookWarning?: string;
}

/**
 * Create default Sprint Contract
 */
export function createDefaultSprintContract(taskId: string): SprintContract {
  const now = new Date().toISOString();
  return {
    taskId,
    acceptanceCriteria: [],
    verificationCommands: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create default development report
 */
export function createDefaultDevReport(taskId: string): DevReport {
  const now = new Date().toISOString();
  return {
    taskId,
    status: 'pending',
    changes: [],
    evidence: [],
    checkpointsCompleted: [],
    startTime: now,
    endTime: now,
    duration: 0,
  };
}

/**
 * Create default execution record
 */
export function createDefaultExecutionRecord(task: TaskMeta): TaskExecutionRecord {
  return {
    taskId: task.id,
    task,
    contract: createDefaultSprintContract(task.id),
    devReport: createDefaultDevReport(task.id),
    retryCount: 0,
    finalStatus: task.status,
    timeline: [],
  };
}

/**
 * Plan snapshot - Immutable snapshot of plan state during pipeline execution
 *
 * Solves the phantom task detection's lack of plan context:
 * - Create snapshot at pipeline start, recording complete plan state at that time
 * - Read from snapshot throughout instead of current-plan.json
 * - Clean up on pipeline exit (normal cleanup, keep on exception for diagnosis)
 */
export interface PlanSnapshot {
  /** Snapshot ID (format: harness-plan-snapshot-{pid}-{timestamp}) */
  snapshotId: string;
  /** Process ID */
  pid: number;
  /** Creation timestamp */
  timestamp: string;
  /** Snapshot file path */
  path: string;
  /** Plan task ID list (ordered) */
  tasks: string[];
  /** Batch groups */
  batches?: string[][];
  /** Batch boundary indexes */
  batchBoundaries?: number[];
  /** Batch labels */
  batchLabels?: string[];
  /** Whether batch is parallelizable */
  batchParallelizable?: boolean[];
  /** Original plan file path */
  sourcePlanPath: string;
  /** Task status snapshot at creation time (taskId -> status) */
  taskStatusSnapshot: Record<string, string>;
}

/**
 * Create default runtime state
 */
export function createDefaultRuntimeState(config: HarnessConfig): HarnessRuntimeState {
  const now = new Date().toISOString();
  return {
    state: 'idle',
    config,
    taskQueue: [],
    currentIndex: 0,
    startTime: now,
    retryCounter: new Map(),
    updatedAt: now,
    resumeFrom: new Map(),
    phaseRetryCounters: new Map(),
    batchBoundaries: [],
    batchLabels: [],
    batchParallelizable: [],
    passedTasks: [],
    failedTasks: [],
    retryingTasks: [],
    taskPhaseCheckpoints: new Map(),
    // Two-Loop Architecture: Pre-check Loop (P1-PROB1)
    readyTasks: [],
    preCheckFailedTasks: [],
    preCheckCompleted: false,
    pendingPreCheckTasks: [],
    pendingExecutionTasks: [],
  };
}

// ============================================================
// Pipeline status report types (for AI consumption)
// ============================================================

/**
 * Pipeline phase
 */
export type HarnessReportPhase =
  | 'idle'           // Idle
  | 'initialization' // Initialization
  | 'development'    // Development phase
  | 'code_review'    // Code review phase
  | 'qa_verification'// QA verification phase
  | 'evaluation'     // Final evaluation phase
  | 'completed'      // Completed
  | 'failed';        // Failed

/**
 * Phase history entry
 */
export interface PhaseHistoryEntry {
  /** Phase */
  phase: HarnessReportPhase;
  /** Task ID */
  taskId?: string;
  /** Status */
  status: 'started' | 'completed' | 'failed';
  /** Timestamp */
  timestamp: string;
  /** Message */
  message?: string;
  /** Duration (milliseconds) */
  duration?: number;
}

/**
 * Pipeline status report
 * Storage location: .projmnt4claude/harness-status.json
 *
 * CP-23/24/25/26: Status accuracy fixes
 * - state only represents process-level status (running/completed/stopped)
 * - Individual task failures don't affect state, only recorded in failedTasks array
 * - totalTasks based on unique task IDs, not inflated by retries
 *
 * CP-P16-PROGRESS: Real-time progress tracking (§9)
 * - Progress updates at task start, phase completion, task completion
 * - completedTasks increments immediately on task completion
 * - progress percentage calculated in real-time
 */
export interface HarnessStatusReport {
  /** Session ID (associated with current AI session) */
  sessionId?: string;

  /**
   * Pipeline state (CP-23: only represents process-level status)
   * - running: Pipeline is executing
   * - completed: Pipeline ended normally (even with task failures)
   * - failed: Pipeline interrupted abnormally (process-level error)
   * - idle/cancelled: Initial/cancelled state
   */
  state: HarnessState;

  /** Current phase */
  currentPhase: HarnessReportPhase;

  /** Current task ID */
  currentTaskId?: string;

  /**
   * Total number of tasks (CP-25: based on unique task IDs, not inflated by retries)
   */
  totalTasks: number;

  /** Number of completed tasks */
  completedTasks: number;

  /** Progress percentage (0-100) */
  progress: number;

  /** Status message */
  message: string;

  /** Timestamp */
  timestamp: string;

  /** Phase history */
  phaseHistory: PhaseHistoryEntry[];

  /** Error information (if any) */
  error?: {
    code: string;
    message: string;
    taskId?: string;
  };

  // --- CP-24: Task-level status tracking ---

  /** List of passed task IDs */
  passedTasks?: string[];

  /** List of failed task details */
  failedTasks?: Array<{
    id: string;
    reason?: string;
    phase?: string;
  }>;

  /** List of retrying tasks */
  retryingTasks?: Array<{
    id: string;
    attempt: number;
    maxRetries: number;
    /** Phase being retried */
    phase?: string;
    /** Retry reason */
    reason?: string;
  }>;

  // --- CP-26: Retry history record ---

  /** Total retry count (unique task dimension) */
  retryCount?: number;

  /** Retry history details */
  retryHistory?: Array<{
    taskId: string;
    attempt: number;
    phase: string;
    reason: string;
    timestamp: string;
  }>;

  // --- CP-P16-PROGRESS: Real-time progress tracking fields ---

  /**
   * Current phase for the active task
   * One of: 'development', 'code_review', 'qa', 'evaluation'
   */
  currentTaskPhase?: 'development' | 'code_review' | 'qa' | 'evaluation';

  /**
   * Phase start times for current task (for duration tracking)
   * key: phase name, value: ISO timestamp
   */
  phaseStartTimes?: Record<string, string>;

  /**
   * Phase durations for current task (milliseconds)
   * key: phase name, value: duration in ms
   */
  phaseDurations?: Record<string, number>;
}

/**
 * Create default status report
 */
export function createDefaultStatusReport(sessionId?: string): HarnessStatusReport {
  return {
    sessionId,
    state: 'idle',
    currentPhase: 'idle',
    totalTasks: 0,
    completedTasks: 0,
    progress: 0,
    message: 'Pipeline ready',
    timestamp: new Date().toISOString(),
    phaseHistory: [],
    passedTasks: [],
    failedTasks: [],
    retryingTasks: [],
    retryCount: 0,
    retryHistory: [],
    // CP-P16-PROGRESS: Initialize progress tracking fields
    currentTaskPhase: undefined,
    phaseStartTimes: {},
    phaseDurations: {},
  };
}
