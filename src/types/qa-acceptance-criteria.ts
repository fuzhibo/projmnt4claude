/**
 * QA Acceptance Criteria Types
 *
 * Defines the hierarchy and structure for QA acceptance criteria validation.
 * Based on hd-p12-qa-pre-gate-design.md §8 supplementary design.
 *
 * @module types/qa-acceptance-criteria
 */

/**
 * Acceptance criteria verification level
 *
 * 层次1: 任务检查点验证（必须）
 * 层次2: 构建验证（必须）
 * 层次3: 测试验证（必须）
 * 层次4: 验收标准验证（可选，基于任务描述）
 */
export type AcceptanceLevel = 'checkpoint' | 'build' | 'test' | 'criteria';

/**
 * Acceptance criteria severity
 */
export type AcceptanceSeverity = 'required' | 'recommended' | 'optional';

/**
 * Parsed acceptance criterion from task description
 *
 * Example task description:
 * ```
 * ## 验收标准
 * - [ ] 所有 3 个文件都已迁移到使用 createIsolatedTestEnv
 * - [ ] beforeEach 中正确设置 env.mocks
 * - [ ] afterEach 中调用 env.cleanup()
 * ```
 */
export interface ParsedAcceptanceCriterion {
  /** Original criterion text */
  original: string;
  /** Parsed criterion type */
  type: 'file_count' | 'file_migration' | 'function_call' | 'pattern_match' | 'general';
  /** Expected value (if applicable) */
  expected?: string | number | boolean;
  /** Actual value (filled during verification) */
  actual?: string | number | boolean;
  /** Whether this criterion is satisfied */
  satisfied?: boolean;
  /** Details about verification */
  details?: string;
}

/**
 * Acceptance criteria verification result
 */
export interface AcceptanceVerificationResult {
  /** Level being verified */
  level: AcceptanceLevel;
  /** Whether this level passed */
  passed: boolean;
  /** Human-readable reason */
  reason: string;
  /** Detailed criteria results (for level 4) */
  criteria?: ParsedAcceptanceCriterion[];
  /** Error details (if any) */
  error?: string;
  /** Verification timestamp */
  timestamp: string;
}

/**
 * Full QA acceptance verification result
 *
 * Aggregates results from all four levels
 */
export interface QAAcceptanceResult {
  /** Task ID */
  taskId: string;
  /** Overall pass/fail */
  passed: boolean;
  /** Overall reason */
  reason: string;
  /** Results by level */
  levelResults: Map<AcceptanceLevel, AcceptanceVerificationResult>;
  /** Whether all required levels passed */
  requiredLevelsPassed: boolean;
  /** Whether optional criteria level was evaluated */
  criteriaEvaluated: boolean;
  /** Timestamp */
  timestamp: string;
}

/**
 * Acceptance criteria parser configuration
 */
export interface AcceptanceCriteriaParserConfig {
  /** Patterns to recognize file count criteria */
  fileCountPatterns: RegExp[];
  /** Patterns to recognize file migration criteria */
  fileMigrationPatterns: RegExp[];
  /** Patterns to recognize function call criteria */
  functionCallPatterns: RegExp[];
  /** Custom patterns (project-specific) */
  customPatterns?: RegExp[];
}

/**
 * Default parser configuration
 */
export const DEFAULT_PARSER_CONFIG: AcceptanceCriteriaParserConfig = {
  fileCountPatterns: [
    /所有\s*(\d+)\s*个文件/,
    /(\d+)\s*个文件/,
    /all\s*(\d+)\s*files/i,
    /(\d+)\s*files/i,
  ],
  fileMigrationPatterns: [
    /文件.*迁移/,
    /migrated?\s*to/i,
    /使用\s+(\w+)/,
    /using\s+(\w+)/i,
  ],
  functionCallPatterns: [
    /(\w+)\s*中.*调用/,
    /(\w+)\s*中.*设置/,
    /call\s+(\w+)/i,
    /in\s+(\w+)/i,
  ],
};

/**
 * Acceptance criteria hierarchy definition
 *
 * Defines the four-level verification hierarchy
 */
export interface AcceptanceCriteriaHierarchy {
  /** Level 1: Checkpoint verification */
  checkpoint: {
    level: 'checkpoint';
    severity: 'required';
    description: string;
    check: (taskId: string) => Promise<AcceptanceVerificationResult>;
  };
  /** Level 2: Build verification */
  build: {
    level: 'build';
    severity: 'required';
    description: string;
    check: (taskId: string, cwd: string) => Promise<AcceptanceVerificationResult>;
  };
  /** Level 3: Test verification */
  test: {
    level: 'test';
    severity: 'required';
    description: string;
    check: (taskId: string, cwd: string) => Promise<AcceptanceVerificationResult>;
  };
  /** Level 4: Criteria verification (optional) */
  criteria: {
    level: 'criteria';
    severity: 'optional';
    description: string;
    check: (taskId: string, parsedCriteria: ParsedAcceptanceCriterion[], cwd: string) => Promise<AcceptanceVerificationResult>;
  };
}

/**
 * Level descriptions
 */
export const ACCEPTANCE_LEVEL_DESCRIPTIONS: Record<AcceptanceLevel, string> = {
  checkpoint: '任务检查点验证 - 所有 QA 类型检查点状态为 completed',
  build: '构建验证 - bun run build 成功，无 TypeScript 编译错误',
  test: '测试验证 - 任务相关测试通过',
  criteria: '验收标准验证 - 解析任务描述中的验收标准并验证',
};

/**
 * Create default acceptance verification result
 */
export function createDefaultAcceptanceResult(level: AcceptanceLevel): AcceptanceVerificationResult {
  return {
    level,
    passed: false,
    reason: '',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create default QA acceptance result
 */
export function createDefaultQAAcceptanceResult(taskId: string): QAAcceptanceResult {
  return {
    taskId,
    passed: false,
    reason: '',
    levelResults: new Map(),
    requiredLevelsPassed: false,
    criteriaEvaluated: false,
    timestamp: new Date().toISOString(),
  };
}
