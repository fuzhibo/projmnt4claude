/**
 * Type definitions for Harness Design pattern
 *
 * Based on Anthropic's Harness Design pattern:
 * - Three-agent architecture: Planner → Generator → Evaluator
 * - Context reset: Isolate context between developer and evaluator
 * - Sprint Contract: Define "done" criteria before development
 */

import type { TaskMeta, TaskStatus, TaskRole, CheckpointCategory } from './task.js';

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
  /** API call retry attempts (for temporary errors like 429/500), default 3 */
  apiRetryAttempts: number;
  /** API retry base delay (seconds), default 60, uses exponential backoff */
  apiRetryDelay: number;
  /** Independent retry limit configuration for each phase */
  phaseRetryLimits?: PhaseRetryLimits;
  /** Auto git commit after each batch completes */
  batchGitCommit: boolean;
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
  apiRetryAttempts: 3,
  apiRetryDelay: 60,
  batchGitCommit: false,
  forceContinue: false,
};

/**
 * Sprint Contract - Agreement between developer and evaluator
 * Defines the "done" criteria
 */
export interface SprintContract {
  /** Task ID */
  taskId: string;
  /** List of acceptance criteria */
  acceptanceCriteria: string[];
  /** List of verification commands */
  verificationCommands: string[];
  /** List of checkpoint IDs */
  checkpoints: string[];
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
 * Action types recommended by evaluator
 * Output by architect role evaluator, drives state transition
 */
export type VerdictAction =
  | 'resolve'         // Pass, mark as resolved
  | 'redevelop'       // Retry from development phase (consumes retry count)
  | 'minor_fix'       // Minor fix for review/QA (retry from development, consumes phase retry)
  | 'retest'          // Retry from QA phase (consumes retry count)
  | 'reevaluate'      // Re-evaluate (no retry consumption, independent limit of 2)
  | 'escalate_human'; // Requires human intervention

/**
 * All valid VerdictAction values
 * Used by validate_task_data to detect invalid verdict actions in old tasks
 */
export const VALID_VERDICT_ACTIONS: VerdictAction[] = [
  'resolve',
  'redevelop',
  'minor_fix',
  'retest',
  'reevaluate',
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
 * Evaluation inference type
 * Annotates how evaluation results are parsed, for audit purposes
 */
export type EvaluationInferenceType =
  | 'structured_match'       // Structured match - exact EVALUATION_RESULT line match
  | 'explicit_match'         // Explicit match - Markdown heading/keyword matched PASS/NOPASS
  | 'content_inference'      // Content inference - inferred from Chinese keywords (deprecated, kept for compatibility)
  | 'prior_stage_inference'  // Prior stage inference - contradiction detection correction (deprecated, kept for compatibility)
  | 'parse_failure_default'  // Parse failure default - unable to parse, using default value
  | 'empty_output';          // Empty output - Claude process exited abnormally resulting in empty output

/**
 * Full-phase retry context
 * Passes previous failure information when retrying after phase failures, helps Claude understand historical context
 */
export interface RetryContext {
  /** Previous failure reason */
  previousFailureReason?: string;
  /** Phase of previous failure */
  previousPhase?: 'development' | 'code_review' | 'qa' | 'evaluation';
  /** Current attempt number (including this one) */
  attemptNumber: number;
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
  event: 'started' | 'skipped' | 'dev_started' | 'dev_completed' | 'code_review_started' | 'code_review_completed' | 'qa_started' | 'qa_completed' | 'review_started' | 'review_completed' | 'retry' | 'completed' | 'failed';
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
export type HarnessState = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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
  /** Execution records */
  records: TaskExecutionRecord[];
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
  /** Re-evaluation counter (independent of retry count, max 2) */
  reevaluateCounter: Map<string, number>;
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
    checkpoints: [],
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
    records: [],
    startTime: now,
    retryCounter: new Map(),
    updatedAt: now,
    resumeFrom: new Map(),
    reevaluateCounter: new Map(),
    phaseRetryCounters: new Map(),
    batchBoundaries: [],
    batchLabels: [],
    batchParallelizable: [],
    passedTasks: [],
    failedTasks: [],
    retryingTasks: [],
    taskPhaseCheckpoints: new Map(),
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
  };
}
